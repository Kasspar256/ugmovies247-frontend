package com.ugmovies247.tv.auth

data class TvUserSession(
    val uid: String,
    val email: String,
    val hasPremiumAccess: Boolean,
    val planName: String = "",
    val expiresAt: String = ""
)

data class TvAuthUiState(
    val isLoading: Boolean = false,
    val session: TvUserSession? = null,
    val error: String? = null
)
