import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ChevronRight, ClipboardList, FileText, Loader2, MoreVertical, Plus } from "lucide-react";
import { createPortal } from "react-dom";
import { useAuth } from "../../auth/useAuth";
import { usePatientContext } from "../../clinical/usePatientContext";
import { ApiError } from "../../lib/apiClient";
import {
  listClientRegistry,
  type ClientRegistryCategory,
  type ClientRegistryRow,
} from "../../lib/clinicalApi";
import { Callout, PageHeader, PriorityPill } from "../care/shared/ui";
import { clientRecordPath, clientReportPath } from "../care/shared/recordRoutes";
import { RegistrationDetailsDrawer } from "./RegistrationDetailsDrawer";

const TABS: { label: string; category?: ClientRegistryCategory }[] = [
  { label: "All" },
  { label: "Awaiting triage", category: "awaiting-triage" },
  { label: "Emergency", category: "emergency" },
  { label: "Inpatient", category: "INPATIENT" },
  { label: "Outpatient", category: "OUTPATIENT" },
  { label: "Residential", category: "RESIDENTIAL" },
];

function sexLabel(sex: string) {
  if (sex === "MALE") return "M";
  if (sex === "FEMALE") return "F";
  if (sex === "NOT_STATED" || sex === "NOT_SAID") return "—";
  return sex ? "Other" : "—";
}

function settingLabel(setting: string) {
  switch (setting) {
    case "INPATIENT":
      return "Inpatient";
    case "OUTPATIENT":
      return "Outpatient";
    case "RESIDENTIAL":
      return "Residential";
    case "PARTIAL":
      return "Partial";
    case "POSTTREATMENT_SUPPORT":
      return "Post-treatment support";
    default:
      return setting || "—";
  }
}

function allergyLabel(patient: ClientRegistryRow) {
  if (patient.allergies.length) return `ALLERGY: ${patient.allergies.join(", ")}`;
  if (patient.allergy_status === "UNKNOWN") return "Unknown";
  if (patient.allergy_status === "NONE") return "None recorded";
  return "Active allergies on file";
}

/** Set by the registration page after a successful registration. */
interface RegisteredNotice {
  id: string;
  name: string;
  returning: boolean;
  queuedForTriage: boolean;
}

