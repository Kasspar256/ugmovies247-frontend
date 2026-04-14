import { useEffect, useState } from 'react';
import { Check, Copy, ExternalLink, Film, Search, Trash2, UploadCloud } from 'lucide-react';
import type { AdminLibraryAsset } from '@/types/admin';
import {
  MAX_DIRECT_MULTIPART_PART_SIZE_BYTES,
  MIN_DIRECT_MULTIPART_PART_SIZE_BYTES,
} from '@/lib/admin/directUploadClient';
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
  const [copiedAssetId, setCopiedAssetId] = useState('');

  useEffect(() => {
    if (!copiedAssetId) {
      return;
    }

    const timeout = window.setTimeout(() => {
      setCopiedAssetId('');
    }, 2200);

    return () => window.clearTimeout(timeout);
  }, [copiedAssetId]);

  const handleCopyAssetUrl = (asset: AdminLibraryAsset) => {
    onCopyUrl(asset.url, 'URL');
    setCopiedAssetId(asset.id);
  };

  return (
    <div className="grid w-full min-w-0 gap-5 overflow-x-hidden xl:grid-cols-[0.9fr_1.4fr]">
      <Card
        title="Upload Reusable MP4"
        description="Store MP4 files once, then reuse them for movies, parts, and episodes."
        className="w-full min-w-0 max-w-full overflow-hidden"
        headerClassName="min-w-0"
        titleClassName="break-words"
        descriptionClassName="break-words"
      >
        <div className="w-full min-w-0 space-y-4">
          <input
            type="file"
            accept="video/mp4"
            onChange={(event) => onUploadFileChange(event.target.files?.[0] || null)}
            className="block w-full max-w-full rounded-2xl border border-dashed border-white/15 bg-[#0C1017] px-4 py-3 text-sm text-white file:mb-3 file:mr-0 file:max-w-full file:rounded-full file:border-0 file:bg-[#D90429] file:px-3 file:py-2 file:text-xs file:font-black file:uppercase file:tracking-[0.16em] file:text-white sm:file:mb-0 sm:file:mr-3"
          />
          <div className="break-words text-xs leading-6 text-white/55">
            Multipart uploads stay direct MP4 only. Adaptive part sizing runs between{' '}
            {Math.round(MIN_DIRECT_MULTIPART_PART_SIZE_BYTES / (1024 * 1024))} MB and{' '}
            {Math.round(MAX_DIRECT_MULTIPART_PART_SIZE_BYTES / (1024 * 1024))} MB.
          </div>
          <button
            type="button"
            disabled={actionBusy || !uploadFile}
            onClick={onUploadAsset}
            className="flex w-full min-w-0 flex-wrap items-center justify-center gap-2 rounded-full bg-[#D90429] px-4 py-3 text-center text-[11px] font-black uppercase leading-5 tracking-[0.14em] text-white transition-transform duration-200 hover:scale-[1.01] disabled:opacity-60"
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
            <pre className="max-h-52 w-full overflow-x-hidden overflow-y-auto rounded-2xl border border-white/10 bg-black/30 p-4 whitespace-pre-wrap break-words text-xs leading-6 text-white/75">
              {uploadStatus}
            </pre>
          )}
        </div>
      </Card>

      <Card
        title="Library Assets"
        description="Preview reusable MP4s, copy links, and delete only when no movie, part, or episode still uses the file."
        className="w-full min-w-0 max-w-full overflow-hidden"
        headerClassName="min-w-0"
        titleClassName="break-words"
        descriptionClassName="break-words"
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
        <div className="space-y-3 sm:space-y-4">
          {assets.map((asset) => (
            <div key={asset.id} className="w-full min-w-0 max-w-full">
              <div className="w-full min-w-0 max-w-full overflow-hidden rounded-3xl border border-white/10 bg-black/20 p-3 shadow-[0_16px_40px_rgba(0,0,0,0.18)] md:hidden">
                <div className="flex w-full min-w-0 items-start gap-3">
                  <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-[#0C1017] text-white/55">
                    <Film size={20} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-bold text-white">{asset.label}</div>
                    <div className="mt-1 line-clamp-2 break-all text-xs leading-5 text-white/50">
                      {asset.fileName}
                    </div>
                    <div className="mt-2 rounded-2xl border border-white/10 bg-[#0C1017] px-3 py-2 text-xs leading-5 text-white/60">
                      {summarizeAssignments(asset)}
                    </div>
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-1 gap-2">
                  <a
                    href={asset.url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex w-full items-center justify-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-2.5 text-center text-[11px] font-black uppercase tracking-[0.16em] text-white transition-colors hover:bg-white/10"
                  >
                    <ExternalLink size={14} />
                    Preview
                  </a>
                  <button
                    type="button"
                    onClick={() => handleCopyAssetUrl(asset)}
                    className={`inline-flex w-full items-center justify-center gap-2 rounded-full border px-3 py-2.5 text-center text-[11px] font-black uppercase tracking-[0.16em] transition-colors ${
                      copiedAssetId === asset.id
                        ? 'border-emerald-400/30 bg-emerald-500/10 text-emerald-100'
                        : 'border-white/10 bg-white/5 text-white hover:bg-white/10'
                    }`}
                  >
                    {copiedAssetId === asset.id ? <Check size={14} /> : <Copy size={14} />}
                    {copiedAssetId === asset.id ? 'Copied' : 'Copy URL'}
                  </button>
                  <button
                    type="button"
                    disabled={actionBusy || !asset.canDelete}
                    onClick={() => onDeleteAsset(asset)}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-full border border-red-500/20 bg-red-500/10 px-3 py-2.5 text-center text-[11px] font-black uppercase tracking-[0.16em] text-red-100 transition-colors hover:bg-red-500/15 disabled:opacity-50"
                  >
                    <Trash2 size={14} />
                    Delete
                  </button>
                </div>
                <div className="mt-3 rounded-2xl border border-white/10 bg-[#0C1017] px-3 py-3">
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <div className="text-[10px] font-black uppercase tracking-[0.2em] text-white/40">
                      MP4 URL
                    </div>
                    {copiedAssetId === asset.id && (
                      <div className="text-[10px] font-black uppercase tracking-[0.18em] text-emerald-200">
                        Copied
                      </div>
                    )}
                  </div>
                  <div className="max-h-20 overflow-y-auto break-all text-xs leading-5 text-white/60">
                    {asset.url}
                  </div>
                </div>
              </div>

              <div className="hidden rounded-3xl border border-white/10 bg-black/20 p-4 shadow-[0_16px_40px_rgba(0,0,0,0.18)] md:block">
                <div className="grid gap-4 lg:grid-cols-[220px_1fr] lg:items-start">
                  <div className="overflow-hidden rounded-2xl border border-white/10 bg-[#07090D]">
                    <video
                      src={asset.url}
                      controls
                      preload="metadata"
                      className="h-36 w-full bg-black object-cover lg:h-[148px]"
                    />
                  </div>
                  <div className="space-y-3">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <div className="text-sm font-bold text-white sm:text-[15px]">{asset.label}</div>
                        <div className="mt-1 break-all text-xs leading-5 text-white/50">{asset.fileName}</div>
                      </div>
                      <div className="grid w-full grid-cols-2 gap-2 sm:w-auto sm:grid-cols-2">
                        <button
                          type="button"
                          onClick={() => handleCopyAssetUrl(asset)}
                          className={`inline-flex w-full items-center justify-center gap-2 rounded-full border px-3 py-2 text-[11px] font-black uppercase tracking-[0.18em] transition-colors ${
                            copiedAssetId === asset.id
                              ? 'border-emerald-400/30 bg-emerald-500/10 text-emerald-100'
                              : 'border-white/10 bg-white/5 text-white hover:bg-white/10'
                          }`}
                        >
                          {copiedAssetId === asset.id ? <Check size={14} /> : <Copy size={14} />}
                          {copiedAssetId === asset.id ? 'URL Copied' : 'Copy URL'}
                        </button>
                        <button
                          type="button"
                          disabled={actionBusy || !asset.canDelete}
                          onClick={() => onDeleteAsset(asset)}
                          className="inline-flex w-full items-center justify-center gap-2 rounded-full border border-red-500/20 bg-red-500/10 px-3 py-2 text-[11px] font-black uppercase tracking-[0.18em] text-red-100 transition-colors hover:bg-red-500/15 disabled:opacity-50"
                        >
                          <Trash2 size={14} />
                          Delete
                        </button>
                      </div>
                    </div>
                    <div className="rounded-2xl border border-white/10 bg-[#0C1017] px-3 py-2 text-xs leading-5 text-white/60">
                      {summarizeAssignments(asset)}
                    </div>
                    <div className="rounded-2xl border border-white/10 bg-[#0C1017] px-3 py-3">
                      <div className="mb-2 flex items-center justify-between gap-3">
                        <div className="text-[10px] font-black uppercase tracking-[0.2em] text-white/40">
                          MP4 URL
                        </div>
                        {copiedAssetId === asset.id && (
                          <div className="text-[10px] font-black uppercase tracking-[0.18em] text-emerald-200">
                            Copied
                          </div>
                        )}
                      </div>
                      <div className="max-h-24 overflow-y-auto break-all text-xs leading-5 text-white/60">
                        {asset.url}
                      </div>
                    </div>
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
