export function extractMovieData(filename: string) {
  // Remove extension
  let cleanName = filename.replace(/\.[^/.]+$/, "");
  
  // Extract VJ name (supports VJ Emmy, [VJ Musa], Translated by Junior, or just common VJ names if context allows)
  // For now, look for VJ markers or known names.
  const vjMatch = cleanName.match(/(?:\[?VJ[- ]?|Translated by )([A-Za-z0-9\s]+)\]?/i);
  let vj = vjMatch ? vjMatch[1].trim() : null;

  // Clean the title: remove VJ parts, HD, 1080p, 720p, BluRay, x264, etc.
  let title = cleanName
    .replace(/(?:\[?VJ[- ]?|Translated by )[A-Za-z0-9\s]+\]?/gi, "")
    .replace(/\b(HD|1080p|720p|480p|BluRay|x264|WEBRip|HDRip|mp4|mkv)\b/gi, "")
    .replace(/[^a-zA-Z0-9\s]/g, " ") // replace special chars with space
    .replace(/\s+/g, " ")
    .trim();

  return { title, vj };
}
