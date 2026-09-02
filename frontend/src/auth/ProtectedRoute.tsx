import { Navigate, Outlet } from "react-router-dom";
import { shellPathForRole } from "../lib/roleRouting";
import { useAuth } from "./useAuth";

function FullPageSpinner() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-surface-bg text-sm text-ink-500">
      Loading…
    </div>
  );
}

/**
 * Gate for authenticated routes. `allowedRoles`, when given, redirects a
 * mismatched role to the shell that actually matches theirs (so a Doctor
 * hitting /super-admin directly lands on /clinical, not a blank/broken
 * page) — real authorization is still enforced server-side per request
 * regardless (docs/09-SECURITY-COMPLIANCE.md §9.3); this is routing, not a
 * security boundary.
 */
export function ProtectedRoute({ allowedRoles }: { allowedRoles?: string[] }) {
  const { accessToken, claims, isLoading } = useAuth();

  if (isLoading) return <FullPageSpinner />;
  if (!accessToken || !claims) return <Navigate to="/login" replace />;
  if (allowedRoles && !allowedRoles.includes(claims.role)) {
    return <Navigate to={shellPathForRole(claims.role)} replace />;
  }
  return <Outlet />;
}

export function RootRedirect() {
  const { accessToken, claims, isLoading } = useAuth();

  if (isLoading) return <FullPageSpinner />;
  if (!accessToken || !claims) return <Navigate to="/login" replace />;
  return <Navigate to={shellPathForRole(claims.role)} replace />;
}
