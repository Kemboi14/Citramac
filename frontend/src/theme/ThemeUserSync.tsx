import { useEffect } from "react";
import { useAuth } from "../auth/useAuth";
import { useTheme } from "./useTheme";

/** Applies the signed-in person's own light/dark choice, and light when no
 * one is signed in. Rendered inside AuthProvider. */
export function ThemeUserSync() {
  const { claims } = useAuth();
  const { setUser } = useTheme();
  const userId = claims?.user_id ?? null;
  useEffect(() => {
    setUser(userId);
  }, [userId, setUser]);
  return null;
}
