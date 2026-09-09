import { apiRequest } from "./apiClient";

// Mirrors apps.accounts.serializers.MyProfileSerializer — self-service
// profile (including avatar) for every authenticated user, any role, any
// portal (Super Admin / Org Admin / Clinical Workspace).
export interface MyProfile {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  avatar: string | null;
  role_names: string[];
  organization_name: string | null;
}

const AVATAR_MAX_SIZE_BYTES = 5 * 1024 * 1024;

export function getMyProfile(accessToken: string) {
  return apiRequest<MyProfile>("/me/profile/", { accessToken });
}

export function updateMyProfile(
  accessToken: string,
  payload: { first_name?: string; last_name?: string; phone?: string; avatar?: File },
) {
  if (payload.avatar && payload.avatar.size > AVATAR_MAX_SIZE_BYTES) {
    throw new Error("Profile picture must be 5MB or smaller.");
  }
  const body = new FormData();
  if (payload.first_name !== undefined) body.set("first_name", payload.first_name);
  if (payload.last_name !== undefined) body.set("last_name", payload.last_name);
  if (payload.phone !== undefined) body.set("phone", payload.phone);
  if (payload.avatar) body.set("avatar", payload.avatar);
  return apiRequest<MyProfile>("/me/profile/", { method: "PATCH", body, accessToken });
}
