package vn.laptopchildren.parent.data

import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.*
import org.junit.Assert.*
import org.junit.Test

class ActivityToolsTest {
    @Test fun captureAndBulkDeleteAreDeviceScopedAndSnapshotBound() = runBlocking {
        val server = MockWebServer()
        server.start()
        try {
            val api = createApi(server.url("/").toString(), MemorySession().apply { begin(Tokens("parent", "refresh")) })
            server.enqueue(MockResponse().setResponseCode(202).setBody("""{"request_id":"req-1","online":false,"pending":true}"""))
            val pending = api.requestScreenshot(mapOf("device_id" to 7L))
            assertFalse(pending.online)
            assertTrue(pending.pending)
            val capture = server.takeRequest()
            assertEquals("POST", capture.method)
            assertEquals("/api/logs/screenshots/request", capture.path)
            assertEquals("Bearer parent", capture.getHeader("Authorization"))
            assertEquals("{\"device_id\":7}", capture.body.readUtf8())
            server.enqueue(MockResponse().setBody("""{"deleted":12}"""))
            assertEquals(12, api.deleteScreenshots(7, DeleteScreenshotsRequest("9007199254740993")).deleted)
            val clear = server.takeRequest()
            assertEquals("DELETE", clear.method)
            assertEquals("/api/logs/screenshots?device_id=7", clear.path)
            assertEquals("{\"through_id\":\"9007199254740993\",\"confirm_all\":true}", clear.body.readUtf8())
        } finally { server.shutdown() }
    }
    @Test fun enforcementRetainsOutcomesLargeIdsAndPagination() = runBlocking {
        val server = MockWebServer()
        server.start()
        try {
            server.enqueue(MockResponse().setBody("""{"data":[{"event_id":"9007199254740993","device_id":7,"app_name":"Game.exe","occurred_at":"2026-11-20T00:00:00Z","outcome":"failed","reason":"access_denied"}]}"""))
            val rows = createApi(server.url("/").toString(), MemorySession()).appEnforcement(7, "start", "end", offset = 30).data
            assertEquals(9007199254740993L, rows.single().event_id)
            assertEquals("Đóng không thành công", enforcementOutcome(rows.single().outcome))
            assertEquals("Không đủ quyền đóng ứng dụng", enforcementReason(rows.single().reason))
            val request = server.takeRequest()
            assertEquals("/api/logs/app-enforcement", request.requestUrl!!.encodedPath)
            assertEquals("7", request.requestUrl!!.queryParameter("device_id"))
            assertEquals("30", request.requestUrl!!.queryParameter("offset"))
            assertEquals("start", request.requestUrl!!.queryParameter("start"))
            assertEquals("Đã hủy yêu cầu", enforcementOutcome("cancelled"))
            assertEquals("Chưa rõ kết quả", enforcementOutcome("new"))
        } finally { server.shutdown() }
    }
}
