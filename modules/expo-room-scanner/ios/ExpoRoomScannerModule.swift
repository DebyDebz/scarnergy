import ExpoModulesCore
import RoomPlan

public class ExpoRoomScannerModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ExpoRoomScanner")

    // Capability gate: RoomPlan requires iOS 16+ and a LiDAR-equipped device.
    // JS uses this to decide whether to show the "Scan Room" entry point at all.
    Function("isSupported") { () -> Bool in
      if #available(iOS 16.0, *) {
        return RoomCaptureSession.isSupported
      }
      return false
    }

    View(ExpoRoomScannerView.self) {
      Events("onCaptureFinish", "onCaptureError")

      Prop("isScanning") { (view: ExpoRoomScannerView, isScanning: Bool) in
        view.setScanning(isScanning)
      }
    }
  }
}
