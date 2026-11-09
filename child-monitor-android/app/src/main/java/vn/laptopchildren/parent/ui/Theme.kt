package vn.laptopchildren.parent.ui

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

private val LightColors = lightColorScheme(
    primary = Color(0xFF174EA6), onPrimary = Color.White,
    primaryContainer = Color(0xFFDBEAFE), onPrimaryContainer = Color(0xFF0F2E53),
    secondary = Color(0xFF32675F), secondaryContainer = Color(0xFFD9EEE8), onSecondaryContainer = Color(0xFF143E36),
    background = Color(0xFFF4F7FB), onBackground = Color(0xFF11233F),
    surface = Color(0xFFFCFDFF), onSurface = Color(0xFF11233F),
    surfaceVariant = Color(0xFFE8EEF6), onSurfaceVariant = Color(0xFF52617A),
    outline = Color(0xFF74829A), outlineVariant = Color(0xFFD5DFEB),
    error = Color(0xFFB42318), errorContainer = Color(0xFFFFDAD5), onErrorContainer = Color(0xFF680600))
private val DarkColors = darkColorScheme(
    primary = Color(0xFFADC7FF), onPrimary = Color(0xFF002E6D),
    primaryContainer = Color(0xFF17477F), onPrimaryContainer = Color(0xFFD8E5FF),
    secondary = Color(0xFF9FD3C5), secondaryContainer = Color(0xFF244D44), onSecondaryContainer = Color(0xFFD1F2E6),
    background = Color(0xFF101822), onBackground = Color(0xFFE2E9F4),
    surface = Color(0xFF151F2D), onSurface = Color(0xFFE2E9F4),
    surfaceVariant = Color(0xFF283547), onSurfaceVariant = Color(0xFFB7C4D7),
    outline = Color(0xFF8C9BB1), outlineVariant = Color(0xFF3D4B60))

@Composable fun ParentTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = if (isSystemInDarkTheme()) DarkColors else LightColors, content = content)
}
