import re

file_path = "/home/kasspar/.openclaw/workspace/ugmovies247-frontend/src/app/admin/page.tsx"
with open(file_path, "r") as f:
    content = f.read()

# We need to add the TMDB Genre ID Mapping table
genre_map = """
  const TMDB_GENRES: Record<number, string> = {
    28: 'Action', 12: 'Adventure', 16: 'Animation', 35: 'Comedy', 80: 'Crime',
    99: 'Documentary', 18: 'Drama', 10751: 'Documentary', 14: 'Fantasy',
    36: 'Family', 38: 'History', 27: 'Horror', 10402: 'Music', 9648: 'Mystery',
    10749: 'Romance', 878: 'Sci-Fi', 10770: 'TV Movie', 53: 'Thriller',
    10752: 'War', 37: 'Western'
  };

  const getGenresFromIds = (ids: number[]) => {
    if (!ids || !Array.isArray(ids)) return [];
    return ids.map(id => TMDB_GENRES[id]).filter(g => g);
  };
"""

# Insert right before resetForm
content = content.replace("  const resetForm = () => {", genre_map + "\n  const resetForm = () => {")

# Update movieDoc creation for UPLOAD
old_upload = """      const movieDoc = {
        title: selectedMovie.title || cleanTitle,
        original_title: selectedMovie.original_title || cleanTitle,
        description: selectedMovie.overview || '',
        poster: selectedMovie.poster_path ? `https://image.tmdb.org/t/p/w500${selectedMovie.poster_path}` : '',
        genres: [], category: ['Latest'], vj: detectedVj || 'Unknown',
        video_url: publicUrl, release_date: selectedMovie.release_date || '',
        date_added: new Date().toISOString(), country: 'Unknown',
        tmdb_id: selectedMovie.id || null, file_name: fileName,
        status: 'published', is_trending_tiktok: isTrending
      };"""

new_upload = """      const extractedGenres = selectedMovie.genre_ids ? getGenresFromIds(selectedMovie.genre_ids) : [];
      let countryData = 'Unknown';
      if (selectedMovie.original_language === 'ko') countryData = 'South Korea';
      if (selectedMovie.original_language === 'hi' || selectedMovie.original_language === 'te' || selectedMovie.original_language === 'ta') countryData = 'India';

      const movieDoc = {
        title: selectedMovie.title || cleanTitle,
        original_title: selectedMovie.original_title || cleanTitle,
        description: selectedMovie.overview || '',
        poster: selectedMovie.poster_path ? `https://image.tmdb.org/t/p/w500${selectedMovie.poster_path}` : '',
        genres: extractedGenres, category: ['Latest'], vj: detectedVj || 'Unknown',
        video_url: publicUrl, release_date: selectedMovie.release_date || '',
        date_added: new Date().toISOString(), country: countryData,
        tmdb_id: selectedMovie.id || null, file_name: fileName,
        status: 'published', is_trending_tiktok: isTrending
      };"""

# Update movieDoc creation for LINK
old_link = """      const movieDoc = {
        title: selectedMovie.title || cleanTitle,
        original_title: selectedMovie.original_title || cleanTitle,
        description: selectedMovie.overview || '',
        poster: selectedMovie.poster_path ? `https://image.tmdb.org/t/p/w500${selectedMovie.poster_path}` : '',
        genres: [], category: ['Latest'], vj: detectedVj || 'Unknown',
        video_url: publicUrl, release_date: selectedMovie.release_date || '',
        date_added: new Date().toISOString(), country: 'Unknown',
        tmdb_id: selectedMovie.id || null, file_name: cleanFileName,
        status: 'published', is_trending_tiktok: isTrending
      };"""

new_link = """      const extractedGenres = selectedMovie.genre_ids ? getGenresFromIds(selectedMovie.genre_ids) : [];
      let countryData = 'Unknown';
      if (selectedMovie.original_language === 'ko') countryData = 'South Korea';
      if (selectedMovie.original_language === 'hi' || selectedMovie.original_language === 'te' || selectedMovie.original_language === 'ta') countryData = 'India';

      const movieDoc = {
        title: selectedMovie.title || cleanTitle,
        original_title: selectedMovie.original_title || cleanTitle,
        description: selectedMovie.overview || '',
        poster: selectedMovie.poster_path ? `https://image.tmdb.org/t/p/w500${selectedMovie.poster_path}` : '',
        genres: extractedGenres, category: ['Latest'], vj: detectedVj || 'Unknown',
        video_url: publicUrl, release_date: selectedMovie.release_date || '',
        date_added: new Date().toISOString(), country: countryData,
        tmdb_id: selectedMovie.id || null, file_name: cleanFileName,
        status: 'published', is_trending_tiktok: isTrending
      };"""


content = content.replace(old_upload, new_upload)
content = content.replace(old_link, new_link)

with open(file_path, "w") as f:
    f.write(content)

