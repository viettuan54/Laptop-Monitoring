package vn.laptopchildren.parent.data

import kotlinx.coroutines.*
import okhttp3.mockwebserver.*
import org.junit.Assert.*
import org.junit.Test
import retrofit2.HttpException
import java.util.concurrent.atomic.AtomicInteger

class MemorySession : SessionStore {
    override var tokens: Tokens? = null
    override var generation: Long = 0
    override fun begin(tokens: Tokens) { synchronized(this) { generation++; this.tokens = tokens } }
    override fun clear() { synchronized(this) { generation++; tokens = null } }
}

class ApiClientTest {
    @Test fun breakHistoryUsesChildScopeAndPreservesEventMeaning() = runBlocking {
        val server = MockWebServer()
        val store = MemorySession().apply { begin(Tokens("parent", "refresh")) }
        server.enqueue(MockResponse().setBody("""{"data":[{"event_id":"9007199254740993","device_id":9,"device_name":"Laptop","event_type":"acknowledged","interval_minutes":30,"duration_minutes":5,"occurred_at":"2026-11-10T00:00:00Z"}]}"""))
        server.start()
        try {
            val row = createApi(server.url("/").toString(), store).breakReminders(7).data.single()
            val request = server.takeRequest()
            assertEquals("/api/logs/break-reminders?child_id=7", request.path)
            assertEquals("Bearer parent", request.getHeader("Authorization"))
            assertEquals(9007199254740993L, row.event_id)
            assertEquals(5, row.duration_minutes)
            assertEquals("Trẻ chọn nghỉ ngay", breakReminderLabel(row.event_type))
            assertEquals("Đã hiển thị lời nhắc", breakReminderLabel("shown"))
            assertEquals("Nhắc lại sau 5 phút", breakReminderLabel("snoozed"))
            assertEquals("Phản hồi khác", breakReminderLabel("future-type"))
        } finally { server.shutdown() }
    }
    @Test fun advisorEndpointsPreserveDevicePeriodPaginationAndChatRoles() = runBlocking {
        val server = MockWebServer()
        val store = MemorySession().apply { begin(Tokens("parent-access", "refresh")) }
        val row = """{"analysis_id":1,"device_id":7,"behavior_type":"Học tập","risk_level":"low","suggestion":"Gợi ý","analyzed_at":"2026-11-10T00:00:00Z"}"""
        server.enqueue(MockResponse().setBody("""{"data":[$row],"count":1}"""))
        server.enqueue(MockResponse().setBody(row))
        server.enqueue(MockResponse().setBody("""{"message":"complete","analysis":$row}"""))
        server.enqueue(MockResponse().setBody("""{"device_id":"7","period":"weekly","summary":"Báo cáo"}"""))
        server.enqueue(MockResponse().setBody("""{"reply":"Trả lời"}"""))
        server.start()
        try {
            val api = createApi(server.url("/").toString(), store, ai = true)
            assertEquals(7L, api.analyses(7, offset = 20).data.single().device_id)
            val history = server.takeRequest()
            assertEquals("7", history.requestUrl!!.queryParameter("device_id"))
            assertEquals("20", history.requestUrl!!.queryParameter("offset"))
            assertEquals("20", history.requestUrl!!.queryParameter("limit"))
            assertEquals("Bearer parent-access", history.getHeader("Authorization"))
            assertEquals(1L, api.latestAnalysis(7).analysis_id)
            assertEquals("/api/ai-analysis/latest/7", server.takeRequest().path)
            api.analyze(7)
            val post = server.takeRequest()
            assertEquals("POST", post.method)
            assertEquals("/api/ai-analysis/analyze/7", post.path)
            assertEquals("weekly", api.summary(7, "weekly").period)
            assertEquals("/api/ai-analysis/summary/7?period=weekly", server.takeRequest().path)
            assertEquals("Trả lời", api.chat(ChatRequest(listOf(ChatMessage("user", "Câu hỏi")))).reply)
            val chat = server.takeRequest()
            assertEquals("/api/ai-analysis/chat", chat.path)
            assertTrue(chat.body.readUtf8().contains("\"role\":\"user\""))
            assertEquals("Bearer parent-access", chat.getHeader("Authorization"))
        } finally { server.shutdown() }
    }
    @Test fun screenshotsUseAuthenticatedDeviceScopeAndSeparateImageDeleteEndpoints() = runBlocking {
        val server = MockWebServer()
        val store = MemorySession().apply { begin(Tokens("parent-access", "refresh")) }
        server.enqueue(MockResponse().setBody("""{"data":[{"screenshot_id":"9007199254740993","device_id":7,"captured_at":"2026-11-09T00:00:00Z","thumbnail_base64":"thumb"}],"total":13,"devices":[{"device_id":7,"enabled":true,"online":false}]}"""))
        server.enqueue(MockResponse().setBody("""{"screenshot_id":"9007199254740993","device_id":7,"captured_at":"2026-11-09T00:00:00Z","image_base64":"full"}"""))
        server.enqueue(MockResponse().setBody("""{"deleted":1}"""))
        server.start()
        try {
            val api = createApi(server.url("/").toString(), store)
            val page = api.screenshots(7, offset = 12)
            assertEquals(9007199254740993L, page.data.single().screenshot_id)
            assertTrue(page.devices.single().enabled)
            val list = server.takeRequest()
            assertEquals("7", list.requestUrl!!.queryParameter("device_id"))
            assertEquals("12", list.requestUrl!!.queryParameter("offset"))
            assertEquals("12", list.requestUrl!!.queryParameter("limit"))
            assertEquals("Bearer parent-access", list.getHeader("Authorization"))
            assertEquals("full", api.screenshot(page.data.single().screenshot_id).image_base64)
            assertEquals("/api/logs/screenshots/9007199254740993", server.takeRequest().path)
            api.deleteScreenshot(page.data.single().screenshot_id)
            val deletion = server.takeRequest()
            assertEquals("DELETE", deletion.method)
            assertEquals("/api/logs/screenshots/9007199254740993", deletion.path)
            assertEquals("Bearer parent-access", deletion.getHeader("Authorization"))
        } finally { server.shutdown() }
    }
    @Test fun refreshRotatesBothTokensAndRetriesOriginalRequest() = runBlocking {
        val server = MockWebServer()
        val store = MemorySession().apply { begin(Tokens("old-access", "old-refresh")) }
        server.enqueue(MockResponse().setResponseCode(401))
        server.enqueue(MockResponse().setBody("""{"accessToken":"new-access","refreshToken":"new-refresh"}"""))
        server.enqueue(MockResponse().setBody("""[{"child_id":7,"name":"An","age":9}]"""))
        server.start()
        try {
            val children = createApi(server.url("/").toString(), store).children()
            assertEquals(7L, children.single().child_id)
            assertEquals("Bearer old-access", server.takeRequest().getHeader("Authorization"))
            val refresh = server.takeRequest()
            assertEquals("/api/auth/refresh", refresh.path)
            assertTrue(refresh.body.readUtf8().contains("old-refresh"))
            assertNull(refresh.getHeader("Authorization"))
            assertEquals("Bearer new-access", server.takeRequest().getHeader("Authorization"))
            assertEquals(Tokens("new-access", "new-refresh"), store.tokens)
        } finally { server.shutdown() }
    }

