import tokensCss from "./tokens.css?raw";

/*
 * Registry of every user-editable color token. Keys are the JSON keys stored
 * in PlatformBranding.theme_overrides / Organization.theme_overrides and
 * must match backend/apps/tenancy/theme.py exactly (ORG_THEME_KEYS /
 * STATUS_THEME_KEYS). Default values are not repeated here — they are read
 * from tokens.css (the authoritative token file) so the two can't drift.
 */

export type ThemeMode = "light" | "dark";
export type ThemePalette = Partial<Record<string, string>>;
export interface ThemeOverrides {
  light?: ThemePalette;
  dark?: ThemePalette;
}

export type TokenGroup = "brand" | "sidebar" | "surfaces" | "text" | "accents" | "charts" | "status";

export interface TokenDef {
  key: string;
  cssVar: string;
  label: string;
  hint: string;
  group: TokenGroup;
  /** Only Super Admin's platform theme may set these — never an organization. */
  platformOnly?: boolean;
}

export const TOKEN_GROUPS: { id: TokenGroup; label: string }[] = [
  { id: "brand", label: "Brand" },
  { id: "sidebar", label: "Sidebar" },
  { id: "surfaces", label: "Surfaces" },
  { id: "text", label: "Text" },
  { id: "accents", label: "Accents" },
  { id: "charts", label: "Charts" },
  { id: "status", label: "Status" },
];

export const THEME_TOKENS: TokenDef[] = [
  { key: "primary", cssVar: "--green", label: "Primary", hint: "Buttons, links, focus rings, active states", group: "brand" },
  { key: "primary_dark", cssVar: "--green-dark", label: "Secondary", hint: "Button hover, headings accent, KPI numbers", group: "brand" },
  { key: "on_primary", cssVar: "--on-green", label: "Text on primary", hint: "Text and icons on primary buttons", group: "brand" },

  { key: "sidebar_top", cssVar: "--sidebar-top", label: "Background (top)", hint: "Sidebar gradient start", group: "sidebar" },
  { key: "sidebar_bottom", cssVar: "--sidebar-bottom", label: "Background (bottom)", hint: "Sidebar gradient end", group: "sidebar" },
  { key: "sidebar_text", cssVar: "--sidebar-text", label: "Link text", hint: "Navigation labels", group: "sidebar" },
  { key: "sidebar_text_strong", cssVar: "--sidebar-text-strong", label: "Strong text", hint: "Hovered links, your name, hover/divider tint", group: "sidebar" },
  { key: "sidebar_muted", cssVar: "--sidebar-muted", label: "Muted text", hint: "Section headings, role, badges", group: "sidebar" },
  { key: "sidebar_active_bg", cssVar: "--sidebar-active-bg", label: "Active item", hint: "Background of the current page's link", group: "sidebar" },
  { key: "sidebar_active_text", cssVar: "--sidebar-active-text", label: "Active item text", hint: "Text of the current page's link", group: "sidebar" },

  { key: "bg", cssVar: "--bg", label: "Page background", hint: "Behind cards and panels", group: "surfaces" },
  { key: "card", cssVar: "--card", label: "Card / panel", hint: "Cards, tables, modals, inputs", group: "surfaces" },
  { key: "border", cssVar: "--border", label: "Borders", hint: "Hairlines around cards, rows and inputs", group: "surfaces" },
  { key: "scrim", cssVar: "--scrim", label: "Backdrop", hint: "Dimmed overlay behind modals and drawers", group: "surfaces" },
  { key: "shadow", cssVar: "--shadow-color", label: "Shadow", hint: "Card and popover shadows", group: "surfaces" },

  { key: "ink_900", cssVar: "--ink-900", label: "Headings", hint: "Primary text and headings", group: "text" },
  { key: "ink_700", cssVar: "--ink-700", label: "Body", hint: "Secondary text and labels", group: "text" },
  { key: "ink_500", cssVar: "--ink-500", label: "Muted", hint: "Helper text and descriptions", group: "text" },
  { key: "ink_400", cssVar: "--ink-400", label: "Placeholder", hint: "Placeholders and disabled text", group: "text" },
  { key: "ink_300", cssVar: "--ink-300", label: "Subtle", hint: "Icons and borders on dark surfaces", group: "text" },

  { key: "info", cssVar: "--info", label: "Info (blue)", hint: "Informational highlights, calendar groups", group: "accents" },
  { key: "violet", cssVar: "--violet", label: "Highlight (violet)", hint: "Secondary highlights, calendar groups", group: "accents" },

  { key: "chart_1", cssVar: "--chart-1", label: "Series 1", hint: "First chart series and bars", group: "charts" },
  { key: "chart_2", cssVar: "--chart-2", label: "Series 2", hint: "Second chart series, bar highlight", group: "charts" },
  { key: "chart_3", cssVar: "--chart-3", label: "Series 3", hint: "Third chart series", group: "charts" },
  { key: "chart_4", cssVar: "--chart-4", label: "Series 4", hint: "Fourth chart series", group: "charts" },
  { key: "chart_5", cssVar: "--chart-5", label: "Series 5", hint: "Fifth chart series", group: "charts" },
  { key: "chart_6", cssVar: "--chart-6", label: "Series 6", hint: "Sixth chart series", group: "charts" },

  { key: "danger", cssVar: "--red", label: "Danger", hint: "Risk flags, allergies, destructive actions, errors", group: "status", platformOnly: true },
  { key: "warning", cssVar: "--amber", label: "Warning", hint: "Pending approvals, warnings, 'Soon' badges", group: "status", platformOnly: true },
  { key: "on_status", cssVar: "--on-status", label: "Text on status", hint: "Text on solid danger/warning fills", group: "status", platformOnly: true },
];

