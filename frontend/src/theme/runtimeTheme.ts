import {
  sanitizeOverrides,
  TOKEN_BY_KEY,
  type ThemeMode,
  type ThemeOverrides,
  type ThemePalette,
} from "./themeTokens";

/*
 * Applies the platform theme (PlatformBranding.theme_overrides) and, on top
 * of it, the signed-in user's organization theme (Organization.
 * theme_overrides) as one generated <style> element — not inline styles on
 * <html>, which would win over tokens.css's dark-mode blocks and paint the
 * light palette in dark mode.
 *
 * Selectors carry an extra `html` type selector so they outrank tokens.css
 * regardless of stylesheet order, while the light layer (0,1,1) still loses
 * to tokens.css's dark blocks (0,2,0) — a light-only override never leaks
 * into dark mode.
 *
 * Both layers are cached in localStorage so the next page load paints the
 * right colors immediately instead of flashing the stock palette. This is
 * presentation only — never clinical data (CLAUDE.md §5).
 */

const STYLE_ID = "citramac-theme-overrides";
const PLATFORM_CACHE_KEY = "citramac.theme.platform";
const ORG_CACHE_PREFIX = "citramac.theme.org.";

let platformLayer: ThemeOverrides = {};
let orgLayer: ThemeOverrides = {};

function declarations(palette: ThemePalette | undefined): string {
  return Object.entries(palette ?? {})
    .map(([key, value]) => {
      const token = TOKEN_BY_KEY.get(key);
      return token ? `${token.cssVar}:${value};` : "";
    })
    .join("");
}

export function buildThemeCss(overrides: ThemeOverrides): string {
  const light = declarations(overrides.light);
  const dark = declarations(overrides.dark);
  let css = "";
  if (light) css += `html:root{${light}}`;
  if (dark) {
    css +=
      `@media (prefers-color-scheme: dark){html:root:not([data-theme="light"]){${dark}}}` +
      `html:root[data-theme="dark"]{${dark}}`;
  }
  return css;
}

function merged(): ThemeOverrides {
  const out: ThemeOverrides = {};
  for (const mode of ["light", "dark"] as ThemeMode[]) {
    const palette = { ...platformLayer[mode], ...orgLayer[mode] };
    if (Object.keys(palette).length) out[mode] = palette;
  }
  return out;
}

function render() {
  if (typeof document === "undefined") return;
  let el = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement("style");
    el.id = STYLE_ID;
    document.head.appendChild(el);
  }
  el.textContent = buildThemeCss(merged());
}

function readCache(key: string): unknown {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeCache(key: string, value: ThemeOverrides | null) {
  try {
    if (value && (value.light || value.dark)) localStorage.setItem(key, JSON.stringify(value));
    else localStorage.removeItem(key);
  } catch {
    // Best-effort — without storage the theme just loads after the fetch.
  }
}

/** Platform baseline — may include status colors (Super Admin only). */
export function setPlatformTheme(overrides: unknown) {
  platformLayer = sanitizeOverrides(overrides, true);
  writeCache(PLATFORM_CACHE_KEY, platformLayer);
  render();
}

/** Organization layer — status colors are always stripped. `null` clears it. */
export function setOrganizationTheme(organizationId: string | null, overrides: unknown) {
  orgLayer = organizationId ? sanitizeOverrides(overrides, false) : {};
  if (organizationId) writeCache(ORG_CACHE_PREFIX + organizationId, orgLayer);
  render();
}

/** Called once at boot, before the first render. */
export function applyCachedPlatformTheme() {
  platformLayer = sanitizeOverrides(readCache(PLATFORM_CACHE_KEY), true);
  render();
}

/** Called when a signed-in shell mounts, before its own fetch resolves. */
export function applyCachedOrganizationTheme(organizationId: string) {
  orgLayer = sanitizeOverrides(readCache(ORG_CACHE_PREFIX + organizationId), false);
  render();
}
