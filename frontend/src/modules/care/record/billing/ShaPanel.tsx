import { useEffect, useRef, useState } from "react";
import { ApiError } from "../../../../lib/apiClient";
import {
  cancelShaVisit,
  checkShaEligibility,
  closeShaVisit,
  listShaContacts,
  openShaVisit,
  refreshShaVisit,
  requestShaOtpWhitelist,
  searchShaInterventions,
  sendShaVisitOtp,
  type BillingWorkspace,
  type ShaContact,
  type ShaEligibility,
  type ShaInterventionPage,
  type ShaSection,
  type ShaVisit,
  type ShaVisitIntervention,
} from "../../../../lib/claimsApi";
import { formatDateTime } from "../../shared/format";
import { BTN, BTN_GHOST, BTN_SM, INPUT, TABLE, TD, TH } from "../../shared/styles";
import { Callout, Card, Field, Tag } from "../../shared/ui";
import { yesNo, type Ask, type Run } from "./billingUtil";
import { Kv } from "./parts";

// Billing stage → SHA through the DHA HIE (apps.insurance_claims
// sha_eligibility / sha_claims): the client's Client Registry ID, SHA
// eligibility, and the consented SHA visit every SHA claim is billed against.
// The client must be present to open a visit (OTP to their phone, or their
// fingerprint). Every code and enum shown here comes from SHA or from the
// server's published value sets — none is held in this file.

/** HealthID hardware server on the clerk's own PC (DHA biometrics spec). */
const HEALTHID_STATUS_URL = "http://localhost:18065/status";
const HEALTHID_TIMEOUT_MS = 2_500;
const POLL_MS = 5_000;
/** SHA's fingerprint capture link is valid for 10 minutes. */
const CAPTURE_VALID_MS = 10 * 60_000;
/** The only service types fingerprint consent covers (sha_claims.AUTHORIZE_SERVICE_TYPES). */
const FINGERPRINT_SERVICE_TYPES = ["OUTPATIENT", "INPATIENT"];
const DEVICE_OS = ["windows", "android"] as const;

interface PanelProps {
  sha: ShaSection;
  canEdit: boolean;
  busy: boolean;
  run: Run;
  ask: Ask;
  accessToken: string;
  patientId: string;
  onChange: (next: BillingWorkspace) => void;
}

function BranchSelect({
  id,
  branches,
  value,
  onChange,
  disabled,
}: {
  id: string;
  branches: ShaSection["branches"];
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <select
      id={id}
      className={INPUT}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">Choose the branch…</option>
      {branches.map((b) => (
        <option key={b.id} value={b.id}>
          {b.name} · FR {b.fr_code}
        </option>
      ))}
    </select>
  );
}

function visitTone(status: ShaVisit["status"]): "brand" | "warn" | "risk" | "neutral" {
  if (status === "OPEN") return "brand";
  if (status === "AWAITING_CONSENT") return "warn";
  if (status === "REJECTED") return "risk";
  return "neutral";
}

