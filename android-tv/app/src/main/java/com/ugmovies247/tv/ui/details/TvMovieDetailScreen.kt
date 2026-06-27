package com.ugmovies247.tv.ui.details

import androidx.activity.compose.BackHandler
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
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
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
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.tv.material3.MaterialTheme
import androidx.tv.material3.Text
import coil3.compose.AsyncImage
import com.ugmovies247.tv.data.TvMovie

@Composable
fun TvMovieDetailScreen(
    movie: TvMovie,
    onBack: () -> Unit,
    onPlay: () -> Unit
) {
    val playFocusRequester = remember { FocusRequester() }
    val hasPlayableStream = !movie.playbackUrl.isNullOrBlank()

    BackHandler(onBack = onBack)

    LaunchedEffect(movie.id) {
        playFocusRequester.requestFocus()
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background)
    ) {
        DetailBackdrop(movie = movie)

        Row(
            modifier = Modifier
                .fillMaxSize()
                .padding(horizontal = 64.dp, vertical = 48.dp),
            horizontalArrangement = Arrangement.spacedBy(42.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            DetailPoster(movie = movie)

            Column(
                modifier = Modifier.weight(1f),
                verticalArrangement = Arrangement.spacedBy(18.dp)
            ) {
                Text(
                    text = movie.badge?.uppercase() ?: "UG MOVIES 247",
                    color = Color(0xFFFF3157),
                    style = MaterialTheme.typography.labelLarge,
                    fontWeight = FontWeight.Black
                )

                Text(
                    text = movie.title,
                    color = Color.White,
                    style = MaterialTheme.typography.displayLarge,
                    fontWeight = FontWeight.Black,
                    maxLines = 3,
                    overflow = TextOverflow.Ellipsis
                )

                Text(
                    text = movie.overview.takeIf { it.isNotBlank() }
                        ?: "No description is available yet.",
                    color = Color(0xFFD5DAE3),
                    style = MaterialTheme.typography.bodyLarge,
                    maxLines = 5,
                    overflow = TextOverflow.Ellipsis
                )

                Spacer(modifier = Modifier.height(14.dp))

                Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                    TvDetailActionButton(
                        label = when {
                            movie.isLocked -> "Subscribe to Watch"
                            hasPlayableStream -> "Play"
                            else -> "No Stream Yet"
                        },
                        focusRequester = playFocusRequester,
                        enabled = hasPlayableStream && !movie.isLocked,
                        onClick = onPlay
                    )

                    TvDetailActionButton(
                        label = "Back",
                        onClick = onBack
                    )
                }
            }
        }
    }
}

@Composable
private fun DetailBackdrop(movie: TvMovie) {
    Box(modifier = Modifier.fillMaxSize()) {
        val backdropUrl = movie.backdropUrl ?: movie.posterUrl

        if (!backdropUrl.isNullOrBlank()) {
            AsyncImage(
                model = backdropUrl,
                contentDescription = null,
                contentScale = ContentScale.Crop,
                modifier = Modifier.fillMaxSize()
            )
        }

        Box(
            modifier = Modifier
                .fillMaxSize()
                .background(
                    Brush.horizontalGradient(
                        listOf(
                            Color(0xFF05060A),
                            Color(0xF205060A),
                            Color(0x9905060A)
                        )
                    )
                )
        )
    }
}

@Composable
private fun DetailPoster(movie: TvMovie) {
    Box(
        modifier = Modifier
            .width(260.dp)
            .aspectRatio(2f / 3f)
            .clip(RoundedCornerShape(24.dp))
            .background(Color(0xFF171B25))
            .border(
                BorderStroke(1.dp, Color.White.copy(alpha = 0.16f)),
                RoundedCornerShape(24.dp)
            )
    ) {
        if (movie.posterUrl.isNullOrBlank()) {
            Text(
                text = movie.title.take(1).uppercase(),
                modifier = Modifier.align(Alignment.Center),
                color = Color.White.copy(alpha = 0.72f),
                style = MaterialTheme.typography.displayLarge,
                fontWeight = FontWeight.Black
            )
        } else {
            AsyncImage(
                model = movie.posterUrl,
                contentDescription = movie.title,
                contentScale = ContentScale.Crop,
                modifier = Modifier.fillMaxSize()
            )
        }
    }
}

@Composable
private fun TvDetailActionButton(
    label: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    focusRequester: FocusRequester? = null,
    enabled: Boolean = true
) {
    var focused by remember { mutableStateOf(false) }
    val interactionSource = remember { MutableInteractionSource() }

    val scale by animateFloatAsState(
        targetValue = if (focused) 1.06f else 1f,
        label = "detail_action_focus_scale"
    )

    val backgroundColor by animateColorAsState(
        targetValue = when {
            !enabled -> Color(0xFF2A2E38)
            focused -> Color(0xFFE5092F)
            else -> Color(0xFF171B25)
        },
        label = "detail_action_focus_background"
    )

    val borderColor by animateColorAsState(
        targetValue = if (focused) Color.White else Color.White.copy(alpha = 0.18f),
        label = "detail_action_focus_border"
    )

    Box(
        modifier = modifier
            .then(if (focusRequester != null) Modifier.focusRequester(focusRequester) else Modifier)
            .graphicsLayer {
                scaleX = scale
                scaleY = scale
                alpha = if (enabled) 1f else 0.72f
            }
            .clip(RoundedCornerShape(999.dp))
            .background(backgroundColor)
            .border(BorderStroke(2.dp, borderColor), RoundedCornerShape(999.dp))
            .onFocusChanged { focused = it.isFocused || it.hasFocus }
            .focusable(interactionSource = interactionSource)
            .clickable(
                interactionSource = interactionSource,
                indication = null,
                role = Role.Button,
                enabled = enabled,
                onClick = onClick
            )
            .padding(horizontal = 28.dp, vertical = 14.dp)
    ) {
        Text(
            text = label.uppercase(),
            color = Color.White,
            style = MaterialTheme.typography.labelLarge,
            fontWeight = FontWeight.Black
        )
    }
}
