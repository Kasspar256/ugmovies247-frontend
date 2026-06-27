package com.ugmovies247.tv.ui.theme

import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.tv.material3.MaterialTheme
import androidx.tv.material3.Shapes
import androidx.tv.material3.Typography
import androidx.tv.material3.darkColorScheme

private val UgRed = Color(0xFFE5092F)
private val UgRedFocused = Color(0xFFFF3157)
private val UgBlack = Color(0xFF05060A)
private val UgSurface = Color(0xFF10131B)
private val UgSurfaceRaised = Color(0xFF171B25)
private val UgText = Color(0xFFF8FAFC)
private val UgMutedText = Color(0xFFB8C0CC)

private val UgMoviesTvColors = darkColorScheme(
    primary = UgRed,
    onPrimary = Color.White,
    secondary = UgRedFocused,
    onSecondary = Color.White,
    background = UgBlack,
    onBackground = UgText,
    surface = UgSurface,
    onSurface = UgText,
    surfaceVariant = UgSurfaceRaised,
    onSurfaceVariant = UgMutedText,
    outline = Color(0xFF404757)
)

private val UgMoviesTvTypography = Typography(
    displayLarge = TextStyle(
        fontSize = 48.sp,
        lineHeight = 56.sp,
        fontWeight = FontWeight.Black,
        letterSpacing = 0.sp
    ),
    headlineLarge = TextStyle(
        fontSize = 34.sp,
        lineHeight = 42.sp,
        fontWeight = FontWeight.ExtraBold,
        letterSpacing = 0.2.sp
    ),
    titleLarge = TextStyle(
        fontSize = 24.sp,
        lineHeight = 32.sp,
        fontWeight = FontWeight.Bold,
        letterSpacing = 0.2.sp
    ),
    titleMedium = TextStyle(
        fontSize = 18.sp,
        lineHeight = 24.sp,
        fontWeight = FontWeight.SemiBold,
        letterSpacing = 0.15.sp
    ),
    bodyLarge = TextStyle(
        fontSize = 18.sp,
        lineHeight = 28.sp,
        fontWeight = FontWeight.Normal
    ),
    labelLarge = TextStyle(
        fontSize = 14.sp,
        lineHeight = 18.sp,
        fontWeight = FontWeight.Bold,
        letterSpacing = 1.2.sp
    )
)

private val UgMoviesTvShapes = Shapes(
    extraSmall = RoundedCornerShape(8.dp),
    small = RoundedCornerShape(12.dp),
    medium = RoundedCornerShape(18.dp),
    large = RoundedCornerShape(26.dp),
    extraLarge = RoundedCornerShape(34.dp)
)

@Composable
fun UgMoviesTvTheme(
    content: @Composable () -> Unit
) {
    MaterialTheme(
        colorScheme = UgMoviesTvColors,
        typography = UgMoviesTvTypography,
        shapes = UgMoviesTvShapes,
        content = content
    )
}
