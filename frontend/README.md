# CITRAMAC frontend

React + TypeScript + Tailwind CSS (Shadcn UI + Lucide planned), per
`docs/02-TECH-STACK-AND-ARCHITECTURE.md`. Design tokens live in
`src/theme/tokens.css` and are wired into Tailwind via `tailwind.config.js`
— see `docs/03-DESIGN-SYSTEM.md`. Do not add colors/fonts outside those tokens.

```bash
npm install
npm run dev          # dev server on :5173
npm run build         # production build
npm run lint          # eslint
npm run format:check   # prettier --check
npm test               # vitest
```

Directory layout (mirrors `docs/02-TECH-STACK-AND-ARCHITECTURE.md` §2.5):

- `src/theme/` — design tokens
- `src/shells/` — SuperAdminShell / OrgAdminShell / ClinicalWorkspaceShell (Phase 2)
- `src/auth/` — the five-step auth flow (`docs/05-AUTHENTICATION-FLOW.md`)
- `src/modules/` — one folder per clinical/admin module (Phase 3+)
- `src/lib/` — shared API client, hooks, utilities
