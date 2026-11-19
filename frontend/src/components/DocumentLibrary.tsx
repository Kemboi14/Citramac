import { useEffect, useState } from "react";
import {
  Archive,
  ArchiveRestore,
  Clock,
  Download,
  Eye,
  FileImage,
  FileText,
  Maximize2,
  Plus,
  Printer,
  Search,
  Star,
  X,
} from "lucide-react";
import { useAuth } from "../auth/useAuth";
import { ApiError } from "../lib/apiClient";
import {
  archiveAttachment,
  downloadAttachment,
  listAttachments,
  previewAttachment,
  requestAttachmentDownload,
  restoreAttachment,
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
  "rounded-sm border border-surface-border bg-surface-card px-3 py-2 text-[12.5px] text-ink-900 outline-none transition-colors duration-150 focus:border-brand-green";
const LABEL_CLASS = "flex flex-col gap-1.5 text-[11.5px] font-semibold text-ink-700";
const ACTION_CLASS =
  "flex flex-1 items-center justify-center gap-1.5 rounded-md border border-surface-border py-2 text-[11.5px] font-semibold text-ink-700 hover:bg-surface-bg disabled:cursor-not-allowed disabled:opacity-60";

function formatSize(bytes: number | null) {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const isPdf = (a: Attachment) => a.content_type === "application/pdf";
const isImage = (a: Attachment) => a.content_type.startsWith("image/");

/** A file-type tile: a red PDF badge, an image icon, or a generic document. */
function FileIcon({ attachment, size = "sm" }: { attachment: Attachment; size?: "sm" | "lg" }) {
  const box = size === "lg" ? "h-12 w-10" : "h-8 w-7";
  if (isPdf(attachment))
    return (
      <span
        className={`relative flex ${box} flex-none items-end justify-center rounded-[4px] border border-status-red/40 bg-status-red-tint pb-0.5`}
        aria-label="PDF"
      >
        <FileText className="absolute top-1 h-3.5 w-3.5 text-status-red" />
        <span className="text-[7.5px] font-extrabold leading-none tracking-wide text-status-red">
          PDF
        </span>
      </span>
    );
  if (isImage(attachment))
    return (
      <span
        className={`flex ${box} flex-none items-center justify-center rounded-[4px] border border-surface-border bg-brand-green-tint`}
        aria-label="Image"
      >
        <FileImage className="h-4 w-4 text-brand-green-dark" />
      </span>
    );
  return (
    <span
      className={`flex ${box} flex-none items-center justify-center rounded-[4px] border border-surface-border bg-surface-bg`}
    >
      <FileText className="h-4 w-4 text-ink-500" />
    </span>
  );
}

/** The file shown in the page, fetched through the audited preview endpoint. */
function useBlobUrl(accessToken: string | null, attachment: Attachment | null) {
  const [state, setState] = useState<{ id: string; url: string | null; error: string | null }>({
    id: "",
    url: null,
    error: null,
  });
  const id = attachment?.id ?? "";
  const previewable = attachment ? isPdf(attachment) || isImage(attachment) : false;
  useEffect(() => {
    if (!accessToken || !id || !previewable) return;
    let url: string | null = null;
    let cancelled = false;
    previewAttachment(accessToken, id)
      .then((blob) => {
        if (cancelled) return;
        url = URL.createObjectURL(blob);
        setState({ id, url, error: null });
      })
      .catch((err) => {
        if (!cancelled)
          setState({
            id,
            url: null,
            error: err instanceof ApiError ? err.message : "Couldn't load the preview.",
          });
      });
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [accessToken, id, previewable]);
  return state.id === id ? state : { id, url: null, error: null };
}

function PreviewFrame({
  attachment,
  url,
  tall = false,
}: {
  attachment: Attachment;
  url: string;
  tall?: boolean;
}) {
  const height = tall ? "h-[80vh]" : "h-[340px]";
  return isPdf(attachment) ? (
    <iframe
      title={`Preview of ${attachment.name}`}
      src={`${url}#toolbar=0&navpanes=0`}
      className={`${height} w-full rounded-md border border-surface-border bg-white`}
    />
  ) : (
    <img
      src={url}
      alt={attachment.name}
      className={`${tall ? "max-h-[80vh]" : "max-h-[340px]"} w-full rounded-md border border-surface-border object-contain`}
    />
  );
}

/** Print or download a copy (Org Admin directly; others once per approval). */
function CopyActions({
  attachment,
  onChanged,
  onError,
}: {
  attachment: Attachment;
  onChanged: () => void;
  onError: (message: string) => void;
}) {
  const { accessToken } = useAuth();
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const access = attachment.access ?? { download: "request" as const };

  const takeCopy = async (print: boolean) => {
    if (!accessToken) return;
    setBusy(true);
    try {
      const blob = await downloadAttachment(accessToken, attachment.id);
      const url = URL.createObjectURL(blob);
      if (print) {
        const frame = document.createElement("iframe");
        frame.style.display = "none";
        frame.src = url;
        frame.onload = () => frame.contentWindow?.print();
        document.body.appendChild(frame);
        window.setTimeout(() => {
          frame.remove();
          URL.revokeObjectURL(url);
        }, 60_000);
      } else {
        const link = document.createElement("a");
        link.href = url;
        link.download = attachment.name;
        link.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
      }
      onChanged();
    } catch (err) {
      onError(err instanceof ApiError ? err.message : "Couldn't get a copy of the document.");
    } finally {
      setBusy(false);
    }
  };

  const ask = async () => {
    if (!accessToken) return;
    setBusy(true);
    try {
      await requestAttachmentDownload(accessToken, attachment.id, reason);
      setAsking(false);
      setReason("");
      onChanged();
    } catch (err) {
      onError(err instanceof ApiError ? err.message : "Couldn't send the request.");
    } finally {
      setBusy(false);
    }
  };

  if (access.download === "direct" || access.download === "approved")
    return (
      <div className="flex flex-col gap-1.5">
        <div className="flex gap-2">
          <button
            type="button"
            className={ACTION_CLASS}
            disabled={busy}
            onClick={() => void takeCopy(false)}
          >
            <Download className="h-3.5 w-3.5" />
            Download
          </button>
          {isPdf(attachment) && (
            <button
              type="button"
              className={ACTION_CLASS}
              disabled={busy}
              onClick={() => void takeCopy(true)}
            >
              <Printer className="h-3.5 w-3.5" />
              Print
            </button>
          )}
        </div>
        {access.download === "approved" && (
          <p className="text-[10.5px] text-ink-500">
            Approved — one copy, until {new Date(access.expires_at).toLocaleString()}.
          </p>
        )}
      </div>
    );

  if (access.download === "pending")
    return (
      <p className="flex items-center gap-1.5 rounded-md bg-status-amber-tint px-2.5 py-2 text-[11.5px] text-status-amber">
        <Clock className="h-3.5 w-3.5" />
        Download requested — waiting for an Org Admin.
      </p>
    );

  return (
    <div className="flex flex-col gap-2">
      {access.download === "declined" && (
        <p className="rounded-md bg-status-red-tint px-2.5 py-2 text-[11px] text-status-red">
          Your last request was declined{access.reason ? `: ${access.reason}` : "."}
        </p>
      )}
      {asking ? (
        <div className="flex flex-col gap-2">
          <input
            className={FIELD_CLASS}
            placeholder="Why is a copy needed?"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <div className="flex gap-2">
            <button
              type="button"
              className={ACTION_CLASS}
              disabled={busy || reason.trim().length < 5}
              onClick={() => void ask()}
            >
              Send request
            </button>
            <button type="button" className={ACTION_CLASS} onClick={() => setAsking(false)}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button type="button" className={ACTION_CLASS} onClick={() => setAsking(true)}>
          <Download className="h-3.5 w-3.5" />
          Request download / print
        </button>
      )}
      <p className="text-[10.5px] text-ink-500">
        A copy leaving the system needs an Org Admin&rsquo;s approval (one copy, within 24 hours).
      </p>
    </div>
  );
}

/**
 * The client's documents: category sidebar with counts, the list, and a
 * preview pane showing the file itself. Used for the client record's
 * Attachments tab, the global Attachments screen and an admission's documents
 * (pass `patientId` to scope to one client and hide the Client column).
 *
 * Files are never opened by their storage address: the preview is fetched
 * through the audited preview endpoint; a copy (download or print) needs an Org
 * Admin's approval — once, within 24 hours — and Org Admins take one directly
 * (owner decision 2026-11-19). Documents are never deleted: "Archive" takes
 * one out of active use and can be undone.
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
  const [fullScreen, setFullScreen] = useState(false);
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
  const preview = useBlobUrl(accessToken, selected);

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

  // Writes under an archived client record come back 409 RECORD_ARCHIVED —
  // every action here surfaces the backend's message rather than failing
  // silently.
  const toggleFavorite = async (attachment: Attachment) => {
    if (!accessToken) return;
    setError(null);
    try {
      await updateAttachment(accessToken, attachment.id, {
        is_favorite: !attachment.is_favorite,
      });
      refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't update the document.");
    }
  };

  const archive = async (attachment: Attachment) => {
    if (!accessToken) return;
    if (
      !window.confirm(
        `Archive "${attachment.name}"? The document is kept in full and can be restored at any time.`,
      )
    ) {
      return;
    }
    setError(null);
    try {
      await archiveAttachment(accessToken, attachment.id);
      refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't archive the document.");
    }
  };

  const restore = async (attachment: Attachment) => {
    if (!accessToken) return;
    setError(null);
    try {
      await restoreAttachment(accessToken, attachment.id);
      refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't restore the document.");
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-400" />
          <input
            className={`${FIELD_CLASS} w-full pl-8`}
            placeholder={
              patientId ? "Search this client's documents…" : "Search documents or clients…"
            }
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
              : "border-surface-border bg-surface-card text-ink-700 hover:bg-surface-bg"
          }`}
        >
          <Star className="h-3.5 w-3.5" fill={favouritesOnly ? "currentColor" : "none"} />
          Favourites
        </button>
        <button
          type="button"
          onClick={() => setShowUpload((v) => !v)}
          className="flex items-center gap-1.5 rounded-md bg-brand-green px-3.5 py-2 text-[12.5px] font-semibold text-on-primary shadow-sm hover:bg-brand-green-dark"
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
              Document name
              <input
                className={FIELD_CLASS}
                placeholder="e.g. Referral letter — Moi Teaching & Referral Hospital"
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

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[180px_1fr_360px]">
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

        <div className="overflow-hidden rounded-lg border border-surface-border bg-surface-card shadow-sm">
          {visible.length === 0 && (
            <p className="px-4 py-10 text-center text-[13px] text-ink-500">No documents found.</p>
          )}
          <ul>
            {visible.map((a) => (
              <li key={a.id}>
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => setSelectedId(a.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") setSelectedId(a.id);
                  }}
                  className={`flex cursor-pointer items-center gap-3 border-b border-surface-border px-4 py-3 transition-colors duration-150 hover:bg-brand-green-tint-2 ${
                    selected?.id === a.id ? "bg-brand-green-tint-2" : ""
                  }`}
                >
                  <FileIcon attachment={a} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-[13px] font-semibold text-ink-900">
                        {a.name}
                      </span>
                      {a.doc_status === "ARCHIVED" && (
                        <span className="rounded-full border border-surface-border bg-surface-bg px-2 py-0.5 text-[10px] font-semibold text-ink-700">
                          Archived
                        </span>
                      )}
                    </div>
                    <p className="truncate text-[11px] text-ink-500">
                      {[
                        !patientId ? a.patient_name : "",
                        CATEGORY_LABEL[a.category],
                        new Date(a.uploaded_at).toLocaleDateString(),
                        a.uploaded_by_name,
                        formatSize(a.file_size),
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      void toggleFavorite(a);
                    }}
                    className={a.is_favorite ? "text-status-amber" : "text-ink-300"}
                    aria-label="Toggle favorite"
                  >
                    <Star className="h-4 w-4" fill={a.is_favorite ? "currentColor" : "none"} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <aside className="rounded-lg border border-surface-border bg-surface-card p-4 shadow-sm">
          {!selected && (
            <p className="text-[12.5px] text-ink-500">Select a document to preview it.</p>
          )}
          {selected && (
            <div className="flex flex-col gap-3">
              <div className="flex items-start gap-3">
                <FileIcon attachment={selected} size="lg" />
                <div className="min-w-0">
                  <div className="break-words font-display text-[13px] font-semibold text-ink-900">
                    {selected.name}
                  </div>
                  <p className="mt-0.5 text-[10.5px] text-ink-500">
                    {CATEGORY_LABEL[selected.category]} · {formatSize(selected.file_size)}
                  </p>
                  <p className="text-[10.5px] text-ink-500">
                    Uploaded {new Date(selected.uploaded_at).toLocaleString()} by{" "}
                    {selected.uploaded_by_name || "—"}
                  </p>
                </div>
              </div>

              {preview.url ? (
                <div className="flex flex-col gap-1.5">
                  <PreviewFrame attachment={selected} url={preview.url} />
                  <button
                    type="button"
                    className="flex items-center gap-1.5 self-end text-[11.5px] font-semibold text-brand-green hover:underline"
                    onClick={() => setFullScreen(true)}
                  >
                    <Maximize2 className="h-3.5 w-3.5" />
                    Larger preview
                  </button>
                </div>
              ) : (
                <div className="flex h-[120px] items-center justify-center rounded-md border border-dashed border-surface-border text-[11.5px] text-ink-500">
                  {preview.error ??
                    (isPdf(selected) || isImage(selected)
                      ? "Loading preview…"
                      : "No preview for this file type.")}
                </div>
              )}

              <CopyActions
                key={selected.id}
                attachment={selected}
                onChanged={refresh}
                onError={setError}
              />

              <div className="flex gap-2 border-t border-surface-border pt-3">
                {selected.doc_status === "ARCHIVED" ? (
                  <button
                    type="button"
                    onClick={() => void restore(selected)}
                    className={ACTION_CLASS}
                  >
                    <ArchiveRestore className="h-3.5 w-3.5" />
                    Restore
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => void archive(selected)}
                    className={ACTION_CLASS}
                  >
                    <Archive className="h-3.5 w-3.5" />
                    Archive
                  </button>
                )}
              </div>
              <p className="flex items-center gap-1.5 text-[10.5px] text-ink-400">
                <Eye className="h-3 w-3" /> Opening a document is recorded in the audit log.
              </p>
            </div>
          )}
        </aside>
      </div>

      {fullScreen && selected && preview.url && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Preview of ${selected.name}`}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => setFullScreen(false)}
        >
          <div
            className="flex w-full max-w-5xl flex-col gap-2 rounded-lg bg-surface-card p-3 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-[13px] font-semibold text-ink-900">
                {selected.name}
              </span>
              <button
                type="button"
                aria-label="Close preview"
                className="flex h-8 w-8 items-center justify-center rounded-md border border-surface-border text-ink-500 hover:bg-surface-bg"
                onClick={() => setFullScreen(false)}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <PreviewFrame attachment={selected} url={preview.url} tall />
          </div>
        </div>
      )}
    </div>
  );
}
