import { Bell } from "lucide-react";

/**
 * Notification bell, shown on the right of every shell's topbar. Sign-out
 * moved into the sidebar's profile menu (AppShell.tsx) alongside "My
 * Profile" — one discoverable menu instead of a separate icon button.
 */
export function TopbarActions({ pill }: { pill: React.ReactNode }) {
  return (
    <>
      {pill}
      <button
        type="button"
        aria-label="Notifications"
        className="flex h-9 w-9 items-center justify-center rounded-[10px] border border-surface-border bg-white text-ink-700 transition-colors duration-150 hover:bg-surface-bg"
      >
        <Bell className="h-[17px] w-[17px]" />
      </button>
    </>
  );
}
