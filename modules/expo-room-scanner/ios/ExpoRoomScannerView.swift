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

  override func removeFromSuperview() {
    if #available(iOS 16.0, *), let captureView = roomCaptureView as? RoomCaptureView, isCurrentlyScanning {
      captureView.captureSession.stop()
    }
    super.removeFromSuperview()
  }
}

@available(iOS 16.0, *)
private class RoomCaptureDelegateProxy: NSObject, RoomCaptureSessionDelegate {
  weak var owner: ExpoRoomScannerView?

  init(owner: ExpoRoomScannerView) {
    self.owner = owner
  }

  func captureSession(_ session: RoomCaptureSession, didEndWith data: CapturedRoomData, error: Error?) {
    if let error = error {
      owner?.onCaptureError(["message": error.localizedDescription])
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
