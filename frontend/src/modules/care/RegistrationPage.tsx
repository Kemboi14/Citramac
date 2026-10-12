import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../../auth/useAuth";
import {
  checkRegistrationDuplicates,
  getClientBanner,
  registerArrival,
  resolveIdentity,
  searchRegistrations,
  type ClientBanner,
  type ConsentDecision,
  type DuplicateMatch,
  type IdentityStatus,
  type RegistrationPayload,
  type RegistrationRow,
} from "../../lib/carePathwayApi";
import { newRequestId } from "./shared/format";
import { BTN, BTN_GHOST, BTN_SM, INPUT } from "./shared/styles";
import { Callout, Card, ErrorNote, PageHeader, SelectChoices, Tag } from "./shared/ui";
import { useValueSets } from "./shared/useValueSets";
import { REQUIRED_MARK, errorText } from "./triage/helpers";

// docs/15-CLINICAL-WORKSPACE-V3.md §1.4 — mockup frontdesk(), filterClients,
// selectExistingClientForRegistration, updateIdentityFields, registerTier1Client
// and beginIdentityResolution. Every option list is a served value set; nothing
// is held in browser storage (CLAUDE.md §5).

const MODES: { status: IdentityStatus; label: string; hint: string; submit: string }[] = [
  {
    status: "IDENTIFIED",
    label: "Tier 1 registration",
    hint: "Identified arrival. Search first to avoid creating a duplicate record.",
    submit: "Register & send to triage",
  },
  {
    status: "UNIDENTIFIED",
    label: "Unidentified person",
    hint: "The person is present but their name has not been confirmed. Add a brief description or alias so they can be safely identified later.",
    submit: "Register unidentified person & send to triage",
  },
  {
    status: "UNKNOWN",
    label: "Emergency — identity unknown",
    hint: "Emergency — identity unknown. Capture only what is available; registration must never delay urgent care.",
    submit: "Create emergency record & send to triage",
  },
];

const SELECTED_SUBMIT = "Register & send new encounter to triage";
const NAME_REQUIRED =
  "Enter the client’s full name, or change Identity status to Unidentified or Unknown to register without one.";
const DESCRIPTION_REQUIRED =
  "Add a brief description or reported temporary alias so this unidentified arrival can be distinguished safely.";
const OFFLINE =
  "Couldn't reach the server, so nothing was saved. Check your connection and submit again — a retry will not create a duplicate record.";

// Wording shown to the client before they decide. VERIFY: legal/DPO approval of
// this text is required before go-live; the snapshot stored with every decision
// is exactly this string (docs/09 §9.5), so changing it must bump the version.
const CONSENT_TEXT_VERSION = "registration-hie-v1-draft";
const CONSENT_TEXT = [
  "We would like to share your health information with the national Health Information Exchange so other clinicians involved in your care can see it.",
  "You can say yes, no, or share only within this facility, and you can choose separately for mental-health and substance-use information.",
  "You can change your mind at any time. Saying no will never stop you getting care.",
].join(" ");

const CONSENT_FIELDS: { key: keyof ConsentForm; label: string }[] = [
  { key: "general", label: "Share my general health information on the national HIE" },
  { key: "mental_health", label: "Share my mental-health information on the HIE" },
  { key: "substance_use", label: "Share my substance-use information on the HIE" },
  { key: "family", label: "Family / next of kin may be told about my care" },
];

interface ConsentForm {
  general: ConsentDecision;
  mental_health: ConsentDecision;
  substance_use: ConsentDecision;
  family: ConsentDecision;
}

const EMPTY_CONSENT: ConsentForm = {
  general: "NOT_ASKED",
  mental_health: "NOT_ASKED",
  substance_use: "NOT_ASKED",
  family: "NOT_ASKED",
};

interface RegForm {
  fullName: string;
  description: string;
  preferredName: string;
  pronouns: string;
  dob: string;
  estimatedAge: string;
  sex: string;
  phone: string;
  nextOfKin: string;
  nokPhone: string;
  nokRelationship: string;
  nokGuardian: boolean;
  guardianStatus: string;
  nokMayInform: boolean;
  address: string;
  idType: string;
  documentNumber: string;
  unhcrNumber: string;
  shaMemberNumber: string;
  referral: string;
  language: string;
  interpreter: string;
  allergyStatus: string;
  allergyDetails: string;
  payer: string;
  reason: string;
}

