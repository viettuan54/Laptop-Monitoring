package vn.laptopchildren.parent

import android.Manifest
import android.app.Notification
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.net.Uri
import java.util.UUID
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import kotlinx.coroutines.launch

class ParentMessagingService : FirebaseMessagingService() {
    private val graph get() = (application as ParentApplication).graph
    override fun onNewToken(token: String) {
        if (graph.prefs.getLong("push_id", 0) > 0) {
            val epoch = graph.session.generation
            graph.scope.launch { runCatching { graph.registerPush(token, epoch) } }
        }
    }
    override fun onMessageReceived(message: RemoteMessage) {
        if (!acceptPush(graph.session.tokens != null, graph.prefs.getLong("push_id", 0), message.data["push_token_id"])) return
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return
        // IDs are navigation hints only. Screen data is fetched through authenticated API.
        // String tags retain the complete ID. Missing IDs get a distinct notification.
        val key = notificationKey(message.data["alert_id"], message.messageId)
        val intent = Intent(this, MainActivity::class.java).putExtra("open_alerts", true)
            .setData(Uri.Builder().scheme("laptopchildren").authority("alerts").appendPath(key).build())
            .putExtra("device_id", message.data["device_id"])
            .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        val pending = PendingIntent.getActivity(this, 0, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val notification = Notification.Builder(this, "alerts")
            .setSmallIcon(R.drawable.ic_notification).setContentTitle("LaptopChildren")
            .setContentText("Có cập nhật mới về hoạt động của con. Chạm để xem.")
            .setContentIntent(pending).setAutoCancel(true).setVisibility(Notification.VISIBILITY_PRIVATE).build()
        getSystemService(NotificationManager::class.java).notify(key, 0, notification)
    }
}

internal fun notificationKey(alertId: String?, messageId: String?): String =
    alertId?.takeIf { it.isNotBlank() }?.let { "alert:$it" }
        ?: messageId?.takeIf { it.isNotBlank() }?.let { "message:$it" }
        ?: "local:${UUID.randomUUID()}"

internal fun acceptPush(signedIn: Boolean, registeredId: Long, incomingId: String?): Boolean =
    signedIn && registeredId > 0 && incomingId == registeredId.toString()
