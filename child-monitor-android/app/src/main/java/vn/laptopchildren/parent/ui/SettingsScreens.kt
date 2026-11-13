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
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
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
    var confirm by remember(settings.child_id) { mutableStateOf<Pair<String, Map<String, Any>>?>(null) }
    var interval by remember(settings.child_id, settings.break_interval_minutes) { mutableStateOf(settings.break_interval_minutes.toString()) }
    var breakTime by remember(settings.child_id, settings.break_duration_minutes) { mutableStateOf(settings.break_duration_minutes.toString()) }

    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
        Surface(
            shape = RoundedCornerShape(16.dp),
            color = MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.5f),
            border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
            modifier = Modifier.fillMaxWidth()
        ) {
            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text("Áp dụng cho ${child?.name.orEmpty()}", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                Text("Cấu hình sẽ tự động đồng bộ xuống các laptop của con khi kết nối.", color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
            }
        }

        Surface(
            shape = RoundedCornerShape(16.dp),
            color = if (settings.is_locked) MaterialTheme.colorScheme.errorContainer.copy(alpha = 0.5f) else MaterialTheme.colorScheme.surface,
            border = BorderStroke(1.dp, if (settings.is_locked) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.outlineVariant),
            modifier = Modifier.fillMaxWidth()
        ) {
            Box(Modifier.padding(16.dp)) {
                ToggleRow(
                    "Khóa sử dụng laptop khẩn cấp",
                    "Khóa tức thì mọi màn hình máy tính đang liên kết của con.",
                    settings.is_locked,
                    !s.busy
                ) { value ->
                    confirm = (if (value) "Khóa các laptop của ${child?.name}?" else "Mở khóa các laptop của ${child?.name}?") to mapOf("is_locked" to value)
                }
            }
        }

        Surface(
            shape = RoundedCornerShape(16.dp),
            color = MaterialTheme.colorScheme.surface,
            border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
            modifier = Modifier.fillMaxWidth()
        ) {
            Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Outlined.AccessTime, null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(20.dp))
                    Spacer(Modifier.width(8.dp))
                    Text("Thời gian sử dụng", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                }
                Field("Giới hạn mỗi ngày (phút)", minutes, { minutes = it }, KeyboardType.Number, !s.busy)
                Text("Nhập 0 nếu không muốn đặt giới hạn thời lượng.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    Box(Modifier.weight(1f)) { Field("Từ giờ (HH:mm)", start, { start = it }, KeyboardType.Text, !s.busy) }
                    Box(Modifier.weight(1f)) { Field("Đến giờ (HH:mm)", end, { end = it }, KeyboardType.Text, !s.busy) }
                }
                Text("Khung giờ cho phép sử dụng theo múi giờ Việt Nam.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                error?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) }
                Button(
                    onClick = {
                        val count = minutes.toIntOrNull()
                        val time = Regex("^([01][0-9]|2[0-3]):[0-5][0-9]$")
                        error = when {
                            count == null || count !in 0..1440 -> "Giới hạn cần từ 0 đến 1440 phút."
                            !time.matches(start) || !time.matches(end) -> "Nhập giờ theo dạng 07:00 hoặc 21:00."
                            else -> null
                        }
                        if (error == null) vm.saveSettings(mapOf("daily_limit_minutes" to count!!, "allowed_start_time" to start, "allowed_end_time" to end))
                    },
                    enabled = !s.busy,
                    shape = RoundedCornerShape(12.dp),
                    modifier = Modifier.fillMaxWidth().height(48.dp)
                ) { Text("Lưu thời gian sử dụng", fontWeight = FontWeight.SemiBold) }
            }
        }

        Surface(
            shape = RoundedCornerShape(16.dp),
            color = MaterialTheme.colorScheme.surface,
            border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
            modifier = Modifier.fillMaxWidth()
        ) {
            Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Row(
                    Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Outlined.SelfImprovement, null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(20.dp))
                        Spacer(Modifier.width(8.dp))
                        Text("Nhắc nghỉ giải lao", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                    }
                    TextButton(onClick = { vm.openBreakHistory(fromPolicy = true) }, enabled = !s.busy) {
                        Icon(Icons.Outlined.History, null, Modifier.size(16.dp))
                        Spacer(Modifier.width(4.dp))
                        Text("Lịch sử", style = MaterialTheme.typography.labelMedium)
                    }
                }
                ToggleRow("Nhắc con nghỉ ngơi", "Hiển thị lời nhắc thân thiện trên laptop sau khoảng thời gian liên tục.", settings.enable_break_reminders, !s.busy) {
                    vm.saveSettings(mapOf("enable_break_reminders" to it))
                }
                if (settings.enable_break_reminders) {
                    Field("Nhắc sau mỗi (5–180 phút)", interval, { interval = it }, KeyboardType.Number, !s.busy)
                    Field("Thời gian nghỉ (1–30 phút)", breakTime, { breakTime = it }, KeyboardType.Number, !s.busy)
                    Button(
                        onClick = {
                            val i = interval.toIntOrNull(); val d = breakTime.toIntOrNull()
                            if (i == null || i !in 5..180 || d == null || d !in 1..30) error = "Kiểm tra khoảng nhắc nghỉ và thời gian nghỉ."
                            else { error = null; vm.saveSettings(mapOf("break_interval_minutes" to i, "break_duration_minutes" to d)) }
                        },
                        enabled = !s.busy,
                        shape = RoundedCornerShape(12.dp),
                        modifier = Modifier.fillMaxWidth().height(48.dp)
                    ) { Text("Lưu cấu hình nhắc nghỉ", fontWeight = FontWeight.SemiBold) }
                }
            }
        }

        Surface(
            shape = RoundedCornerShape(16.dp),
            color = MaterialTheme.colorScheme.surface,
            border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
            modifier = Modifier.fillMaxWidth()
        ) {
            Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Outlined.Shield, null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(20.dp))
                    Spacer(Modifier.width(8.dp))
                    Text("Phân loại & Nội dung", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                }
                ToggleRow("Phân loại ứng dụng", "Tự động nhận diện nhóm học tập, trò chơi, mạng xã hội.", settings.enable_app_classification, !s.busy) {
                    vm.saveSettings(mapOf("enable_app_classification" to it))
                }
                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                ToggleRow("Phân loại website", "Nhận diện danh mục website theo tên miền con truy cập.", settings.enable_web_classification, !s.busy) {
                    vm.saveSettings(mapOf("enable_web_classification" to it))
                }
                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                ToggleRow("Phân tích truy vấn tìm kiếm", "Phát hiện nội dung nhạy cảm hoặc không an toàn.", settings.enable_text_moderation, !s.busy) {
                    if (it) confirm = "Bật phân tích truy vấn tìm kiếm của con? Agent sẽ gửi truy vấn được hỗ trợ để phân tích; backend lưu kết quả, không lưu văn bản gốc." to mapOf("enable_text_moderation" to true)
                    else vm.saveSettings(mapOf("enable_text_moderation" to false))
                }
            }
        }

        listOf("app" to "Chặn nhóm ứng dụng", "web" to "Chặn nhóm website").forEach { (type, title) ->
            Surface(
                shape = RoundedCornerShape(16.dp),
                color = MaterialTheme.colorScheme.surface,
                border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
                modifier = Modifier.fillMaxWidth()
            ) {
                Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Text(title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                    val enabled = if (type == "app") settings.enable_app_classification else settings.enable_web_classification
                    if (!enabled) {
                        Text("Bật tính năng phân loại ở trên để chính sách chặn theo nhóm có hiệu lực.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error)
                    }
                    s.policies.filter { it.resource_type == type }.forEach { policy ->
                        ToggleRow(
                            categoryText(policy.category),
                            if (policy.action == "block") "Đang chặn" else "Đang cho phép",
                            policy.action == "block",
                            !s.busy
                        ) { vm.savePolicy(type, policy.category, it) }
                        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                    }
                }
            }
        }

        Surface(
            shape = RoundedCornerShape(16.dp),
            color = MaterialTheme.colorScheme.surface,
            border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
            modifier = Modifier.fillMaxWidth()
        ) {
            Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Outlined.Visibility, null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(20.dp))
                    Spacer(Modifier.width(8.dp))
                    Text("Giám sát tư thế & Khoảng cách", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                }
                Text("Hình ảnh webcam chỉ được xử lý trên laptop của con; chỉ gửi tín hiệu cảnh báo.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                ToggleRow("Theo dõi tư thế", "Nhắc nhở khi con ngồi sai tư thế.", settings.postureMonitoringEnabled, !s.busy) {
                    if (it) confirm = "Bật webcam trên các laptop của con để phát hiện và cảnh báo tư thế ngồi? Lựa chọn khoảng cách mắt được giữ nguyên." to mapOf("enable_posture_monitoring" to true)
                    else vm.saveSettings(mapOf("enable_posture_monitoring" to false))
                }
                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                ToggleRow("Cảnh báo khoảng cách mắt", "Nhắc nhở khi mắt con ở quá gần màn hình.", settings.eyeDistanceMonitoringEnabled, !s.busy) {
                    if (it) confirm = "Bật webcam trên các laptop của con để ước lượng và cảnh báo khoảng cách mắt? Lựa chọn tư thế được giữ nguyên." to mapOf("enable_eye_distance_monitoring" to true)
                    else vm.saveSettings(mapOf("enable_eye_distance_monitoring" to false))
                }
                Text("Tắt cả hai chức năng để dừng webcam sau khi laptop đồng bộ cấu hình.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        Spacer(Modifier.height(16.dp))
    }

    confirm?.let { (message, body) ->
        AlertDialog(
            onDismissRequest = { confirm = null },
            title = { Text("Xác nhận thay đổi", fontWeight = FontWeight.Bold) },
            text = { Text(message) },
            confirmButton = { TextButton(onClick = { confirm = null; vm.saveSettings(body) }) { Text("Xác nhận") } },
            dismissButton = { TextButton(onClick = { confirm = null }) { Text("Hủy") } }
        )
    }
}

