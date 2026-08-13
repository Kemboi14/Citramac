/**
 * Maps a JWT role claim to the shell that role lands on after login —
 * docs/05-AUTHENTICATION-FLOW.md §5.3 ("redirect to the correct shell based
 * on the user's highest role") and docs/00 overview's three UI tiers.
 * Everything that isn't Super Admin or Org Admin is frontline clinical
 * staff (Doctor, Nurse, Therapist, etc.) and lands in the Clinical Workspace.
 */
export function shellPathForRole(role: string): string {
  if (role === "SUPER_ADMIN") return "/super-admin";
  if (role === "Org Admin") return "/org-admin";
  return "/clinical";
}