const TOKEN_BY_VAR = new Map(THEME_TOKENS.map((t) => [t.cssVar, t]));
export const TOKEN_BY_KEY = new Map(THEME_TOKENS.map((t) => [t.key, t]));

const HEX_RE = /^#[0-9a-fA-F]{6}$/;
export const isHexColor = (v: unknown): v is string => typeof v === "string" && HEX_RE.test(v);

// ---------------------------------------------------------------------------
// Defaults, parsed from tokens.css
// ---------------------------------------------------------------------------

/** A token's default is either a literal hex or "follow another token". */
export type DefaultValue = { hex: string } | { follows: string };

interface ParsedBlock {
  /** Every declaration in the block, in source order (including derived ones). */
  declarations: [string, string][];
}

function parseBlock(css: string, selector: string): ParsedBlock {
  const start = css.indexOf(selector);
  if (start === -1) throw new Error(`tokens.css: missing block ${selector}`);
  const open = css.indexOf("{", start);
  const close = css.indexOf("}", open);
  const body = css.slice(open + 1, close).replace(/\/\*[\s\S]*?\*\//g, "");
  const declarations: [string, string][] = [];
  for (const m of body.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
    declarations.push([m[1], m[2].trim()]);
  }
  return { declarations };
}

const LIGHT_BLOCK = parseBlock(tokensCss, ":root {");
const DARK_BLOCK = parseBlock(tokensCss, ':root[data-theme="dark"] {');

function defaultsFrom(block: ParsedBlock): Map<string, DefaultValue> {
  const out = new Map<string, DefaultValue>();
  for (const [cssVar, value] of block.declarations) {
    const token = TOKEN_BY_VAR.get(cssVar);
    if (!token) continue;
    if (isHexColor(value)) {
      out.set(token.key, { hex: value.toLowerCase() });
      continue;
    }
    const follow = /^var\((--[a-z0-9-]+)\)$/.exec(value);
    const target = follow && TOKEN_BY_VAR.get(follow[1]);
    if (target) out.set(token.key, { follows: target.key });
  }
  return out;
}

const DEFAULTS: Record<ThemeMode, Map<string, DefaultValue>> = {
  light: defaultsFrom(LIGHT_BLOCK),
  // Anything the dark block doesn't redeclare inherits the light default.
  dark: new Map([...defaultsFrom(LIGHT_BLOCK), ...defaultsFrom(DARK_BLOCK)]),
};

for (const t of THEME_TOKENS) {
  if (!DEFAULTS.light.has(t.key)) throw new Error(`tokens.css: no default for ${t.cssVar}`);
}

export function defaultFor(mode: ThemeMode, key: string): DefaultValue {
  return DEFAULTS[mode].get(key)!;
}

/** Resolve every token for a mode: override, else followed token, else default hex. */
export function resolvePalette(mode: ThemeMode, overrides: ThemePalette = {}): Record<string, string> {
  const out: Record<string, string> = {};
  const resolve = (key: string, depth = 0): string => {
    if (out[key]) return out[key];
    const override = overrides[key];
    let value: string;
    if (isHexColor(override)) value = override.toLowerCase();
    else {
      const def = defaultFor(mode, key);
      value = "hex" in def ? def.hex : depth > 4 ? "#000000" : resolve(def.follows, depth + 1);
    }
    out[key] = value;
    return value;
  };
  THEME_TOKENS.forEach((t) => resolve(t.key));
  return out;
}

/**
 * Every CSS custom property for a mode with the given overrides applied —
 * including derived ones (tints, hovers, shadows) verbatim from tokens.css.
 * Used to scope a full theme to one element (the editor's live preview),
 * where re-declaring the base variables alone wouldn't re-derive the tints
 * that tokens.css computes on :root.
 */
export function scopedThemeVars(mode: ThemeMode, overrides: ThemePalette = {}): Record<string, string> {
  const vars: Record<string, string> = {};
  const blocks = mode === "light" ? [LIGHT_BLOCK] : [LIGHT_BLOCK, DARK_BLOCK];
  for (const block of blocks) {
    for (const [cssVar, value] of block.declarations) vars[cssVar] = value;
  }
  for (const [key, value] of Object.entries(overrides)) {
    const token = TOKEN_BY_KEY.get(key);
    if (token && isHexColor(value)) vars[token.cssVar] = value;
  }
  return vars;
}

// ---------------------------------------------------------------------------
// Color math
// ---------------------------------------------------------------------------

type Rgb = [number, number, number];

export function hexToRgb(hex: string): Rgb {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex([r, g, b]: Rgb): string {
  return `#${[r, g, b].map((c) => Math.round(Math.min(255, Math.max(0, c))).toString(16).padStart(2, "0")).join("")}`;
}

/** Linear mix: weight 0 → a, 1 → b. */
export function mix(a: string, b: string, weight: number): string {
  const [ar, ag, ab] = hexToRgb(a);
  const [br, bg, bb] = hexToRgb(b);
  return rgbToHex([ar + (br - ar) * weight, ag + (bg - ag) * weight, ab + (bb - ab) * weight]);
}

/** WCAG 2.x relative luminance. */
function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Whichever of the two candidates reads better on `bg`. */
export function readableOn(bg: string, dark = "#0e1e1a", light = "#ffffff"): string {
  return contrastRatio(bg, light) >= contrastRatio(bg, dark) ? light : dark;
}

// ---------------------------------------------------------------------------
// Generate a coordinated palette from one brand color
// ---------------------------------------------------------------------------

/**
 * Brand-driven tokens only (brand, sidebar, accent chart series) — surfaces,
 * text and status keep their current values, since those carry legibility
 * and safety meaning a single hue can't decide.
 */
export function paletteFromBrand(mode: ThemeMode, brand: string): ThemePalette {
  if (mode === "light") {
    const primaryDark = mix(brand, "#000000", 0.27);
    const sidebarTop = primaryDark;
    return {
      primary: brand,
      primary_dark: primaryDark,
      on_primary: readableOn(brand),
      sidebar_top: sidebarTop,
      sidebar_bottom: mix(sidebarTop, "#000000", 0.22),
      sidebar_text: mix(brand, "#ffffff", 0.84),
      sidebar_text_strong: "#ffffff",
      sidebar_muted: mix(brand, "#ffffff", 0.55),
      sidebar_active_bg: mix(brand, "#ffffff", 0.92),
      sidebar_active_text: primaryDark,
      chart_2: mix(brand, "#ffffff", 0.3),
      chart_3: mix(brand, "#ffffff", 0.6),
    };
  }
  // Dark mode: lift the brand so it reads on a near-black card.
  const primary = contrastRatio(brand, "#10201b") >= 4.5 ? brand : mix(brand, "#ffffff", 0.45);
  const primaryDark = mix(primary, "#000000", 0.25);
  const sidebarTop = mix(brand, "#000000", 0.55);
  return {
    primary,
    primary_dark: primaryDark,
    on_primary: readableOn(primary, "#0b1512"),
    sidebar_top: sidebarTop,
    sidebar_bottom: mix(sidebarTop, "#000000", 0.3),
    sidebar_text: mix(brand, "#ffffff", 0.84),
    sidebar_text_strong: "#ffffff",
    sidebar_muted: mix(brand, "#ffffff", 0.55),
    sidebar_active_bg: mix(brand, "#ffffff", 0.9),
    sidebar_active_text: mix(brand, "#000000", 0.4),
    chart_2: mix(primary, "#10201b", 0.3),
    chart_3: mix(primary, "#ffffff", 0.45),
  };
}

export interface ThemePreset {
  id: string;
  name: string;
  /** Empty = the stock CITRAMAC palette. */
  overrides: ThemeOverrides;
}

const fromBrand = (id: string, name: string, brand: string): ThemePreset => ({
  id,
  name,
  overrides: { light: paletteFromBrand("light", brand), dark: paletteFromBrand("dark", brand) },
});

export const THEME_PRESETS: ThemePreset[] = [
  { id: "citramac", name: "CITRAMAC Green", overrides: {} },
  fromBrand("ocean", "Ocean Blue", "#1d5fa8"),
  fromBrand("teal", "Lagoon Teal", "#00737a"),
  fromBrand("indigo", "Indigo", "#4338ca"),
  fromBrand("plum", "Plum", "#7b2d8e"),
  fromBrand("terracotta", "Terracotta", "#b4532a"),
  fromBrand("graphite", "Graphite", "#3f4a54"),
];

// ---------------------------------------------------------------------------
// Contrast checks shown in the editor
// ---------------------------------------------------------------------------

export interface ContrastCheck {
  label: string;
  fg: string;
  bg: string;
  /** 4.5 for body text, 3 for large/bold text and UI components (WCAG AA). */
  min: number;
}

export const CONTRAST_CHECKS: ContrastCheck[] = [
  { label: "Headings on cards", fg: "ink_900", bg: "card", min: 4.5 },
  { label: "Body text on cards", fg: "ink_700", bg: "card", min: 4.5 },
  { label: "Muted text on cards", fg: "ink_500", bg: "card", min: 4.5 },
  { label: "Headings on page background", fg: "ink_900", bg: "bg", min: 4.5 },
  { label: "Primary button text", fg: "on_primary", bg: "primary", min: 4.5 },
  { label: "Primary links on cards", fg: "primary", bg: "card", min: 3 },
  { label: "Sidebar links", fg: "sidebar_text", bg: "sidebar_top", min: 4.5 },
  { label: "Sidebar links (bottom)", fg: "sidebar_text", bg: "sidebar_bottom", min: 4.5 },
  { label: "Sidebar active item", fg: "sidebar_active_text", bg: "sidebar_active_bg", min: 4.5 },
  { label: "Danger on cards", fg: "danger", bg: "card", min: 3 },
  { label: "Text on danger fills", fg: "on_status", bg: "danger", min: 3 },
];

/** Drop anything that isn't a known, allowed key with a hex value. */
export function sanitizeOverrides(value: unknown, allowStatus: boolean): ThemeOverrides {
  const out: ThemeOverrides = {};
  if (!value || typeof value !== "object") return out;
  const raw = value as Record<string, unknown>;
  for (const mode of ["light", "dark"] as const) {
    const palette = raw[mode];
    if (!palette || typeof palette !== "object") continue;
    const clean: ThemePalette = {};
    for (const [key, color] of Object.entries(palette as Record<string, unknown>)) {
      const token = TOKEN_BY_KEY.get(key);
      if (!token || !isHexColor(color) || (token.platformOnly && !allowStatus)) continue;
      clean[key] = color.toLowerCase();
    }
    if (Object.keys(clean).length) out[mode] = clean;
  }
  // Pre-light/dark shape ({primary, secondary}) — treated as light-mode values.
  if (isHexColor(raw.primary) || isHexColor(raw.secondary)) {
    out.light = {
      ...(isHexColor(raw.primary) ? { primary: raw.primary.toLowerCase() } : {}),
      ...(isHexColor(raw.secondary) ? { primary_dark: raw.secondary.toLowerCase() } : {}),
      ...out.light,
    };
  }
  return out;
}
