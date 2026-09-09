import { useEffect, useState } from "react";
import { Download, FileText, Plus, Search, Star, Trash2, X } from "lucide-react";
import { useAuth } from "../auth/useAuth";
import { ApiError } from "../lib/apiClient";
import {
  deleteAttachment,
  listAttachments,
  updateAttachment,
  uploadAttachment,
  type Attachment,
  type AttachmentCategory,
} from "../lib/attachmentsApi";
import { listPatients, type PatientListRow } from "../lib/clinicalApi";
import { SaveButton } from "./SaveButton";

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
  "rounded-sm border border-surface-border bg-white px-3 py-2 text-[12.5px] text-ink-900 outline-none transition-colors duration-150 focus:border-brand-green";
const LABEL_CLASS = "flex flex-col gap-1.5 text-[11.5px] font-semibold text-ink-700";

function formatSize(bytes: number | null) {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Document-library UI (category sidebar with counts, main table, preview
 * pane) — the second clinical-workspace mockup's pattern, used identically
 * for both the global Attachments screen and a patient's Documents tab
 * (pass `patientId` to scope everything to one client and hide the Client
 * column). Delete/download stay the simple, immediate operations they are
 * today per the plan's decision 4 — the mockup's approval-gated delete and
 * "authorization required" download are fake in the mockup itself (never
 * wired to anything), so nothing here pretends otherwise.
 */
export function DocumentLibrary({
  patientId,
  admissionId,
}: {
  patientId?: string;
  admissionId?: string;
}) {
  const { accessToken } = useAuth();
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [patients, setPatients] = useState<PatientListRow[]>([]);
  const [category, setCategory] = useState<AttachmentCategory | "">("");
  const [favouritesOnly, setFavouritesOnly] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showUpload, setShowUpload] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [uploadPatient, setUploadPatient] = useState(patientId ?? "");
  const [uploadCategory, setUploadCategory] = useState<AttachmentCategory>("CLINICAL");
  const [uploadDescription, setUploadDescription] = useState("");
  const [uploadFile, setUploadFile] = useState<File | null>(null);

  const refresh = () => {
    if (!accessToken) return;
    listAttachments(accessToken, {
      patient: patientId,
      admission: admissionId,
      category: category || undefined,
      q: search || undefined,
    })
      .then((data) => setAttachments(data.results))
      .catch(() => setError("Couldn't load documents."));
  };

  useEffect(() => {
    // Deferred one microtask so `refresh`'s setState calls don't run
    // synchronously in the effect body itself.
    void Promise.resolve().then(refresh);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refresh reads accessToken/patientId/admissionId/category/search, all already listed.
  }, [accessToken, patientId, admissionId, category, search]);

  useEffect(() => {
    if (!accessToken || patientId) return;
    listPatients(accessToken)
      .then((data) => setPatients(data.results))
      .catch(() => undefined);
  }, [accessToken, patientId]);

  const visible = favouritesOnly ? attachments.filter((a) => a.is_favorite) : attachments;
  const selected = visible.find((a) => a.id === selectedId) ?? visible[0] ?? null;

  const categoryCounts = CATEGORIES.reduce<Record<string, number>>((acc, c) => {
    // eslint-disable-next-line security/detect-object-injection -- `c` is iterated from the fixed `CATEGORIES` const array, not user input.
    acc[c] = attachments.filter((a) => a.category === c).length;
    return acc;
  }, {});

  const upload = async () => {
    if (!accessToken || !uploadFile || !(uploadPatient || patientId)) return;
    setError(null);
    try {
      await uploadAttachment(accessToken, {
        patient: patientId ?? uploadPatient,
        admission: admissionId,
        file: uploadFile,
        classification: "CURRENT",
        category: uploadCategory,
        description: uploadDescription,
      });
      setUploadFile(null);
      setUploadDescription("");
      setShowUpload(false);
      refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't upload the document.");
      throw err;
    }
  };

  const toggleFavorite = async (attachment: Attachment) => {
    if (!accessToken) return;
    await updateAttachment(accessToken, attachment.id, { is_favorite: !attachment.is_favorite });
    refresh();
  };

  const remove = async (attachment: Attachment) => {
    if (!accessToken) return;
    if (!window.confirm(`Delete "${attachment.file.split("/").pop()}"? This cannot be undone.`)) {
      return;
    }
    await deleteAttachment(accessToken, attachment.id);
    if (selectedId === attachment.id) setSelectedId(null);
    refresh();
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-400" />
          <input
            className={`${FIELD_CLASS} w-full pl-8`}
            placeholder="Search documents or clients…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <button
          type="button"
          onClick={() => setFavouritesOnly((v) => !v)}
          className={`flex items-center gap-1.5 rounded-sm border px-3 py-2 text-[12px] font-semibold transition-colors duration-150 ${
            favouritesOnly
              ? "border-status-amber bg-status-amber-tint text-status-amber"
              : "border-surface-border bg-white text-ink-700 hover:bg-surface-bg"
          }`}
        >
          <Star className="h-3.5 w-3.5" fill={favouritesOnly ? "currentColor" : "none"} />
          Favourites
        </button>
        <button
          type="button"
          onClick={() => setShowUpload((v) => !v)}
          className="flex items-center gap-1.5 rounded-md bg-brand-green px-3.5 py-2 text-[12.5px] font-semibold text-white shadow-sm hover:bg-brand-green-dark"
        >
          <Plus className="h-4 w-4" />
          Upload document
        </button>
      </div>

      {showUpload && (
        <div className="animate-scale-in rounded-lg border border-surface-border bg-surface-card p-4 shadow-sm">
          <div className="flex flex-wrap items-end gap-3">
            {!patientId && (
              <label className={LABEL_CLASS}>
                Client
                <select
                  className={FIELD_CLASS}
                  value={uploadPatient}
                  onChange={(e) => setUploadPatient(e.target.value)}
                >
                  <option value="">Select client…</option>
                  {patients.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.first_name} {p.last_name}
                    </option>
                  ))}
                </select>
              </label>
            )}
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
            <label className={`${LABEL_CLASS} min-w-[200px] flex-1`}>
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
                className="text-[12px]"
                onChange={(e) => setUploadFile(e.target.files?.[0] ?? null)}
              />
            </label>
            <SaveButton onSave={upload} disabled={!uploadFile || !(uploadPatient || patientId)}>
              Upload
            </SaveButton>
            <button
              type="button"
              onClick={() => setShowUpload(false)}
              aria-label="Cancel upload"
              className="flex h-9 w-9 items-center justify-center rounded-md border border-surface-border text-ink-500 hover:bg-surface-bg"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {error && (
        <p className="rounded-sm bg-status-red-tint px-3 py-2 text-sm text-status-red">{error}</p>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[180px_1fr_290px]">
        <aside className="rounded-lg border border-surface-border bg-surface-card p-3 shadow-sm">
          <button
            type="button"
            onClick={() => setCategory("")}
            className={`flex w-full items-center justify-between rounded-md px-2.5 py-2 text-left text-[12px] font-semibold transition-colors duration-150 ${
              category === ""
                ? "bg-brand-green-tint text-brand-green-dark"
                : "text-ink-700 hover:bg-surface-bg"
            }`}
          >
            All Documents
            <span className="text-[10.5px] text-ink-400">{attachments.length}</span>
          </button>
          {CATEGORIES.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setCategory(c)}
              className={`flex w-full items-center justify-between rounded-md px-2.5 py-2 text-left text-[12px] font-medium transition-colors duration-150 ${
                category === c
                  ? "bg-brand-green-tint text-brand-green-dark"
                  : "text-ink-700 hover:bg-surface-bg"
              }`}
            >
              {/* eslint-disable-next-line security/detect-object-injection -- `c` is iterated from the fixed `CATEGORIES` const array, not user input. */}
              {CATEGORY_LABEL[c]}
              {/* eslint-disable-next-line security/detect-object-injection -- `c` is iterated from the fixed `CATEGORIES` const array, not user input. */}
              <span className="text-[10.5px] text-ink-400">{categoryCounts[c]}</span>
            </button>
          ))}
        </aside>

        <div className="overflow-x-auto rounded-lg border border-surface-border bg-surface-card shadow-sm">
          <table className="w-full min-w-[560px] text-left text-sm">
            <thead className="bg-surface-bg text-[10px] font-bold uppercase tracking-wide text-ink-400">
              <tr>
                <th className="px-4 py-3">Document</th>
                {!patientId && <th className="px-4 py-3">Client</th>}
                <th className="px-4 py-3">Uploaded</th>
                <th className="px-4 py-3">Size</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 && (
                <tr>
                  <td colSpan={patientId ? 4 : 5} className="px-4 py-8 text-center text-ink-500">
                    No documents found.
                  </td>
                </tr>
              )}
              {visible.map((a) => (
                <tr
                  key={a.id}
                  onClick={() => setSelectedId(a.id)}
                  className={`cursor-pointer border-t border-surface-border transition-colors duration-150 hover:bg-brand-green-tint-2 ${
                    selected?.id === a.id ? "bg-brand-green-tint-2" : ""
                  }`}
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <FileText className="h-4 w-4 flex-none text-brand-green" />
                      <span className="font-medium text-ink-900">{a.file.split("/").pop()}</span>
                    </div>
                  </td>
                  {!patientId && <td className="px-4 py-3 text-ink-700">{a.patient_name}</td>}
                  <td className="px-4 py-3 text-ink-700">
                    {new Date(a.uploaded_at).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3 text-ink-700">{formatSize(a.file_size)}</td>
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleFavorite(a);
                      }}
                      className={a.is_favorite ? "text-status-amber" : "text-ink-300"}
                      aria-label="Toggle favorite"
                    >
                      <Star className="h-4 w-4" fill={a.is_favorite ? "currentColor" : "none"} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <aside className="rounded-lg border border-surface-border bg-surface-card p-4 shadow-sm">
          {!selected && (
            <p className="text-[12.5px] text-ink-500">Select a document to preview its details.</p>
          )}
          {selected && (
            <div className="flex flex-col gap-3">
              <div>
                <div className="font-display text-[13px] font-semibold text-ink-900">
                  {selected.file.split("/").pop()}
                </div>
                <p className="mt-0.5 text-[10.5px] text-ink-500">
                  {CATEGORY_LABEL[selected.category]} · Uploaded{" "}
                  {new Date(selected.uploaded_at).toLocaleString()}
                </p>
                <p className="text-[10.5px] text-ink-500">by {selected.uploaded_by_name || "—"}</p>
              </div>
              {selected.description && (
                <p className="rounded-md bg-surface-bg p-2.5 text-[11.5px] text-ink-700">
                  {selected.description}
                </p>
              )}
              <div className="grid grid-cols-2 gap-2 text-[11px]">
                <div className="rounded-md border border-surface-border p-2">
                  <span className="text-ink-400">Size</span>
                  <div className="font-semibold text-ink-900">{formatSize(selected.file_size)}</div>
                </div>
                <div className="rounded-md border border-surface-border p-2">
                  <span className="text-ink-400">Status</span>
                  <div className="font-semibold text-ink-900">{selected.doc_status}</div>
                </div>
              </div>
              <div className="flex gap-2">
                <a
                  href={selected.file}
                  target="_blank"
                  rel="noreferrer"
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-md border border-surface-border py-2 text-[11.5px] font-semibold text-ink-700 hover:bg-surface-bg"
                >
                  <Download className="h-3.5 w-3.5" />
                  Open
                </a>
                <button
                  type="button"
                  onClick={() => remove(selected)}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-md border border-status-red/30 bg-status-red-tint py-2 text-[11.5px] font-semibold text-status-red hover:bg-status-red/10"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Delete
                </button>
              </div>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
