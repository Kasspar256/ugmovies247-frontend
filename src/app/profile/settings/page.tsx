'use client';

import { useEffect, useState } from 'react';
import { Loader2, Save } from 'lucide-react';
import MobilePageHeader from '@/components/MobilePageHeader';
import { AVATAR_PRESETS } from '@/lib/avatarPresets';
import {
  fetchAccountProfile,
  formatAccountDate,
  getAccountInitials,
  updateAccountProfile,
  type AccountProfile,
  type AccountNotificationPreferences,
} from '@/lib/accountProfile';

function PreferenceToggle({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="flex w-full items-center justify-between gap-4 rounded-2xl border border-white/10 bg-white/5 px-4 py-4 text-left transition-colors hover:border-white/20"
      aria-pressed={checked}
    >
      <div>
        <div className="text-base font-semibold text-white">{label}</div>
        <div className="mt-1.5 text-sm leading-6 text-white/54">{description}</div>
      </div>
      <span
        className={`relative inline-flex h-7 w-12 shrink-0 rounded-full transition-colors ${
          checked ? 'bg-[#D90429]' : 'bg-white/15'
        }`}
      >
        <span
          className={`absolute top-1 h-5 w-5 rounded-full bg-white transition-transform ${
            checked ? 'translate-x-6' : 'translate-x-1'
          }`}
        />
      </span>
    </button>
  );
}

