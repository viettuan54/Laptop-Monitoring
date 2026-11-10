package vn.laptopchildren.parent.ui

import android.graphics.BitmapFactory
import android.util.Base64
import androidx.compose.foundation.Image
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.rememberTransformableState
import androidx.compose.foundation.gestures.transformable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.testTag
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
    LazyColumn(Modifier.fillMaxSize().testTag("screenshots-list"), contentPadding = PaddingValues(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        item {
            Text("Ảnh màn hình laptop", style = MaterialTheme.typography.titleLarge)
            Text("Ảnh được giữ tối đa 7 ngày. Chạm vào ảnh để xem lớn.", style = MaterialTheme.typography.bodyMedium)
        }
        item {
            val monitor = s.captureMonitor
            Text(when (monitor?.enabled) { true -> "Chụp định kỳ: đã bật"; false -> "Chụp định kỳ: đã tắt"; null -> "Chưa tải được trạng thái chụp" })
            Text("Thiết lập áp dụng cho tất cả laptop của $child. Laptop cần kết nối để nhận thay đổi.", style = MaterialTheme.typography.bodySmall)
            if (monitor != null) OutlinedButton(onClick = { captureChange = !monitor.enabled }, enabled = !s.busy && !s.loading) {
                Text(if (monitor.enabled) "Tắt chụp" else "Bật chụp")
            }
            TextButton(onClick = { vm.refreshRows() }, enabled = !s.busy && !s.loading) { Text("Tải lại ảnh") }
        }
        if (s.screenshots.isEmpty() && !s.loading) item {
            Text(if (s.error != null) "Chưa tải được ảnh. Kiểm tra kết nối rồi tải lại."
                else "Chưa có ảnh cho laptop này. Khi bật chụp, ảnh sẽ xuất hiện sau khi Agent gửi lên.")
        }
        items(s.screenshots, key = { it.screenshot_id }) { row ->
            val bitmap = screenshotBitmap(row.thumbnail_base64)
            Surface(onClick = { vm.openScreenshot(row) }, enabled = !s.busy, modifier = Modifier.fillMaxWidth().testTag("screenshot-${row.screenshot_id}")) {
                Box(Modifier.fillMaxWidth().aspectRatio(16f / 9f), contentAlignment = Alignment.Center) {
                    if (bitmap != null) Image(bitmap, "Xem ảnh $device lúc ${dateText(row.captured_at)}", Modifier.fillMaxSize(), contentScale = ContentScale.Fit)
                    else Text("Chạm để tải ảnh đầy đủ")
                }
            }
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Text(dateText(row.captured_at), Modifier.weight(1f), style = MaterialTheme.typography.bodySmall)
                TextButton(onClick = { deleting = row }, enabled = !s.busy, modifier = Modifier.testTag("delete-screenshot-${row.screenshot_id}")) { Text("Xóa ảnh") }
            }
            HorizontalDivider()
        }
        if (s.hasMore) item { TextButton(onClick = { vm.refreshRows(true) }, enabled = !s.busy && !s.loading) { Text("Tải thêm ảnh") } }
    }
    captureChange?.let { enabled ->
        AlertDialog(onDismissRequest = { captureChange = null }, title = { Text(if (enabled) "Bật chụp màn hình?" else "Tắt chụp màn hình?") },
            text = { Text("Áp dụng cho tất cả laptop của $child. " + if (enabled)
                "Ảnh có thể chứa thông tin riêng tư. Hãy trao đổi với con trước khi bật. Laptop sẽ chụp sau khi nhận cấu hình."
                else "Laptop sẽ dừng khi nhận cấu hình mới. Ảnh đã lưu không bị xóa.") },
            confirmButton = { TextButton(onClick = { captureChange = null; vm.setCapture(enabled) }) { Text("Xác nhận") } },
            dismissButton = { TextButton(onClick = { captureChange = null }) { Text("Hủy") } })
    }
    deleting?.let { row ->
        AlertDialog(onDismissRequest = { deleting = null }, title = { Text("Xóa ảnh này?") },
            text = { Text("Ảnh của $device lúc ${dateText(row.captured_at)} sẽ bị xóa khỏi máy chủ và không thể khôi phục.") },
            confirmButton = { TextButton(onClick = { deleting = null; vm.deleteScreenshot(row) }, modifier = Modifier.testTag("confirm-delete-screenshot")) { Text("Xóa ảnh") } },
            dismissButton = { TextButton(onClick = { deleting = null }) { Text("Hủy") } })
    }
    s.screenshot?.let { row ->
        Dialog(onDismissRequest = vm::closeScreenshot, properties = DialogProperties(usePlatformDefaultWidth = false)) {
            Surface(Modifier.fillMaxSize()) {
                Column(Modifier.fillMaxSize().safeDrawingPadding().padding(12.dp)) {
                    Text(device, style = MaterialTheme.typography.titleMedium)
                    Text(dateText(row.captured_at), style = MaterialTheme.typography.bodySmall)
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
                            s.imageError != null -> Column(horizontalAlignment = Alignment.CenterHorizontally) {
                                Text(s.imageError)
                                TextButton(onClick = { vm.openScreenshot(row) }) { Text("Thử lại") }
                            }
                            bitmap != null -> Image(bitmap, "Ảnh màn hình $device", Modifier.fillMaxSize().graphicsLayer {
                                scaleX = scale; scaleY = scale; translationX = pan.x; translationY = pan.y
                            }, contentScale = ContentScale.Fit)
                            else -> Text("Không đọc được dữ liệu ảnh.")
                        }
                    }
                    Text("Dùng hai ngón để phóng to và kéo ảnh.", style = MaterialTheme.typography.bodySmall)
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                        TextButton(onClick = { scale = (scale + 1f).coerceAtMost(5f) }, enabled = bitmap != null && scale < 5f) { Text("Phóng to") }
                        TextButton(onClick = { scale = 1f; pan = Offset.Zero }, enabled = bitmap != null) { Text("Đặt lại") }
                        TextButton(onClick = vm::closeScreenshot) { Text("Đóng ảnh") }
                    }
                }
            }
        }
    }
}
