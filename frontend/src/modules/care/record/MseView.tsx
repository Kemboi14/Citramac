import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../../../auth/useAuth";
import { ApiError } from "../../../lib/apiClient";
import {
  getIntakeSchema,
  openIntakeDraft,
  saveIntakeDraft,
  type IntakeDraft,
  type IntakeSchema,
} from "../../../lib/carePathwayApi";
import { formatDateTime } from "../shared/format";
import { Callout, Card, ErrorNote, PageHeader, Tag } from "../shared/ui";
import { useAutosaveDraft } from "../shared/useAutosaveDraft";
import { useValueSets } from "../shared/useValueSets";
import { sectionValues, type SectionValues } from "./intake/fields";
import { MseSection } from "./intake/MseSection";
import type { RecordViewProps } from "./types";

function errorText(error: unknown, fallback: string) {
  return error instanceof ApiError ? error.message : fallback;
}

/** MSE — the one Mental Status Exam, on its own tab (shared with Intake). */
export function MseView({ patientId, onRecordChanged }: RecordViewProps) {
  const { accessToken } = useAuth();
  const [schema, setSchema] = useState<IntakeSchema | null>(null);
  const [draft, setDraft] = useState<IntakeDraft | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!accessToken) return;
    let cancelled = false;
    Promise.all([getIntakeSchema(accessToken), openIntakeDraft(accessToken, patientId)])
      .then(([s, d]) => {
        if (cancelled) return;
        setSchema(s);
        setDraft(d);
        setError(null);
      })
      .catch((e) => !cancelled && setError(errorText(e, "Couldn't load the MSE.")));
    return () => {
      cancelled = true;
    };
  }, [accessToken, patientId]);

  if (!schema || !draft) {
    return (
      <div>
        <PageHeader title="Mental state examination (MSE)" />
        {error ? (
          <ErrorNote>{error}</ErrorNote>
        ) : (
          <p className="text-[13px] text-ink-500">Loading MSE…</p>
        )}
      </div>
    );
  }

  return (
    <MseEditor
      key={draft.id}
      patientId={patientId}
      schema={schema}
      draft={draft}
      onRecordChanged={onRecordChanged}
    />
  );
}

function MseEditor({
  patientId,
  schema,
  draft,
  onRecordChanged,
}: {
  patientId: string;
  schema: IntakeSchema;
  draft: IntakeDraft;
  onRecordChanged: () => void;
}) {
  const { accessToken } = useAuth();
  const vs = useValueSets();
  const [values, setValues] = useState<SectionValues>(() =>
    sectionValues(draft.sections ?? {}, "mse"),
  );
  const signed = draft.status === "SIGNED";

  const save = useCallback(
    async (next: SectionValues) => {
      if (!accessToken) return;
      await saveIntakeDraft(accessToken, patientId, { sections: { mse: next } });
      onRecordChanged();
    },
    [accessToken, patientId, onRecordChanged],
  );
  const autosave = useAutosaveDraft({ value: values, save, enabled: !signed });

  const onChange = (key: string, value: unknown) =>
    setValues((prev) => ({ ...prev, [key]: value }));
  const onPatch = (patch: Record<string, unknown>) => setValues((prev) => ({ ...prev, ...patch }));

  const saveState = signed
    ? `Signed ${draft.signed_at ? formatDateTime(draft.signed_at) : ""}`
    : autosave.failed
      ? "Couldn't save — retrying…"
      : autosave.dirty
        ? "Saving…"
        : autosave.savedAt
          ? `Draft saved ${autosave.savedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
          : "Draft not yet saved";

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        eyebrow="Client record"
        title="Mental state examination (MSE)"
        subtitle="Records the mental state now. Shared with Intake — changes here update the same Mental Status Exam."
      />
      {signed && (
        <Callout tone="warning">
          This intake is signed and cannot be edited. Start a new version under Intake to update the
          MSE.
        </Callout>
      )}
      <Card
        title="Mental state examination (MSE)"
        aside={
          <Tag tone={signed ? "neutral" : "brand"}>
            v{draft.version} · {saveState}
          </Tag>
        }
      >
        <MseSection schema={schema} values={values} vs={vs} onChange={onChange} onPatch={onPatch} />
      </Card>
    </div>
  );
}
