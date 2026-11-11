package vn.laptopchildren.parent

import android.app.Application
import androidx.compose.runtime.*
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.*
import retrofit2.HttpException
import java.time.LocalDate
import java.time.YearMonth
import java.time.Instant
import vn.laptopchildren.parent.data.*

data class ParentState(
    val signedIn: Boolean = false, val busy: Boolean = false, val loading: Boolean = false,
    val error: String? = null, val notice: String? = null, val children: List<Child> = emptyList(),
    val childId: Long? = null, val devices: List<Device> = emptyList(), val deviceId: Long? = null,
    val usage: Usage? = null, val settings: Settings? = null, val policies: List<Policy> = emptyList(),
    val activity: List<ActivityLog> = emptyList(), val alerts: List<Alert> = emptyList(),
    val unreadAlertCount: Int = 0,
    val breaks: List<BreakReminderEvent> = emptyList(), val breaksUpdated: String? = null, val breaksFromPolicy: Boolean = false,
    val screenshots: List<Screenshot> = emptyList(), val captureMonitor: CaptureMonitor? = null,
    val screenshot: Screenshot? = null, val imageLoading: Boolean = false, val imageError: String? = null,
    val hasMore: Boolean = false, val tab: Int = 0, val kind: String = "app", val days: Int = 1,
    val unreadOnly: Boolean = false, val updated: String? = null, val subpage: String? = null
)

