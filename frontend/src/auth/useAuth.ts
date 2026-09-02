import { useContext } from "react";
import { AuthContext } from "./authContextObject";

// Split from AuthContext.tsx so that file only exports the `AuthProvider`
// component — a file exporting both a component and a hook breaks Fast
// Refresh (react-refresh/only-export-components).
export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within an AuthProvider");
  return context;
}