export function ClientRegistryPage() {
  const { accessToken } = useAuth();
  const { selectPatient } = usePatientContext();
  const navigate = useNavigate();
  const location = useLocation();
  const [registered, setRegistered] = useState<RegisteredNotice | null>(
    () => (location.state as { registered?: RegisteredNotice } | null)?.registered ?? null,
  );
  // Drop the notice from history so a refresh or Back does not show it again.
  useEffect(() => {
    if ((location.state as { registered?: unknown } | null)?.registered) {
      navigate(location.pathname + location.search, { replace: true, state: null });
    }
  }, [location, navigate]);
  const [patients, setPatients] = useState<ClientRegistryRow[]>([]);
  const [count, setCount] = useState(0);
  const [category, setCategory] = useState<ClientRegistryCategory | undefined>();
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"recent" | "name">("recent");
  const [page, setPage] = useState(1);
  const [hasNext, setHasNext] = useState(false);
  const [hasPrevious, setHasPrevious] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestSequence = useRef(0);

  const reload = useCallback(() => {
    if (!accessToken) return;
    const requestId = ++requestSequence.current;
    setIsLoading(true);
    setError(null);
    listClientRegistry(accessToken, { category, page, q: query || undefined, sort })
      .then((data) => {
        if (requestId !== requestSequence.current) return;
        setPatients(data.results);
        setCount(data.total_count);
        setHasNext(data.next !== null);
        setHasPrevious(data.previous !== null);
      })
      .catch((err: unknown) => {
        if (requestId === requestSequence.current) {
          setError(err instanceof ApiError ? err.message : "Couldn't load the client registry.");
        }
      })
      .finally(() => {
        if (requestId === requestSequence.current) setIsLoading(false);
      });
  }, [accessToken, category, page, query, sort]);

  // Search as the user types, without a request per keystroke.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setQuery(search.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (!cancelled) reload();
    });
    return () => {
      cancelled = true;
      requestSequence.current += 1;
    };
  }, [reload]);

  // The client whose registration details are shown, read-only.
  const [detailsFor, setDetailsFor] = useState<string | null>(null);
  // The row being opened, so it shows "Opening…" until the record loads.
  const [opening, setOpening] = useState<string | null>(null);
  const openPatient = (patient: ClientRegistryRow) => {
    if (opening) return;
    setOpening(patient.id);
    selectPatient(patient.id, patient.name);
    navigate(clientRecordPath(patient.id, "triage"));
  };

  const activeTab = category ?? "";

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Clients"
        subtitle={
          <>
            {isLoading ? "Loading" : error ? "—" : count} client records · one record per person,
            encounters and episodes beneath it
          </>
        }
        actions={
          <button
            type="button"
            onClick={() => navigate("/clinical/registration")}
            className="flex items-center gap-1.5 rounded-md bg-brand-green px-4 py-2.5 text-sm font-semibold text-on-primary shadow-sm transition-colors duration-150 hover:bg-brand-green-dark"
          >
            <Plus className="h-4 w-4" />
            Register client
          </button>
        }
      />

      {registered && (
        <Callout tone="success" role="status" className="mb-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>
              <strong>{registered.name}</strong>{" "}
              {registered.returning ? "— new visit registered" : "registered successfully"}
              {registered.queuedForTriage ? " and added to the triage queue." : "."}
            </span>
            <span className="flex gap-3">
              <button
                type="button"
                className="font-semibold text-brand-green-dark underline"
                onClick={() => {
                  selectPatient(registered.id, registered.name);
                  navigate(clientRecordPath(registered.id, "snapshot"));
                }}
              >
                Open client record
              </button>
              <button
                type="button"
                className="font-semibold text-ink-700 underline"
                onClick={() => setRegistered(null)}
              >
                Dismiss
              </button>
            </span>
          </div>
        </Callout>
      )}

      <div
        role="tablist"
        aria-label="Filter clients"
        className="mb-5 flex overflow-x-auto rounded-lg border border-surface-border bg-surface-card"
      >
        {TABS.map((tab) => {
          const selected = activeTab === (tab.category ?? "");
          return (
            <button
              key={tab.label}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => {
                setCategory(tab.category);
                setPage(1);
              }}
              className={`shrink-0 border-r border-surface-border px-4 py-2 text-[13px] transition-colors last:border-r-0 ${
                selected
                  ? "bg-brand-green-tint font-semibold text-brand-green-dark"
                  : "text-ink-700 hover:bg-surface-bg hover:text-ink-900"
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          type="search"
          aria-label="Search clients by name or number"
          placeholder="Search by name or client number"
          className="min-w-[240px] flex-1 rounded-md border border-surface-border bg-surface-card px-3 py-2 text-[13px] text-ink-900"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          aria-label="Order"
          className="rounded-md border border-surface-border bg-surface-card px-3 py-2 text-[13px] text-ink-900"
          value={sort}
          onChange={(e) => {
            setSort(e.target.value as "recent" | "name");
            setPage(1);
          }}
        >
          <option value="recent">Newest registered first</option>
          <option value="name">By surname</option>
        </select>
      </div>

      <div className="overflow-x-auto rounded-lg border border-surface-border bg-surface-card shadow-sm">
        <table className="w-full min-w-[1060px] border-collapse text-left text-[13px]">
          <thead className="border-b border-surface-border bg-surface-bg text-[11px] font-semibold uppercase tracking-wide text-ink-500">
            <tr>
              <th className="px-4 py-3">Client</th>
              <th className="px-4 py-3">Age / sex</th>
              <th className="px-4 py-3">Setting</th>
              <th className="px-4 py-3">Priority</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Allergies</th>
              <th className="px-4 py-3">Responsible team</th>
              <th className="px-4 py-3">
                <span className="sr-only">Open</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={8} className="px-4 py-6 text-center text-ink-500">
                  Loading clients…
                </td>
              </tr>
            )}
            {!isLoading && error && (
              <tr>
                <td colSpan={8} className="px-4 py-6 text-center text-status-red" role="alert">
                  <div>{error}</div>
                  <button
                    type="button"
                    onClick={reload}
                    className="mt-2 font-semibold text-brand-green-dark underline"
                  >
                    Try again
                  </button>
                </td>
              </tr>
            )}
            {!isLoading && !error && patients.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-6 text-center text-ink-500">
                  No clients in this view.
                </td>
              </tr>
            )}
            {!isLoading &&
              !error &&
              patients.map((patient) => (
                <tr
                  key={patient.id}
                  onClick={() => openPatient(patient)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      openPatient(patient);
                    }
                  }}
                  tabIndex={0}
                  aria-current={patient.id === registered?.id ? "true" : undefined}
                  aria-busy={opening === patient.id || undefined}
                  className="group cursor-pointer border-b aria-[current=true]:bg-brand-green-tint border-surface-border last:border-b-0 transition-colors duration-150 hover:bg-brand-green-tint-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-green"
                >
                  <td className="px-4 py-3 font-semibold text-ink-900">
                    <span>{patient.name}</span>
                    <span className="ml-3 font-mono font-normal text-ink-500">
                      {patient.client_number || "—"}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-ink-700">
                    {patient.age ?? "—"} · {sexLabel(patient.sex)}
                  </td>
                  <td className="px-4 py-3 text-ink-700">{settingLabel(patient.setting)}</td>
                  <td className="px-4 py-3">
                    <PriorityPill priority={patient.priority} />
                  </td>
                  <td className="px-4 py-3">
                    <span className="inline-flex rounded-full bg-brand-green-tint px-2.5 py-1 text-xs font-semibold text-brand-green-dark">
                      {patient.status}
                    </span>
                  </td>
                  <td
                    className={`px-4 py-3 font-semibold ${
                      patient.allergies.length || patient.allergy_status === "ACTIVE_ALLERGIES"
                        ? "text-status-red"
                        : "text-ink-700"
                    }`}
                  >
                    {allergyLabel(patient)}
                  </td>
                  <td className="px-4 py-3 text-ink-700">{patient.responsible_team || "—"}</td>
                  <td className="w-px whitespace-nowrap px-4 py-3 text-right">
                    <span className="inline-flex items-center gap-1.5">
                      {opening === patient.id ? (
                        <span
                          role="status"
                          className="inline-flex items-center gap-1.5 text-xs font-semibold text-brand-green-dark"
                        >
                          <Loader2 aria-hidden className="h-4 w-4 animate-spin" />
                          Opening…
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-md border border-surface-border px-2.5 py-1 text-xs font-semibold text-brand-green-dark transition-colors group-hover:border-brand-green group-hover:bg-brand-green group-hover:text-on-primary">
                          Open
                          <ChevronRight aria-hidden className="h-3.5 w-3.5" />
                        </span>
                      )}
                      <RowActions
                        name={patient.name}
                        onDetails={() => setDetailsFor(patient.id)}
                        onReport={() => {
                          selectPatient(patient.id, patient.name);
                          navigate(clientReportPath(patient.id));
                        }}
                        onOpen={() => openPatient(patient)}
                      />
                    </span>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      {(hasNext || hasPrevious) && (
        <div className="mt-3 flex items-center justify-end gap-2 text-sm text-ink-700">
          <button
            type="button"
            onClick={() => {
              setPage((current) => Math.max(1, current - 1));
            }}
            disabled={!hasPrevious || isLoading}
            className="rounded-md border border-surface-border bg-surface-card px-3 py-1.5 text-ink-900 transition-colors hover:bg-surface-bg disabled:opacity-40"
          >
            Previous
          </button>
          <span>Page {page}</span>
          <button
            type="button"
            onClick={() => {
              setPage((current) => current + 1);
            }}
            disabled={!hasNext || isLoading}
            className="rounded-md border border-surface-border bg-surface-card px-3 py-1.5 text-ink-900 transition-colors hover:bg-surface-bg disabled:opacity-40"
          >
            Next
          </button>
        </div>
      )}
      <RegistrationDetailsDrawer patientId={detailsFor} onClose={() => setDetailsFor(null)} />
    </div>
  );
}

/** The ⋮ menu on a registry row. Its clicks never reach the row (which opens
 * the record). */
function RowActions({
  name,
  onDetails,
  onReport,
  onOpen,
}: {
  name: string;
  onDetails: () => void;
  onReport: () => void;
  onOpen: () => void;
}) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = buttonRef.current?.getBoundingClientRect();
      if (!rect) return;
      const height = menuRef.current?.offsetHeight ?? 140;
      const below = rect.bottom + 4;
      setPos({
        top: below + height > window.innerHeight ? rect.top - height - 4 : below,
        right: Math.max(8, window.innerWidth - rect.right),
      });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      const t = event.target as Node;
      if (!buttonRef.current?.contains(t) && !menuRef.current?.contains(t)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    menuRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const choose = (action: () => void) => (event: React.MouseEvent) => {
    event.stopPropagation();
    setOpen(false);
    action();
  };
  const item =
    "flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[13px] text-ink-900 outline-none hover:bg-brand-green-tint focus-visible:bg-brand-green-tint";

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-label={`Actions for ${name}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(event) => {
          event.stopPropagation();
          setOpen((o) => !o);
        }}
        onKeyDown={(event) => event.stopPropagation()}
        className="flex h-8 w-8 items-center justify-center rounded-md text-ink-500 hover:bg-surface-bg hover:text-ink-900"
      >
        <MoreVertical aria-hidden className="h-4 w-4" />
      </button>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            aria-label={`Actions for ${name}`}
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
              event.preventDefault();
              const items = [
                ...(menuRef.current?.querySelectorAll<HTMLButtonElement>("button") ?? []),
              ];
              const at = items.indexOf(document.activeElement as HTMLButtonElement);
              const next =
                (at + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
              items[next]?.focus();
            }}
            style={{ top: pos?.top ?? -9999, right: pos?.right ?? -9999 }}
            className="fixed z-[70] w-60 rounded-xl border border-surface-border bg-surface-card p-1.5 shadow-[0_12px_32px_rgba(0,0,0,0.18)]"
          >
            <button type="button" role="menuitem" className={item} onClick={choose(onDetails)}>
              <ClipboardList aria-hidden className="h-4 w-4 text-ink-500" />
              View registration details
            </button>
            <button type="button" role="menuitem" className={item} onClick={choose(onReport)}>
              <FileText aria-hidden className="h-4 w-4 text-ink-500" />
              Full client report
            </button>
            <button type="button" role="menuitem" className={item} onClick={choose(onOpen)}>
              <ChevronRight aria-hidden className="h-4 w-4 text-ink-500" />
              Open client record
            </button>
          </div>,
          document.body,
        )}
    </>
  );
}
