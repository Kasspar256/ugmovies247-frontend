package com.ugmovies247.tv.ui.home

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.tv.material3.MaterialTheme
import androidx.tv.material3.Text
import com.google.firebase.firestore.DocumentSnapshot
import com.ugmovies247.tv.data.TvCatalogRepository
import com.ugmovies247.tv.data.TvMovie
import com.ugmovies247.tv.ui.components.TvMovieCard
import com.ugmovies247.tv.ui.components.TvMovieCardUi
import com.ugmovies247.tv.ui.details.TvMovieDetailScreen
import com.ugmovies247.tv.ui.player.TvPlayerScreen
import kotlinx.coroutines.launch

@Composable
fun TvHomeScreen() {
    val repository = remember { TvCatalogRepository() }
    val firstCardFocusRequester = remember { FocusRequester() }
    val scope = rememberCoroutineScope()

    var movies by remember { mutableStateOf<List<TvMovie>>(emptyList()) }
    var heroMovie by remember { mutableStateOf<TvMovie?>(null) }
    var lastDocument by remember { mutableStateOf<DocumentSnapshot?>(null) }
    var hasMore by remember { mutableStateOf(true) }
    var isLoadingInitial by remember { mutableStateOf(true) }
    var isFetchingMore by remember { mutableStateOf(false) }
    var loadError by remember { mutableStateOf<String?>(null) }
    var selectedMovie by remember { mutableStateOf<TvMovie?>(null) }
    var playingMovie by remember { mutableStateOf<TvMovie?>(null) }

    fun loadNextPage() {
        if (isFetchingMore || !hasMore) return

        isFetchingMore = true

        scope.launch {
            runCatching {
                repository.loadLatestMoviesPage(after = lastDocument)
            }.onSuccess { page ->
                movies = appendMovies(movies, page.movies)
                heroMovie = heroMovie ?: movies.firstOrNull()
                lastDocument = page.lastDocument
                hasMore = page.hasMore
                loadError = null
            }.onFailure {
                loadError = "We could not load movies right now."
            }

            isLoadingInitial = false
            isFetchingMore = false
        }
    }

    LaunchedEffect(Unit) {
        loadNextPage()
    }

    LaunchedEffect(movies.isNotEmpty()) {
        if (movies.isNotEmpty()) {
            firstCardFocusRequester.requestFocus()
        }
    }

    playingMovie?.let { movie ->
        TvPlayerScreen(
            movie = movie,
            onBack = { playingMovie = null }
        )
        return
    }

    selectedMovie?.let { movie ->
        TvMovieDetailScreen(
            movie = movie,
            onBack = { selectedMovie = null },
            onPlay = { playingMovie = movie }
        )
        return
    }

    LazyColumn(
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background),
        contentPadding = PaddingValues(bottom = 56.dp)
    ) {
        item {
            TvHeroSection(
                movie = heroMovie,
                isLoading = isLoadingInitial,
                loadError = loadError
            )
        }

        item {
            Text(
                text = "Latest Movies",
                modifier = Modifier.padding(start = 64.dp, top = 22.dp, bottom = 18.dp),
                color = MaterialTheme.colorScheme.onBackground,
                style = MaterialTheme.typography.headlineLarge,
                fontWeight = FontWeight.Black
            )
        }

        item {
            TvLatestMoviesRow(
                movies = movies,
                firstCardFocusRequester = firstCardFocusRequester,
                isFetchingMore = isFetchingMore,
                onMovieFocused = { index, movie ->
                    heroMovie = movie

                    if (index >= movies.size - 6) {
                        loadNextPage()
                    }
                },
                onMovieSelected = { selectedMovie = it }
            )
        }
    }
}

@Composable
private fun TvHeroSection(
    movie: TvMovie?,
    isLoading: Boolean,
    loadError: String?
) {
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .height(320.dp)
            .background(
                Brush.horizontalGradient(
                    listOf(Color(0xFF151924), Color(0xFF080A0F))
                )
            )
            .padding(horizontal = 64.dp, vertical = 44.dp)
    ) {
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .height(232.dp)
                .border(
                    BorderStroke(1.dp, Color.White.copy(alpha = 0.16f)),
                    RoundedCornerShape(28.dp)
                )
                .background(Color.Black.copy(alpha = 0.18f), RoundedCornerShape(28.dp))
                .padding(32.dp)
        ) {
            androidx.compose.foundation.layout.Column(
                modifier = Modifier.align(Alignment.CenterStart),
                verticalArrangement = Arrangement.spacedBy(14.dp)
            ) {
                Text(
                    text = when {
                        isLoading -> "Loading UG Movies 247..."
                        loadError != null -> loadError
                        else -> movie?.title ?: "UG Movies 247 TV"
                    },
                    color = Color.White,
                    style = MaterialTheme.typography.displayLarge,
                    fontWeight = FontWeight.Black,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis
                )

                Text(
                    text = movie?.overview?.takeIf { it.isNotBlank() }
                        ?: "Browse your movie catalog with TV-optimized D-Pad navigation.",
                    color = Color(0xFFD5DAE3),
                    style = MaterialTheme.typography.bodyLarge,
                    maxLines = 3,
                    overflow = TextOverflow.Ellipsis
                )
            }
        }
    }
}

@Composable
private fun TvLatestMoviesRow(
    movies: List<TvMovie>,
    firstCardFocusRequester: FocusRequester,
    isFetchingMore: Boolean,
    onMovieFocused: (Int, TvMovie) -> Unit,
    onMovieSelected: (TvMovie) -> Unit
) {
    LazyRow(
        horizontalArrangement = Arrangement.spacedBy(28.dp),
        contentPadding = PaddingValues(horizontal = 64.dp),
        modifier = Modifier.fillMaxWidth()
    ) {
        itemsIndexed(
            items = movies,
            key = { _, movie -> movie.id }
        ) { index, movie ->
            TvMovieCard(
                movie = movie.toCardUi(),
                focusRequester = if (index == 0) firstCardFocusRequester else null,
                onFocused = { onMovieFocused(index, movie) },
                onClick = { onMovieSelected(movie) }
            )
        }

        if (isFetchingMore) {
            item {
                Spacer(
                    modifier = Modifier
                        .width(176.dp)
                        .height(264.dp)
                )
            }
        }
    }
}

private fun TvMovie.toCardUi() =
    TvMovieCardUi(
        id = id,
        title = title,
        posterUrl = posterUrl ?: backdropUrl,
        badge = badge,
        isLocked = isLocked
    )

private fun appendMovies(
    current: List<TvMovie>,
    incoming: List<TvMovie>
): List<TvMovie> {
    val seenIds = current.mapTo(mutableSetOf()) { it.id }
    return current + incoming.filter { seenIds.add(it.id) }
}
