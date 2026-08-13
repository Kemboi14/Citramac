# 03 — Design System (from the CITRAMAC mockups)

**This document is authoritative for all visual output.** It was extracted directly from the three approved mockups (`citramac_SUPER-ADMIN.html`, `citramac_ORG-admin.html`, `citramac_clinical_workspace.html`). Do not invent new colors, fonts, radii, or shadows. Every screen must reuse these tokens.

## 3.1 Color tokens (CSS custom properties)

Define these exactly as a root theme file (`frontend/src/theme/tokens.css`), and expose them to Tailwind via `tailwind.config` `extend.colors` so utility classes stay consistent (e.g. `bg-brand-green`, `text-ink-900`).

```css
:root {
  /* Brand green (primary) */
  --green: #006e51;
  --green-dark: #00503a;
  --green-tint: #e5f3ef;
  --green-tint-2: #f2f9f7;

  /* Semantic status colors */
  --red: #fe0000;
  --red-tint: #fff0ef;
  --amber: #b8790a;
  --amber-tint: #fdf3e2;

  /* Ink (text) scale */
  --ink-900: #0e1e1a;   /* primary text / headings */
  --ink-700: #33453f;   /* secondary text */
  --ink-500: #5f736c;   /* muted text */
  --ink-400: #8a9c96;   /* placeholder / disabled */
  --ink-300: #b6c3bd;   /* borders on dark surfaces */

  /* Surfaces */
  --bg: #f5f8f7;        /* app background */
  --card: #ffffff;      /* card / panel surface */
  --border: #e2e9e6;    /* hairline borders */

  /* Radii */
  --radius-lg: 16px;
  --radius-md: 12px;
  --radius-sm: 8px;

  /* Elevation */
  --shadow-sm: 0 1px 2px rgba(14, 30, 26, 0.06);
  --shadow-md: 0 8px 24px -8px rgba(14, 30, 26, 0.14);

  /* Typography */
  --font-display: 'Lexend', sans-serif;   /* headings, brand, nav labels, KPI numbers */
  --font-body: 'Inter', sans-serif;       /* body copy, table data, form inputs */
}
```

Additional tints observed across mockups for tables/badges/hover states (use for chip backgrounds, hover rows, subtle dividers):

`#eafaf4`, `#d6ede4`, `#cfe4dd`, `#bcd9cd`, `#9bcdb9`, `#9fd6c3`, `#8fc9b3`, `#eaf1fc`, `#eef1f3`, `#fbfdfc`.

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

- **Sidebar** (248px fixed width): brand logo/name at top, then a vertically stacked, icon + label navigation list, grouped under section headers (e.g. "Platform" / "Governance" for Super Admin; "Facility" for Org Admin; "Core Clinical (DHA)" / "CCP Program" for Clinical Workspace). Modules not yet built show a small **"Soon"** badge (amber tint) rather than being hidden — this signals the full roadmap to users without exposing incomplete features.
- **Topbar**: global search input (rounded, green-tinted background, placeholder text like "Search Client Registration"), a refresh/sync icon, a dropdown chevron (tenant/branch switcher for multi-branch orgs), and a circular user avatar/initial badge on the far right.
- **Content area**: page title (Lexend, bold) top-left, primary action button top-right (e.g. green "+ Add" button with `--radius-md` corners), an export icon (PDF), a filter/funnel icon. Below: a data table or card grid on `--card` background with `--border` dividers, `--radius-lg` corners, `--shadow-sm`.

## 3.4 Component patterns to replicate

- **Buttons**: primary = solid `--green` background, white text, `--radius-md`, `--shadow-sm`, semibold Inter; secondary = white background, `--border` outline, `--ink-700` text; destructive = `--red` background or `--red-tint` background with `--red` text/icon.
- **Tables**: header row uses `--ink-700` bold small-caps-style label text on `--card`/`--green-tint-2` background; body rows alternate subtly or use hover-state `--green-tint`; status badges (e.g. "Active Allergies") are pill-shaped chips using the semantic tint colors.
- **Badges/chips**: pill shape (`border-radius: 999px`), tint background + saturated text of the same hue (e.g. amber-tint bg + amber text for "Pending"; red-tint bg + red text for "Critical/Allergy").
- **Section grouping in sidebars**: an uppercase, letter-spaced, small `--ink-400`-colored label divides nav groups (`Platform`, `Governance`, `Facility`, `Core Clinical (DHA)`, `CCP Program`).
- **Cards/KPI tiles** on dashboards: white card, `--radius-lg`, large Lexend numeral in `--ink-900` or `--green-dark`, small Inter label underneath in `--ink-500`, optional small trend indicator in green/red.
- **Forms**: label above input, Inter font, `--border` outline inputs with `--radius-sm`, focus state uses `--green` outline/ring, helper/error text in `--ink-500`/`--red` respectively.

## 3.5 Per-tier navigation reference (extracted from mockups)

**Super Admin** (`citramac_SUPER-ADMIN.html`)
- Section "Platform": Platform Dashboard, Organizations, Branches, Subscriptions
- Section "Governance": Roles & Permissions, Audit Log

**Org Admin** (`citramac_ORG-admin.html`)
- Section "Facility": Org Dashboard, Ward & Bed Management, Staff / CCP Team, Branch Settings, Roles & Permissions

**Clinical Workspace** (`citramac_clinical_workspace.html`)
- Section "Core Clinical (DHA)": Client Registry, Attachments, Triage & MSE, Clinical Review, Clinical Encounter, Laboratory (LIMS) *[Soon]*, Pharmacy *[Soon]*, Inpatient & Ward *[Soon]*
- Section "CCP Program": Individual Psychotherapy, Family Therapy, Group Psychotherapy, Supervision Requests *[Soon]*, NACADA NDO Report, CCP Team *[Soon]*
- Footer: About *[Soon]*

This matches the reference AppSheet screenshot (`Client Registration` list view with columns: First Name, Last Name, Middle/Other Names, UHID Number, Gender, Date Of Birth, Age, DOA, Doctors Name, Allergy Status, Nationality, Marital Status — replicate this exact column set for the Client Registry table, grouped by patient category e.g. "Inpatient").

## 3.6 Tenant branding within brand bounds

Multi-tenant customization is allowed **only** as a controlled override: each Organization may set a single "accent" hue (used sparingly, e.g. their logo mark) while the structural chrome (sidebar green, ink scale, status colors) remains fixed CITRAMAC brand colors. This keeps every tenant DHA-demo-ready and visually consistent for support/audit purposes. Implement via a `theme_overrides` JSONB field on `Organization`, applied as a thin CSS-variable override layer — never replacing the base token file.
