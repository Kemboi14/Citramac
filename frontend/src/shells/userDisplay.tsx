import type { AccessTokenClaims } from "../lib/jwt";

export function initialsAndLabel(claims: AccessTokenClaims | null) {
  if (!claims) return { initials: "?", name: "Unknown" };
  const name = `${claims.first_name} ${claims.last_name}`.trim() || claims.email;
  const initials =
    `${claims.first_name?.[0] ?? ""}${claims.last_name?.[0] ?? ""}`.toUpperCase() ||
    claims.email[0]?.toUpperCase() ||
    "?";
  return { initials, name };
}
