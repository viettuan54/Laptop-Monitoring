package vn.laptopchildren.parent

import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.lifecycle.ViewModelProvider
import androidx.test.core.app.ApplicationProvider
import okhttp3.mockwebserver.*
import org.junit.Assert.*
import org.junit.Test
import org.junit.Rule
import org.junit.rules.ExternalResource
import org.junit.rules.RuleChain
import vn.laptopchildren.parent.data.SecureSession
import vn.laptopchildren.parent.data.Tokens
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/** Real phone + real SQLite/preferences/Keystore/UI; only HTTP is a loopback fixture. */
class OfflineLogoutTest {
    private val compose = createAndroidComposeRule<MainActivity>()
    private lateinit var graph: AppGraph
    private val server = MockWebServer()
    private var originalServer = ""
    private val requests = CopyOnWriteArrayList<RecordedRequest>()
    private val pushStarted = CountDownLatch(1)
    private val releasePush = CountDownLatch(1)
    private val logoutReceived = CountDownLatch(1)
    @Volatile private var stallPush = false
    private val fixture = object : ExternalResource() {
        override fun before() {
            val app = ApplicationProvider.getApplicationContext<ParentApplication>()
            check(app.packageName.contains(".qa.")) { "Run logout tests in an isolated QA package." }
            graph = app.graph
            check(graph.session.tokens == null) { "Do not replace an existing user's session." }
            originalServer = graph.server
            server.dispatcher = object : Dispatcher() {
                override fun dispatch(request: RecordedRequest): MockResponse {
                    requests.add(request)
                    val body = when (request.requestUrl!!.encodedPath) {
                        "/api/notifications/tokens/41" -> {
                            pushStarted.countDown()
                            if (stallPush) releasePush.await(8, TimeUnit.SECONDS)
                            return MockResponse().setSocketPolicy(SocketPolicy.DISCONNECT_AFTER_REQUEST)
                        }
                        "/api/auth/logout" -> { logoutReceived.countDown(); "{}" }
                        "/api/children" -> """[{"child_id":1,"name":"Hồ sơ kiểm thử đăng xuất","age":10}]"""
                        "/api/devices" -> """{"data":[{"device_id":1,"child_id":1,"device_name":"Laptop kiểm thử"}],"count":1}"""
                        "/api/alerts" -> """{"data":[],"count":0}"""
                        "/api/logs/usage-summary" -> """{"today_seconds":3600,"month_total_seconds":3600,"daily":[]}"""
                        else -> return MockResponse().setResponseCode(404).setBody("{}")
                    }
                    return MockResponse().setHeader("Content-Type", "application/json").setBody(body)
                }
            }
            server.start()
            graph.setServer(server.url("/").toString(), persist = false)
            graph.session.begin(Tokens("fixture-old-access", "fixture-old-refresh"))
            graph.prefs.edit().putLong("push_id", 41).putString("email", "logout@example.test").commit()
        }
        override fun after() {
            releasePush.countDown()
            graph.session.clear()
            graph.prefs.edit().remove("push_id").remove("email").commit()
            graph.setServer(originalServer, persist = false)
            server.shutdown()
        }
    }
    @get:Rule val rules: RuleChain = RuleChain.outerRule(fixture).around(compose)

    private fun model() = ViewModelProvider(compose.activity)[ParentViewModel::class.java]

    private fun clickLogout() {
        compose.waitUntil(10_000) { model().state.children.isNotEmpty() && !model().state.loading }
        compose.runOnIdle {
            assertTrue(model().state.signedIn)
            assertNotNull(model().state.usage)
            model().navigate(3, "account")
        }
        compose.onNodeWithText("Đăng xuất tài khoản").performScrollTo().performClick()
    }

    private fun assertLocallySignedOut() {
        compose.waitUntil(2_000) { !model().state.signedIn && !model().state.busy }
        compose.onNodeWithTag("sign-in").assertExists()
        compose.onNodeWithText("Hồ sơ kiểm thử đăng xuất").assertDoesNotExist()
        compose.runOnIdle {
            assertEquals(ParentState(), model().state)
            assertNull(graph.session.tokens)
            assertNull(SecureSession(graph.context).tokens)
            assertEquals(0L, graph.prefs.getLong("push_id", 0))
            assertFalse(graph.prefs.contains("email"))
            assertFalse(acceptPush(graph.session.tokens != null, graph.prefs.getLong("push_id", 0), "41"))
        }
    }

    @Test fun pushDisconnectStillClearsSessionAndPrivateUiAndSurvivesRecreation() {
        clickLogout()
        assertLocallySignedOut()
        assertTrue(pushStarted.await(3, TimeUnit.SECONDS))
        assertTrue(logoutReceived.await(5, TimeUnit.SECONDS))
        val cleanup = requests.filter { it.method != "GET" }
        assertEquals(listOf("/api/notifications/tokens/41", "/api/auth/logout"), cleanup.map { it.path })
        assertTrue(cleanup.all { it.getHeader("Authorization") == "Bearer fixture-old-access" })
        compose.activityRule.scenario.recreate()
        assertLocallySignedOut()
    }

    @Test fun unresponsivePushCannotDelayLocalLogoutOrClearALaterLogin() {
        stallPush = true
        clickLogout()
        assertTrue(pushStarted.await(3, TimeUnit.SECONDS))
        // The server has not answered yet; local logout must already be finished.
        assertLocallySignedOut()
        compose.runOnIdle { graph.session.begin(Tokens("fixture-new-access", "fixture-new-refresh")) }
        releasePush.countDown()
        assertTrue(logoutReceived.await(5, TimeUnit.SECONDS))
        compose.runOnIdle { assertEquals("fixture-new-access", graph.session.tokens?.accessToken) }
        assertEquals("Bearer fixture-old-access", requests.last { it.path == "/api/auth/logout" }.getHeader("Authorization"))
    }
}
