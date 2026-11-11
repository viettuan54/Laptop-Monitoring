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
import androidx.compose.animation.*
import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
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
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
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
    Scaffold(
        containerColor = MaterialTheme.colorScheme.background,
        snackbarHost = { SnackbarHost(snackbar) },
        topBar = {
            if (s.signedIn) TopAppBar(
                title = {
                    Text(
                        when(s.subpage) {
                            "breaks" -> "Lịch sử nhắc nghỉ"
                            "ai" -> "AI Advisor"
                            "policy" -> "Chính sách của con"
                            "account" -> "Tài khoản phụ huynh"
                            "add-child" -> "Thêm hồ sơ"
                            "edit-child" -> "Sửa hồ sơ"
                            else -> listOf("Tổng quan", "Hoạt động", "Cảnh báo", "Gia đình")[s.tab]
                        },
                        style = MaterialTheme.typography.titleLarge,
                        fontWeight = FontWeight.Bold
                    )
                },
                navigationIcon = {
                    if (s.subpage != null) {
                        IconButton(onClick = vm::back, enabled = !s.busy) {
                            Icon(Icons.AutoMirrored.Outlined.ArrowBack, "Quay lại")
                        }
                    }
                },
                actions = {
                    if (s.subpage == null) {
                        IconButton(onClick = { vm.loadFamily() }, enabled = !s.loading && !s.busy) {
                            Icon(Icons.Outlined.Refresh, "Tải lại dữ liệu")
                        }
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.surface,
                    titleContentColor = MaterialTheme.colorScheme.onSurface,
                    navigationIconContentColor = MaterialTheme.colorScheme.onSurface,
                    actionIconContentColor = MaterialTheme.colorScheme.onSurfaceVariant
                )
            )
        },
        bottomBar = {
            if (s.signedIn && s.subpage == null) NavigationBar(
                containerColor = MaterialTheme.colorScheme.surface,
                tonalElevation = 8.dp
            ) {
                val icons = listOf(Icons.Outlined.Home, Icons.Outlined.BarChart, Icons.Outlined.Notifications, Icons.Outlined.People)
                listOf("Tổng quan", "Hoạt động", "Cảnh báo", "Gia đình").forEachIndexed { index, label ->
                    NavigationBarItem(
                        selected = s.tab == index,
                        onClick = { vm.navigate(index) },
                        enabled = !s.busy,
                        icon = {
                            if (index == 2 && s.unreadAlertCount > 0) {
                                BadgedBox(
                                    badge = {
                                        Badge(
                                            containerColor = MaterialTheme.colorScheme.error,
                                            contentColor = Color.White
                                        ) {
                                            Text(if (s.unreadAlertCount > 99) "99+" else s.unreadAlertCount.toString())
                                        }
                                    }
                                ) {
                                    Icon(icons[index], null)
                                }
                            } else {
                                Icon(icons[index], null)
                            }
                        },
                        label = { Text(label, fontWeight = if (s.tab == index) FontWeight.SemiBold else FontWeight.Normal) },
                        colors = NavigationBarItemDefaults.colors(
                            selectedIconColor = MaterialTheme.colorScheme.primary,
                            selectedTextColor = MaterialTheme.colorScheme.primary,
                            indicatorColor = MaterialTheme.colorScheme.primaryContainer
                        ),
                        modifier = Modifier.testTag("tab-$index")
                    )
                }
            }
        }
    ) { inset ->
        Column(Modifier.fillMaxSize().padding(inset).imePadding()) {
            if (s.loading || s.busy) LinearProgressIndicator(
                Modifier.fillMaxWidth().height(3.dp).semantics { contentDescription = "Đang tải" },
                color = MaterialTheme.colorScheme.primary,
                trackColor = MaterialTheme.colorScheme.primaryContainer
            )
            s.error?.let { error ->
                Surface(
                    color = MaterialTheme.colorScheme.errorContainer,
                    shape = RoundedCornerShape(12.dp),
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp)
                ) {
                    Row(
                        Modifier.padding(horizontal = 16.dp, vertical = 10.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Icon(Icons.Outlined.ErrorOutline, null, tint = MaterialTheme.colorScheme.error, modifier = Modifier.size(20.dp))
                        Spacer(Modifier.width(10.dp))
                        Text(error, Modifier.weight(1f), color = MaterialTheme.colorScheme.onErrorContainer, style = MaterialTheme.typography.bodyMedium)
                        IconButton(onClick = vm::dismissError, modifier = Modifier.size(28.dp)) {
                            Icon(Icons.Outlined.Close, "Đóng thông báo lỗi", modifier = Modifier.size(16.dp))
                        }
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
                        if (!s.loading) EmptyScreen(
                            "Bắt đầu từ hồ sơ của con",
                            "Thêm hồ sơ để kết nối laptop và theo dõi hoạt động an toàn.",
                            Icons.Outlined.People,
                            "Thêm hồ sơ", { vm.navigate(3, "add-child") },
                            "Tài khoản", { vm.navigate(3, "account") }
                        )
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
    var password by remember { mutableStateOf("") }
    var name by rememberSaveable { mutableStateOf("") }
    var token by remember { mutableStateOf("") }
    var showServer by remember { mutableStateOf(false) }
    var server by remember { mutableStateOf(vm.graph.server) }
    var localError by remember { mutableStateOf<String?>(null) }
    val titles = mapOf(
        "login" to "Đăng nhập",
        "register" to "Tạo tài khoản",
        "forgot" to "Quên mật khẩu",
        "verify" to "Xác minh email",
        "resend" to "Gửi lại xác minh",
        "reset" to "Đặt lại mật khẩu"
    )
    BackHandler(enabled = mode != "login") { mode = "login"; password = ""; token = ""; localError = null }

    Column(
        Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 24.dp, vertical = 20.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        Spacer(Modifier.height(8.dp))
        Surface(
            shape = RoundedCornerShape(20.dp),
            color = MaterialTheme.colorScheme.primaryContainer,
            border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
            shadowElevation = 2.dp,
            modifier = Modifier.size(64.dp)
        ) {
            Box(contentAlignment = Alignment.Center) {
                Icon(
                    Icons.Outlined.LaptopChromebook,
                    null,
                    Modifier.size(34.dp),
                    tint = MaterialTheme.colorScheme.primary
                )
            }
        }
        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(
                "LaptopChildren",
                style = MaterialTheme.typography.headlineMedium,
                fontWeight = FontWeight.Bold,
                color = MaterialTheme.colorScheme.onBackground
            )
            Text(
                "Đồng hành cùng con trong thế giới số.",
                style = MaterialTheme.typography.bodyLarge,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }

        Surface(
            shape = RoundedCornerShape(20.dp),
            color = MaterialTheme.colorScheme.surface,
            border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
            shadowElevation = 1.dp,
            modifier = Modifier.fillMaxWidth()
        ) {
            Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
                Text(
                    titles[mode].orEmpty(),
                    style = MaterialTheme.typography.titleLarge,
                    fontWeight = FontWeight.Bold,
                    color = MaterialTheme.colorScheme.onSurface
                )

                if (mode == "register") Field("Tên phụ huynh", name, { name = it }, enabled = !vm.state.busy)
                if (mode !in setOf("verify", "reset")) Field("Email", email, { email = it }, KeyboardType.Email, !vm.state.busy, tag = "email")
                if (mode in setOf("verify", "reset")) {
                    Text("Dán mã token trong đường dẫn được gửi đến email của bạn.", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Field("Mã xác minh", token, { token = it }, enabled = !vm.state.busy)
                }
                if (mode in setOf("login", "register", "reset", "resend")) {
                    PasswordField(if (mode == "reset") "Mật khẩu mới" else "Mật khẩu", password, { password = it }, !vm.state.busy, "password")
                }
                if (mode == "register" || mode == "reset") {
                    Text("Ít nhất 8 ký tự, có chữ hoa, số và ký tự đặc biệt.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                localError?.let {
                    Surface(shape = RoundedCornerShape(8.dp), color = MaterialTheme.colorScheme.errorContainer) {
                        Text(it, color = MaterialTheme.colorScheme.onErrorContainer, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp))
                    }
                }
                Button(
                    onClick = {
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
                    },
                    enabled = !vm.state.busy,
                    shape = RoundedCornerShape(12.dp),
                    modifier = Modifier.fillMaxWidth().height(50.dp).testTag("sign-in")
                ) {
                    Text(if (vm.state.busy) "Đang xử lý…" else titles[mode].orEmpty(), fontWeight = FontWeight.SemiBold)
                }
                if (mode == "login") {
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                        TextButton(onClick = { mode = "forgot" }) { Text("Quên mật khẩu?", style = MaterialTheme.typography.bodySmall) }
                        TextButton(onClick = { mode = "register" }) { Text("Tạo tài khoản", style = MaterialTheme.typography.bodySmall, fontWeight = FontWeight.SemiBold) }
                    }
                    TextButton(onClick = { mode = "verify" }, modifier = Modifier.fillMaxWidth()) {
                        Text("Xác minh email / mã đã nhận", style = MaterialTheme.typography.bodySmall)
                    }
                } else {
                    TextButton(onClick = { mode = "login"; password = ""; localError = null }, modifier = Modifier.fillMaxWidth()) {
                        Text("Quay lại đăng nhập", fontWeight = FontWeight.Medium)
                    }
                    if (mode == "forgot") TextButton(onClick = { mode = "reset" }) { Text("Tôi đã có mã đặt lại mật khẩu") }
                    if (mode == "verify") TextButton(onClick = { mode = "resend" }) { Text("Gửi lại email xác minh") }
                }
            }
        }

        Surface(
            shape = RoundedCornerShape(16.dp),
            color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.6f),
            modifier = Modifier.fillMaxWidth()
        ) {
            Column(Modifier.padding(16.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text(
                    "Dùng tài khoản phụ huynh trên website để xem cùng dữ liệu của con.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
                TextButton(onClick = { showServer = true }, modifier = Modifier.testTag("server-settings")) {
                    Icon(Icons.Outlined.Settings, null, Modifier.size(16.dp))
                    Spacer(Modifier.width(6.dp))
                    Text("Thiết lập kết nối máy chủ", style = MaterialTheme.typography.labelMedium)
                }
            }
        }
    }

    if (showServer) AlertDialog(
        onDismissRequest = { showServer = false },
        title = { Text("Máy chủ kết nối", fontWeight = FontWeight.Bold) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text("Dùng địa chỉ API của hệ thống LaptopChildren.", style = MaterialTheme.typography.bodyMedium)
                Field("Địa chỉ HTTPS", server, { server = it }, KeyboardType.Uri, tag = "server-url")
                localError?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) }
            }
        },
        confirmButton = {
            Button(onClick = {
                runCatching { vm.graph.setServer(server) }.onSuccess { showServer = false; localError = null }.onFailure { localError = it.message }
            }) { Text("Lưu kết nối") }
        },
        dismissButton = { TextButton(onClick = { showServer = false }) { Text("Hủy") } }
    )
}

@Composable internal fun Field(
    label: String,
    value: String,
    change: (String) -> Unit,
    keyboard: KeyboardType = KeyboardType.Text,
    enabled: Boolean = true,
    tag: String = ""
) {
    OutlinedTextField(
        value = value,
        onValueChange = change,
        modifier = Modifier.fillMaxWidth().testTag(tag),
        label = { Text(label) },
        singleLine = true,
        enabled = enabled,
        keyboardOptions = KeyboardOptions(keyboardType = keyboard),
        shape = RoundedCornerShape(12.dp),
        colors = OutlinedTextFieldDefaults.colors(
            focusedBorderColor = MaterialTheme.colorScheme.primary,
            unfocusedBorderColor = MaterialTheme.colorScheme.outlineVariant,
            focusedContainerColor = MaterialTheme.colorScheme.surface,
            unfocusedContainerColor = MaterialTheme.colorScheme.surface
        )
    )
}

@Composable internal fun PasswordField(
    label: String,
    value: String,
    change: (String) -> Unit,
    enabled: Boolean = true,
    tag: String = ""
) {
    var visible by remember { mutableStateOf(false) }
    OutlinedTextField(
        value = value,
        onValueChange = change,
        modifier = Modifier.fillMaxWidth().testTag(tag),
        label = { Text(label) },
        singleLine = true,
        enabled = enabled,
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
        shape = RoundedCornerShape(12.dp),
        visualTransformation = if (visible) VisualTransformation.None else PasswordVisualTransformation(),
        trailingIcon = {
            IconButton(onClick = { visible = !visible }) {
                Icon(
                    if (visible) Icons.Outlined.VisibilityOff else Icons.Outlined.Visibility,
                    if (visible) "Ẩn mật khẩu" else "Hiện mật khẩu",
                    tint = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
        },
        colors = OutlinedTextFieldDefaults.colors(
            focusedBorderColor = MaterialTheme.colorScheme.primary,
            unfocusedBorderColor = MaterialTheme.colorScheme.outlineVariant,
            focusedContainerColor = MaterialTheme.colorScheme.surface,
            unfocusedContainerColor = MaterialTheme.colorScheme.surface
        )
    )
}

@Composable internal fun Selector(
    options: List<Pair<Long, String>>,
    selected: Long?,
    label: String,
    enabled: Boolean = true,
    select: (Long) -> Unit
) {
    var expanded by remember { mutableStateOf(false) }
    Box(Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 6.dp)) {
        Surface(
            shape = RoundedCornerShape(14.dp),
            color = MaterialTheme.colorScheme.surface,
            border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
            shadowElevation = 1.dp,
            modifier = Modifier.fillMaxWidth()
        ) {
            Row(
                Modifier
                    .clickable(enabled = enabled) { expanded = true }
                    .padding(horizontal = 16.dp, vertical = 10.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Surface(
                    shape = CircleShape,
                    color = MaterialTheme.colorScheme.primaryContainer,
                    modifier = Modifier.size(36.dp)
                ) {
                    Box(contentAlignment = Alignment.Center) {
                        Icon(Icons.Outlined.Person, null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(20.dp))
                    }
                }
                Spacer(Modifier.width(12.dp))
                Column(Modifier.weight(1f)) {
                    Text(label, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Text(
                        options.find { it.first == selected }?.second ?: "Chọn hồ sơ",
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.SemiBold,
                        color = MaterialTheme.colorScheme.onSurface
                    )
                }
                Icon(Icons.Outlined.ExpandMore, null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        DropdownMenu(expanded, { expanded = false }) {
            options.forEach { (id, name) ->
                DropdownMenuItem(
                    text = {
                        Text(
                            name,
                            fontWeight = if (id == selected) FontWeight.Bold else FontWeight.Normal,
                            color = if (id == selected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurface
                        )
                    },
                    leadingIcon = {
                        if (id == selected) Icon(Icons.Outlined.Check, null, tint = MaterialTheme.colorScheme.primary)
                        else Spacer(Modifier.size(24.dp))
                    },
                    onClick = { expanded = false; select(id) }
                )
            }
        }
    }
}

@Composable internal fun EmptyScreen(
    title: String,
    message: String,
    icon: ImageVector = Icons.Outlined.Inbox,
    action: String? = null,
    click: () -> Unit = {},
    secondary: String? = null,
    secondaryClick: () -> Unit = {}
) {
    Column(
        Modifier.fillMaxWidth().padding(32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        Surface(
            shape = CircleShape,
            color = MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.5f),
            modifier = Modifier.size(80.dp)
        ) {
            Box(contentAlignment = Alignment.Center) {
                Icon(icon, null, Modifier.size(40.dp), tint = MaterialTheme.colorScheme.primary)
            }
        }
        Text(title, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
        Text(message, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(horizontal = 8.dp))
        action?.let { Button(onClick = click, shape = RoundedCornerShape(12.dp)) { Text(it, fontWeight = FontWeight.SemiBold) } }
        secondary?.let { TextButton(onClick = secondaryClick) { Text(it) } }
    }
}

@Composable internal fun SectionTitle(text: String) {
    Text(
        text,
        style = MaterialTheme.typography.titleMedium,
        fontWeight = FontWeight.Bold,
        color = MaterialTheme.colorScheme.onBackground,
        modifier = Modifier.padding(top = 16.dp, bottom = 6.dp)
    )
}

@Composable internal fun LinkRow(icon: ImageVector, title: String, subtitle: String, badgeCount: Int = 0, click: () -> Unit) {
    Surface(
        shape = RoundedCornerShape(14.dp),
        color = MaterialTheme.colorScheme.surface,
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
        shadowElevation = 0.5.dp,
        modifier = Modifier.fillMaxWidth()
    ) {
        Row(
            Modifier
                .clickable(onClick = click)
                .padding(horizontal = 16.dp, vertical = 14.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Surface(
                shape = RoundedCornerShape(10.dp),
                color = MaterialTheme.colorScheme.primaryContainer,
                modifier = Modifier.size(40.dp)
            ) {
                Box(contentAlignment = Alignment.Center) {
                    Icon(icon, null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(22.dp))
                }
            }
            Spacer(Modifier.width(14.dp))
            Column(Modifier.weight(1f)) {
                Text(title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                Text(subtitle, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            if (badgeCount > 0) {
                Surface(
                    shape = CircleShape,
                    color = MaterialTheme.colorScheme.error,
                    modifier = Modifier.padding(end = 8.dp)
                ) {
                    Text(
                        if (badgeCount > 99) "99+" else badgeCount.toString(),
                        style = MaterialTheme.typography.labelSmall,
                        color = Color.White,
                        fontWeight = FontWeight.Bold,
                        modifier = Modifier.padding(horizontal = 8.dp, vertical = 3.dp)
                    )
                }
            }
            Icon(Icons.AutoMirrored.Outlined.NavigateNext, null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable private fun OverviewScreen(vm: ParentViewModel) {
    val s = vm.state
    LazyColumn(
        Modifier.fillMaxSize(),
        contentPadding = PaddingValues(20.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp)
    ) {
        item {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) {
                Column {
                    Text("Hôm nay của con", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
                    Text("${LocalDate.now(VietnamZone).dayOfMonth}/${LocalDate.now(VietnamZone).monthValue} · Giờ Việt Nam", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        }
        item {
            Surface(
                shape = RoundedCornerShape(20.dp),
                color = MaterialTheme.colorScheme.primary,
                shadowElevation = 4.dp,
                modifier = Modifier.fillMaxWidth()
            ) {
                Box(
                    modifier = Modifier.background(
                        Brush.linearGradient(
                            listOf(
                                MaterialTheme.colorScheme.primary,
                                MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.8f)
                            )
                        )
                    )
                ) {
                    Column(
                        Modifier.padding(22.dp),
                        verticalArrangement = Arrangement.spacedBy(10.dp)
                    ) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Icon(Icons.Outlined.AccessTime, null, tint = Color.White, modifier = Modifier.size(18.dp))
                            Spacer(Modifier.width(8.dp))
                            Text("Thời gian sử dụng laptop hôm nay", style = MaterialTheme.typography.labelMedium, color = Color.White.copy(alpha = 0.9f))
                        }
                        Text(
                            s.usage?.let { durationText(it.today_seconds) } ?: "Chưa tải dữ liệu",
                            style = MaterialTheme.typography.headlineLarge,
                            fontWeight = FontWeight.ExtraBold,
                            color = Color.White
                        )
                        Surface(
                            shape = RoundedCornerShape(8.dp),
                            color = Color.Black.copy(alpha = 0.15f)
                        ) {
                            Text(
                                "Tổng tháng này: ${s.usage?.let { durationText(it.month_total_seconds) } ?: "—"}",
                                style = MaterialTheme.typography.bodySmall,
                                color = Color.White.copy(alpha = 0.95f),
                                modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp)
                            )
                        }
                    }
                }
            }
        }
        s.usage?.let { usage ->
            item {
                Surface(
                    shape = RoundedCornerShape(16.dp),
                    color = MaterialTheme.colorScheme.surface,
                    border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
                    shadowElevation = 1.dp,
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Column(Modifier.padding(18.dp)) {
                        Text("Những ngày gần đây", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                        Spacer(Modifier.height(14.dp))
                        val days = usage.daily.filter { it.date <= LocalDate.now(VietnamZone).toString() }.takeLast(7)
                        if (days.isEmpty()) {
                            Text("Chưa có dữ liệu theo ngày.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        } else {
                            val max = days.maxOf { it.duration_seconds }.coerceAtLeast(60)
                            Row(
                                Modifier.fillMaxWidth().heightIn(min = 140.dp),
                                horizontalArrangement = Arrangement.spacedBy(8.dp),
                                verticalAlignment = Alignment.Bottom
                            ) {
                                days.forEach { day ->
                                    Column(
                                        Modifier.weight(1f).semantics(mergeDescendants = true) {
                                            contentDescription = "Ngày ${day.date}: ${durationText(day.duration_seconds)}"
                                        },
                                        horizontalAlignment = Alignment.CenterHorizontally
                                    ) {
                                        Text("${day.duration_seconds / 60}p", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(bottom = 4.dp))
                                        Box(
                                            Modifier
                                                .widthIn(max = 28.dp)
                                                .fillMaxWidth()
                                                .height((day.duration_seconds.toFloat() / max * 86).coerceAtLeast(4f).dp)
                                                .clip(RoundedCornerShape(topStart = 6.dp, topEnd = 6.dp))
                                                .background(
                                                    if (day.date == LocalDate.now(VietnamZone).toString()) MaterialTheme.colorScheme.primary
                                                    else MaterialTheme.colorScheme.primary.copy(alpha = 0.5f)
                                                )
                                        )
                                        Text(day.date.takeLast(2), style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.Medium, modifier = Modifier.padding(top = 8.dp))
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
        item { SectionTitle("Laptop của con") }
        if (s.devices.isEmpty()) item {
            Surface(
                shape = RoundedCornerShape(14.dp),
                color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f),
                modifier = Modifier.fillMaxWidth()
            ) {
                Text(
                    "Chưa có laptop được liên kết. Đăng ký thiết bị trên website rồi cài Windows Agent.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(16.dp)
                )
            }
        }
        items(s.devices, key = { it.device_id }) { device -> DeviceRow(device) }

        item { SectionTitle("Tiện ích quản lý") }
        item { LinkRow(Icons.Outlined.Notifications, "Xem cảnh báo", "Kiểm tra những hoạt động cần chú ý", badgeCount = s.unreadAlertCount) { vm.navigate(2) } }
        item { LinkRow(Icons.Outlined.AutoAwesome, "AI Advisor", "Phân tích, báo cáo và trò chuyện") { vm.navigate(3, "ai") } }
        item { LinkRow(Icons.Outlined.Tune, "Điều chỉnh chính sách", "Thời gian sử dụng và nhóm nội dung") { vm.navigate(3, "policy") } }
        item { UpdatedText(s.updated) }
    }
}

@Composable private fun DeviceRow(device: Device) {
    Surface(
        shape = RoundedCornerShape(14.dp),
        color = MaterialTheme.colorScheme.surface,
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
        shadowElevation = 0.5.dp,
        modifier = Modifier.fillMaxWidth()
    ) {
        Row(
            Modifier.padding(horizontal = 16.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Surface(
                shape = CircleShape,
                color = if (device.online) MaterialTheme.colorScheme.secondaryContainer else MaterialTheme.colorScheme.surfaceVariant,
                modifier = Modifier.size(42.dp)
            ) {
                Box(contentAlignment = Alignment.Center) {
                    Icon(
                        Icons.Outlined.LaptopChromebook,
                        null,
                        tint = if (device.online) MaterialTheme.colorScheme.secondary else MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.size(22.dp)
                    )
                }
            }
            Spacer(Modifier.width(14.dp))
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(device.device_name, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Box(
                        Modifier
                            .size(7.dp)
                            .clip(CircleShape)
                            .background(if (device.online) MaterialTheme.colorScheme.secondary else MaterialTheme.colorScheme.outline)
                    )
                    Spacer(Modifier.width(6.dp))
                    Text(
                        if (device.online) "Đang kết nối" else "Ngoại tuyến",
                        style = MaterialTheme.typography.bodySmall,
                        fontWeight = FontWeight.Medium,
                        color = if (device.online) MaterialTheme.colorScheme.secondary else MaterialTheme.colorScheme.onSurfaceVariant
                    )
                    Text(" · Lần cuối: ${dateText(device.last_seen_at)}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        }
    }
}

@Composable private fun UpdatedText(value: String?) {
    Row(
        Modifier.fillMaxWidth().padding(vertical = 4.dp),
        horizontalArrangement = Arrangement.Center,
        verticalAlignment = Alignment.CenterVertically
    ) {
        Icon(Icons.Outlined.Update, null, Modifier.size(13.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
        Spacer(Modifier.width(4.dp))
        Text("Cập nhật: ${dateText(value)}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable private fun DeviceFilter(vm: ParentViewModel) {
    Selector(vm.state.devices.map { it.device_id to it.device_name }, vm.state.deviceId, "Laptop đang xem", !vm.state.busy) { vm.selectDevice(it) }
}

@Composable private fun ActivityScreen(vm: ParentViewModel) {
    val s = vm.state
    if (s.devices.isEmpty()) {
        if (!s.loading) EmptyScreen("Chưa có laptop", "Liên kết laptop để bắt đầu xem hoạt động.", Icons.Outlined.LaptopChromebook)
        return
    }
    Column {
        DeviceFilter(vm)
        Row(
            Modifier
                .fillMaxWidth()
                .horizontalScroll(rememberScrollState())
                .padding(horizontal = 20.dp, vertical = 4.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            FilterChip(
                selected = s.kind == "app",
                onClick = { vm.setActivityFilter(kind = "app") },
                label = { Text("Ứng dụng") },
                leadingIcon = { Icon(Icons.Outlined.Apps, null, Modifier.size(16.dp)) }
            )
            FilterChip(
                selected = s.kind == "web",
                onClick = { vm.setActivityFilter(kind = "web") },
                label = { Text("Website") },
                leadingIcon = { Icon(Icons.Outlined.Language, null, Modifier.size(16.dp)) }
            )
            FilterChip(
                selected = s.kind == "screenshots",
                onClick = { vm.setActivityFilter(kind = "screenshots") },
                label = { Text("Ảnh màn hình") },
                leadingIcon = { Icon(Icons.Outlined.PhotoCamera, null, Modifier.size(16.dp)) },
                enabled = !s.busy
            )
            if (s.kind != "screenshots") {
                VerticalDivider(Modifier.height(28.dp).padding(horizontal = 4.dp))
                FilterChip(
                    selected = s.days == 1,
                    onClick = { vm.setActivityFilter(days = 1) },
                    label = { Text("Hôm nay") }
                )
                FilterChip(
                    selected = s.days == 7,
                    onClick = { vm.setActivityFilter(days = 7) },
                    label = { Text("7 ngày") }
                )
            }
        }
        if (s.kind == "screenshots") { ScreenshotsScreen(vm); return@Column }

        LazyColumn(
            Modifier.fillMaxSize(),
            contentPadding = PaddingValues(horizontal = 20.dp, vertical = 12.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            if (s.activity.isEmpty() && !s.loading) item {
                EmptyScreen("Chưa có hoạt động", "Không có dữ liệu trong khoảng thời gian đã chọn.", Icons.Outlined.HourglassEmpty)
            }
            items(s.activity, key = { it.log_id }) { row ->
                Surface(
                    shape = RoundedCornerShape(12.dp),
                    color = MaterialTheme.colorScheme.surface,
                    border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Row(
                        Modifier.padding(horizontal = 14.dp, vertical = 12.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Surface(
                            shape = RoundedCornerShape(8.dp),
                            color = MaterialTheme.colorScheme.primaryContainer,
                            modifier = Modifier.size(38.dp)
                        ) {
                            Box(contentAlignment = Alignment.Center) {
                                Icon(
                                    if (s.kind == "app") Icons.Outlined.Apps else Icons.Outlined.Language,
                                    null,
                                    tint = MaterialTheme.colorScheme.primary,
                                    modifier = Modifier.size(20.dp)
                                )
                            }
                        }
                        Spacer(Modifier.width(12.dp))
                        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                            Text(
                                if (s.kind == "app") row.product_name?.takeIf { it.isNotBlank() } ?: row.app_name.orEmpty()
                                else row.domain.orEmpty(),
                                style = MaterialTheme.typography.titleMedium,
                                fontWeight = FontWeight.SemiBold
                            )
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Surface(
                                    shape = RoundedCornerShape(4.dp),
                                    color = MaterialTheme.colorScheme.surfaceVariant
                                ) {
                                    Text(
                                        categoryText(row.category),
                                        style = MaterialTheme.typography.labelSmall,
                                        modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp)
                                    )
                                }
                                Spacer(Modifier.width(8.dp))
                                Text(
                                    dateText(row.start_time ?: row.visit_time),
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant
                                )
                            }
                        }
                        if (s.kind == "app") {
                            Text(
                                durationText(row.duration_seconds ?: 0),
                                style = MaterialTheme.typography.labelLarge,
                                fontWeight = FontWeight.Bold,
                                color = MaterialTheme.colorScheme.primary
                            )
                        }
                    }
                }
            }
            if (s.hasMore) item {
                TextButton(
                    onClick = { vm.refreshRows(true) },
                    enabled = !s.loading,
                    modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp)
                ) {
                    Text("Tải thêm hoạt động", fontWeight = FontWeight.SemiBold)
                }
            }
            item { UpdatedText(s.updated) }
        }
    }
}

@Composable private fun AlertsScreen(vm: ParentViewModel) {
    val s = vm.state
    if (s.devices.isEmpty()) {
        if (!s.loading) EmptyScreen("Chưa có laptop", "Cảnh báo sẽ xuất hiện sau khi thiết bị gửi dữ liệu.", Icons.Outlined.NotificationsNone)
        return
    }
    Column {
        DeviceFilter(vm)
        Row(Modifier.padding(horizontal = 20.dp, vertical = 4.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            FilterChip(
                selected = !s.unreadOnly,
                onClick = { vm.unreadOnly(false) },
                label = { Text("Tất cả") }
            )
            FilterChip(
                selected = s.unreadOnly,
                onClick = { vm.unreadOnly(true) },
                label = { Text("Chưa đọc") }
            )
        }
        LazyColumn(
            Modifier.fillMaxSize(),
            contentPadding = PaddingValues(horizontal = 20.dp, vertical = 10.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            if (s.alerts.isEmpty() && !s.loading) item {
                EmptyScreen("Không có cảnh báo${if (s.unreadOnly) " chưa đọc" else ""}", "Bạn có thể tải lại để kiểm tra cập nhật mới.", Icons.Outlined.NotificationsNone)
            }
            items(s.alerts, key = { it.alert_id }) { alert ->
                Surface(
                    shape = RoundedCornerShape(14.dp),
                    color = if (alert.is_read) MaterialTheme.colorScheme.surface else MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.45f),
                    border = BorderStroke(
                        1.dp,
                        if (alert.is_read) MaterialTheme.colorScheme.outlineVariant else MaterialTheme.colorScheme.primary.copy(alpha = 0.5f)
                    ),
                    shadowElevation = if (alert.is_read) 0.5.dp else 1.5.dp
                ) {
                    Column(Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                            Surface(
                                shape = RoundedCornerShape(6.dp),
                                color = if (alert.is_read) MaterialTheme.colorScheme.surfaceVariant else MaterialTheme.colorScheme.primary
                            ) {
                                Text(
                                    if (alert.is_read) "Đã đọc" else "Cần chú ý",
                                    style = MaterialTheme.typography.labelSmall,
                                    color = if (alert.is_read) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.onPrimary,
                                    fontWeight = FontWeight.Bold,
                                    modifier = Modifier.padding(horizontal = 8.dp, vertical = 3.dp)
                                )
                            }
                            Text(dateText(alert.created_at), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                        Text(
                            alert.message,
                            style = MaterialTheme.typography.bodyLarge,
                            fontWeight = if (alert.is_read) FontWeight.Normal else FontWeight.SemiBold,
                            color = MaterialTheme.colorScheme.onSurface
                        )
                        if (alert.alert_type.startsWith("text_")) {
                            Text(
                                "Đây là tín hiệu từ phân tích tự động. Hãy xem xét bối cảnh và trao đổi với con.",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                        if (!alert.is_read) {
                            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                                Button(
                                    onClick = { vm.markRead(alert) },
                                    enabled = !s.busy,
                                    shape = RoundedCornerShape(8.dp),
                                    contentPadding = PaddingValues(horizontal = 14.dp, vertical = 6.dp)
                                ) {
                                    Icon(Icons.Outlined.Check, null, Modifier.size(16.dp))
                                    Spacer(Modifier.width(6.dp))
                                    Text("Đánh dấu đã đọc", style = MaterialTheme.typography.labelMedium)
                                }
                            }
                        }
                    }
                }
            }
            if (s.hasMore) item {
                TextButton(
                    onClick = { vm.refreshRows(true) },
                    enabled = !s.loading,
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Text("Tải thêm cảnh báo", fontWeight = FontWeight.SemiBold)
                }
            }
            item { UpdatedText(s.updated) }
        }
    }
}

@Composable private fun FamilyScreen(vm: ParentViewModel) {
    val s = vm.state
    val child = s.children.find { it.child_id == s.childId }
    LazyColumn(
        Modifier.fillMaxSize().testTag("family-list"),
        contentPadding = PaddingValues(20.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp)
    ) {
        item {
            Surface(
                shape = RoundedCornerShape(18.dp),
                color = MaterialTheme.colorScheme.surface,
                border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
                shadowElevation = 1.dp,
                modifier = Modifier.fillMaxWidth()
            ) {
                Row(
                    Modifier.padding(18.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Surface(
                        shape = CircleShape,
                        color = MaterialTheme.colorScheme.primaryContainer,
                        modifier = Modifier.size(54.dp)
                    ) {
                        Box(contentAlignment = Alignment.Center) {
                            Icon(Icons.Outlined.Face, null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(32.dp))
                        }
                    }
                    Spacer(Modifier.width(16.dp))
                    Column(Modifier.weight(1f)) {
                        Text(child?.name.orEmpty(), style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
                        Text(child?.age?.let { "$it tuổi" } ?: "Chưa cập nhật tuổi", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    IconButton(onClick = { vm.navigate(3, "edit-child") }) {
                        Icon(Icons.Outlined.Edit, "Sửa hồ sơ", tint = MaterialTheme.colorScheme.primary)
                    }
                }
            }
        }
        item { SectionTitle("Theo dõi & Báo cáo") }
        item { LinkRow(Icons.Outlined.History, "Lịch sử nhắc nghỉ", "Phản hồi gần nhất từ laptop của con") { vm.openBreakHistory() } }
        item { LinkRow(Icons.Outlined.AutoAwesome, "AI Advisor", "Phân tích, báo cáo và trò chuyện") { vm.navigate(3, "ai") } }
        item { LinkRow(Icons.Outlined.Tune, "Chính sách sử dụng", "Giới hạn, lịch sử dụng và nội dung") { vm.navigate(3, "policy") } }

        item { SectionTitle("Thiết bị được liên kết") }
        items(s.devices, key = { it.device_id }) { DeviceRow(it) }
        if (s.devices.isEmpty()) item {
            Text("Đăng ký laptop trên website, sau đó cài Windows Agent để liên kết.", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        item {
            OutlinedButton(
                onClick = { vm.navigate(3, "add-child") },
                shape = RoundedCornerShape(12.dp),
                modifier = Modifier.fillMaxWidth().height(48.dp)
            ) {
                Icon(Icons.Outlined.PersonAdd, null)
                Spacer(Modifier.width(8.dp))
                Text("Thêm hồ sơ trẻ", fontWeight = FontWeight.SemiBold)
            }
        }
        item { HorizontalDivider(Modifier.padding(vertical = 4.dp)) }
        item { LinkRow(Icons.Outlined.AccountCircle, "Tài khoản phụ huynh", "Thông báo, mật khẩu và đăng xuất") { vm.navigate(3, "account") } }
    }
}

@Composable private fun ChildEditor(vm: ParentViewModel, child: Child?) {
    var name by rememberSaveable(child?.child_id) { mutableStateOf(child?.name.orEmpty()) }
    var age by rememberSaveable(child?.child_id) { mutableStateOf(child?.age?.toString().orEmpty()) }
    var error by remember { mutableStateOf<String?>(null) }
    Column(
        Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(18.dp)
    ) {
        Surface(
            shape = RoundedCornerShape(16.dp),
            color = MaterialTheme.colorScheme.surface,
            border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
            modifier = Modifier.fillMaxWidth()
        ) {
            Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                Text(if (child == null) "Thêm hồ sơ con" else "Chỉnh sửa hồ sơ", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                Text("Mỗi hồ sơ có lịch sử và chính sách sử dụng riêng.", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Field("Tên của con", name, { name = it }, enabled = !vm.state.busy)
                Field("Tuổi (0–18)", age, { age = it }, KeyboardType.Number, !vm.state.busy)
                error?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) }
                Button(
                    onClick = {
                        val n = age.toIntOrNull()
                        error = when {
                            name.isBlank() || name.length > 100 -> "Tên cần từ 1 đến 100 ký tự."
                            n == null || n !in 0..18 -> "Tuổi cần từ 0 đến 18."
                            else -> null
                        }
                        if (error == null) vm.saveChild(child?.child_id, name, n!!)
                    },
                    enabled = !vm.state.busy,
                    shape = RoundedCornerShape(12.dp),
                    modifier = Modifier.fillMaxWidth().height(50.dp)
                ) {
                    Text("Lưu hồ sơ", fontWeight = FontWeight.SemiBold)
                }
            }
        }
    }
}
