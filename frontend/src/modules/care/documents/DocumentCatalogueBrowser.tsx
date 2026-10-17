import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Search } from "lucide-react";
import { useAuth } from "../../../auth/useAuth";
import { ApiError } from "../../../lib/apiClient";
import {
  getDocumentCatalogue,
  listGeneratedDocuments,
  type Catalogue,
  type GeneratedDocumentRow,
} from "../../../lib/documentsApi";
import { EmptyState } from "../../../components/EmptyState";
import { formatDateTime } from "../shared/format";
import { BTN_GHOST, BTN_SM, INPUT, TABLE, TD, TH } from "../shared/styles";
import { Card, ErrorNote, Tag } from "../shared/ui";

// DOC-UX: Documents → Select Category → Select Document → generate draft.
// Search covers every document by name and tag (DOC-UX-02); each document
// still lives in exactly one category (DOC-UX-01).

export function DocumentCatalogueBrowser() {
  const { accessToken } = useAuth();
  const [params, setParams] = useSearchParams();
  const category = params.get("category") ?? "";
  const [query, setQuery] = useState("");
  const [data, setData] = useState<Catalogue | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!accessToken) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      getDocumentCatalogue(accessToken, query.trim(), query.trim() ? "" : category)
        .then((result) => !cancelled && setData(result))
        .catch(
          (err) =>
            !cancelled &&
            setError(err instanceof ApiError ? err.message : "Couldn't load the catalogue."),
        );
    }, 200);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [accessToken, category, query]);

  const choose = (code: string) => {
    setQuery("");
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      if (code) next.set("category", code);
      else next.delete("category");
      return next;
    });
  };
  const showList = Boolean(category || query.trim());
  const categoryName = data?.categories.find((c) => c.code === category)?.name;

  return (
    <Card
      title={
        showList
          ? query.trim()
            ? "Search results"
            : (categoryName ?? "Documents")
          : "Generate a document"
      }
      aside={
        <Tag>
          {data ? `${data.total} document types · ${data.categories.length} categories` : "…"}
        </Tag>
      }
    >
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[240px] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-ink-400" />
          <input
            className={`${INPUT} pl-8`}
            placeholder="Search all documents by name or tag…"
            aria-label="Search documents"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        {showList && (
          <button type="button" className={`${BTN_GHOST} ${BTN_SM}`} onClick={() => choose("")}>
            All categories
          </button>
        )}
      </div>
      {error && <ErrorNote>{error}</ErrorNote>}

      {!showList && data && (
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
          {data.categories.map((c) => (
            <button
              key={c.code}
              type="button"
              onClick={() => choose(c.code)}
              className="flex items-center justify-between rounded-lg border border-surface-border bg-surface-bg px-4 py-3 text-left transition-colors hover:border-brand-green"
            >
              <span className="text-[13px] font-semibold text-ink-900">{c.name}</span>
              <span className="text-[11px] text-ink-500">{c.count}</span>
            </button>
          ))}
        </div>
      )}

      {showList && data && (
        <ul className="flex flex-col divide-y divide-surface-border">
          {data.results.length === 0 && <EmptyState title="No documents match that search" />}
          {data.results.map((t) => (
            <li
              key={t.documentId}
              className="flex flex-wrap items-center justify-between gap-2 py-2.5"
            >
              <div className="min-w-0">
                <div className="text-[13px] font-semibold text-ink-900">
                  {t.name}{" "}
                  <span className="font-mono text-[11px] font-normal text-ink-500">
                    {t.documentId}
                  </span>
                </div>
                <div className="text-[12px] text-ink-500">
                  {query.trim() && `${t.categoryName} · `}
                  {t.trigger}
                </div>
                <div className="mt-1 flex flex-wrap gap-1">
                  {t.highRisk && <Tag tone="risk">High-risk · mandatory review</Tag>}
                  {t.contentStatus === "VERIFY" && <Tag tone="warn">Needs approved wording</Tag>}
                </div>
              </div>
              {t.can_generate ? (
                <Link
                  to={`/clinical/documents/new/${t.documentId}`}
                  className={`${BTN_GHOST} ${BTN_SM}`}
                >
                  Generate
                </Link>
              ) : (
                <span className="text-[11.5px] text-ink-500">Not available to your role</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export function GeneratedDocumentsCard() {
  const { accessToken } = useAuth();
  const [params] = useSearchParams();
  const patient = params.get("patient") ?? undefined;
  const [rows, setRows] = useState<GeneratedDocumentRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!accessToken) return;
    let cancelled = false;
    listGeneratedDocuments(accessToken, patient)
      .then((data) => !cancelled && setRows(data.results))
      .catch(
        (err) =>
          !cancelled &&
          setError(err instanceof ApiError ? err.message : "Couldn't load documents."),
      );
    return () => {
      cancelled = true;
    };
  }, [accessToken, patient]);

  return (
    <Card
      title={patient ? "This client's generated documents" : "Generated documents"}
      aside={<Tag>{`${rows?.length ?? 0}`}</Tag>}
      bodyClassName="p-0"
    >
      {error && (
        <div className="p-3">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className={`${TABLE} min-w-[720px]`} aria-label="Generated documents">
          <thead>
            <tr>
              <th className={TH}>Document</th>
              <th className={TH}>Client</th>
              <th className={TH}>Status</th>
              <th className={TH}>Generated</th>
              <th className={TH}>
                <span className="sr-only">Open</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows && rows.length === 0 && (
              <tr>
                <td colSpan={5}>
                  <EmptyState title="No generated documents yet">
                    Choose a category above to generate one.
                  </EmptyState>
                </td>
              </tr>
            )}
            {(rows ?? []).map((row) => (
              <tr key={row.id} className="hover:bg-surface-bg">
                <td className={TD}>
                  <strong>{row.name}</strong>
                  <div className="font-mono text-[11px] text-ink-500">
                    {row.document_number} · v{row.version}
                  </div>
                </td>
                <td className={TD}>{row.patient_name}</td>
                <td className={TD}>
                  <Tag
                    tone={
                      row.status === "BLOCKED_CONSENT"
                        ? "risk"
                        : row.status === "DRAFT" || row.status === "IN_REVIEW"
                          ? "warn"
                          : "brand"
                    }
                  >
                    {row.status_label}
                  </Tag>
                </td>
                <td className={`${TD} whitespace-nowrap`}>
                  {formatDateTime(row.generated_at)}
                  <div className="text-[11px] text-ink-500">{row.author}</div>
                </td>
                <td className={TD}>
                  <Link
                    to={`/clinical/documents/generated/${row.id}`}
                    className={`${BTN_GHOST} ${BTN_SM}`}
                  >
                    Open
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
