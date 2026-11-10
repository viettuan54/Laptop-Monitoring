package vn.laptopchildren.parent.ui

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import vn.laptopchildren.parent.ParentViewModel
import vn.laptopchildren.parent.data.*

@Composable internal fun AiAdvisorScreen(vm: ParentViewModel) {
    val parent = vm.state
    val advisor = vm.advisor
    val s = advisor.state
    var section by rememberSaveable { mutableStateOf("analysis") }
    var clearChat by remember { mutableStateOf(false) }
    LaunchedEffect(parent.childId, parent.deviceId) { advisor.bindDevice(parent.deviceId) }
    DisposableEffect(Unit) { onDispose { advisor.leaveDevice() } }
    val ready = parent.deviceId != null && parent.deviceId == s.deviceId && !parent.loading
    Column(Modifier.fillMaxSize()) {
        Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 20.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            listOf("analysis" to "Phân tích", "summary" to "Tổng hợp", "chat" to "Trò chuyện").forEach { (key, title) ->
                FilterChip(selected = section == key, onClick = { section = key }, label = { Text(title) }, modifier = Modifier.testTag("ai-$key"))
            }
        }
        if (section == "chat") {
            val list = rememberLazyListState()
            LaunchedEffect(s.messages.size, s.chatError) {
                if (s.chatError != null) list.animateScrollToItem(s.messages.size + 1)
                else if (s.messages.isNotEmpty()) list.animateScrollToItem(s.messages.lastIndex + 1)
            }
            LazyColumn(state = list, modifier = Modifier.weight(1f).fillMaxWidth().testTag("ai-chat-log"), contentPadding = PaddingValues(20.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                item {
                    Text("Cố vấn thói quen số", style = MaterialTheme.typography.titleLarge)
                    Text("Trò chuyện chung, không tự đính kèm lịch sử laptop. Câu trả lời AI mang tính tham khảo, không thay thế tư vấn chuyên môn.", style = MaterialTheme.typography.bodyMedium)
                    Text("Cuộc trò chuyện chỉ giữ trong phiên app. Đăng xuất hoặc đóng tiến trình sẽ xóa nội dung trên điện thoại.", style = MaterialTheme.typography.bodySmall)
                    if (s.messages.isNotEmpty() || s.draft.isNotBlank()) TextButton(onClick = { clearChat = true }, enabled = !s.chatting) { Text("Cuộc trò chuyện mới") }
                }
                items(s.messages.size) { index ->
                    val message = s.messages[index]
                    Column {
                        Text(if (message.role == "user") "Bạn" else "AI Advisor", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.primary)
                        SelectionContainer { Text(message.content, style = MaterialTheme.typography.bodyLarge) }
                    }
                }
                s.chatError?.let { error -> item { Text(error, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium) } }
            }
            Column(Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                if (s.chatting) { LinearProgressIndicator(Modifier.fillMaxWidth()); Text("Đang chờ phản hồi…", style = MaterialTheme.typography.bodySmall) }
                OutlinedTextField(value = s.draft, onValueChange = advisor::draft, label = { Text("Câu hỏi của bạn") },
                    shape = RoundedCornerShape(12.dp),
                    enabled = !s.chatting, minLines = 1, maxLines = 4, supportingText = { Text("${s.draft.length}/2000 ký tự") },
                    modifier = Modifier.fillMaxWidth().testTag("ai-question"))
                Button(onClick = advisor::send, enabled = !s.chatting && s.draft.isNotBlank(), modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("ai-send")) {
                    Text(if (s.chatting) "Đang gửi…" else "Gửi câu hỏi")
                }
            }
        } else {
            LazyColumn(Modifier.fillMaxSize().testTag("ai-results"), contentPadding = PaddingValues(bottom = 24.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                item {
                    if (parent.children.isNotEmpty()) Selector(parent.children.map { it.child_id to it.name }, parent.childId, "Hồ sơ trẻ", !parent.busy, vm::selectChild)
                    if (parent.devices.isNotEmpty()) Selector(parent.devices.map { it.device_id to it.device_name }, parent.deviceId, "Laptop đang xem", !parent.busy, vm::selectDevice)
                }
                item {
                    Column(Modifier.padding(horizontal = 20.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text(if (section == "analysis") "Hiểu hoạt động của con" else "Báo cáo tóm tắt", style = MaterialTheme.typography.titleLarge)
                        Text("Kết quả chỉ dành cho laptop đang chọn. AI có thể nhận định sai; hãy đối chiếu hoạt động và trao đổi với con.", style = MaterialTheme.typography.bodyMedium)
                        if (!ready && !parent.loading) Text("Chưa có laptop để phân tích. Bạn vẫn có thể dùng mục Trò chuyện.")
                        if (section == "analysis") {
                            Button(onClick = { advisor.result("analysis") }, enabled = ready && s.task == null,
                                modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("ai-run")) { Text("Chạy phân tích mới") }
                            TextButton(onClick = { advisor.result("latest") }, enabled = ready && s.task == null) { Text("Kết quả mới nhất") }
                        } else {
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                OutlinedButton(onClick = { advisor.result("daily") }, enabled = ready && s.task == null) { Text("Báo cáo ngày") }
                                OutlinedButton(onClick = { advisor.result("weekly") }, enabled = ready && s.task == null) { Text("Báo cáo tuần") }
                            }
                        }
                        if (s.task != null) {
                            LinearProgressIndicator(Modifier.fillMaxWidth())
                            Text(when(s.task) { "analysis" -> "Đang phân tích…"; "latest" -> "Đang tải kết quả…"; else -> "Đang tạo báo cáo…" })
                        }
                        if (section == "analysis") s.status?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
                        val summaryOperation = s.resultKind == "daily" || s.resultKind == "weekly"
                        if ((section == "summary") == summaryOperation) s.resultError?.let {
                            Text(it, color = MaterialTheme.colorScheme.error)
                            TextButton(onClick = { if (summaryOperation) advisor.result(s.resultKind!!) else advisor.refreshHistory() }, enabled = s.task == null && !s.loading) {
                                Text(if (summaryOperation) "Thử lại báo cáo" else "Tải lại lịch sử")
                            }
                        }
                    }
                }
                if (ready && section == "summary") {
                    s.summary?.let { report -> item {
                        Column(Modifier.padding(horizontal = 20.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            SectionTitle(if (report.period == "daily") "Tổng hợp ngày" else "Tổng hợp tuần")
                            SelectionContainer { Text(report.summary, modifier = Modifier.testTag("ai-summary-result"), style = MaterialTheme.typography.bodyLarge) }
                        }
                    } }
                }
                if (ready && section == "analysis") {
                    s.latest?.let { latest -> item {
                        Column(Modifier.padding(horizontal = 20.dp)) { SectionTitle("Kết quả mới nhất"); AnalysisContent(latest) }
                    } }
                    item {
                        Column(Modifier.padding(horizontal = 20.dp)) {
                            SectionTitle("Lịch sử phân tích")
                            TextButton(onClick = { advisor.refreshHistory() }, enabled = !s.loading && s.task == null) { Text("Tải lại phân tích") }
                            if (s.loading) LinearProgressIndicator(Modifier.fillMaxWidth())
                            s.historyError?.let { Text(it, color = MaterialTheme.colorScheme.error) }
                            if (!s.loading && s.historyError == null && s.history.isEmpty()) Text("Chưa có phân tích. Chọn Chạy phân tích mới để bắt đầu.")
                        }
                    }
                    items(s.history, key = { it.analysis_id }) { analysis ->
                        Column(Modifier.padding(horizontal = 20.dp)) { AnalysisContent(analysis); HorizontalDivider(Modifier.padding(top = 16.dp)) }
                    }
                    if (s.hasMore) item { TextButton(onClick = { advisor.refreshHistory(true) }, enabled = !s.loading && s.task == null, modifier = Modifier.fillMaxWidth()) { Text("Tải thêm phân tích") } }
                }
            }
        }
    }
    if (clearChat) AlertDialog(onDismissRequest = { clearChat = false }, title = { Text("Bắt đầu cuộc trò chuyện mới?") },
        text = { Text("Nội dung trò chuyện và câu hỏi đang soạn sẽ được xóa khỏi phiên app này.") },
        confirmButton = { TextButton(onClick = { clearChat = false; advisor.newConversation() }) { Text("Bắt đầu mới") } },
        dismissButton = { TextButton(onClick = { clearChat = false }) { Text("Hủy") } })
}

@Composable private fun AnalysisContent(row: AiAnalysis) {
    val risk = when (row.risk_level.lowercase()) { "high" -> "Cao"; "medium" -> "Trung bình"; "low" -> "Thấp"; else -> "Chưa xác định" }
    Text("Mức rủi ro: $risk", style = MaterialTheme.typography.labelLarge, color = if (row.risk_level.equals("high", true)) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant)
    Text(row.behavior_type, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
    SelectionContainer { Text(row.suggestion, style = MaterialTheme.typography.bodyLarge) }
    Text(dateText(row.analyzed_at), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
}
