package vn.laptopchildren.parent

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.os.Build
import com.google.firebase.FirebaseApp
import com.google.firebase.messaging.FirebaseMessaging
import kotlinx.coroutines.*
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.tasks.await
import vn.laptopchildren.parent.data.*

class ParentApplication : Application() {
    lateinit var graph: AppGraph
    override fun onCreate() {
        super.onCreate()
        graph = AppGraph(this)
        getSystemService(NotificationManager::class.java).createNotificationChannel(
            NotificationChannel("alerts", "Cảnh báo của con", NotificationManager.IMPORTANCE_HIGH).apply {
                description = "Thông báo về hoạt động sử dụng laptop của con"
                lockscreenVisibility = android.app.Notification.VISIBILITY_PRIVATE
            })
    }
}

class AppGraph(val context: Context) {
    val session = SecureSession(context)
    val prefs = context.getSharedPreferences("preferences", Context.MODE_PRIVATE)
    val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val authLock = Mutex()
    var server: String = prefs.getString("server", BuildConfig.API_BASE_URL) ?: BuildConfig.API_BASE_URL
        private set
    var api = createApi(server, session)
        private set
    val firebaseReady: Boolean get() = FirebaseApp.getApps(context).isNotEmpty()
    fun setServer(value: String, persist: Boolean = true) {
        check(session.tokens == null) { "Đăng xuất trước khi đổi máy chủ." }
        server = normalizeServer(value, BuildConfig.DEBUG)
        if (persist) check(prefs.edit().putString("server", server).commit()) { "Không lưu được địa chỉ máy chủ." }
        api = createApi(server, session)
    }
    suspend fun registerPush(tokenOverride: String? = null) = authLock.withLock {
        check(firebaseReady) { "Bản cài này chưa có cấu hình Firebase. Danh sách cảnh báo vẫn hoạt động khi mở app." }
        if (session.tokens == null) return@withLock
        val epoch = session.generation
        val messaging = FirebaseMessaging.getInstance()
        messaging.isAutoInitEnabled = true
        val token = tokenOverride ?: messaging.token.await()
        val registration = api.registerPush(mapOf("provider" to "fcm", "platform" to "android", "token" to token,
            "device_name" to "${Build.MANUFACTURER} ${Build.MODEL}".take(100)))
        if (session.generation == epoch) prefs.edit().putLong("push_id", registration.token.push_token_id).apply()
    }
    suspend fun login(email: String, password: String) = authLock.withLock {
        val pair = api.login(mapOf("email" to email.trim(), "password" to password))
        check(pair.accessToken.isNotBlank() && pair.refreshToken.isNotBlank()) { "Ứng dụng dành cho tài khoản phụ huynh. Hãy dùng website để đăng nhập quản trị." }
        session.begin(pair)
        prefs.edit().putString("email", email.trim()).apply()
    }
    suspend fun logout() = authLock.withLock {
        val pushId = prefs.getLong("push_id", 0)
        if (pushId > 0 && session.tokens != null) api.removePush(pushId)
        if (firebaseReady) {
            FirebaseMessaging.getInstance().isAutoInitEnabled = false
            runCatching { FirebaseMessaging.getInstance().deleteToken().await() }
        }
        session.tokens?.let { pair -> runCatching { api.logout(mapOf("refreshToken" to pair.refreshToken)) } }
        session.clear()
        prefs.edit().remove("push_id").remove("email").apply()
        context.getSystemService(NotificationManager::class.java).cancelAll()
    }
    suspend fun clearExpiredPush() = authLock.withLock {
        // A later successful login wins over cleanup queued by an older request.
        if (session.tokens != null) return@withLock
        context.getSystemService(NotificationManager::class.java).cancelAll()
        if (firebaseReady) {
            FirebaseMessaging.getInstance().isAutoInitEnabled = false
            runCatching { withTimeout(15_000) { FirebaseMessaging.getInstance().deleteToken().await() } }
        }
        prefs.edit().remove("push_id").remove("email").apply()
    }
}