@Composable private fun ToggleRow(title: String, subtitle: String, checked: Boolean, enabled: Boolean, change: (Boolean) -> Unit) {
    Row(
        Modifier.fillMaxWidth().padding(vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(title, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
            Text(subtitle, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Switch(
            checked = checked,
            onCheckedChange = change,
            enabled = enabled,
            colors = SwitchDefaults.colors(
                checkedThumbColor = MaterialTheme.colorScheme.primary,
                checkedTrackColor = MaterialTheme.colorScheme.primaryContainer
            ),
            modifier = Modifier.semantics { contentDescription = title }
        )
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

    Column(
        Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        Surface(
            shape = RoundedCornerShape(16.dp),
            color = MaterialTheme.colorScheme.surface,
            border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
            shadowElevation = 1.dp,
            modifier = Modifier.fillMaxWidth()
        ) {
            Row(Modifier.padding(20.dp), verticalAlignment = Alignment.CenterVertically) {
                Surface(
                    shape = CircleShape,
                    color = MaterialTheme.colorScheme.primaryContainer,
                    modifier = Modifier.size(52.dp)
                ) {
                    Box(contentAlignment = Alignment.Center) {
                        Icon(Icons.Outlined.Person, null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(28.dp))
                    }
                }
                Spacer(Modifier.width(16.dp))
                Column(Modifier.weight(1f)) {
                    Text("Tài khoản phụ huynh", style = MaterialTheme.typography.titleSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Text(vm.graph.prefs.getString("email", "Phụ huynh").orEmpty(), style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                }
            }
        }

        Surface(
            shape = RoundedCornerShape(16.dp),
            color = MaterialTheme.colorScheme.surface,
            border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
            modifier = Modifier.fillMaxWidth()
        ) {
            Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Outlined.Notifications, null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(20.dp))
                    Spacer(Modifier.width(8.dp))
                    Text("Thông báo trên điện thoại", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                }
                val configured = vm.graph.firebaseReady
                Text(
                    if (!configured) "Bản cài này chưa được cấu hình thông báo Firebase. Bạn vẫn xem được cảnh báo khi mở app."
                    else "Cho phép nhận thông báo để biết khi có cảnh báo mới về con.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
                if (configured) {
                    Button(
                        onClick = {
                            if (Build.VERSION.SDK_INT >= 33 && context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED)
                                permission.launch(Manifest.permission.POST_NOTIFICATIONS)
                            else if (!context.getSystemService(NotificationManager::class.java).areNotificationsEnabled())
                                context.startActivity(Intent(AndroidSettings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(AndroidSettings.EXTRA_APP_PACKAGE, context.packageName))
                            else vm.enablePush()
                        },
                        enabled = enabled,
                        shape = RoundedCornerShape(10.dp),
                        modifier = Modifier.fillMaxWidth()
                    ) { Text("Bật nhận thông báo", fontWeight = FontWeight.SemiBold) }

                    OutlinedButton(
                        onClick = vm::testPush,
                        enabled = enabled && vm.graph.prefs.getLong("push_id", 0) > 0,
                        shape = RoundedCornerShape(10.dp),
                        modifier = Modifier.fillMaxWidth()
                    ) { Text("Gửi thông báo thử") }
                }
            }
        }

        Surface(
            shape = RoundedCornerShape(16.dp),
            color = MaterialTheme.colorScheme.surface,
            border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
            modifier = Modifier.fillMaxWidth()
        ) {
            Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Outlined.Lock, null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(20.dp))
                    Spacer(Modifier.width(8.dp))
                    Text("Bảo mật & Mật khẩu", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                }
                OutlinedButton(
                    onClick = { showPassword = !showPassword },
                    shape = RoundedCornerShape(10.dp),
                    modifier = Modifier.fillMaxWidth()
                ) { Text(if (showPassword) "Ẩn đổi mật khẩu" else "Đổi mật khẩu tài khoản") }

                if (showPassword) {
                    PasswordField("Mật khẩu hiện tại", old, { old = it }, enabled)
                    PasswordField("Mật khẩu mới", new, { new = it }, enabled)
                    Text("Ít nhất 8 ký tự, có chữ hoa, số và ký tự đặc biệt.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Button(
                        onClick = { vm.changePassword(old, new) },
                        enabled = enabled && old.isNotBlank() && new.length >= 8,
                        shape = RoundedCornerShape(10.dp),
                        modifier = Modifier.fillMaxWidth()
                    ) { Text("Cập nhật mật khẩu mới", fontWeight = FontWeight.SemiBold) }
                }
            }
        }

        Button(
            onClick = vm::logout,
            enabled = enabled,
            colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.surfaceVariant, contentColor = MaterialTheme.colorScheme.onSurfaceVariant),
            shape = RoundedCornerShape(12.dp),
            modifier = Modifier.fillMaxWidth().height(48.dp)
        ) {
            Icon(Icons.Outlined.Logout, null, Modifier.size(18.dp))
            Spacer(Modifier.width(8.dp))
            Text("Đăng xuất tài khoản", fontWeight = FontWeight.SemiBold)
        }

        Surface(
            shape = RoundedCornerShape(14.dp),
            color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.4f),
            modifier = Modifier.fillMaxWidth()
        ) {
            Column(Modifier.padding(16.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text("LaptopChildren ${BuildConfig.VERSION_NAME}", style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.SemiBold)
                Text("Máy chủ: ${vm.graph.server}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Spacer(Modifier.height(4.dp))
                TextButton(onClick = { confirmDelete = true }, enabled = enabled) {
                    Icon(Icons.Outlined.DeleteForever, null, Modifier.size(16.dp), tint = MaterialTheme.colorScheme.error)
                    Spacer(Modifier.width(4.dp))
                    Text("Xóa tài khoản và dữ liệu", color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
                }
            }
        }
    }

    if (confirmDelete) AlertDialog(
        onDismissRequest = { confirmDelete = false; deletePassword = "" },
        title = { Text("Xóa tài khoản vĩnh viễn?", fontWeight = FontWeight.Bold) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text("Hồ sơ trẻ, thiết bị và toàn bộ dữ liệu liên quan sẽ bị xóa khỏi hệ thống. Thao tác này không thể hoàn tác.")
                PasswordField("Nhập mật khẩu để xác nhận", deletePassword, { deletePassword = it })
            }
        },
        confirmButton = {
            TextButton(
                onClick = { vm.deleteAccount(deletePassword); deletePassword = ""; confirmDelete = false },
                enabled = deletePassword.isNotBlank()
            ) { Text("Xóa vĩnh viễn", color = MaterialTheme.colorScheme.error, fontWeight = FontWeight.Bold) }
        },
        dismissButton = { TextButton(onClick = { confirmDelete = false; deletePassword = "" }) { Text("Hủy") } }
    )
}
