package vn.laptopchildren.parent.data

import com.google.gson.annotations.SerializedName
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

data class Tokens(val accessToken: String = "", val refreshToken: String = "")
data class Child(val child_id: Long, val name: String, val age: Int? = null)
data class Device(val device_id: Long, val child_id: Long, val device_name: String,
    val online: Boolean = false, val last_seen_at: String? = null,
    val vision_session_id: String? = null, val vision_session_status: String? = null)
data class Page<T>(val data: List<T> = emptyList(), val count: Int = 0)
data class DayUsage(val date: String, val duration_seconds: Long)
data class Usage(val today_seconds: Long = 0, val month_total_seconds: Long = 0,
    val daily: List<DayUsage> = emptyList())
data class ActivityLog(val log_id: Long, val device_id: Long, val app_name: String? = null,
    val product_name: String? = null, val domain: String? = null, val category: String? = null,
    val start_time: String? = null, val visit_time: String? = null, val duration_seconds: Long? = null,
    val access_status: String? = null)
data class AppEnforcement(val event_id: Long, val device_id: Long, val app_name: String,
    val category: String? = null, val occurred_at: String, val requested_at: String? = null,
    val outcome: String, val reason: String? = null)
fun enforcementOutcome(value: String) = when (value) {
    "closed" -> "Đã đóng ứng dụng"
    "failed" -> "Đóng không thành công"
    "cancelled" -> "Đã hủy yêu cầu"
    else -> "Chưa rõ kết quả"
}
fun enforcementReason(value: String?) = when (value) {
    "graceful_exit" -> "Ứng dụng đã thoát"
    "terminated" -> "Agent đã kết thúc tiến trình"
    "access_denied" -> "Không đủ quyền đóng ứng dụng"
    "termination_timeout" -> "Hết thời gian chờ đóng ứng dụng"
    "policy_changed" -> "Chính sách đã thay đổi"
    "session_changed" -> "Phiên sử dụng đã thay đổi"
    "service_stopped" -> "Dịch vụ giám sát đã dừng"
    else -> "Không có thông tin nguyên nhân"
}
data class Alert(val alert_id: Long, val device_id: Long, val alert_type: String,
    val message: String, val is_read: Boolean, val created_at: String)

fun alertTypeLabel(type: String): String = when (type) {
    "posture_warning" -> "Tư thế ngồi"
    "eye_distance_warning" -> "Khoảng cách mắt"
    "text_high_risk" -> "Nội dung · nguy cơ cao"
    "text_risk", "text_warning" -> "Cảnh báo nội dung"
    "blocked_website" -> "Website bị chặn"
    "blocked_app" -> "Ứng dụng bị chặn"
    else -> if (type.startsWith("text_")) "Phân tích nội dung" else "Cảnh báo khác"
}
data class Settings(val child_id: Long = 0, val daily_limit_minutes: Int = 120,
    val allowed_start_time: String = "07:00:00", val allowed_end_time: String = "21:00:00",
    val is_locked: Boolean = false, val enable_app_classification: Boolean = false,
    val enable_web_classification: Boolean = false, val enable_text_moderation: Boolean = false,
    val enable_webcam_monitoring: Boolean = false, val enable_screenshot_review: Boolean = false,
    val screenshot_interval_minutes: Int = 5,
    val enable_break_reminders: Boolean = false, val break_interval_minutes: Int = 30,
    val break_duration_minutes: Int = 5,
    val enable_posture_monitoring: Boolean? = null,
    val enable_eye_distance_monitoring: Boolean? = null,
    val vision_session_minutes: Int = 5, val vision_session_id: String? = null) {
    val postureMonitoringEnabled: Boolean get() = enable_posture_monitoring ?: enable_webcam_monitoring
    val eyeDistanceMonitoringEnabled: Boolean get() = enable_eye_distance_monitoring ?: enable_webcam_monitoring
}
data class Policy(val resource_type: String, val category: String, val action: String)
data class Policies(val policies: List<Policy> = emptyList())
data class PushRegistration(val token: PushToken)
data class PushToken(val push_token_id: Long)
data class Message(val message: String = "")
data class BreakReminderEvent(val event_id: Long, val device_id: Long, val device_name: String?,
    val event_type: String, val interval_minutes: Int, val duration_minutes: Int, val occurred_at: String)
fun breakReminderLabel(type: String): String = when (type) {
    "shown" -> "Đã hiển thị lời nhắc"
    "acknowledged" -> "Trẻ chọn nghỉ ngay"
    "snoozed" -> "Nhắc lại sau 5 phút"
    else -> "Phản hồi khác"
}
data class AiAnalysis(val analysis_id: Long, val device_id: Long, val behavior_type: String,
    val risk_level: String, val suggestion: String, val analyzed_at: String)
data class AiSummary(val device_id: Long, val period: String, val summary: String)
data class ChatMessage(val role: String, val content: String)
data class ChatRequest(val messages: List<ChatMessage>)
data class ChatReply(val reply: String)
data class Screenshot(val screenshot_id: Long, val device_id: Long, val captured_at: String,
    val thumbnail_base64: String? = null, val image_base64: String? = null)
data class CaptureMonitor(val device_id: Long, val enabled: Boolean = false, val online: Boolean = false,
    val pending_request_id: String? = null, val request_expired: Boolean = false, val screenshot_interval_minutes: Int = 5)
data class CaptureRequest(val request_id: String, val online: Boolean, val pending: Boolean)
data class DeleteScreenshotsRequest(val through_id: String, val confirm_all: Boolean = true)
data class DeletedScreenshots(val deleted: Int)
data class ScreenshotPage(val data: List<Screenshot> = emptyList(), val total: Int = 0,
    val devices: List<CaptureMonitor> = emptyList(), val scope_latest_id: Long? = null)

val VietnamZone: ZoneId = ZoneId.of("Asia/Ho_Chi_Minh")
fun durationText(seconds: Long): String {
    val minutes = seconds.coerceAtLeast(0) / 60
    return when {
        seconds <= 0 -> "0 phút"
        minutes == 0L -> "Dưới 1 phút"
        minutes < 60 -> "$minutes phút"
        minutes % 60 == 0L -> "${minutes / 60} giờ"
        else -> "${minutes / 60} giờ ${minutes % 60} phút"
    }
}
fun dateText(value: String?): String = value?.let {
    runCatching { DateTimeFormatter.ofPattern("HH:mm · dd/MM/yyyy").withZone(VietnamZone).format(Instant.parse(it)) }.getOrNull()
} ?: "Chưa có dữ liệu"
fun categoryText(value: String?): String = when (value) {
    "learning", "education" -> "Học tập"
    "entertainment" -> "Giải trí"
    "browsers" -> "Trình duyệt"
    "social" -> "Mạng xã hội"
    "unsafe" -> "Không an toàn"
    else -> "Chưa phân loại"
}
