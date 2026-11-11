package vn.laptopchildren.parent.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.History
import androidx.compose.material.icons.outlined.LaptopChromebook
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
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
        LazyColumn(
            Modifier.fillMaxSize().testTag("break-history-list"),
            contentPadding = PaddingValues(20.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp)
        ) {
            item {
                Surface(
                    shape = RoundedCornerShape(16.dp),
                    color = MaterialTheme.colorScheme.surface,
                    border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Surface(
                                shape = CircleShape,
                                color = MaterialTheme.colorScheme.primaryContainer,
                                modifier = Modifier.size(36.dp)
                            ) {
                                Box(contentAlignment = Alignment.Center) {
                                    Icon(Icons.Outlined.History, null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(20.dp))
                                }
                            }
                            Spacer(Modifier.width(12.dp))
                            Text("Phản hồi từ laptop của con", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                        }
                        Text(
                            "10 phản hồi gần nhất từ tất cả laptop của trẻ. Chọn “Nghỉ ngay” chưa xác nhận trẻ đã thực sự nghỉ.",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                        Column(
                            Modifier.fillMaxWidth(),
                            verticalArrangement = Arrangement.spacedBy(6.dp)
                        ) {
                            OutlinedButton(
                                onClick = vm::refreshBreakHistory,
                                enabled = !s.loading && !s.busy && s.childId != null,
                                shape = RoundedCornerShape(10.dp),
                                modifier = Modifier.testTag("break-refresh")
                            ) {
                                Icon(Icons.Outlined.Refresh, null, Modifier.size(16.dp))
                                Spacer(Modifier.width(6.dp))
                                Text("Làm mới lịch sử")
                            }
                            s.breaksUpdated?.let {
                                Text("Cập nhật: ${dateText(it)}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                        }
                        Text("Tự cập nhật mỗi 15 giây khi mở màn hình này.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        if (s.error != null && s.breaksUpdated != null) {
                            Surface(color = MaterialTheme.colorScheme.errorContainer, shape = RoundedCornerShape(8.dp)) {
                                Text(
                                    "Chưa cập nhật được. Đang giữ dữ liệu lần tải thành công gần nhất.",
                                    color = MaterialTheme.colorScheme.onErrorContainer,
                                    style = MaterialTheme.typography.bodySmall,
                                    modifier = Modifier.padding(12.dp)
                                )
                            }
                        }
                    }
                }
            }
            if (!s.loading && s.breaks.isEmpty()) item {
                Surface(
                    shape = RoundedCornerShape(14.dp),
                    color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Text(
                        when {
                            s.childId == null -> "Thêm hồ sơ trẻ để xem lịch sử nhắc nghỉ."
                            s.error != null -> "Chưa tải được lịch sử. Kiểm tra kết nối rồi chọn Làm mới lịch sử."
                            else -> "Chưa nhận được lịch sử từ Agent. Nếu lời nhắc vừa xuất hiện, hãy chờ laptop đồng bộ."
                        },
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(18.dp)
                    )
                }
            }
            items(s.breaks, key = { it.event_id }) { event ->
                Column(Modifier.fillMaxWidth()) {
                        Column(Modifier.fillMaxWidth().padding(vertical = 10.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            Text(breakReminderLabel(event.event_type), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Icon(Icons.Outlined.LaptopChromebook, null, Modifier.size(14.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
                                Spacer(Modifier.width(4.dp))
                                Text(
                                    event.device_name?.takeIf { it.isNotBlank() } ?: "Laptop #${event.device_id}",
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant
                                )
                            }
                            Text(
                                "Nhắc sau ${event.interval_minutes}p · Nghỉ: ${event.duration_minutes}p",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.primary,
                                fontWeight = FontWeight.Medium
                            )
                            Text(dateText(event.occurred_at), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                }
            }
        }
    }
}
