package expo.modules.roomscanner

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

// RoomPlan is an Apple-only framework (ARKit LiDAR). There is no Android equivalent,
// so this module always reports unsupported — the JS side hides the feature entirely.
class ExpoRoomScannerModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("ExpoRoomScanner")

    Function("isSupported") { false }

    View(ExpoRoomScannerView::class) {
      Events("onCaptureFinish", "onCaptureError")
      Prop("isScanning") { _: ExpoRoomScannerView, _: Boolean -> }
    }
  }
}
