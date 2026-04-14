import type { AdminCategory, AdminLibraryAsset } from '@/types/admin';
import type {
  DraftVideoSource,
} from '@/components/admin/controlCenterUtils';
import { FieldLabel, PillButton, SelectInput, TextInput } from '@/components/admin/controlCenterFields';

export function CategoryChecklist({
  categories,
  selected,
  onToggle,
  className,
  getLabel,
}: {
  categories: AdminCategory[];
  selected: string[];
  onToggle: (name: string) => void;
  className?: string;
  getLabel?: (category: AdminCategory) => string;
}) {
  return (
    <div
      className={`grid gap-2.5 rounded-2xl border border-white/10 bg-[#0C1017] p-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 ${
        className || ''
      }`}
    >
      {categories.map((category) => {
        const active = selected.includes(category.name);

        return (
          <label
            key={category.id}
            className={`group flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-2 text-left transition-all duration-200 ${
              active
                ? 'border-[#D90429]/45 bg-[#17070B] text-white shadow-[0_0_0_1px_rgba(217,4,41,0.16),0_8px_20px_rgba(217,4,41,0.08)]'
                : 'border-white/10 bg-[#11141C] text-white/72 hover:border-[#D90429]/30 hover:bg-[#141922] hover:shadow-[0_8px_20px_rgba(217,4,41,0.07)]'
            }`}
          >
            <input
              type="checkbox"
              checked={active}
              onChange={() => onToggle(category.name)}
              className="peer sr-only"
            />
            <span
              className={`flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[5px] border transition-all duration-200 ${
                active
                  ? 'border-[#D90429] bg-[#D90429] text-white shadow-[0_0_12px_rgba(217,4,41,0.28)]'
                  : 'border-white/20 bg-[#080B11] text-transparent group-hover:border-[#D90429]/45'
              }`}
            >
              <svg
                viewBox="0 0 16 16"
                className="h-2.5 w-2.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.4"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M3.5 8.5 6.5 11.5 12.5 5.5" />
              </svg>
            </span>
            <span className="min-w-0 text-[13px] font-semibold leading-5 text-inherit">
              {getLabel ? getLabel(category) : category.name}
            </span>
          </label>
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
