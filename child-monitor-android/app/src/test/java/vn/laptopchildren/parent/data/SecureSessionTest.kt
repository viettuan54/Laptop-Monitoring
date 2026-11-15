package vn.laptopchildren.parent.data

import android.content.ContextWrapper
import android.content.SharedPreferences
import org.junit.Assert.*
import org.junit.Test
import java.lang.reflect.Proxy

class SecureSessionTest {
    private fun session(readFails: Boolean = false, editFails: Boolean = false, commitFails: Boolean = false): SecureSession {
        val editor = Proxy.newProxyInstance(
            SharedPreferences.Editor::class.java.classLoader,
            arrayOf(SharedPreferences.Editor::class.java)
        ) { proxy, method, _ ->
            when (method.name) {
                "commit" -> !commitFails
                else -> proxy
            }
        } as SharedPreferences.Editor
        val prefs = Proxy.newProxyInstance(
            SharedPreferences::class.java.classLoader,
            arrayOf(SharedPreferences::class.java)
        ) { _, method, _ ->
            when (method.name) {
                "getString" -> if (readFails) error("Storage unavailable") else null
                "edit" -> if (editFails) error("Storage unavailable") else editor
                else -> null
            }
        } as SharedPreferences
        return SecureSession(object : ContextWrapper(null) {
            override fun getSharedPreferences(name: String?, mode: Int): SharedPreferences = prefs
        })
    }

    private fun seedMemory(store: SecureSession) {
        // Exercise logout failure without requiring AndroidKeyStore in a JVM test.
        SecureSession::class.java.getDeclaredField("memory").apply { isAccessible = true }
            .set(store, Tokens("test-access", "test-refresh"))
        assertNotNull(store.tokens)
    }

    @Test fun clearingSessionDropsMemoryWhenEditThrows() {
        val store = session(editFails = true)
        seedMemory(store)
        store.clear()
        assertNull(store.tokens)
        assertEquals(1L, store.generation)
    }

    @Test fun clearingSessionDropsMemoryWhenCommitReturnsFalse() {
        val store = session(commitFails = true)
        seedMemory(store)
        store.clear()
        assertNull(store.tokens)
        assertEquals(1L, store.generation)
    }

    @Test fun unreadableSessionDoesNotCrashWhenCleanupAlsoFails() {
        assertNull(session(readFails = true, editFails = true).tokens)
    }
}