const EMPTY_FORM: RegForm = {
  fullName: "",
  description: "",
  preferredName: "",
  pronouns: "",
  dob: "",
  estimatedAge: "",
  sex: "",
  phone: "",
  nextOfKin: "",
  nokPhone: "",
  nokRelationship: "",
  nokGuardian: false,
  guardianStatus: "",
  nokMayInform: false,
  address: "",
  idType: "",
  documentNumber: "",
  unhcrNumber: "",
  shaMemberNumber: "",
  referral: "",
  language: "English",
  interpreter: "",
  allergyStatus: "",
  allergyDetails: "",
  payer: "",
  reason: "",
};

function formFromRow(row: RegistrationRow): RegForm {
  return {
    fullName: row.identity_status === "IDENTIFIED" ? row.name : "",
    description: row.identity_description || "",
    preferredName: row.preferred_name || "",
    pronouns: row.pronouns || "",
    dob: row.date_of_birth || "",
    estimatedAge: row.estimated_age !== null ? String(row.estimated_age) : "",
    sex: row.sex || "",
    phone: row.phone || "",
    nextOfKin: row.next_of_kin || "",
    nokPhone: "",
    nokRelationship: "",
    nokGuardian: false,
    guardianStatus: "",
    nokMayInform: false,
    address: row.address || "",
    idType: row.id_document_type || "",
    documentNumber: row.id_document_number || "",
    unhcrNumber: row.identifiers?.find((i) => i.kind === "UNHCR" && !i.superseded)?.value || "",
    shaMemberNumber:
      row.identifiers?.find((i) => i.kind === "SHA_MEMBER" && !i.superseded)?.value || "",
    referral: "",
    language: row.preferred_language || "English",
    interpreter: row.interpreter || "",
    allergyStatus: row.allergy_status || "",
    allergyDetails: row.allergy_status === "ACTIVE_ALLERGIES" ? row.allergy_details || "" : "",
    payer: row.payer || "",
    reason: "",
  };
}

/** `.registration-stage .field` — compact label + control. */
function RegField({
  id,
  label,
  className = "",
  children,
  error,
}: {
  id: string;
  label: ReactNode;
  className?: string;
  children: ReactNode;
  error?: string | null;
}) {
  return (
    <div className={`flex min-w-0 flex-col gap-1 ${className}`}>
      <label htmlFor={id} className="text-[10.5px] font-medium text-ink-900">
        {label}
      </label>
      {children}
      {error && (
        <p role="alert" className="text-[11px] font-medium text-priority-red">
          {error}
        </p>
      )}
    </div>
  );
}

const REG_INPUT = `${INPUT} !bg-surface-card !px-[9px] !py-[7px] !text-xs`;

