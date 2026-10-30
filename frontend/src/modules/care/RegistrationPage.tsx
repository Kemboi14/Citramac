import { Search } from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type ReactNode,
} from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../../auth/useAuth";
import {
  checkRegistrationDuplicates,
  getClientBanner,
  getRegistration,
  registerArrival,
  resolveIdentity,
  searchRegistrations,
  updateRegistration,
  type ClientBanner,
  type ConsentDecision,
  type DuplicateMatch,
  type IdentityDetails,
  type IdentityStatus,
  type RegistrationPayload,
  type RegistrationRow,
  type ValueSetConcept,
} from "../../lib/carePathwayApi";
import { formatDateTime, newRequestId } from "./shared/format";
import { clientRecordPath } from "./shared/recordRoutes";
import { BTN, BTN_GHOST, BTN_SM, INPUT } from "./shared/styles";
import { Callout, Card, ErrorNote, PageHeader, SelectChoices, Tag } from "./shared/ui";
import { useValueSets } from "./shared/useValueSets";
import { REQUIRED_MARK, errorText } from "./triage/helpers";

// docs/15-CLINICAL-WORKSPACE-V3.md §1.4 — mockup frontdesk(), filterClients,
// selectExistingClientForRegistration, updateIdentityFields, registerTier1Client
// and beginIdentityResolution, with the client's v4 registration mockup (split
// name, social & personal details, emergency arrival). Every option list is a
// served value set; nothing is held in browser storage (CLAUDE.md §5).

// Each registration type has its own colour — the selected tab, the hint under
// it, focused fields and the submit button — so the type in use is recognisable
// at a glance (QA 2026-10-30; client mockup citramac-registration).
const MODE_TONE: Record<IdentityStatus, { solid: string; dot: string; accent: string }> = {
  IDENTIFIED: {
    solid: "bg-brand-green text-on-primary",
    dot: "bg-brand-green",
    accent: "var(--green)",
  },
  UNIDENTIFIED: {
    solid: "bg-priority-orange-solid text-on-status",
    dot: "bg-priority-orange-solid",
    accent: "var(--pri-orange-solid)",
  },
  UNKNOWN: {
    solid: "bg-priority-red-solid text-on-status",
    dot: "bg-priority-red-solid",
    accent: "var(--pri-red-solid)",
  },
};

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
  "Enter the client’s first and last name, or change Identity status to Unidentified or Unknown to register without one.";
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

const CONSENT_FIELDS: {
  key: keyof ConsentForm;
  title: string;
  label: string;
  sensitive?: boolean;
}[] = [
  {
    key: "general",
    title: "General health",
    label: "Share my general health information on the national HIE",
  },
  {
    key: "mental_health",
    title: "Mental health",
    label: "Share my mental-health information on the HIE",
    sensitive: true,
  },
  {
    key: "substance_use",
    title: "Substance use",
    label: "Share my substance-use information on the HIE",
    sensitive: true,
  },
  {
    key: "family",
    title: "Family / next of kin",
    label: "Family / next of kin may be told about my care",
  },
];

/** What each recorded decision means, as the status pill and selected segment show it. */
const CONSENT_STATUS: Record<
  string,
  { label: string; family: string; tone: string; solid: string }
> = {
  NOT_ASKED: {
    label: "Not asked",
    family: "Not asked",
    tone: "bg-surface-bg text-ink-500",
    solid: "",
  },
  YES: {
    label: "Shared",
    family: "May be told",
    tone: "bg-brand-green-tint text-brand-green",
    solid: "bg-brand-green text-on-primary",
  },
  RESTRICTED: {
    label: "This facility only",
    family: "This facility only",
    tone: "bg-status-amber-tint text-status-amber",
    solid: "bg-status-amber text-on-status",
  },
  NO: {
    label: "Not shared",
    family: "Not to be told",
    tone: "bg-status-red-tint text-status-red",
    solid: "bg-status-red text-on-status",
  },
};

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
  firstName: string;
  lastName: string;
  /** Kept from a loaded record so a returning client's middle names survive. */
  middleNames: string;
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
  disability: string;
  disabilityDetails: string;
  employment: string;
  occupation: string;
  marital: string;
  allergyStatus: string;
  allergyDetails: string;
  payer: string;
  // Emergency — identity unknown
  apparentSex: string;
  foundLocation: string;
  arrivalReferralInfo: string;
  identificationNotes: string;
  broughtByName: string;
  broughtByRelationship: string;
  broughtByPhone: string;
  broughtById: string;
  broughtByAddress: string;
}

const EMPTY_FORM: RegForm = {
  firstName: "",
  lastName: "",
  middleNames: "",
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
  disability: "",
  disabilityDetails: "",
  employment: "",
  occupation: "",
  marital: "",
  allergyStatus: "",
  allergyDetails: "",
  payer: "",
  apparentSex: "",
  foundLocation: "",
  arrivalReferralInfo: "",
  identificationNotes: "",
  broughtByName: "",
  broughtByRelationship: "",
  broughtByPhone: "",
  broughtById: "",
  broughtByAddress: "",
};

const pad = (n: number) => String(n).padStart(2, "0");

function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Whole years from a yyyy-mm-dd date of birth, or "" if it isn't one. */
function ageFromDob(dob: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dob);
  if (!match) return "";
  const [, y, m, d] = match.map(Number);
  const now = new Date();
  let years = now.getFullYear() - y;
  if (now.getMonth() + 1 < m || (now.getMonth() + 1 === m && now.getDate() < d)) years -= 1;
  return years >= 0 ? String(years) : "";
}

/** A stored display (contact relationships are kept as text) back to its code. */
function codeForDisplay(options: ValueSetConcept[], display: string) {
  return options.find((o) => o.display === display)?.code ?? "";
}

