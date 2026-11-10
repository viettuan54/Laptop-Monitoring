@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)
package vn.laptopchildren.parent.ui

import android.Manifest
import android.app.NotificationManager
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.provider.Settings as AndroidSettings
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.automirrored.outlined.NavigateNext
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.*
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import vn.laptopchildren.parent.*
import vn.laptopchildren.parent.data.*
import java.time.LocalDate

@Composable fun ParentApp(vm: ParentViewModel) = ParentTheme {
    val s = vm.state
    val snackbar = remember { SnackbarHostState() }
    val owner = LocalLifecycleOwner.current
    DisposableEffect(owner) {
        val observer = LifecycleEventObserver { _, event -> if (event == Lifecycle.Event.ON_RESUME) vm.onResume() }
        owner.lifecycle.addObserver(observer)
        onDispose { owner.lifecycle.removeObserver(observer) }
    }
    LaunchedEffect(s.notice) { s.notice?.let { snackbar.showSnackbar(it); vm.clearNotice() } }
    BackHandler(enabled = s.signedIn && (s.subpage != null || s.tab != 0)) {
        vm.back()
    }
    Scaffold(containerColor = MaterialTheme.colorScheme.background, snackbarHost = { SnackbarHost(snackbar) },
        topBar = {
            if (s.signedIn) TopAppBar(title = { Text(when(s.subpage) {
                "breaks" -> "Lịch sử nhắc nghỉ"
                "ai" -> "AI Advisor"
                "policy" -> "Chính sách của con"
                "account" -> "Tài khoản"
                "add-child" -> "Thêm hồ sơ"
                "edit-child" -> "Sửa hồ sơ"
                else -> listOf("Tổng quan", "Hoạt động", "Cảnh báo", "Gia đình")[s.tab]
            }, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold) },
                navigationIcon = { if (s.subpage != null) IconButton(onClick = vm::back, enabled = !s.busy) { Icon(Icons.AutoMirrored.Outlined.ArrowBack, "Quay lại") } },
                actions = {
                    if (s.subpage == null) IconButton(onClick = { vm.loadFamily() }, enabled = !s.loading && !s.busy) { Icon(Icons.Outlined.Refresh, "Tải lại dữ liệu") }
                }, colors = TopAppBarDefaults.topAppBarColors(containerColor = MaterialTheme.colorScheme.background))
        }, bottomBar = {
            if (s.signedIn && s.subpage == null) NavigationBar {
                val icons = listOf(Icons.Outlined.Home, Icons.Outlined.BarChart, Icons.Outlined.Notifications, Icons.Outlined.People)
                listOf("Tổng quan", "Hoạt động", "Cảnh báo", "Gia đình").forEachIndexed { index, label ->
                    NavigationBarItem(selected = s.tab == index, onClick = { vm.navigate(index) }, enabled = !s.busy,
                        icon = { Icon(icons[index], null) }, label = { Text(label) }, modifier = Modifier.testTag("tab-$index"))
                }
            }
        }) { inset ->
        Column(Modifier.fillMaxSize().padding(inset).imePadding()) {
            if (s.loading || s.busy) LinearProgressIndicator(Modifier.fillMaxWidth().semantics { contentDescription = "Đang tải" })
            s.error?.let { error ->
                Surface(color = MaterialTheme.colorScheme.errorContainer) {
                    Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text(error, Modifier.weight(1f), color = MaterialTheme.colorScheme.onErrorContainer, style = MaterialTheme.typography.bodyMedium)
                        IconButton(onClick = vm::dismissError) { Icon(Icons.Outlined.Close, "Đóng thông báo lỗi") }
                    }
                }
            }
            if (!s.signedIn) AuthScreen(vm)
            else when(s.subpage) {
                "breaks" -> BreakHistoryScreen(vm)
                "ai" -> AiAdvisorScreen(vm)
                "account" -> AccountScreen(vm)
                "add-child", "edit-child" -> ChildEditor(vm, if (s.subpage == "edit-child") s.children.find { it.child_id == s.childId } else null)
                "policy" -> PoliciesScreen(vm)
                else -> {
                    if (s.children.isNotEmpty()) Selector(s.children.map { it.child_id to it.name }, s.childId, "Hồ sơ trẻ", !s.busy, vm::selectChild)
                    if (s.children.isEmpty()) {
                        if (!s.loading) EmptyScreen("Bắt đầu từ hồ sơ của con", "Thêm hồ sơ để kết nối laptop và theo dõi hoạt động.", Icons.Outlined.People,
                            "Thêm hồ sơ", { vm.navigate(3, "add-child") }, "Tài khoản", { vm.navigate(3, "account") })
                    } else when(s.tab) {
                        0 -> OverviewScreen(vm)
                        1 -> ActivityScreen(vm)
                        2 -> AlertsScreen(vm)
                        3 -> FamilyScreen(vm)
                    }
                }
            }
        }
    }
}

