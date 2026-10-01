# 03 — Design System (from the CITRAMAC mockups)

**This document is authoritative for all visual output.** It was extracted directly from the three approved mockups (`citramac_SUPER-ADMIN.html`, `citramac_ORG-admin.html`, `citramac_clinical_workspace.html`). Do not invent new colors, fonts, radii, or shadows. Every screen must reuse these tokens.

## 3.1 Color tokens (CSS custom properties)

The token file is `frontend/src/theme/tokens.css`; it is exposed to Tailwind via `tailwind.config.js` `extend.colors` (e.g. `bg-brand-green`, `text-ink-900`, `text-on-primary`, `bg-sidebar-active-bg`, `bg-chart-1`). **No component may hard-code a hex/rgb color or `text-white`** — every color comes from a token so the theme editor (§3.6) can change it.

`tokens.css` holds both palettes (light under `:root`, dark under `[data-theme="dark"]` and the `prefers-color-scheme` media query) and is also the single source of every default: `frontend/src/theme/themeTokens.ts` reads its raw text at build time, so "Reset to default" in the editor always restores what this file says.

| Group | Token (CSS var → theme key) | Light default | Dark default |
|---|---|---|---|
| Brand | `--green` → `primary` | `#006e51` | `#2bd39e` |
| | `--green-dark` → `primary_dark` | `#00503a` | `#1a9b74` |
| | `--on-green` → `on_primary` (text on brand fills) | `#ffffff` | `#04261c` |
| Sidebar | `--sidebar-top` / `--sidebar-bottom` → `sidebar_top` / `sidebar_bottom` | `#00503a` / `#003f2e` | same |
| | `--sidebar-text`, `--sidebar-text-strong`, `--sidebar-muted` | `#d6ede4`, `#ffffff`, `#8fc9b3` | same |
| | `--sidebar-active-bg` / `--sidebar-active-text` | `#eafaf4` / follows `--green-dark` | same |
| Surfaces | `--bg`, `--card`, `--border` | `#f5f8f7`, `#ffffff`, `#e2e9e6` | `#0b1512`, `#10201b`, `#23342e` |
| | `--scrim` → `scrim` (modal backdrop), `--shadow-color` → `shadow` | `#0e1e1a` | `#000000` |
| Text | `--ink-900` … `--ink-300` → `ink_900` … `ink_300` | `#0e1e1a` `#33453f` `#5f736c` `#8a9c96` `#b6c3bd` | `#f1f7f5` `#c7d6d1` `#94a8a1` `#6d827b` `#40514b` |
| Accents | `--info`, `--violet` | `#1a63c9`, `#6840a2` | `#6aa8ff`, `#b394f0` |
| Charts | `--chart-1` … `--chart-6` | follows `--green`, `#34a884`, `#9bcdb9`, `#b8790a`, `#fe0000`, `#5f736c` | follows `--green`, `#5fb89a`, `#9bcdb9`, `#ffb84d`, `#ff6b6a`, `#94a8a1` |
| Status (platform-only) | `--red` → `danger`, `--amber` → `warning`, `--on-status` → `on_status` | `#fe0000`, `#b8790a`, `#ffffff` | `#ff6b6a`, `#ffb84d`, `#1f0505` |

**Derived tokens — never set directly**: `--green-tint`, `--green-tint-2`, `--red-tint`, `--red-strong`, `--amber-tint`, `--info-tint`, `--violet-tint`, `--sidebar-hover`, `--sidebar-divider`, `--scrim-overlay`, `--shadow-sm`, `--shadow-md`. Each is a `color-mix()` of its base token (and `--card` for tints), so changing a base color in a theme updates every tint, hover and shadow automatically.

Radii (`--radius-lg/md/sm` = 16/12/8px) and fonts (`--font-display` Lexend, `--font-body` Inter) are unchanged.

### Color usage rules

| Token | Usage |
|---|---|
| `--green-dark` (with gradient to `#003f2e`) | Sidebar background (`linear-gradient(180deg, #00503a 0%, #003f2e 100%)`) |
| `--green` | Primary buttons, active nav indicators, links, focus rings |
| `--green-tint` / `--green-tint-2` | Selected row backgrounds, success badges, hover states |
| `--red` / `--red-tint` | Destructive actions, critical alerts, allergy flags, error states |
| `--amber` / `--amber-tint` | Warning states, pending approvals, "Soon"/coming-soon badges |
| `--ink-*` scale | All text — never use pure black; darkest text is `--ink-900` |
| `--bg` | Page background outside cards |
| `--card` | All panels, tables, modals |
| `--border` | 1px hairlines between rows, around inputs and cards |

**Do not** introduce blue, purple, or any hue outside this palette for primary UI chrome. `#fe0000`/red is reserved strictly for destructive/critical/allergy states — never used decoratively.

## 3.2 Typography

- **Display font:** `Lexend` (weights 400/500/600/700/800) — used for the app brand name, page titles, sidebar section labels, and large KPI numbers on dashboards.
- **Body font:** `Inter` (weights 400/500/600/700, plus italic) — used for everything else: table content, form fields, buttons, descriptions.
- Load both via Google Fonts `preconnect` + `stylesheet` link exactly as in the mockups, or self-host for production/offline resilience (recommended for production — see `09-SECURITY-COMPLIANCE.md` offline mode).

## 3.3 Layout shell pattern

All three tiers share one shell pattern — a fixed sidebar + scrollable content area + sticky topbar:

