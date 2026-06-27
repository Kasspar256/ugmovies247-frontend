package com.ugmovies247.tv

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import com.ugmovies247.tv.ui.home.TvHomeScreen
import com.ugmovies247.tv.ui.theme.UgMoviesTvTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        setContent {
            UgMoviesTvTheme {
                TvHomeScreen()
            }
        }
    }
}
