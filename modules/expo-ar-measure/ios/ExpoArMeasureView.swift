import ExpoModulesCore
import ARKit
import SceneKit
import UIKit
import simd

// Camera-only door/window measurement on plain ARKit world tracking (no LiDAR).
//
// The view shows the live camera feed with ARKit's own coaching overlay. JS owns the
// tap interaction: it collects two screen points (opposite corners of an opening) and
// calls measureRect(), which raycasts both onto the nearest vertical surface and
// returns the metric width/height of the rectangle they span.
//
// Unlike the RoomPlan module, this view creates and owns its ARSession directly, so
// attaching ARCoachingOverlayView here is the supported configuration (the earlier
// coaching regression was specific to RoomCaptureSession owning the session).
class ExpoArMeasureView: ExpoView, ARSessionDelegate, ARCoachingOverlayViewDelegate {
  let onTrackingState = EventDispatcher()
  let onDetections = EventDispatcher()
  let onError = EventDispatcher()

  private let sceneView = ARSCNView()
  private let coachingOverlay = ARCoachingOverlayView()
  private var isRunning = false

  private var detectionEnabled = false
  private var detector: OpeningDetector?
  private var isDetecting = false
  private var lastDetectionTimestamp: TimeInterval = 0
  // ~3 detections/sec is plenty for a hand-held preview and keeps the CPU/GPU cool.
  private let detectionInterval: TimeInterval = 0.33
  private let detectionQueue = DispatchQueue(label: "expo.armeasure.detection", qos: .userInitiated)

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    backgroundColor = .black

    sceneView.frame = bounds
    sceneView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    sceneView.automaticallyUpdatesLighting = true
    sceneView.session.delegate = self
    addSubview(sceneView)