export function RegistrationPage() {
  const { accessToken } = useAuth();
  const navigate = useNavigate();
  const vs = useValueSets();
  const [searchParams] = useSearchParams();
  const resolveId = searchParams.get("resolve");

  const [mode, setMode] = useState<IdentityStatus>("IDENTIFIED");
  const [form, setForm] = useState<RegForm>(EMPTY_FORM);
  const [selected, setSelected] = useState<RegistrationRow | null>(null);
  const [selectedLabel, setSelectedLabel] = useState(false);
  // One id per form instance: a retry after a network failure reuses it so the
  // server dedupes; a new one is issued after success, Clear or a new selection.
  const [requestId, setRequestId] = useState(() => newRequestId());
  const [feedback, setFeedback] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const [descriptionError, setDescriptionError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<RegistrationRow[] | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const searchTimer = useRef<number | undefined>(undefined);
  const searchSeq = useRef(0);

  const [consent, setConsent] = useState<ConsentForm>(EMPTY_CONSENT);
  // Duplicate handling: exact matches block; probable ones need an explicit
  // "different person" confirmation. `mergeTarget` is set when resolving an
  // identity onto an already-registered client.
  const [dupMatches, setDupMatches] = useState<DuplicateMatch[] | null>(null);
  const [confirmedNew, setConfirmedNew] = useState(false);
  const [mergeTarget, setMergeTarget] = useState<{ id: string; label: string } | null>(null);

  const [resolveTarget, setResolveTarget] = useState<ClientBanner | null>(null);
  const [resolveError, setResolveError] = useState<string | null>(null);

  const nameRef = useRef<HTMLInputElement>(null);
  const descriptionRef = useRef<HTMLInputElement>(null);
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const resolving = Boolean(resolveId);
  const modeInfo = MODES.find((m) => m.status === mode) ?? MODES[0];
  const identified = mode === "IDENTIFIED";

  // Identity resolution (§1.4): reopen Registration on the temporary record in
  // Tier 1 mode with the name empty and focused.
  useEffect(() => {
    if (!accessToken || !resolveId) return;
    let cancelled = false;
    getClientBanner(accessToken, resolveId)
      .then(async (banner) => {
        let row: RegistrationRow | undefined;
        if (banner.citramac_number) {
          const found = await searchRegistrations(accessToken, banner.citramac_number);
          row = found.results.find((r) => r.id === resolveId);
        }
        if (cancelled) return;
        setResolveTarget(banner);
        setForm({
          ...(row ? formFromRow(row) : EMPTY_FORM),
          fullName: "",
          dob: row?.date_of_birth || banner.date_of_birth || "",
          sex: row?.sex || banner.sex || "",
          phone: row?.phone || banner.phone || "",
        });
      })
      .catch((err) => {
        if (cancelled) return;
        setResolveError(errorText(err, "Couldn't load this temporary record."));
      });
    return () => {
      cancelled = true;
    };
  }, [accessToken, resolveId]);

  useEffect(() => {
    if (resolveTarget) nameRef.current?.focus();
  }, [resolveTarget]);

  useEffect(() => () => window.clearTimeout(searchTimer.current), []);

  const set = (key: keyof RegForm) => (value: string) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const firstCode = (id: string) => vs.options(id)[0]?.code ?? "";
  const interpreter = form.interpreter || firstCode("interpreter");
  const allergyStatus = form.allergyStatus || firstCode("registration-allergy-status");
  const showAllergyDetails = allergyStatus === "ACTIVE_ALLERGIES";

  function clearSelection() {
    setSelected(null);
    setSelectedLabel(false);
    setForm(EMPTY_FORM);
    setConsent(EMPTY_CONSENT);
    setDupMatches(null);
    setConfirmedNew(false);
    setMode("IDENTIFIED");
    setFeedback(null);
    setRequestId(newRequestId());
  }

  function changeMode(next: IdentityStatus) {
    if (selected && selected.identity_status === "IDENTIFIED" && next !== "IDENTIFIED") {
      clearSelection();
    }
    setMode(next);
    setSelectedLabel(false);
  }

  function onSearch(value: string) {
    setQuery(value);
    window.clearTimeout(searchTimer.current);
    const q = value.trim();
    const seq = ++searchSeq.current;
    if (!q) {
      setResults(null);
      setSearchError(null);
      return;
    }
    searchTimer.current = window.setTimeout(() => {
      if (!accessToken) return;
      searchRegistrations(accessToken, q)
        .then((data) => {
          if (seq !== searchSeq.current) return;
          setResults(data.results.slice(0, 6));
          setSearchError(null);
        })
        .catch((err) => {
          if (seq !== searchSeq.current) return;
          setResults(null);
          setSearchError(
            errorText(err, "Couldn't search the client registry. Check your connection."),
          );
        });
    }, 250);
  }

  function selectClient(row: RegistrationRow) {
    searchSeq.current++;
    window.clearTimeout(searchTimer.current);
    setSelected(row);
    setMode(row.identity_status);
    setForm(formFromRow(row));
    setSelectedLabel(true);
    setResults(null);
    setQuery("");
    setFeedback(null);
    setRequestId(newRequestId());
    window.setTimeout(() => reasonRef.current?.focus(), 0);
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!accessToken || submitting) return;
    const fullName = form.fullName.trim();
    const description = form.description.trim();
    if ((identified || resolving) && !fullName) {
      setNameError(resolving ? "Enter the client’s full name." : NAME_REQUIRED);
      nameRef.current?.focus();
      return;
    }
    if (!resolving && mode === "UNIDENTIFIED" && !description) {
      setDescriptionError(DESCRIPTION_REQUIRED);
      descriptionRef.current?.focus();
      return;
    }
    if (!formRef.current?.reportValidity()) return;
    setFeedback(null);
    setNameError(null);
    setDescriptionError(null);
    setSubmitting(true);
    try {
      if (resolving && resolveId) {
        await resolveIdentity(accessToken, resolveId, {
          full_name: fullName,
          date_of_birth: form.dob || undefined,
          sex: form.sex || undefined,
          phone: form.phone.trim() || undefined,
          id_document_type: form.idType || undefined,
          id_document_number: form.documentNumber.trim() || undefined,
          merge_into_patient_id: mergeTarget?.id,
        });
        navigate("/clinical/triage");
        return;
      }

      // Search-before-create is enforced, not just offered: an identifier that
      // already belongs to someone blocks registration, and a probable match
      // must be explicitly dismissed.
      if (!selected && identified && !confirmedNew) {
        const { matches } = await checkRegistrationDuplicates(accessToken, {
          full_name: fullName,
          date_of_birth: form.dob || undefined,
          sex: form.sex || undefined,
          phone: form.phone.trim() || undefined,
          id_document_type: form.idType || undefined,
          id_document_number: form.documentNumber.trim() || undefined,
          unhcr_number: form.unhcrNumber.trim() || undefined,
          sha_member_number: form.shaMemberNumber.trim() || undefined,
        });
        if (matches.length) {
          setDupMatches(matches);
          setSubmitting(false);
          return;
        }
      }
      const decided = Object.entries(consent).some(([, value]) => value !== "NOT_ASKED");
      const payload: RegistrationPayload = {
        client_request_id: requestId,
        patient_id: selected?.id,
        identity_status: mode,
        full_name: identified ? fullName : undefined,
        description: identified ? undefined : description || undefined,
        preferred_name: form.preferredName.trim() || undefined,
        pronouns: form.pronouns || undefined,
        date_of_birth: form.dob || undefined,
        estimated_age: form.estimatedAge ? Number(form.estimatedAge) : null,
        sex: form.sex || undefined,
        phone: form.phone.trim() || undefined,
        next_of_kin_name: form.nextOfKin.trim() || undefined,
        next_of_kin_phone: form.nokPhone.trim() || undefined,
        next_of_kin_relationship:
          vs.options("next-of-kin-relationship").find((o) => o.code === form.nokRelationship)
            ?.display || undefined,
        next_of_kin_is_guardian: form.nokGuardian || undefined,
        guardian_legal_status: form.nokGuardian ? form.guardianStatus.trim() || undefined : undefined,
        next_of_kin_may_be_informed: form.nokMayInform || undefined,
        address: form.address.trim() || undefined,
        id_document_type: form.idType || undefined,
        id_document_number: form.documentNumber.trim() || undefined,
        unhcr_number: form.unhcrNumber.trim() || undefined,
        sha_member_number: form.shaMemberNumber.trim() || undefined,
        hie_consent: decided ? consent : undefined,
        consent_text_version: decided ? CONSENT_TEXT_VERSION : undefined,
        consent_text_snapshot: decided ? CONSENT_TEXT : undefined,
        confirm_new_record: confirmedNew || undefined,
        referral_source: form.referral.trim() || undefined,
        preferred_language: form.language.trim() || undefined,
        interpreter: interpreter || undefined,
        allergy_status: allergyStatus || undefined,
        allergy_details: showAllergyDetails ? form.allergyDetails.trim() || undefined : undefined,
        payer: form.payer || undefined,
        reason: form.reason.trim() || undefined,
      };
      await registerArrival(accessToken, payload);
      setRequestId(newRequestId());
      navigate("/clinical/triage");
    } catch (err) {
      const duplicateOf = (err as { fields?: Record<string, unknown> })?.fields?.duplicate_of;
      if (resolving && Array.isArray(duplicateOf) && duplicateOf[0]) {
        setMergeTarget({ id: String(duplicateOf[0]), label: errorText(err, "") });
        setFeedback(
          `${errorText(err, "")} Submit again to merge this temporary record into the existing client.`,
        );
      } else {
        setFeedback(errorText(err, OFFLINE));
      }
    } finally {
      setSubmitting(false);
    }
  }

  function chooseExistingClient(match: DuplicateMatch) {
    setDupMatches(null);
    selectClient(match.client);
  }

  const submitText = resolving
    ? "Confirm identity"
    : selected && selectedLabel
      ? SELECTED_SUBMIT
      : modeInfo.submit;
  const tempName =
    resolveTarget?.name.trim() || (resolveTarget ? "Temporary client (unnamed)" : "");

  return (
    <div className="mx-auto max-w-[1360px]">
      <PageHeader eyebrow="Client registry" title="New arrival" />

      <Card bodyClassName="p-4">
        <div
          className="mb-3 inline-flex flex-wrap gap-0.5 rounded-lg border border-surface-border bg-surface-bg p-[3px]"
          role="group"
          aria-label="Registration type"
        >
          {MODES.map((m) => {
            const pressed = (resolving ? "IDENTIFIED" : mode) === m.status;
            return (
              <button
                key={m.status}
                type="button"
                aria-pressed={pressed}
                disabled={resolving && m.status !== "IDENTIFIED"}
                onClick={() => changeMode(m.status)}
                className={`rounded-md px-2.5 py-1.5 text-[11px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                  pressed ? "bg-surface-card text-ink-900 shadow-sm" : "text-ink-500"
                }`}
              >
                {m.label}
              </button>
            );
          })}
        </div>
        <p className="-mt-1.5 mb-3 text-xs text-ink-500">
          {resolving ? MODES[0].hint : modeInfo.hint}
        </p>
        {vs.error && <ErrorNote>{vs.error}</ErrorNote>}

        <form ref={formRef} noValidate onSubmit={onSubmit}>
          {resolving ? (
            <div className="mb-3">
              {resolveError ? (
                <ErrorNote>{resolveError}</ErrorNote>
              ) : (
                <Callout role="status">
                  <strong>
                    Resolve identity
                    {resolveTarget ? ` — ${tempName} · ${resolveTarget.citramac_number}` : ""}
                  </strong>{" "}
                  This confirms the identity of an existing temporary record. It keeps the same
                  CITRAMAC ID and record, and does not open a new triage encounter.
                </Callout>
              )}
            </div>
          ) : (
            <>
              <div className="mb-3 rounded-sm border border-surface-border bg-surface-bg p-2.5">
                <h3 className="text-xs font-bold text-ink-900">Find an existing client</h3>
                <p className="mt-1 text-xs text-ink-500">
                  Search by name, phone, national ID or CITRAMAC ID. Front Desk sees registration
                  details only — never clinical notes or medical records.
                </p>
                <div className="mt-[5px] flex min-w-0 flex-col gap-1">
                  <label htmlFor="client-search" className="text-[10.5px] font-medium text-ink-900">
                    Search client registry
                  </label>
                  <input
                    id="client-search"
                    type="search"
                    autoComplete="off"
                    placeholder="Name, phone, national ID or CITRAMAC ID"
                    className={REG_INPUT}
                    value={query}
                    onChange={(e) => onSearch(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") e.preventDefault();
                    }}
                  />
                </div>
                {searchError && (
                  <p role="alert" className="mt-1.5 text-xs text-priority-red">
                    {searchError}
                  </p>
                )}
                {results && (
                  <div
                    className="mt-1.5 overflow-hidden rounded-[7px] border border-surface-border bg-surface-card"
                    aria-live="polite"
                  >
                    {results.length ? (
                      results.map((row) => (
                        <button
                          key={row.id}
                          type="button"
                          onClick={() => selectClient(row)}
                          className="flex w-full items-center justify-between gap-2.5 border-b border-surface-border bg-surface-card px-2.5 py-[9px] text-left text-ink-900 last:border-b-0 hover:bg-surface-bg"
                        >
                          <span className="min-w-0">
                            <strong className="block text-[13px]">{row.name}</strong>
                            <span className="mt-1 block break-words text-xs text-ink-500">
                              {[
                                row.citramac_number,
                                row.phone || "Phone not recorded",
                                row.date_of_birth || "DOB not recorded",
                                row.identity_label,
                              ]
                                .filter(Boolean)
                                .join(" · ")}
                            </span>
                          </span>
                          <Tag>Load details</Tag>
                        </button>
                      ))
                    ) : (
                      <p className="p-2.5 text-xs text-ink-500">
                        No matching client found. Check the details or continue with a new
                        registration.
                      </p>
                    )}
                  </div>
                )}
              </div>

              {selected && (
                <Callout role="status" className="mb-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <strong>
                        {selected.name} · {selected.citramac_number}
                      </strong>{" "}
                      <span>
                        Saved registration details loaded. Sending to triage creates a new
                        encounter; it does not reopen an earlier one.
                      </span>
                    </div>
                    <button
                      type="button"
                      className={`${BTN_GHOST} ${BTN_SM}`}
                      onClick={clearSelection}
                    >
                      Clear selection
                    </button>
                  </div>
                </Callout>
              )}
            </>
          )}

          <div className="grid grid-cols-1 gap-x-3.5 gap-y-3 min-[561px]:grid-cols-2 min-[901px]:grid-cols-3">
            {(identified || resolving) && (
              <RegField
                id="reg-full-name"
                error={nameError}
                label={
                  <>
                    Full name <span className={REQUIRED_MARK}>REQUIRED</span>
                  </>
                }
              >
                <input
                  ref={nameRef}
                  id="reg-full-name"
                  type="text"
                  autoComplete="name"
                  required
                  className={REG_INPUT}
                  aria-invalid={nameError ? true : undefined}
                  value={form.fullName}
                  onChange={(e) => {
                    setNameError(null);
                    set("fullName")(e.target.value);
                  }}
                />
              </RegField>
            )}
            {!identified && !resolving && (
              <RegField
                id="reg-description"
                error={descriptionError}
                label={
                  <>
                    Observed description / temporary alias
                    {mode === "UNIDENTIFIED" && (
                      <>
                        {" "}
                        <span className={REQUIRED_MARK}>REQUIRED</span>
                      </>
                    )}
                  </>
                }
              >
                <input
                  ref={descriptionRef}
                  id="reg-description"
                  type="text"
                  required={mode === "UNIDENTIFIED"}
                  placeholder={
                    mode === "UNIDENTIFIED"
                      ? "Required: brief description or reported temporary alias"
                      : "Optional observations to help identify the person later"
                  }
                  className={REG_INPUT}
                  aria-invalid={descriptionError ? true : undefined}
                  value={form.description}
                  onChange={(e) => {
                    setDescriptionError(null);
                    set("description")(e.target.value);
                  }}
                />
              </RegField>
            )}
            {!resolving && (
              <>
                <RegField id="reg-preferred-name" label="Preferred name">
                  <input
                    id="reg-preferred-name"
                    type="text"
                    className={REG_INPUT}
                    value={form.preferredName}
                    onChange={(e) => set("preferredName")(e.target.value)}
                  />
                </RegField>
                <RegField id="reg-pronouns" label="Pronouns">
                  <SelectChoices
                    id="reg-pronouns"
                    options={vs.options("pronouns")}
                    placeholder="— select —"
                    value={form.pronouns}
                    onChange={set("pronouns")}
                  />
                </RegField>
              </>
            )}
            <RegField id="reg-dob" label="Date of birth">
              <input
                id="reg-dob"
                type="date"
                className={REG_INPUT}
                value={form.dob}
                onChange={(e) => set("dob")(e.target.value)}
              />
            </RegField>
            {!resolving && (
              <RegField id="reg-age" label="Or estimated age">
                <div className="flex items-center gap-2">
                  <input
                    id="reg-age"
                    type="number"
                    min={0}
                    max={125}
                    className={REG_INPUT}
                    value={form.estimatedAge}
                    onChange={(e) => set("estimatedAge")(e.target.value)}
                  />
                  <span className="text-xs text-ink-500">yrs</span>
                </div>
              </RegField>
            )}
            <RegField id="reg-sex" label="Sex">
              <SelectChoices
                id="reg-sex"
                options={vs.options("sex")}
                placeholder="— select —"
                value={form.sex}
                onChange={set("sex")}
              />
            </RegField>
            <RegField id="reg-phone" label="Mobile phone">
              <input
                id="reg-phone"
                type="tel"
                autoComplete="tel"
                className={REG_INPUT}
                value={form.phone}
                onChange={(e) => set("phone")(e.target.value)}
              />
            </RegField>
            {!resolving && (
              <>
                <RegField id="reg-nok" label="Next of kin / emergency contact — name">
                  <input
                    id="reg-nok"
                    type="text"
                    className={REG_INPUT}
                    value={form.nextOfKin}
                    onChange={(e) => set("nextOfKin")(e.target.value)}
                  />
                </RegField>
                <RegField id="reg-nok-phone" label="Next of kin — phone">
                  <input
                    id="reg-nok-phone"
                    type="tel"
                    className={REG_INPUT}
                    value={form.nokPhone}
                    onChange={(e) => set("nokPhone")(e.target.value)}
                  />
                </RegField>
                <RegField id="reg-nok-relationship" label="Next of kin — relationship">
                  <SelectChoices
                    id="reg-nok-relationship"
                    options={vs.options("next-of-kin-relationship")}
                    placeholder="— select —"
                    value={form.nokRelationship}
                    onChange={set("nokRelationship")}
                  />
                </RegField>
                <div className="flex min-w-0 flex-col justify-end gap-1.5 text-xs">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={form.nokGuardian}
                      onChange={(e) => setForm((p) => ({ ...p, nokGuardian: e.target.checked }))}
                    />
                    This person is the client’s legal guardian
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={form.nokMayInform}
                      onChange={(e) => setForm((p) => ({ ...p, nokMayInform: e.target.checked }))}
                    />
                    Client agrees this person may be told about their care
                  </label>
                </div>
                {form.nokGuardian && (
                  <RegField id="reg-guardian-status" label="Guardian legal status / authority">
                    <input
                      id="reg-guardian-status"
                      type="text"
                      className={REG_INPUT}
                      value={form.guardianStatus}
                      onChange={(e) => set("guardianStatus")(e.target.value)}
                    />
                  </RegField>
                )}
                <RegField id="reg-address" label="Address / location">
                  <input
                    id="reg-address"
                    type="text"
                    placeholder="No fixed abode is a valid answer"
                    className={REG_INPUT}
                    value={form.address}
                    onChange={(e) => set("address")(e.target.value)}
                  />
                </RegField>
              </>
            )}
            <RegField id="reg-id-type" label="ID / passport (where available)">
              <SelectChoices
                id="reg-id-type"
                options={vs.options("id-document-type")}
                placeholder="— select —"
                value={form.idType}
                onChange={set("idType")}
              />
            </RegField>
            <RegField id="reg-document-number" label="Document number">
              <input
                id="reg-document-number"
                type="text"
                className={REG_INPUT}
                value={form.documentNumber}
                onChange={(e) => set("documentNumber")(e.target.value)}
              />
            </RegField>
            {!resolving && (
              <>
                <RegField id="reg-unhcr" label="UNHCR number (refugees / asylum-seekers)">
                  <input
                    id="reg-unhcr"
                    type="text"
                    className={REG_INPUT}
                    value={form.unhcrNumber}
                    onChange={(e) => set("unhcrNumber")(e.target.value)}
                  />
                </RegField>
                <RegField id="reg-sha-member" label="SHA member number (if known)">
                  <input
                    id="reg-sha-member"
                    type="text"
                    className={REG_INPUT}
                    value={form.shaMemberNumber}
                    onChange={(e) => set("shaMemberNumber")(e.target.value)}
                  />
                </RegField>
                <RegField id="reg-referral" label="Referral source">
                  <input
                    id="reg-referral"
                    type="text"
                    placeholder="e.g. self, GP, family, police, court"
                    className={REG_INPUT}
                    value={form.referral}
                    onChange={(e) => set("referral")(e.target.value)}
                  />
                </RegField>
                <RegField id="reg-language" label="Preferred language">
                  <input
                    id="reg-language"
                    type="text"
                    className={REG_INPUT}
                    value={form.language}
                    onChange={(e) => set("language")(e.target.value)}
                  />
                </RegField>
                <RegField id="reg-interpreter" label="Interpreter">
                  <SelectChoices
                    id="reg-interpreter"
                    options={vs.options("interpreter")}
                    value={interpreter}
                    onChange={set("interpreter")}
                  />
                </RegField>
                <RegField
                  id="reg-allergy-status"
                  label="Allergies & reaction, if known (client report — confirmed clinically later)"
                >
                  <SelectChoices
                    id="reg-allergy-status"
                    options={vs.options("registration-allergy-status")}
                    value={allergyStatus}
                    onChange={set("allergyStatus")}
                  />
                </RegField>
                {showAllergyDetails && (
                  <RegField id="reg-allergy-details" label="Allergy & reaction details">
                    <input
                      id="reg-allergy-details"
                      type="text"
                      className={REG_INPUT}
                      value={form.allergyDetails}
                      onChange={(e) => set("allergyDetails")(e.target.value)}
                    />
                  </RegField>
                )}
                <RegField id="reg-payer" label="Payer / insurance (optional — never blocks care)">
                  <SelectChoices
                    id="reg-payer"
                    options={vs.options("payer")}
                    placeholder="— select —"
                    value={form.payer}
                    onChange={set("payer")}
                  />
                </RegField>
                <fieldset className="min-w-0 rounded-sm border border-surface-border bg-surface-bg p-2.5 min-[561px]:col-span-2 min-[901px]:col-span-3">
                  <legend className="px-1 text-[10.5px] font-semibold uppercase text-ink-500">
                    Privacy &amp; sharing — explain, then record the client’s choice
                  </legend>
                  <p className="mb-2 text-xs text-ink-500">{CONSENT_TEXT}</p>
                  <div className="grid gap-2 min-[701px]:grid-cols-2">
                    {CONSENT_FIELDS.map(({ key, label }) => (
                      <RegField key={key} id={`reg-consent-${key}`} label={label}>
                        <SelectChoices
                          id={`reg-consent-${key}`}
                          options={vs.options("hie-consent-decision")}
                          value={consent[key]}
                          onChange={(value) =>
                            setConsent((prev) => ({ ...prev, [key]: value as ConsentDecision }))
                          }
                        />
                      </RegField>
                    ))}
                  </div>
                  <p className="mt-1.5 text-[11px] text-ink-500">
                    Until the client explicitly says yes, nothing is sent to the HIE.
                  </p>
                </fieldset>
                <RegField
                  id="reg-reason"
                  label="Reason for attending (in the client’s words)"
                  className="min-[561px]:col-span-2 min-[901px]:col-span-3"
                >
                  <textarea
                    ref={reasonRef}
                    id="reg-reason"
                    rows={3}
                    className={`${REG_INPUT} resize-y`}
                    value={form.reason}
                    onChange={(e) => set("reason")(e.target.value)}
                  />
                </RegField>
              </>
            )}
          </div>

          {dupMatches && (
            <div role="alert" className="mt-3">
              <Callout>
                <div className="w-full">
                  <strong>
                    {dupMatches.some((m) => m.match === "exact")
                      ? "This person is already registered."
                      : "Possible existing client."}
                  </strong>
                  <ul className="mt-1.5 space-y-1">
                    {dupMatches.map((m) => (
                      <li key={m.client.id} className="flex flex-wrap items-center gap-2">
                        <span>
                          {m.client.name} · {m.client.citramac_number} — {m.reason}
                        </span>
                        <button
                          type="button"
                          className={BTN_SM}
                          onClick={() => chooseExistingClient(m)}
                        >
                          Use this record
                        </button>
                      </li>
                    ))}
                  </ul>
                  {!dupMatches.some((m) => m.match === "exact") && (
                    <button
                      type="button"
                      className={`${BTN_GHOST} mt-2`}
                      onClick={() => {
                        setConfirmedNew(true);
                        setDupMatches(null);
                      }}
                    >
                      This is a different person — continue
                    </button>
                  )}
                </div>
              </Callout>
            </div>
          )}
          <div role="alert" aria-live="polite" className={feedback ? "mt-3" : ""}>
            {feedback && <Callout>{feedback}</Callout>}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button type="button" className={BTN_GHOST} onClick={() => navigate("/clinical")}>
              Cancel
            </button>
            <button
              type="submit"
              className={`${BTN} !rounded-[20px]`}
              disabled={submitting || (resolving && !resolveTarget)}
            >
              {submitText}
            </button>
          </div>
          <p className="mt-2.5 flex items-center gap-1.5 text-xs text-ink-500">
            ⚠ Allergies recorded here are client-reported; a clinician confirms them at intake
            before any prescribing.
          </p>
        </form>
      </Card>
    </div>
  );
}
