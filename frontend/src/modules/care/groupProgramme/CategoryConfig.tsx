import { useState, type FormEvent, type ReactNode } from "react";
import { useAuth } from "../../../auth/useAuth";
import {
  addCareProgramme,
  addGroupCategory,
  modifyCareProgramme,
  modifyGroupCategory,
  setGroupCategoryProgrammes,
  type CareProgramme,
  type CareProgrammesPayload,
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
    <details className={DETAILS} open>
      <summary className={DETAILS_SUMMARY}>Session categories</summary>
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

/** Programmes (EpisodeOfCare.type) and session eligibility: which programmes a
 * category is open to. Org Admin only, enforced server-side; a category with
 * no programmes ticked is open to every client in care. */
export function ProgrammeConfig({
  categories,
  programmes,
  canConfigure,
  onCategories,
  onProgrammes,
}: {
  categories: GroupCategory[];
  programmes: CareProgramme[];
  canConfigure: boolean;
  onCategories: (payload: GroupCategoriesPayload) => void;
  onProgrammes: (payload: CareProgrammesPayload) => void;
}) {
  const { accessToken } = useAuth();
  const [newName, setNewName] = useState("");
  const [categoryCode, setCategoryCode] = useState("");
  const [picked, setPicked] = useState<string[] | null>(null);
  const [status, setStatus] = useState("");
  const [saving, setSaving] = useState(false);
  const selectedCode = categoryCode || categories[0]?.code || "";
  const selected = categories.find((c) => c.code === selectedCode);
  const chosen = picked ?? selected?.programmes ?? [];

  function run<T>(request: Promise<T>, apply: (payload: T) => void, message: string) {
    setSaving(true);
    setStatus("");
    request
      .then((payload) => {
        apply(payload);
        setStatus(message);
      })
      .catch((err) =>
        setStatus(err instanceof ApiError ? err.message : "The change could not be saved."),
      )
      .finally(() => setSaving(false));
  }

  const add = (event: FormEvent) => {
    event.preventDefault();
    const name = newName.trim();
    if (!accessToken) return;
    if (!name) return setStatus("Enter a programme name.");
    run(
      addCareProgramme(accessToken, name),
      (payload) => {
        onProgrammes(payload);
        setNewName("");
      },
      "Programme added.",
    );
  };

  const toggleActive = (programme: CareProgramme) => {
    if (!accessToken) return;
    run(
      modifyCareProgramme(accessToken, programme.code, { active: !programme.active }),
      onProgrammes,
      programme.active ? "Programme retired." : "Programme restored.",
    );
  };

  const saveEligibility = (event: FormEvent) => {
    event.preventDefault();
    if (!accessToken || !selectedCode) return;
    run(
      setGroupCategoryProgrammes(accessToken, selectedCode, chosen),
      (payload) => {
        onCategories(payload);
        setPicked(null);
      },
      "Session eligibility saved.",
    );
  };

  return (
    <details className={DETAILS} open>
      <summary className={DETAILS_SUMMARY}>Programmes and session eligibility</summary>
      <div className="grid gap-2.5 p-4">
        <p className={NOTE}>
          {canConfigure
            ? "A client’s programme is set on their episode of care. Limit a category to programmes to list only their clients as eligible; with none ticked, every client in care is eligible."
            : "Only an administrator can change programmes or session eligibility."}
        </p>
        <div className={NOTE}>
          Programmes:{" "}
          {programmes.length
            ? programmes.map((p) => (p.active ? p.display : `${p.display} (retired)`)).join(" · ")
            : "none yet"}
        </div>
        {canConfigure && (
          <>
            <form className="flex flex-wrap items-end gap-2" onSubmit={add} noValidate>
              <PlainField label="New programme" htmlFor="group-new-programme">
                <input
                  id="group-new-programme"
                  type="text"
                  maxLength={100}
                  className={INPUT}
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                />
              </PlainField>
              <button type="submit" className={`${BTN} ${BTN_SM}`} disabled={saving}>
                Add programme
              </button>
            </form>
            {programmes.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {programmes.map((p) => (
                  <button
                    key={p.code}
                    type="button"
                    className={`${BTN_GHOST} ${BTN_SM}`}
                    disabled={saving}
                    onClick={() => toggleActive(p)}
                  >
                    {p.active ? `Retire ${p.display}` : `Restore ${p.display}`}
                  </button>
                ))}
              </div>
            )}
            {programmes.length > 0 && (
              <form className="grid gap-2" onSubmit={saveEligibility} noValidate>
                <PlainField label="Category" htmlFor="group-eligibility-category">
                  <select
                    id="group-eligibility-category"
                    className={INPUT}
                    value={selectedCode}
                    onChange={(e) => {
                      setCategoryCode(e.target.value);
                      setPicked(null);
                    }}
                  >
                    {categories.map((c) => (
                      <option key={c.code} value={c.code}>
                        {c.display}
                      </option>
                    ))}
                  </select>
                </PlainField>
                <fieldset className="flex flex-wrap gap-3 text-[13px]">
                  <legend className="mb-1 text-[13px] text-ink-900">Open to</legend>
                  {programmes
                    .filter((p) => p.active || chosen.includes(p.code))
                    .map((p) => (
                      <label key={p.code} className="flex items-center gap-1.5">
                        <input
                          type="checkbox"
                          checked={chosen.includes(p.code)}
                          onChange={(e) =>
                            setPicked(
                              e.target.checked
                                ? [...chosen, p.code]
                                : chosen.filter((c) => c !== p.code),
                            )
                          }
                        />
                        {p.display}
                      </label>
                    ))}
                </fieldset>
                <span className={NOTE}>
                  {chosen.length ? "" : "No programme ticked: open to every client in care."}
                </span>
                <div>
                  <button type="submit" className={`${BTN_GHOST} ${BTN_SM}`} disabled={saving}>
                    Save eligibility
                  </button>
                </div>
              </form>
            )}
          </>
        )}
        <div role="status" aria-live="polite" className={NOTE}>
          {status}
        </div>
      </div>
    </details>
  );
}
