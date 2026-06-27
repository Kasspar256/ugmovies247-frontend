package com.ugmovies247.tv.auth

import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.firestore.DocumentSnapshot
import com.google.firebase.firestore.FirebaseFirestore
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlin.coroutines.suspendCoroutine

class TvAuthRepository(
    private val auth: FirebaseAuth = FirebaseAuth.getInstance(),
    private val firestore: FirebaseFirestore = FirebaseFirestore.getInstance()
) {
    suspend fun currentSession(): TvUserSession? {
        val user = auth.currentUser ?: return null
        return buildSession(user.uid, user.email.orEmpty())
    }

    suspend fun signIn(email: String, password: String): TvUserSession {
        val user = suspendCoroutine { continuation ->
            auth.signInWithEmailAndPassword(email.trim(), password)
                .addOnSuccessListener { result ->
                    val signedInUser = result.user
                    if (signedInUser == null) {
                        continuation.resumeWithException(IllegalStateException("Sign in failed."))
                    } else {
                        continuation.resume(signedInUser)
                    }
                }
                .addOnFailureListener { error ->
                    continuation.resumeWithException(error)
                }
        }

        return buildSession(user.uid, user.email.orEmpty())
    }

    fun signOut() {
        auth.signOut()
    }

    private suspend fun buildSession(uid: String, email: String): TvUserSession {
        val subscription = readDocument("user_subscriptions", uid)
        val userDoc = readDocument("users", uid)
        val userSubscription = userDoc.get("subscription") as? Map<*, *>

        val hasPremiumAccess =
            subscription.hasActiveSubscription() || userSubscription.hasActiveSubscription()

        val planName = subscription.getString("planName")
            ?: userSubscription?.get("planName") as? String
            ?: ""

        val expiresAt = subscription.getString("expiresAt")
            ?: userSubscription?.get("expiresAt") as? String
            ?: ""

        return TvUserSession(
            uid = uid,
            email = email,
            hasPremiumAccess = hasPremiumAccess,
            planName = planName,
            expiresAt = expiresAt
        )
    }

    private suspend fun readDocument(collection: String, documentId: String): DocumentSnapshot =
        suspendCoroutine { continuation ->
            firestore.collection(collection)
                .document(documentId)
                .get()
                .addOnSuccessListener { continuation.resume(it) }
                .addOnFailureListener { continuation.resumeWithException(it) }
        }

    private fun DocumentSnapshot.hasActiveSubscription(): Boolean {
        if (!exists()) return false

        val status = getString("status")
        val isActive = getBoolean("isActive") == true
        val expiresAt = getString("expiresAt")

        return isActive && status == "active" && !isExpired(expiresAt)
    }

    private fun Map<*, *>?.hasActiveSubscription(): Boolean {
        if (this == null) return false

        val status = this["status"] as? String
        val isActive = this["isActive"] == true
        val expiresAt = this["expiresAt"] as? String

        return isActive && status == "active" && !isExpired(expiresAt)
    }

    private fun isExpired(expiresAt: String?): Boolean {
        if (expiresAt.isNullOrBlank()) return false

        return runCatching {
            java.time.Instant.parse(expiresAt).toEpochMilli() <= System.currentTimeMillis()
        }.getOrDefault(false)
    }
}
