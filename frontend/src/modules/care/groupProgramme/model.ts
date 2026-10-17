// Workspace state helpers for the Group Psychotherapy page — the mockup's
// groupProgrammeWorkspaceItems / groupProgrammeSessionStatus / groupProgrammeItemTab.
// Everything here is in-memory React state; nothing is written to browser storage.
import type {
  AttendanceCode,
  GroupCategory,
  GroupClient,
  GroupSessionDetailsPayload,
  GroupSessionRow,
  ScheduledGroupSession,
  StaffMember,
} from "../../../lib/groupProgrammeApi";

export type SessionTab = "today" | "week" | "past";
export type ProgrammeView = "session" | "utilisation";

export const SESSION_TABS: [SessionTab, string][] = [
  ["today", "Today"],
  ["week", "This week"],
  ["past", "Past"],
];

/** Facilitator select value for someone who is not in the staff directory. */
export const OTHER_FACILITATOR = "__other__";

export interface SessionForm {
  category: string;
  categoryOther: string;
  topic: string;
  sessionDate: string;
  startTime: string;
  endTime: string;
  facilitatorId: string;
  facilitatorName: string;
  location: string;
  description: string;
}

export interface DraftAttendance {
  attendance?: AttendanceCode;
  observation?: string;
  riskDisclosure?: boolean;
  followUp?: boolean;
}

/** A session being documented: its details and the attendance marked so far. */
export interface SessionDraft {
  details: SessionForm;
  attendance: Record<string, DraftAttendance>;
}

export interface Filters {
  programme: string;
  unit: string;
  eligibility: "eligible" | "all";
}

export interface WorkspaceItem {
  key: string;
  kind: "saved" | "scheduled" | "draft";
  date: string;
  time: string;
  endTime: string;
  category: string;
  topic: string;
  facilitator: string;
  location: string;
  tab: SessionTab;
  session?: GroupSessionRow;
  scheduled?: ScheduledGroupSession;
}

const pad = (n: number) => String(n).padStart(2, "0");

