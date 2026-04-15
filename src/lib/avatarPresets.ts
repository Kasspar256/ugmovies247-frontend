export type AvatarPreset = {
  id: string;
  label: string;
  src: string;
};

export const AVATAR_PRESETS: AvatarPreset[] = [
  { id: 'crimson-cinema', label: 'Crimson Cinema', src: '/avatars/presets/crimson-cinema.svg' },
  { id: 'golden-noir', label: 'Golden Noir', src: '/avatars/presets/golden-noir.svg' },
  { id: 'electric-reel', label: 'Electric Reel', src: '/avatars/presets/electric-reel.svg' },
  { id: 'midnight-pop', label: 'Midnight Pop', src: '/avatars/presets/midnight-pop.svg' },
  { id: 'sunset-pulse', label: 'Sunset Pulse', src: '/avatars/presets/sunset-pulse.svg' },
  { id: 'emerald-frame', label: 'Emerald Frame', src: '/avatars/presets/emerald-frame.svg' },
  { id: 'violet-flash', label: 'Violet Flash', src: '/avatars/presets/violet-flash.svg' },
  { id: 'blue-lens', label: 'Blue Lens', src: '/avatars/presets/blue-lens.svg' },
  { id: 'rose-wave', label: 'Rose Wave', src: '/avatars/presets/rose-wave.svg' },
  { id: 'amber-glow', label: 'Amber Glow', src: '/avatars/presets/amber-glow.svg' },
  { id: 'indigo-beat', label: 'Indigo Beat', src: '/avatars/presets/indigo-beat.svg' },
  { id: 'teal-star', label: 'Teal Star', src: '/avatars/presets/teal-star.svg' },
];

const AVATAR_PRESET_MAP = new Map(AVATAR_PRESETS.map((preset) => [preset.id, preset]));

function hashString(value: string) {
  let hash = 0;

  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }

  return hash;
}

export function getAvatarPresetById(id?: string | null) {
  return id ? AVATAR_PRESET_MAP.get(id) || null : null;
}

export function isValidAvatarPresetId(id?: string | null) {
  return Boolean(id && AVATAR_PRESET_MAP.has(id));
}

export function resolveAvatarPresetUrl(id?: string | null) {
  return getAvatarPresetById(id)?.src || '';
}

export function getDefaultAvatarPresetId(seed?: string | null) {
  const normalizedSeed = String(seed || 'ugmovies247-user');
  const index = hashString(normalizedSeed) % AVATAR_PRESETS.length;
  return AVATAR_PRESETS[index]?.id || AVATAR_PRESETS[0].id;
}

export function resolveUserAvatar(options: {
  avatarPresetId?: string | null;
  avatarUrl?: string | null;
  fallbackSeed?: string | null;
}) {
  const presetUrl = resolveAvatarPresetUrl(options.avatarPresetId);

  if (presetUrl) {
    return {
      avatarPresetId: options.avatarPresetId || '',
      avatarUrl: presetUrl,
    };
  }

  // Preset avatars are the active account system now, so accounts without an
  // explicit preset are deterministically assigned one from the catalog.
  const fallbackPresetId = getDefaultAvatarPresetId(options.fallbackSeed);

  return {
    avatarPresetId: fallbackPresetId,
    avatarUrl: resolveAvatarPresetUrl(fallbackPresetId),
  };
}
