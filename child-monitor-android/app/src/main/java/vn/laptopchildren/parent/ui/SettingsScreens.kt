package vn.laptopchildren.parent.ui

import android.Manifest
import android.app.NotificationManager
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.provider.Settings as AndroidSettings
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.Alignment
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import vn.laptopchildren.parent.*
import vn.laptopchildren.parent.data.*

@Composable internal fun PoliciesScreen(vm: ParentViewModel) {
    val s = vm.state
    val settings = s.settings
    val child = s.children.find { it.child_id == s.childId }
    if (settings == null) {
        if (!s.loading) EmptyScreen("Chưa tải được chính sách", "Kiểm tra kết nối rồi thử lại.", action = "Thử lại", click = vm::refresh)
        return
    }
    var minutes by remember(settings.child_id, settings.daily_limit_minutes) { mutableStateOf(settings.daily_limit_minutes.toString()) }
    var start by remember(settings.child_id, settings.allowed_start_time) { mutableStateOf(settings.allowed_start_time.take(5)) }
    var end by remember(settings.child_id, settings.allowed_end_time) { mutableStateOf(settings.allowed_end_time.take(5)) }
    var error by remember { mutableStateOf<String?>(null) }
    var confirm by remember { mutableStateOf<Pair<String, Map<String, Any>>?>(null) }
    var interval by remember(settings.child_id, settings.break_interval_minutes) { mutableStateOf(settings.break_interval_minutes.toString()) }
    var breakTime by remember(settings.child_id, settings.break_duration_minutes) { mutableStateOf(settings.break_duration_minutes.toString()) }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text("Áp dụng cho ${child?.name.orEmpty()}", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold)
        Text("Thay đổi được lưu trên máy chủ. Laptop nhận cấu hình khi kết nối và đồng bộ.", color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodyMedium)
        ToggleRow("Khóa sử dụng laptop", "Áp dụng cho các laptop thuộc hồ sơ này.", settings.is_locked, !s.busy) { value ->
            confirm = (if (value) "Khóa các laptop của ${child?.name}?" else "Mở khóa các laptop của ${child?.name}?") to mapOf("is_locked" to value)
        }
        HorizontalDivider()
        SectionTitle("Thời gian sử dụng")
        Field("Giới hạn mỗi ngày (phút)", minutes, { minutes = it }, KeyboardType.Number, !s.busy)
        Text("Nhập 0 để không giới hạn thời lượng trong ngày.", style = MaterialTheme.typography.bodySmall)
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Box(Modifier.weight(1f)) { Field("Từ giờ (HH:mm)", start, { start = it }, KeyboardType.Text, !s.busy) }
            Box(Modifier.weight(1f)) { Field("Đến giờ (HH:mm)", end, { end = it }, KeyboardType.Text, !s.busy) }
        }
        Text("Khung giờ theo cấu hình của hệ thống (giờ Việt Nam).", style = MaterialTheme.typography.bodySmall)
        error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        Button(onClick = {
            val count = minutes.toIntOrNull()
            val time = Regex("^([01][0-9]|2[0-3]):[0-5][0-9]$")
            error = when { count == null || count !in 0..1440 -> "Giới hạn cần từ 0 đến 1440 phút."; !time.matches(start) || !time.matches(end) -> "Nhập giờ theo dạng 07:00 hoặc 21:00."; else -> null }
            if (error == null) vm.saveSettings(mapOf("daily_limit_minutes" to count!!, "allowed_start_time" to start, "allowed_end_time" to end))
        }, enabled = !s.busy, modifier = Modifier.fillMaxWidth()) { Text("Lưu thời gian sử dụng") }
        HorizontalDivider()
        SectionTitle("Nhắc nghỉ")
        OutlinedButton(onClick = { vm.openBreakHistory(fromPolicy = true) }, enabled = !s.busy) { Text("Lịch sử nhắc nghỉ") }
        ToggleRow("Nhắc con nghỉ ngơi", "Hiển thị lời nhắc trên laptop.", settings.enable_break_reminders, !s.busy) { vm.saveSettings(mapOf("enable_break_reminders" to it)) }
        if (settings.enable_break_reminders) {
            Field("Nhắc sau mỗi (5–180 phút)", interval, { interval = it }, KeyboardType.Number, !s.busy)
            Field("Thời gian nghỉ (1–30 phút)", breakTime, { breakTime = it }, KeyboardType.Number, !s.busy)
            OutlinedButton(onClick = {
                val i = interval.toIntOrNull(); val d = breakTime.toIntOrNull()
                if (i == null || i !in 5..180 || d == null || d !in 1..30) error = "Kiểm tra khoảng nhắc nghỉ và thời gian nghỉ."
                else { error = null; vm.saveSettings(mapOf("break_interval_minutes" to i, "break_duration_minutes" to d)) }
            }, enabled = !s.busy) { Text("Lưu nhắc nghỉ") }
        }
        HorizontalDivider()
        SectionTitle("Phân loại và nội dung")
        ToggleRow("Phân loại ứng dụng", "Nhận diện các nhóm học tập, giải trí, trình duyệt.", settings.enable_app_classification, !s.busy) { vm.saveSettings(mapOf("enable_app_classification" to it)) }
        ToggleRow("Phân loại website", "Nhận diện nhóm nội dung theo tên miền.", settings.enable_web_classification, !s.busy) { vm.saveSettings(mapOf("enable_web_classification" to it)) }
        ToggleRow("Phân tích truy vấn tìm kiếm", "Phân tích tìm kiếm được hỗ trợ để phát hiện tín hiệu cần chú ý.", settings.enable_text_moderation, !s.busy) {
            if (it) confirm = "Bật phân tích truy vấn tìm kiếm của con? Agent sẽ gửi truy vấn được hỗ trợ để phân tích; backend lưu kết quả, không lưu văn bản gốc." to mapOf("enable_text_moderation" to true)
            else vm.saveSettings(mapOf("enable_text_moderation" to false))
        }
        listOf("app" to "Chặn nhóm ứng dụng", "web" to "Chặn nhóm website").forEach { (type, title) ->
            SectionTitle(title)
            val enabled = if (type == "app") settings.enable_app_classification else settings.enable_web_classification
            if (!enabled) Text("Bật phân loại tương ứng để chính sách theo nhóm có hiệu lực.", style = MaterialTheme.typography.bodySmall)
            s.policies.filter { it.resource_type == type }.forEach { policy ->
                ToggleRow(categoryText(policy.category), if (policy.action == "block") "Đã đặt chặn" else "Đang cho phép", policy.action == "block", !s.busy) { vm.savePolicy(type, policy.category, it) }
            }
        }
        HorizontalDivider()
        SectionTitle("Giám sát trên laptop")
        ToggleRow("Khoảng cách và tư thế", "Dùng webcam trên laptop; chỉ gửi kết quả cảnh báo.", settings.enable_webcam_monitoring, !s.busy) {
            if (it) confirm = "Bật webcam trên laptop để phân tích khoảng cách và tư thế? Hình ảnh webcam được xử lý trên laptop." to mapOf("enable_webcam_monitoring" to true)
            else vm.saveSettings(mapOf("enable_webcam_monitoring" to false))
        }
        Text("Xem và bật/tắt chụp ảnh tại Hoạt động → Ảnh màn hình. Phân tích và báo cáo nằm trong Gia đình → AI Advisor.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Spacer(Modifier.height(20.dp))
    }
    confirm?.let { (message, body) -> AlertDialog(onDismissRequest = { confirm = null }, title = { Text("Xác nhận thay đổi") },
        text = { Text(message) }, confirmButton = { TextButton(onClick = { confirm = null; vm.saveSettings(body) }) { Text("Xác nhận") } },
        dismissButton = { TextButton(onClick = { confirm = null }) { Text("Hủy") } }) }
}

