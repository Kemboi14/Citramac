import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { ChevronDown, LogOut, Menu, Moon, Search, Sun, UserRound } from "lucide-react";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { useDialogA11y } from "../components/useDialogA11y";
import { usePatientContext } from "../clinical/usePatientContext";
import type { NavGroup, NavItem } from "./navConfig";
import { groupContainsActive, itemMatches } from "./navMatch";
import { TOPBAR_ICON_BUTTON } from "./brandTopbar";
import { ProfileCompletionBanner } from "./ProfileCompletionBanner";
import { SubscriptionBanner } from "./SubscriptionBanner";
import { getPlatformBranding } from "../lib/brandingApi";
import { getOrganizationTheme } from "../lib/themeApi";
import {
  applyCachedOrganizationTheme,
  setOrganizationTheme,
  setPlatformTheme,
} from "../theme/runtimeTheme";
import { useAuth } from "../auth/useAuth";
import { useTheme } from "../theme/useTheme";
import { useWorkingBranch } from "./useWorkingBranch";
import {
  BreadcrumbBarContext,
  BreadcrumbTrail,
  type BreadcrumbBar,
  type Crumb,
} from "../modules/care/shared/Breadcrumbs";

const COLLAPSE_KEY = "citramac.sidebar.collapsed";
const DESKTOP_BREAKPOINT = 1024; // matches Tailwind's `lg`

function readStoredCollapse() {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === "1";
  } catch {
    return false;
  }
}

/** Reactive `>= lg` check — a live media-query listener, not a one-time
 * `window.innerWidth` read, so rotating/resizing across the breakpoint
 * updates the layout immediately rather than only on the next hamburger
 * click. */
