import { useEffect, useState } from "react";
import { FileText, Paperclip, Star } from "lucide-react";
import { useAuth } from "../../auth/useAuth";
import { DonutChart } from "../../components/charts/DonutChart";
import { StatCard } from "../../components/StatCard";
import { ApiError } from "../../lib/apiClient";
import {
  getAttachmentInsights,
  listAttachments,
  updateAttachment,
  uploadAttachment,
  type Attachment,
  type AttachmentCategory,
  type AttachmentInsights,
} from "../../lib/attachmentsApi";
import { listPatients, type PatientListRow } from "../../lib/clinicalApi";

const CATEGORY_LABEL: Record<AttachmentCategory, string> = {
  IDENTITY: "Identity Documents",
  CLINICAL: "Clinical Documents",
  ASSESSMENT: "Assessments",
  REFERRAL: "Referrals",
  LAB_RESULT: "Lab Results",
  IMAGING: "Imaging",
  CONSENT: "Consents",
  CORRESPONDENCE: "Correspondence",
  OTHER: "Other",
};
const CATEGORIES = Object.keys(CATEGORY_LABEL) as AttachmentCategory[];

const FIELD_CLASS =
  "rounded-sm border border-surface-border px-3 py-2 text-sm text-ink-900 outline-none transition-colors duration-150 focus:border-brand-green";
const LABEL_CLASS = "flex flex-col gap-1.5 text-sm font-medium text-ink-700";
const BUTTON_CLASS =
  "rounded-md bg-brand-green px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-green-dark active:scale-[0.98] disabled:opacity-60 disabled:active:scale-100 transition-all duration-150";

