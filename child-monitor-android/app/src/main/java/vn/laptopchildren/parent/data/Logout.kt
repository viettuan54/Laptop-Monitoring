package vn.laptopchildren.parent.data

import kotlinx.coroutines.CancellationException
import okhttp3.OkHttpClient
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory
import java.util.concurrent.TimeUnit

/** Cleanup uses only the signed-out credentials, never a later login or token refresh. */
internal fun createLogoutApi(base: String, accessToken: String): ParentApi {
    val client = OkHttpClient.Builder()
        .connectTimeout(5, TimeUnit.SECONDS).readTimeout(5, TimeUnit.SECONDS)
        .callTimeout(10, TimeUnit.SECONDS)
        .followRedirects(false).followSslRedirects(false)
        .addInterceptor { chain ->
            chain.proceed(chain.request().newBuilder()
                .header("Authorization", "Bearer $accessToken")
                .header("Accept", "application/json").build())
        }.build()
    return Retrofit.Builder().baseUrl(base).client(client)
        .addConverterFactory(GsonConverterFactory.create()).build().create(ParentApi::class.java)
}

internal suspend fun revokeSignedOutSession(api: ParentApi, refreshToken: String, pushId: Long) {
    // Failure to unregister push must not prevent attempting refresh-token revocation.
    if (pushId > 0) bestEffort { api.removePush(pushId) }
    bestEffort { api.logout(mapOf("refreshToken" to refreshToken)) }
}

private suspend fun bestEffort(block: suspend () -> Unit) {
    try { block() }
    catch (cancelled: CancellationException) { throw cancelled }
    catch (_: Exception) { /* Local logout is already complete; server cleanup is best effort. */ }
}