function useIsDesktop() {
  const [isDesktop, setIsDesktop] = useState(
    () => window.matchMedia(`(min-width: ${DESKTOP_BREAKPOINT}px)`).matches,
  );
  useEffect(() => {
    const mql = window.matchMedia(`(min-width: ${DESKTOP_BREAKPOINT}px)`);
    const handler = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, []);
  return isDesktop;
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
  profilePath,
  variant = "default",
  usePlatformIcon = false,
  pageTitles,
  workspaceTitle,
  searchSlot,
  focusRoutes,
}: {
  brandName: string;
  brandSub: string;
  navGroups: NavGroup[];
  userInitials: string;
  userName: string;
  userRole: string;
  topbarRight?: ReactNode;
  searchPlaceholder: string;
  /** Portal-relative route to this shell's "My Profile" page — every
   * portal gets one so every user, any role, can set their own avatar. */
  profilePath: string;
  /** "brand" — the clinical workspace's topbar: light like the other shells, but
   * carrying the workspace name, a working search slot and a light/dark toggle. */
  variant?: "default" | "brand";
  /** Platform console only: show the platform icon (Super Admin → Platform
   * Branding) in the sidebar instead of the full logo. */
  usePlatformIcon?: boolean;
  /** Page names for routes with no menu entry, used as the last breadcrumb. */
  pageTitles?: Record<string, string>;
  /** The brand topbar names the workspace, never the page: each page carries
   * its own heading, with the breadcrumbs above it, so it is never shown twice. */
  workspaceTitle?: string;
  /** Replaces the topbar's plain search box (brand variant), e.g. with a working client search. */
  searchSlot?: ReactNode;
  /** Full-height workspaces (e.g. Group Psychotherapy): the page gets the whole
   * content area with no padding (v4 mockup `showPage`). The sidebar is left as
   * the user set it. */
  focusRoutes?: string[];
}) {
  const [desktopCollapsed, setDesktopCollapsed] = useState(readStoredCollapse);
  const isDesktop = useIsDesktop();
  // The collapse preference is a desktop density feature — never let it
  // shrink the mobile drawer to icon-only, since that would make the nav
  // labels (and the drawer's entire reason for existing) disappear on phone.
  const collapsed = isDesktop && desktopCollapsed;
  const [mobileOpen, setMobileOpen] = useState(false);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const profileMenuRef = useRef<HTMLDivElement>(null);
  // The top bar is sticky; anything else that sticks to the top of the page
  // (the client safety banner) sits below it, at `--app-header-h`.
  const headerRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const header = headerRef.current;
    if (!header) return;
    const root = document.documentElement;
    const publish = () =>
      root.style.setProperty("--app-header-h", `${header.getBoundingClientRect().height}px`);
    publish();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(publish);
    observer?.observe(header);
    return () => {
      observer?.disconnect();
      root.style.removeProperty("--app-header-h");
    };
  }, []);
  const { accessToken, claims, avatarUrl, logout } = useAuth();
  const { clear: forgetSelectedClient } = usePatientContext();
  const navigate = useNavigate();
  const location = useLocation();
  const workingBranch = useWorkingBranch();
  // One level of expandable nav sub-groups (e.g. "Psychiatry" → its
  // sub-screens) — keyed by label, collapsed by default. See navConfig.tsx.
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(
    () =>
      new Set(
        navGroups.flatMap((group) =>
          group.items
            .filter((item) => item.defaultOpen || groupContainsActive(item, location.pathname))
            .map((item) => item.label),
        ),
      ),
  );
  // A focus route only changes the content area's layout. The sidebar keeps the
  // user's own setting: forcing it to the icon rail on entry hid the navigation
  // every time Group Psychotherapy was opened.
  const focusLayout = Boolean(
    focusRoutes?.some(
      (route) =>
        location.pathname === route ||
        location.pathname.startsWith(`${route.replace(/\/+$/, "")}/`),
    ),
  );
  const isBrand = variant === "brand";

  // Breadcrumbs, at the top of every page: the page's own when it gives them
  // (the latest <Breadcrumbs> mounted), otherwise built from the menu.
  const [pageCrumbs, setPageCrumbs] = useState<{ owner: string; items: Crumb[] }[]>([]);
  const breadcrumbBar = useMemo<BreadcrumbBar>(
    () => ({
      set: (owner, items) =>
        setPageCrumbs((prev) => [...prev.filter((p) => p.owner !== owner), { owner, items }]),
      clear: (owner) => setPageCrumbs((prev) => prev.filter((p) => p.owner !== owner)),
    }),
    [],
  );
  const crumbs =
    pageCrumbs[pageCrumbs.length - 1]?.items ??
    menuCrumbs(navGroups, location.pathname, resolvePageTitle(pageTitles, location.pathname));
  const toggleGroup = (label: string) =>
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });

  // Open the group that holds the screen being navigated to. Only ever adds
  // groups, so a group the user collapsed by hand stays collapsed until they go
  // somewhere else inside it. Done while rendering (React's "adjust state when a
  // prop changes" pattern) rather than in an effect, so the right group is open
  // on the very first paint of the new route.
  const [seenPath, setSeenPath] = useState(location.pathname);
  if (seenPath !== location.pathname) {
    setSeenPath(location.pathname);
    const active = navGroups.flatMap((group) =>
      group.items
        .filter((item) => groupContainsActive(item, location.pathname))
        .map((item) => item.label),
    );
    if (active.some((label) => !expandedGroups.has(label))) {
      setExpandedGroups(new Set([...expandedGroups, ...active]));
    }
  }

  useEffect(() => {
    // Platform theme is the baseline for every user, including Super Admin
    // (who has no organization to further theme); main.tsx already applied
    // it at boot, this refreshes it alongside the sidebar logo.
    getPlatformBranding()
      .then((b) => {
        // The platform console shows the platform icon when one is set.
        setLogoUrl((current) => current ?? ((usePlatformIcon && b.icon) || b.logo));
        setPlatformTheme(b.theme_overrides);
      })
      .catch(() => {
        // Best-effort only — keep the default mark and cached palette.
      });
  }, [usePlatformIcon]);

  useEffect(() => {
    // An org's own theme layers over the platform one (runtimeTheme.ts
    // merges the two, so request order doesn't matter). The cached copy is
    // painted first so members don't see the platform palette flash in.
    const organizationId = claims?.organization_id;
    if (!accessToken || !organizationId) return;
    applyCachedOrganizationTheme(organizationId);
    getOrganizationTheme(accessToken, organizationId)
      .then(({ theme_overrides, logo_url, icon_url }) => {
        setOrganizationTheme(organizationId, theme_overrides);
        // Org's own icon (else its logo) overrides the platform one in the
        // sidebar, same "org wins over the platform baseline" rule as the colors.
        if (icon_url || logo_url) setLogoUrl(icon_url || logo_url);
      })
      .catch(() => {
        // Best-effort only — the cached/platform palette stays in place.
      });
    // Leaving the shell (logout, switching to an org-less account) drops
    // the org layer so the login screen shows only the platform theme.
    return () => setOrganizationTheme(null, null);
  }, [accessToken, claims?.organization_id]);

  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSE_KEY, desktopCollapsed ? "1" : "0");
    } catch {
      // Best-effort only — a private window or blocked storage just means
      // the collapse preference won't persist across reloads.
    }
  }, [desktopCollapsed]);

  const toggleSidebar = () => {
    if (isDesktop) {
      setDesktopCollapsed((v) => !v);
    } else {
      setMobileOpen((v) => !v);
    }
  };

  const closeMobile = () => setMobileOpen(false);
  // Below the desktop breakpoint the sidebar is a modal drawer: focus moves in,
  // Tab stays in, Esc closes it. On desktop it is plain page chrome.
  const drawerOpen = mobileOpen && !isDesktop;
  const asideRef = useDialogA11y<HTMLElement>(drawerOpen, closeMobile);
  const { navRef, topRef, bottomRef, edges: navEdges } = useScrollEdges();
  // Clicking a group while the sidebar is an icon rail expands it first —
  // otherwise the click would do nothing and the group's pages stay unreachable.
  const openGroupFromRail = (label: string) => {
    setDesktopCollapsed(false);
    setExpandedGroups((prev) => new Set(prev).add(label));
  };
  const focusMain = () => {
    const main = document.getElementById("main-content");
    main?.focus();
    main?.scrollIntoView?.({ block: "start" });
  };

  useEffect(() => {
    if (!profileMenuOpen) return;
    const handleClick = (event: MouseEvent) => {
      if (!profileMenuRef.current?.contains(event.target as Node)) setProfileMenuOpen(false);
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [profileMenuOpen]);

  const handleLogout = async () => {
    setProfileMenuOpen(false);
    // The next person to sign in on this tab must not inherit the open client.
    forgetSelectedClient();
    await logout();
    navigate("/login", { replace: true });
  };

  return (
    <div className="flex min-h-screen w-full">
      <a
        href="#main-content"
        onClick={(event) => {
          event.preventDefault();
          focusMain();
        }}
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[200] focus:rounded-md focus:bg-surface-card focus:px-3 focus:py-2 focus:text-sm focus:font-semibold focus:text-ink-900 focus:shadow-md"
      >
        Skip to main content
      </a>
      <div
        className={`fixed inset-0 z-30 bg-surface-scrim transition-opacity duration-200 lg:hidden ${
          mobileOpen ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0"
        }`}
        onClick={closeMobile}
        aria-hidden="true"
      />

      <aside
        ref={asideRef}
        aria-label="Main navigation"
        role={drawerOpen ? "dialog" : undefined}
        aria-modal={drawerOpen || undefined}
        // Off-canvas on mobile: keep its links out of the tab order until opened.
        inert={!isDesktop && !mobileOpen}
        className={`fixed inset-y-0 left-0 z-40 flex h-screen flex-shrink-0 flex-col overflow-hidden text-sidebar-text-strong transition-transform duration-300 ease-in-out lg:sticky lg:top-0 lg:translate-x-0 lg:transition-[width] lg:duration-300 ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        }`}
        style={{
          backgroundImage:
            "linear-gradient(180deg, var(--sidebar-top) 0%, var(--sidebar-bottom) 100%)",
          width: collapsed ? 76 : 248,
        }}
      >
        <div
          className={`flex items-center gap-2.5 border-b border-sidebar-divider py-5 ${collapsed ? "justify-center px-2" : "px-[18px]"}`}
        >
          {/* The logo sits on a green tile and is shown in white (any uploaded
              logo), so it reads the same whatever colours the file has. */}
          {logoUrl ? (
            <span className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-md bg-brand-green-dark">
              <img
                src={logoUrl}
                alt={brandName}
                className="h-full w-full object-contain brightness-0 invert"
              />
            </span>
          ) : (
            <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-md bg-brand-green-dark text-xs font-bold text-on-primary">
              CT
            </div>
          )}
          <div
            className={`overflow-hidden whitespace-nowrap leading-tight transition-[opacity,max-width] duration-200 ${
              collapsed ? "max-w-0 opacity-0" : "max-w-[160px] opacity-100"
            }`}
          >
            <div className="font-display text-base font-bold">{brandName}</div>
            <div
              className="mt-0.5 max-w-[160px] truncate text-[10.5px] font-semibold uppercase tracking-wide text-white"
              title={brandSub}
            >
              {brandSub}
            </div>
          </div>
        </div>

        <div className="relative flex min-h-0 flex-1 flex-col">
          {/* Soft edges that say "there is more above / below" when the list scrolls. */}
          <div
            aria-hidden="true"
            className={`pointer-events-none absolute inset-x-0 top-0 z-10 h-6 bg-gradient-to-b from-black/30 to-transparent transition-opacity duration-150 ${navEdges.top ? "opacity-100" : "opacity-0"}`}
          />
          <div
            aria-hidden="true"
            className={`pointer-events-none absolute inset-x-0 bottom-0 z-10 h-6 bg-gradient-to-t from-black/30 to-transparent transition-opacity duration-150 ${navEdges.bottom ? "opacity-100" : "opacity-0"}`}
          />
          <nav
            ref={navRef}
            aria-label="Primary"
            className="flex-1 overflow-y-auto overflow-x-hidden px-3 py-3.5"
          >
            <div ref={topRef} aria-hidden="true" className="h-px" />
            {navGroups.map((group) => (
              <div key={group.label || "unlabeled"} className="mb-[18px]">
                {group.label && (
                  <div
                    className={`mb-1.5 overflow-hidden whitespace-nowrap px-2.5 text-[10.5px] font-bold uppercase tracking-wide text-white transition-[opacity,max-height] duration-200 ${
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
                        key={item.label}
                        title={collapsed ? item.label : undefined}
                        className={`mb-0.5 flex cursor-default items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13.5px] font-medium text-sidebar-text-strong opacity-45 ${collapsed ? "justify-center" : ""}`}
                      >
                        <Icon className="h-[17px] w-[17px] flex-shrink-0" />
                        {!collapsed && (
                          <>
                            {item.label}
                            <span className="ml-auto rounded-full bg-sidebar-divider px-1.5 py-0.5 text-[9px] font-bold text-sidebar-muted">
                              Soon
                            </span>
                          </>
                        )}
                      </div>
                    );
                  }

                  if (item.children?.length) {
                    const isOpen = expandedGroups.has(item.label);
                    const holdsActive = groupContainsActive(item, location.pathname);
                    return (
                      <div key={item.label} className="mb-0.5">
                        <button
                          type="button"
                          title={collapsed ? item.label : undefined}
                          onClick={() =>
                            collapsed ? openGroupFromRail(item.label) : toggleGroup(item.label)
                          }
                          aria-expanded={isOpen}
                          className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13.5px] font-medium transition-colors duration-150 hover:bg-sidebar-hover hover:text-sidebar-text-strong ${holdsActive ? "font-semibold text-sidebar-text-strong" : "text-sidebar-text-strong"} ${collapsed ? "justify-center" : ""}`}
                        >
                          <Icon className="h-[17px] w-[17px] flex-shrink-0" />
                          {!collapsed && (
                            <>
                              <span className="flex-1">{item.label}</span>
                              <ChevronDown
                                className={`h-3.5 w-3.5 flex-shrink-0 transition-transform duration-150 ${isOpen ? "rotate-180" : ""}`}
                              />
                            </>
                          )}
                        </button>
                        {!collapsed && isOpen && (
                          <div className="mt-0.5 flex flex-col gap-0.5 pl-[17px]">
                            {item.children.map((child) => (
                              <ClinicalNavLeaf
                                key={child.label}
                                item={child}
                                collapsed={false}
                                onClick={closeMobile}
                              />
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  }

                  return (
                    <ClinicalNavLeaf
                      key={item.label}
                      item={item}
                      collapsed={collapsed}
                      onClick={closeMobile}
                    />
                  );
                })}
              </div>
            ))}
            <div ref={bottomRef} aria-hidden="true" className="h-px" />
          </nav>
        </div>

        <div ref={profileMenuRef} className="relative border-t border-sidebar-divider">
          {profileMenuOpen && (
            <div className="absolute bottom-full left-2 right-2 mb-1.5 animate-scale-in overflow-hidden rounded-[10px] border border-surface-border bg-surface-card py-1.5 shadow-md">
              <Link
                to={profilePath}
                onClick={() => setProfileMenuOpen(false)}
                className="flex items-center gap-2.5 px-3.5 py-2.5 text-[12.5px] font-medium text-ink-700 hover:bg-surface-bg"
              >
                <UserRound className="h-4 w-4 text-ink-400" />
                My Profile
              </Link>
              <button
                type="button"
                onClick={handleLogout}
                className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left text-[12.5px] font-medium text-status-red hover:bg-status-red-tint"
              >
                <LogOut className="h-4 w-4" />
                Sign out
              </button>
            </div>
          )}
          <button
            type="button"
            onClick={() => setProfileMenuOpen((v) => !v)}
            aria-haspopup="menu"
            aria-expanded={profileMenuOpen}
            className={`flex w-full items-center gap-2.5 py-3.5 transition-colors duration-150 hover:bg-sidebar-hover ${collapsed ? "justify-center px-2" : "px-4"}`}
          >
            <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center overflow-hidden rounded-full border-2 border-sidebar-divider bg-brand-green text-xs font-bold text-on-primary">
              {avatarUrl ? (
                <img src={avatarUrl} alt="" className="h-full w-full object-cover" />
              ) : (
                userInitials
              )}
            </div>
            {!collapsed && (
              <>
                <div className="min-w-0 flex-1 overflow-hidden text-left leading-tight">
                  <div className="truncate text-[12.5px] font-semibold text-sidebar-text-strong">
                    {userName}
                  </div>
                  <div className="truncate text-[10.5px] text-sidebar-muted">{userRole}</div>
                </div>
                <ChevronDown
                  className={`h-3.5 w-3.5 flex-shrink-0 text-sidebar-muted transition-transform duration-150 ${profileMenuOpen ? "rotate-180" : ""}`}
                />
              </>
            )}
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {isBrand ? (
          <header
            ref={headerRef}
            className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-surface-border bg-surface-card/95 px-4 text-ink-900 backdrop-blur"
          >
            <button
              type="button"
              onClick={toggleSidebar}
              aria-label="Toggle sidebar"
              className={TOPBAR_ICON_BUTTON}
            >
              <Menu className="h-[17px] w-[17px]" />
            </button>
            {/* Narrow screens: wrap to two lines rather than cut the title off. */}
            <div className="min-w-0 flex-1 truncate font-display text-sm font-semibold max-[480px]:line-clamp-2 max-[480px]:whitespace-normal max-[480px]:text-[13px] max-[480px]:leading-tight">
              {workspaceTitle}
            </div>
            <div className="relative hidden w-72 max-w-[34vw] min-[481px]:block">
              {searchSlot ?? (
                <input
                  type="text"
                  aria-label={searchPlaceholder}
                  placeholder={searchPlaceholder}
                  className="h-9 w-full rounded-[10px] border border-surface-border bg-surface-bg px-3 text-[13px] text-ink-900 outline-none focus:border-brand-green focus:bg-surface-card"
                />
              )}
            </div>
            <div className="flex items-center gap-2">
              {topbarRight}
              <ThemeToggleButton />
            </div>
          </header>
        ) : (
          <header
            ref={headerRef}
            className="sticky top-0 z-20 flex items-center gap-3 border-b border-surface-border bg-surface-card/95 px-4 py-3 backdrop-blur sm:px-5 lg:px-7 lg:py-3.5"
          >
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
                aria-label={searchPlaceholder}
                placeholder={searchPlaceholder}
                className="w-full rounded-[10px] border border-surface-border bg-surface-bg py-2.5 pl-9 pr-3.5 text-[13px] text-ink-900 outline-none transition-colors duration-150 focus:border-brand-green focus:bg-surface-card"
              />
            </div>
            <div className="ml-auto flex items-center gap-3 sm:gap-4">{topbarRight}</div>
          </header>
        )}

        <main
          id="main-content"
          tabIndex={-1}
          className={
            focusLayout
              ? "w-full flex-1 outline-none lg:h-[calc(100vh-56px)] lg:overflow-y-auto"
              : "w-full flex-1 px-4 py-5 pb-16 outline-none sm:px-6 sm:py-6 lg:px-8 lg:py-8 lg:pb-16"
          }
        >
          <div className={focusLayout ? "h-full w-full" : "mx-auto w-full max-w-[1920px]"}>
            <ErrorBoundary resetKey={location.pathname}>
              {!focusLayout && crumbs.length > 1 && (
                <BreadcrumbTrail items={crumbs} className="mb-4" />
              )}
              <SubscriptionBanner />
              <ProfileCompletionBanner />
              {/* Keyed on the working branch: switching branch reloads the page's data under it. */}
              <BreadcrumbBarContext.Provider value={focusLayout ? null : breadcrumbBar}>
                <Outlet key={workingBranch} />
              </BreadcrumbBarContext.Provider>
            </ErrorBoundary>
          </div>
        </main>
      </div>
    </div>
  );
}

/**
 * Whether the nav list has more content above / below the visible part, using
 * two sentinel elements inside the scroll container (no scroll listeners).
 */
function useScrollEdges() {
  const navRef = useRef<HTMLElement>(null);
  const topRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ top: false, bottom: false });
  useEffect(() => {
    const root = navRef.current;
    const top = topRef.current;
    const bottom = bottomRef.current;
    if (!root || !top || !bottom || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        setEdges((prev) => {
          let next = prev;
          for (const entry of entries) {
            if (entry.target === top) next = { ...next, top: !entry.isIntersecting };
            if (entry.target === bottom) next = { ...next, bottom: !entry.isIntersecting };
          }
          return next;
        });
      },
      { root, threshold: 0 },
    );
    observer.observe(top);
    observer.observe(bottom);
    return () => observer.disconnect();
  }, []);
  return { navRef, topRef, bottomRef, edges };
}

