import type { AdminCategory, AdminLibraryAsset } from '@/types/admin';
import type {
  DraftVideoSource,
} from '@/components/admin/controlCenterUtils';
import { FieldLabel, PillButton, SelectInput, TextInput } from '@/components/admin/controlCenterFields';

export function CategoryChecklist({
  categories,
  selected,
  onToggle,
}: {
  categories: AdminCategory[];
  selected: string[];
  onToggle: (name: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2 rounded-2xl border border-white/10 bg-[#0C1017] p-3">
      {categories.map((category) => {
        const active = selected.includes(category.name);

        return (
          <button
            key={category.id}
            type="button"
            onClick={() => onToggle(category.name)}
            className={`rounded-full px-3 py-2 text-xs font-black uppercase tracking-[0.18em] ${
              active
                ? 'bg-[#D90429] text-white'
                : 'border border-white/10 bg-white/5 text-white/60 hover:bg-white/10 hover:text-white'
            }`}
          >
            {category.name}
          </button>
        );
      })}
    </div>
  );
}

export function PosterUploadField({
  label,
  value,
  onUrlChange,
  onFileChange,
}: {
  label: string;
  value: string;
  onUrlChange: (value: string) => void;
  onFileChange: (file: File | null) => void;
}) {
  return (
    <div className="space-y-3">
      <div>
        <FieldLabel>{label} URL</FieldLabel>
        <TextInput
          value={value}
          onChange={(event) => onUrlChange(event.target.value)}
          placeholder="https://..."
        />
      </div>
      <div>
        <FieldLabel>Upload {label}</FieldLabel>
        <input
          type="file"
          accept="image/*"
          onChange={(event) => onFileChange(event.target.files?.[0] || null)}
          className="block w-full rounded-2xl border border-dashed border-white/15 bg-[#0C1017] px-4 py-3 text-sm text-white file:mr-3 file:rounded-full file:border-0 file:bg-[#D90429] file:px-3 file:py-2 file:text-xs file:font-black file:uppercase file:tracking-[0.18em] file:text-white"
        />
      </div>
      {value && (
        <div className="overflow-hidden rounded-2xl border border-white/10 bg-black/20">
          <img src={value} alt={label} className="h-52 w-full object-cover" />
        </div>
      )}
    </div>
  );
}

export function SourceEditor({
  title,
  source,
  onChange,
  libraryAssets,
  helpText,
}: {
  title: string;
  source: DraftVideoSource;
  onChange: (nextSource: DraftVideoSource) => void;
  libraryAssets: AdminLibraryAsset[];
  helpText?: string;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-[#0C1017] p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-[11px] font-black uppercase tracking-[0.22em] text-white/70">
            {title}
          </div>
          {helpText && <div className="mt-2 text-xs leading-5 text-white/45">{helpText}</div>}
        </div>
        <div className="flex gap-2">
          <PillButton
            active={source.mode === 'url'}
            onClick={() => onChange({ mode: 'url', url: source.url, file: null })}
          >
            MP4 URL
          </PillButton>
          <PillButton
            active={source.mode === 'file'}
            onClick={() => onChange({ mode: 'file', url: source.url, file: source.file })}
          >
            Upload MP4
          </PillButton>
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_260px]">
        <div className="space-y-3">
          <TextInput
            value={source.url}
            onChange={(event) => onChange({ ...source, url: event.target.value })}
            placeholder="https://your-r2-public-url-or-existing-mp4-link.mp4"
            disabled={source.mode === 'file'}
          />
          <input
            type="file"
            accept="video/mp4"
            onChange={(event) =>
              onChange({
                ...source,
                mode: 'file',
                file: event.target.files?.[0] || null,
              })
            }
            className="block w-full rounded-2xl border border-dashed border-white/15 bg-[#0A0D13] px-4 py-3 text-sm text-white file:mr-3 file:rounded-full file:border-0 file:bg-[#D90429] file:px-3 file:py-2 file:text-xs file:font-black file:uppercase file:tracking-[0.18em] file:text-white"
          />
        </div>

        <div>
          <FieldLabel>Use From Library</FieldLabel>
          <SelectInput
            value=""
            onChange={(event) => {
              const nextUrl = event.target.value;

              if (!nextUrl) {
                return;
              }

              onChange({
                mode: 'url',
                url: nextUrl,
                file: null,
              });
            }}
          >
            <option value="">Select reusable MP4</option>
            {libraryAssets.map((asset) => (
              <option key={asset.id} value={asset.url}>
                {asset.label}
              </option>
            ))}
          </SelectInput>
        </div>
      </div>

      {source.file && (
        <div className="mt-3 rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-xs text-white/70">
          Pending upload: {source.file.name}
        </div>
      )}
    </div>
  );
}
