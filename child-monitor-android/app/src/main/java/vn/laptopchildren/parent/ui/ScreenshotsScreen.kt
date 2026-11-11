package vn.laptopchildren.parent.ui

import android.graphics.BitmapFactory
import android.util.Base64
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Image
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.rememberTransformableState
import androidx.compose.foundation.gestures.transformable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.DeleteOutline
import androidx.compose.material.icons.outlined.PhotoCamera
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material.icons.outlined.ZoomIn
import androidx.compose.material.icons.outlined.ZoomOut
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import vn.laptopchildren.parent.ParentViewModel
import vn.laptopchildren.parent.data.*

/** Decode away from the UI thread; never persist a child's screenshot to disk. */
@Composable private fun screenshotBitmap(encoded: String?): ImageBitmap? {
    val bitmap by produceState<ImageBitmap?>(null, encoded) {
        value = null
        value = withContext(Dispatchers.Default) {
            runCatching {
                if (encoded.isNullOrBlank() || encoded.length > 2_000_000) return@runCatching null
                val bytes = Base64.decode(encoded, Base64.DEFAULT)
                val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
                BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
                if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return@runCatching null
                var sample = 1
                while (bounds.outWidth / sample > 2048 || bounds.outHeight / sample > 2048) sample *= 2
                BitmapFactory.decodeByteArray(bytes, 0, bytes.size, BitmapFactory.Options().apply { inSampleSize = sample })?.asImageBitmap()
            }.getOrNull()
        }
    }
    return bitmap
}