function EligibilityView({ eligibility }: { eligibility: ShaEligibility }) {
  return (
    <div className="grid gap-3">
      <Kv
        rows={[
          ["Checked", formatDateTime(eligibility.checked_at)],
          ["Searched by", eligibility.identification_type || "—"],
          [
            "Found in SHA",
            eligibility.found ? (
              <Tag tone="brand">Yes · CR {eligibility.member_cr_number}</Tag>
            ) : (
              <Tag tone="risk">No</Tag>
            ),
          ],
          [
            "Active cover",
            eligibility.active_rule_configured ? (
              eligibility.active ? (
                <Tag tone="brand">Active</Tag>
              ) : (
                <Tag tone="risk">Not active</Tag>
              )
            ) : (
              <span>
                <Tag tone="warn">Not confirmed</Tag>
                <span className="mt-1 block text-[12px] font-normal text-ink-500">
                  The rule for which SHA coverage words mean “active” is not configured yet, so
                  active cover can’t be confirmed here — read SHA’s own status words below.
                </span>
              </span>
            ),
          ],
          ["Alive (SHA record)", yesNo(eligibility.is_alive)],
          ["Fingerprint consent enforced at this facility", yesNo(eligibility.biometrics_enforced)],
          ["Whitelisted for OTP", yesNo(eligibility.whitelisted_for_otp)],
          ["POMSF / TSC / USALAMA scheme", eligibility.pomsf ? "Yes" : "No"],
          [
            "SHA status",
            eligibility.status_code || eligibility.status_desc
              ? `${eligibility.status_code}${eligibility.status_code && eligibility.status_desc ? " · " : ""}${eligibility.status_desc}`
              : "—",
          ],
        ]}
      />
      {eligibility.schemes.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-surface-border">
          <table className={`${TABLE} min-w-[720px]`}>
            <thead>
              <tr>
                <th className={TH}>Scheme</th>
                <th className={TH}>Coverage status</th>
                <th className={TH}>SHA’s message</th>
                <th className={TH}>Policy</th>
              </tr>
            </thead>
            <tbody>
              {eligibility.schemes.map((s, index) => (
                <tr key={`${s.name}-${index}`}>
                  <td className={TD}>
                    <span className="font-semibold">{s.name || "—"}</span>
                    {s.member_type && (
                      <span className="block text-[12px] text-ink-500">{s.member_type}</span>
                    )}
                  </td>
                  <td className={TD}>
                    <Tag>{s.coverage_status || "Not stated"}</Tag>
                    {s.coverage_end && (
                      <span className="mt-1 block text-[12px] text-ink-500">
                        Ends {s.coverage_end}
                      </span>
                    )}
                  </td>
                  <td className={TD}>
                    {s.coverage_message || "—"}
                    {s.coverage_reason && (
                      <span className="mt-1 block text-[12px] text-ink-500">
                        Reason: {s.coverage_reason}
                      </span>
                    )}
                    {s.possible_solution && (
                      <span className="mt-1 block text-[12px] text-ink-500">
                        Possible solution: {s.possible_solution}
                      </span>
                    )}
                  </td>
                  <td className={`${TD} font-mono`}>{s.policy_number || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function OtpWhitelistForm({
  sha,
  run,
  accessToken,
  patientId,
}: Pick<PanelProps, "sha" | "run" | "accessToken" | "patientId">) {
  const [form, setForm] = useState({
    branch: sha.branches.length === 1 ? sha.branches[0].id : "",
    reasonType: "",
    reason: "",
    attempts: "",
  });
  return (
    <form
      className="grid gap-2 rounded-lg border border-surface-border bg-surface-bg p-3"
      onSubmit={async (e) => {
        e.preventDefault();
        const ok = await run(
          () =>
            requestShaOtpWhitelist(accessToken, patientId, {
              branch: form.branch,
              reason_type: form.reasonType,
              reason: form.reason,
              biometric_attempts: Number(form.attempts) || 0,
            }),
          "Request sent to SHA to allow OTP consent for this client. Check eligibility again for SHA’s answer.",
        );
        if (ok) setForm((f) => ({ ...f, reasonType: "", reason: "", attempts: "" }));
      }}
    >
      <h4 className="text-[13px] font-bold text-ink-900">Ask SHA to allow OTP consent</h4>
      <p className="text-[12px] text-ink-500">
        Only when the client’s fingerprints can’t be used. SHA decides; until it whitelists the
        client, this facility must use fingerprint consent.
      </p>
      <div className="grid gap-2 min-[700px]:grid-cols-4">
        <Field label="Branch" htmlFor="wl-branch">
          <BranchSelect
            id="wl-branch"
            branches={sha.branches}
            value={form.branch}
            onChange={(branch) => setForm((f) => ({ ...f, branch }))}
          />
        </Field>
        <Field label="Reason (SHA’s list)" htmlFor="wl-type">
          <select
            id="wl-type"
            className={INPUT}
            required
            value={form.reasonType}
            onChange={(e) => setForm((f) => ({ ...f, reasonType: e.target.value }))}
          >
            <option value="">Choose…</option>
            {sha.otp_whitelist_reasons.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Explanation" htmlFor="wl-reason">
          <input
            id="wl-reason"
            className={INPUT}
            value={form.reason}
            onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))}
          />
        </Field>
        <Field label="Fingerprint attempts made" htmlFor="wl-attempts">
          <input
            id="wl-attempts"
            className={INPUT}
            inputMode="numeric"
            value={form.attempts}
            onChange={(e) =>
              setForm((f) => ({ ...f, attempts: e.target.value.replace(/[^0-9]/g, "") }))
            }
          />
        </Field>
      </div>
      <div>
        <button
          type="submit"
          className={`${BTN_GHOST} ${BTN_SM}`}
          disabled={!form.branch || !form.reasonType}
        >
          Send request to SHA
        </button>
      </div>
    </form>
  );
}

function InterventionPicker({
  branch,
  selected,
  onAdd,
  onRemove,
  ask,
  accessToken,
  patientId,
}: {
  branch: string;
  selected: ShaVisitIntervention[];
  onAdd: (item: ShaVisitIntervention) => void;
  onRemove: (code: string) => void;
  ask: Ask;
  accessToken: string;
  patientId: string;
}) {
  const [search, setSearch] = useState("");
  const [result, setResult] = useState<{ query: string; page: ShaInterventionPage } | null>(null);
  const chosen = new Set(selected.map((s) => s.code));

  const load = async (query: string, page: number) => {
    const data = await ask(() =>
      searchShaInterventions(accessToken, patientId, { branch, search: query, page }),
    );
    if (data) setResult({ query, page: data });
  };

  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-end gap-2">
        <Field
          label="Find SHA interventions"
          htmlFor="iv-search"
          className="w-72"
          hint={
            branch
              ? "Name or code, from SHA’s catalogue for this client"
              : "Choose the branch first"
          }
        >
          <input
            id="iv-search"
            className={INPUT}
            value={search}
            disabled={!branch}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                if (branch) void load(search.trim(), 1);
              }
            }}
          />
        </Field>
        <button
          type="button"
          className={`${BTN_GHOST} ${BTN_SM} mb-[22px]`}
          disabled={!branch}
          onClick={() => void load(search.trim(), 1)}
        >
          Search SHA
        </button>
      </div>

      {selected.length > 0 && (
        <ul className="grid gap-1.5" aria-label="Interventions on this visit">
          {selected.map((s) => (
            <li
              key={s.code}
              className="flex flex-wrap items-center gap-2 rounded-lg border border-brand-green bg-brand-green-tint px-3 py-1.5 text-[12.5px]"
            >
              <span className="font-mono font-semibold">{s.code}</span>
              <span>{s.name}</span>
              <button
                type="button"
                className="ml-auto text-[11px] font-semibold text-ink-500 underline-offset-2 hover:underline"
                onClick={() => onRemove(s.code)}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      {selected.length > 1 && (
        <Callout tone="warning">
          SHA allows some interventions only on their own, and only certain ones together. SHA’s
          rules decide — the visit is refused if this combination isn’t allowed.
        </Callout>
      )}

      {result && (
        <div className="grid gap-2">
          {result.page.results.length === 0 ? (
            <p className="text-[12.5px] text-ink-500">
              SHA returned no interventions for that search.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-surface-border">
              <table className={`${TABLE} min-w-[760px]`}>
                <thead>
                  <tr>
                    <th className={TH}>Code</th>
                    <th className={TH}>Intervention</th>
                    <th className={TH}>Payment mechanism</th>
                    <th className={TH}>Pre-auth</th>
                    <th className={TH}>Documents SHA requires</th>
                    <th className={TH}>
                      <span className="sr-only">Add</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {result.page.results.map((item) => (
                    <tr key={item.code}>
                      <td className={`${TD} font-mono`}>{item.code}</td>
                      <td className={TD}>
                        {item.name}
                        {item.parent_benefit_name && (
                          <span className="block text-[12px] text-ink-500">
                            {item.parent_benefit_name}
                          </span>
                        )}
                        {item.active === false && <Tag tone="risk">Inactive at SHA</Tag>}
                      </td>
                      <td className={TD}>{item.payment_mechanism || "—"}</td>
                      <td className={TD}>
                        {item.needs_preauth ? (
                          <Tag tone="warn">
                            Needed{item.needs_manual_preauth_approval ? " · manual approval" : ""}
                          </Tag>
                        ) : (
                          "Not needed"
                        )}
                      </td>
                      <td className={TD}>
                        {item.applicable_document_types.length
                          ? item.applicable_document_types.join(", ")
                          : "—"}
                      </td>
                      <td className={TD}>
                        <button
                          type="button"
                          className={`${BTN_GHOST} ${BTN_SM}`}
                          disabled={chosen.has(item.code)}
                          onClick={() =>
                            onAdd({
                              code: item.code,
                              name: item.name,
                              needs_preauth: item.needs_preauth,
                              payment_mechanism: item.payment_mechanism,
                              applicable_document_types: item.applicable_document_types,
                            })
                          }
                        >
                          {chosen.has(item.code) ? "Added" : "Add"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {result.page.total_pages > 1 && (
            <div className="flex items-center gap-2 text-[12px] text-ink-500">
              <button
                type="button"
                className={`${BTN_GHOST} ${BTN_SM}`}
                disabled={result.page.page <= 1}
                onClick={() => void load(result.query, result.page.page - 1)}
              >
                Previous
              </button>
              Page {result.page.page} of {result.page.total_pages} · {result.page.count} found
              <button
                type="button"
                className={`${BTN_GHOST} ${BTN_SM}`}
                disabled={result.page.page >= result.page.total_pages}
                onClick={() => void load(result.query, result.page.page + 1)}
              >
                Next
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Asks the HealthID hardware server on this PC for its workstation ID.
 * Null when it isn't running or the browser blocks the call — the clerk then
 * types the ID shown by the HealthID app. */
async function detectWorkstation(): Promise<{
  id: string;
  devices: { deviceId: string; status: string; type: string }[];
} | null> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), HEALTHID_TIMEOUT_MS);
  try {
    const response = await fetch(HEALTHID_STATUS_URL, { signal: controller.signal });
    if (!response.ok) return null;
    const body: unknown = await response.json();
    if (!body || typeof body !== "object") return null;
    const { workstationID, devices } = body as { workstationID?: unknown; devices?: unknown };
    if (typeof workstationID !== "string" || !workstationID) return null;
    return {
      id: workstationID,
      devices: Array.isArray(devices)
        ? devices.map((d: { deviceId?: unknown; status?: unknown; type?: unknown }) => ({
            deviceId: String(d?.deviceId ?? ""),
            status: String(d?.status ?? ""),
            type: String(d?.type ?? ""),
          }))
        : [],
    };
  } catch {
    return null;
  } finally {
    window.clearTimeout(timer);
  }
}

export interface VisitPrefill {
  branch: string;
  serviceType: string;
  interventions: ShaVisitIntervention[];
  /** SHA rejected fingerprint consent and allows OTP instead. */
  otpFallback: boolean;
}

function OpenVisitForm({
  sha,
  prefill,
  run,
  ask,
  accessToken,
  patientId,
  onOpened,
}: Pick<PanelProps, "sha" | "run" | "ask" | "accessToken" | "patientId"> & {
  prefill: VisitPrefill | null;
  onOpened: () => void;
}) {
  const eligibility = sha.eligibility;
  const fingerprintOnly =
    eligibility?.biometrics_enforced === true &&
    eligibility.whitelisted_for_otp !== true &&
    !prefill?.otpFallback;
  const [branch, setBranch] = useState(
    prefill?.branch ?? (sha.branches.length === 1 ? sha.branches[0].id : ""),
  );
  const [serviceType, setServiceType] = useState(prefill?.serviceType ?? "");
  const [interventions, setInterventions] = useState<ShaVisitIntervention[]>(
    prefill?.interventions ?? [],
  );
  const [method, setMethod] = useState<"OTP" | "BIOMETRIC" | "">(
    prefill?.otpFallback ? "OTP" : fingerprintOnly ? "BIOMETRIC" : "",
  );
  const [contacts, setContacts] = useState<ShaContact[] | null>(null);
  const [contactId, setContactId] = useState("");
  const [otp, setOtp] = useState("");
  const [agentId, setAgentId] = useState("");
  const [workstation, setWorkstation] = useState({
    id: "",
    state: "idle" as "idle" | "detecting" | "detected" | "manual",
    devices: [] as { deviceId: string; status: string; type: string }[],
  });
  const [deviceOs, setDeviceOs] = useState<(typeof DEVICE_OS)[number]>("windows");

  const codes = interventions.map((i) => i.code);
  const serviceTypes =
    method === "BIOMETRIC"
      ? sha.service_types.filter((t) => FINGERPRINT_SERVICE_TYPES.includes(t))
      : sha.service_types;

  const detect = async () => {
    setWorkstation((w) => ({ ...w, state: "detecting" }));
    const found = await detectWorkstation();
    setWorkstation((w) =>
      found
        ? { id: found.id, state: "detected", devices: found.devices }
        : { ...w, state: "manual", devices: [] },
    );
  };

  const chooseMethod = (next: "OTP" | "BIOMETRIC") => {
    setMethod(next);
    if (next === "BIOMETRIC") {
      if (serviceType && !FINGERPRINT_SERVICE_TYPES.includes(serviceType)) setServiceType("");
      if (workstation.state === "idle") void detect();
    }
  };

  const ready = branch && serviceType && codes.length > 0;

  const open = async () => {
    const ok = await run(
      () =>
        method === "OTP"
          ? openShaVisit(accessToken, patientId, {
              consent_method: "OTP",
              branch,
              service_type: serviceType,
              intervention_codes: codes,
              otp: otp.trim(),
            })
          : openShaVisit(accessToken, patientId, {
              consent_method: "BIOMETRIC",
              branch,
              service_type: serviceType,
              intervention_codes: codes,
              agent_id: agentId.trim(),
              work_station_id: workstation.id.trim(),
              device_os: deviceOs,
            }),
      method === "OTP"
        ? "SHA visit opened with the client’s OTP."
        : "Fingerprint consent started — the client places their finger on the reader below.",
    );
    if (ok) onOpened();
  };

  return (
    <div className="grid gap-3 rounded-lg border border-surface-border p-3">
      <h4 className="text-[13px] font-bold text-ink-900">Open an SHA visit</h4>
      <p className="text-[12px] text-ink-500">
        The client must be present: SHA records their consent by an OTP sent to their phone or by
        their fingerprint.
      </p>
      {prefill?.otpFallback && (
        <Callout tone="warning">
          SHA rejected fingerprint consent for this visit and allows OTP instead.
        </Callout>
      )}
      <div className="grid gap-2 min-[700px]:grid-cols-2">
        <Field label="Branch the client is at" htmlFor="visit-branch">
          <BranchSelect
            id="visit-branch"
            branches={sha.branches}
            value={branch}
            onChange={(value) => {
              setBranch(value);
              setContacts(null);
              setContactId("");
            }}
          />
        </Field>
        <Field label="Service type" htmlFor="visit-service">
          <select
            id="visit-service"
            className={INPUT}
            value={serviceType}
            onChange={(e) => setServiceType(e.target.value)}
          >
            <option value="">Choose…</option>
            {serviceTypes.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <InterventionPicker
        branch={branch}
        selected={interventions}
        onAdd={(item) => setInterventions((list) => [...list, item])}
        onRemove={(code) => setInterventions((list) => list.filter((i) => i.code !== code))}
        ask={ask}
        accessToken={accessToken}
        patientId={patientId}
      />

      <fieldset className="grid gap-1.5">
        <legend className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-500">
          Client’s consent
        </legend>
        <label className="flex items-center gap-2 text-[13px]">
          <input
            type="radio"
            name="visit-consent"
            className="accent-[var(--green)]"
            checked={method === "OTP"}
            disabled={fingerprintOnly}
            onChange={() => chooseMethod("OTP")}
          />
          OTP sent to the client’s phone
        </label>
        <label className="flex items-center gap-2 text-[13px]">
          <input
            type="radio"
            name="visit-consent"
            className="accent-[var(--green)]"
            checked={method === "BIOMETRIC"}
            onChange={() => chooseMethod("BIOMETRIC")}
          />
          Fingerprint
        </label>
        {fingerprintOnly && (
          <p className="text-[12px] text-ink-500">
            SHA enforces fingerprint consent at this facility and has not whitelisted this client
            for OTP. If their fingerprints can’t be used, ask SHA to allow OTP (below).
          </p>
        )}
      </fieldset>

      {method === "OTP" && (
        <div className="grid gap-2 rounded-lg border border-surface-border bg-surface-bg p-3">
          <div className="flex flex-wrap items-end gap-2">
            <Field
              label="Send to (SHA’s contacts for the client)"
              htmlFor="visit-contact"
              className="w-72"
              hint={contacts ? undefined : "Optional — SHA uses the client’s default contact"}
            >
              {contacts ? (
                <select
                  id="visit-contact"
                  className={INPUT}
                  value={contactId}
                  onChange={(e) => setContactId(e.target.value)}
                >
                  <option value="">SHA’s default contact</option>
                  {contacts.map((c) => (
                    <option key={c.id} value={c.id} disabled={!c.active}>
                      {c.type} · {c.value}
                      {c.confirmed ? "" : " (unconfirmed)"}
                      {c.active ? "" : " (inactive)"}
                    </option>
                  ))}
                </select>
              ) : (
                <button
                  id="visit-contact"
                  type="button"
                  className={`${BTN_GHOST} ${BTN_SM}`}
                  disabled={!branch}
                  onClick={async () => {
                    const data = await ask(() => listShaContacts(accessToken, patientId, branch));
                    if (data) setContacts(data.contacts);
                  }}
                >
                  Load contacts from SHA
                </button>
              )}
            </Field>
            <button
              type="button"
              className={`${BTN_GHOST} ${BTN_SM} mb-[22px]`}
              disabled={!branch || codes.length === 0}
              onClick={() =>
                void ask(
                  () =>
                    sendShaVisitOtp(accessToken, patientId, {
                      branch,
                      intervention_codes: codes,
                      contact_id: contactId || undefined,
                    }),
                  (r) => r.message,
                )
              }
            >
              Send OTP
            </button>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <Field label="OTP the client received" htmlFor="visit-otp" className="w-48">
              <input
                id="visit-otp"
                className={INPUT}
                inputMode="numeric"
                autoComplete="one-time-code"
                value={otp}
                onChange={(e) => setOtp(e.target.value)}
              />
            </Field>
            <button
              type="button"
              className={`${BTN} ${BTN_SM} mb-[2px]`}
              disabled={!ready || !otp.trim()}
              onClick={() => void open()}
            >
              Open visit
            </button>
          </div>
        </div>
      )}

      {method === "BIOMETRIC" && (
        <div className="grid gap-2 rounded-lg border border-surface-border bg-surface-bg p-3">
          <div className="grid gap-2 min-[700px]:grid-cols-3">
            <Field
              label="Biometrics agent’s national ID"
              htmlFor="visit-agent"
              hint="Sent to SHA with this request; not stored here."
            >
              <input
                id="visit-agent"
                className={INPUT}
                autoComplete="off"
                value={agentId}
                onChange={(e) => setAgentId(e.target.value)}
              />
            </Field>
            <Field
              label="Workstation ID"
              htmlFor="visit-ws"
              hint={
                workstation.state === "detecting"
                  ? "Asking the HealthID app on this PC…"
                  : workstation.state === "detected"
                    ? "Read from the HealthID app on this PC."
                    : workstation.state === "manual"
                      ? "The HealthID app on this PC didn’t answer — type the ID it shows."
                      : undefined
              }
            >
              <div className="flex gap-1.5">
                <input
                  id="visit-ws"
                  className={INPUT}
                  value={workstation.id}
                  onChange={(e) =>
                    setWorkstation((w) => ({ ...w, id: e.target.value, state: "manual" }))
                  }
                />
                <button
                  type="button"
                  className={`${BTN_GHOST} ${BTN_SM}`}
                  disabled={workstation.state === "detecting"}
                  onClick={() => void detect()}
                >
                  Detect
                </button>
              </div>
            </Field>
            <Field label="Device operating system" htmlFor="visit-os">
              <select
                id="visit-os"
                className={INPUT}
                value={deviceOs}
                onChange={(e) => setDeviceOs(e.target.value as (typeof DEVICE_OS)[number])}
              >
                {DEVICE_OS.map((os) => (
                  <option key={os} value={os}>
                    {os}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          {workstation.devices.length > 0 && (
            <ul className="flex flex-wrap gap-1.5" aria-label="Fingerprint devices on this PC">
              {workstation.devices.map((d) => (
                <li key={d.deviceId}>
                  <Tag>
                    {d.type || "Device"} {d.deviceId} · {d.status}
                  </Tag>
                </li>
              ))}
            </ul>
          )}
          <div>
            <button
              type="button"
              className={`${BTN} ${BTN_SM}`}
              disabled={!ready || !agentId.trim() || !workstation.id.trim()}
              onClick={() => void open()}
            >
              Start fingerprint consent
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function BiometricCapture({
  visit,
  busy,
  run,
  accessToken,
  onChange,
}: {
  visit: ShaVisit;
  busy: boolean;
  run: Run;
  accessToken: string;
  onChange: (next: BillingWorkspace) => void;
}) {
  // The capture link dates from when consent was requested, not from when
  // this screen was opened.
  const [requestedAt] = useState(() => {
    const entry = [...visit.status_history].reverse().find((h) => h.state === "AWAITING_CONSENT");
    const at = entry ? Date.parse(entry.at) : NaN;
    return Number.isNaN(at) ? Date.now() : at;
  });
  const [expired, setExpired] = useState(false);
  const [pollError, setPollError] = useState<string | null>(null);
  const busyRef = useRef(busy);
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    busyRef.current = busy;
    onChangeRef.current = onChange;
  });

  useEffect(() => {
    if (expired || pollError) return;
    let cancelled = false;
    let inFlight = false;
    const timer = window.setInterval(() => {
      if (Date.now() - requestedAt > CAPTURE_VALID_MS) {
        setExpired(true);
        return;
      }
      // A finance action in progress returns the newer workspace itself.
      if (busyRef.current || inFlight) return;
      inFlight = true;
      refreshShaVisit(accessToken, visit.id)
        .then((next) => !cancelled && onChangeRef.current(next))
        .catch(
          (err) =>
            !cancelled &&
            setPollError(
              err instanceof ApiError
                ? err.message
                : "SHA could not be reached to check the fingerprint consent.",
            ),
        )
        .finally(() => {
          inFlight = false;
        });
    }, POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [accessToken, visit.id, requestedAt, expired, pollError]);

  return (
    <div className="grid gap-2">
      {expired ? (
        <Callout tone="warning">
          The fingerprint capture link has expired (SHA allows 10 minutes). Check once more in case
          the client finished just now; otherwise cancel this request and start again.
        </Callout>
      ) : pollError ? (
        <Callout tone="warning">
          Checking stopped: {pollError} Use “Check now” to try again.
        </Callout>
      ) : (
        <>
          <p className="text-[12px] text-ink-500" role="status">
            Waiting for the client’s fingerprint — this checks SHA every 5 seconds.
          </p>
          {visit.biometric_capture_url && (
            <iframe
              src={visit.biometric_capture_url}
              title="SHA fingerprint capture"
              className="h-[460px] w-full rounded-lg border border-surface-border bg-surface-card"
            />
          )}
        </>
      )}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={`${BTN_GHOST} ${BTN_SM}`}
          onClick={async () => {
            if (await run(() => refreshShaVisit(accessToken, visit.id))) {
              setPollError(null);
            }
          }}
        >
          Check now
        </button>
        <button
          type="button"
          className={`${BTN_GHOST} ${BTN_SM}`}
          onClick={() =>
            void run(
              () => cancelShaVisit(accessToken, visit.id),
              "Fingerprint consent request cancelled.",
            )
          }
        >
          Cancel fingerprint request
        </button>
      </div>
    </div>
  );
}

function CloseVisitForm({
  visit,
  sha,
  run,
  accessToken,
}: {
  visit: ShaVisit;
  sha: ShaSection;
  run: Run;
  accessToken: string;
}) {
  const [form, setForm] = useState({ open: false, reasonType: "", reasonText: "" });
  if (!form.open) {
    return (
      <button
        type="button"
        className={`${BTN_GHOST} ${BTN_SM}`}
        onClick={() => setForm((f) => ({ ...f, open: true }))}
      >
        Close visit
      </button>
    );
  }
  const id = `close-${visit.id}`;
  return (
    <div className="flex flex-wrap items-end gap-2">
      <Field label="Reason (SHA’s list)" htmlFor={`${id}-type`} className="w-56">
        <select
          id={`${id}-type`}
          className={INPUT}
          value={form.reasonType}
          onChange={(e) => setForm((f) => ({ ...f, reasonType: e.target.value }))}
        >
          <option value="">Choose…</option>
          {sha.close_reasons.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Explanation" htmlFor={`${id}-text`} className="w-64">
        <input
          id={`${id}-text`}
          className={INPUT}
          value={form.reasonText}
          onChange={(e) => setForm((f) => ({ ...f, reasonText: e.target.value }))}
        />
      </Field>
      <button
        type="button"
        className={`${BTN_GHOST} ${BTN_SM}`}
        disabled={!form.reasonType}
        onClick={() =>
          void run(
            () =>
              closeShaVisit(accessToken, visit.id, {
                reason_type: form.reasonType,
                reason_text: form.reasonText,
              }),
            "SHA visit closed.",
          )
        }
      >
        Close at SHA
      </button>
      <button
        type="button"
        className={`${BTN_GHOST} ${BTN_SM}`}
        onClick={() => setForm({ open: false, reasonType: "", reasonText: "" })}
      >
        Keep open
      </button>
    </div>
  );
}

export function ShaVisitSummary({ visit }: { visit: ShaVisit }) {
  return (
    <Kv
      rows={[
        [
          "Status",
          <span key="status" className="inline-flex flex-wrap items-center gap-1.5">
            <Tag tone={visitTone(visit.status)}>{visit.status_label}</Tag>
            {visit.authorization_state && <Tag>SHA: {visit.authorization_state}</Tag>}
          </span>,
        ],
        ...(visit.authorization_reason
          ? ([["SHA’s reason", visit.authorization_reason]] as [string, string][])
          : []),
        ["Branch", `${visit.branch.name} · FR ${visit.branch.fr_code}`],
        ["Service type", visit.service_type],
        ["Consent", visit.consent_method === "OTP" ? "OTP" : "Fingerprint"],
        [
          "Interventions",
          <ul key="iv" className="grid gap-1">
            {visit.interventions.map((i) => (
              <li key={i.code}>
                <span className="font-mono">{i.code}</span> {i.name}
                <span className="block text-[12px] font-normal text-ink-500">
                  {[
                    i.payment_mechanism,
                    i.needs_preauth ? "pre-auth needed" : null,
                    i.applicable_document_types.length
                      ? `documents: ${i.applicable_document_types.join(", ")}`
                      : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </li>
            ))}
          </ul>,
        ],
        ...(visit.workflow_state || visit.payer_workflow_state
          ? ([
              [
                "SHA workflow",
                [visit.workflow_state, visit.payer_workflow_state].filter(Boolean).join(" · "),
              ],
            ] as [string, string][])
          : []),
        ["Opened", visit.opened_at ? formatDateTime(visit.opened_at) : "—"],
        ...(visit.closed_at
          ? ([["Closed", formatDateTime(visit.closed_at)]] as [string, string][])
          : []),
      ]}
    />
  );
}

function VisitItem({
  visit,
  sha,
  canEdit,
  busy,
  run,
  accessToken,
  onChange,
  onUseOtp,
}: {
  visit: ShaVisit;
  sha: ShaSection;
  canEdit: boolean;
  busy: boolean;
  run: Run;
  accessToken: string;
  onChange: (next: BillingWorkspace) => void;
  onUseOtp: (visit: ShaVisit) => void;
}) {
  return (
    <li className="grid gap-2 rounded-lg border border-surface-border p-3">
      <ShaVisitSummary visit={visit} />
      {canEdit && visit.status === "AWAITING_CONSENT" && (
        <BiometricCapture
          visit={visit}
          busy={busy}
          run={run}
          accessToken={accessToken}
          onChange={onChange}
        />
      )}
      {canEdit && visit.status === "REJECTED" && visit.otp_fallback_allowed && (
        <div>
          <button type="button" className={`${BTN} ${BTN_SM}`} onClick={() => onUseOtp(visit)}>
            Use OTP instead
          </button>
        </div>
      )}
      {canEdit && visit.status === "OPEN" && (
        <CloseVisitForm visit={visit} sha={sha} run={run} accessToken={accessToken} />
      )}
      {visit.status_history.length > 0 && (
        <ol className="grid gap-1 text-[12px] text-ink-700" aria-label="Visit history">
          {visit.status_history.map((h, index) => (
            <li key={index}>
              <span className="font-mono text-ink-500">{formatDateTime(h.at)}</span> ·{" "}
              <span className="font-semibold">{h.state.replace(/_/g, " ").toLowerCase()}</span>
              {h.by && ` · ${h.by}`}
              {h.note && ` — ${h.note}`}
            </li>
          ))}
        </ol>
      )}
    </li>
  );
}

export function ShaPanel(props: PanelProps) {
  const { sha, canEdit, busy, run, ask, accessToken, patientId, onChange } = props;
  const [eligibilityBranch, setEligibilityBranch] = useState(
    sha.branches.length === 1 ? sha.branches[0].id : "",
  );
  const [visitForm, setVisitForm] = useState<{ key: number; prefill: VisitPrefill | null }>({
    key: 0,
    prefill: null,
  });
  const eligibility = sha.eligibility;
  const fingerprintOnly =
    eligibility?.biometrics_enforced === true && eligibility.whitelisted_for_otp !== true;

  return (
    <Card title="SHA (Social Health Authority) · through the DHA HIE">
      <div className="grid gap-4">
        <Kv
          rows={[
            [
              "Client Registry ID",
              sha.cr_id ? (
                <span key="cr" className="font-mono">
                  {sha.cr_id}
                </span>
              ) : (
                <Tag key="cr" tone="warn">
                  None yet
                </Tag>
              ),
            ],
          ]}
        />
        {!sha.cr_id && (
          <Callout tone="warning">
            SHA visits and benefits are read by the client’s Client Registry ID. Look the client up
            in the Client Registry from their record (client details) and confirm the match first.
          </Callout>
        )}
        {sha.branches.length === 0 && (
          <Callout tone="warning">
            No branch is set up for SHA claims. An Org Admin turns on SHA claims and records the
            branch’s SHA FR code in Branch Settings.
          </Callout>
        )}

        <div className="grid gap-2">
          <h3 className="text-[13px] font-bold text-ink-900">Eligibility</h3>
          {eligibility ? (
            <EligibilityView eligibility={eligibility} />
          ) : (
            <p className="text-[13px] text-ink-500">Not checked with SHA yet.</p>
          )}
          {canEdit && (
            <div className="flex flex-wrap items-end gap-2">
              <Field label="Branch" htmlFor="elig-branch" className="w-72">
                <BranchSelect
                  id="elig-branch"
                  branches={sha.branches}
                  value={eligibilityBranch}
                  onChange={setEligibilityBranch}
                />
              </Field>
              <button
                type="button"
                className={`${BTN_GHOST} ${BTN_SM} mb-[2px]`}
                disabled={!eligibilityBranch}
                onClick={() =>
                  void run(
                    () => checkShaEligibility(accessToken, patientId, eligibilityBranch),
                    "Eligibility checked with SHA.",
                  )
                }
              >
                Check eligibility
              </button>
            </div>
          )}
        </div>

        {canEdit && sha.cr_id && sha.branches.length > 0 && (
          <OpenVisitForm
            key={visitForm.key}
            sha={sha}
            prefill={visitForm.prefill}
            run={run}
            ask={ask}
            accessToken={accessToken}
            patientId={patientId}
            onOpened={() => setVisitForm((f) => ({ key: f.key + 1, prefill: null }))}
          />
        )}
        {canEdit && fingerprintOnly && sha.branches.length > 0 && (
          <OtpWhitelistForm sha={sha} run={run} accessToken={accessToken} patientId={patientId} />
        )}

        <div className="grid gap-2">
          <h3 className="text-[13px] font-bold text-ink-900">SHA visits</h3>
          {sha.visits.length === 0 ? (
            <p className="text-[13px] text-ink-500">No SHA visit opened for this client yet.</p>
          ) : (
            <ul className="grid gap-2">
              {sha.visits.map((visit) => (
                <VisitItem
                  key={visit.id}
                  visit={visit}
                  sha={sha}
                  canEdit={canEdit}
                  busy={busy}
                  run={run}
                  accessToken={accessToken}
                  onChange={onChange}
                  onUseOtp={(v) =>
                    setVisitForm((f) => ({
                      key: f.key + 1,
                      prefill: {
                        branch: v.branch.id,
                        serviceType: v.service_type,
                        interventions: v.interventions,
                        otpFallback: true,
                      },
                    }))
                  }
                />
              ))}
            </ul>
          )}
        </div>
      </div>
    </Card>
  );
}
