package vn.laptopchildren.parent.data

import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.SocketPolicy
import org.junit.Assert.*
import org.junit.Test
import java.util.concurrent.TimeUnit

class LogoutTest {
    @Test fun pushNetworkFailureStillAttemptsSessionRevocation() = runBlocking {
        val server = MockWebServer()
        server.enqueue(MockResponse().setSocketPolicy(SocketPolicy.DISCONNECT_AFTER_REQUEST))
        server.enqueue(MockResponse().setBody("{}"))
        server.start()
        try {
            revokeSignedOutSession(createLogoutApi(server.url("/").toString(), "old-access"), "old-refresh", 41)
            val push = server.takeRequest(2, TimeUnit.SECONDS)!!
            assertEquals("DELETE", push.method)
            assertEquals("/api/notifications/tokens/41", push.path)
            assertEquals("Bearer old-access", push.getHeader("Authorization"))
            val logout = server.takeRequest(2, TimeUnit.SECONDS)!!
            assertEquals("/api/auth/logout", logout.path)
            assertEquals("Bearer old-access", logout.getHeader("Authorization"))
            assertTrue(logout.body.readUtf8().contains("old-refresh"))
        } finally { server.shutdown() }
    }

    @Test fun expiredOldCredentialsNeverRefreshOrModifyANewSession() = runBlocking {
        val server = MockWebServer()
        server.enqueue(MockResponse().setResponseCode(401).setBody("{}"))
        server.enqueue(MockResponse().setResponseCode(401).setBody("{}"))
        server.start()
        try {
            val store = MemorySession().apply { begin(Tokens("old-access", "old-refresh")) }
            val pair = store.tokens!!
            val cleanup = createLogoutApi(server.url("/").toString(), pair.accessToken)
            store.clear()
            store.begin(Tokens("new-access", "new-refresh"))
            revokeSignedOutSession(cleanup, pair.refreshToken, 41)
            assertEquals("Bearer old-access", server.takeRequest().getHeader("Authorization"))
            assertEquals("/api/auth/logout", server.takeRequest().path)
            assertEquals(2, server.requestCount)
            assertEquals(Tokens("new-access", "new-refresh"), store.tokens)
        } finally { server.shutdown() }
    }
}
