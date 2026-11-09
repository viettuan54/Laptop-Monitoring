package vn.laptopchildren.parent

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import androidx.compose.runtime.*
import vn.laptopchildren.parent.ui.ParentApp

class MainActivity : ComponentActivity() {
    private val model: ParentViewModel by viewModels()
    private var pendingAlerts by mutableStateOf(false)
    private var pendingDevice: Long? = null
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        pendingAlerts = isNotification(intent)
        pendingDevice = intent?.getStringExtra("device_id")?.toLongOrNull()
        setContent {
            LaunchedEffect(pendingAlerts, model.state.signedIn, model.state.busy) {
                if (pendingAlerts && model.state.signedIn && !model.state.busy) { model.openAlerts(pendingDevice); pendingAlerts = false }
            }
            ParentApp(model)
        }
    }
    override fun onNewIntent(intent: Intent) { super.onNewIntent(intent); setIntent(intent); pendingDevice = intent.getStringExtra("device_id")?.toLongOrNull(); pendingAlerts = isNotification(intent) }
    private fun isNotification(intent: Intent?) = intent?.getBooleanExtra("open_alerts", false) == true ||
        intent?.hasExtra("alert_id") == true || intent?.getStringExtra("route") == "alerts"
}