export default function SettingsPage() {
  const [profile, setProfile] = useState<AccountProfile | null>(null);
  const [name, setName] = useState('');
  const [avatarPresetId, setAvatarPresetId] = useState('');
  const [notificationPreferences, setNotificationPreferences] =
    useState<AccountNotificationPreferences>({
      marketing: false,
      productUpdates: true,
    });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    let mounted = true;

    const loadProfile = async () => {
      try {
        const nextProfile = await fetchAccountProfile();

        if (!mounted) {
          return;
        }

        setProfile(nextProfile);
        setName(nextProfile.name);
        setAvatarPresetId(nextProfile.avatarPresetId || '');
        setNotificationPreferences(
          nextProfile.notificationPreferences || {
            marketing: false,
            productUpdates: true,
          }
        );
      } catch (loadError) {
        if (mounted) {
          setError(loadError instanceof Error ? loadError.message : 'Settings could not be loaded.');
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };

    void loadProfile();

    return () => {
      mounted = false;
    };
  }, []);

  const handleSave = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!name.trim()) {
      setError('Display name is required.');
      return;
    }

    setSaving(true);
    setError('');
    setSuccess('');

    try {
      await updateAccountProfile({
        name: name.trim(),
        avatarPresetId,
        notificationPreferences,
      });

      setSuccess('Your settings have been updated.');
      setProfile((current) =>
        current
          ? {
              ...current,
              name: name.trim(),
              avatarPresetId,
              avatarUrl:
                AVATAR_PRESETS.find((preset) => preset.id === avatarPresetId)?.src || current.avatarUrl,
              notificationPreferences,
            }
          : current
      );
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Your settings could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0B0C10] flex items-center justify-center">
        <div className="h-12 w-12 rounded-full border-4 border-[#1F2833] border-t-[#D90429] animate-spin" />
      </div>
    );
  }

  const selectedAvatarSrc =
    AVATAR_PRESETS.find((preset) => preset.id === avatarPresetId)?.src || profile?.avatarUrl || '';

  return (
    <main className="min-h-screen bg-[#0B0C10] px-4 pb-[calc(7.5rem+env(safe-area-inset-bottom))] pt-16 text-white md:px-8 md:pb-16 md:pt-[118px] lg:px-10">
      <MobilePageHeader title="Settings" fallbackHref="/profile" />

      <div className="mx-auto max-w-3xl">
        <div className="hidden items-center justify-between md:flex">
          <div>
            <div className="text-[11px] font-black uppercase tracking-[0.24em] text-white/40">
              Profile
            </div>
            <h1 className="mt-2 text-3xl font-black tracking-[-0.04em] text-white">
              Settings
            </h1>
          </div>
        </div>

        {error && !profile ? (
          <div className="mt-6 rounded-[24px] border border-red-500/20 bg-red-500/10 p-5 text-sm text-red-100">
            {error}
          </div>
        ) : profile ? (
          <form onSubmit={handleSave} className="mt-6 space-y-4">
            <section className="rounded-[28px] border border-white/10 bg-[#11141C]/82 p-5 shadow-[0_20px_48px_rgba(0,0,0,0.32)]">
              <div className="flex items-start gap-4">
                <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-full border border-white/10 bg-[#1B2230] text-lg font-black uppercase tracking-[0.18em] text-white">
                  {selectedAvatarSrc ? (
                    <img
                      src={selectedAvatarSrc}
                      alt={profile.name}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    getAccountInitials(profile.name, profile.email)
                  )}
                </div>
                <div className="min-w-0">
                  <div className="text-lg font-black tracking-[-0.03em] text-white">
                    {profile.name}
                  </div>
                  <div className="mt-1.5 text-base text-white/65">{profile.email}</div>
                  <p className="mt-3 text-sm leading-6 text-white/50">
                    Choose one of the preset avatars below. Initials only appear if no preset avatar
                    can be resolved for the account.
                  </p>
                </div>
              </div>

              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                <div className="rounded-2xl border border-white/8 bg-white/5 px-4 py-3">
                  <div className="text-[11px] font-black uppercase tracking-[0.22em] text-white/42">
                    Joined
                  </div>
                  <div className="mt-1.5 text-base font-semibold text-white">
                    {formatAccountDate(profile.createdAt)}
                  </div>
                </div>
                <div className="rounded-2xl border border-white/8 bg-white/5 px-4 py-3">
                  <div className="text-[11px] font-black uppercase tracking-[0.22em] text-white/42">
                    Last Login
                  </div>
                  <div className="mt-1.5 text-base font-semibold text-white">
                    {formatAccountDate(profile.lastLoginAt, { includeTime: true })}
                  </div>
                </div>
              </div>
            </section>

            <section className="rounded-[28px] border border-white/10 bg-[#11141C]/75 p-5 shadow-[0_18px_40px_rgba(0,0,0,0.26)]">
              <div className="text-[11px] font-black uppercase tracking-[0.24em] text-white/40">
                Account
              </div>
              <div className="mt-4 space-y-4">
                <div>
                  <label
                    htmlFor="display-name"
                    className="mb-2 block text-xs font-black uppercase tracking-[0.22em] text-white/50"
                  >
                    Display Name
                  </label>
                  <input
                    id="display-name"
                    type="text"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-4 text-white outline-none transition-colors placeholder:text-white/25 focus:border-[#D90429]/50"
                    placeholder="Your display name"
                    maxLength={60}
                    required
                  />
                </div>

                <div>
                  <div className="mb-2 text-xs font-black uppercase tracking-[0.22em] text-white/50">
                    Email
                  </div>
                  <div className="rounded-2xl border border-white/8 bg-white/5 px-4 py-4 text-base text-white/72">
                    {profile.email}
                  </div>
                </div>
              </div>
            </section>

            <section className="rounded-[28px] border border-white/10 bg-[#11141C]/75 p-5 shadow-[0_18px_40px_rgba(0,0,0,0.26)]">
              <div className="text-[11px] font-black uppercase tracking-[0.24em] text-white/40">
                Avatar
              </div>
              <div className="mt-4 grid grid-cols-3 gap-3 sm:grid-cols-4">
                {AVATAR_PRESETS.map((preset) => {
                  const selected = avatarPresetId === preset.id;

                  return (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => setAvatarPresetId(preset.id)}
                      className={`rounded-[22px] border p-2 transition-colors ${
                        selected
                          ? 'border-[#D90429] bg-[#D90429]/10'
                          : 'border-white/10 bg-white/5 hover:border-white/25'
                      }`}
                      aria-pressed={selected}
                    >
                      <div className="aspect-square w-full overflow-hidden rounded-full border border-white/10 bg-[#1B2230]">
                        <img
                          src={preset.src}
                          alt={preset.label}
                          className="h-full w-full object-cover"
                        />
                      </div>
                      <div className="mt-2 text-[11px] font-black uppercase tracking-[0.16em] text-white/72">
                        {preset.label}
                      </div>
                    </button>
                  );
                })}
              </div>
            </section>

            <section className="rounded-[28px] border border-white/10 bg-[#11141C]/75 p-5 shadow-[0_18px_40px_rgba(0,0,0,0.26)]">
              <div className="text-[11px] font-black uppercase tracking-[0.24em] text-white/40">
                Alerts
              </div>
              <div className="mt-4 space-y-3">
                <PreferenceToggle
                  label="Release and promo updates"
                  description="Announcements about featured drops, offers, and major platform updates."
                  checked={notificationPreferences.marketing}
                  onChange={(value) =>
                    setNotificationPreferences((current) => ({
                      ...current,
                      marketing: value,
                    }))
                  }
                />
                <PreferenceToggle
                  label="Account and platform notices"
                  description="Important access, security, and service notices tied to your account."
                  checked={notificationPreferences.productUpdates}
                  onChange={(value) =>
                    setNotificationPreferences((current) => ({
                      ...current,
                      productUpdates: value,
                    }))
                  }
                />
              </div>
              <p className="mt-4 text-sm leading-6 text-white/50">
                More granular alerts like new episode reminders, account notices, and followed-title
                alerts will need additional preference fields plus a delivery pipeline.
              </p>
            </section>

            {(error || success) && (
              <div
                className={`rounded-2xl px-4 py-3 text-sm ${
                  error
                    ? 'border border-red-500/20 bg-red-500/10 text-red-100'
                    : 'border border-emerald-500/20 bg-emerald-500/10 text-emerald-100'
                }`}
              >
                {error || success}
              </div>
            )}

            <button
              type="submit"
              disabled={saving}
              className="flex w-full items-center justify-center gap-2 rounded-2xl bg-[#D90429] px-4 py-4 text-sm font-black uppercase tracking-[0.24em] text-white transition-colors hover:bg-[#C10324] disabled:cursor-not-allowed disabled:bg-[#6E1020]"
            >
              {saving ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
          </form>
        ) : null}
      </div>
    </main>
  );
}
