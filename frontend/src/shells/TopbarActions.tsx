import { Bell, LogOut } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";

/** Notification bell + sign-out, shown on the right of every shell's topbar. */
export function TopbarActions({ pill }: { pill: React.ReactNode }) {
  const { logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    navigate("/login", { replace: true });
  };

  return (
    <>
      {pill}
      <button
        type="button"
        aria-label="Notifications"
        className="flex h-9 w-9 items-center justify-center rounded-[10px] border border-surface-border bg-white text-ink-700"
      >
        <Bell className="h-[17px] w-[17px]" />
      </button>
      <button
        type="button"
        onClick={handleLogout}
        aria-label="Sign out"
        className="flex h-9 w-9 items-center justify-center rounded-[10px] border border-surface-border bg-white text-ink-700 hover:bg-surface-bg"
      >
        <LogOut className="h-[17px] w-[17px]" />
      </button>
    </>
  );
}
