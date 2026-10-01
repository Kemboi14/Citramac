import { useMemo, useState, type CSSProperties } from "react";
import { AlertTriangle, CheckCircle2, ChevronDown, Moon, RotateCcw, Sun, Wand2 } from "lucide-react";
import {
  CONTRAST_CHECKS,
  contrastRatio,
  isHexColor,
  paletteFromBrand,
  resolvePalette,
  scopedThemeVars,
  THEME_PRESETS,
  THEME_TOKENS,
  TOKEN_GROUPS,
  type ThemeMode,
  type ThemeOverrides,
  type ThemePalette,
  type TokenDef,
} from "./themeTokens";

/*
 * Shared editor for every color in the app — used by Super Admin's
 * platform theme (PlatformDashboardPage), Super Admin's per-organization
 * drawer (OrganizationsPage) and Org Admin's Branch Settings. Controlled:
 * the parent owns `value` (the overrides that will be saved) and the Save
 * button; this component never touches the live app theme, so nothing
 * changes for anyone until the parent saves.
 *
 * `baseline` is what an un-overridden token falls back to *before* the
 * stock tokens.css default — the platform theme, when editing an org.
 */

const LABEL_CLASS = "text-[11px] font-semibold uppercase tracking-wide text-ink-500";

function withoutKey(palette: ThemePalette | undefined, key: string): ThemePalette {
  const next = { ...palette };
  delete next[key];
  return next;
}

function setMode(value: ThemeOverrides, mode: ThemeMode, palette: ThemePalette): ThemeOverrides {
  const next = { ...value };
  if (Object.keys(palette).length) next[mode] = palette;
  else delete next[mode];
  return next;
}

/** Keep only status keys (which an org-scoped preset/generator must not touch). */
function statusOnly(palette: ThemePalette | undefined): ThemePalette {
  return Object.fromEntries(
    Object.entries(palette ?? {}).filter(([key]) => THEME_TOKENS.find((t) => t.key === key)?.platformOnly),
  );
}

