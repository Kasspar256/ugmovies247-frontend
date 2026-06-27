package com.ugmovies247.tv.ui.components

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.focusable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.tv.material3.MaterialTheme
import androidx.tv.material3.Text

data class TvMovieCardUi(
    val id: String,
    val title: String,
    val posterUrl: String? = null,
    val badge: String? = null,
    val isLocked: Boolean = false
)

@Composable
fun TvMovieCard(
    movie: TvMovieCardUi,
    onClick: (TvMovieCardUi) -> Unit,
    modifier: Modifier = Modifier,
    focusRequester: FocusRequester? = null,
    onFocused: (TvMovieCardUi) -> Unit = {}
) {
    var focused by remember { mutableStateOf(false) }
    val interactionSource = remember { MutableInteractionSource() }

    val scale by animateFloatAsState(
        targetValue = if (focused) 1.08f else 1f,
        label = "tv_movie_card_focus_scale"
    )

    val borderColor by animateColorAsState(
        targetValue = if (focused) Color(0xFFFF3157) else Color.Transparent,
        label = "tv_movie_card_focus_border"
    )

    val cardModifier = modifier
        .width(176.dp)
        .graphicsLayer {
            scaleX = scale
            scaleY = scale
        }
        .then(
            if (focusRequester != null) {
                Modifier.focusRequester(focusRequester)
            } else {
                Modifier
            }
        )
        .onFocusChanged { focusState ->
            focused = focusState.isFocused || focusState.hasFocus

            if (focusState.isFocused) {
                onFocused(movie)
            }
        }
        .focusable(interactionSource = interactionSource)
        .clickable(
            interactionSource = interactionSource,
            indication = null,
            role = Role.Button,
            onClick = { onClick(movie) }
        )

    Column(
        modifier = cardModifier,
        verticalArrangement = Arrangement.spacedBy(10.dp)
    ) {
        Box(
            modifier = Modifier
                .aspectRatio(2f / 3f)
                .clip(RoundedCornerShape(18.dp))
                .background(Color(0xFF171B25))
                .border(
                    border = BorderStroke(
                        width = if (focused) 3.dp else 1.dp,
                        color = borderColor
                    ),
                    shape = RoundedCornerShape(18.dp)
                )
        ) {
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .background(
                        Brush.verticalGradient(
                            colors = listOf(
                                Color(0xFF242A36),
                                Color(0xFF080A0F)
                            )
                        )
                    )
            )

            Text(
                text = movie.title.take(1).uppercase(),
                modifier = Modifier.align(Alignment.Center),
                color = Color.White.copy(alpha = 0.72f),
                style = MaterialTheme.typography.displayLarge,
                fontWeight = FontWeight.Black
            )

            movie.badge?.let { badge ->
                Text(
                    text = badge.uppercase(),
                    modifier = Modifier
                        .align(Alignment.TopStart)
                        .padding(8.dp)
                        .clip(RoundedCornerShape(999.dp))
                        .background(Color(0xFFE5092F))
                        .padding(horizontal = 9.dp, vertical = 4.dp),
                    color = Color.White,
                    style = MaterialTheme.typography.labelLarge,
                    maxLines = 1
                )
            }

            if (movie.isLocked) {
                Text(
                    text = "LOCKED",
                    modifier = Modifier
                        .align(Alignment.BottomEnd)
                        .padding(8.dp)
                        .clip(RoundedCornerShape(999.dp))
                        .background(Color.Black.copy(alpha = 0.72f))
                        .padding(horizontal = 9.dp, vertical = 4.dp),
                    color = Color.White,
                    style = MaterialTheme.typography.labelLarge
                )
            }
        }

        Text(
            text = movie.title,
            color = if (focused) Color.White else Color(0xFFD5DAE3),
            style = MaterialTheme.typography.titleMedium,
            fontWeight = if (focused) FontWeight.ExtraBold else FontWeight.SemiBold,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis
        )
    }
}
