package com.ugmovies247.tv.ui.player

import android.content.Context
import androidx.media3.database.StandaloneDatabaseProvider
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.datasource.cache.CacheDataSource
import androidx.media3.datasource.cache.LeastRecentlyUsedCacheEvictor
import androidx.media3.datasource.cache.SimpleCache
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import java.io.File

object TvVideoCache {
    private const val MAX_VIDEO_CACHE_BYTES = 150L * 1024L * 1024L
    private const val CACHE_DIR_NAME = "ugmovies247-tv-video-cache"

    private var cache: SimpleCache? = null

    @Synchronized
    fun mediaSourceFactory(context: Context): DefaultMediaSourceFactory {
        val appContext = context.applicationContext
        val simpleCache = cache ?: SimpleCache(
            cacheDirectory(appContext),
            LeastRecentlyUsedCacheEvictor(MAX_VIDEO_CACHE_BYTES),
            StandaloneDatabaseProvider(appContext)
        ).also {
            cache = it
        }

        val upstreamFactory = DefaultHttpDataSource.Factory()
            .setUserAgent("UGMovies247-TV")

        val cacheDataSourceFactory = CacheDataSource.Factory()
            .setCache(simpleCache)
            .setUpstreamDataSourceFactory(upstreamFactory)
            .setFlags(CacheDataSource.FLAG_IGNORE_CACHE_ON_ERROR)

        return DefaultMediaSourceFactory(cacheDataSourceFactory)
    }

    @Synchronized
    fun clearAndRelease(context: Context) {
        runCatching {
            cache?.release()
        }

        cache = null

        runCatching {
            cacheDirectory(context.applicationContext).deleteRecursively()
        }

        runCatching {
            cacheDirectory(context.applicationContext).mkdirs()
        }
    }

    private fun cacheDirectory(context: Context): File =
        File(context.cacheDir, CACHE_DIR_NAME)
}
