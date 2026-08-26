import { useEffect, useState, type ReactNode } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { Menu, Search } from "lucide-react";
import type { NavGroup } from "./navConfig";
import { OfflineSyncBanner } from "./OfflineSyncBanner";
import { getPlatformBranding } from "../lib/brandingApi";

const COLLAPSE_KEY = "citramac.sidebar.collapsed";
const DESKTOP_BREAKPOINT = 1024; // matches Tailwind's `lg`

function readStoredCollapse() {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * Shared sidebar+topbar chrome for all three tiers — docs/03-DESIGN-SYSTEM.md
 * §3.3 layout shell pattern, matched to the mockups' collapsible sidebar
 * (icon-only "collapsed" mode on desktop, off-canvas drawer on mobile) and
 * full-width content area. The one hamburger button does double duty exactly
 * like the mockups: below the desktop breakpoint it opens/closes the mobile
 * drawer, at or above it toggles the persistent collapsed/expanded state.
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
  const [collapsed, setCollapsed] = useState(readStoredCollapse);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);

  useEffect(() => {
    getPlatformBranding()
      .then((b) => setLogoUrl(b.logo))
      .catch(() => setLogoUrl(null));
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSE_KEY, collapsed ? "1" : "0");
    } catch {
      // Best-effort only — a private window or blocked storage just means
      // the collapse preference won't persist across reloads.
    }
  }, [collapsed]);

  const toggleSidebar = () => {
    if (window.innerWidth < DESKTOP_BREAKPOINT) {
      setMobileOpen((v) => !v);
    } else {
      setCollapsed((v) => !v);
    }
  };

  const closeMobile = () => setMobileOpen(false);

  return (
    <div className="flex min-h-screen w-full">
      <div
        className={`fixed inset-0 z-30 bg-ink-900/40 transition-opacity duration-200 lg:hidden ${
          mobileOpen ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0"
        }`}
        onClick={closeMobile}
        aria-hidden="true"
      />

      <aside
        className={`fixed inset-y-0 left-0 z-40 flex h-screen flex-shrink-0 flex-col overflow-hidden text-[#eafaf4] transition-transform duration-300 ease-in-out lg:sticky lg:top-0 lg:translate-x-0 lg:transition-[width] lg:duration-300 ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        }`}
        style={{
          backgroundImage: "linear-gradient(180deg, #00503a 0%, #003f2e 100%)",
          width: collapsed ? 76 : 248,
        }}
      >
        <div
          className={`flex items-center gap-2.5 border-b border-white/10 py-5 ${collapsed ? "justify-center px-2" : "px-[18px]"}`}
        >
          {logoUrl ? (
            <img
              src={logoUrl}
              alt={brandName}
              className="h-8 w-8 flex-shrink-0 rounded-md bg-white object-contain p-0.5"
            />
          ) : (
            <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md bg-white text-xs font-bold text-brand-green-dark">
              CT
            </div>
          )}
          <div
            className={`overflow-hidden whitespace-nowrap leading-tight transition-[opacity,max-width] duration-200 ${
              collapsed ? "max-w-0 opacity-0" : "max-w-[160px] opacity-100"
            }`}
          >
            <div className="font-display text-base font-bold">{brandName}</div>
            <div className="mt-0.5 text-[10.5px] font-semibold uppercase tracking-wide text-[#9fd6c3]">
              {brandSub}
            </div>
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto overflow-x-hidden px-3 py-3.5">
          {navGroups.map((group) => (
            <div key={group.label || "unlabeled"} className="mb-[18px]">
              {group.label && (
                <div
                  className={`mb-1.5 overflow-hidden whitespace-nowrap px-2.5 text-[10.5px] font-bold uppercase tracking-wide text-[#7fbfa8] transition-[opacity,max-height] duration-200 ${
                    collapsed ? "max-h-0 opacity-0" : "max-h-4 opacity-100"
                  }`}
                >
                  {group.label}
                </div>
              )}
              {group.items.map((item) => {
                const Icon = item.icon;
                if (item.soon) {
                  return (
                    <div
                      key={item.to}
                      title={collapsed ? item.label : undefined}
                      className={`mb-0.5 flex cursor-default items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13.5px] font-medium text-[#d6ede4] opacity-45 ${collapsed ? "justify-center" : ""}`}
                    >
                      <Icon className="h-[17px] w-[17px] flex-shrink-0" />
                      {!collapsed && (
                        <>
                          {item.label}
                          <span className="ml-auto rounded-full bg-white/10 px-1.5 py-0.5 text-[9px] font-bold text-[#bcd9cd]">
                            Soon
                          </span>
                        </>
                      )}
                    </div>
                  );
                }
                return (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.to.split("/").length <= 2}
                    title={collapsed ? item.label : undefined}
                    onClick={closeMobile}
                    className={({ isActive }) =>
                      `mb-0.5 flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13.5px] font-medium transition-colors duration-150 ${collapsed ? "justify-center" : ""} ${
                        isActive
                          ? "bg-[#eafaf4] font-semibold text-brand-green-dark"
                          : "text-[#d6ede4] hover:bg-white/[0.07] hover:text-white"
                      }`
                    }
                  >
                    <Icon className="h-[17px] w-[17px] flex-shrink-0" />
                    {!collapsed && item.label}
                  </NavLink>
                );
              })}
            </div>
          ))}
        </nav>

        <div
          className={`flex items-center gap-2.5 border-t border-white/10 py-3.5 ${collapsed ? "justify-center px-2" : "px-4"}`}
        >
          <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full border-2 border-white/25 bg-brand-green text-xs font-bold text-white">
            {userInitials}
          </div>
          {!collapsed && (
            <div className="overflow-hidden leading-tight">
              <div className="truncate text-[12.5px] font-semibold text-white">{userName}</div>
              <div className="truncate text-[10.5px] text-[#8fc9b3]">{userRole}</div>
            </div>
          )}
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-surface-border bg-surface-card px-4 py-3 sm:px-5 lg:px-7 lg:py-3.5">
          <button
            type="button"
            onClick={toggleSidebar}
            aria-label="Toggle sidebar"
            className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-[9px] border border-surface-border bg-surface-card text-ink-700 transition-colors duration-150 hover:bg-surface-bg"
          >
            <Menu className="h-[18px] w-[18px]" />
          </button>
          <div className="relative hidden max-w-[420px] flex-1 sm:block">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-400" />
            <input
              type="text"
              placeholder={searchPlaceholder}
              className="w-full rounded-[10px] border border-surface-border bg-surface-bg py-2.5 pl-9 pr-3.5 text-[13px] text-ink-900 outline-none transition-colors duration-150 focus:border-brand-green focus:bg-white"
            />
          </div>
          <div className="ml-auto flex items-center gap-3 sm:gap-4">{topbarRight}</div>
        </header>

        <main className="w-full flex-1 px-4 py-5 pb-14 sm:px-6 lg:px-8 lg:py-7">
          <div className="mx-auto w-full max-w-[1920px]">
            <OfflineSyncBanner />
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
