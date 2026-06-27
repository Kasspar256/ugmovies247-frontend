package com.ugmovies247.tv.data

import com.google.firebase.firestore.DocumentSnapshot

data class TvMovie(
    val id: String,
    val title: String,
    val posterUrl: String? = null,
    val backdropUrl: String? = null,
    val playbackUrl: String? = null,
    val badge: String? = null,
    val overview: String = "",
    val isLocked: Boolean = false
)

data class TvCatalogPage(
    val movies: List<TvMovie>,
    val lastDocument: DocumentSnapshot?,
    val hasMore: Boolean
)
