/**
 * Phase 0 placeholder shell — proves the design-token/Tailwind/font pipeline
 * end to end. The real SuperAdminShell / OrgAdminShell / ClinicalWorkspaceShell
 * (see src/shells/) are built in Phase 2, per docs/11-ROADMAP-AND-PHASES.md.
 */
function App() {
  return (
    <div className="grid min-h-screen grid-cols-[248px_1fr]">
      <aside
        className="flex flex-col p-5 text-[#eafaf4]"
        style={{
          backgroundImage: "linear-gradient(180deg, #00503a 0%, #003f2e 100%)",
        }}
      >
        <div className="font-display text-lg font-bold">CITRAMAC</div>
        <div className="mt-1 text-[10.5px] font-semibold uppercase tracking-wide text-[#9fd6c3]">
          Platform Console
        </div>
      </aside>

      <main className="flex flex-col items-start gap-3 p-10">
        <h1 className="font-display text-2xl font-bold text-ink-900">
          Phase 0 — Environment Ready
        </h1>
        <p className="max-w-md text-sm text-ink-500">
          Django admin, PostgreSQL, Redis, and this React shell are wired up per{" "}
          <code className="rounded-sm border border-surface-border bg-surface-bg px-1.5 py-0.5">
            docs/11-ROADMAP-AND-PHASES.md
          </code>{" "}
          Phase 0. Tenancy, identity, and the real auth flow come next in Phase 1.
        </p>
        <button
          type="button"
          className="rounded-md bg-brand-green px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-green-dark"
        >
          Design tokens wired
        </button>
      </main>
    </div>
  );
}

export default App;
