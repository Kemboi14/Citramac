import { useEffect, useRef, useState } from "react";
import { FileText, Loader2, Plus, Upload } from "lucide-react";
import { useAuth } from "../../auth/useAuth";
import { ApiError } from "../../lib/apiClient";
import type { Branch } from "../../lib/branchesApi";
import {
  BRANCH_REGULATOR_OPTIONS,
  REGULATORY_FILE_ACCEPT,
  REGULATORY_FILE_MAX_BYTES,
  addBranchRegulatoryFiles,
  addBranchRegulatoryRecord,
  downloadBranchRegulatoryFile,
  listBranchRegulatoryRecords,
  removeBranchRegulatoryFile,
  removeBranchRegulatoryRecord,
  type BranchRegulatoryFields,
  type BranchRegulatoryRecord,
} from "../../lib/branchRegulatoryApi";
import { SaveButton } from "../../components/SaveButton";
import { StatusPill } from "../care/shared/ui";
import DateInput from "../../components/DateInput";

const FIELD_CLASS =
  "rounded-sm border border-surface-border bg-surface-card px-3 py-2 text-sm text-ink-900 outline-none transition-colors duration-150 focus:border-brand-green";
const LABEL_CLASS = "flex flex-col gap-1.5 text-sm font-medium text-ink-700";
const CARD_CLASS = "rounded-lg border border-surface-border bg-surface-card p-6 shadow-sm";
const SMALL_BUTTON =
  "inline-flex items-center gap-1.5 rounded-md border border-surface-border px-3 py-1.5 text-xs font-semibold text-ink-700 transition-colors duration-150 hover:bg-surface-bg disabled:opacity-60";
const LINK_BUTTON = "text-xs font-semibold text-brand-green hover:underline disabled:opacity-60";
const FILE_HELP = "PDF, PNG or JPEG, up to 10 MB each. You can choose several at once.";

const EMPTY_FORM: BranchRegulatoryFields = {
  regulator: "KMPDC",
  regulator_name: "",
  document_type: "",
  number: "",
  issued_on: "",
  valid_until: "",
};

