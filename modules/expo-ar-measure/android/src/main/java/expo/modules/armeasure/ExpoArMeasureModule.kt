package expo.modules.armeasure

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

// Android stub. The ARCore equivalent (Session with vertical plane detection +
// hitTest, rendered through a GL/Filament surface such as SceneView) is a follow-up;
// until then isSupported() is false so JS never mounts this view on Android.
class ExpoArMeasureModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("ExpoArMeasure")

    Function("isSupported") { false }
    Function("isDetectorAvailable") { false }

    View(ExpoArMeasureView::class) {
      Events("onTrackingState", "onDetections", "onError")
      Prop("isActive") { _: ExpoArMeasureView, _: Boolean -> }
      Prop("detectionEnabled") { _: ExpoArMeasureView, _: Boolean -> }
      AsyncFunction("measureRect") { _: ExpoArMeasureView, _: Double, _: Double, _: Double, _: Double ->
        throw IllegalStateException("AR measurement is not available on Android yet.")
      }
    }
  }
}