@Composable internal fun ScreenshotsScreen(vm: ParentViewModel) {
    val s = vm.state
    var deleting by remember(s.childId, s.deviceId) { mutableStateOf<Screenshot?>(null) }
    var captureChange by remember(s.childId, s.deviceId) { mutableStateOf<Boolean?>(null) }
    val child = s.children.find { it.child_id == s.childId }?.name.orEmpty()
    val device = s.devices.find { it.device_id == s.deviceId }?.device_name.orEmpty()

    LazyColumn(
        Modifier.fillMaxSize().testTag("screenshots-list"),
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
                            shape = RoundedCornerShape(10.dp),
                            color = MaterialTheme.colorScheme.primaryContainer,
                            modifier = Modifier.size(38.dp)
                        ) {
                            Box(contentAlignment = Alignment.Center) {
                                Icon(Icons.Outlined.PhotoCamera, null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(20.dp))
                            }
                        }
                        Spacer(Modifier.width(12.dp))
                        Column {
                            Text("Ảnh màn hình laptop", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                            Text("Giữ tối đa 7 ngày · Chạm để xem chi tiết", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }

                    val monitor = s.captureMonitor
                    Surface(
                        shape = RoundedCornerShape(10.dp),
                        color = if (monitor?.enabled == true) MaterialTheme.colorScheme.secondaryContainer else MaterialTheme.colorScheme.surfaceVariant
                    ) {
                        Row(
                            Modifier.padding(horizontal = 12.dp, vertical = 6.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Text(
                                when (monitor?.enabled) {
                                    true -> "Trạng thái: Đang chụp định kỳ"
                                    false -> "Trạng thái: Đã tắt chụp"
                                    null -> "Chưa tải được trạng thái chụp"
                                },
                                style = MaterialTheme.typography.labelMedium,
                                fontWeight = FontWeight.SemiBold,
                                color = if (monitor?.enabled == true) MaterialTheme.colorScheme.onSecondaryContainer else MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                    }

                    Text("Thiết lập áp dụng cho tất cả laptop của $child. Laptop cần kết nối để nhận thay đổi.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)

                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        if (monitor != null) {
                            Button(
                                onClick = { captureChange = !monitor.enabled },
                                enabled = !s.busy && !s.loading,
                                shape = RoundedCornerShape(10.dp),
                                modifier = Modifier.weight(1f)
                            ) {
                                Text(if (monitor.enabled) "Tắt chụp" else "Bật chụp", fontWeight = FontWeight.SemiBold)
                            }
                        }
                        OutlinedButton(
                            onClick = { vm.refreshRows() },
                            enabled = !s.busy && !s.loading,
                            shape = RoundedCornerShape(10.dp),
                            modifier = Modifier.weight(1f)
                        ) {
                            Icon(Icons.Outlined.Refresh, null, Modifier.size(16.dp))
                            Spacer(Modifier.width(6.dp))
                            Text("Tải lại ảnh")
                        }
                    }
                }
            }
        }
        if (s.screenshots.isEmpty() && !s.loading) item {
            Surface(
                shape = RoundedCornerShape(14.dp),
                color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f),
                modifier = Modifier.fillMaxWidth()
            ) {
                Text(
                    if (s.error != null) "Chưa tải được ảnh. Kiểm tra kết nối rồi tải lại."
                    else "Chưa có ảnh cho laptop này. Khi bật chụp, ảnh sẽ xuất hiện sau khi Agent gửi lên.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(18.dp)
                )
            }
        }
        items(s.screenshots, key = { it.screenshot_id }) { row ->
            val bitmap = screenshotBitmap(row.thumbnail_base64)
            Surface(
                shape = RoundedCornerShape(16.dp),
                color = MaterialTheme.colorScheme.surface,
                border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
                shadowElevation = 1.dp,
                modifier = Modifier.fillMaxWidth()
            ) {
                Column {
                    Surface(
                        onClick = { vm.openScreenshot(row) },
                        enabled = !s.busy,
                        modifier = Modifier.fillMaxWidth().testTag("screenshot-${row.screenshot_id}")
                    ) {
                        Box(
                            Modifier
                                .fillMaxWidth()
                                .aspectRatio(16f / 9f)
                                .clip(RoundedCornerShape(topStart = 16.dp, topEnd = 16.dp)),
                            contentAlignment = Alignment.Center
                        ) {
                            if (bitmap != null) {
                                Image(
                                    bitmap,
                                    "Xem ảnh $device lúc ${dateText(row.captured_at)}",
                                    Modifier.fillMaxSize(),
                                    contentScale = ContentScale.Fit
                                )
                            } else {
                                Text("Chạm để tải ảnh đầy đủ", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                        }
                    }
                    Row(
                        Modifier.padding(horizontal = 14.dp, vertical = 8.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Column(Modifier.weight(1f)) {
                            Text(dateText(row.captured_at), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                        TextButton(
                            onClick = { deleting = row },
                            enabled = !s.busy,
                            modifier = Modifier.testTag("delete-screenshot-${row.screenshot_id}")
                        ) {
                            Icon(Icons.Outlined.DeleteOutline, null, Modifier.size(16.dp), tint = MaterialTheme.colorScheme.error)
                            Spacer(Modifier.width(4.dp))
                            Text("Xóa ảnh", color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.labelMedium)
                        }
                    }
                }
            }
        }
        if (s.hasMore) item {
            TextButton(
                onClick = { vm.refreshRows(true) },
                enabled = !s.busy && !s.loading,
                modifier = Modifier.fillMaxWidth()
            ) { Text("Tải thêm ảnh", fontWeight = FontWeight.SemiBold) }
        }
    }

    captureChange?.let { enabled ->
        AlertDialog(
            onDismissRequest = { captureChange = null },
            title = { Text(if (enabled) "Bật chụp màn hình?" else "Tắt chụp màn hình?", fontWeight = FontWeight.Bold) },
            text = {
                Text("Áp dụng cho tất cả laptop của $child. " + if (enabled)
                    "Ảnh có thể chứa thông tin riêng tư. Hãy trao đổi với con trước khi bật. Laptop sẽ chụp sau khi nhận cấu hình."
                    else "Laptop sẽ dừng khi nhận cấu hình mới. Ảnh đã lưu không bị xóa.")
            },
            confirmButton = { TextButton(onClick = { captureChange = null; vm.setCapture(enabled) }) { Text("Xác nhận") } },
            dismissButton = { TextButton(onClick = { captureChange = null }) { Text("Hủy") } }
        )
    }

    deleting?.let { row ->
        AlertDialog(
            onDismissRequest = { deleting = null },
            title = { Text("Xóa ảnh này?", fontWeight = FontWeight.Bold) },
            text = { Text("Ảnh của $device lúc ${dateText(row.captured_at)} sẽ bị xóa khỏi máy chủ và không thể khôi phục.") },
            confirmButton = {
                TextButton(
                    onClick = { deleting = null; vm.deleteScreenshot(row) },
                    modifier = Modifier.testTag("confirm-delete-screenshot")
                ) { Text("Xóa ảnh", color = MaterialTheme.colorScheme.error) }
            },
            dismissButton = { TextButton(onClick = { deleting = null }) { Text("Hủy") } }
        )
    }

    s.screenshot?.let { row ->
        Dialog(onDismissRequest = vm::closeScreenshot, properties = DialogProperties(usePlatformDefaultWidth = false)) {
            Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.surface) {
                Column(Modifier.fillMaxSize().safeDrawingPadding().padding(16.dp)) {
                    Row(
                        Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Column {
                            Text(device, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                            Text(dateText(row.captured_at), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                        IconButton(onClick = vm::closeScreenshot) {
                            Icon(Icons.Outlined.Close, "Đóng ảnh")
                        }
                    }
                    val bitmap = screenshotBitmap(row.image_base64)
                    var scale by remember(row.screenshot_id) { mutableFloatStateOf(1f) }
                    var pan by remember(row.screenshot_id) { mutableStateOf(Offset.Zero) }
                    val transform = rememberTransformableState { zoom, offset, _ ->
                        scale = (scale * zoom).coerceIn(1f, 5f)
                        pan = if (scale == 1f) Offset.Zero else pan + offset
                    }
                    Box(Modifier.weight(1f).fillMaxWidth().clipToBounds().transformable(transform), contentAlignment = Alignment.Center) {
                        when {
                            s.imageLoading -> CircularProgressIndicator()
                            s.imageError != null -> Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp)) {
                                Text(s.imageError, color = MaterialTheme.colorScheme.error)
                                OutlinedButton(onClick = { vm.openScreenshot(row) }) { Text("Thử lại") }
                            }
                            bitmap != null -> Image(
                                bitmap,
                                "Ảnh màn hình $device",
                                Modifier.fillMaxSize().graphicsLayer {
                                    scaleX = scale; scaleY = scale; translationX = pan.x; translationY = pan.y
                                },
                                contentScale = ContentScale.Fit
                            )
                            else -> Text("Không đọc được dữ liệu ảnh.")
                        }
                    }
                    Text("Dùng hai ngón để phóng to và di chuyển ảnh.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                        TextButton(onClick = { scale = (scale + 1f).coerceAtMost(5f) }, enabled = bitmap != null && scale < 5f) {
                            Icon(Icons.Outlined.ZoomIn, null, Modifier.size(18.dp))
                            Spacer(Modifier.width(4.dp))
                            Text("Phóng to")
                        }
                        TextButton(onClick = { scale = 1f; pan = Offset.Zero }, enabled = bitmap != null) {
                            Icon(Icons.Outlined.ZoomOut, null, Modifier.size(18.dp))
                            Spacer(Modifier.width(4.dp))
                            Text("Đặt lại")
                        }
                        Button(onClick = vm::closeScreenshot, shape = RoundedCornerShape(8.dp)) { Text("Đóng ảnh") }
                    }
                }
            }
        }
    }
}
