package vn.laptopchildren.parent

import androidx.compose.runtime.*
import kotlinx.coroutines.*
import retrofit2.HttpException
import vn.laptopchildren.parent.data.*

data class AdvisorState(
    val deviceId: Long? = null, val history: List<AiAnalysis> = emptyList(),
    val loading: Boolean = false, val hasMore: Boolean = false, val historyError: String? = null,
    val task: String? = null, val resultKind: String? = null, val status: String? = null, val resultError: String? = null,
    val latest: AiAnalysis? = null, val summary: AiSummary? = null,
    val messages: List<ChatMessage> = emptyList(), val draft: String = "", val chatting: Boolean = false,
    val chatError: String? = null
)

/** Device requests are isolated from account-wide chat; neither is persisted to disk. */
class AiAdvisor(private val api: () -> ParentApi, private val scope: CoroutineScope,
    private val session: () -> Long, private val unauthorized: (Throwable) -> Unit) {
    var state by mutableStateOf(AdvisorState()); private set
    private var revision = 0
    private var chatRevision = 0
    private var historyJob: Job? = null
    private var taskJob: Job? = null
    private var chatJob: Job? = null
    private fun current(rev: Int, account: Long) = rev == revision && account == session()
    private fun authError(t: Throwable): Boolean {
        if (t is CancellationException) throw t
        if (t is HttpException && t.code() == 401) { unauthorized(t); return true }
        return false
    }
    fun leaveDevice() {
        historyJob?.cancel(); taskJob?.cancel(); revision++
        state = state.copy(loading = false, task = null, status = if (state.task == "analysis")
            "Đã ngừng chờ. Phân tích có thể vẫn chạy trên máy chủ; tải lại lịch sử để kiểm tra." else state.status)
    }
    fun bindDevice(id: Long?) {
        leaveDevice()
        if (id != state.deviceId) state = state.copy(deviceId = id, history = emptyList(), hasMore = false,
            historyError = null, latest = null, summary = null, status = null, resultError = null, resultKind = null)
        if (id != null) refreshHistory()
    }
    fun reset() {
        leaveDevice(); chatJob?.cancel(); chatRevision++
        state = AdvisorState()
    }
    fun draft(value: String) { if (!state.chatting) state = state.copy(draft = value.take(2000), chatError = null) }
    fun newConversation() {
        chatJob?.cancel(); chatRevision++
        state = state.copy(messages = emptyList(), draft = "", chatting = false, chatError = null)
    }
    fun refreshHistory(more: Boolean = false) {
        val device = state.deviceId ?: return
        if (state.loading || state.task != null) return
        val rev = revision; val account = session()
        state = state.copy(loading = true, historyError = null)
        historyJob = scope.launch {
            try {
                val offset = if (more) state.history.size else 0
                val rows = api().analyses(device, offset = offset).data
                check(rows.all { it.device_id == device }) { "Kết quả không thuộc laptop đang chọn." }
                if (current(rev, account)) state = state.copy(history = if (more)
                    (state.history + rows).distinctBy { it.analysis_id } else rows, hasMore = rows.size == 20,
                    resultError = if (state.resultKind == "analysis") null else state.resultError)
            } catch (t: Throwable) {
                if (rev == revision && !authError(t) && account == session()) state = state.copy(historyError = friendlyError(t))
            } finally { if (current(rev, account)) state = state.copy(loading = false) }
        }
    }
    fun result(kind: String) {
        if (kind !in listOf("analysis", "latest", "daily", "weekly") || state.task != null) return
        val device = state.deviceId ?: return
        historyJob?.cancel()
        val rev = ++revision; val account = session()
        state = state.copy(task = kind, resultKind = kind, loading = false, resultError = null, status = null,
            summary = if (kind == "daily" || kind == "weekly") null else state.summary,
            latest = if (kind == "latest") null else state.latest)
        taskJob = scope.launch {
            var analysisCompleted = false
            try {
                when (kind) {
                    "analysis" -> {
                        api().analyze(device)
                        analysisCompleted = true
                        if (!current(rev, account)) return@launch
                        state = state.copy(status = "Phân tích đã hoàn thành. Đang tải kết quả…")
                        val rows = api().analyses(device).data
                        check(rows.all { it.device_id == device }) { "Kết quả không thuộc laptop đang chọn." }
                        if (current(rev, account)) state = state.copy(history = rows, hasMore = rows.size == 20,
                            historyError = null, latest = rows.firstOrNull(), status = "Phân tích đã hoàn thành.")
                    }
                    "latest" -> {
                        val row = api().latestAnalysis(device)
                        check(row.device_id == device) { "Kết quả không thuộc laptop đang chọn." }
                        if (current(rev, account)) state = state.copy(latest = row)
                    }
                    else -> {
                        val summary = api().summary(device, kind)
                        check(summary.device_id == device && summary.period == kind) { "Báo cáo không khớp laptop hoặc khoảng thời gian." }
                        if (current(rev, account)) state = state.copy(summary = summary)
                    }
                }
            } catch (t: Throwable) {
                if (rev == revision && !authError(t) && account == session()) state = state.copy(resultError = when {
                    kind == "analysis" && analysisCompleted -> "Phân tích đã hoàn thành nhưng chưa tải được kết quả. Hãy tải lại lịch sử."
                    kind == "analysis" -> "Chưa xác nhận được kết quả phân tích. Tải lại lịch sử trước khi chạy lại. ${friendlyError(t)}"
                    kind == "latest" && t is HttpException && t.code() == 404 -> "Chưa có kết quả phân tích cho laptop này."
                    else -> friendlyError(t)
                }, status = null)
            } finally { if (current(rev, account)) state = state.copy(task = null) }
        }
    }
    fun send() {
        val text = state.draft.trim()
        if (state.chatting || text.isEmpty() || text.length > 2000) return
        val account = session(); val rev = chatRevision
        // At most 9 full pairs plus this question: starts with user, <=20 messages.
        // Backend rejects any individual message over 2000 characters.
        val context = (state.messages.takeLast(18) + ChatMessage("user", text))
            .map { it.copy(content = it.content.take(2000)) }
        state = state.copy(chatting = true, chatError = null)
        chatJob = scope.launch {
            try {
                val reply = api().chat(ChatRequest(context)).reply
                check(reply.isNotBlank()) { "AI chưa trả lời. Hãy thử lại." }
                if (rev == chatRevision && account == session()) state = state.copy(
                    messages = (state.messages + ChatMessage("user", text) + ChatMessage("model", reply)).takeLast(40), draft = "")
            } catch (t: Throwable) {
                if (rev == chatRevision && !authError(t) && account == session())
                    state = state.copy(chatError = "Chưa nhận được phản hồi. ${friendlyError(t)} Câu hỏi được giữ lại để gửi lại.")
            } finally { if (rev == chatRevision && account == session()) state = state.copy(chatting = false) }
        }
    }
}