class ParentViewModel(application: Application) : AndroidViewModel(application) {
    val graph = (application as ParentApplication).graph
    val advisor = AiAdvisor({ graph.aiApi }, viewModelScope, { graph.session.generation }, { failure(it) })
    var state by mutableStateOf(ParentState(signedIn = graph.session.tokens != null)); private set
    private var loadJob: Job? = null
    private var pageJob: Job? = null
    private var imageJob: Job? = null
    private var imageRevision = 0
    fun closeScreenshot() {
        imageJob?.cancel(); imageRevision++
        state = state.copy(screenshot = null, imageLoading = false, imageError = null)
    }
    fun openScreenshot(row: Screenshot) {
        closeScreenshot()
        if (row.device_id != state.deviceId || state.busy) return
        val version = imageRevision
        state = state.copy(screenshot = row, imageLoading = true)
        imageJob = viewModelScope.launch {
            try {
                val result = graph.api.screenshot(row.screenshot_id)
                check(result.device_id == row.device_id) { "Ảnh không thuộc laptop đang chọn." }
                if (version == imageRevision) state = state.copy(screenshot = result)
            } catch (t: Throwable) {
                if (t is CancellationException) throw t
                if (version == imageRevision) {
                    if (t is HttpException && t.code() == 401) failure(t)
                    else state = state.copy(imageError = if (t is HttpException && t.code() == 404)
                        "Ảnh đã bị xóa hoặc hết hạn." else "Không tải được ảnh. Hãy thử lại.")
                }
            } finally { if (version == imageRevision) state = state.copy(imageLoading = false) }
        }
    }
    fun deleteScreenshot(row: Screenshot) = action {
        if (row.device_id != state.deviceId || state.screenshots.none { it.screenshot_id == row.screenshot_id }) return@action
        graph.api.deleteScreenshot(row.screenshot_id)
        closeScreenshot()
        state = state.copy(screenshots = state.screenshots.filterNot { it.screenshot_id == row.screenshot_id }, notice = "Đã xóa ảnh khỏi máy chủ.")
        loadRows(false, revision)
    }
    fun setCapture(enabled: Boolean) = action {
        val child = state.childId ?: return@action
        val monitor = state.captureMonitor ?: return@action
        val settings = graph.api.saveSettings(child, mapOf("enable_screenshot_review" to enabled))
        state = state.copy(settings = settings, captureMonitor = monitor.copy(enabled = settings.enable_screenshot_review),
            notice = if (enabled) "Đã bật chụp cho hồ sơ này. Chờ laptop nhận cấu hình và gửi ảnh."
                else "Đã tắt chụp cho hồ sơ này. Laptop sẽ dừng khi đồng bộ; ảnh đã lưu vẫn được giữ.")
    }
    private var revision = 0
    private var lastResume = 0L
    init { if (state.signedIn) loadFamily() }
    fun clearNotice() { state = state.copy(notice = null) }
    fun dismissError() { state = state.copy(error = null) }
    private fun failure(t: Throwable) {
        if (t is CancellationException) throw t
        if (t is HttpException && t.code() == 401 && graph.session.tokens == null) {
            advisor.reset()
            closeScreenshot()
            revision++; state = ParentState(error = "Phiên đã hết hạn. Vui lòng đăng nhập lại.")
            graph.scope.launch { graph.clearExpiredPush() }
        } else state = state.copy(error = friendlyError(t), loading = false)
    }
    fun action(block: suspend () -> Unit) {
        if (state.busy) return
        closeScreenshot()
        viewModelScope.launch {
            loadJob?.cancel(); pageJob?.cancel(); revision++
            state = state.copy(busy = true, loading = false, error = null)
            try { block() } catch (t: Throwable) { failure(t) }
            finally { state = state.copy(busy = false) }
        }
    }
    fun login(email: String, password: String) = action {
        graph.login(email, password)
        advisor.reset()
        state = ParentState(signedIn = true, busy = true)
        loadFamily()
    }
    fun authAction(mode: String, email: String, password: String, name: String, token: String, done: () -> Unit) = action {
        val body = mapOf("email" to email.trim(), "password" to password, "name" to name.trim(), "token" to token.trim(), "newPassword" to password)
        when (mode) {
            "register" -> graph.api.register(body)
            "forgot" -> graph.api.forgot(mapOf("email" to email.trim()))
            "verify" -> graph.api.verify(mapOf("token" to token.trim()))
            "resend" -> graph.api.resend(mapOf("email" to email.trim(), "password" to password))
            "reset" -> graph.api.resetPassword(mapOf("token" to token.trim(), "newPassword" to password))
        }
        state = state.copy(notice = when(mode) {
            "register", "resend" -> "Kiểm tra email để xác minh tài khoản."
            "forgot" -> "Nếu email đã đăng ký, hướng dẫn đặt lại mật khẩu sẽ được gửi đến hộp thư."
            "verify" -> "Đã xác minh email. Bạn có thể đăng nhập."
            else -> "Đã cập nhật mật khẩu. Bạn có thể đăng nhập."
        }); done()
    }
    fun logout() = action {
        advisor.reset()
        loadJob?.cancel(); pageJob?.cancel(); revision++
        graph.logout(); state = ParentState()
    }
    fun loadFamily(preferChild: Long? = state.childId) {
        closeScreenshot()
        loadJob?.cancel(); pageJob?.cancel(); val rev = ++revision
        loadJob = viewModelScope.launch {
            state = state.copy(loading = true, error = null)
            try {
                val children = mutableListOf<Child>()
                do { val batch = graph.api.children(offset = children.size); children.addAll(batch) } while (batch.size == 200)
                if (rev != revision) return@launch
                val selected = children.find { it.child_id == preferChild }?.child_id ?: children.firstOrNull()?.child_id
                if (selected != state.childId) state = state.copy(usage = null, settings = null, devices = emptyList(), deviceId = null,
                    activity = emptyList(), alerts = emptyList(), unreadAlertCount = 0, breaks = emptyList(), breaksUpdated = null, screenshots = emptyList(), captureMonitor = null, policies = emptyList(), updated = null, hasMore = false)
                state = state.copy(children = children, childId = selected)
                loadChildData(selected, rev)
            } catch (t: Throwable) { if (rev == revision) failure(t) }
            finally { if (rev == revision) state = state.copy(loading = false) }
        }
    }
    fun selectChild(id: Long) {
        if (id == state.childId || state.busy) return
        advisor.bindDevice(null)
        closeScreenshot()
        loadJob?.cancel(); pageJob?.cancel(); val rev = ++revision
        state = state.copy(childId = id, deviceId = null, devices = emptyList(), usage = null, settings = null,
            policies = emptyList(), activity = emptyList(), alerts = emptyList(), unreadAlertCount = 0, breaks = emptyList(), breaksUpdated = null, screenshots = emptyList(), captureMonitor = null, hasMore = false, updated = null, error = null, loading = true)
        loadJob = viewModelScope.launch {
            try { loadChildData(id, rev) } catch (t: Throwable) { if (rev == revision) failure(t) }
            finally { if (rev == revision) state = state.copy(loading = false) }
        }
    }
    private suspend fun syncUnreadAlertCount(deviceId: Long?, rev: Int) {
        if (deviceId == null) {
            if (rev == revision) state = state.copy(unreadAlertCount = 0)
            return
        }
        runCatching {
            graph.api.alerts(deviceId, read = false, limit = 100).data.count { !it.is_read }
        }.onSuccess { count ->
            if (rev == revision) state = state.copy(unreadAlertCount = count)
        }
    }
    private suspend fun loadChildData(id: Long?, rev: Int) {
        if (state.subpage == "breaks") {
            if (id != null) loadBreakHistory(id, rev)
            else state = state.copy(breaks = emptyList(), breaksUpdated = null)
            return
        }
        if (id == null) {
            state = state.copy(devices = emptyList(), deviceId = null, usage = null, settings = null, alerts = emptyList(), unreadAlertCount = 0, activity = emptyList())
            return
        }
        val devices = mutableListOf<Device>()
        do { val batch = graph.api.devices(id, offset = devices.size).data; devices.addAll(batch) } while (batch.size == 200)
        if (rev != revision) return
        val selectedDevice = devices.find { it.device_id == state.deviceId }?.device_id ?: devices.firstOrNull()?.device_id
        if (selectedDevice != state.deviceId) {
            closeScreenshot()
            state = state.copy(activity = emptyList(), alerts = emptyList(), unreadAlertCount = 0, screenshots = emptyList(), captureMonitor = null, hasMore = false)
        }
        state = state.copy(devices = devices, deviceId = selectedDevice)
        syncUnreadAlertCount(selectedDevice, rev)
        when (state.tab) {
            0 -> {
                val usage = graph.api.usage(id, YearMonth.now(VietnamZone).toString())
                if (rev == revision) state = state.copy(usage = usage)
            }
            3 -> if (state.subpage == "policy") loadPolicy(id, rev)
        }
        if (state.tab == 1 || state.tab == 2) loadRows(false, rev)
        if (rev == revision) state = state.copy(updated = Instant.now().toString())
    }
    private suspend fun loadPolicy(id: Long, rev: Int) {
        val settings = graph.api.settings(id)
        val policies = graph.api.policies(id).policies
        if (rev == revision) state = state.copy(settings = settings, policies = policies)
    }
    fun navigate(tab: Int, subpage: String? = null) {
        if (state.busy) return
        closeScreenshot()
        loadJob?.cancel(); pageJob?.cancel(); revision++
        state = state.copy(tab = tab, subpage = subpage, loading = false, error = null, hasMore = false)
        if (subpage != "account") refresh()
    }
    fun openBreakHistory(fromPolicy: Boolean = false) {
        if (state.busy) return
        state = state.copy(breaksFromPolicy = fromPolicy)
        navigate(3, "breaks")
    }
    fun back() = navigate(if (state.subpage != null) 3 else 0,
        if (state.subpage == "breaks" && state.breaksFromPolicy) "policy" else null)
    private suspend fun loadBreakHistory(child: Long, rev: Int) {
        val rows = graph.api.breakReminders(child).data
        if (rev == revision && child == state.childId && state.subpage == "breaks")
            state = state.copy(breaks = rows, breaksUpdated = Instant.now().toString())
    }
    fun refreshBreakHistory() {
        if (!state.signedIn || state.subpage != "breaks" || state.loading || state.busy) return
        val child = state.childId ?: return
        val rev = revision
        state = state.copy(loading = true, error = null)
        pageJob = viewModelScope.launch {
            try { loadBreakHistory(child, rev) } catch (t: Throwable) { if (rev == revision) failure(t) }
            finally { if (rev == revision) state = state.copy(loading = false) }
        }
    }
    fun openAlerts(deviceId: Long? = null) {
        if (!state.signedIn) return
        closeScreenshot()
        if (deviceId == null) { navigate(2); return }
        loadJob?.cancel(); pageJob?.cancel(); val rev = ++revision
        state = state.copy(tab = 2, subpage = null, loading = true, alerts = emptyList(), error = null)
        loadJob = viewModelScope.launch {
            try {
                val children = mutableListOf<Child>()
                do { val batch = graph.api.children(offset = children.size); children.addAll(batch) } while (batch.size == 200)
                val devices = mutableListOf<Device>()
                do { val batch = graph.api.devices(offset = devices.size).data; devices.addAll(batch) } while (batch.size == 200)
                val target = devices.find { it.device_id == deviceId }
                    ?: throw IllegalStateException("Thiết bị trong thông báo không còn thuộc tài khoản này.")
                if (rev == revision) {
                    state = state.copy(children = children, childId = target.child_id, deviceId = target.device_id,
                        devices = devices.filter { it.child_id == target.child_id }, usage = null, settings = null,
                        policies = emptyList(), activity = emptyList(), screenshots = emptyList(), captureMonitor = null, unreadOnly = false, hasMore = false)
                    loadRows(false, rev)
                }
            } catch (t: Throwable) { if (rev == revision) failure(t) }
            finally { if (rev == revision) state = state.copy(loading = false) }
        }
    }
    fun selectDevice(id: Long) {
        if (state.busy || id == state.deviceId) return
        advisor.bindDevice(null)
        closeScreenshot()
        pageJob?.cancel(); loadJob?.cancel(); val rev = ++revision
        state = state.copy(deviceId = id, activity = emptyList(), alerts = emptyList(), unreadAlertCount = 0, screenshots = emptyList(), captureMonitor = null, hasMore = false)
        viewModelScope.launch { syncUnreadAlertCount(id, rev) }
        refreshRows()
    }
    fun setActivityFilter(kind: String = state.kind, days: Int = state.days) {
        if (state.busy) return
        closeScreenshot()
        pageJob?.cancel(); loadJob?.cancel(); revision++
        state = state.copy(kind = kind, days = days, activity = emptyList(), hasMore = false)
        refreshRows()
    }
    fun unreadOnly(value: Boolean) {
        pageJob?.cancel(); loadJob?.cancel(); revision++
        state = state.copy(unreadOnly = value, alerts = emptyList(), hasMore = false)
        refreshRows()
    }
    fun refresh() {
        if (!state.signedIn || state.busy) return
        if (state.children.isEmpty()) { loadFamily(); return }
        loadJob?.cancel(); pageJob?.cancel(); val rev = ++revision
        loadJob = viewModelScope.launch {
            state = state.copy(loading = true, error = null)
            try { loadChildData(state.childId, rev) } catch(t: Throwable) { if (rev == revision) failure(t) }
            finally { if (rev == revision) state = state.copy(loading = false) }
        }
    }
    fun onResume() {
        val now = System.currentTimeMillis()
        if (now - lastResume > 60_000 && !state.loading) { lastResume = now; refresh() }
    }
    fun refreshRows(more: Boolean = false) {
        if (state.busy) return
        pageJob?.cancel(); val rev = revision
        pageJob = viewModelScope.launch {
            state = state.copy(loading = true, error = null)
            try { loadRows(more, rev) } catch (t: Throwable) { if (rev == revision) failure(t) }
            finally { if (rev == revision) state = state.copy(loading = false) }
        }
    }
    private suspend fun loadRows(more: Boolean, rev: Int) {
        val device = state.deviceId ?: return
        if (state.tab == 1 && state.kind == "screenshots") {
            val offset = if (more) state.screenshots.size else 0
            val result = graph.api.screenshots(device, offset = offset)
            if (rev == revision) state = state.copy(
                screenshots = if (more) (state.screenshots + result.data).distinctBy { it.screenshot_id } else result.data,
                captureMonitor = result.devices.find { it.device_id == device }, hasMore = offset + result.data.size < result.total)
        } else if (state.tab == 1) {
            val start = LocalDate.now(VietnamZone).minusDays((state.days - 1).toLong()).atStartOfDay(VietnamZone).toInstant().toString()
            val rows = graph.api.activity(state.kind, device, start, Instant.now().toString(), offset = if (more) state.activity.size else 0).data
            if (rev == revision) state = state.copy(activity = if (more) (state.activity + rows).distinctBy { it.log_id } else rows, hasMore = rows.size == 30)
        } else if (state.tab == 2) {
            val rows = graph.api.alerts(device, if (state.unreadOnly) false else null, offset = if (more) state.alerts.size else 0).data
            if (rev == revision) {
                val combined = if (more) (state.alerts + rows).distinctBy { it.alert_id } else rows
                state = state.copy(alerts = combined, hasMore = rows.size == 30)
                syncUnreadAlertCount(device, rev)
            }
        }
        if (rev == revision) state = state.copy(updated = Instant.now().toString())
    }
    fun markRead(alert: Alert) = action {
        val rev = revision
        val updated = graph.api.readAlert(alert.alert_id)
        if (rev == revision) state = state.copy(
            alerts = state.alerts.map { if (it.alert_id == updated.alert_id) updated else it }.filter { !state.unreadOnly || !it.is_read },
            unreadAlertCount = (state.unreadAlertCount - 1).coerceAtLeast(0)
        )
    }
    fun saveChild(id: Long?, name: String, age: Int) = action {
        val body = mapOf("name" to name.trim(), "age" to age)
        val child = if (id == null) graph.api.addChild(body) else graph.api.editChild(id, body)
        state = state.copy(subpage = null, notice = "Đã lưu hồ sơ của ${child.name}.")
        loadFamily(child.child_id)
    }
    fun saveSettings(body: Map<String, Any>) = action {
        val id = state.childId ?: return@action
        val result = graph.api.saveSettings(id, body)
        if (id == state.childId) state = state.copy(settings = result,
            notice = "Đã lưu trên máy chủ. Laptop sẽ nhận thay đổi khi kết nối và đồng bộ.")
    }
    fun savePolicy(type: String, category: String, block: Boolean) = action {
        val id = state.childId ?: return@action
        graph.api.savePolicy(id, type, category, mapOf("action" to if (block) "block" else "allow"))
        val policies = graph.api.policies(id).policies
        if (id == state.childId) state = state.copy(policies = policies, notice = "Đã lưu chính sách. Laptop sẽ nhận trong lần đồng bộ tiếp theo.")
    }
    fun enablePush() = action { graph.registerPush(); state = state.copy(notice = "Đã đăng ký nhận thông báo cho điện thoại này.") }
    fun testPush() = action { graph.api.testPush(); state = state.copy(notice = "Đã gửi yêu cầu thử. Kiểm tra thông báo trên điện thoại.") }
    fun changePassword(old: String, new: String) = action {
        graph.api.changePassword(mapOf("oldPassword" to old, "newPassword" to new))
        advisor.reset()
        graph.session.clear()
        graph.clearExpiredPush()
        state = ParentState(notice = "Đã đổi mật khẩu. Vui lòng đăng nhập lại.")
    }
    fun deleteAccount(password: String) = action {
        graph.api.deleteAccount(mapOf("password" to password))
        advisor.reset()
        loadJob?.cancel(); pageJob?.cancel(); revision++
        graph.session.clear()
        graph.clearExpiredPush()
        state = ParentState(notice = "Đã xóa tài khoản và dữ liệu liên quan.")
    }
}
