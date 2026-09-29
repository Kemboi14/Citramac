import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/useAuth";
import { NotificationIcon } from "../components/NotificationIcon";
import { ApiError } from "../lib/apiClient";
import { severityAccent, timeAgo } from "../lib/notificationFormat";
import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  type Notification,
  type NotificationCategory,
} from "../lib/notificationsApi";

const CATEGORY_FILTERS: { value: NotificationCategory | ""; label: string }[] = [
  { value: "", label: "All" },
  { value: "RISK_ALERT", label: "Risk alerts" },
  { value: "SUBSCRIPTION", label: "Subscription" },
  { value: "RETENTION", label: "Records retention" },
  { value: "SYSTEM", label: "System" },
];

const PAGE_SIZE = 25;

/**
 * Every notification the signed-in user has received — the "View all" page
 * behind the topbar bell (shells/TopbarActions.tsx), mounted in each shell.
 * Filters are server-side (`?category=`, `?unread=`), so they apply to the
 * whole history rather than just the page on screen.
 */
export function NotificationsPage() {
  const { accessToken } = useAuth();
  const navigate = useNavigate();
  const [category, setCategory] = useState<NotificationCategory | "">("");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<Notification[]>([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Bumped to re-fetch the current page (e.g. after "mark all as read").
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!accessToken) return;
    let ignore = false;
    listNotifications(accessToken, {
      page,
      category: category || undefined,
      unread: unreadOnly,
    })
      .then((result) => {
        if (ignore) return;
        setItems(result.results);
        setCount(result.count);
        setError(null);
      })
      .catch((err) => {
        if (!ignore) {
          setError(err instanceof ApiError ? err.message : "Couldn't load notifications.");
        }
      })
      .finally(() => {
        if (!ignore) setLoading(false);
      });
    return () => {
      ignore = true;
    };
  }, [accessToken, page, category, unreadOnly, version]);

  // Every filter/page change goes through here, so the loading state is set
  // by the event that caused the re-fetch rather than inside the effect.
  const refetch = (apply: () => void) => {
    setLoading(true);
    apply();
  };

  const open = async (notification: Notification) => {
    if (!accessToken) return;
    if (!notification.is_read) {
      try {
        await markNotificationRead(accessToken, notification.id);
        setItems((prev) =>
          prev.map((n) => (n.id === notification.id ? { ...n, is_read: true } : n)),
        );
      } catch {
        // Best-effort — still follow the link.
      }
    }
    if (notification.link) navigate(notification.link);
  };

  const markAll = async () => {
    if (!accessToken) return;
    try {
      await markAllNotificationsRead(accessToken);
      refetch(() => setVersion((v) => v + 1));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't mark notifications as read.");
    }
  };

  const pageCount = Math.max(1, Math.ceil(count / PAGE_SIZE));

  return (
    <div className="flex flex-col gap-6 animate-fade-in">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-brand-green">
            Inbox
          </div>
          <h1 className="font-display text-2xl font-bold text-ink-900">Notifications</h1>
        </div>
        <button
          type="button"
          onClick={markAll}
          className="rounded-md border border-surface-border bg-surface-card px-4 py-2 text-sm font-semibold text-ink-700 transition-colors duration-150 hover:bg-surface-bg"
        >
          Mark all as read
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {CATEGORY_FILTERS.map((filter) => (
          <button
            key={filter.value || "all"}
            type="button"
            onClick={() =>
              refetch(() => {
                setCategory(filter.value);
                setPage(1);
              })
            }
            className={`rounded-full px-3 py-1.5 text-[12.5px] font-semibold transition-colors duration-150 ${
              category === filter.value
                ? "bg-brand-green text-white"
                : "border border-surface-border bg-surface-card text-ink-700 hover:bg-surface-bg"
            }`}
          >
            {filter.label}
          </button>
        ))}
        <label className="ml-auto flex items-center gap-2 text-[12.5px] font-medium text-ink-700">
          <input
            type="checkbox"
            checked={unreadOnly}
            onChange={(e) => {
              const checked = e.target.checked;
              refetch(() => {
                setUnreadOnly(checked);
                setPage(1);
              });
            }}
            className="accent-brand-green"
          />
          Unread only
        </label>
      </div>

      {error && (
        <p className="rounded-sm bg-status-red-tint px-3 py-2 text-sm text-status-red">{error}</p>
      )}

      <div className="overflow-hidden rounded-lg border border-surface-border bg-surface-card shadow-sm">
        {loading ? (
          <div className="flex items-center justify-center gap-2 px-4 py-12 text-sm text-ink-500">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading notifications…
          </div>
        ) : items.length === 0 ? (
          <p className="px-4 py-12 text-center text-sm text-ink-500">
            {unreadOnly || category ? "Nothing matches these filters." : "No notifications yet."}
          </p>
        ) : (
          <ul>
            {items.map((n) => (
              <li key={n.id}>
                <button
                  type="button"
                  onClick={() => open(n)}
                  className={`flex w-full gap-3 border-b border-l-2 border-surface-border px-4 py-3.5 text-left last:border-b-0 hover:bg-surface-bg ${severityAccent(
                    n.severity,
                  )} ${n.is_read ? "" : "bg-brand-green-tint-2"}`}
                >
                  <NotificationIcon
                    notification={n}
                    className="mt-0.5 h-[18px] w-[18px] flex-shrink-0"
                  />
                  <span className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="flex items-center gap-2 text-[13.5px] font-semibold text-ink-900">
                      {!n.is_read && (
                        <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-brand-green" />
                      )}
                      {n.title}
                    </span>
                    {n.body && <span className="text-[12.5px] text-ink-700">{n.body}</span>}
                    <span
                      className="text-[11px] text-ink-400"
                      title={new Date(n.created_at).toLocaleString()}
                    >
                      {timeAgo(n.created_at)}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {pageCount > 1 && (
        <div className="flex items-center justify-end gap-3 text-sm text-ink-700">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => refetch(() => setPage((p) => p - 1))}
            className="rounded-md border border-surface-border bg-surface-card px-3 py-1.5 font-semibold disabled:opacity-50"
          >
            Previous
          </button>
          <span>
            Page {page} of {pageCount}
          </span>
          <button
            type="button"
            disabled={page >= pageCount}
            onClick={() => refetch(() => setPage((p) => p + 1))}
            className="rounded-md border border-surface-border bg-surface-card px-3 py-1.5 font-semibold disabled:opacity-50"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