/** Exact route first, then the longest "prefix/*" pattern (e.g. "/clinical/triage/*"). */
/**
 * Breadcrumbs from the menu, for a page that gives none of its own: the menu
 * group (when the item sits in an expandable one), the menu item the page
 * belongs to, and, on a deeper page, that page's title.
 */
function menuCrumbs(groups: NavGroup[], pathname: string, title: string | undefined): Crumb[] {
  const entries = groups.flatMap((group) =>
    group.items.flatMap((item) =>
      item.children
        ? item.children.map((child) => ({ item: child, parent: item.label }))
        : [{ item, parent: undefined as string | undefined }],
    ),
  );
  const best = entries
    .filter(({ item }) => item.to && (pathname === item.to || pathname.startsWith(`${item.to}/`)))
    .sort((a, b) => (b.item.to?.length ?? 0) - (a.item.to?.length ?? 0))[0];
  if (!best?.item.to) return title ? [{ label: title }] : [];
  const trail: Crumb[] = best.parent ? [{ label: best.parent }] : [];
  if (pathname === best.item.to) return [...trail, { label: best.item.label }];
  return [
    ...trail,
    { label: best.item.label, to: best.item.to },
    { label: title && title !== best.item.label ? title : "Details" },
  ];
}

function resolvePageTitle(titles: Record<string, string> | undefined, pathname: string) {
  if (!titles) return undefined;
  if (Object.prototype.hasOwnProperty.call(titles, pathname)) {
    // eslint-disable-next-line security/detect-object-injection -- own-property lookup on a fixed map.
    return titles[pathname];
  }
  const match = Object.keys(titles)
    .filter((key) => key.endsWith("/*") && pathname.startsWith(key.slice(0, -1)))
    .sort((a, b) => b.length - a.length)[0];
  // eslint-disable-next-line security/detect-object-injection -- key comes from the map itself.
  return match ? titles[match] : undefined;
}

