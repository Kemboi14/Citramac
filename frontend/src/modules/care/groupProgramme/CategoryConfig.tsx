import { useState, type FormEvent, type ReactNode } from "react";
import { useAuth } from "../../../auth/useAuth";
import {
  addGroupCategory,
  modifyGroupCategory,
  type GroupCategoriesPayload,
  type GroupCategory,
} from "../../../lib/groupProgrammeApi";
import { ApiError } from "../../../lib/apiClient";
import { BTN, BTN_GHOST, BTN_SM, INPUT } from "../shared/styles";
import { DETAILS, DETAILS_SUMMARY, NOTE } from "./styles";

/** The mockup's `label.field` here: sentence-case label above the control. */
function PlainField({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: ReactNode;
}) {
  return (
    <label htmlFor={htmlFor} className="flex min-w-0 flex-col gap-1 text-[13px] text-ink-900">
      <span>{label}</span>
      {children}
    </label>
  );
}

/** The mockup's "Category configuration · administrator workflow". Changes are
 * restricted server-side to Org Admin; modifying changes the display only. */
export function CategoryConfig({
  categories,
  canConfigure,
  onChanged,
}: {
  categories: GroupCategory[];
  canConfigure: boolean;
  onChanged: (payload: GroupCategoriesPayload) => void;
}) {
  const { accessToken } = useAuth();
  const [newName, setNewName] = useState("");
  const [editCode, setEditCode] = useState("");
  const [editName, setEditName] = useState("");
  const [status, setStatus] = useState("");
  const [saving, setSaving] = useState(false);
  const selectedCode = editCode || categories[0]?.code || "";

  const run = (request: Promise<GroupCategoriesPayload>, done: () => void) => {
    setSaving(true);
    setStatus("");
    request
      .then((payload) => {
        onChanged(payload);
        done();
        setStatus("Category configuration saved.");
      })
      .catch((err) =>
        setStatus(err instanceof ApiError ? err.message : "The category could not be saved."),
      )
      .finally(() => setSaving(false));
  };

  const add = (event: FormEvent) => {
    event.preventDefault();
    const name = newName.trim();
    if (!accessToken) return;
    if (!name) return setStatus("Enter a category name.");
    if (categories.some((c) => c.display.toLowerCase() === name.toLowerCase())) {
      return setStatus("This category already exists.");
    }
    run(addGroupCategory(accessToken, name), () => setNewName(""));
  };

  const modify = (event: FormEvent) => {
    event.preventDefault();
    const name = editName.trim();
    if (!accessToken) return;
    if (
      !name ||
      categories.some(
        (c) => c.code !== selectedCode && c.display.toLowerCase() === name.toLowerCase(),
      )
    ) {
      return setStatus("Enter a unique category name.");
    }
    run(modifyGroupCategory(accessToken, selectedCode, name), () => setEditName(""));
  };

  return (
    <details className={DETAILS}>
      <summary className={DETAILS_SUMMARY}>Category configuration · administrator workflow</summary>
      <div className="grid gap-2.5 p-4">
        <p className={NOTE}>
          {canConfigure
            ? "Add an approved category. Changes are restricted to the administrator role; renaming changes the display only, and sessions already recorded keep their category."
            : "Only an administrator can add or modify session categories."}
        </p>
        {canConfigure && (
          <>
            <form className="flex flex-wrap items-end gap-2" onSubmit={add} noValidate>
              <PlainField label="New category" htmlFor="group-new-category">
                <input
                  id="group-new-category"
                  type="text"
                  maxLength={100}
                  className={INPUT}
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                />
              </PlainField>
              <button type="submit" className={`${BTN} ${BTN_SM}`} disabled={saving}>
                Add category
              </button>
            </form>
            <form className="flex flex-wrap items-end gap-2" onSubmit={modify} noValidate>
              <PlainField label="Category to modify" htmlFor="group-category-to-edit">
                <select
                  id="group-category-to-edit"
                  className={INPUT}
                  value={selectedCode}
                  onChange={(e) => setEditCode(e.target.value)}
                >
                  {categories.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.display}
                    </option>
                  ))}
                </select>
              </PlainField>
              <PlainField label="Updated category name" htmlFor="group-edited-category">
                <input
                  id="group-edited-category"
                  type="text"
                  maxLength={100}
                  className={INPUT}
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                />
              </PlainField>
              <button type="submit" className={`${BTN_GHOST} ${BTN_SM}`} disabled={saving}>
                Modify category
              </button>
            </form>
          </>
        )}
        <div className={NOTE}>Configured: {categories.map((c) => c.display).join(" · ")}</div>
        <div role="status" aria-live="polite" className={NOTE}>
          {status}
        </div>
      </div>
    </details>
  );
}
