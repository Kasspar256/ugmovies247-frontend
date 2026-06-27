package com.ugmovies247.tv.data

import com.google.firebase.firestore.DocumentSnapshot
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.Query
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlin.coroutines.suspendCoroutine

class TvCatalogRepository(
    private val firestore: FirebaseFirestore = FirebaseFirestore.getInstance()
) {
    suspend fun loadLatestMoviesPage(after: DocumentSnapshot? = null): TvCatalogPage =
        suspendCoroutine { continuation ->
            var query = firestore
                .collection("movies")
                .orderBy("date_added", Query.Direction.DESCENDING)
                .limit(20)

            if (after != null) {
                query = query.startAfter(after)
            }

            query.get()
                .addOnSuccessListener { snapshot ->
                    continuation.resume(
                        TvCatalogPage(
                            movies = snapshot.documents.mapNotNull { it.toTvMovie() },
                            lastDocument = snapshot.documents.lastOrNull(),
                            hasMore = snapshot.documents.size == 20
                        )
                    )
                }
                .addOnFailureListener { error ->
                    continuation.resumeWithException(error)
                }
        }

    private fun DocumentSnapshot.toTvMovie(): TvMovie? {
        val title = getString("title")
            ?: getString("name")
            ?: getString("original_title")
            ?: return null

        val accessTier = getString("accessTier")
        val locked = getBoolean("subscriptionRequired") == true ||
            getBoolean("isLocked") == true ||
            (!accessTier.isNullOrBlank() && accessTier != "free")

        return TvMovie(
            id = id,
            title = title,
            posterUrl = getString("poster")
                ?: getString("thumbnail")
                ?: getString("heroPoster")
                ?: getString("overriddenBackdrop"),
            badge = when {
                getBoolean("is_trending_tiktok") == true -> "Trending"
                !getString("vj").isNullOrBlank() -> getString("vj")
                locked -> "Premium"
                else -> null
            },
            overview = getString("overview") ?: getString("description") ?: "",
            isLocked = locked
        )
    }
}
