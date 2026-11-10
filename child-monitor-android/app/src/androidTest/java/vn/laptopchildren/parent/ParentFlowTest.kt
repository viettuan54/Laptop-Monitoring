package vn.laptopchildren.parent

import android.graphics.Bitmap
import android.content.res.Configuration
import androidx.activity.compose.setContent
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.platform.LocalConfiguration
import androidx.lifecycle.ViewModelProvider
import vn.laptopchildren.parent.ui.ParentApp
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.core.app.ApplicationProvider
import androidx.test.platform.app.InstrumentationRegistry
import okhttp3.mockwebserver.*
import org.junit.*
import org.junit.rules.ExternalResource
import org.junit.rules.RuleChain
import java.io.File
import java.time.LocalDate
import java.time.Instant
import java.util.concurrent.CopyOnWriteArrayList
import vn.laptopchildren.parent.data.VietnamZone

/** Runs against a loopback fixture server on the phone. Never creates records in the real backend. */
class ParentFlowTest {
    private val compose = createAndroidComposeRule<MainActivity>()
    private lateinit var graph: AppGraph
    private val server = MockWebServer()
    private var originalServer = ""
    private var read = false
    private var captureEnabled = false
    private var screenshotDeleted = false
    private var imageRequests = 0
    private var deleteRequests = 0
    private val fixtureImage by lazy {
        val bitmap = Bitmap.createBitmap(960, 540, Bitmap.Config.ARGB_8888)
        val canvas = android.graphics.Canvas(bitmap)
        canvas.drawColor(android.graphics.Color.rgb(23, 78, 166))
        val paint = android.graphics.Paint().apply { color = android.graphics.Color.WHITE; textSize = 40f; isAntiAlias = true }
        canvas.drawText("LAPTOP - DU LIEU KIEM THU", 48f, 100f, paint)
        canvas.drawText("Bai hoc hom nay", 48f, 200f, paint)
        val bytes = java.io.ByteArrayOutputStream()
        bitmap.compress(Bitmap.CompressFormat.JPEG, 80, bytes); bitmap.recycle()
        android.util.Base64.encodeToString(bytes.toByteArray(), android.util.Base64.NO_WRAP)
    }
    private val writes = CopyOnWriteArrayList<String>()
    private val fixture = object : ExternalResource() {
        override fun before() {
            val app = ApplicationProvider.getApplicationContext<ParentApplication>()
            graph = app.graph
            check(graph.session.tokens == null) { "Sign out of real account before device tests; no real session will be cleared by setup." }
            originalServer = graph.server
            server.dispatcher = object : Dispatcher() {
                override fun dispatch(request: RecordedRequest): MockResponse {
                    val path = request.requestUrl!!.encodedPath
                    if (request.method != "GET") writes.add("${request.method} $path ${request.body.clone().readUtf8()}")
                    val today = LocalDate.now(VietnamZone).toString()
                    val now = Instant.now().toString()
                    val daily = (6 downTo 0).joinToString(",") { i -> """{"date":"${LocalDate.now(VietnamZone).minusDays(i.toLong())}","duration_seconds":${listOf(3600, 2400, 4500, 1800, 3000, 4200, 5400)[6-i]}}""" }
                    val child = request.requestUrl!!.queryParameter("child_id") ?: "1"
                    val response = when {
                        path == "/api/logs/screenshots/101" && request.method == "DELETE" -> {
                            if (++deleteRequests == 1) return MockResponse().setResponseCode(500).setBody("""{"message":"Fixture delete failure"}""")
                            screenshotDeleted = true; """{"deleted":1}"""
                        }
                        path == "/api/logs/screenshots/101" -> {
                            if (++imageRequests == 1) return MockResponse().setResponseCode(404).setBody("{}")
                            """{"screenshot_id":101,"device_id":1,"captured_at":"$now","image_base64":"$fixtureImage"}"""
                        }
                        path == "/api/logs/screenshots" -> {
                            val selected = request.requestUrl!!.queryParameter("device_id")
                            val rows = if (!screenshotDeleted && selected == "1") """{"screenshot_id":101,"device_id":1,"captured_at":"$now","thumbnail_base64":"$fixtureImage"}""" else ""
                            """{"data":[$rows],"total":${if (rows.isEmpty()) 0 else 1},"devices":[{"device_id":1,"enabled":$captureEnabled,"online":true},{"device_id":2,"enabled":false,"online":true}]}"""
                        }
                        path == "/api/settings/1" && request.method == "PUT" && request.body.clone().readUtf8().contains("enable_screenshot_review") -> {
                            captureEnabled = request.body.clone().readUtf8().contains(":true")
                            """{"child_id":1,"enable_screenshot_review":$captureEnabled}"""
                        }
                        path == "/api/auth/login" -> """{"accessToken":"fixture-access","refreshToken":"fixture-refresh"}"""
                        path == "/api/auth/logout" -> """{"message":"Logged out"}"""
                        path == "/api/children" -> """[{"child_id":1,"name":"Minh An · kiểm thử","age":10},{"child_id":2,"name":"Bảo Anh · kiểm thử","age":8}]"""
                        path == "/api/devices" -> """{"data":[{"device_id":$child,"child_id":$child,"device_name":"Laptop kiểm thử $child","online":true,"last_seen_at":"$now"}],"count":1}"""
                        path == "/api/logs/usage-summary" -> """{"today_seconds":${if (child == "1") 5400 else 1200},"month_total_seconds":25900,"daily":[$daily]}"""
                        path == "/api/logs/app" -> """{"data":[{"log_id":1,"device_id":1,"app_name":"Study.exe","product_name":"Ứng dụng học tập · kiểm thử","category":"learning","start_time":"$now","duration_seconds":600}],"count":1}"""
                        path == "/api/logs/web" -> """{"data":[{"log_id":2,"device_id":1,"domain":"example.test","category":"education","visit_time":"$now","duration_seconds":120}],"count":1}"""
                        path.endsWith("/read") -> { read = true; """{"alert_id":11,"device_id":1,"alert_type":"text_risk","message":"Cảnh báo minh họa cho kiểm thử","is_read":true,"created_at":"$now"}""" }
                        path == "/api/alerts" -> """{"data":[{"alert_id":11,"device_id":1,"alert_type":"text_risk","message":"Cảnh báo minh họa cho kiểm thử","is_read":$read,"created_at":"$now"}],"count":1}"""
                        path.endsWith("/policies") -> """{"policies":[{"resource_type":"app","category":"learning","action":"allow"},{"resource_type":"web","category":"unsafe","action":"block"}]}"""
                        path.startsWith("/api/settings/") -> """{"child_id":1,"daily_limit_minutes":120,"allowed_start_time":"07:00:00","allowed_end_time":"21:00:00","is_locked":false,"enable_app_classification":true,"enable_web_classification":true,"enable_text_moderation":false,"enable_webcam_monitoring":false,"enable_screenshot_review":false,"enable_break_reminders":false,"break_interval_minutes":30,"break_duration_minutes":5}"""
                        else -> return MockResponse().setResponseCode(404).setBody("{}")
                    }
                    return MockResponse().setHeader("Content-Type", "application/json").setBody(response)
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

    private fun waitFor(text: String) {
        compose.waitUntil(20_000) { compose.onAllNodesWithText(text).fetchSemanticsNodes().isNotEmpty() }
        compose.waitUntil(20_000) { compose.onAllNodesWithContentDescription("Đang tải").fetchSemanticsNodes().isEmpty() }
        compose.waitForIdle()
    }
    private fun capture(name: String) {
        compose.waitForIdle()
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        instrumentation.waitForIdleSync()
        Thread.sleep(350) // Allow the device compositor to present the settled frame before capture.
        val bitmap = instrumentation.uiAutomation.takeScreenshot()
        val dir = File(instrumentation.targetContext.getExternalFilesDir(null), "qa").apply { mkdirs() }
        File(dir, "$name.png").outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
        bitmap.recycle()
    }
    @Test fun parentCanSignInSwitchChildReadActivityAndSavePolicy() {
        // MIUI can lock the OS night-mode command. Override only the test composition,
        // exercising the production dark palette without altering the real app or OS setting.
        if (InstrumentationRegistry.getArguments().getString("darkTheme") == "true") {
            compose.runOnUiThread {
                val vm = ViewModelProvider(compose.activity)[ParentViewModel::class.java]
                compose.activity.setContent {
                    val config = Configuration(LocalConfiguration.current).apply {
                        uiMode = (uiMode and Configuration.UI_MODE_NIGHT_MASK.inv()) or Configuration.UI_MODE_NIGHT_YES
                    }
                    CompositionLocalProvider(LocalConfiguration provides config) { ParentApp(vm) }
                }
            }
        }
        capture("phone-login")
        compose.onNodeWithTag("email").performTextInput("parent@example.test")
        compose.onNodeWithTag("password").performTextInput("Fixture123!")
        compose.onNodeWithTag("sign-in").performScrollTo().performClick()
        waitFor("1 giờ 30 phút")
        capture("phone-overview")
        compose.onNodeWithText("Minh An · kiểm thử").performClick()
        compose.onNodeWithText("Bảo Anh · kiểm thử").performClick()
        waitFor("20 phút")
        compose.onNodeWithText("Bảo Anh · kiểm thử").performClick()
        compose.onNodeWithText("Minh An · kiểm thử").performClick()
        waitFor("1 giờ 30 phút")
        compose.onNodeWithTag("tab-1").performClick()
        waitFor("Ứng dụng học tập · kiểm thử")
        capture("phone-activity")
        compose.onNodeWithText("Website").performClick()
        waitFor("example.test")
        compose.onNodeWithText("Ảnh màn hình").performClick()
        waitFor("Ảnh màn hình laptop")
        compose.waitUntil(10_000) { compose.onAllNodesWithTag("screenshot-101").fetchSemanticsNodes().isNotEmpty() }
        capture("phone-screenshots")
        compose.onNodeWithTag("screenshot-101").performScrollTo().performClick()
        waitFor("Đóng ảnh")
        waitFor("Ảnh đã bị xóa hoặc hết hạn.")
        compose.onNodeWithText("Thử lại").performClick()
        compose.waitUntil(10_000) { compose.onAllNodesWithText("Phóng to").fetchSemanticsNodes().any { it.config.contains(androidx.compose.ui.semantics.SemanticsProperties.Disabled).not() } }
        compose.onNodeWithText("Phóng to").performClick()
        capture("phone-screenshot-zoom")
        compose.onNodeWithText("Đặt lại").performClick()
        compose.onNodeWithText("Đóng ảnh").performClick()
        compose.onNodeWithText("Bật chụp").performScrollTo().performClick()
        compose.onNodeWithText("Hủy").performClick()
        Assert.assertFalse(captureEnabled)
        compose.onNodeWithText("Bật chụp").performClick()
        compose.onNodeWithText("Xác nhận").performClick()
        waitFor("Chụp định kỳ: đã bật")
        Assert.assertTrue(captureEnabled)
        compose.onNodeWithText("Tắt chụp").performClick()
        compose.onNodeWithText("Xác nhận").performClick()
        waitFor("Chụp định kỳ: đã tắt")
        Assert.assertFalse(captureEnabled)
        compose.onNodeWithText("Minh An · kiểm thử").performClick()
        compose.onNodeWithText("Bảo Anh · kiểm thử").performClick()
        waitFor("Chưa có ảnh cho laptop này. Khi bật chụp, ảnh sẽ xuất hiện sau khi Agent gửi lên.")
        compose.onNodeWithTag("screenshot-101").assertDoesNotExist()
        compose.onNodeWithText("Bảo Anh · kiểm thử").performClick()
        compose.onNodeWithText("Minh An · kiểm thử").performClick()
        compose.waitUntil(10_000) { compose.onAllNodesWithTag("delete-screenshot-101").fetchSemanticsNodes().isNotEmpty() }
        compose.waitUntil(10_000) { compose.onAllNodesWithContentDescription("Đang tải").fetchSemanticsNodes().isEmpty() }
        // Let the temporary capture-save snackbar clear before tapping the lower image action.
        compose.waitUntil(15_000) { compose.onAllNodesWithText("Đã tắt chụp cho hồ sơ này.", substring = true).fetchSemanticsNodes().isEmpty() }
        compose.onNodeWithTag("delete-screenshot-101").performScrollTo().performClick()
        waitFor("Xóa ảnh này?")
        compose.onNodeWithText("Hủy").performClick()
        Assert.assertFalse(screenshotDeleted)
        compose.onNodeWithTag("delete-screenshot-101").performClick()
        compose.onNodeWithTag("confirm-delete-screenshot").performClick()
        waitFor("Máy chủ đang gặp sự cố. Hãy thử lại sau.")
        Assert.assertFalse(screenshotDeleted)
        compose.onNodeWithTag("delete-screenshot-101").performScrollTo().performClick()
        compose.onNodeWithTag("confirm-delete-screenshot").performClick()
        waitFor("Chưa có ảnh cho laptop này. Khi bật chụp, ảnh sẽ xuất hiện sau khi Agent gửi lên.")
        Assert.assertTrue(screenshotDeleted)
        compose.waitUntil(15_000) { compose.onAllNodesWithText("Đã xóa ảnh khỏi máy chủ.").fetchSemanticsNodes().isEmpty() }
        compose.onNodeWithTag("tab-2").performClick()
        waitFor("Cảnh báo minh họa cho kiểm thử")
        capture("phone-alerts")
        compose.onNodeWithText("Đánh dấu đã đọc").performClick()
        waitFor("Đã đọc")
        Assert.assertTrue(read)
        compose.onNodeWithTag("tab-3").performClick()
        waitFor("Chính sách sử dụng")
        capture("phone-family")
        compose.onNodeWithText("Chính sách sử dụng").performClick()
        waitFor("Giới hạn mỗi ngày (phút)")
        capture("phone-policy")
        compose.onNodeWithText("Giới hạn mỗi ngày (phút)").performTextReplacement("90")
        compose.onNodeWithText("Lưu thời gian sử dụng").performScrollTo()
            .performSemanticsAction(androidx.compose.ui.semantics.SemanticsActions.OnClick) { it() }
        compose.waitUntil(10_000) { writes.any { it.contains("daily_limit_minutes") && it.contains("90") } }
        Assert.assertTrue(writes.any { it.startsWith("PUT /api/settings/1") && it.contains("90") })
        compose.onNodeWithContentDescription("Quay lại").performClick()
        compose.onNodeWithTag("family-list").performScrollToNode(hasText("Tài khoản phụ huynh"))
        waitFor("Tài khoản phụ huynh")
        compose.onNodeWithText("Tài khoản phụ huynh").performScrollTo().performClick()
        waitFor("Thông báo trên điện thoại")
        capture("phone-account")
        compose.onNodeWithText("Đăng xuất").performScrollTo().performClick()
        waitFor("Đăng nhập")
        Assert.assertNull(graph.session.tokens)
    }
}