function formFromRow(row: RegistrationRow, nokRelationships: ValueSetConcept[]): RegForm {
  const identified = row.identity_status === "IDENTIFIED";
  return {
    ...EMPTY_FORM,
    firstName: identified ? row.first_name : "",
    lastName: identified ? row.last_name : "",
    middleNames: identified ? row.middle_other_names || "" : "",
    description: row.identity_description || "",
    preferredName: row.preferred_name || "",
    pronouns: row.pronouns || "",
    dob: row.date_of_birth || "",
    estimatedAge:
      row.age !== null
        ? String(row.age)
        : row.estimated_age !== null
          ? String(row.estimated_age)
          : "",
    sex: row.sex || "",
    phone: row.phone || "",
    nextOfKin: row.next_of_kin || "",
    nokPhone: row.next_of_kin_phone || "",
    nokRelationship: codeForDisplay(nokRelationships, row.next_of_kin_relationship || ""),
    address: row.address || "",
    idType: row.id_document_type || "",
    documentNumber: row.id_document_number || "",
    unhcrNumber: row.identifiers?.find((i) => i.kind === "UNHCR" && !i.superseded)?.value || "",
    shaMemberNumber:
      row.identifiers?.find((i) => i.kind === "SHA_MEMBER" && !i.superseded)?.value || "",
    referral: row.referral_source || "",
    disability: row.living_with_disability || "",
    disabilityDetails: row.disability_details || "",
    employment: row.employment_status || "",
    occupation: row.occupation || "",
    marital: row.marital_status || "",
    allergyStatus: row.allergy_status || "",
    allergyDetails: row.allergy_status === "ACTIVE_ALLERGIES" ? row.allergy_details || "" : "",
    payer: row.payer || "",
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
      <label htmlFor={id} className="text-[13px] font-semibold text-ink-900">
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

/** A titled group of fields on the registration grid. */
function RegSection({
  title,
  intro,
  children,
}: {
  title: string;
  intro?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="mt-6 border-t border-surface-border pt-6 first:mt-0 first:border-t-0 first:pt-0">
      <h3 className="mb-4 text-base font-semibold text-ink-900">{title}</h3>
      {intro}
      <div className="grid grid-cols-1 gap-x-[18px] gap-y-4 min-[561px]:grid-cols-2 min-[901px]:grid-cols-3">
        {children}
      </div>
    </section>
  );
}

// Focus follows the registration type's colour (--reg-accent on the card).
const REG_INPUT = `${INPUT} !h-[42px] !rounded-[10px] !bg-surface-card !px-3 !py-0 !text-[14px] focus:!border-[var(--reg-accent)] focus:shadow-[0_0_0_3px_color-mix(in_srgb,var(--reg-accent)_18%,transparent)]`;
const REG_SELECT = `${REG_INPUT} !pr-8`;
const FULL_ROW = "min-[561px]:col-span-2 min-[901px]:col-span-3";

export function RegistrationPage() {
  const { accessToken } = useAuth();
  const navigate = useNavigate();
  const vs = useValueSets();
  const [searchParams] = useSearchParams();
  const resolveId = searchParams.get("resolve");
  // `?edit=<patient>` corrects a client's saved details without opening a
  // triage encounter (the Edit client details action on the record).
  const editId = resolveId ? null : searchParams.get("edit");

  const [mode, setMode] = useState<IdentityStatus>("IDENTIFIED");
  const [form, setForm] = useState<RegForm>(EMPTY_FORM);
  const [selected, setSelected] = useState<RegistrationRow | null>(null);
  const [selectedLabel, setSelectedLabel] = useState(false);
  // One id per form instance: a retry after a network failure reuses it so the
  // server dedupes; a new one is issued after success, Clear or a new selection.
  const [requestId, setRequestId] = useState(() => newRequestId());
  const [feedback, setFeedback] = useState<string | null>(null);
  const [firstNameError, setFirstNameError] = useState<string | null>(null);
  const [lastNameError, setLastNameError] = useState<string | null>(null);
  const [descriptionError, setDescriptionError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  // Shown, not sent: the server stamps the arrival time when the record is saved.
  const [openedAt] = useState(() => new Date().toISOString());

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
  const [resolveRow, setResolveRow] = useState<RegistrationRow | null>(null);
  const [resolveError, setResolveError] = useState<string | null>(null);

  const firstNameRef = useRef<HTMLInputElement>(null);
  const lastNameRef = useRef<HTMLInputElement>(null);
  const descriptionRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const resolving = Boolean(resolveId);
  const editing = Boolean(editId);
  const modeInfo = MODES.find((m) => m.status === mode) ?? MODES[0];
  const tone = MODE_TONE[resolving ? "IDENTIFIED" : mode];
  const identified = mode === "IDENTIFIED";
  const emergency = mode === "UNKNOWN" && !resolving;
  // A returning client whose stored name is one word can still be registered.
  const lastNameOptional =
    !resolving && Boolean(selected?.first_name) && !selected?.last_name && identified;

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
        setResolveError(null);
        setResolveTarget(banner);
        setResolveRow(row ?? null);
        setForm({
          ...(row ? formFromRow(row, vs.options("next-of-kin-relationship")) : EMPTY_FORM),
          firstName: "",
          lastName: "",
          middleNames: "",
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
    // The relationship list only maps a code here; reloading on it would wipe edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken, resolveId]);

  useEffect(() => {
    if (resolveTarget) firstNameRef.current?.focus();
  }, [resolveTarget]);

  useEffect(() => {
    if (!accessToken || !editId) return;
    let cancelled = false;
    getRegistration(accessToken, editId)
      .then((row) => {
        if (cancelled) return;
        if (row.is_temporary) {
          setEditError(
            "This is a temporary record. Confirm the client’s identity first — then the details can be edited.",
          );
          return;
        }
        setEditError(null);
        setSelected(row);
        setMode(row.identity_status);
        setForm(formFromRow(row, vs.options("next-of-kin-relationship")));
        window.setTimeout(() => firstNameRef.current?.focus(), 0);
      })
      .catch((err) => {
        if (!cancelled) setEditError(errorText(err, "Couldn't load this client's details."));
      });
    return () => {
      cancelled = true;
    };
    // The relationship list only maps a code here; reloading on it would wipe edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken, editId]);

  useEffect(() => () => window.clearTimeout(searchTimer.current), []);

  const set = (key: keyof RegForm) => (value: string) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const firstCode = (id: string) => vs.options(id)[0]?.code ?? "";
  const allergyValueSet = emergency ? "emergency-allergy-status" : "registration-allergy-status";
  const allergyStatus = form.allergyStatus || firstCode(allergyValueSet);
  const showAllergyDetails = allergyStatus === "ACTIVE_ALLERGIES";
  const showDisabilityDetails = form.disability === "YES";
  const display = (valueSet: string, code: string) =>
    vs.options(valueSet).find((o) => o.code === code)?.display || undefined;

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
    setFirstNameError(null);
    setLastNameError(null);
    setDescriptionError(null);
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

  function closeSearch() {
    searchSeq.current++;
    window.clearTimeout(searchTimer.current);
    setResults(null);
    setQuery("");
    setFeedback(null);
  }

  function selectClient(row: RegistrationRow) {
    closeSearch();
    setSelected(row);
    setMode(row.identity_status);
    setForm(formFromRow(row, vs.options("next-of-kin-relationship")));
    setSelectedLabel(true);
    setRequestId(newRequestId());
  }

  /** A temporary record found by search: confirm its identity in place. */
  function beginResolution(row: RegistrationRow) {
    closeSearch();
    clearSelection();
    setMergeTarget(null);
    setResolveTarget(null);
    setResolveRow(null);
    navigate(`/clinical/registration?resolve=${encodeURIComponent(row.id)}`);
  }

  function onDobChange(value: string) {
    // The age follows the date of birth; with no date it is an editable estimate.
    setForm((prev) => ({ ...prev, dob: value, estimatedAge: value ? ageFromDob(value) : "" }));
  }

  function identityDetails(): IdentityDetails {
    return {
      first_name: form.firstName.trim() || undefined,
      last_name: form.lastName.trim() || undefined,
      preferred_name: form.preferredName.trim() || undefined,
      pronouns: form.pronouns || undefined,
      date_of_birth: form.dob || undefined,
      estimated_age: !form.dob && form.estimatedAge ? Number(form.estimatedAge) : null,
      sex: form.sex || undefined,
      phone: form.phone.trim() || undefined,
      address: form.address.trim() || undefined,
      id_document_type: form.idType || undefined,
      id_document_number: form.documentNumber.trim() || undefined,
      unhcr_number: form.unhcrNumber.trim() || undefined,
      sha_member_number: form.shaMemberNumber.trim() || undefined,
      living_with_disability: form.disability || undefined,
      disability_details: showDisabilityDetails
        ? form.disabilityDetails.trim() || undefined
        : undefined,
      employment_status: form.employment || undefined,
      occupation: form.occupation.trim() || undefined,
      marital_status: form.marital || undefined,
    };
  }

  function validateNames() {
    const first = form.firstName.trim();
    const last = form.lastName.trim();
    const firstMissing = !first ? (last ? "Enter the client’s first name." : NAME_REQUIRED) : null;
    const lastMissing = !last && !lastNameOptional ? "Enter the client’s last name." : null;
    setFirstNameError(firstMissing);
    setLastNameError(lastMissing);
    if (firstMissing) firstNameRef.current?.focus();
    else if (lastMissing) lastNameRef.current?.focus();
    return !firstMissing && !lastMissing;
  }

  /** Every editable detail, blanks included: on an edit a blank clears the
   * field, so the saved record matches what the form shows. */
  function editPayload() {
    const decided = Object.entries(consent).some(([, value]) => value !== "NOT_ASKED");
    return {
      first_name: form.firstName.trim(),
      last_name: form.lastName.trim(),
      middle_other_names: form.middleNames.trim(),
      preferred_name: form.preferredName.trim(),
      pronouns: form.pronouns,
      date_of_birth: form.dob,
      estimated_age: !form.dob && form.estimatedAge ? Number(form.estimatedAge) : null,
      sex: form.sex,
      phone: form.phone.trim(),
      address: form.address.trim(),
      id_document_type: form.idType,
      id_document_number: form.documentNumber.trim(),
      unhcr_number: form.unhcrNumber.trim() || undefined,
      sha_member_number: form.shaMemberNumber.trim() || undefined,
      living_with_disability: form.disability,
      disability_details: showDisabilityDetails ? form.disabilityDetails.trim() : "",
      employment_status: form.employment,
      occupation: form.occupation.trim(),
      marital_status: form.marital,
      next_of_kin_name: form.nextOfKin.trim() || undefined,
      next_of_kin_phone: form.nokPhone.trim() || undefined,
      next_of_kin_relationship: display("next-of-kin-relationship", form.nokRelationship),
      next_of_kin_is_guardian: form.nokGuardian || undefined,
      guardian_legal_status: form.nokGuardian ? form.guardianStatus.trim() || undefined : undefined,
      next_of_kin_may_be_informed: form.nokMayInform || undefined,
      hie_consent: decided ? consent : undefined,
      consent_text_version: decided ? CONSENT_TEXT_VERSION : undefined,
      consent_text_snapshot: decided ? CONSENT_TEXT : undefined,
      referral_source: form.referral.trim(),
      payer: form.payer,
      allergy_status: allergyStatus || undefined,
      allergy_details: showAllergyDetails ? form.allergyDetails.trim() || undefined : undefined,
    };
  }

  /** Save corrected details only — no triage encounter. */
  async function saveDetails() {
    if (!accessToken || submitting || !selected) return;
    if (!validateNames()) return;
    if (!formRef.current?.reportValidity()) return;
    setFeedback(null);
    setSaved(null);
    setSubmitting(true);
    try {
      const row = await updateRegistration(accessToken, selected.id, editPayload());
      if (editing) {
        navigate(clientRecordPath(row.id, "snapshot"));
        return;
      }
      setSelected(row);
      setForm(formFromRow(row, vs.options("next-of-kin-relationship")));
      setConsent(EMPTY_CONSENT);
      setSaved(`Details saved for ${row.name}. No triage encounter was opened.`);
    } catch (err) {
      setFeedback(errorText(err, OFFLINE));
    } finally {
      setSubmitting(false);
    }
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (editing) {
      void saveDetails();
      return;
    }
    if (!accessToken || submitting) return;
    const description = form.description.trim();
    if ((identified || resolving) && !validateNames()) return;
    if (!resolving && mode === "UNIDENTIFIED" && !description) {
      setDescriptionError(DESCRIPTION_REQUIRED);
      descriptionRef.current?.focus();
      return;
    }
    if (!formRef.current?.reportValidity()) return;
    setFeedback(null);
    setFirstNameError(null);
    setLastNameError(null);
    setDescriptionError(null);
    setSubmitting(true);
    try {
      if (resolving && resolveId) {
        // Spec 3.2: identifying a temporary record must not leave the person
        // with two records — a probable existing client is offered for merging.
        if (!mergeTarget && !confirmedNew) {
          const { matches } = await checkRegistrationDuplicates(accessToken, {
            first_name: form.firstName.trim(),
            last_name: form.lastName.trim(),
            date_of_birth: form.dob || undefined,
            sex: form.sex || undefined,
            phone: form.phone.trim() || undefined,
            exclude_patient_id: resolveId,
          });
          if (matches.length) {
            setDupMatches(matches);
            setSubmitting(false);
            return;
          }
        }
        await resolveIdentity(accessToken, resolveId, {
          ...identityDetails(),
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
          first_name: form.firstName.trim(),
          last_name: form.lastName.trim(),
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
      const common = {
        client_request_id: requestId,
        patient_id: selected?.id,
        identity_status: mode,
        allergy_status: allergyStatus || undefined,
        allergy_details: showAllergyDetails ? form.allergyDetails.trim() || undefined : undefined,
      };
      const payload: RegistrationPayload = emergency
        ? {
            ...common,
            description: description || undefined,
            estimated_age: form.estimatedAge ? Number(form.estimatedAge) : null,
            apparent_sex: form.apparentSex || undefined,
            found_location: form.foundLocation.trim() || undefined,
            arrival_referral_info: form.arrivalReferralInfo.trim() || undefined,
            identification_notes: form.identificationNotes.trim() || undefined,
            brought_by_name: form.broughtByName.trim() || undefined,
            brought_by_relationship: display("brought-by-relationship", form.broughtByRelationship),
            brought_by_phone: form.broughtByPhone.trim() || undefined,
            brought_by_id_number: form.broughtById.trim() || undefined,
            brought_by_address: form.broughtByAddress.trim() || undefined,
          }
        : {
            ...common,
            ...identityDetails(),
            first_name: identified ? form.firstName.trim() : undefined,
            last_name: identified ? form.lastName.trim() : undefined,
            middle_other_names: identified && selected ? form.middleNames : undefined,
            description: identified ? undefined : description || undefined,
            next_of_kin_name: form.nextOfKin.trim() || undefined,
            next_of_kin_phone: form.nokPhone.trim() || undefined,
            next_of_kin_relationship: display("next-of-kin-relationship", form.nokRelationship),
            next_of_kin_is_guardian: form.nokGuardian || undefined,
            guardian_legal_status: form.nokGuardian
              ? form.guardianStatus.trim() || undefined
              : undefined,
            next_of_kin_may_be_informed: form.nokMayInform || undefined,
            hie_consent: decided ? consent : undefined,
            consent_text_version: decided ? CONSENT_TEXT_VERSION : undefined,
            consent_text_snapshot: decided ? CONSENT_TEXT : undefined,
            confirm_new_record: confirmedNew || undefined,
            referral_source: form.referral.trim() || undefined,
            payer: form.payer || undefined,
          };
      const { triage_encounter_id, open_triage } = await registerArrival(accessToken, payload);
      setRequestId(newRequestId());
      // Opening an encounter starts triage under the viewer, so only clinical
      // staff land on it; front desk goes back to the worklist.
      navigate(
        triage_encounter_id && open_triage
          ? `/clinical/triage/${encodeURIComponent(triage_encounter_id)}`
          : "/clinical/triage",
      );
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
    if (resolving) {
      // Merge the temporary record into this client on submit.
      const label = `${match.client.name} · ${match.client.citramac_number}`;
      setMergeTarget({ id: match.client.id, label });
      setFeedback(
        `Submit to merge this temporary record into ${label}. Its encounters and notes move to that client, and the emergency number stays linked to them.`,
      );
      return;
    }
    selectClient(match.client);
  }

  const submitText = editing
    ? "Save changes"
    : resolving
      ? mergeTarget
        ? "Merge into existing client"
        : "Confirm identity"
      : selected && selectedLabel
        ? SELECTED_SUBMIT
        : modeInfo.submit;
  const tempName =
    resolveTarget?.name.trim() || (resolveTarget ? "Temporary client (unnamed)" : "");
  const arrival = resolveRow?.emergency_arrival;
  const arrivalFacts = arrival
    ? [
        arrival.found_location && `Found / brought from: ${arrival.found_location}`,
        arrival.brought_by &&
          `Brought by: ${[
            arrival.brought_by.name,
            arrival.brought_by.relationship,
            arrival.brought_by.phone,
          ]
            .filter(Boolean)
            .join(" · ")}`,
        arrival.arrival_referral_info &&
          `Police / ambulance / referral: ${arrival.arrival_referral_info}`,
        arrival.identification_notes && `Identification notes: ${arrival.identification_notes}`,
      ].filter((fact): fact is string => Boolean(fact))
    : [];

  const textInput = (
    id: string,
    key: keyof RegForm,
    attrs: { type?: string; placeholder?: string; autoComplete?: string } = {},
  ) => (
    <input
      id={id}
      type={attrs.type ?? "text"}
      autoComplete={attrs.autoComplete}
      placeholder={attrs.placeholder}
      className={REG_INPUT}
      value={form[key] as string}
      onChange={(e) => set(key)(e.target.value)}
    />
  );

  const ageField = (
    <RegField
      id="reg-age"
      label="Age (years) — Calculated from date of birth, or enter an estimate"
    >
      <input
        id="reg-age"
        type="number"
        min={0}
        max={125}
        readOnly={Boolean(form.dob) && !emergency}
        className={`${REG_INPUT} read-only:!bg-surface-bg`}
        value={form.estimatedAge}
        onChange={(e) => set("estimatedAge")(e.target.value)}
      />
    </RegField>
  );

  return (
    <div
      className="mx-auto max-w-[1360px]"
      style={{ "--reg-accent": tone.accent } as CSSProperties}
    >
      <PageHeader
        eyebrow="Client registry"
        title={editing ? "Edit client details" : "New arrival"}
      />

      <Card className="!rounded-2xl" bodyClassName="p-5 min-[721px]:p-7">
        <div
          className="mb-4 inline-flex flex-wrap gap-1 rounded-xl border border-surface-border bg-surface-bg p-1"
          role="group"
          aria-label="Registration type"
        >
          {MODES.map((m) => {
            const pressed = (resolving ? "IDENTIFIED" : mode) === m.status;
            const locked = editing ? m.status !== mode : resolving && m.status !== "IDENTIFIED";
            return (
              <button
                key={m.status}
                type="button"
                aria-pressed={pressed}
                disabled={locked}
                onClick={() => changeMode(m.status)}
                className={`rounded-[9px] px-[18px] py-[9px] text-[14px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                  pressed
                    ? `${MODE_TONE[m.status].solid} shadow-[0_2px_6px_rgba(0,0,0,0.18)]`
                    : "text-ink-900 hover:bg-surface-card"
                }`}
              >
                {m.label}
              </button>
            );
          })}
        </div>
        {!editing && (
          <p className="mb-5 flex items-start gap-2 text-[13px] text-ink-700">
            <span
              aria-hidden="true"
              className={`mt-[6px] h-2 w-2 flex-none rounded-full ${tone.dot}`}
            />
            <span>{resolving ? MODES[0].hint : modeInfo.hint}</span>
          </p>
        )}
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
                  {arrivalFacts.length > 0 && (
                    <ul className="mt-1.5 list-disc space-y-0.5 pl-4 text-xs text-ink-500">
                      {arrivalFacts.map((fact) => (
                        <li key={fact}>{fact}</li>
                      ))}
                    </ul>
                  )}
                </Callout>
              )}
            </div>
          ) : editing ? (
            <div className="mb-3">
              {editError ? (
                <ErrorNote>{editError}</ErrorNote>
              ) : selected ? (
                <Callout role="status">
                  <strong>
                    Editing {selected.name} · {selected.citramac_number}
                  </strong>{" "}
                  Saving updates this client’s registration details only. It does not open a triage
                  encounter, and earlier records keep the details they were made with.
                </Callout>
              ) : (
                <p className="text-[13px] text-ink-500">Loading the client’s details…</p>
              )}
            </div>
          ) : (
            <>
              {!emergency && (
                <div className="mb-6">
                  <h3 className="text-base font-semibold text-ink-900">Find an existing client</h3>
                  <p className="mt-1 text-[13px] text-ink-500">
                    Search by name (first and last, any order), phone in any format (07…, +254…),
                    national ID or CITRAMAC ID. Front Desk sees registration details only — never
                    clinical notes or medical records.
                  </p>
                  <div className="relative mt-3 min-w-0">
                    <label htmlFor="client-search" className="sr-only">
                      Search client registry
                    </label>
                    <Search
                      aria-hidden
                      className="pointer-events-none absolute left-3.5 top-3 h-[18px] w-[18px] text-ink-500"
                    />
                    <input
                      id="client-search"
                      type="search"
                      autoComplete="off"
                      placeholder="Name, phone, national ID or CITRAMAC ID"
                      className={`${REG_INPUT} !h-[46px] !bg-surface-bg !pl-11`}
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
                            onClick={() =>
                              row.is_temporary ? beginResolution(row) : selectClient(row)
                            }
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
                            <Tag>{row.is_temporary ? "Resolve identity" : "Load details"}</Tag>
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
              )}

              {selected && (
                <Callout role="status" className="mb-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <strong>
                        {selected.name} · {selected.citramac_number}
                      </strong>{" "}
                      <span>
                        Saved registration details loaded. Correct them and use “Save details only”,
                        or send to triage — that creates a new encounter; it does not reopen an
                        earlier one.
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

          {emergency ? (
            <RegSection
              title="Emergency — identity unknown"
              intro={
                <div className="mb-2 space-y-1 text-xs text-ink-500">
                  <p>
                    Use when distress, altered consciousness, confusion, intoxication, psychosis,
                    injury or another emergency prevents normal registration. Record what is
                    available; never delay urgent care.
                  </p>
                  <p>
                    A temporary client ID is assigned automatically. When identity becomes known,
                    update this record so all encounters remain connected.
                  </p>
                </div>
              }
            >
              {ageField}
              <RegField id="reg-apparent-sex" label="Apparent sex">
                <SelectChoices
                  className={REG_SELECT}
                  id="reg-apparent-sex"
                  options={vs.options("apparent-sex")}
                  placeholder="— select —"
                  value={form.apparentSex}
                  onChange={set("apparentSex")}
                />
              </RegField>
              <RegField id="reg-arrival-at" label="Arrival / contact date & time">
                <input
                  id="reg-arrival-at"
                  type="text"
                  readOnly
                  className={`${REG_INPUT} !bg-surface-bg`}
                  value={formatDateTime(openedAt)}
                  aria-describedby="reg-arrival-at-note"
                />
                <span id="reg-arrival-at-note" className="text-[11px] text-ink-500">
                  Recorded automatically when the record is saved.
                </span>
              </RegField>
              <RegField
                id="reg-description"
                label="Physical description & clothing"
                className={FULL_ROW}
              >
                <textarea
                  id="reg-description"
                  rows={2}
                  maxLength={255}
                  placeholder="Approximate build, hair, distinguishing marks, clothing"
                  className={`${REG_INPUT} resize-y`}
                  value={form.description}
                  onChange={(e) => set("description")(e.target.value)}
                />
              </RegField>
              <RegField
                id="reg-found-location"
                label="Where the person was found or brought from"
                className="min-[901px]:col-span-2"
              >
                {textInput("reg-found-location", "foundLocation")}
              </RegField>
              <RegField id="reg-brought-by-name" label="Person who brought / referred them — name">
                {textInput("reg-brought-by-name", "broughtByName")}
              </RegField>
              <RegField id="reg-brought-by-relationship" label="Relationship to client">
                <SelectChoices
                  className={REG_SELECT}
                  id="reg-brought-by-relationship"
                  options={vs.options("brought-by-relationship")}
                  placeholder="— select —"
                  value={form.broughtByRelationship}
                  onChange={set("broughtByRelationship")}
                />
              </RegField>
              <RegField id="reg-brought-by-phone" label="Contact phone">
                {textInput("reg-brought-by-phone", "broughtByPhone", { type: "tel" })}
              </RegField>
              <RegField id="reg-brought-by-id" label="Identifier / ID of that person">
                {textInput("reg-brought-by-id", "broughtById")}
              </RegField>
              <RegField
                id="reg-brought-by-address"
                label="Address of that person"
                className="min-[901px]:col-span-2"
              >
                {textInput("reg-brought-by-address", "broughtByAddress")}
              </RegField>
              <RegField
                id="reg-arrival-referral"
                label="Police / ambulance / referral information"
                className={FULL_ROW}
              >
                <textarea
                  id="reg-arrival-referral"
                  rows={2}
                  placeholder="e.g. OB number, ambulance crew, referring facility"
                  className={`${REG_INPUT} resize-y`}
                  value={form.arrivalReferralInfo}
                  onChange={(e) => set("arrivalReferralInfo")(e.target.value)}
                />
              </RegField>
              <RegField
                id="reg-identification-notes"
                label="How can this person currently be identified?"
                className={FULL_ROW}
              >
                <textarea
                  id="reg-identification-notes"
                  rows={2}
                  placeholder="Names they respond to, belongings, documents found, who might know them"
                  className={`${REG_INPUT} resize-y`}
                  value={form.identificationNotes}
                  onChange={(e) => set("identificationNotes")(e.target.value)}
                />
              </RegField>
              <RegField id="reg-allergy-status" label="Allergy status">
                <SelectChoices
                  className={REG_SELECT}
                  id="reg-allergy-status"
                  options={vs.options("emergency-allergy-status")}
                  value={allergyStatus}
                  onChange={set("allergyStatus")}
                />
              </RegField>
              {showAllergyDetails && (
                <RegField
                  id="reg-allergy-details"
                  label="Known allergy details / reaction"
                  className="min-[901px]:col-span-2"
                >
                  {textInput("reg-allergy-details", "allergyDetails")}
                </RegField>
              )}
            </RegSection>
          ) : (
            <>
              <RegSection title="Identity">
                {(identified || resolving) && (
                  <>
                    <RegField
                      id="reg-first-name"
                      error={firstNameError}
                      label={
                        <>
                          First name <span className={REQUIRED_MARK}>REQUIRED</span>
                        </>
                      }
                    >
                      <input
                        ref={firstNameRef}
                        id="reg-first-name"
                        type="text"
                        autoComplete="given-name"
                        required
                        className={REG_INPUT}
                        aria-invalid={firstNameError ? true : undefined}
                        value={form.firstName}
                        onChange={(e) => {
                          setFirstNameError(null);
                          set("firstName")(e.target.value);
                        }}
                      />
                    </RegField>
                    <RegField
                      id="reg-last-name"
                      error={lastNameError}
                      label={
                        <>
                          Last name
                          {!lastNameOptional && (
                            <>
                              {" "}
                              <span className={REQUIRED_MARK}>REQUIRED</span>
                            </>
                          )}
                        </>
                      }
                    >
                      <input
                        ref={lastNameRef}
                        id="reg-last-name"
                        type="text"
                        autoComplete="family-name"
                        required={!lastNameOptional}
                        className={REG_INPUT}
                        aria-invalid={lastNameError ? true : undefined}
                        value={form.lastName}
                        onChange={(e) => {
                          setLastNameError(null);
                          set("lastName")(e.target.value);
                        }}
                      />
                    </RegField>
                  </>
                )}
                {!identified && !resolving && (
                  <RegField
                    id="reg-description"
                    error={descriptionError}
                    label={
                      <>
                        Observed description / temporary alias{" "}
                        <span className={REQUIRED_MARK}>REQUIRED</span>
                      </>
                    }
                  >
                    <input
                      ref={descriptionRef}
                      id="reg-description"
                      type="text"
                      required
                      maxLength={255}
                      placeholder="Required: brief description or reported temporary alias"
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
                <RegField id="reg-preferred-name" label="Preferred name">
                  {textInput("reg-preferred-name", "preferredName")}
                </RegField>
                <RegField id="reg-pronouns" label="Pronouns">
                  <SelectChoices
                    className={REG_SELECT}
                    id="reg-pronouns"
                    options={vs.options("pronouns")}
                    placeholder="— select —"
                    value={form.pronouns}
                    onChange={set("pronouns")}
                  />
                </RegField>
                <RegField id="reg-dob" label="Date of birth">
                  <input
                    id="reg-dob"
                    type="date"
                    max={todayIso()}
                    className={REG_INPUT}
                    value={form.dob}
                    onChange={(e) => onDobChange(e.target.value)}
                  />
                </RegField>
                {ageField}
                <RegField id="reg-sex" label="Sex">
                  <SelectChoices
                    className={REG_SELECT}
                    id="reg-sex"
                    options={vs.options("sex")}
                    placeholder="— select —"
                    value={form.sex}
                    onChange={set("sex")}
                  />
                </RegField>
                <RegField id="reg-phone" label="Mobile phone">
                  {textInput("reg-phone", "phone", { type: "tel", autoComplete: "tel" })}
                </RegField>
                <RegField id="reg-id-type" label="ID / passport (where available)">
                  <SelectChoices
                    className={REG_SELECT}
                    id="reg-id-type"
                    options={vs.options("id-document-type")}
                    placeholder="— select —"
                    value={form.idType}
                    onChange={set("idType")}
                  />
                </RegField>
                <RegField id="reg-document-number" label="Document number">
                  {textInput("reg-document-number", "documentNumber")}
                </RegField>
                <RegField id="reg-unhcr" label="UNHCR number (refugees / asylum-seekers)">
                  {textInput("reg-unhcr", "unhcrNumber")}
                </RegField>
                <RegField id="reg-sha-member" label="SHA member number (if known)">
                  {textInput("reg-sha-member", "shaMemberNumber")}
                </RegField>
                <RegField id="reg-address" label="Address / location">
                  {textInput("reg-address", "address", {
                    placeholder: "No fixed abode is a valid answer",
                  })}
                </RegField>
              </RegSection>

              {!resolving && (
                <RegSection title="Next of kin / emergency contact">
                  <RegField id="reg-nok" label="Next of kin / emergency contact — name">
                    {textInput("reg-nok", "nextOfKin")}
                  </RegField>
                  <RegField id="reg-nok-phone" label="Next of kin — phone">
                    {textInput("reg-nok-phone", "nokPhone", { type: "tel" })}
                  </RegField>
                  <RegField id="reg-nok-relationship" label="Next of kin — relationship">
                    <SelectChoices
                      className={REG_SELECT}
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
                      {textInput("reg-guardian-status", "guardianStatus")}
                    </RegField>
                  )}
                </RegSection>
              )}

              <RegSection
                title="Social & personal details"
                intro={
                  <p className="mb-2 text-xs text-ink-500">
                    Optional — ask only what the client is comfortable sharing.
                  </p>
                }
              >
                <RegField id="reg-disability" label="Living with a disability">
                  <SelectChoices
                    className={REG_SELECT}
                    id="reg-disability"
                    options={vs.options("disability-status")}
                    placeholder="— select —"
                    value={form.disability}
                    onChange={set("disability")}
                  />
                </RegField>
                {showDisabilityDetails && (
                  <RegField
                    id="reg-disability-details"
                    label="Disability / support needs"
                    className="min-[901px]:col-span-2"
                  >
                    {textInput("reg-disability-details", "disabilityDetails")}
                  </RegField>
                )}
                <RegField id="reg-employment" label="Employment status">
                  <SelectChoices
                    className={REG_SELECT}
                    id="reg-employment"
                    options={vs.options("employment-status")}
                    placeholder="— select —"
                    value={form.employment}
                    onChange={set("employment")}
                  />
                </RegField>
                <RegField id="reg-occupation" label="Occupation">
                  {textInput("reg-occupation", "occupation")}
                </RegField>
                <RegField id="reg-marital" label="Marital status">
                  <SelectChoices
                    className={REG_SELECT}
                    id="reg-marital"
                    options={vs.options("marital-status")}
                    placeholder="— select —"
                    value={form.marital}
                    onChange={set("marital")}
                  />
                </RegField>
              </RegSection>

              {!resolving && (
                <RegSection title="Referral, allergies & payment">
                  <RegField id="reg-referral" label="Referral source">
                    {textInput("reg-referral", "referral", {
                      placeholder: "e.g. self, GP, family, police, court",
                    })}
                  </RegField>
                  <RegField
                    id="reg-allergy-status"
                    label="Allergies & reaction, if known (client report — confirmed clinically later)"
                  >
                    <SelectChoices
                      className={REG_SELECT}
                      id="reg-allergy-status"
                      options={vs.options("registration-allergy-status")}
                      value={allergyStatus}
                      onChange={set("allergyStatus")}
                    />
                  </RegField>
                  {showAllergyDetails && (
                    <RegField id="reg-allergy-details" label="Allergy & reaction details">
                      {textInput("reg-allergy-details", "allergyDetails")}
                    </RegField>
                  )}
                  <RegField id="reg-payer" label="Payer / insurance (optional — never blocks care)">
                    <SelectChoices
                      className={REG_SELECT}
                      id="reg-payer"
                      options={vs.options("payer")}
                      placeholder="— select —"
                      value={form.payer}
                      onChange={set("payer")}
                    />
                  </RegField>
                  <fieldset className={`min-w-0 ${FULL_ROW}`}>
                    <legend className="text-base font-semibold text-ink-900">
                      Privacy &amp; sharing
                    </legend>
                    <p className="mt-1 text-[13px] text-ink-500">
                      Explain each option, then record the client’s choice. {CONSENT_TEXT}
                    </p>
                    <div className="mt-4 overflow-hidden rounded-[14px] border border-surface-border">
                      <div className="grid min-[701px]:grid-cols-2">
                        {CONSENT_FIELDS.map(({ key, title, label, sensitive }, index) => {
                          const value = consent[key];
                          const status = CONSENT_STATUS[value] ?? CONSENT_STATUS.NOT_ASKED;
                          const options = vs
                            .options("hie-consent-decision")
                            .filter(
                              (o) =>
                                o.code !== "NOT_ASKED" &&
                                !(key === "family" && o.code === "RESTRICTED"),
                            );
                          return (
                            <div
                              key={key}
                              role="radiogroup"
                              aria-labelledby={`reg-consent-${key}`}
                              className={`flex flex-col gap-3 border-surface-border px-[18px] py-4 ${
                                index < CONSENT_FIELDS.length - 1 ? "border-b" : ""
                              } ${index % 2 === 0 ? "min-[701px]:border-r" : ""} ${
                                index >= CONSENT_FIELDS.length - 2 ? "min-[701px]:border-b-0" : ""
                              }`}
                            >
                              <div className="flex items-center justify-between gap-2.5">
                                <div className="min-w-0">
                                  <h4
                                    id={`reg-consent-${key}`}
                                    className="text-[14px] font-semibold text-ink-900"
                                  >
                                    {title}
                                    {sensitive && (
                                      <span className="ml-1.5 rounded-full bg-status-amber-tint px-[7px] py-px text-[11px] font-semibold text-status-amber">
                                        Sensitive
                                      </span>
                                    )}
                                  </h4>
                                  <p className="text-xs text-ink-500">{label}</p>
                                </div>
                                <span
                                  className={`flex-none whitespace-nowrap rounded-full px-2.5 py-[3px] text-xs font-semibold ${status.tone}`}
                                >
                                  {key === "family" ? status.family : status.label}
                                </span>
                              </div>
                              <div className="flex overflow-hidden rounded-[10px] border border-surface-border">
                                {options.map((o) => {
                                  const checked = value === o.code;
                                  return (
                                    <label
                                      key={o.code}
                                      className="relative flex-1 cursor-pointer border-r border-surface-border last:border-r-0"
                                    >
                                      <input
                                        type="radio"
                                        name={`reg-consent-${key}`}
                                        value={o.code}
                                        checked={checked}
                                        onChange={() =>
                                          setConsent((prev) => ({
                                            ...prev,
                                            [key]: o.code as ConsentDecision,
                                          }))
                                        }
                                        className="peer absolute inset-0 cursor-pointer opacity-0"
                                      />
                                      <span
                                        className={`block px-1.5 py-[9px] text-center text-[13px] font-medium peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:-outline-offset-2 peer-focus-visible:outline-brand-green ${
                                          checked
                                            ? CONSENT_STATUS[o.code].solid
                                            : "text-ink-500 hover:bg-surface-bg"
                                        }`}
                                      >
                                        {o.code === "RESTRICTED" ? "This facility only" : o.display}
                                      </span>
                                    </label>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                      <p className="border-t border-surface-border bg-surface-bg px-[18px] py-3 text-[13px] text-ink-500">
                        Nothing is sent to the HIE until the client says Yes. Saying No never
                        affects their care.
                      </p>
                    </div>
                  </fieldset>
                </RegSection>
              )}
            </>
          )}

          {dupMatches && (
            <div role="alert" className="mt-3">
              <Callout>
                <div className="w-full">
                  <strong>
                    {dupMatches.some((m) => m.match === "exact")
                      ? "This person is already registered."
                      : resolving
                        ? "This person may already be registered — merge rather than keep two records."
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
                          {resolving ? "Merge into this client" : "Use this record"}
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
          <div role="status" aria-live="polite" className={saved ? "mt-3" : ""}>
            {saved && <Callout tone="success">{saved}</Callout>}
          </div>
          <div className="mt-7 flex flex-wrap items-center gap-3 border-t border-surface-border pt-6">
            <button
              type="button"
              className={`${BTN_GHOST} !rounded-full !px-6 !py-[11px] !text-[14px]`}
              onClick={() =>
                navigate(editing && editId ? clientRecordPath(editId, "snapshot") : "/clinical")
              }
            >
              Cancel
            </button>
            {!editing && !resolving && selected && selected.identity_status === "IDENTIFIED" && (
              <button
                type="button"
                className={`${BTN_GHOST} !rounded-full !px-6 !py-[11px] !text-[14px]`}
                disabled={submitting}
                onClick={() => void saveDetails()}
              >
                Save details only
              </button>
            )}
            <button
              type="submit"
              className={`${BTN} !rounded-full !border-[var(--reg-accent)] !bg-[var(--reg-accent)] !px-6 !py-[11px] !text-[14px] hover:brightness-90 ${
                mode === "IDENTIFIED" || resolving ? "" : "!text-on-status"
              }`}
              disabled={submitting || (resolving && !resolveTarget) || (editing && !selected)}
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
