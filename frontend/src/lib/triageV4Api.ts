// Triage v4 (backend/apps/care_pathway/triage_v4.py, triage_queue.py) — the rule
// metadata for the v4 triage screen and the live queue.
import { apiRequest } from "./apiClient";
import type { Priority, PriorityOrBlank, TriageEvaluation } from "./carePathwayApi";

export interface V4Reason {
  priority: Priority;
  reason: string;
  rule: string;
}

export interface V4FindingItem {
  finding: string;
  status: string;
  source: string;
  source_code: string;
  source_detail: string;
}

export interface EwsResult {
  score: number;
  measured: number;
  total_parameters: number;
  complete: boolean;
  single_parameter_3: boolean;
  parts: Record<string, number | null>;
  glucose_low: boolean;
  glucose_high: boolean;
  diastolic_high: boolean;
  label: string;
  response: { tone: string; text: string };
  approval: string;
}

/** The v4 evaluation is the v3 shape plus these fields. */
export interface TriageV4Evaluation extends TriageEvaluation {
  schema?: "v4" | "v5";
  ruleset_label?: string;
  reason_list?: V4Reason[];
  finding_items?: V4FindingItem[];
  ews?: EwsResult | null;
  recommended_actions?: string[];
  safety_required?: boolean;
}

export interface VitalRange {
  label: string;
  unit: string;
  hard_min: number;
  hard_max: number;
  soft_min: number;
  soft_max: number;
}

export interface TriageV4Config {
  rules_version: string;
  ruleset_label: string;
  flags: { code: string; group: string; level: PriorityOrBlank; hint: string }[];
  groups: { code: string; title: string; question: string; key: string }[];
  vital_ranges: Record<string, VitalRange>;
  ews_priority: Record<string, number>;
  ews_version: string;
  ews_approval: string;
  seen_target_minutes: Record<string, number>;
  pep_window_hours: number;
  override_reason_min: number;
  approval: string;
}

export function getTriageV4Config(accessToken: string) {
  return apiRequest<TriageV4Config>("/care/triage/v4/config/", { accessToken });
}

export type QueueLane = "awaiting" | "waiting" | "in_care" | "discharged";

export interface QueueChip {
  key: string;
  label: string;
  tone: "risk" | "warn" | "info";
  sev: number;
  count?: number;
  labels?: string[];
}

export interface LiveQueueRow {
  id: string;
  patient_id: string;
  lane: QueueLane;
  name: string;
  privacy_name: string;
  citramac_number: string;
  identity_status: string;
  age: number | null;
  sex: string;
  arrival_at: string;
  triage_version: number;
  priority: PriorityOrBlank;
  rules_version: string;
  wait: { minutes: number; target: number | null; over: boolean; kind: string };
  next_action: { key: string; text: string; due_at: string | null; overdue: boolean; kind: string } | null;
  next_follow_up: string | null;
  observation: { off_site: boolean; level: string; location: string; observer: string } | null;
  owner: { id: string; name: string } | null;
  team: string;
  attention: QueueChip[];
  seen_at: string | null;
}

export interface LiveQueue {
  lanes: Record<QueueLane, LiveQueueRow[]>;
  over_target: number;
  now: string;
  triage_target_minutes: number;
  seen_target_minutes: Record<string, number>;
  targets_approval: string;
}

export function getLiveQueue(accessToken: string) {
  return apiRequest<LiveQueue>("/care/queue/live/", { accessToken });
}
