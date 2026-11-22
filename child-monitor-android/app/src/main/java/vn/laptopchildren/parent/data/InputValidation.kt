package vn.laptopchildren.parent.data

const val PASSWORD_GUIDANCE = "Mật khẩu cần 8–128 ký tự, có chữ hoa (A–Z), số và ký tự đặc biệt như ! @ # $."

// Keep identical to backend src/utils/validation.js, including its special-character set.
fun passwordError(password: String): String? = when {
    password.length !in 8..128 -> "Mật khẩu phải có từ 8 đến 128 ký tự."
    password.none { it in 'A'..'Z' } -> "Mật khẩu cần ít nhất một chữ hoa (A–Z)."
    password.none { it in '0'..'9' } -> "Mật khẩu cần ít nhất một chữ số (0–9)."
    password.none { it in "!@#\$%^&*(),.?\":{}|<>" } -> "Mật khẩu cần ký tự đặc biệt như ! @ # $."
    else -> null
}
