package vn.laptopchildren.parent.data

import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.Assert.*
import org.junit.Test
import retrofit2.HttpException
import java.time.LocalDate
import vn.laptopchildren.parent.notificationKey

class MobileFixesTest {
    @Test fun passwordsFollowBackendRules() {
        listOf("", "Ab1!", "abcdefgh1!", "Abcdefgh!", "Abcdefgh1", "Abcdefg1_", "A1!" + "x".repeat(126)).forEach {
            assertNotNull(it, passwordError(it))
        }
        assertNull(passwordError("Abcdef1!"))
        assertNull(passwordError("A1!" + "x".repeat(125)))
    }

    @Test fun backendPasswordErrorsAreActionable() = runBlocking {
        val server = MockWebServer()
        server.start()
        try {
            val api = createApi(server.url("/").toString(), MemorySession())
            for ((message, expected) in listOf(
                "Invalid old password" to "Mật khẩu hiện tại chưa đúng. Hãy nhập lại.",
                "New password must be at least 8 characters and include an uppercase letter, a number, and a special character" to PASSWORD_GUIDANCE
            )) {
                server.enqueue(MockResponse().setResponseCode(400).setBody("""{"message":"$message"}"""))
                val failure = runCatching { api.changePassword(mapOf("oldPassword" to "old", "newPassword" to "new")) }.exceptionOrNull()
                assertTrue(failure is HttpException)
                assertEquals(expected, friendlyError(failure!!))
            }
        } finally { server.shutdown() }
    }

    @Test fun chartCrossesYearBoundaryAndKeepsMonthlyTotals() = runBlocking {
        val server = MockWebServer()
        server.start()
        try {
            server.enqueue(MockResponse().setBody("""{"today_seconds":120,"month_total_seconds":180,"daily":[{"date":"2026-01-01","duration_seconds":60},{"date":"2026-01-02","duration_seconds":120}]}"""))
            server.enqueue(MockResponse().setBody("""{"month_total_seconds":9999,"daily":[{"date":"2025-12-31","duration_seconds":300}]}"""))
            val usage = loadOverviewUsage(createApi(server.url("/").toString(), MemorySession()), 7, LocalDate.parse("2026-01-02"))
            assertEquals(7, usage.daily.size)
            assertEquals("2025-12-27", usage.daily.first().date)
            assertEquals("2026-01-02", usage.daily.last().date)
            assertEquals(300L, usage.daily[4].duration_seconds)
            assertEquals(180L, usage.month_total_seconds)
            assertEquals(120L, usage.today_seconds)
            assertEquals("2026-01", server.takeRequest().requestUrl!!.queryParameter("month"))
            val previous = server.takeRequest()
            assertEquals("2025-12", previous.requestUrl!!.queryParameter("month"))
            assertEquals("7", previous.requestUrl!!.queryParameter("child_id"))
        } finally { server.shutdown() }
    }

    @Test fun chartAfterFirstWeekNeedsOnlyOneMonth() = runBlocking {
        val server = MockWebServer()
        server.start()
        try {
            server.enqueue(MockResponse().setBody("""{"daily":[]}"""))
            val usage = loadOverviewUsage(createApi(server.url("/").toString(), MemorySession()), 1, LocalDate.parse("2026-11-07"))
            assertEquals(7, usage.daily.size)
            assertEquals(1, server.requestCount)
        } finally { server.shutdown() }
    }

    @Test fun notificationKeysDoNotTruncateOrReuseMissingIds() {
        assertNotEquals(notificationKey("1", null), notificationKey("4294967297", null))
        assertNotEquals(notificationKey(null, null), notificationKey(null, null))
        assertNotEquals(notificationKey(null, "one"), notificationKey(null, "two"))
        assertEquals(notificationKey("99", "one"), notificationKey("99", "two"))
    }
}