function formatSize(bytes: number | null) {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Global document manager + Document Insights — mockups/citramac_clinical_workspace.html. */
export function AttachmentsPage() {
  const { accessToken } = useAuth();
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [insights, setInsights] = useState<AttachmentInsights | null>(null);
  const [patients, setPatients] = useState<PatientListRow[]>([]);
  const [category, setCategory] = useState<AttachmentCategory | "">("");
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [uploadPatient, setUploadPatient] = useState("");
  const [uploadCategory, setUploadCategory] = useState<AttachmentCategory>("CLINICAL");
  const [uploadDescription, setUploadDescription] = useState("");
  const [uploadFile, setUploadFile] = useState<File | null>(null);

  const refresh = () => {
    if (!accessToken) return;
    listAttachments(accessToken, { category: category || undefined, q: search || undefined })
      .then((data) => setAttachments(data.results))
      .catch(() => setError("Couldn't load documents."));
    getAttachmentInsights(accessToken)
      .then(setInsights)
      .catch(() => undefined);
  };

  useEffect(refresh, [accessToken, category, search]);

  useEffect(() => {
    if (!accessToken) return;
    listPatients(accessToken)
      .then((data) => setPatients(data.results))
      .catch(() => undefined);
  }, [accessToken]);

  const upload = async () => {
    if (!accessToken || !uploadPatient || !uploadFile) return;
    setError(null);
    setBusy(true);
    try {
      await uploadAttachment(accessToken, {
        patient: uploadPatient,
        file: uploadFile,
        classification: "CURRENT",
        category: uploadCategory,
        description: uploadDescription,
      });
      setUploadFile(null);
      setUploadDescription("");
      refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't upload the document.");
    } finally {
      setBusy(false);
    }
  };

  const toggleFavorite = async (attachment: Attachment) => {
    if (!accessToken) return;
    await updateAttachment(accessToken, attachment.id, { is_favorite: !attachment.is_favorite });
    refresh();
  };

  const categoryChartData = Object.entries(insights?.by_category ?? {}).map(([key, value]) => ({
    label: CATEGORY_LABEL[key as AttachmentCategory] ?? key,
    value: value ?? 0,
  }));

  return (
    <div className="flex flex-col gap-6 animate-fade-in">
      <div>
        <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-brand-green">
          Module 1 · Document Management
        </div>
        <h1 className="font-display text-2xl font-bold text-ink-900">Attachments</h1>
      </div>

      <div className="grid grid-cols-3 gap-3.5 max-md:grid-cols-1">
        <StatCard icon={Paperclip} value={insights?.total ?? "—"} label="Total documents" />
        <StatCard icon={Star} tone="amber" value={insights?.favourites ?? "—"} label="Favourited" />
        <StatCard
          icon={FileText}
          value={insights?.by_status.ACTIVE ?? "—"}
          label="Active documents"
        />
      </div>

      {categoryChartData.length > 0 && (
        <section className="rounded-lg border border-surface-border bg-surface-card p-[18px] shadow-sm">
          <h2 className="mb-2 font-display text-[15px] font-semibold text-ink-900">
            Documents by category
          </h2>
          <DonutChart data={categoryChartData} centerLabel="Documents" />
        </section>
      )}

      <section className="rounded-lg border border-surface-border bg-surface-card p-6 shadow-sm">
        <h2 className="mb-4 font-display text-base font-semibold text-ink-900">Upload document</h2>
        <div className="flex flex-wrap items-end gap-3">
          <label className={LABEL_CLASS}>
            Client
            <select
              className={FIELD_CLASS}
              value={uploadPatient}
              onChange={(e) => setUploadPatient(e.target.value)}
            >
              <option value="">Select client…</option>
              {patients.map((patient) => (
                <option key={patient.id} value={patient.id}>
                  {patient.first_name} {patient.last_name}
                </option>
              ))}
            </select>
          </label>
          <label className={LABEL_CLASS}>
            Category
            <select
              className={FIELD_CLASS}
              value={uploadCategory}
              onChange={(e) => setUploadCategory(e.target.value as AttachmentCategory)}
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {/* eslint-disable-next-line security/detect-object-injection -- `c` is iterated from the fixed `CATEGORIES` const array, not user input. */}
                  {CATEGORY_LABEL[c]}
                </option>
              ))}
            </select>
          </label>
          <label className={`${LABEL_CLASS} flex-1 min-w-[200px]`}>
            Description
            <input
              className={FIELD_CLASS}
              value={uploadDescription}
              onChange={(e) => setUploadDescription(e.target.value)}
            />
          </label>
          <label className={LABEL_CLASS}>
            File
            <input
              type="file"
              className="text-sm"
              onChange={(e) => setUploadFile(e.target.files?.[0] ?? null)}
            />
          </label>
          <button
            type="button"
            disabled={busy || !uploadPatient || !uploadFile}
            className={BUTTON_CLASS}
            onClick={upload}
          >
            Upload
          </button>
        </div>
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <input
          className={`${FIELD_CLASS} w-64`}
          placeholder="Search documents or clients…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          className={FIELD_CLASS}
          value={category}
          onChange={(e) => setCategory(e.target.value as AttachmentCategory | "")}
        >
          <option value="">All categories</option>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {/* eslint-disable-next-line security/detect-object-injection -- `c` is iterated from the fixed `CATEGORIES` const array, not user input. */}
              {CATEGORY_LABEL[c]}
            </option>
          ))}
        </select>
      </div>

      <div className="overflow-x-auto rounded-lg border border-surface-border bg-surface-card shadow-sm">
        <table className="w-full min-w-[900px] text-left text-sm">
          <thead className="bg-surface-bg text-[10.5px] font-bold uppercase tracking-wide text-ink-400">
            <tr>
              <th className="px-4 py-3">Document</th>
              <th className="px-4 py-3">Client</th>
              <th className="px-4 py-3">Category</th>
              <th className="px-4 py-3">Uploaded</th>
              <th className="px-4 py-3">Size</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {attachments.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-ink-500">
                  No documents found.
                </td>
              </tr>
            )}
            {attachments.map((attachment) => (
              <tr
                key={attachment.id}
                className="border-t border-surface-border transition-colors duration-150 hover:bg-brand-green-tint-2"
              >
                <td className="px-4 py-3 text-ink-700">
                  <a
                    href={attachment.file}
                    target="_blank"
                    rel="noreferrer"
                    className="font-medium text-brand-green hover:underline"
                  >
                    {attachment.file.split("/").pop()}
                  </a>
                  {attachment.description && (
                    <p className="mt-0.5 text-xs text-ink-500">{attachment.description}</p>
                  )}
                </td>
                <td className="px-4 py-3 text-ink-700">{attachment.patient_name}</td>
                <td className="px-4 py-3 text-ink-700">{CATEGORY_LABEL[attachment.category]}</td>
                <td className="px-4 py-3 text-ink-700">
                  {new Date(attachment.uploaded_at).toLocaleDateString()}
                </td>
                <td className="px-4 py-3 text-ink-700">{formatSize(attachment.file_size)}</td>
                <td className="px-4 py-3">
                  <button
                    type="button"
                    onClick={() => toggleFavorite(attachment)}
                    className={attachment.is_favorite ? "text-status-amber" : "text-ink-300"}
                    aria-label="Toggle favorite"
                  >
                    <Star
                      className="h-4 w-4"
                      fill={attachment.is_favorite ? "currentColor" : "none"}
                    />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {error && (
        <p className="rounded-sm bg-status-red-tint px-3 py-2 text-sm text-status-red">{error}</p>
      )}
    </div>
  );
}
