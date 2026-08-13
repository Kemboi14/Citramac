import type { ReactNode } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { Search } from "lucide-react";
import type { NavGroup } from "./navConfig";

/**
 * Shared sidebar+topbar chrome for all three tiers — docs/03-DESIGN-SYSTEM.md
 * §3.3 layout shell pattern, pixel-matched to the mockups (248px sidebar,
 * green-dark gradient, Lexend brand/titles, "Soon" badges for unbuilt
 * modules rather than hiding them).
 */
export function AppShell({
  brandName,
  brandSub,
  navGroups,
  userInitials,
  userName,
  userRole,
  topbarRight,
  searchPlaceholder,
}: {
  brandName: string;
  brandSub: string;
  navGroups: NavGroup[];
  userInitials: string;
  userName: string;
  userRole: string;
  topbarRight?: ReactNode;
  searchPlaceholder: string;
}) {
  return (
    <div className="grid min-h-screen grid-cols-[248px_1fr]">
      <aside
        className="sticky top-0 flex h-screen flex-col text-[#eafaf4]"
        style={{ backgroundImage: "linear-gradient(180deg, #00503a 0%, #003f2e 100%)" }}
      >
        <div className="flex items-center gap-2.5 border-b border-white/10 px-4.5 py-5">
          <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md bg-white text-xs font-bold text-brand-green-dark">
            CT
          </div>
          <div className="leading-tight">
            <div className="font-display text-base font-bold">{brandName}</div>
            <div className="mt-0.5 text-[10.5px] font-semibold uppercase tracking-wide text-[#9fd6c3]">
              {brandSub}
            </div>
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-3.5">
          {navGroups.map((group) => (
            <div key={group.label || "unlabeled"} className="mb-4.5">
              {group.label && (
                <div className="mb-1.5 px-2.5 text-[10.5px] font-bold uppercase tracking-wide text-[#7fbfa8]">
                  {group.label}
                </div>
              )}
              {group.items.map((item) => {
                const Icon = item.icon;
                if (item.soon) {
                  return (
                    <div
                      key={item.to}
                      className="mb-0.5 flex cursor-default items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13.5px] font-medium text-[#d6ede4] opacity-45"
                    >
                      <Icon className="h-[17px] w-[17px] flex-shrink-0" />
                      {item.label}
                      <span className="ml-auto rounded-full bg-white/10 px-1.5 py-0.5 text-[9px] font-bold text-[#bcd9cd]">
                        Soon
                      </span>
                    </div>
                  );
                }
                return (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.to.split("/").length <= 2}
                    className={({ isActive }) =>
                      `mb-0.5 flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13.5px] font-medium transition-colors ${
                        isActive
                          ? "bg-[#eafaf4] font-semibold text-brand-green-dark"
                          : "text-[#d6ede4] hover:bg-white/[0.07] hover:text-white"
                      }`
                    }
                  >
                    <Icon className="h-[17px] w-[17px] flex-shrink-0" />
                    {item.label}
                  </NavLink>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="flex items-center gap-2.5 border-t border-white/10 px-4 py-3.5">
          <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full border-2 border-white/25 bg-brand-green text-xs font-bold text-white">
            {userInitials}
          </div>
          <div className="leading-tight">
            <div className="text-[12.5px] font-semibold text-white">{userName}</div>
            <div className="text-[10.5px] text-[#8fc9b3]">{userRole}</div>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-30 flex items-center gap-3.5 border-b border-surface-border bg-surface-card px-7 py-3.5">
          <div className="relative max-w-[420px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-400" />
            <input
              type="text"
              placeholder={searchPlaceholder}
              className="w-full rounded-[10px] border border-surface-border bg-surface-bg py-2.5 pl-9 pr-3.5 text-[13px] text-ink-900 outline-none focus:border-brand-green focus:bg-white"
            />
          </div>
          <div className="ml-auto flex items-center gap-4">{topbarRight}</div>
        </header>

        <main className="w-full max-w-[1400px] flex-1 px-7 py-6.5 pb-14">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