export function ThemeEditor({
  value,
  onChange,
  allowStatus,
  baseline = {},
  baselineLabel = "CITRAMAC default",
}: {
  value: ThemeOverrides;
  onChange: (next: ThemeOverrides) => void;
  allowStatus: boolean;
  baseline?: ThemeOverrides;
  baselineLabel?: string;
}) {
  const [mode, setModeTab] = useState<ThemeMode>("light");
  const [openGroups, setOpenGroups] = useState<Set<string>>(() => new Set(["brand", "sidebar"]));
  const [seed, setSeed] = useState("#1d5fa8");

  const tokens = THEME_TOKENS.filter((t) => allowStatus || !t.platformOnly);
  const overrides = value[mode] ?? {};
  const inherited = useMemo(() => resolvePalette(mode, baseline[mode]), [mode, baseline]);
  const effectiveOverrides = useMemo(
    () => ({ ...baseline[mode], ...value[mode] }),
    [mode, baseline, value],
  );
  const resolved = useMemo(() => resolvePalette(mode, effectiveOverrides), [mode, effectiveOverrides]);
  const overriddenCount = (m: ThemeMode) => Object.keys(value[m] ?? {}).length;

  const setToken = (key: string, color: string) =>
    onChange(setMode(value, mode, { ...overrides, [key]: color.toLowerCase() }));
  const resetToken = (key: string) => onChange(setMode(value, mode, withoutKey(overrides, key)));

  const applyPreset = (preset: ThemeOverrides) => {
    // A preset replaces every brand/surface choice but never clears the
    // platform's status colors — those are a separate, safety-led decision.
    const keepStatus = (m: ThemeMode) => (allowStatus ? statusOnly(value[m]) : {});
    let next: ThemeOverrides = {};
    next = setMode(next, "light", { ...preset.light, ...keepStatus("light") });
    next = setMode(next, "dark", { ...preset.dark, ...keepStatus("dark") });
    onChange(next);
  };

  const generateFromBrand = () => {
    if (!isHexColor(seed)) return;
    let next = setMode(value, "light", { ...value.light, ...paletteFromBrand("light", seed) });
    next = setMode(next, "dark", { ...next.dark, ...paletteFromBrand("dark", seed) });
    onChange(next);
  };

  const toggleGroup = (id: string) =>
    setOpenGroups((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const checks = CONTRAST_CHECKS.filter(
    (c) => allowStatus || !(c.fg === "danger" || c.fg === "on_status" || c.bg === "danger"),
  ).map((c) => {
    const ratio = contrastRatio(resolved[c.fg] ?? "#000000", resolved[c.bg] ?? "#ffffff");
    return { ...c, ratio, ok: ratio >= c.min };
  });
  const failing = checks.filter((c) => !c.ok).length;

  return (
    <div className="flex flex-col gap-5">
      {/* Presets */}
      <div>
        <div className={`${LABEL_CLASS} mb-2`}>Start from a preset</div>
        <div className="flex flex-wrap gap-2">
          {THEME_PRESETS.map((preset) => {
            const light = resolvePalette("light", { ...baseline.light, ...preset.overrides.light });
            return (
              <button
                key={preset.id}
                type="button"
                onClick={() => applyPreset(preset.overrides)}
                className="flex items-center gap-2 rounded-full border border-surface-border bg-surface-card py-1.5 pl-1.5 pr-3 text-xs font-medium text-ink-700 transition-colors duration-150 hover:border-brand-green hover:bg-surface-bg"
              >
                <span className="flex overflow-hidden rounded-full border border-surface-border">
                  {[light.primary, light.sidebar_top, light.chart_2].map((c, i) => (
                    <span key={i} className="h-5 w-3" style={{ background: c }} />
                  ))}
                </span>
                {preset.name}
              </button>
            );
          })}
        </div>
      </div>

      {/* Generate */}
      <div className="flex flex-wrap items-end gap-3 rounded-md border border-dashed border-surface-border bg-surface-bg p-3">
        <label className="flex flex-col gap-1">
          <span className={LABEL_CLASS}>Your brand color</span>
          <span className="flex items-center gap-2">
            <input
              type="color"
              value={isHexColor(seed) ? seed : "#000000"}
              onChange={(e) => setSeed(e.target.value)}
              className="h-9 w-12 cursor-pointer rounded-sm border border-surface-border bg-surface-card p-1"
              aria-label="Brand color"
            />
            <HexInput value={seed} onCommit={setSeed} />
          </span>
        </label>
        <button
          type="button"
          onClick={generateFromBrand}
          className="inline-flex items-center gap-1.5 rounded-md border border-surface-border bg-surface-card px-3 py-2 text-xs font-semibold text-ink-700 transition-colors duration-150 hover:bg-surface-bg"
        >
          <Wand2 size={14} className="text-brand-green" />
          Generate light &amp; dark palettes
        </button>
        <p className="w-full text-[11px] text-ink-500 sm:w-auto sm:flex-1">
          Fills brand, sidebar and chart colors for both modes from one color. Surfaces, text
          {allowStatus ? " and status colors" : ""} keep their current values.
        </p>
      </div>

      {/* Mode tabs */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex overflow-hidden rounded-md border border-surface-border">
          {(["light", "dark"] as ThemeMode[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setModeTab(m)}
              className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 text-sm font-semibold transition-colors ${
                mode === m ? "bg-brand-green text-on-primary" : "bg-surface-card text-ink-700 hover:bg-surface-bg"
              }`}
            >
              {m === "light" ? <Sun size={14} /> : <Moon size={14} />}
              {m === "light" ? "Light mode" : "Dark mode"}
              {overriddenCount(m) > 0 && (
                <span className="rounded-full bg-surface-bg px-1.5 text-[10px] font-bold text-ink-700">
                  {overriddenCount(m)}
                </span>
              )}
            </button>
          ))}
        </div>
        {overriddenCount(mode) > 0 && (
          <button
            type="button"
            onClick={() => onChange(setMode(value, mode, {}))}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-ink-500 hover:text-ink-900"
          >
            <RotateCcw size={13} />
            Reset all {mode} colors to {baselineLabel}
          </button>
        )}
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(300px,380px)]">
        {/* Token groups */}
        <div className="flex flex-col gap-2.5">
          {TOKEN_GROUPS.map((group) => {
            const groupTokens = tokens.filter((t) => t.group === group.id);
            if (!groupTokens.length) return null;
            const open = openGroups.has(group.id);
            const changed = groupTokens.filter((t) => overrides[t.key]).length;
            return (
              <div key={group.id} className="rounded-md border border-surface-border bg-surface-card">
                <button
                  type="button"
                  onClick={() => toggleGroup(group.id)}
                  className="flex w-full items-center gap-3 px-3.5 py-2.5 text-left"
                  aria-expanded={open}
                >
                  <span className="flex -space-x-1">
                    {groupTokens.slice(0, 5).map((t) => (
                      <span
                        key={t.key}
                        className="h-4 w-4 rounded-full border border-surface-border"
                        style={{ background: resolved[t.key] }}
                      />
                    ))}
                  </span>
                  <span className="flex-1 text-sm font-semibold text-ink-900">{group.label}</span>
                  {changed > 0 && (
                    <span className="rounded-full bg-brand-green-tint px-2 py-0.5 text-[10px] font-bold text-brand-green-dark">
                      {changed} changed
                    </span>
                  )}
                  {group.id === "status" && (
                    <span className="rounded-full bg-status-amber-tint px-2 py-0.5 text-[10px] font-bold text-status-amber">
                      Platform-wide
                    </span>
                  )}
                  <ChevronDown
                    size={15}
                    className={`text-ink-400 transition-transform duration-150 ${open ? "rotate-180" : ""}`}
                  />
                </button>
                {open && (
                  <div className="border-t border-surface-border">
                    {group.id === "status" && (
                      <p className="flex gap-2 bg-status-amber-tint px-3.5 py-2 text-[11.5px] text-ink-700">
                        <AlertTriangle size={14} className="mt-0.5 flex-shrink-0 text-status-amber" />
                        Applies to every organization. Danger marks risk flags and allergies — keep it
                        unmistakably red-family and high-contrast so clinical alerts are never missed.
                      </p>
                    )}
                    {groupTokens.map((t) => (
                      <TokenRow
                        key={t.key}
                        token={t}
                        value={resolved[t.key]}
                        inheritedValue={inherited[t.key]}
                        overridden={Boolean(overrides[t.key])}
                        baselineLabel={baselineLabel}
                        onChange={(c) => setToken(t.key, c)}
                        onReset={() => resetToken(t.key)}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
          <p className="text-[11px] text-ink-400">
            Tints, hover states and shadows are derived automatically from these colors.
          </p>
        </div>

        {/* Preview + contrast */}
        <div className="flex flex-col gap-3 xl:sticky xl:top-20 xl:self-start">
          <div className={LABEL_CLASS}>Live preview · {mode} mode</div>
          <ThemePreview mode={mode} overrides={effectiveOverrides} />
          <div className="rounded-md border border-surface-border bg-surface-card p-3">
            <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-ink-900">
              {failing ? (
                <AlertTriangle size={15} className="text-status-amber" />
              ) : (
                <CheckCircle2 size={15} className="text-brand-green" />
              )}
              Readability
              <span className="ml-auto text-[11px] font-medium text-ink-500">
                {failing ? `${failing} below WCAG AA` : "All pairs pass WCAG AA"}
              </span>
            </div>
            <ul className="flex flex-col gap-1">
              {checks.map((c) => (
                <li key={c.label} className="flex items-center gap-2 text-[12px] text-ink-700">
                  <span
                    className="grid h-5 w-7 flex-shrink-0 place-items-center rounded-sm border border-surface-border text-[10px] font-bold"
                    style={{ background: resolved[c.bg], color: resolved[c.fg] }}
                  >
                    Aa
                  </span>
                  <span className="flex-1">{c.label}</span>
                  <span className={`font-mono text-[11px] ${c.ok ? "text-ink-500" : "font-bold text-status-red"}`}>
                    {c.ratio.toFixed(1)}:1
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

function HexInput({ value, onCommit }: { value: string; onCommit: (hex: string) => void }) {
  const [draft, setDraft] = useState(value);
  const [focused, setFocused] = useState(false);
  const shown = focused ? draft : value;
  const commit = (raw: string) => {
    const hex = raw.startsWith("#") ? raw : `#${raw}`;
    if (isHexColor(hex)) onCommit(hex.toLowerCase());
  };
  return (
    <input
      type="text"
      value={shown}
      spellCheck={false}
      maxLength={7}
      onFocus={() => {
        setDraft(value);
        setFocused(true);
      }}
      onChange={(e) => {
        setDraft(e.target.value);
        commit(e.target.value.trim());
      }}
      onBlur={() => setFocused(false)}
      className={`w-[5.5rem] rounded-sm border bg-surface-card px-2 py-1.5 font-mono text-xs text-ink-900 outline-none focus:border-brand-green ${
        focused && !isHexColor(draft.startsWith("#") ? draft : `#${draft}`)
          ? "border-status-red"
          : "border-surface-border"
      }`}
      aria-label="Hex color"
    />
  );
}

function TokenRow({
  token,
  value,
  inheritedValue,
  overridden,
  baselineLabel,
  onChange,
  onReset,
}: {
  token: TokenDef;
  value: string;
  inheritedValue: string;
  overridden: boolean;
  baselineLabel: string;
  onChange: (hex: string) => void;
  onReset: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-surface-border px-3.5 py-2.5 last:border-b-0">
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 w-11 flex-shrink-0 cursor-pointer rounded-sm border border-surface-border bg-surface-card p-1"
        aria-label={token.label}
      />
      <div className="min-w-[10rem] flex-1">
        <div className="text-[13px] font-medium text-ink-900">{token.label}</div>
        <div className="text-[11px] text-ink-500">{token.hint}</div>
      </div>
      <HexInput value={value} onCommit={onChange} />
      {overridden ? (
        <button
          type="button"
          onClick={onReset}
          title={`Reset to ${baselineLabel} (${inheritedValue})`}
          className="inline-flex w-[4.5rem] items-center justify-center gap-1 text-[11px] font-semibold text-ink-500 hover:text-ink-900"
        >
          <RotateCcw size={12} />
          Reset
        </button>
      ) : (
        <span className="w-[4.5rem] text-center text-[10.5px] text-ink-400">Default</span>
      )}
    </div>
  );
}

/** A miniature app shell rendered with the draft palette scoped to it. */
export function ThemePreview({ mode, overrides }: { mode: ThemeMode; overrides: ThemePalette }) {
  const style = {
    ...scopedThemeVars(mode, overrides),
    colorScheme: mode,
  } as CSSProperties;
  return (
    <div
      style={style}
      className="flex overflow-hidden rounded-md border border-surface-border bg-surface-bg text-ink-900 shadow-sm"
      aria-label="Theme preview"
    >
      <div
        className="flex w-[34%] flex-col gap-1 p-2.5 text-sidebar-text"
        style={{ backgroundImage: "linear-gradient(180deg, var(--sidebar-top) 0%, var(--sidebar-bottom) 100%)" }}
      >
        <div className="mb-1 flex items-center gap-1.5 border-b border-sidebar-divider pb-2">
          <span className="grid h-5 w-5 place-items-center rounded-sm bg-sidebar-active-bg text-[8px] font-bold text-sidebar-active-text">
            CT
          </span>
          <span className="font-display text-[11px] font-bold text-sidebar-text-strong">CITRAMAC</span>
        </div>
        <div className="px-1 text-[8px] font-bold uppercase tracking-wide text-sidebar-muted">Clinical</div>
        <div className="rounded-sm bg-sidebar-active-bg px-1.5 py-1 text-[10px] font-semibold text-sidebar-active-text">
          Dashboard
        </div>
        <div className="rounded-sm px-1.5 py-1 text-[10px]">Client Registry</div>
        <div className="rounded-sm bg-sidebar-hover px-1.5 py-1 text-[10px] text-sidebar-text-strong">Appointments</div>
        <div className="rounded-sm px-1.5 py-1 text-[10px]">Reports</div>
      </div>
      <div className="flex flex-1 flex-col gap-2 p-2.5">
        <div className="rounded-sm border border-surface-border bg-surface-card p-2.5 shadow-sm">
          <div className="font-display text-[12px] font-bold text-ink-900">Client overview</div>
          <div className="text-[10px] text-ink-700">Body text reads like this.</div>
          <div className="mb-2 text-[9.5px] text-ink-500">Muted helper text · <span className="text-brand-green">a link</span></div>
          <div className="mb-2 rounded-sm border border-surface-border bg-surface-card px-1.5 py-1 text-[9.5px] text-ink-400">
            Search clients…
          </div>
          <div className="flex flex-wrap gap-1">
            <span className="rounded-full bg-brand-green-tint px-1.5 py-0.5 text-[8.5px] font-bold text-brand-green-dark">Active</span>
            <span className="rounded-full bg-status-amber-tint px-1.5 py-0.5 text-[8.5px] font-bold text-status-amber">Pending</span>
            <span className="rounded-full bg-status-red-tint px-1.5 py-0.5 text-[8.5px] font-bold text-status-red">Allergy</span>
            <span className="rounded-full bg-accent-info-tint px-1.5 py-0.5 text-[8.5px] font-bold text-accent-info">Info</span>
            <span className="rounded-full bg-accent-violet-tint px-1.5 py-0.5 text-[8.5px] font-bold text-accent-violet">Group</span>
          </div>
        </div>
        <div className="flex items-end gap-1 rounded-sm border border-surface-border bg-surface-card p-2 shadow-sm">
          {[70, 45, 85, 30, 55, 40].map((h, i) => (
            <span
              key={i}
              className="flex-1 rounded-t-[2px]"
              style={{ height: `${h * 0.4}px`, background: `var(--chart-${i + 1})` }}
            />
          ))}
        </div>
        <div className="flex flex-wrap gap-1.5">
          <span className="rounded-sm bg-brand-green px-2 py-1 text-[10px] font-semibold text-on-primary shadow-sm">
            Save
          </span>
          <span className="rounded-sm bg-brand-green-dark px-2 py-1 text-[10px] font-semibold text-on-primary">
            Hover
          </span>
          <span className="rounded-sm border border-surface-border bg-surface-card px-2 py-1 text-[10px] font-semibold text-ink-700">
            Cancel
          </span>
          <span className="rounded-sm bg-status-red px-2 py-1 text-[10px] font-semibold text-on-status">
            Delete
          </span>
        </div>
      </div>
    </div>
  );
}
