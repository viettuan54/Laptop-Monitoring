package vn.laptopchildren.parent.data

import com.google.gson.Gson
import com.google.gson.JsonParser
import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.Assert.*
import org.junit.Test

class VisionSettingsTest {
    @Test fun explicitSessionStartSendsDurationAndReadsCommandId() = runBlocking {
        val server = MockWebServer()
        server.start()
        try {
            server.enqueue(MockResponse().setBody("""{"child_id":7,"vision_session_minutes":5,"vision_session_id":"session-test","enable_posture_monitoring":true}"""))
            val api = createApi(server.url("/").toString(), MemorySession().apply { begin(Tokens("parent", "refresh")) })
            val result = api.saveSettings(7, mapOf("start_vision_session" to true, "vision_session_minutes" to 5))
            val body = JsonParser.parseString(server.takeRequest().body.readUtf8()).asJsonObject
            assertTrue(body["start_vision_session"].asBoolean)
            assertEquals(5, body["vision_session_minutes"].asInt)
            assertFalse(body.has("enable_webcam_monitoring"))
            assertEquals("session-test", result.vision_session_id)
            assertEquals(5, result.vision_session_minutes)
        } finally { server.shutdown() }
    }

    @Test fun independentFlagsOverrideLegacyConsentIncludingExplicitFalse() {
        for (posture in listOf(false, true)) for (distance in listOf(false, true)) {
            val settings = Gson().fromJson("""{"enable_webcam_monitoring":true,
                "enable_posture_monitoring":$posture,"enable_eye_distance_monitoring":$distance}""", Settings::class.java)
            assertEquals(posture, settings.postureMonitoringEnabled)
            assertEquals(distance, settings.eyeDistanceMonitoringEnabled)
        }
        for (enabled in listOf(false, true)) {
            val settings = Gson().fromJson("""{"enable_webcam_monitoring":$enabled}""", Settings::class.java)
            assertEquals(enabled, settings.postureMonitoringEnabled)
            assertEquals(enabled, settings.eyeDistanceMonitoringEnabled)
        }
        val empty = Gson().fromJson("{}", Settings::class.java)
        assertFalse(empty.postureMonitoringEnabled)
        assertFalse(empty.eyeDistanceMonitoringEnabled)
    }

    @Test fun savingOneFeatureSendsOnlyThatFlagAndReadsBothReturnedStates() = runBlocking {
        val server = MockWebServer()
        server.start()
        try {
            val store = MemorySession().apply { begin(Tokens("parent", "refresh")) }
            val api = createApi(server.url("/").toString(), store)
            for (field in listOf("enable_posture_monitoring", "enable_eye_distance_monitoring")) {
                for (enabled in listOf(false, true)) {
                    server.enqueue(MockResponse().setBody("""{"child_id":7,"enable_webcam_monitoring":true,
                        "enable_posture_monitoring":false,"enable_eye_distance_monitoring":true}"""))
                    val settings = api.saveSettings(7, mapOf(field to enabled))
                    val request = server.takeRequest()
                    assertEquals("PUT", request.method)
                    assertEquals("/api/settings/7", request.path)
                    assertEquals("Bearer parent", request.getHeader("Authorization"))
                    val body = JsonParser.parseString(request.body.readUtf8()).asJsonObject
                    assertEquals(setOf(field), body.keySet())
                    assertEquals(enabled, body[field].asBoolean)
                    assertFalse(settings.postureMonitoringEnabled)
                    assertTrue(settings.eyeDistanceMonitoringEnabled)
                }
            }
        } finally { server.shutdown() }
    }
}
