package vn.laptopchildren.parent

import android.content.res.Configuration
import android.graphics.Bitmap
import android.view.inputmethod.InputMethodManager
import androidx.activity.compose.setContent
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.lifecycle.ViewModelProvider
import androidx.test.core.app.ApplicationProvider
import androidx.test.platform.app.InstrumentationRegistry
import okhttp3.mockwebserver.*
import org.junit.*
import org.junit.rules.ExternalResource
import org.junit.rules.RuleChain
import java.io.File
import java.time.Instant
import java.util.concurrent.CopyOnWriteArrayList
import vn.laptopchildren.parent.ui.ParentApp

/** Isolated QA package only; never changes the real parent's data or calls the AI provider. */
class AiAdvisorFlowTest {
    private val compose = createAndroidComposeRule<MainActivity>()
    private val server = MockWebServer()
    private lateinit var graph: AppGraph
    private var originalServer = ""
    private var analyzed = false
    private var dailyRequests = 0
    private var chatRequests = 0
    private var breakReads = 0
    private val requests = CopyOnWriteArrayList<String>()
    private val fixture = object : ExternalResource() {
        override fun before() {
            val app = ApplicationProvider.getApplicationContext<ParentApplication>()
            check(app.packageName.endsWith(".qa")) { "Build with -PisolatedQa=true for AI device tests." }
            graph = app.graph
            check(graph.session.tokens == null) { "QA session must be signed out." }
            originalServer = graph.server
            server.dispatcher = object : Dispatcher() {
                override fun dispatch(request: RecordedRequest): MockResponse {
                    val path = request.requestUrl!!.encodedPath
                    requests += "${request.method} ${request.path}"
                    val now = Instant.now().toString()
                    val device = request.requestUrl!!.queryParameter("device_id") ?: "1"
                    fun analysis(id: String) = """{"analysis_id":$id,"device_id":$id,"behavior_type":"${if (analyzed) "Kết quả mới" else "Học tập"} · kiểm thử","risk_level":"low","suggestion":"Dữ liệu kiểm thử: cùng con xem lại thời gian học và nghỉ.","analyzed_at":"$now"}"""
                    val body = when {
                        path == "/api/logs/break-reminders" -> {
                            val child = request.requestUrl!!.queryParameter("child_id")
                            if (child == "2") """{"data":[]}""" else {
                                if (++breakReads == 2) return MockResponse().setResponseCode(503).setBody("{}")
                                val events = listOf("shown", "acknowledged", "snoozed").mapIndexed { index, type ->
                                    """{"event_id":${index+1},"device_id":1,"device_name":"Laptop kiểm thử 1","event_type":"$type","interval_minutes":30,"duration_minutes":5,"occurred_at":"$now"}"""
                                }.joinToString(",")
                                """{"data":[$events]}"""
                            }
                        }
                        path.endsWith("/policies") -> """{"policies":[]}"""
                        path.startsWith("/api/settings/") -> """{"child_id":2,"daily_limit_minutes":120,"allowed_start_time":"07:00:00","allowed_end_time":"21:00:00","enable_break_reminders":false}"""
                        path == "/api/auth/login" -> """{"accessToken":"fixture-ai-access","refreshToken":"fixture-ai-refresh"}"""
                        path == "/api/auth/logout" -> "{}"
                        path == "/api/children" -> """[{"child_id":1,"name":"Minh An · kiểm thử","age":10},{"child_id":2,"name":"Bảo Anh · kiểm thử","age":8}]"""
                        path == "/api/devices" -> {
                            val child = request.requestUrl!!.queryParameter("child_id") ?: "1"
                            """{"data":[{"device_id":$child,"child_id":$child,"device_name":"Laptop kiểm thử $child","online":true}],"count":1}"""
                        }
                        path == "/api/logs/usage-summary" -> """{"today_seconds":3600,"month_total_seconds":3600,"daily":[]}"""
                        path == "/api/ai-analysis" -> """{"data":[${analysis(device)}],"count":1}"""
                        path.startsWith("/api/ai-analysis/latest/") -> analysis(path.substringAfterLast('/'))
                        path.startsWith("/api/ai-analysis/analyze/") -> { analyzed = true; """{"message":"Completed"}""" }
                        path.startsWith("/api/ai-analysis/summary/") -> {
                            val period = request.requestUrl!!.queryParameter("period")!!
                            if (period == "daily" && ++dailyRequests == 1) return MockResponse().setResponseCode(503).setBody("{}")
                            val id = path.substringAfterLast('/')
                            """{"device_id":$id,"period":"$period","summary":"Báo cáo $period cho laptop $id · kiểm thử. Con dành thời gian cho học tập và giải trí. Hãy cùng con trao đổi về lịch sử dụng phù hợp."}"""
                        }
                        path == "/api/ai-analysis/chat" -> {
                            if (++chatRequests == 1) return MockResponse().setResponseCode(503).setBody("{}")
                            """{"reply":"Phản hồi kiểm thử: hãy cùng con chọn thời gian nghỉ giữa các buổi học và lắng nghe điều con muốn chia sẻ."}"""
                        }
                        else -> return MockResponse().setResponseCode(404).setBody("{}")
                    }
                    return MockResponse().setHeader("Content-Type", "application/json").setBody(body)
                }
            }
            server.start()
            graph.setServer(server.url("/").toString().replace("localhost", "127.0.0.1"), persist = false)
        }
        override fun after() {
            graph.session.clear()
            graph.prefs.edit().remove("email").remove("push_id").commit()
            graph.setServer(originalServer, persist = false)
            server.shutdown()
        }
    }
    @get:Rule val rules: RuleChain = RuleChain.outerRule(fixture).around(compose)
    private fun waitText(text: String, substring: Boolean = false) {
        compose.waitUntil(20_000) { compose.onAllNodesWithText(text, substring = substring).fetchSemanticsNodes().isNotEmpty() }
        compose.waitForIdle()
    }
    private fun capture(name: String) {
        compose.waitForIdle()
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        instrumentation.waitForIdleSync(); Thread.sleep(350)
        val bitmap = instrumentation.uiAutomation.takeScreenshot()
        val dir = File(instrumentation.targetContext.getExternalFilesDir(null), "ai-qa").apply { mkdirs() }
        File(dir, "$name.png").outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
        bitmap.recycle()
    }
    @Test fun parentReadsBreakReminderHistory() {
        lateinit var model: ParentViewModel
        compose.runOnUiThread { model = ViewModelProvider(compose.activity)[ParentViewModel::class.java] }
        if (InstrumentationRegistry.getArguments().getString("darkTheme") == "true") compose.runOnUiThread {
            compose.activity.setContent {
                val config = Configuration(LocalConfiguration.current).apply {
                    uiMode = (uiMode and Configuration.UI_MODE_NIGHT_MASK.inv()) or Configuration.UI_MODE_NIGHT_YES
                }
                CompositionLocalProvider(LocalConfiguration provides config) { ParentApp(model) }
            }
        }
        compose.onNodeWithTag("email").performTextInput("parent@example.test")
        compose.onNodeWithTag("password").performTextInput("Fixture123!")
        compose.onNodeWithTag("sign-in").performScrollTo().performClick()
        waitText("1 giờ")
        compose.onNodeWithTag("tab-3").performClick()
        compose.onNodeWithTag("family-list").performScrollToNode(hasText("Lịch sử nhắc nghỉ"))
        compose.onNodeWithText("Lịch sử nhắc nghỉ").performClick()
        compose.waitUntil(20_000) { !model.state.loading && model.state.breaks.size == 3 }
        waitText("Đã hiển thị lời nhắc")
        capture("phone-break-history")
        compose.onNodeWithTag("break-history-list").performScrollToNode(hasText("Nhắc lại sau 5 phút"))
        compose.onNodeWithText("Nhắc lại sau 5 phút").assertIsDisplayed()
        compose.onNodeWithTag("break-history-list").performScrollToNode(hasTestTag("break-refresh"))
        compose.onNodeWithTag("break-refresh").performClick()
        compose.waitUntil(20_000) { !model.state.loading && model.state.error != null }
        Assert.assertEquals(3, model.state.breaks.size)
        waitText("Chưa cập nhật được.", substring = true)
        capture("phone-break-error")
        compose.onNodeWithTag("break-refresh").performClick()
        compose.waitUntil(20_000) { !model.state.loading && model.state.error == null }
        compose.onNodeWithText("Minh An · kiểm thử").performClick()
        compose.onNodeWithText("Bảo Anh · kiểm thử").performClick()
        compose.waitUntil(20_000) { !model.state.loading && model.state.childId == 2L }
        Assert.assertTrue(model.state.breaks.isEmpty())
        waitText("Chưa nhận được lịch sử từ Agent.", substring = true)
        capture("phone-break-empty")
        // Verify the page refreshes while visible, including an empty result.
        val before = requests.count { it.startsWith("GET /api/logs/break-reminders?child_id=2") }
        compose.waitUntil(20_000) { requests.count { it.startsWith("GET /api/logs/break-reminders?child_id=2") } > before }
        compose.onNodeWithContentDescription("Quay lại").performClick()
        compose.onNodeWithTag("family-list").performScrollToNode(hasText("Chính sách sử dụng"))
        compose.onNodeWithText("Chính sách sử dụng").performClick()
        waitText("Nhắc nghỉ giải lao")
        compose.onNodeWithText("Lịch sử").performScrollTo().performClick()
        waitText("Phản hồi từ laptop của con")
        compose.onNodeWithContentDescription("Quay lại").performClick()
        waitText("Chính sách của con")
        Assert.assertEquals("policy", model.state.subpage)
    }
    @Test fun parentUsesAnalysisSummaryHistoryAndChat() {
        lateinit var model: ParentViewModel
        compose.runOnUiThread { model = ViewModelProvider(compose.activity)[ParentViewModel::class.java] }
        if (InstrumentationRegistry.getArguments().getString("darkTheme") == "true") compose.runOnUiThread {
            val vm = ViewModelProvider(compose.activity)[ParentViewModel::class.java]
            compose.activity.setContent {
                val config = Configuration(LocalConfiguration.current).apply {
                    uiMode = (uiMode and Configuration.UI_MODE_NIGHT_MASK.inv()) or Configuration.UI_MODE_NIGHT_YES
                }
                CompositionLocalProvider(LocalConfiguration provides config) { ParentApp(vm) }
            }
        }
        compose.onNodeWithTag("email").performTextInput("parent@example.test")
        compose.onNodeWithTag("password").performTextInput("Fixture123!")
        compose.onNodeWithTag("sign-in").performScrollTo().performClick()
        waitText("1 giờ")
        compose.onNodeWithTag("tab-3").performClick()
        waitText("AI Advisor")
        compose.onNodeWithText("AI Advisor").performScrollTo().performClick()
        waitText("Hiểu hoạt động của con")
        compose.waitUntil(20_000) { !model.advisor.state.loading && model.advisor.state.history.isNotEmpty() }
        compose.onNodeWithTag("ai-results").performScrollToNode(hasText("Học tập · kiểm thử"))
        waitText("Học tập · kiểm thử")
        capture("phone-ai-history")
        compose.onNodeWithTag("ai-run").performScrollTo().performClick()
        compose.waitUntil(20_000) { analyzed && model.advisor.state.task == null }
        capture("phone-ai-analysis")
        Assert.assertEquals(1, requests.count { it.startsWith("POST /api/ai-analysis/analyze/1") })
        compose.onNodeWithTag("ai-summary").performClick()
        compose.onNodeWithText("Báo cáo ngày").performScrollTo().performClick()
        compose.waitUntil(20_000) { model.advisor.state.resultError != null }
        compose.onNodeWithText("Thử lại báo cáo").performScrollTo().performClick()
        compose.waitUntil(20_000) { model.advisor.state.summary?.period == "daily" }
        compose.onNodeWithTag("ai-results").performScrollToNode(hasTestTag("ai-summary-result"))
        compose.onNodeWithTag("ai-summary-result").assertTextContains("Báo cáo daily cho laptop 1", substring = true)
        capture("phone-ai-summary")
        compose.onNodeWithText("Báo cáo tuần").performScrollTo().performClick()
        compose.waitUntil(20_000) { model.advisor.state.summary?.period == "weekly" }
        compose.onNodeWithText("Minh An · kiểm thử").performScrollTo().performClick()
        compose.onNodeWithText("Bảo Anh · kiểm thử").performClick()
        compose.waitUntil(20_000) { compose.onAllNodesWithText("Laptop kiểm thử 2").fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithTag("ai-summary-result").assertDoesNotExist()
        compose.onNodeWithText("Báo cáo tuần").performScrollTo().performClick()
        compose.waitUntil(20_000) { model.advisor.state.summary?.device_id == 2L }
        compose.onNodeWithTag("ai-chat").performClick()
        compose.onNodeWithTag("ai-question").performTextInput("Làm sao xây dựng thói quen nghỉ ngơi?")
        compose.runOnUiThread {
            compose.activity.getSystemService(InputMethodManager::class.java).hideSoftInputFromWindow(compose.activity.window.decorView.windowToken, 0)
        }
        compose.onNodeWithTag("ai-send").performClick()
        waitText("Chưa nhận được phản hồi.", substring = true)
        compose.onNodeWithTag("ai-question").assertTextContains("Làm sao xây dựng thói quen nghỉ ngơi?")
        compose.onNodeWithTag("ai-send").performClick()
        waitText("Phản hồi kiểm thử:", substring = true)
        capture("phone-ai-chat")
        Assert.assertEquals(2, chatRequests)
        compose.onNodeWithTag("ai-chat-log").performScrollToNode(hasText("Cuộc trò chuyện mới"))
        compose.onNodeWithText("Cuộc trò chuyện mới").performClick()
        compose.onNodeWithText("Bắt đầu mới").performClick()
        compose.onAllNodesWithText("Phản hồi kiểm thử:", substring = true).assertCountEquals(0)
        compose.onNodeWithContentDescription("Quay lại").performClick()
        compose.onNodeWithTag("family-list").performScrollToNode(hasText("Tài khoản phụ huynh"))
        compose.onNodeWithText("Tài khoản phụ huynh").performClick()
        waitText("Đăng xuất")
        compose.onNodeWithText("Đăng xuất").performScrollTo().performClick()
        waitText("Đăng nhập")
        Assert.assertNull(graph.session.tokens)
    }
}
