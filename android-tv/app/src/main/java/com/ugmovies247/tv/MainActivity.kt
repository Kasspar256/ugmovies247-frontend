package com.ugmovies247.tv

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.unit.dp
import androidx.tv.material3.MaterialTheme
import androidx.tv.material3.Text
import com.ugmovies247.tv.ui.components.TvMovieCard
import com.ugmovies247.tv.ui.components.TvMovieCardUi
import com.ugmovies247.tv.ui.theme.UgMoviesTvTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        setContent {
            UgMoviesTvTheme {
                StepOneTvFoundationScreen()
            }
        }
    }
}

@Composable
private fun StepOneTvFoundationScreen() {
    val firstCardFocusRequester = remember { FocusRequester() }
    var selectedTitle by remember { mutableStateOf("Use D-Pad to move focus, then press Select.") }
    val demoMovies = remember {
        listOf(
            TvMovieCardUi(
                id = "wonderfools-vj-soul",
                title = "The WONDERfools - VJ SOUL",
                badge = "Featured"
            ),
            TvMovieCardUi(
                id = "super-lopez-vj-tonny",
                title = "Super Lopez - VJ TONNY",
                badge = "New"
            ),
            TvMovieCardUi(
                id = "premium-preview",
                title = "Premium Preview",
                badge = "18+",
                isLocked = true
            )
        )
    }

    LaunchedEffect(Unit) {
        firstCardFocusRequester.requestFocus()
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background)
            .padding(horizontal = 64.dp, vertical = 48.dp),
        verticalArrangement = Arrangement.spacedBy(28.dp)
    ) {
        Text(
            text = "UG Movies 247 TV",
            color = MaterialTheme.colorScheme.onBackground,
            style = MaterialTheme.typography.headlineLarge
        )
        Text(
            text = selectedTitle,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            style = MaterialTheme.typography.bodyLarge
        )
        Row(horizontalArrangement = Arrangement.spacedBy(28.dp)) {
            demoMovies.forEachIndexed { index, movie ->
                TvMovieCard(
                    movie = movie,
                    focusRequester = if (index == 0) firstCardFocusRequester else null,
                    onClick = { selectedTitle = "Selected: ${it.title}" }
                )
            }
        }
    }
}
