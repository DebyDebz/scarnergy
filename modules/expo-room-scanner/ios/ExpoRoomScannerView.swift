import ExpoModulesCore
import RoomPlan
import UIKit

class ExpoRoomScannerView: ExpoView {
  let onCaptureFinish = EventDispatcher()
  let onCaptureError = EventDispatcher()

  // Typed as Any so this class compiles for iOS < 16, where RoomCaptureView doesn't exist.
  private var roomCaptureView: Any?
  private var delegateProxy: AnyObject?
  private var isCurrentlyScanning = false

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    setupNativeCaptureView()
  }

  private func setupNativeCaptureView() {
    if #available(iOS 16.0, *) {
      guard RoomCaptureSession.isSupported else {
        showUnsupportedMessage("This device does not have a LiDAR scanner.")
        return
      }
      let captureView = RoomCaptureView(frame: bounds)
      captureView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
      let proxy = RoomCaptureDelegateProxy(owner: self)
      captureView.captureSession.delegate = proxy
      delegateProxy = proxy
      roomCaptureView = captureView
      addSubview(captureView)

      // A previous attempt also attached an ARCoachingOverlayView directly to
      // captureView.captureSession.arSession here, to proactively coach the
      // user before tracking degrades. Reverted: RoomCaptureSession is meant
      // to exclusively own and drive its ARSession, and confirmed live this
      // caused scans to fail almost immediately on retry (works ~1s, then
      // world-tracking-failure again) — consistent with the overlay's own
      // session management conflicting with RoomCaptureSession's internal
      // one, not environmental bad luck. Removed rather than risk another
      // guess at the correct integration without a way to test it here.
    } else {
      showUnsupportedMessage("Room scanning requires iOS 16 or later.")
    }
  }

  private func showUnsupportedMessage(_ text: String) {
    backgroundColor = .black
    let label = UILabel(frame: bounds)
    label.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    label.text = text
    label.numberOfLines = 0
    label.textAlignment = .center
    label.textColor = .white
    addSubview(label)
  }

  // Driven by the "isScanning" prop from JS — toggling it starts/stops the RoomPlan session.
  func setScanning(_ scanning: Bool) {
    guard scanning != isCurrentlyScanning else { return }
    isCurrentlyScanning = scanning

    guard #available(iOS 16.0, *), let captureView = roomCaptureView as? RoomCaptureView else {
      if scanning {
        onCaptureError(["message": "Room scanning is not supported on this device."])
      }
      return
    }

    if scanning {
      captureView.captureSession.run(configuration: RoomCaptureSession.Configuration())
    } else {
      captureView.captureSession.stop()
    }
  }

  // RoomCaptureView is created with a zero frame in init() (before RN has laid out this
  // wrapper), so its internal AR camera layer can end up stuck at that initial size and
  // never show the live passthrough even once autoresizing masks resolve the outer frame.
  // Explicitly re-syncing the frame on every layout pass guarantees it always matches.
  override func layoutSubviews() {
    super.layoutSubviews()
    if let captureView = roomCaptureView as? UIView, captureView.frame != bounds {
      captureView.frame = bounds
    }
  }

  override func removeFromSuperview() {
    if #available(iOS 16.0, *), let captureView = roomCaptureView as? RoomCaptureView, isCurrentlyScanning {
      captureView.captureSession.stop()
    }
    super.removeFromSuperview()
  }

  // The session has already ended itself (successfully or with an error) by the
  // time RoomCaptureSessionDelegate.didEndWith fires — without this, isCurrentlyScanning
  // stayed stale at `true`, so a later removeFromSuperview() (e.g. React unmounting
  // this view after an error) called captureSession.stop() again on an
  // already-terminated session for no reason.
  fileprivate func markSessionEnded() {
    isCurrentlyScanning = false
  }
}

@available(iOS 16.0, *)
private class RoomCaptureDelegateProxy: NSObject, RoomCaptureSessionDelegate {
  weak var owner: ExpoRoomScannerView?

  init(owner: ExpoRoomScannerView) {
    self.owner = owner
  }

  // Matched on the bridged NSError's code/description rather than by casting to
  // RoomCaptureSession.CaptureError's own enum cases — deliberately, so this stays
  // correct even if exact case names differ across RoomPlan SDK versions (this file
  // can't be compiled/verified against the real SDK from this environment). Any error
  // that doesn't match a known case falls through to the existing generic detail dump
  // unchanged, so nothing regresses for an error type this doesn't recognize.
  private static func friendlyMessage(for nsError: NSError) -> String? {
    let description = nsError.localizedDescription.lowercased()
    if description.contains("world tracking") {
      return "Tracking lost — try scanning in a well-lit room, moving the phone more slowly, " +
        "and pointing it at furniture or walls with visible detail rather than blank surfaces."
    }
    if description.contains("scene size") || description.contains("exceed") {
      return "This room is too large for a single scan — try scanning it in smaller sections."
    }
    return nil
  }

  func captureSession(_ session: RoomCaptureSession, didEndWith data: CapturedRoomData, error: Error?) {
    owner?.markSessionEnded()

    if let error = error {
      let nsError = error as NSError
      if let friendly = RoomCaptureDelegateProxy.friendlyMessage(for: nsError) {
        owner?.onCaptureError(["message": friendly])
        return
      }
      var detail = "\(nsError.domain) (code \(nsError.code)): \(nsError.localizedDescription)"
      if let reason = nsError.localizedFailureReason {
        detail += " — reason: \(reason)"
      }
      if let suggestion = nsError.localizedRecoverySuggestion {
        detail += " — suggestion: \(suggestion)"
      }
      if !nsError.userInfo.isEmpty {
        detail += " — userInfo: \(nsError.userInfo)"
      }
      owner?.onCaptureError(["message": detail])
      return
    }

    Task {
      do {
        let roomBuilder = RoomBuilder(options: [.beautifyObjects])
        let capturedRoom = try await roomBuilder.capturedRoom(from: data)
        let openings = RoomCaptureDelegateProxy.extractOpenings(from: capturedRoom)
        await MainActor.run {
          self.owner?.onCaptureFinish(["openings": openings])
        }
      } catch {
        await MainActor.run {
          self.owner?.onCaptureError(["message": error.localizedDescription])
        }
      }
    }
  }

  // Maps RoomPlan's detected doors/windows (meters) into the plain mm payload JS expects.
  private static func extractOpenings(from room: CapturedRoom) -> [[String: Any]] {
    func toPayload(_ surface: CapturedRoom.Surface, type: String) -> [String: Any] {
      [
        "type": type,
        "widthMm": Int((surface.dimensions.x * 1000).rounded()),
        "heightMm": Int((surface.dimensions.y * 1000).rounded()),
      ]
    }
    return room.doors.map { toPayload($0, type: "door") }
      + room.windows.map { toPayload($0, type: "window") }
  }
}
