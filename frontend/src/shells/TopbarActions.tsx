import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bell } from "lucide-react";
import { useAuth } from "../auth/useAuth";
import {
  getUnreadNotificationCount,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  type Notification,
} from "../lib/notificationsApi";

const POLL_INTERVAL_MS = 60_000;

function timeAgo(iso: string): string {
  const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/**
 * Notification bell, shown on the right of every shell's topbar. Sign-out
 * moved into the sidebar's profile menu (AppShell.tsx) alongside "My
 * Profile" — one discoverable menu instead of a separate icon button.
 */
export function TopbarActions({ pill }: { pill: React.ReactNode }) {
  const { accessToken } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!accessToken) return;
    const poll = () => {
      getUnreadNotificationCount(accessToken)
        .then((r) => setUnreadCount(r.count))
        .catch(() => {
          // Best-effort — a transient failure just means a stale badge until the next poll.
        });
    };
    poll();
    const interval = setInterval(poll, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [accessToken]);

  useEffect(() => {
    if (!open || !accessToken) return;
    listNotifications(accessToken)
      .then((res) => setNotifications(res.results))
      .catch(() => setNotifications([]));
  }, [open, accessToken]);

  useEffect(() => {
    if (!open) return;
    const handleClick = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  const openNotification = async (notification: Notification) => {
    if (!accessToken) return;
    if (!notification.is_read) {
      try {
        await markNotificationRead(accessToken, notification.id);
        setUnreadCount((c) => Math.max(0, c - 1));
        setNotifications((prev) =>
          prev.map((n) => (n.id === notification.id ? { ...n, is_read: true } : n)),
        );
      } catch {
        // Best-effort — still navigate even if marking-read failed.
      }
    }
    setOpen(false);
    if (notification.link) navigate(notification.link);
  };

  const markAllRead = async () => {
    if (!accessToken) return;
    try {
      await markAllNotificationsRead(accessToken);
      setUnreadCount(0);
      setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
    } catch {
      // Best-effort only.
    }
  };

  return (
    <>
      {pill}
      <div className="relative" ref={ref}>
        <button
          type="button"
          aria-label="Notifications"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="relative flex h-9 w-9 items-center justify-center rounded-[10px] border border-surface-border bg-surface-card text-ink-700 transition-colors duration-150 hover:bg-surface-bg"
        >
          <Bell className="h-[17px] w-[17px]" />
          {unreadCount > 0 && (
            <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-status-red px-1 text-[9px] font-bold text-white">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </button>
        {open && (
          <div className="absolute right-0 top-11 z-30 w-80 max-w-[calc(100vw-2rem)] animate-scale-in overflow-hidden rounded-[10px] border border-surface-border bg-surface-card shadow-md">
            <div className="flex items-center justify-between border-b border-surface-border px-3.5 py-2.5">
              <span className="text-[12.5px] font-semibold text-ink-900">Notifications</span>
              {unreadCount > 0 && (
                <button
                  type="button"
                  onClick={markAllRead}
                  className="text-[11px] font-semibold text-brand-green hover:underline"
                >
                  Mark all as read
                </button>
              )}
            </div>
            <div className="max-h-80 overflow-y-auto">
              {notifications.length === 0 && (
                <p className="px-3.5 py-6 text-center text-[12.5px] text-ink-500">
                  You're all caught up.
                </p>
              )}
              {notifications.map((n) => (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => openNotification(n)}
                  className={`flex w-full flex-col gap-0.5 border-b border-surface-border px-3.5 py-2.5 text-left last:border-0 hover:bg-surface-bg ${
                    n.is_read ? "" : "bg-brand-green-tint-2"
                  }`}
                >
                  <span className="flex items-center gap-1.5 text-[12.5px] font-semibold text-ink-900">
                    {!n.is_read && <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-brand-green" />}
                    {n.title}
                  </span>
                  {n.body && <span className="text-[11.5px] text-ink-500">{n.body}</span>}
                  <span className="text-[10px] text-ink-400">{timeAgo(n.created_at)}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
