import { useEffect, useState } from "react";
import { useAuth } from "../auth/useAuth";
import { AvatarUpload } from "../components/AvatarUpload";
import { SaveButton } from "../components/SaveButton";
import { getMyProfile, updateMyProfile, type MyProfile } from "../lib/myProfileApi";

/**
 * Self-service "My Profile" — one shared page mounted in every portal
 * (Super Admin, Org Admin, Clinical Workspace) via each shell's profile
 * menu, so every user, any role, can set their own avatar and details.
 */
export function MyProfilePage() {
  const { accessToken, refreshProfile } = useAuth();
  const [profile, setProfile] = useState<MyProfile | null>(null);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!accessToken) return;
    getMyProfile(accessToken).then((data) => {
      setProfile(data);
      setFirstName(data.first_name);
      setLastName(data.last_name);
      setPhone(data.phone);
    });
  }, [accessToken]);

  if (!accessToken || !profile) {
    return (
      <div className="animate-pulse rounded-lg border border-surface-border bg-surface-card p-8">
        <div className="h-6 w-40 rounded bg-surface-bg" />
      </div>
    );
  }

  const initials =
    `${profile.first_name?.[0] ?? ""}${profile.last_name?.[0] ?? ""}`.toUpperCase() ||
    profile.email[0]?.toUpperCase() ||
    "?";

  const handleUploadAvatar = async (file: File) => {
    const updated = await updateMyProfile(accessToken, { avatar: file });
    setProfile(updated);
    await refreshProfile();
  };

  const handleSave = async () => {
    setError(null);
    try {
      const updated = await updateMyProfile(accessToken, {
        first_name: firstName,
        last_name: lastName,
        phone,
      });
      setProfile(updated);
      await refreshProfile();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save your profile.");
      throw err;
    }
  };

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 animate-fade-in">
      <div>
        <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-brand-green">
          Account
        </div>
        <h1 className="font-display text-2xl font-bold text-ink-900">My Profile</h1>
        <p className="mt-1 text-sm text-ink-500">
          Your personal details and profile picture — visible to your care team across every screen
          you appear on.
        </p>
      </div>

      <div className="rounded-lg border border-surface-border bg-surface-card p-6 shadow-sm">
        <div className="flex items-center gap-5">
          <AvatarUpload
            imageUrl={profile.avatar}
            initials={initials}
            size={88}
            onUpload={handleUploadAvatar}
          />
          <div>
            <div className="font-display text-lg font-bold text-ink-900">
              {profile.first_name} {profile.last_name}
            </div>
            <p className="mt-0.5 text-[13px] text-ink-500">{profile.email}</p>
            {profile.role_names.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {profile.role_names.map((role) => (
                  <span
                    key={role}
                    className="rounded-full bg-brand-green-tint px-2.5 py-1 text-[10.5px] font-semibold text-brand-green-dark"
                  >
                    {role}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="mt-6 grid grid-cols-2 gap-4 max-sm:grid-cols-1">
          <div>
            <label className="mb-1.5 block text-[11.5px] font-semibold text-ink-700">
              First name
            </label>
            <input
              type="text"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              className="w-full rounded-[9px] border border-surface-border bg-surface-bg px-3 py-2.5 text-[13px] text-ink-900 outline-none transition-colors focus:border-brand-green focus:bg-white"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-[11.5px] font-semibold text-ink-700">
              Last name
            </label>
            <input
              type="text"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              className="w-full rounded-[9px] border border-surface-border bg-surface-bg px-3 py-2.5 text-[13px] text-ink-900 outline-none transition-colors focus:border-brand-green focus:bg-white"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-[11.5px] font-semibold text-ink-700">
              Phone number
            </label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="07XX XXX XXX"
              className="w-full rounded-[9px] border border-surface-border bg-surface-bg px-3 py-2.5 text-[13px] text-ink-900 outline-none transition-colors focus:border-brand-green focus:bg-white"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-[11.5px] font-semibold text-ink-700">
              Organization
            </label>
            <input
              type="text"
              disabled
              value={profile.organization_name ?? "Platform"}
              className="w-full rounded-[9px] border border-surface-border bg-surface-bg px-3 py-2.5 text-[13px] text-ink-400"
            />
          </div>
        </div>

        {error && <p className="mt-4 text-[12.5px] text-status-red">{error}</p>}

        <div className="mt-6 flex justify-end">
          <SaveButton onSave={handleSave}>Save changes</SaveButton>
        </div>
      </div>
    </div>
  );
}
