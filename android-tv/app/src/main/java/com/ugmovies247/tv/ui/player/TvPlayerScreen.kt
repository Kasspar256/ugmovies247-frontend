package com.ugmovies247.tv.ui.player

import android.view.ViewGroup
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.viewinterop.AndroidView
import androidx.media3.common.MediaItem
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.ui.PlayerView
import com.ugmovies247.tv.data.TvMovie

@Composable
fun TvPlayerScreen(
    movie: TvMovie,
    onBack: () -> Unit
) {
    val context = LocalContext.current
    val playbackUrl = movie.playbackUrl.orEmpty()

    val player = remember(movie.id, playbackUrl) {
        ExoPlayer.Builder(context)
            .setMediaSourceFactory(TvVideoCache.mediaSourceFactory(context))
            .build()
            .apply {
                setMediaItem(MediaItem.fromUri(playbackUrl))
                prepare()
                playWhenReady = true
            }
    }

    BackHandler(onBack = onBack)

    DisposableEffect(player) {
        onDispose {
            runCatching {
                player.stop()
                player.clearMediaItems()
                player.release()
            }

            TvVideoCache.clearAndRelease(context)
        }
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Color.Black)
    ) {
        AndroidView(
            modifier = Modifier.fillMaxSize(),
            factory = { viewContext ->
                PlayerView(viewContext).apply {
                    layoutParams = ViewGroup.LayoutParams(
                        ViewGroup.LayoutParams.MATCH_PARENT,
                        ViewGroup.LayoutParams.MATCH_PARENT
                    )
                    this.player = player
                    useController = true
                    controllerAutoShow = true
                    setShowBuffering(PlayerView.SHOW_BUFFERING_WHEN_PLAYING)
                    keepScreenOn = true
                }
            },
            update = { playerView ->
                playerView.player = player
            }
        )
    }
}