@Composable private fun ToggleRow(title: String, subtitle: String, checked: Boolean, enabled: Boolean, change: (Boolean) -> Unit) {
    Row(Modifier.fillMaxWidth().padding(vertical = 6.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(title, style = MaterialTheme.typography.titleSmall)
            Text(subtitle, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Switch(checked, change, enabled = enabled, modifier = Modifier.semantics { contentDescription = title })
    }
}

@Composable internal fun AccountScreen(vm: ParentViewModel) {
    val context = LocalContext.current
    var old by remember { mutableStateOf("") }
    var new by remember { mutableStateOf("") }
    var showPassword by rememberSaveable { mutableStateOf(false) }
    var deletePassword by remember { mutableStateOf("") }
    var confirmDelete by remember { mutableStateOf(false) }
    val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) vm.enablePush()
    }
    val enabled = !vm.state.busy
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(24.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
        Icon(Icons.Outlined.AccountCircle, null, Modifier.size(48.dp), tint = MaterialTheme.colorScheme.primary)
        Text(vm.graph.prefs.getString("email", "Phụ huynh").orEmpty(), style = MaterialTheme.typography.titleLarge)
        SectionTitle("Thông báo trên điện thoại")
        val configured = vm.graph.firebaseReady
        Text(if (!configured) "Bản cài này chưa được cấu hình thông báo Firebase. Bạn vẫn xem được cảnh báo khi mở app."
            else "Cho phép nhận thông báo để biết khi có cảnh báo mới về con.", color = MaterialTheme.colorScheme.onSurfaceVariant)
        if (configured) {
            Button(onClick = {
                if (Build.VERSION.SDK_INT >= 33 && context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED)
                    permission.launch(Manifest.permission.POST_NOTIFICATIONS)
                else if (!context.getSystemService(NotificationManager::class.java).areNotificationsEnabled())
                    context.startActivity(Intent(AndroidSettings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(AndroidSettings.EXTRA_APP_PACKAGE, context.packageName))
                else vm.enablePush()
            }, enabled = enabled, modifier = Modifier.fillMaxWidth()) { Text("Bật nhận thông báo") }
            OutlinedButton(onClick = vm::testPush, enabled = enabled && vm.graph.prefs.getLong("push_id", 0) > 0, modifier = Modifier.fillMaxWidth()) { Text("Gửi thông báo thử") }
        }
        HorizontalDivider()
        TextButton(onClick = { showPassword = !showPassword }) { Text(if (showPassword) "Ẩn đổi mật khẩu" else "Đổi mật khẩu") }
        if (showPassword) {
            PasswordField("Mật khẩu hiện tại", old, { old = it }, enabled)
            PasswordField("Mật khẩu mới", new, { new = it }, enabled)
            Text("Ít nhất 8 ký tự, có chữ hoa, số và ký tự đặc biệt.", style = MaterialTheme.typography.bodySmall)
            Button(onClick = { vm.changePassword(old, new) }, enabled = enabled && old.isNotBlank() && new.length >= 8) { Text("Cập nhật mật khẩu") }
        }
        OutlinedButton(onClick = vm::logout, enabled = enabled, modifier = Modifier.fillMaxWidth().heightIn(min = 52.dp)) { Text("Đăng xuất") }
        HorizontalDivider()
        Text("LaptopChildren ${BuildConfig.VERSION_NAME}", style = MaterialTheme.typography.labelLarge)
        Text("Máy chủ: ${vm.graph.server}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        TextButton(onClick = { confirmDelete = true }, enabled = enabled) { Text("Xóa tài khoản và dữ liệu", color = MaterialTheme.colorScheme.error) }
    }
    if (confirmDelete) AlertDialog(onDismissRequest = { confirmDelete = false; deletePassword = "" }, title = { Text("Xóa tài khoản vĩnh viễn?") },
        text = { Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text("Hồ sơ trẻ, thiết bị và dữ liệu liên quan sẽ bị xóa. Thao tác này không thể hoàn tác.")
            PasswordField("Nhập mật khẩu để xác nhận", deletePassword, { deletePassword = it })
        } }, confirmButton = { TextButton(onClick = { vm.deleteAccount(deletePassword); deletePassword = ""; confirmDelete = false }, enabled = deletePassword.isNotBlank()) { Text("Xóa vĩnh viễn", color = MaterialTheme.colorScheme.error) } },
        dismissButton = { TextButton(onClick = { confirmDelete = false; deletePassword = "" }) { Text("Hủy") } })
}