    @Test fun concurrentUnauthorizedRequestsOnlyRefreshOnce() = runBlocking {
        val refreshCount = AtomicInteger()
        val server = MockWebServer()
        val store = MemorySession().apply { begin(Tokens("old", "refresh")) }
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse = when {
                request.path == "/api/auth/refresh" -> { refreshCount.incrementAndGet(); MockResponse().setBody("""{"accessToken":"new","refreshToken":"next"}""") }
                request.getHeader("Authorization") == "Bearer new" -> MockResponse().setBody("[]")
                else -> MockResponse().setResponseCode(401)
            }
        }
        server.start()
        try {
            val api = createApi(server.url("/").toString(), store)
            (1..5).map { async(Dispatchers.IO) { api.children() } }.awaitAll()
            assertEquals(1, refreshCount.get())
        } finally { server.shutdown() }
    }

    @Test fun invalidRefreshClearsSessionWithoutInfiniteRetry() = runBlocking {
        val server = MockWebServer()
        val store = MemorySession().apply { begin(Tokens("old", "bad")) }
        server.enqueue(MockResponse().setResponseCode(401)); server.enqueue(MockResponse().setResponseCode(401)); server.start()
        try {
            try { createApi(server.url("/").toString(), store).children(); fail("Expected unauthorized") } catch (e: HttpException) { assertEquals(401, e.code()) }
            assertNull(store.tokens); assertEquals(2, server.requestCount)
        } finally { server.shutdown() }
    }

    @Test fun publicLoginDoesNotSendPreviousAccountTokenOrRefreshOnRejection() = runBlocking {
        val server = MockWebServer()
        val store = MemorySession().apply { begin(Tokens("old", "refresh")) }
        server.enqueue(MockResponse().setResponseCode(401)); server.start()
        try {
            try { createApi(server.url("/").toString(), store).login(mapOf("email" to "a@example.test", "password" to "bad")); fail("Expected unauthorized") } catch (_: HttpException) { }
            assertNull(server.takeRequest().getHeader("Authorization")); assertEquals(1, server.requestCount)
            assertEquals("old", store.tokens?.accessToken)
        } finally { server.shutdown() }
    }

    @Test fun staleResponseAfterLogoutCannotRecreateSession() = runBlocking {
        val server = MockWebServer()
        val store = MemorySession().apply { begin(Tokens("old", "refresh")) }
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                store.clear()
                return MockResponse().setResponseCode(401)
            }
        }
        server.start()
        try {
            try { createApi(server.url("/").toString(), store).children(); fail("Expected unauthorized") } catch (_: HttpException) { }
            assertNull(store.tokens); assertEquals(1, server.requestCount)
        } finally { server.shutdown() }
    }

    @Test fun activityAndAlertQueriesKeepDeviceScopeAndPagination() = runBlocking {
        val server = MockWebServer()
        server.enqueue(MockResponse().setBody("""{"data":[],"count":0}""")); server.enqueue(MockResponse().setBody("""{"data":[],"count":0}""")); server.start()
        try {
            val api = createApi(server.url("/").toString(), MemorySession())
            api.activity("web", 42, "2026-11-01T17:00:00Z", "2026-11-02T17:00:00Z", offset = 30)
            api.alerts(42, false, offset = 60)
            val activity = server.takeRequest().requestUrl!!
            assertEquals("42", activity.queryParameter("device_id")); assertEquals("30", activity.queryParameter("offset"))
            assertEquals("2026-11-01T17:00:00Z", activity.queryParameter("start"))
            val alerts = server.takeRequest().requestUrl!!
            assertEquals("42", alerts.queryParameter("device_id")); assertEquals("false", alerts.queryParameter("is_read")); assertEquals("60", alerts.queryParameter("offset"))
        } finally { server.shutdown() }
    }

    @Test fun serverValidationRejectsUnsafeUrls() {
        assertEquals("https://example.test/", normalizeServer("https://example.test"))
        listOf("http://example.test", "https://user:pass@example.test", "https://example.test/api", "https://example.test?token=x").forEach {
            assertThrows(IllegalArgumentException::class.java) { normalizeServer(it) }
        }
        assertEquals("http://127.0.0.1:3900/", normalizeServer("http://127.0.0.1:3900", true))
        assertThrows(IllegalArgumentException::class.java) { normalizeServer("http://127.0.0.1:3900") }
    }

    @Test fun durationsPreserveSubMinuteAndHourBoundaries() {
        assertEquals("0 phút", durationText(0)); assertEquals("Dưới 1 phút", durationText(59))
        assertEquals("1 phút", durationText(60)); assertEquals("1 giờ", durationText(3600)); assertEquals("1 giờ 1 phút", durationText(3660))
    }
}