```css
.app { display: grid; grid-template-columns: 248px 1fr; min-height: 100vh; }

.sidebar {
  background: var(--green-dark);
  background-image: linear-gradient(180deg, #00503a 0%, #003f2e 100%);
  color: #eafaf4;
  display: flex; flex-direction: column;
  position: sticky; top: 0; height: 100vh;
  z-index: 40;
}
```

- **Sidebar** (248px fixed width): brand logo/name at top, then a vertically stacked, icon + label navigation list, grouped under section headers (e.g. "Platform" / "Governance" for Super Admin; "Facility" for Org Admin; "Core Clinical (DHA)" / "MHP Program" for Clinical Workspace). Modules not yet built show a small **"Soon"** badge (amber tint) rather than being hidden — this signals the full roadmap to users without exposing incomplete features.
- **Topbar**: global search input (rounded, green-tinted background, placeholder text like "Search Client Registration"), a refresh/sync icon, a dropdown chevron (tenant/branch switcher for multi-branch orgs), and a circular user avatar/initial badge on the far right.
- **Content area**: page title (Lexend, bold) top-left, primary action button top-right (e.g. green "+ Add" button with `--radius-md` corners), an export icon (PDF), a filter/funnel icon. Below: a data table or card grid on `--card` background with `--border` dividers, `--radius-lg` corners, `--shadow-sm`.

## 3.4 Component patterns to replicate

- **Buttons**: primary = solid `--green` background, white text, `--radius-md`, `--shadow-sm`, semibold Inter; secondary = white background, `--border` outline, `--ink-700` text; destructive = `--red` background or `--red-tint` background with `--red` text/icon.
- **Tables**: header row uses `--ink-700` bold small-caps-style label text on `--card`/`--green-tint-2` background; body rows alternate subtly or use hover-state `--green-tint`; status badges (e.g. "Active Allergies") are pill-shaped chips using the semantic tint colors.
- **Badges/chips**: pill shape (`border-radius: 999px`), tint background + saturated text of the same hue (e.g. amber-tint bg + amber text for "Pending"; red-tint bg + red text for "Critical/Allergy").
- **Section grouping in sidebars**: an uppercase, letter-spaced, small `--ink-400`-colored label divides nav groups (`Platform`, `Governance`, `Facility`, `Core Clinical (DHA)`, `MHP Program`).
- **Cards/KPI tiles** on dashboards: white card, `--radius-lg`, large Lexend numeral in `--ink-900` or `--green-dark`, small Inter label underneath in `--ink-500`, optional small trend indicator in green/red.
- **Forms**: label above input, Inter font, `--border` outline inputs with `--radius-sm`, focus state uses `--green` outline/ring, helper/error text in `--ink-500`/`--red` respectively.

## 3.5 Per-tier navigation reference (extracted from mockups)

**Super Admin** (`citramac_SUPER-ADMIN.html`)
- Section "Platform": Platform Dashboard, Organizations, Branches, Subscriptions
- Section "Governance": Roles & Permissions, Audit Log

**Org Admin** (`citramac_ORG-admin.html`)
- Section "Facility": Org Dashboard, Ward & Bed Management, Staff / MHP Team, Branch Settings, Roles & Permissions

**Clinical Workspace** (`citramac_clinical_workspace.html`)
- Section "Core Clinical (DHA)": Client Registry, Attachments, Triage & MSE, Clinical Review, Clinical Encounter, Laboratory (LIMS) *[Soon]*, Pharmacy *[Soon]*, Inpatient & Ward *[Soon]*
- Section "MHP Program": Individual Psychotherapy, Family Therapy, Group Psychotherapy, Supervision Requests *[Soon]*, NACADA NDO Report, MHP Team *[Soon]*
- Footer: About *[Soon]*

This matches the reference AppSheet screenshot (`Client Registration` list view with columns: First Name, Last Name, Middle/Other Names, UHID Number, Gender, Date Of Birth, Age, DOA, Doctors Name, Allergy Status, Nationality, Marital Status — replicate this exact column set for the Client Registry table, grouped by patient category e.g. "Inpatient").

## 3.6 Theming — platform and organization palettes

Every color token in §3.1 (except the derived ones) is editable, separately for light and dark mode, in two layers:

1. **Platform theme** — `PlatformBranding.theme_overrides`, edited by Super Admin at *Theme & Colors* (`/super-admin/theme`). The baseline for every user, including the login screens. **Only this layer may change status colors** (`danger`, `warning`, `on_status`), so a risk flag or allergy alert reads the same in every tenant.
2. **Organization theme** — `Organization.theme_overrides`, edited by the Org Admin in *Branch Settings → Theme & Colors* or by Super Admin in the Organizations drawer (create and edit). Applied on top of the platform theme for that org's members; any token it doesn't set follows the platform theme. Status keys are rejected with a 400.

Stored shape (validated by `backend/apps/tenancy/theme.py`, mirrored by `frontend/src/theme/themeTokens.ts`):

```json
{ "light": { "primary": "#1d5fa8", "sidebar_top": "#15457a" },
  "dark":  { "primary": "#6aa8ff" } }
```

The old flat `{"primary", "secondary"}` shape is still accepted on input and normalized to `light.primary` / `light.primary_dark` (migration `tenancy.0015` converted stored data).

At runtime `frontend/src/theme/runtimeTheme.ts` merges the two layers into one generated `<style>` element (never inline styles on `<html>`, which would beat the dark-mode blocks) and caches each layer in `localStorage` so the next load paints the right palette without a flash. The editor (`frontend/src/theme/ThemeEditor.tsx`) offers presets, "generate light & dark palettes from one brand color", a scoped live preview, per-token reset, and WCAG AA contrast checks for the key text/background pairs. Contrast warnings are advisory, not enforced.
