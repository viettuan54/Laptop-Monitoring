package vn.laptopchildren.parent.data

import retrofit2.http.*

interface ParentApi {
    @GET("api/logs/screenshots") suspend fun screenshots(@Query("device_id") device: Long,
        @Query("limit") limit: Int = 12, @Query("offset") offset: Int = 0): ScreenshotPage
    @GET("api/logs/screenshots/{id}") suspend fun screenshot(@Path("id") id: Long): Screenshot
    @DELETE("api/logs/screenshots/{id}") suspend fun deleteScreenshot(@Path("id") id: Long): Message
    @POST("api/auth/login") suspend fun login(@Body body: Map<String, String>): Tokens
    @POST("api/auth/register") suspend fun register(@Body body: Map<String, String>): Message
    @POST("api/auth/forgot-password") suspend fun forgot(@Body body: Map<String, String>): Message
    @POST("api/auth/verify") suspend fun verify(@Body body: Map<String, String>): Message
    @POST("api/auth/resend-verification") suspend fun resend(@Body body: Map<String, String>): Message
    @POST("api/auth/reset-password") suspend fun resetPassword(@Body body: Map<String, String>): Message
    @POST("api/auth/logout") suspend fun logout(@Body body: Map<String, String>): Message
    @POST("api/auth/change-password") suspend fun changePassword(@Body body: Map<String, String>): Message
    @HTTP(method = "DELETE", path = "api/auth/account", hasBody = true)
    suspend fun deleteAccount(@Body body: Map<String, String>): Message
    @GET("api/children") suspend fun children(@Query("limit") limit: Int = 200, @Query("offset") offset: Int = 0): List<Child>
    @POST("api/children") suspend fun addChild(@Body body: Map<String, @JvmSuppressWildcards Any>): Child
    @PUT("api/children/{id}") suspend fun editChild(@Path("id") id: Long, @Body body: Map<String, @JvmSuppressWildcards Any>): Child
    @GET("api/devices") suspend fun devices(@Query("child_id") child: Long? = null, @Query("limit") limit: Int = 200, @Query("offset") offset: Int = 0): Page<Device>
    @GET("api/logs/usage-summary") suspend fun usage(@Query("child_id") child: Long, @Query("month") month: String): Usage
    @GET("api/logs/{kind}") suspend fun activity(@Path("kind") kind: String, @Query("device_id") device: Long,
        @Query("start") start: String, @Query("end") end: String, @Query("limit") limit: Int = 30, @Query("offset") offset: Int = 0): Page<ActivityLog>
    @GET("api/alerts") suspend fun alerts(@Query("device_id") device: Long, @Query("is_read") read: Boolean? = null,
        @Query("limit") limit: Int = 30, @Query("offset") offset: Int = 0): Page<Alert>
    @PUT("api/alerts/{id}/read") suspend fun readAlert(@Path("id") id: Long, @Body body: Map<String, String> = emptyMap()): Alert
    @GET("api/settings/{id}") suspend fun settings(@Path("id") child: Long): Settings
    @PUT("api/settings/{id}") suspend fun saveSettings(@Path("id") child: Long, @Body body: Map<String, @JvmSuppressWildcards Any>): Settings
    @GET("api/settings/{id}/policies") suspend fun policies(@Path("id") child: Long): Policies
    @PUT("api/settings/{id}/policies/{type}/{category}") suspend fun savePolicy(@Path("id") child: Long,
        @Path("type") type: String, @Path("category") category: String, @Body body: Map<String, String>): Policy
    @POST("api/notifications/tokens") suspend fun registerPush(@Body body: Map<String, String>): PushRegistration
    @DELETE("api/notifications/tokens/{id}") suspend fun removePush(@Path("id") id: Long): Message
    @POST("api/notifications/test") suspend fun testPush(@Body body: Map<String, String> = emptyMap()): Message
}