/** Light/dark switch on the brand topbar. From "system" it flips whatever the
 * OS is currently showing; the choice is stored by useTheme as before. */
function ThemeToggleButton() {
  const { preference, setPreference } = useTheme();
  const isDark =
    preference === "dark" ||
    (preference === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  return (
    <button
      type="button"
      onClick={() => setPreference(isDark ? "light" : "dark")}
      aria-label="Toggle light/dark theme"
      aria-pressed={isDark}
      title="Toggle light/dark theme"
      className={TOPBAR_ICON_BUTTON}
    >
      {isDark ? <Sun className="h-[17px] w-[17px]" /> : <Moon className="h-[17px] w-[17px]" />}
    </button>
  );
}

/** A single navigable leaf — either a top-level item or a nested child under an expandable group. */
function ClinicalNavLeaf({
  item,
  collapsed,
  onClick,
}: {
  item: NavItem;
  collapsed: boolean;
  onClick: () => void;
}) {
  const Icon = item.icon;
  const location = useLocation();
  const linkRef = useRef<HTMLAnchorElement>(null);
  const alsoActive = itemMatches(item, location.pathname);
  // Keep the current screen visible when the sidebar list is long enough to scroll.
  useEffect(() => {
    if (alsoActive) linkRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [alsoActive]);
  if (!item.to) return null;
  return (
    <NavLink
      ref={linkRef}
      to={item.to}
      // Exact match only — every entry here is its own distinct screen,
      // never a section header that should stay lit while a nested child
      // screen (with its own nav entry, e.g. /clinical/ipd vs
      // /clinical/ipd/nursing) is open.
      end={!item.matchPrefix}
      title={collapsed ? item.label : undefined}
      onClick={onClick}
      className={({ isActive }) =>
        `flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13.5px] font-medium transition-colors duration-150 ${collapsed ? "justify-center" : ""} ${
          isActive || alsoActive
            ? "bg-sidebar-active-bg font-semibold text-sidebar-active-text"
            : "text-sidebar-text-strong hover:bg-sidebar-hover"
        }`
      }
    >
      <Icon className="h-[17px] w-[17px] flex-shrink-0" />
      {!collapsed && item.label}
    </NavLink>
  );
}
