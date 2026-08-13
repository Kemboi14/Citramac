/**
 * Client-side JWT payload decode — for UI routing decisions only (which
 * shell to land on, per docs/05-AUTHENTICATION-FLOW.md §5.3's "redirect to
 * the correct shell based on the user's highest role"). Never trust this
 * for authorization: every endpoint re-validates the token server-side
 * (docs/09-SECURITY-COMPLIANCE.md §9.3) — this is display logic, not a
 * security boundary.
 */
export interface AccessTokenClaims {
  user_id: string;
  organization_id: string | null;
  branch_ids: string[];
  role: string;
  email: string;
  first_name: string;
  last_name: string;
  exp: number;
  iat: number;
}

export function decodeAccessToken(token: string): AccessTokenClaims | null {
  try {
    const [, payload] = token.split(".");
    const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    return JSON.parse(json) as AccessTokenClaims;
  } catch {
    return null;
  }
}

export function isTokenExpired(claims: AccessTokenClaims): boolean {
  return claims.exp * 1000 <= Date.now();
}