function formatSize(bytes: number) {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function formatDate(value: string | null) {
  return value ? new Date(`${value}T00:00:00`).toLocaleDateString() : "—";
}

/** Files over the size limit, named — checked here so nothing is sent in vain;
 * the server checks type, size and content again. */
function oversized(files: File[]) {
  return files.filter((file) => file.size > REGULATORY_FILE_MAX_BYTES).map((file) => file.name);
}

function ExpiryPill({ record }: { record: BranchRegulatoryRecord }) {
  switch (record.status) {
    case "EXPIRED":
      return <StatusPill tone="danger">Expired</StatusPill>;
    case "EXPIRING":
      return (
        <StatusPill tone="warning">
          {record.days_remaining === 0
            ? "Expires today"
            : `Expires in ${record.days_remaining} day${record.days_remaining === 1 ? "" : "s"}`}
        </StatusPill>
      );
    case "VALID":
      return <StatusPill tone="success">Valid</StatusPill>;
    default:
      return <StatusPill tone="neutral">No expiry date</StatusPill>;
  }
}

function errorText(err: unknown, fallback: string) {
  return err instanceof ApiError ? err.message : fallback;
}

/**
 * A branch's regulatory documents — as many as it needs (registration
 * certificate, operating licence, NACADA accreditation, pharmacy premises
 * licence…), each with as many files as it takes. Alongside, never instead
 * of, the registration numbers in "Registration & Compliance". Files are
 * opened through the authenticated, audited download endpoint only.
 */
export function BranchRegulatoryDocumentsCard({ branches }: { branches: Branch[] }) {
  const { accessToken } = useAuth();
  const [branchId, setBranchId] = useState<string>(branches[0]?.id ?? "");
  const [records, setRecords] = useState<BranchRegulatoryRecord[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState<BranchRegulatoryFields>(EMPTY_FORM);
  const [newFiles, setNewFiles] = useState<File[]>([]);
  const [formError, setFormError] = useState<string | null>(null);
  const newFilesRef = useRef<HTMLInputElement>(null);

  const selectedBranchId = branches.some((b) => b.id === branchId)
    ? branchId
    : (branches[0]?.id ?? "");

  useEffect(() => {
    if (!accessToken || !selectedBranchId) return;
    let cancelled = false;
    listBranchRegulatoryRecords(accessToken, selectedBranchId)
      .then((result) => {
        if (cancelled) return;
        setRecords(result);
        setLoadError(null);
      })
      .catch((err) => {
        if (!cancelled) setLoadError(errorText(err, "Couldn't load the regulatory documents."));
      });
    return () => {
      cancelled = true;
    };
  }, [accessToken, selectedBranchId]);

  const updateForm = (patch: Partial<BranchRegulatoryFields>) =>
    setForm((prev) => ({ ...prev, ...patch }));

  const resetForm = () => {
    setAdding(false);
    setForm(EMPTY_FORM);
    setNewFiles([]);
    setFormError(null);
  };

  const formProblem = (() => {
    if (form.regulator === "OTHER" && !form.regulator_name.trim()) return "Name the regulator.";
    if (!form.document_type.trim()) return "Enter the document type as written on it.";
    if (newFiles.length === 0) return "Choose at least one file.";
    return null;
  })();

  const saveRecord = async () => {
    if (!accessToken || !selectedBranchId) return;
    setFormError(null);
    const tooBig = oversized(newFiles);
    if (tooBig.length) {
      setFormError(`Over 10 MB: ${tooBig.join(", ")}`);
      throw new Error("oversized");
    }
    try {
      setRecords(await addBranchRegulatoryRecord(accessToken, selectedBranchId, form, newFiles));
      resetForm();
    } catch (err) {
      setFormError(errorText(err, "Couldn't save the document."));
      throw err;
    }
  };

  const run = async (
    key: string,
    action: () => Promise<BranchRegulatoryRecord[]>,
    fallback: string,
  ) => {
    setActionError(null);
    setBusyKey(key);
    try {
      setRecords(await action());
    } catch (err) {
      setActionError(errorText(err, fallback));
    } finally {
      setBusyKey(null);
    }
  };

  const addFiles = (record: BranchRegulatoryRecord, files: File[]) => {
    if (!accessToken || files.length === 0) return;
    const tooBig = oversized(files);
    if (tooBig.length) {
      setActionError(`Over 10 MB: ${tooBig.join(", ")}`);
      return;
    }
    void run(
      `add:${record.id}`,
      () => addBranchRegulatoryFiles(accessToken, selectedBranchId, record.id, files),
      "Couldn't upload the files.",
    );
  };

  const removeFile = (record: BranchRegulatoryRecord, fileId: string, name: string) => {
    if (!accessToken) return;
    if (!window.confirm(`Remove "${name}" from ${record.document_type}? It is hidden, not erased.`))
      return;
    void run(
      `file:${fileId}`,
      () => removeBranchRegulatoryFile(accessToken, selectedBranchId, record.id, fileId),
      "Couldn't remove the file.",
    );
  };

  const removeRecord = (record: BranchRegulatoryRecord) => {
    if (!accessToken) return;
    if (
      !window.confirm(
        `Remove "${record.document_type}" and its files from this branch? It is hidden, not erased.`,
      )
    )
      return;
    void run(
      `record:${record.id}`,
      () => removeBranchRegulatoryRecord(accessToken, selectedBranchId, record.id),
      "Couldn't remove the document.",
    );
  };

  const viewFile = async (record: BranchRegulatoryRecord, fileId: string) => {
    if (!accessToken) return;
    setActionError(null);
    setBusyKey(`view:${fileId}`);
    try {
      const blob = await downloadBranchRegulatoryFile(
        accessToken,
        selectedBranchId,
        record.id,
        fileId,
      );
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank", "noopener");
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      setActionError(errorText(err, "Couldn't open the file."));
    } finally {
      setBusyKey(null);
    }
  };

  if (branches.length === 0) return null;

  return (
    <div className={CARD_CLASS}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-base font-semibold text-ink-900">
          <span className="inline-flex items-center gap-2">
            <FileText size={16} className="text-brand-green" />
            Regulatory documents
          </span>
        </h2>
        {!adding && (
          <button type="button" className={SMALL_BUTTON} onClick={() => setAdding(true)}>
            <Plus className="h-3.5 w-3.5" />
            Add document
          </button>
        )}
      </div>
      <p className="mb-4 text-xs text-ink-500">
        Each branch&rsquo;s registration certificate, operating licence, accreditation and other
        regulatory documents, with as many files as each one needs. {FILE_HELP}
      </p>

      {branches.length > 1 && (
        <label className={`${LABEL_CLASS} mb-4 max-w-sm`}>
          Branch
          <select
            className={FIELD_CLASS}
            value={selectedBranchId}
            onChange={(e) => {
              setBranchId(e.target.value);
              setRecords(null);
              resetForm();
            }}
          >
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </label>
      )}

      {adding && (
        <form
          onSubmit={(e) => e.preventDefault()}
          className="mb-5 flex flex-col gap-3 rounded-md border border-surface-border p-4"
        >
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <label className={LABEL_CLASS}>
              Regulator
              <select
                className={FIELD_CLASS}
                value={form.regulator}
                onChange={(e) =>
                  updateForm({ regulator: e.target.value as BranchRegulatoryFields["regulator"] })
                }
              >
                {BRANCH_REGULATOR_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            {form.regulator === "OTHER" && (
              <label className={LABEL_CLASS}>
                Regulator&rsquo;s name
                <input
                  className={FIELD_CLASS}
                  maxLength={150}
                  value={form.regulator_name}
                  onChange={(e) => updateForm({ regulator_name: e.target.value })}
                  placeholder="As written on the document"
                />
              </label>
            )}
            <label className={LABEL_CLASS}>
              Document type
              <input
                className={FIELD_CLASS}
                maxLength={150}
                value={form.document_type}
                onChange={(e) => updateForm({ document_type: e.target.value })}
                placeholder="As written on the document"
              />
            </label>
            <label className={LABEL_CLASS}>
              Number
              <input
                className={FIELD_CLASS}
                maxLength={64}
                value={form.number}
                onChange={(e) => updateForm({ number: e.target.value })}
              />
            </label>
            <label className={LABEL_CLASS}>
              Issued
              <DateInput
                className={FIELD_CLASS}
                value={form.issued_on}
                onChange={(e) => updateForm({ issued_on: e.target.value })}
              />
            </label>
            <label className={LABEL_CLASS}>
              Valid until
              <DateInput
                className={FIELD_CLASS}
                value={form.valid_until}
                onChange={(e) => updateForm({ valid_until: e.target.value })}
              />
            </label>
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-ink-700">Files</span>
            <input
              ref={newFilesRef}
              type="file"
              multiple
              accept={REGULATORY_FILE_ACCEPT}
              className="hidden"
              onChange={(e) => {
                const chosen = Array.from(e.target.files ?? []);
                e.target.value = "";
                setNewFiles((prev) => [...prev, ...chosen]);
              }}
            />
            <div>
              <button
                type="button"
                className={SMALL_BUTTON}
                onClick={() => newFilesRef.current?.click()}
              >
                <Upload className="h-3.5 w-3.5" />
                Choose files
              </button>
            </div>
            <span className="text-[11px] text-ink-400">{FILE_HELP}</span>
            {newFiles.length > 0 && (
              <ul className="flex flex-col gap-1">
                {newFiles.map((file, index) => (
                  <li
                    key={`${file.name}-${index}`}
                    className="flex items-center justify-between gap-2 text-sm text-ink-900"
                  >
                    <span className="min-w-0 truncate">
                      {file.name}{" "}
                      <span className="text-xs text-ink-500">({formatSize(file.size)})</span>
                    </span>
                    <button
                      type="button"
                      className={LINK_BUTTON}
                      onClick={() => setNewFiles((prev) => prev.filter((_, i) => i !== index))}
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {formProblem && <p className="text-xs text-ink-500">{formProblem}</p>}
          <div className="flex flex-wrap gap-2">
            <SaveButton onSave={saveRecord} disabled={formProblem !== null}>
              Save document
            </SaveButton>
            <button type="button" className={SMALL_BUTTON} onClick={resetForm}>
              Cancel
            </button>
          </div>
          {formError && (
            <p className="rounded-sm bg-status-red-tint px-3 py-2 text-sm text-status-red">
              {formError}
            </p>
          )}
        </form>
      )}

      {loadError && (
        <p className="rounded-sm bg-status-red-tint px-3 py-2 text-sm text-status-red">
          {loadError}
        </p>
      )}
      {!loadError && records === null && <p className="text-sm text-ink-500">Loading…</p>}
      {records !== null && records.length === 0 && !adding && (
        <p className="text-sm text-ink-500">No regulatory documents recorded for this branch.</p>
      )}

      {records !== null && records.length > 0 && (
        <ul className="flex flex-col divide-y divide-surface-border">
          {records.map((record) => (
            <RecordRow
              key={record.id}
              record={record}
              busyKey={busyKey}
              onAddFiles={(files) => addFiles(record, files)}
              onView={(fileId) => void viewFile(record, fileId)}
              onRemoveFile={(fileId, name) => removeFile(record, fileId, name)}
              onRemove={() => removeRecord(record)}
            />
          ))}
        </ul>
      )}

      {actionError && (
        <p className="mt-3 rounded-sm bg-status-red-tint px-3 py-2 text-sm text-status-red">
          {actionError}
        </p>
      )}
    </div>
  );
}

function RecordRow({
  record,
  busyKey,
  onAddFiles,
  onView,
  onRemoveFile,
  onRemove,
}: {
  record: BranchRegulatoryRecord;
  busyKey: string | null;
  onAddFiles: (files: File[]) => void;
  onView: (fileId: string) => void;
  onRemoveFile: (fileId: string, name: string) => void;
  onRemove: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const uploading = busyKey === `add:${record.id}`;
  return (
    <li className="flex flex-col gap-2 py-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-ink-900">{record.document_type}</div>
          <div className="text-xs text-ink-500">
            {record.regulator_display}
            {record.number && <> · No. {record.number}</>}
          </div>
          <div className="text-xs text-ink-500">
            Issued {formatDate(record.issued_on)} · Valid until {formatDate(record.valid_until)}
          </div>
        </div>
        <ExpiryPill record={record} />
      </div>

      {record.files.length === 0 ? (
        <p className="text-xs text-ink-500">No files. Add the document below.</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {record.files.map((file) => (
            <li key={file.id} className="flex items-center justify-between gap-2 text-sm">
              <span className="min-w-0 truncate text-ink-900">
                {file.original_name}{" "}
                <span className="text-xs text-ink-500">({formatSize(file.size)})</span>
              </span>
              <span className="flex flex-none items-center gap-3">
                <button
                  type="button"
                  className={LINK_BUTTON}
                  disabled={busyKey === `view:${file.id}`}
                  onClick={() => onView(file.id)}
                >
                  View
                </button>
                <button
                  type="button"
                  className={LINK_BUTTON}
                  disabled={busyKey === `file:${file.id}`}
                  onClick={() => onRemoveFile(file.id, file.original_name)}
                >
                  Remove
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={REGULATORY_FILE_ACCEPT}
          className="hidden"
          onChange={(e) => {
            const chosen = Array.from(e.target.files ?? []);
            e.target.value = "";
            onAddFiles(chosen);
          }}
        />
        <button
          type="button"
          className={SMALL_BUTTON}
          disabled={uploading}
          onClick={() => inputRef.current?.click()}
        >
          {uploading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Upload className="h-3.5 w-3.5" />
          )}
          {uploading ? "Uploading…" : "Add files"}
        </button>
        <button
          type="button"
          className={SMALL_BUTTON}
          disabled={busyKey === `record:${record.id}`}
          onClick={onRemove}
        >
          Remove document
        </button>
      </div>
    </li>
  );
}
