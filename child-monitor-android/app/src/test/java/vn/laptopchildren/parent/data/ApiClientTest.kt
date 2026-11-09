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