@Composable private fun AuthScreen(vm: ParentViewModel) {
    var mode by rememberSaveable { mutableStateOf("login") }
    var email by rememberSaveable { mutableStateOf("") }
    // Passwords are deliberately not saved in saved-instance state.
    var password by remember { mutableStateOf("") }
    var name by rememberSaveable { mutableStateOf("") }
    var token by remember { mutableStateOf("") }
    var showServer by remember { mutableStateOf(false) }
    var server by remember { mutableStateOf(vm.graph.server) }
    var localError by remember { mutableStateOf<String?>(null) }
    val titles = mapOf("login" to "Đăng nhập", "register" to "Tạo tài khoản", "forgot" to "Quên mật khẩu",
        "verify" to "Xác minh email", "resend" to "Gửi lại xác minh", "reset" to "Đặt lại mật khẩu")
    BackHandler(enabled = mode != "login") { mode = "login"; password = ""; token = ""; localError = null }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 28.dp, vertical = 24.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
        Surface(shape = RoundedCornerShape(16.dp), color = MaterialTheme.colorScheme.primaryContainer) {
            Icon(Icons.Outlined.LaptopChromebook, null, Modifier.padding(16.dp).size(36.dp), tint = MaterialTheme.colorScheme.primary)
        }
        Text("LaptopChildren", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold)
        Text("Đồng hành cùng con\ntrong thế giới số.", style = MaterialTheme.typography.headlineSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Spacer(Modifier.height(8.dp))
        Text(titles[mode].orEmpty(), style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold)
        if (mode == "register") Field("Tên phụ huynh", name, { name = it }, enabled = !vm.state.busy)
        if (mode !in setOf("verify", "reset")) Field("Email", email, { email = it }, KeyboardType.Email, !vm.state.busy, tag = "email")
        if (mode in setOf("verify", "reset")) {
            Text("Dán mã token trong đường dẫn được gửi đến email của bạn.", style = MaterialTheme.typography.bodyMedium)
            Field("Mã xác minh", token, { token = it }, enabled = !vm.state.busy)
        }
        if (mode in setOf("login", "register", "reset", "resend")) PasswordField(if (mode == "reset") "Mật khẩu mới" else "Mật khẩu", password, { password = it }, !vm.state.busy, "password")
        if (mode == "register" || mode == "reset") Text("Ít nhất 8 ký tự, có chữ hoa, số và ký tự đặc biệt.", style = MaterialTheme.typography.bodySmall)
        localError?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        Button(onClick = {
            localError = when {
                mode !in setOf("verify", "reset") && !android.util.Patterns.EMAIL_ADDRESS.matcher(email.trim()).matches() -> "Nhập địa chỉ email hợp lệ."
                mode in setOf("login", "register", "reset", "resend") && password.isBlank() -> "Nhập mật khẩu của bạn."
                mode == "register" && name.isBlank() -> "Nhập tên phụ huynh."
                mode in setOf("verify", "reset") && token.isBlank() -> "Nhập mã trong email."
                else -> null
            }
            if (localError == null) {
                if (mode == "login") vm.login(email, password)
                else vm.authAction(mode, email, password, name, token) { mode = "login"; password = ""; token = "" }
            }
        }, enabled = !vm.state.busy, modifier = Modifier.fillMaxWidth().heightIn(min = 52.dp).testTag("sign-in")) { Text(if (vm.state.busy) "Đang xử lý…" else titles[mode].orEmpty()) }
        if (mode == "login") {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                TextButton(onClick = { mode = "forgot" }) { Text("Quên mật khẩu?") }
                TextButton(onClick = { mode = "register" }) { Text("Tạo tài khoản") }
            }
            TextButton(onClick = { mode = "verify" }, modifier = Modifier.fillMaxWidth()) { Text("Xác minh email / mã đã nhận") }
        } else {
            TextButton(onClick = { mode = "login"; password = ""; localError = null }, modifier = Modifier.fillMaxWidth()) { Text("Quay lại đăng nhập") }
            if (mode == "forgot") TextButton(onClick = { mode = "reset" }) { Text("Tôi đã có mã đặt lại mật khẩu") }
            if (mode == "verify") TextButton(onClick = { mode = "resend" }) { Text("Gửi lại email xác minh") }
        }
        HorizontalDivider()
        Text("Dùng tài khoản phụ huynh trên website để xem cùng dữ liệu của con.", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        TextButton(onClick = { showServer = true }, modifier = Modifier.align(Alignment.CenterHorizontally).testTag("server-settings")) { Text("Thiết lập kết nối") }
    }
    if (showServer) AlertDialog(onDismissRequest = { showServer = false }, title = { Text("Máy chủ kết nối") },
        text = { Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text("Dùng địa chỉ API của hệ thống LaptopChildren.")
            Field("Địa chỉ HTTPS", server, { server = it }, KeyboardType.Uri, tag = "server-url")
            localError?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        } }, confirmButton = { TextButton(onClick = {
            runCatching { vm.graph.setServer(server) }.onSuccess { showServer = false; localError = null }.onFailure { localError = it.message }
        }) { Text("Lưu kết nối") } }, dismissButton = { TextButton(onClick = { showServer = false }) { Text("Hủy") } })
}

