package expo.modules.armeasure

import android.content.Context
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView

// Stub view: exists only so the module loads; isSupported() = false keeps JS from mounting it.
class ExpoArMeasureView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  val onTrackingState by EventDispatcher()
  val onDetections by EventDispatcher()
  val onError by EventDispatcher()
}
