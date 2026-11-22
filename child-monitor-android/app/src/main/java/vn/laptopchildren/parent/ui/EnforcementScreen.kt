package vn.laptopchildren.parent.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import vn.laptopchildren.parent.ParentViewModel
import vn.laptopchildren.parent.data.*

@Composable internal fun EnforcementScreen(vm: ParentViewModel) {
    val s = vm.state
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        item {
            Text("Kết quả chặn ứng dụng", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
            Text("Kết quả do Agent gửi về. Chính sách yêu cầu chặn chưa xác nhận ứng dụng đã đóng.", style = MaterialTheme.typography.bodySmall)
        }
        if (s.enforcement.isEmpty() && !s.loading) item { Text(if (s.error == null) "Chưa có kết quả trong khoảng thời gian đã chọn." else "Chưa tải được kết quả. Hãy tải lại.") }
        items(s.enforcement, key = { it.event_id }) { event ->
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(event.app_name, style = MaterialTheme.typography.titleMedium)
                Text(enforcementOutcome(event.outcome), fontWeight = FontWeight.SemiBold,
                    color = if (event.outcome == "failed") MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurface)
                Text(enforcementReason(event.reason), style = MaterialTheme.typography.bodyMedium)
                Text("${categoryText(event.category)} · ${dateText(event.occurred_at)}", style = MaterialTheme.typography.bodySmall)
                HorizontalDivider(Modifier.padding(top = 8.dp))
            }
        }
        if (s.hasMore) item { TextButton(onClick = { vm.refreshRows(true) }, enabled = !s.busy && !s.loading) { Text("Tải thêm kết quả") } }
    }
}
