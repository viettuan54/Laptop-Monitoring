package vn.laptopchildren.parent.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import kotlinx.coroutines.delay
import vn.laptopchildren.parent.ParentViewModel
import vn.laptopchildren.parent.data.*

@Composable internal fun BreakHistoryScreen(vm: ParentViewModel) {
    val s = vm.state
    val owner = LocalLifecycleOwner.current
    LaunchedEffect(owner, s.childId) {
        owner.lifecycle.repeatOnLifecycle(Lifecycle.State.RESUMED) {
            while (true) { delay(15_000); vm.refreshBreakHistory() }
        }
    }
    Column(Modifier.fillMaxSize()) {
        if (s.children.isNotEmpty()) Selector(s.children.map { it.child_id to it.name }, s.childId, "Hồ sơ trẻ", !s.busy, vm::selectChild)
        LazyColumn(Modifier.fillMaxSize().testTag("break-history-list"), contentPadding = PaddingValues(20.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            item {
                Text("Phản hồi từ laptop của con", style = MaterialTheme.typography.titleLarge)
                Text("10 phản hồi gần nhất từ tất cả laptop của trẻ. Chọn “Nghỉ ngay” là xác nhận lời nhắc, chưa xác nhận trẻ đã nghỉ.", style = MaterialTheme.typography.bodyMedium)
                Text("Tự cập nhật mỗi 15 giây khi mở màn hình này. Khi mất kết nối, Agent gửi bù lịch sử sau khi kết nối lại.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                OutlinedButton(onClick = vm::refreshBreakHistory, enabled = !s.loading && !s.busy && s.childId != null, modifier = Modifier.testTag("break-refresh")) { Text("Làm mới lịch sử") }
                s.breaksUpdated?.let { Text("Lần tải thành công: ${dateText(it)}", style = MaterialTheme.typography.bodySmall) }
                if (s.error != null && s.breaksUpdated != null) Text("Chưa cập nhật được. Đang giữ dữ liệu lần tải thành công gần nhất.", color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium)
            }
            if (!s.loading && s.breaks.isEmpty()) item {
                Text(when {
                    s.childId == null -> "Thêm hồ sơ trẻ để xem lịch sử nhắc nghỉ."
                    s.error != null -> "Chưa tải được lịch sử. Kiểm tra kết nối rồi chọn Làm mới lịch sử."
                    else -> "Chưa nhận được lịch sử từ Agent. Nếu lời nhắc vừa xuất hiện, hãy chờ laptop đồng bộ."
                })
            }
            items(s.breaks, key = { it.event_id }) { event ->
                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text(breakReminderLabel(event.event_type), style = MaterialTheme.typography.titleMedium)
                    Text(event.device_name?.takeIf { it.isNotBlank() } ?: "Laptop #${event.device_id}", style = MaterialTheme.typography.bodyLarge)
                    Text("Nhắc sau ${event.interval_minutes} phút · Thời gian nghỉ: ${event.duration_minutes} phút", style = MaterialTheme.typography.bodyMedium)
                    Text(dateText(event.occurred_at), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    HorizontalDivider(Modifier.padding(top = 12.dp))
                }
            }
        }
    }
}