@Composable internal fun Field(label: String, value: String, change: (String) -> Unit, keyboard: KeyboardType = KeyboardType.Text,
    enabled: Boolean = true, tag: String = "") {
    OutlinedTextField(value, change, Modifier.fillMaxWidth().testTag(tag), label = { Text(label) }, singleLine = true,
        enabled = enabled, keyboardOptions = KeyboardOptions(keyboardType = keyboard), shape = RoundedCornerShape(12.dp))
}
@Composable internal fun PasswordField(label: String, value: String, change: (String) -> Unit, enabled: Boolean = true, tag: String = "") {
    var visible by remember { mutableStateOf(false) }
    OutlinedTextField(value, change, Modifier.fillMaxWidth().testTag(tag), label = { Text(label) }, singleLine = true,
        enabled = enabled, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password), shape = RoundedCornerShape(12.dp),
        visualTransformation = if (visible) VisualTransformation.None else PasswordVisualTransformation(),
        trailingIcon = { IconButton(onClick = { visible = !visible }) { Icon(if (visible) Icons.Outlined.VisibilityOff else Icons.Outlined.Visibility, if (visible) "Ẩn mật khẩu" else "Hiện mật khẩu") } })
}
@Composable internal fun Selector(options: List<Pair<Long, String>>, selected: Long?, label: String, enabled: Boolean = true, select: (Long) -> Unit) {
    var expanded by remember { mutableStateOf(false) }
    Box(Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 6.dp)) {
        OutlinedButton(onClick = { expanded = true }, enabled = enabled, modifier = Modifier.fillMaxWidth().heightIn(min = 52.dp), shape = RoundedCornerShape(12.dp)) {
            Column(Modifier.weight(1f), horizontalAlignment = Alignment.Start) {
                Text(label, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Text(options.find { it.first == selected }?.second ?: "Chọn", style = MaterialTheme.typography.titleMedium)
            }
            Icon(Icons.Outlined.ExpandMore, null)
        }
        DropdownMenu(expanded, { expanded = false }) { options.forEach { (id, name) -> DropdownMenuItem(text = { Text(name) }, onClick = { expanded = false; select(id) }) } }
    }
}
@Composable internal fun EmptyScreen(title: String, message: String, icon: ImageVector = Icons.Outlined.Inbox,
    action: String? = null, click: () -> Unit = {}, secondary: String? = null, secondaryClick: () -> Unit = {}) {
    Column(Modifier.fillMaxWidth().padding(28.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(16.dp)) {
        Icon(icon, null, Modifier.size(48.dp), tint = MaterialTheme.colorScheme.primary)
        Text(title, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold)
        Text(message, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        action?.let { Button(onClick = click) { Text(it) } }
        secondary?.let { TextButton(onClick = secondaryClick) { Text(it) } }
    }
}
@Composable internal fun SectionTitle(text: String) { Text(text, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(top = 12.dp, bottom = 8.dp)) }
@Composable internal fun LinkRow(icon: ImageVector, title: String, subtitle: String, click: () -> Unit) {
    ListItem(headlineContent = { Text(title) }, supportingContent = { Text(subtitle) }, leadingContent = { Icon(icon, null, tint = MaterialTheme.colorScheme.primary) },
        trailingContent = { Icon(Icons.AutoMirrored.Outlined.NavigateNext, null) }, modifier = Modifier.fillMaxWidth().clickable(onClick = click).heightIn(min = 72.dp),
        colors = ListItemDefaults.colors(containerColor = MaterialTheme.colorScheme.surface))
}

@Composable private fun OverviewScreen(vm: ParentViewModel) {
    val s = vm.state
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        item {
            Text("Hôm nay của con", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.SemiBold)
            Text("${LocalDate.now(VietnamZone).dayOfMonth}/${LocalDate.now(VietnamZone).monthValue} · Giờ Việt Nam", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        item {
            Surface(shape = RoundedCornerShape(16.dp), color = MaterialTheme.colorScheme.primaryContainer) {
                Column(Modifier.fillMaxWidth().padding(20.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("Thời gian sử dụng laptop", style = MaterialTheme.typography.titleSmall)
                    Text(s.usage?.let { durationText(it.today_seconds) } ?: "Chưa tải dữ liệu", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold)
                    Text("Tổng tháng này: ${s.usage?.let { durationText(it.month_total_seconds) } ?: "—"}", style = MaterialTheme.typography.bodyMedium)
                }
            }
        }
        s.usage?.let { usage -> item {
            SectionTitle("Những ngày gần đây")
            val days = usage.daily.filter { it.date <= LocalDate.now(VietnamZone).toString() }.takeLast(7)
            if (days.isEmpty()) Text("Chưa có dữ liệu theo ngày.") else {
                val max = days.maxOf { it.duration_seconds }.coerceAtLeast(60)
                Row(Modifier.fillMaxWidth().heightIn(min = 136.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.Bottom) {
                    days.forEach { day -> Column(Modifier.weight(1f).semantics(mergeDescendants = true) { contentDescription = "Ngày ${day.date}: ${durationText(day.duration_seconds)}" }, horizontalAlignment = Alignment.CenterHorizontally) {
                        Text("${day.duration_seconds / 60}p", style = MaterialTheme.typography.labelSmall, modifier = Modifier.padding(bottom = 4.dp))
                        Box(Modifier.widthIn(max = 32.dp).fillMaxWidth().height((day.duration_seconds.toFloat() / max * 88).coerceAtLeast(3f).dp)
                            .clip(RoundedCornerShape(topStart = 5.dp, topEnd = 5.dp)).background(MaterialTheme.colorScheme.primary))
                        Text(day.date.takeLast(2), style = MaterialTheme.typography.labelSmall, modifier = Modifier.padding(top = 8.dp))
                    } }
                }
            }
        } }
        item { SectionTitle("Laptop của con") }
        if (s.devices.isEmpty()) item { Text("Chưa có laptop được liên kết. Đăng ký thiết bị trên website rồi cài Windows Agent.", style = MaterialTheme.typography.bodyMedium) }
        items(s.devices, key = { it.device_id }) { device -> DeviceRow(device) }
        item { LinkRow(Icons.Outlined.Notifications, "Xem cảnh báo", "Kiểm tra những hoạt động cần chú ý") { vm.navigate(2) } }
        item { LinkRow(Icons.Outlined.AutoAwesome, "AI Advisor", "Phân tích, báo cáo và trò chuyện") { vm.navigate(3, "ai") } }
        item { LinkRow(Icons.Outlined.Tune, "Điều chỉnh chính sách", "Thời gian sử dụng và nhóm nội dung") { vm.navigate(3, "policy") } }
        item { UpdatedText(s.updated) }
    }
}
@Composable private fun DeviceRow(device: Device) {
    ListItem(headlineContent = { Text(device.device_name, fontWeight = FontWeight.Medium) }, leadingContent = { Icon(Icons.Outlined.LaptopChromebook, null) },
        supportingContent = { Column {
            Text(if (device.online) "Đang kết nối" else "Ngoại tuyến", color = if (device.online) MaterialTheme.colorScheme.secondary else MaterialTheme.colorScheme.onSurfaceVariant)
            Text("Lần cuối: ${dateText(device.last_seen_at)}", style = MaterialTheme.typography.bodySmall)
        } }, colors = ListItemDefaults.colors(containerColor = MaterialTheme.colorScheme.surface))
}
@Composable private fun UpdatedText(value: String?) {
    Text("Cập nhật: ${dateText(value)}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
}

@Composable private fun DeviceFilter(vm: ParentViewModel) {
    Selector(vm.state.devices.map { it.device_id to it.device_name }, vm.state.deviceId, "Laptop đang xem", !vm.state.busy) { vm.selectDevice(it) }
}
@Composable private fun ActivityScreen(vm: ParentViewModel) {
    val s = vm.state
    if (s.devices.isEmpty()) { if (!s.loading) EmptyScreen("Chưa có laptop", "Liên kết laptop để bắt đầu xem hoạt động.", Icons.Outlined.LaptopChromebook); return }
    Column {
        DeviceFilter(vm)
        Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 20.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            FilterChip(s.kind == "app", { vm.setActivityFilter(kind = "app") }, { Text("Ứng dụng") })
            FilterChip(s.kind == "web", { vm.setActivityFilter(kind = "web") }, { Text("Website") })
            FilterChip(s.kind == "screenshots", { vm.setActivityFilter(kind = "screenshots") }, { Text("Ảnh màn hình") }, enabled = !s.busy)
            if (s.kind != "screenshots") {
            VerticalDivider(Modifier.height(40.dp).padding(8.dp))
            FilterChip(s.days == 1, { vm.setActivityFilter(days = 1) }, { Text("Hôm nay") })
            FilterChip(s.days == 7, { vm.setActivityFilter(days = 7) }, { Text("7 ngày") })
            }
        }
        if (s.kind == "screenshots") { ScreenshotsScreen(vm); return@Column }
        LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 24.dp)) {
            if (s.activity.isEmpty() && !s.loading) item { EmptyScreen("Chưa có hoạt động", "Không có dữ liệu trong khoảng thời gian đã chọn.") }
            items(s.activity, key = { it.log_id }) { row ->
                ListItem(headlineContent = { Text(if (s.kind == "app") row.product_name?.takeIf { it.isNotBlank() } ?: row.app_name.orEmpty() else row.domain.orEmpty(), fontWeight = FontWeight.Medium) },
                    supportingContent = { Column { Text(categoryText(row.category)); Text(dateText(row.start_time ?: row.visit_time), style = MaterialTheme.typography.bodySmall) } },
                    trailingContent = { if (s.kind == "app") Text(durationText(row.duration_seconds ?: 0), style = MaterialTheme.typography.labelMedium) },
                    leadingContent = { Icon(if (s.kind == "app") Icons.Outlined.Apps else Icons.Outlined.Language, null) },
                    colors = ListItemDefaults.colors(containerColor = MaterialTheme.colorScheme.background))
                HorizontalDivider(Modifier.padding(horizontal = 20.dp))
            }
            if (s.hasMore) item { TextButton(onClick = { vm.refreshRows(true) }, enabled = !s.loading, modifier = Modifier.fillMaxWidth()) { Text("Tải thêm hoạt động") } }
            item { Box(Modifier.padding(20.dp)) { UpdatedText(s.updated) } }
        }
    }
}
@Composable private fun AlertsScreen(vm: ParentViewModel) {
    val s = vm.state
    if (s.devices.isEmpty()) { if (!s.loading) EmptyScreen("Chưa có laptop", "Cảnh báo sẽ xuất hiện sau khi thiết bị gửi dữ liệu.", Icons.Outlined.NotificationsNone); return }
    Column {
        DeviceFilter(vm)
        Row(Modifier.padding(horizontal = 20.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            FilterChip(!s.unreadOnly, { vm.unreadOnly(false) }, { Text("Tất cả") })
            FilterChip(s.unreadOnly, { vm.unreadOnly(true) }, { Text("Chưa đọc") })
        }
        LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            if (s.alerts.isEmpty() && !s.loading) item { EmptyScreen("Không có cảnh báo${if (s.unreadOnly) " chưa đọc" else ""}", "Bạn có thể tải lại để kiểm tra cập nhật mới.", Icons.Outlined.NotificationsNone) }
            items(s.alerts, key = { it.alert_id }) { alert ->
                Surface(shape = RoundedCornerShape(12.dp), color = if (alert.is_read) MaterialTheme.colorScheme.surface else MaterialTheme.colorScheme.primaryContainer) {
                    Column(Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        Text(if (alert.is_read) "Đã đọc" else "Cần chú ý", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.primary)
                        Text(alert.message, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.Medium)
                        Text(dateText(alert.created_at), style = MaterialTheme.typography.bodySmall)
                        if (alert.alert_type.startsWith("text_")) Text("Đây là tín hiệu từ phân tích tự động. Hãy xem xét bối cảnh và trao đổi với con.", style = MaterialTheme.typography.bodySmall)
                        if (!alert.is_read) TextButton(onClick = { vm.markRead(alert) }, enabled = !s.busy) { Text("Đánh dấu đã đọc") }
                    }
                }
            }
            if (s.hasMore) item { TextButton(onClick = { vm.refreshRows(true) }, enabled = !s.loading, modifier = Modifier.fillMaxWidth()) { Text("Tải thêm cảnh báo") } }
            item { UpdatedText(s.updated) }
        }
    }
}

@Composable private fun FamilyScreen(vm: ParentViewModel) {
    val s = vm.state
    val child = s.children.find { it.child_id == s.childId }
    LazyColumn(Modifier.fillMaxSize().testTag("family-list"), contentPadding = PaddingValues(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        item {
            Text(child?.name.orEmpty(), style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.SemiBold)
            Text(child?.age?.let { "$it tuổi" } ?: "Chưa cập nhật tuổi", color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        item { LinkRow(Icons.Outlined.Edit, "Sửa hồ sơ", "Tên và tuổi của con") { vm.navigate(3, "edit-child") } }
        item { LinkRow(Icons.Outlined.History, "Lịch sử nhắc nghỉ", "Phản hồi gần nhất từ laptop của con") { vm.openBreakHistory() } }
        item { LinkRow(Icons.Outlined.AutoAwesome, "AI Advisor", "Phân tích, báo cáo và trò chuyện") { vm.navigate(3, "ai") } }
        item { LinkRow(Icons.Outlined.Tune, "Chính sách sử dụng", "Giới hạn, lịch sử dụng và nội dung") { vm.navigate(3, "policy") } }
        item { SectionTitle("Thiết bị được liên kết") }
        items(s.devices, key = { it.device_id }) { DeviceRow(it) }
        if (s.devices.isEmpty()) item { Text("Đăng ký laptop trên website, sau đó cài Windows Agent để liên kết.") }
        item { OutlinedButton(onClick = { vm.navigate(3, "add-child") }, modifier = Modifier.fillMaxWidth()) { Icon(Icons.Outlined.PersonAdd, null); Spacer(Modifier.width(8.dp)); Text("Thêm hồ sơ trẻ") } }
        item { HorizontalDivider() }
        item { LinkRow(Icons.Outlined.AccountCircle, "Tài khoản phụ huynh", "Thông báo, mật khẩu và đăng xuất") { vm.navigate(3, "account") } }
    }
}
@Composable private fun ChildEditor(vm: ParentViewModel, child: Child?) {
    var name by rememberSaveable(child?.child_id) { mutableStateOf(child?.name.orEmpty()) }
    var age by rememberSaveable(child?.child_id) { mutableStateOf(child?.age?.toString().orEmpty()) }
    var error by remember { mutableStateOf<String?>(null) }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(24.dp), verticalArrangement = Arrangement.spacedBy(18.dp)) {
        Text("Mỗi hồ sơ có lịch sử và chính sách sử dụng riêng.", color = MaterialTheme.colorScheme.onSurfaceVariant)
        Field("Tên của con", name, { name = it }, enabled = !vm.state.busy)
        Field("Tuổi (0–18)", age, { age = it }, KeyboardType.Number, !vm.state.busy)
        error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        Button(onClick = {
            val n = age.toIntOrNull()
            error = when { name.isBlank() || name.length > 100 -> "Tên cần từ 1 đến 100 ký tự."; n == null || n !in 0..18 -> "Tuổi cần từ 0 đến 18."; else -> null }
            if (error == null) vm.saveChild(child?.child_id, name, n!!)
        }, enabled = !vm.state.busy, modifier = Modifier.fillMaxWidth().heightIn(min = 52.dp)) { Text("Lưu hồ sơ") }
    }
}
