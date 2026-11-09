package vn.laptopchildren.parent.data

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import com.google.gson.Gson
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

interface SessionStore {
    var tokens: Tokens?
    val generation: Long
    fun begin(tokens: Tokens)
    fun clear()
}

/** Only the encrypted token pair is persisted. Backup is disabled in the manifest. */
class SecureSession(context: Context) : SessionStore {
    private val prefs = context.getSharedPreferences("secure_session", Context.MODE_PRIVATE)
    private val alias = "laptopchildren_session_key"
    private var epoch = 0L
    private var memory: Tokens? = runCatching {
        prefs.getString("session", null)?.let { encoded ->
            val raw = Base64.decode(encoded, Base64.NO_WRAP)
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, raw.copyOfRange(0, 12)))
            Gson().fromJson(String(cipher.doFinal(raw.copyOfRange(12, raw.size)), Charsets.UTF_8), Tokens::class.java)
        }
    }.getOrElse { prefs.edit().clear().commit(); null }
    private fun key(): SecretKey {
        val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (ks.getKey(alias, null) as? SecretKey)?.let { return it }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
            init(KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
        }.generateKey()
    }
    override var tokens: Tokens?
        @Synchronized get() = memory
        @Synchronized set(value) {
            if (value == null) { prefs.edit().remove("session").commit(); memory = null; return }
            val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, key()) }
            val encrypted = cipher.iv + cipher.doFinal(Gson().toJson(value).toByteArray(Charsets.UTF_8))
            check(prefs.edit().putString("session", Base64.encodeToString(encrypted, Base64.NO_WRAP)).commit())
            memory = value
        }
    override val generation: Long @Synchronized get() = epoch
    @Synchronized override fun begin(tokens: Tokens) { epoch++; this.tokens = tokens }
    @Synchronized override fun clear() { epoch++; tokens = null }
}