    coachingOverlay.session = sceneView.session
    coachingOverlay.delegate = self
    coachingOverlay.goal = .verticalPlane
    coachingOverlay.activatesAutomatically = true
    coachingOverlay.frame = bounds
    coachingOverlay.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    addSubview(coachingOverlay)
  }

  // Same defensive frame sync as ExpoRoomScannerView: the view is created with a zero
  // frame before RN lays it out, and the AR camera layer must match the final bounds.
  override func layoutSubviews() {
    super.layoutSubviews()
    if sceneView.frame != bounds { sceneView.frame = bounds }
    if coachingOverlay.frame != bounds { coachingOverlay.frame = bounds }
  }

  // MARK: - Props

  func setActive(_ active: Bool) {
    guard active != isRunning else { return }
    isRunning = active

    guard ARWorldTrackingConfiguration.isSupported else {
      isRunning = false
      if active {
        onError(["message": "AR measurement is not supported on this device."])
      }
      return
    }

    if active {
      let config = ARWorldTrackingConfiguration()
      // Vertical planes are what we raycast onto; horizontal ones improve tracking
      // stability and let the raycast fall back sensibly near floors/sills.
      config.planeDetection = [.vertical, .horizontal]
      config.isLightEstimationEnabled = false
      sceneView.session.run(config, options: [.resetTracking, .removeExistingAnchors])
    } else {
      sceneView.session.pause()
    }
  }

  func setDetectionEnabled(_ enabled: Bool) {
    detectionEnabled = enabled
    if enabled && detector == nil {
      detector = OpeningDetector()
      if detector == nil {
        // Not an error: JS is expected to check isOpeningDetectorAvailable() first,
        // but stay quiet and just leave the view in manual mode if it didn't.
        detectionEnabled = false
      }
    }
  }

  override func removeFromSuperview() {
    if isRunning {
      sceneView.session.pause()
      isRunning = false
    }
    super.removeFromSuperview()
  }

  // MARK: - Measurement

  // Prefers real detected plane geometry, then the infinite extension of a detected
  // plane, then ARKit's per-frame estimate — so a tap works as soon as the wall shows
  // any recognisable detail, at the cost of a little precision on the fallbacks.
  private func worldPoint(at screenPoint: CGPoint) -> simd_float3? {
    let targets: [ARRaycastQuery.Target] = [.existingPlaneGeometry, .existingPlaneInfinite, .estimatedPlane]
    for target in targets {
      guard let query = sceneView.raycastQuery(from: screenPoint, allowing: target, alignment: .vertical) else {
        continue
      }
      if let hit = sceneView.session.raycast(query).first {
        let t = hit.worldTransform.columns.3
        return simd_float3(t.x, t.y, t.z)
      }
    }
    return nil
  }

  func measureRect(from a: CGPoint, to b: CGPoint) throws -> [String: Any] {
    guard isRunning else { throw ArNotRunningException() }
    guard let p1 = worldPoint(at: a), let p2 = worldPoint(at: b) else {
      throw NoSurfaceException()
    }

    // ARKit's world frame is gravity-aligned (+Y is up), so for two corners of an
    // opening in a vertical wall the height is the vertical delta and the width is
    // the delta projected onto the horizontal plane. This is independent of the wall's
    // yaw, so the corners don't have to be tapped in any particular order.
    let delta = p2 - p1
    let widthM = sqrt(delta.x * delta.x + delta.z * delta.z)
    let heightM = abs(delta.y)

    var distanceM: Float = 0
    if let cam = sceneView.session.currentFrame?.camera {
      let camPos = simd_float3(cam.transform.columns.3.x, cam.transform.columns.3.y, cam.transform.columns.3.z)
      let mid = (p1 + p2) * 0.5
      distanceM = simd_distance(camPos, mid)
    }

    return [
      "widthMm": Int((widthM * 1000).rounded()),
      "heightMm": Int((heightM * 1000).rounded()),
      "distanceMm": Int((distanceM * 1000).rounded()),
    ]
  }

  // MARK: - ARSessionDelegate

  func session(_ session: ARSession, cameraDidChangeTrackingState camera: ARCamera) {
    onTrackingState(ExpoArMeasureView.trackingPayload(camera.trackingState, coaching: coachingOverlay.isActive))
  }

  func session(_ session: ARSession, didFailWithError error: Error) {
    isRunning = false
    let nsError = error as NSError
    if nsError.domain == ARErrorDomain, nsError.code == ARError.Code.cameraUnauthorized.rawValue {
      onError(["message": "Camera access is required for AR measurement — enable it for Scarnergy in Settings."])
      return
    }
    onError(["message": nsError.localizedDescription])
  }

  func session(_ session: ARSession, didUpdate frame: ARFrame) {
    guard detectionEnabled, let detector = detector, !isDetecting else { return }
    guard frame.timestamp - lastDetectionTimestamp >= detectionInterval else { return }
    lastDetectionTimestamp = frame.timestamp
    isDetecting = true

    let pixelBuffer = frame.capturedImage
    let viewSize = bounds.size
    let interfaceOrientation = window?.windowScene?.interfaceOrientation ?? .portrait
    let orientation = ExpoArMeasureView.imageOrientation(for: interfaceOrientation)
    let bufferW = CGFloat(CVPixelBufferGetWidth(pixelBuffer))
    let bufferH = CGFloat(CVPixelBufferGetHeight(pixelBuffer))

    detectionQueue.async { [weak self] in
      let boxes = detector.detect(pixelBuffer: pixelBuffer, orientation: orientation)
      let payload = boxes.map {
        ExpoArMeasureView.viewRect(for: $0, bufferSize: CGSize(width: bufferW, height: bufferH),
                                   orientation: orientation, viewSize: viewSize)
      }
      DispatchQueue.main.async {
        guard let self = self else { return }
        self.isDetecting = false
        self.onDetections(["boxes": payload])
      }
    }
  }

  // MARK: - ARCoachingOverlayViewDelegate

  func coachingOverlayViewWillActivate(_ coachingOverlayView: ARCoachingOverlayView) {
    let state = sceneView.session.currentFrame?.camera.trackingState ?? .notAvailable
    onTrackingState(ExpoArMeasureView.trackingPayload(state, coaching: true))
  }

  func coachingOverlayViewDidDeactivate(_ coachingOverlayView: ARCoachingOverlayView) {
    let state = sceneView.session.currentFrame?.camera.trackingState ?? .notAvailable
    onTrackingState(ExpoArMeasureView.trackingPayload(state, coaching: false))
  }

  // MARK: - Helpers

  private static func trackingPayload(_ state: ARCamera.TrackingState, coaching: Bool) -> [String: Any] {
    switch state {
    case .normal:
      return ["state": "normal", "coaching": coaching]
    case .notAvailable:
      return ["state": "notAvailable", "coaching": coaching]
    case .limited(let reason):
      let reasonText: String
      switch reason {
      case .initializing: reasonText = "initializing"
      case .excessiveMotion: reasonText = "excessiveMotion"
      case .insufficientFeatures: reasonText = "insufficientFeatures"
      case .relocalizing: reasonText = "relocalizing"
      @unknown default: reasonText = "unknown"
      }
      return ["state": "limited", "reason": reasonText, "coaching": coaching]
    }
  }

  // ARKit's captured image is always in the sensor's native landscape orientation
  // (landscape-right). Vision needs to know how to rotate it to match what the user sees.
  private static func imageOrientation(for interface: UIInterfaceOrientation) -> CGImagePropertyOrientation {
    switch interface {
    case .landscapeRight: return .up
    case .landscapeLeft: return .down
    case .portraitUpsideDown: return .left
    default: return .right
    }
  }

  // Maps a Vision box (normalized, origin bottom-left, in the *oriented* image) into
  // view points, assuming ARSCNView's default aspect-fill of the camera image. Portrait
  // orientations rotate the buffer by 90°, which swaps its width/height.
  private static func viewRect(for box: DetectedBox, bufferSize: CGSize,
                               orientation: CGImagePropertyOrientation, viewSize: CGSize) -> [String: Any] {
    let rotated = (orientation == .right || orientation == .left)
    let imgW = rotated ? bufferSize.height : bufferSize.width
    let imgH = rotated ? bufferSize.width : bufferSize.height
    guard imgW > 0, imgH > 0, viewSize.width > 0, viewSize.height > 0 else {
      return ["label": box.label, "confidence": box.confidence, "x": 0, "y": 0, "width": 0, "height": 0]
    }

    let scale = max(viewSize.width / imgW, viewSize.height / imgH)
    let offsetX = (viewSize.width - imgW * scale) / 2
    let offsetY = (viewSize.height - imgH * scale) / 2

    // Flip Vision's bottom-left origin to UIKit's top-left before scaling.
    let topLeftY = 1 - box.rect.origin.y - box.rect.height
    let x = box.rect.origin.x * imgW * scale + offsetX
    let y = topLeftY * imgH * scale + offsetY
    let w = box.rect.width * imgW * scale
    let h = box.rect.height * imgH * scale

    return [
      "label": box.label,
      "confidence": box.confidence,
      "x": Double(x), "y": Double(y),
      "width": Double(w), "height": Double(h),
    ]
  }
}
