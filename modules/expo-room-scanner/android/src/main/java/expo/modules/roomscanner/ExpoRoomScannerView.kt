package expo.modules.roomscanner

import android.content.Context
import android.view.View
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView

// Stub view: no LiDAR/RoomPlan equivalent exists on Android. isSupported() being false
// keeps JS from ever mounting this view, but it must still exist for the module to load.
class ExpoRoomScannerView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  val onCaptureFinish by EventDispatcher()
  val onCaptureError by EventDispatcher()
}