export function localDateIso(date = new Date()) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function localTimeHm(date: Date) {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** A scheduled appointment's date, start and end in the browser's local time,
 *  from the ISO instants (falling back to the server's facility-time strings). */
export function scheduledLocal(item: ScheduledGroupSession) {
  const start = item.starts_at ? new Date(item.starts_at) : null;
  if (!start || Number.isNaN(start.getTime())) {
    return { date: item.date, time: item.time, endTime: item.end_time };
  }
  const end = item.ends_at ? new Date(item.ends_at) : null;
  const sameDay = end && !Number.isNaN(end.getTime()) && localDateIso(end) === localDateIso(start);
  return {
    date: localDateIso(start),
    time: localTimeHm(start),
    endTime: end && sameDay && end > start ? localTimeHm(end) : "",
  };
}

export function itemTab(date: string): SessionTab {
  const today = localDateIso();
  if (date < today) return "past";
  return date > today ? "week" : "today";
}

export function sessionDateLabel(date: string) {
  if (date === localDateIso()) return "Today";
  const [year, month, day] = date.split("-").map(Number);
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(new Date(year, month - 1, day, 12));
}

export type StatusTone = "live" | "upcoming" | "past-due" | "completed";

export function sessionStatus(item: WorkspaceItem): { label: string; tone: StatusTone } {
  if (item.kind === "saved") return { label: "Confirmed", tone: "completed" };
  if (item.kind === "draft") return { label: "Draft", tone: "upcoming" };
  const today = localDateIso();
  if (item.date > today) return { label: "Upcoming", tone: "upcoming" };
  if (item.date < today) return { label: "Awaiting documentation", tone: "past-due" };
  if (!item.time) return { label: "Scheduled", tone: "upcoming" };
  const currentTime = localTimeHm(new Date());
  if (item.time > currentTime) return { label: "Scheduled", tone: "upcoming" };
  if (!item.endTime || item.endTime > currentTime) return { label: "In progress", tone: "live" };
  return { label: "Awaiting documentation", tone: "past-due" };
}

export function workspaceItems(
  sessions: GroupSessionRow[],
  scheduled: ScheduledGroupSession[],
  draftKey: string | null,
  drafts: Record<string, SessionDraft>,
): WorkspaceItem[] {
  const saved: WorkspaceItem[] = sessions.map((session) => ({
    key: `session:${session.id}`,
    kind: "saved",
    date: session.session_date,
    time: session.start_time,
    endTime: session.end_time,
    category: session.category,
    topic: session.topic,
    facilitator: session.facilitator,
    location: session.location,
    tab: itemTab(session.session_date),
    session,
  }));
  const booked: WorkspaceItem[] = scheduled.map((item) => {
    const local = scheduledLocal(item);
    return {
      key: item.key,
      kind: "scheduled",
      ...local,
      category: item.category,
      topic: item.topic,
      facilitator: item.facilitator,
      location: item.location,
      tab: itemTab(local.date),
      scheduled: item,
    };
  });
  // eslint-disable-next-line security/detect-object-injection -- key is a draft id from state.
  const draft = draftKey ? drafts[draftKey] : undefined;
  const draftItems: WorkspaceItem[] = draftKey
    ? [
        {
          key: draftKey,
          kind: "draft",
          date: localDateIso(),
          time: "",
          endTime: "",
          category: "Group psychotherapy",
          topic: draft?.details.topic.trim() || "New group session",
          facilitator: "Facilitator not assigned",
          location: "Location not assigned",
          tab: "today",
        },
      ]
    : [];
  return [...saved, ...booked, ...draftItems].sort((a, b) =>
    `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`),
  );
}

/** The editor's starting values for a scheduled appointment or a new draft. */
export function initialDetails(
  item: WorkspaceItem | undefined,
  categories: GroupCategory[],
  currentUser: StaffMember,
  staff: StaffMember[],
): SessionForm {
  const scheduled = item?.scheduled;
  const local = scheduled ? scheduledLocal(scheduled) : null;
  const byType = scheduled
    ? categories.find((c) => c.display.toLowerCase() === scheduled.category.toLowerCase())
    : categories.find((c) => c.code === "group_psychotherapy");
  const facilitatorId =
    scheduled?.facilitator_id && staff.some((s) => s.id === scheduled.facilitator_id)
      ? scheduled.facilitator_id
      : currentUser.id;
  return {
    category: byType?.code ?? "",
    categoryOther: "",
    topic: scheduled?.topic ?? "",
    sessionDate: local?.date ?? localDateIso(),
    startTime: local?.time ?? "",
    endTime: local?.endTime ?? "",
    facilitatorId,
    facilitatorName: "",
    location: scheduled && scheduled.location !== "Location not assigned" ? scheduled.location : "",
    description: "",
  };
}

export function detailsFromSession(session: GroupSessionRow): SessionForm {
  return {
    category: session.category_code,
    categoryOther: session.category_other,
    topic: session.topic,
    sessionDate: session.session_date,
    startTime: session.start_time,
    endTime: session.end_time,
    facilitatorId: session.facilitator_id ?? OTHER_FACILITATOR,
    facilitatorName: session.facilitator_name,
    location: session.location,
    description: session.description,
  };
}

export function detailsPayload(
  form: SessionForm,
  categories: GroupCategory[],
): GroupSessionDetailsPayload {
  const isOther = categories.find((c) => c.code === form.category)?.is_other ?? false;
  const external = form.facilitatorId === OTHER_FACILITATOR;
  return {
    category: form.category,
    category_other: isOther ? form.categoryOther.trim() : "",
    topic: form.topic.trim(),
    session_date: form.sessionDate,
    start_time: form.startTime,
    end_time: form.endTime,
    facilitator: external ? null : form.facilitatorId || null,
    facilitator_name: external ? form.facilitatorName.trim() : "",
    location: form.location.trim(),
    description: form.description.trim(),
  };
}

/** Field → message for whatever stops the details being reviewed. Empty when valid. */
export function detailsErrors(form: SessionForm, categories: GroupCategory[]) {
  const errors: Record<string, string> = {};
  const required: [keyof SessionForm, string][] = [
    ["sessionDate", "Enter the session date."],
    ["category", "Choose a session category."],
    ["startTime", "Enter the start time."],
    ["endTime", "Enter the end time."],
    ["topic", "Enter the topic or activity."],
    ["location", "Enter the session location."],
    ["description", "Describe the shared session content or intervention."],
  ];
  for (const [field, message] of required) {
    // eslint-disable-next-line security/detect-object-injection -- fixed field list.
    if (!form[field].trim()) errors[field] = message;
  }
  if (categories.find((c) => c.code === form.category)?.is_other && !form.categoryOther.trim()) {
    errors.categoryOther = "Enter the approved category name.";
  }
  if (!form.facilitatorId) errors.facilitatorId = "Choose the facilitator.";
  if (form.facilitatorId === OTHER_FACILITATOR && !form.facilitatorName.trim()) {
    errors.facilitatorName = "Enter the facilitator's name.";
  }
  if (form.startTime && form.endTime && form.endTime <= form.startTime) {
    errors.endTime = "End time must be after the start time.";
  }
  return errors;
}

export function matchesFilters(client: GroupClient, filters: Filters) {
  return (
    (!filters.programme || client.programme === filters.programme) &&
    (!filters.unit || client.unit === filters.unit) &&
    (filters.eligibility === "all" || client.eligible)
  );
}

export function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export function clientLabel(client: { display_id: string; name: string }) {
  return client.display_id ? `${client.display_id} · ${client.name}` : client.name;
}

/** API field errors (snake_case) keyed to the SessionForm fields they belong to. */
export function formFieldErrors(apiErrors: Record<string, string>) {
  const renamed: Record<string, string> = { facilitator: "facilitatorId" };
  return Object.fromEntries(
    Object.entries(apiErrors).map(([field, message]) => [
      // eslint-disable-next-line security/detect-object-injection -- fixed rename map.
      renamed[field] ?? field.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase()),
      message,
    ]),
  );
}

export function emptyCounts(): Record<AttendanceCode, number> {
  return { PRESENT: 0, ABSENT: 0, EXCUSED: 0, DECLINED: 0 };
}
