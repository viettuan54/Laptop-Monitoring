package vn.laptopchildren.parent

import android.Manifest
import android.app.Notification
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import kotlinx.coroutines.launch

class ParentMessagingService : FirebaseMessagingService() {
    private val graph get() = (application as ParentApplication).graph
    override fun onNewToken(token: String) {
        graph.scope.launch { runCatching { graph.registerPush(token) } }
    }
    override fun onMessageReceived(message: RemoteMessage) {
        if (graph.session.tokens == null) return
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return
        // IDs are navigation hints only. Screen data is fetched through authenticated API.
        val id = message.data["alert_id"]?.toLongOrNull()
        val intent = Intent(this, MainActivity::class.java).putExtra("open_alerts", true)
            .putExtra("device_id", message.data["device_id"])
            .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        val pending = PendingIntent.getActivity(this, id?.toInt() ?: 0, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val notification = Notification.Builder(this, "alerts")
            .setSmallIcon(R.drawable.ic_notification).setContentTitle("LaptopChildren")
            .setContentText("Có cập nhật mới về hoạt động của con. Chạm để xem.")
            .setContentIntent(pending).setAutoCancel(true).setVisibility(Notification.VISIBILITY_PRIVATE).build()
        getSystemService(NotificationManager::class.java).notify(id?.toInt() ?: 1, notification)
    }
}
