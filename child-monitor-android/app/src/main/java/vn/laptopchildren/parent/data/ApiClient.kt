package vn.laptopchildren.parent.data

import com.google.gson.Gson
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory
import retrofit2.HttpException
import java.io.IOException
import java.util.concurrent.TimeUnit

data class SessionGeneration(val value: Long)
private val publicPaths = setOf("login", "register", "forgot-password", "reset-password", "verify", "resend-verification", "refresh")

fun normalizeServer(input: String, debug: Boolean = false): String {
    val url = input.trim().toHttpUrlOrNull() ?: throw IllegalArgumentException("Địa chỉ máy chủ không hợp lệ.")
    require(url.username.isEmpty() && url.password.isEmpty() && url.query == null && url.fragment == null) { "Địa chỉ không được chứa tài khoản, tham số hoặc fragment." }
    require(url.isHttps || (debug && url.host in setOf("127.0.0.1", "localhost", "10.0.2.2"))) { "Máy chủ phải sử dụng HTTPS." }
    require(url.encodedPath == "/") { "Nhập tên miền máy chủ, không kèm /api." }
    return url.toString()
}

class RefreshAuthenticator(private val store: SessionStore, private val base: String,
    private val rawClient: OkHttpClient) : Authenticator {
    override fun authenticate(route: Route?, response: Response): Request? = synchronized(store) {
        if (response.priorResponse != null) return null
        if (response.request.tag(SessionGeneration::class.java)?.value != store.generation) return null
        val current = store.tokens ?: return null
        val used = response.request.header("Authorization")
        if (used != "Bearer ${current.accessToken}") return response.request.newBuilder()
            .header("Authorization", "Bearer ${current.accessToken}").build()
        try {
            val request = Request.Builder().url("${base}api/auth/refresh")
                .post(Gson().toJson(mapOf("refreshToken" to current.refreshToken)).toRequestBody("application/json".toMediaType())).build()
            rawClient.newCall(request).execute().use { refresh ->
                if (refresh.code == 401) { store.clear(); return null }
                if (!refresh.isSuccessful) return null
                val pair = Gson().fromJson(refresh.body?.string(), Tokens::class.java)
                if (pair == null || pair.accessToken.isBlank() || pair.refreshToken.isBlank()) return null
                store.tokens = pair
                return response.request.newBuilder().header("Authorization", "Bearer ${pair.accessToken}").build()
            }
        } catch (_: IOException) { return null }
    }
}

fun createApi(base: String, store: SessionStore, ai: Boolean = false): ParentApi {
    val raw = OkHttpClient.Builder().connectTimeout(15, TimeUnit.SECONDS).readTimeout(if (ai) 90 else 25, TimeUnit.SECONDS)
        .callTimeout(if (ai) 100 else 35, TimeUnit.SECONDS).followRedirects(false).followSslRedirects(false).build()
    val authenticated = raw.newBuilder().addInterceptor { chain ->
        val request = chain.request()
        val public = request.url.encodedPath.startsWith("/api/auth/") && request.url.pathSegments.last() in publicPaths
        val next = synchronized(store) {
            request.newBuilder().header("Accept", "application/json").apply {
                if (!public) {
                    tag(SessionGeneration::class.java, SessionGeneration(store.generation))
                    store.tokens?.let { header("Authorization", "Bearer ${it.accessToken}") }
                }
            }.build()
        }
        chain.proceed(next)
    }.authenticator(RefreshAuthenticator(store, base, raw)).build()
    return Retrofit.Builder().baseUrl(base).client(authenticated).addConverterFactory(GsonConverterFactory.create()).build().create(ParentApi::class.java)
}

fun friendlyError(error: Throwable): String {
    if (error is HttpException) {
        val message = runCatching { Gson().fromJson(error.response()?.errorBody()?.string(), Message::class.java)?.message }.getOrNull().orEmpty()
        return when {
            message.contains("Email not verified", true) -> "Email chưa được xác minh. Kiểm tra hộp thư hoặc gửi lại email xác minh."
            message.contains("Invalid email or password", true) -> "Email hoặc mật khẩu chưa đúng."
            message.contains("already registered to another", true) -> "Điện thoại còn liên kết thông báo với tài khoản khác. Hãy đăng xuất tài khoản cũ trước."
            error.code() == 401 -> "Phiên đăng nhập không còn hợp lệ. Vui lòng đăng nhập lại."
            error.code() == 403 -> "Tài khoản không có quyền thực hiện thao tác này."
            error.code() == 404 -> "Dữ liệu không còn tồn tại. Hãy tải lại."
            error.code() == 429 -> "Bạn thao tác quá nhanh. Vui lòng chờ một lúc rồi thử lại."
            error.code() >= 500 -> "Máy chủ đang gặp sự cố. Hãy thử lại sau."
            else -> "Không thể thực hiện yêu cầu. Kiểm tra thông tin và thử lại."
        }
    }
    return if (error is IOException) "Không kết nối được máy chủ. Kiểm tra Internet và thử lại."
    else error.message ?: "Có lỗi xảy ra. Hãy thử lại."
}
