package vn.laptopchildren.parent.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.Send
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
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
        Row(
            Modifier
                .fillMaxWidth()
                .horizontalScroll(rememberScrollState())
                .padding(horizontal = 20.dp, vertical = 6.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            listOf("analysis" to "Phân tích", "summary" to "Tổng hợp", "chat" to "Trò chuyện").forEach { (key, title) ->
                FilterChip(
                    selected = section == key,
                    onClick = { section = key },
                    label = { Text(title, fontWeight = if (section == key) FontWeight.Bold else FontWeight.Normal) },
                    leadingIcon = {
                        val icon = when(key) {
                            "analysis" -> Icons.Outlined.Analytics
                            "summary" -> Icons.Outlined.Assessment
                            else -> Icons.Outlined.Chat
                        }
                        Icon(icon, null, Modifier.size(16.dp))
                    },
                    modifier = Modifier.testTag("ai-$key")
                )
            }
        }

        if (section == "chat") {
            val list = rememberLazyListState()
            LaunchedEffect(s.messages.size, s.chatError) {
                if (s.chatError != null) list.animateScrollToItem(s.messages.size + 1)
                else if (s.messages.isNotEmpty()) list.animateScrollToItem(s.messages.lastIndex + 1)
            }
            LazyColumn(
                state = list,
                modifier = Modifier.weight(1f).fillMaxWidth().testTag("ai-chat-log"),
                contentPadding = PaddingValues(20.dp),
                verticalArrangement = Arrangement.spacedBy(14.dp)
            ) {
                item {
                    Surface(
                        shape = RoundedCornerShape(16.dp),
                        color = MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.5f),
                        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Icon(Icons.Outlined.AutoAwesome, null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(18.dp))
                                Spacer(Modifier.width(8.dp))
                                Text("Cố vấn thói quen số", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                            }
                            Text(
                                "Trò chuyện chung, không tự đính kèm lịch sử laptop. Câu trả lời mang tính tham khảo.",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                            if (s.messages.isNotEmpty() || s.draft.isNotBlank()) {
                                TextButton(
                                    onClick = { clearChat = true },
                                    enabled = !s.chatting,
                                    modifier = Modifier.align(Alignment.End)
                                ) {
                                    Icon(Icons.Outlined.Refresh, null, Modifier.size(16.dp))
                                    Spacer(Modifier.width(4.dp))
                                    Text("Cuộc trò chuyện mới", style = MaterialTheme.typography.labelMedium)
                                }
                            }
                        }
                    }
                }
                items(s.messages.size) { index ->
                    val message = s.messages[index]
                    val isUser = message.role == "user"
                    Row(
                        Modifier.fillMaxWidth(),
                        horizontalArrangement = if (isUser) Arrangement.End else Arrangement.Start
                    ) {
                        Surface(
                            shape = RoundedCornerShape(
                                topStart = 16.dp,
                                topEnd = 16.dp,
                                bottomStart = if (isUser) 16.dp else 4.dp,
                                bottomEnd = if (isUser) 4.dp else 16.dp
                            ),
                            color = if (isUser) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.surface,
                            border = if (!isUser) BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant) else null,
                            shadowElevation = 1.dp,
                            modifier = Modifier.widthIn(max = 300.dp)
                        ) {
                            Column(Modifier.padding(horizontal = 14.dp, vertical = 10.dp)) {
                                Text(
                                    if (isUser) "Bạn" else "AI Advisor",
                                    style = MaterialTheme.typography.labelSmall,
                                    fontWeight = FontWeight.Bold,
                                    color = if (isUser) MaterialTheme.colorScheme.onPrimary.copy(alpha = 0.8f) else MaterialTheme.colorScheme.primary
                                )
                                Spacer(Modifier.height(4.dp))
                                SelectionContainer {
                                    Text(
                                        message.content,
                                        style = MaterialTheme.typography.bodyMedium,
                                        color = if (isUser) MaterialTheme.colorScheme.onPrimary else MaterialTheme.colorScheme.onSurface
                                    )
                                }
                            }
                        }
                    }
                }
                s.chatError?.let { error ->
                    item {
                        Surface(
                            shape = RoundedCornerShape(12.dp),
                            color = MaterialTheme.colorScheme.errorContainer,
                            modifier = Modifier.fillMaxWidth()
                        ) {
                            Text(error, color = MaterialTheme.colorScheme.onErrorContainer, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(12.dp))
                        }
                    }
                }
            }
            Surface(
                color = MaterialTheme.colorScheme.surface,
                tonalElevation = 4.dp,
                border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant)
            ) {
                Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 10.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    if (s.chatting) {
                        LinearProgressIndicator(Modifier.fillMaxWidth().height(2.dp))
                        Text("AI đang suy nghĩ…", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.primary)
                    }
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        OutlinedTextField(
                            value = s.draft,
                            onValueChange = advisor::draft,
                            placeholder = { Text("Đặt câu hỏi cho cố vấn...") },
                            shape = RoundedCornerShape(20.dp),
                            enabled = !s.chatting,
                            minLines = 1,
                            maxLines = 3,
                            modifier = Modifier.weight(1f).testTag("ai-question"),
                            colors = OutlinedTextFieldDefaults.colors(
                                focusedContainerColor = MaterialTheme.colorScheme.surface,
                                unfocusedContainerColor = MaterialTheme.colorScheme.surface
                            )
                        )
                        IconButton(
                            onClick = advisor::send,
                            enabled = !s.chatting && s.draft.isNotBlank(),
                            modifier = Modifier
                                .size(46.dp)
                                .clip(CircleShape)
                                .background(if (!s.chatting && s.draft.isNotBlank()) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.surfaceVariant)
                                .testTag("ai-send")
                        ) {
                            Icon(
                                Icons.AutoMirrored.Outlined.Send,
                                "Gửi câu hỏi",
                                tint = if (!s.chatting && s.draft.isNotBlank()) MaterialTheme.colorScheme.onPrimary else MaterialTheme.colorScheme.onSurfaceVariant,
                                modifier = Modifier.size(20.dp)
                            )
                        }
                    }
                }
            }
        } else {
            LazyColumn(
                Modifier.fillMaxSize().testTag("ai-results"),
                contentPadding = PaddingValues(bottom = 24.dp),
                verticalArrangement = Arrangement.spacedBy(14.dp)
            ) {
                item {
                    if (parent.children.isNotEmpty()) Selector(parent.children.map { it.child_id to it.name }, parent.childId, "Hồ sơ trẻ", !parent.busy, vm::selectChild)
                    if (parent.devices.isNotEmpty()) Selector(parent.devices.map { it.device_id to it.device_name }, parent.deviceId, "Laptop đang xem", !parent.busy, vm::selectDevice)
                }
                item {
                    Surface(
                        shape = RoundedCornerShape(16.dp),
                        color = MaterialTheme.colorScheme.surface,
                        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
                        modifier = Modifier.fillMaxWidth().padding(horizontal = 20.dp)
                    ) {
                        Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                            Text(if (section == "analysis") "Hiểu hoạt động của con" else "Báo cáo tóm tắt định kỳ", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                            Text("Kết quả phân tích hoạt động trên laptop đang chọn để hỗ trợ phụ huynh điều chỉnh cân đối.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            if (!ready && !parent.loading) Text("Chưa chọn laptop để phân tích. Bạn vẫn có thể dùng mục Trò chuyện.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error)
                            if (section == "analysis") {
                                Button(
                                    onClick = { advisor.result("analysis") },
                                    enabled = ready && s.task == null,
                                    shape = RoundedCornerShape(12.dp),
                                    modifier = Modifier.fillMaxWidth().height(48.dp).testTag("ai-run")
                                ) {
                                    Icon(Icons.Outlined.PlayArrow, null, Modifier.size(18.dp))
                                    Spacer(Modifier.width(8.dp))
                                    Text("Chạy phân tích mới", fontWeight = FontWeight.SemiBold)
                                }
                                TextButton(onClick = { advisor.result("latest") }, enabled = ready && s.task == null, modifier = Modifier.align(Alignment.CenterHorizontally)) {
                                    Text("Xem kết quả mới nhất")
                                }
                            } else {
                                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                                    Button(
                                        onClick = { advisor.result("daily") },
                                        enabled = ready && s.task == null,
                                        shape = RoundedCornerShape(12.dp),
                                        modifier = Modifier.weight(1f).height(46.dp)
                                    ) { Text("Báo cáo ngày", fontWeight = FontWeight.SemiBold) }
                                    OutlinedButton(
                                        onClick = { advisor.result("weekly") },
                                        enabled = ready && s.task == null,
                                        shape = RoundedCornerShape(12.dp),
                                        modifier = Modifier.weight(1f).height(46.dp)
                                    ) { Text("Báo cáo tuần", fontWeight = FontWeight.SemiBold) }
                                }
                            }
                            if (s.task != null) {
                                LinearProgressIndicator(Modifier.fillMaxWidth().height(3.dp))
                                Text(
                                    when(s.task) { "analysis" -> "Đang phân tích hoạt động…"; "latest" -> "Đang tải kết quả…"; else -> "Đang tổng hợp báo cáo…" },
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.primary
                                )
                            }
                            if (section == "analysis") s.status?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
                            val summaryOperation = s.resultKind == "daily" || s.resultKind == "weekly"
                            if ((section == "summary") == summaryOperation) s.resultError?.let {
                                Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
                                TextButton(onClick = { if (summaryOperation) advisor.result(s.resultKind!!) else advisor.refreshHistory() }, enabled = s.task == null && !s.loading) {
                                    Text(if (summaryOperation) "Thử lại báo cáo" else "Tải lại lịch sử")
                                }
                            }
                        }
                    }
                }
                if (ready && section == "summary") {
                    s.summary?.let { report ->
                        item {
                            Surface(
                                shape = RoundedCornerShape(16.dp),
                                color = MaterialTheme.colorScheme.surface,
                                border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
                                shadowElevation = 1.dp,
                                modifier = Modifier.fillMaxWidth().padding(horizontal = 20.dp)
                            ) {
                                Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                                    SectionTitle(if (report.period == "daily") "Tổng hợp ngày" else "Tổng hợp tuần")
                                    SelectionContainer {
                                        Text(report.summary, modifier = Modifier.testTag("ai-summary-result"), style = MaterialTheme.typography.bodyMedium)
                                    }
                                }
                            }
                        }
                    }
                }
                if (ready && section == "analysis") {
                    s.latest?.let { latest ->
                        item {
                            Column(Modifier.padding(horizontal = 20.dp)) {
                                SectionTitle("Kết quả phân tích mới nhất")
                                Surface(
                                    shape = RoundedCornerShape(14.dp),
                                    color = MaterialTheme.colorScheme.surface,
                                    border = BorderStroke(1.dp, MaterialTheme.colorScheme.primary.copy(alpha = 0.5f)),
                                    shadowElevation = 1.5.dp,
                                    modifier = Modifier.fillMaxWidth()
                                ) {
                                    Column(Modifier.padding(16.dp)) {
                                        AnalysisContent(latest)
                                    }
                                }
                            }
                        }
                    }
                    item {
                        Column(Modifier.padding(horizontal = 20.dp)) {
                            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                                SectionTitle("Lịch sử phân tích")
                                TextButton(onClick = { advisor.refreshHistory() }, enabled = !s.loading && s.task == null) {
                                    Icon(Icons.Outlined.Refresh, null, Modifier.size(16.dp))
                                    Spacer(Modifier.width(4.dp))
                                    Text("Tải lại")
                                }
                            }
                            if (s.loading) LinearProgressIndicator(Modifier.fillMaxWidth().height(2.dp))
                            s.historyError?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) }
                            if (!s.loading && s.historyError == null && s.history.isEmpty()) {
                                Text("Chưa có phân tích. Nhấn 'Chạy phân tích mới' để bắt đầu.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                        }
                    }
                    items(s.history, key = { it.analysis_id }) { analysis ->
                        Surface(
                            shape = RoundedCornerShape(14.dp),
                            color = MaterialTheme.colorScheme.surface,
                            border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
                            modifier = Modifier.fillMaxWidth().padding(horizontal = 20.dp)
                        ) {
                            Column(Modifier.padding(16.dp)) {
                                AnalysisContent(analysis)
                            }
                        }
                    }
                    if (s.hasMore) item {
                        TextButton(
                            onClick = { advisor.refreshHistory(true) },
                            enabled = !s.loading && s.task == null,
                            modifier = Modifier.fillMaxWidth().padding(horizontal = 20.dp)
                        ) { Text("Tải thêm phân tích", fontWeight = FontWeight.SemiBold) }
                    }
                }
            }
        }
    }
    if (clearChat) AlertDialog(
        onDismissRequest = { clearChat = false },
        title = { Text("Bắt đầu cuộc trò chuyện mới?", fontWeight = FontWeight.Bold) },
        text = { Text("Nội dung trò chuyện và câu hỏi đang soạn sẽ được xóa khỏi phiên app này.") },
        confirmButton = { TextButton(onClick = { clearChat = false; advisor.newConversation() }) { Text("Bắt đầu mới") } },
        dismissButton = { TextButton(onClick = { clearChat = false }) { Text("Hủy") } }
    )
}

@Composable private fun AnalysisContent(row: AiAnalysis) {
    val risk = when (row.risk_level.lowercase()) { "high" -> "Cao"; "medium" -> "Trung bình"; "low" -> "Thấp"; else -> "Chưa xác định" }
    val riskColor = when (row.risk_level.lowercase()) {
        "high" -> MaterialTheme.colorScheme.error
        "medium" -> MaterialTheme.colorScheme.secondary
        else -> MaterialTheme.colorScheme.primary
    }
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
            Surface(shape = RoundedCornerShape(6.dp), color = riskColor.copy(alpha = 0.15f)) {
                Text(
                    "Mức rủi ro: $risk",
                    style = MaterialTheme.typography.labelSmall,
                    color = riskColor,
                    fontWeight = FontWeight.Bold,
                    modifier = Modifier.padding(horizontal = 8.dp, vertical = 3.dp)
                )
            }
            Text(dateText(row.analyzed_at), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Text(row.behavior_type, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
        SelectionContainer {
            Text(row.suggestion, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurface)
        }
    }
}
