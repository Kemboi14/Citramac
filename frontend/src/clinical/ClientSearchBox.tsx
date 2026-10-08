import { useId, useRef, useState, type Ref } from "react";
import { Search } from "lucide-react";
import type { RegistrationRow } from "../lib/carePathwayApi";
import { useClientSearch } from "./useClientSearch";

/**
 * A client search field with a results list: type to search, Up/Down to move,
 * Enter to choose, Esc to close. Announces the result count to screen readers.
 * `onChoose` decides what choosing means (select the client, open their record).
 */
export function ClientSearchBox({
  onChoose,
  placeholder = "Search clients by name, phone, ID or CITRAMAC number",
  label = "Search clients",
  inputRef,
  tone = "page",
  autoFocus = false,
}: {
  onChoose: (client: RegistrationRow) => void;
  placeholder?: string;
  label?: string;
  inputRef?: Ref<HTMLInputElement>;
  /** "brand" is the dark topbar field; "page" sits on a card. */
  tone?: "page" | "brand";
  autoFocus?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const search = useClientSearch(query);
  const listId = useId();
  const wrapRef = useRef<HTMLDivElement>(null);

  const results = search.status === "done" ? search.results.slice(0, 8) : [];
  const open = !dismissed && search.status !== "idle";
  const optionId = (index: number) => `${listId}-option-${index}`;

  const choose = (client: RegistrationRow) => {
    onChoose(client);
    setQuery("");
    setActive(0);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" && results.length) {
      event.preventDefault();
      setDismissed(false);
      setActive((i) => Math.min(i + 1, results.length - 1));
    } else if (event.key === "ArrowUp" && results.length) {
      event.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      // Results at this index may belong to an older query while a new one loads.
      const chosen = results.at(active);
      if (chosen && search.status === "done") choose(chosen);
    } else if (event.key === "Escape" && open) {
      event.stopPropagation();
      setDismissed(true);
    }
  };

  const brand = tone === "brand";
  const inputClass = brand
    ? "h-9 w-full rounded-lg border border-sidebar-divider bg-sidebar-hover pl-8 pr-3 text-[12.5px] text-sidebar-text-strong outline-none placeholder:text-sidebar-muted focus:border-sidebar-muted"
    : "w-full min-w-0 rounded-lg border border-surface-border bg-surface-bg py-2 pl-8 pr-2.5 text-[13px] text-ink-900 outline-none focus:border-brand-green focus:bg-surface-card";

  return (
    <div
      ref={wrapRef}
      className="relative w-full"
      onBlur={(event) => {
        if (!wrapRef.current?.contains(event.relatedTarget as Node | null)) setDismissed(true);
      }}
    >
      <Search
        aria-hidden="true"
        className={`pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 ${brand ? "text-sidebar-muted" : "text-ink-400"}`}
      />
      <input
        ref={inputRef}
        type="search"
        role="combobox"
        aria-label={label}
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && results.length ? optionId(active) : undefined}
        autoComplete="off"
        autoFocus={autoFocus}
        className={inputClass}
        placeholder={placeholder}
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setActive(0);
          setDismissed(false);
        }}
        onFocus={() => setDismissed(false)}
        onKeyDown={onKeyDown}
      />
      <div
        id={listId}
        role="listbox"
        aria-label="Matching clients"
        hidden={!open}
        className="absolute left-0 right-0 top-full z-50 mt-1 max-h-80 overflow-y-auto rounded-lg border border-surface-border bg-surface-card py-1 text-ink-900 shadow-md"
      >
        {search.status === "loading" && (
          <div className="px-3 py-2 text-[12.5px] text-ink-500">Searching…</div>
        )}
        {search.status === "error" && (
          <div role="alert" className="px-3 py-2 text-[12.5px] text-status-red">
            {search.message}
          </div>
        )}
        {search.status === "done" && results.length === 0 && (
          <div className="px-3 py-2 text-[12.5px] text-ink-500">No matching client found.</div>
        )}
        {results.map((client, index) => (
          <div
            key={client.id}
            id={optionId(index)}
            role="option"
            aria-selected={index === active}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => choose(client)}
            onMouseEnter={() => setActive(index)}
            className={`cursor-pointer px-3 py-2 text-[13px] ${index === active ? "bg-brand-green-tint" : ""}`}
          >
            <div className="font-semibold">{client.name || "Temporary client (unnamed)"}</div>
            <div className="text-[11.5px] text-ink-500">
              {[client.citramac_number, client.date_of_birth, client.identity_label]
                .filter(Boolean)
                .join(" · ")}
            </div>
          </div>
        ))}
      </div>
      <span className="sr-only" role="status" aria-live="polite">
        {search.status === "done"
          ? `${search.results.length} ${search.results.length === 1 ? "client" : "clients"} found`
          : ""}
      </span>
    </div>
  );
}
