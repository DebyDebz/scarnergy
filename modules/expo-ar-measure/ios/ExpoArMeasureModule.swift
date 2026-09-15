import ExpoModulesCore
import ARKit

// Thrown by measureRect when the AR session isn't running yet.
internal class ArNotRunningException: Exception {
  override var reason: String {
    "AR session is not running — set isActive before measuring."
  }
}

// Thrown by measureRect when a tapped point doesn't land on any vertical surface.
internal class NoSurfaceException: Exception {
  override var reason: String {
    "No wall detected under that point — move the phone slowly across the wall until it is recognised, then tap again."
  }
}

public class ExpoArMeasureModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ExpoArMeasure")

    // Capability gate: ARKit world tracking needs an A9 chip or newer (iPhone 6s+).
    // Unlike RoomPlan this does NOT need LiDAR. Reports false in the Simulator.
    Function("isSupported") { () -> Bool in
      ARWorldTrackingConfiguration.isSupported
    }

    // True only when a compiled CoreML model named OpeningDetector.mlmodelc is in the
    // app bundle. Without it the view still measures, but only in manual-tap mode.
    Function("isDetectorAvailable") { () -> Bool in
      OpeningDetector.isModelBundled
    }

    View(ExpoArMeasureView.self) {
      Events("onTrackingState", "onDetections", "onError")

      Prop("isActive") { (view: ExpoArMeasureView, active: Bool) in
        view.setActive(active)
      }

      Prop("detectionEnabled") { (view: ExpoArMeasureView, enabled: Bool) in
        view.setDetectionEnabled(enabled)
      }

      // Called from JS through the native ref. Raycasting reads ARSCNView state, so it
      // must run on the main queue.
      AsyncFunction("measureRect") { (view: ExpoArMeasureView, x1: Double, y1: Double, x2: Double, y2: Double) -> [String: Any] in
        try view.measureRect(from: CGPoint(x: x1, y: y1), to: CGPoint(x: x2, y: y2))
      }.runOnQueue(.main)
    }
  }
}
