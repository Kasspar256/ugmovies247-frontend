import { Copy, Search, Trash2, UploadCloud } from 'lucide-react';
import type { AdminLibraryAsset } from '@/types/admin';
import { DIRECT_MULTIPART_PART_SIZE_BYTES } from '@/lib/admin/directUploadClient';
import { Card, TextInput } from '@/components/admin/controlCenterFields';

function summarizeAssignments(asset: AdminLibraryAsset) {
  if (!asset.assignments.length) {
    return 'Unused';
  }

  return asset.assignments
    .slice(0, 3)
    .map((assignment) => {
      if (assignment.type === 'movie_part') {
        return `${assignment.movieTitle} - ${assignment.partLabel}`;
      }

      if (assignment.type === 'episode') {
        return `${assignment.movieTitle} S${assignment.seasonNumber}E${assignment.episodeNumber}`;
      }

      return assignment.movieTitle;
    })
    .join(', ');
}

export function AdminLibraryTab({
  assets,
  search,
  onSearchChange,
  uploadFile,
  onUploadFileChange,
  uploadProgress,
  uploadStatus,
  onUploadAsset,
  onCopyUrl,
  onDeleteAsset,
  actionBusy,
}: {
  assets: AdminLibraryAsset[];
  search: string;
  onSearchChange: (value: string) => void;
  uploadFile: File | null;
  onUploadFileChange: (file: File | null) => void;
  uploadProgress: number;
  uploadStatus: string;
  onUploadAsset: () => void;
  onCopyUrl: (value: string, label: string) => void;
  onDeleteAsset: (asset: AdminLibraryAsset) => void;
  actionBusy: boolean;
}) {
  return (
    <div className="grid gap-6 xl:grid-cols-[0.9fr_1.4fr]">
      <Card
        title="Upload Reusable MP4"
        description="Store MP4 files once, then reuse them for movies, parts, and episodes."
      >
        <div className="space-y-4">
          <input
            type="file"
            accept="video/mp4"
            onChange={(event) => onUploadFileChange(event.target.files?.[0] || null)}
            className="block w-full rounded-2xl border border-dashed border-white/15 bg-[#0C1017] px-4 py-3 text-sm text-white file:mr-3 file:rounded-full file:border-0 file:bg-[#D90429] file:px-3 file:py-2 file:text-xs file:font-black file:uppercase file:tracking-[0.18em] file:text-white"
          />
          <div className="text-xs leading-6 text-white/55">
            Multipart uploads stay direct MP4 only. Current part size:{' '}
            {Math.round(DIRECT_MULTIPART_PART_SIZE_BYTES / (1024 * 1024))} MB.
          </div>
          <button
            type="button"
            disabled={actionBusy || !uploadFile}
            onClick={onUploadAsset}
            className="inline-flex items-center gap-2 rounded-full bg-[#D90429] px-5 py-3 text-xs font-black uppercase tracking-[0.18em] text-white disabled:opacity-60"
          >
            <UploadCloud size={14} />
            Upload Into Library
          </button>
          {uploadProgress > 0 && (
            <div className="overflow-hidden rounded-full border border-white/10 bg-black/30">
              <div className="h-3 bg-[#D90429]" style={{ width: `${uploadProgress}%` }} />
            </div>
          )}
          {uploadStatus && (
            <pre className="rounded-2xl border border-white/10 bg-black/30 p-4 whitespace-pre-wrap text-xs leading-6 text-white/75">
              {uploadStatus}
            </pre>
          )}
        </div>
      </Card>

      <Card
        title="Library Assets"
        description="Preview reusable MP4s, copy links, and delete only when no movie, part, or episode still uses the file."
      >
        <div className="mb-4 relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/35" />
          <TextInput
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Search library assets..."
            className="pl-10"
          />
        </div>
        <div className="space-y-4">
          {assets.map((asset) => (
            <div key={asset.id} className="rounded-2xl border border-white/10 bg-black/20 p-4">
              <div className="grid gap-4 lg:grid-cols-[200px_1fr]">
                <video
                  src={asset.url}
                  controls
                  preload="metadata"
                  className="h-40 w-full rounded-2xl bg-black object-cover"
                />
                <div className="space-y-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-bold text-white">{asset.label}</div>
                      <div className="mt-1 text-xs text-white/50">{asset.fileName}</div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => onCopyUrl(asset.url, 'MP4 URL')}
                        className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-2 text-[11px] font-black uppercase tracking-[0.18em] text-white"
                      >
                        <Copy size={14} />
                        Copy URL
                      </button>
                      <button
                        type="button"
                        disabled={actionBusy || !asset.canDelete}
                        onClick={() => onDeleteAsset(asset)}
                        className="inline-flex items-center gap-2 rounded-full border border-red-500/20 bg-red-500/10 px-3 py-2 text-[11px] font-black uppercase tracking-[0.18em] text-red-100 disabled:opacity-50"
                      >
                        <Trash2 size={14} />
                        Delete
                      </button>
                    </div>
                  </div>
                  <div className="text-xs leading-6 text-white/55">
                    {summarizeAssignments(asset)}
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-[#0C1017] px-4 py-3 text-xs text-white/60">
                    {asset.url}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
