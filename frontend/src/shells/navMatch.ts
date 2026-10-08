import type { NavItem } from "./navConfig";

/** Whether `pathname` is `prefix` itself or a route nested under it. */
function isWithin(pathname: string, prefix: string) {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/**
 * Whether a leaf nav item is the current screen. Mirrors what <NavLink> does
 * for the exact/`matchPrefix` rule, plus the `alsoActiveFor` extra prefixes.
 */
export function itemMatches(item: NavItem, pathname: string) {
  if (!item.to) return false;
  const own = item.matchPrefix ? isWithin(pathname, item.to) : pathname === item.to;
  return own || (item.alsoActiveFor ?? []).some((prefix) => isWithin(pathname, prefix));
}

/** Whether any child of an expandable group is the current screen. */
export function groupContainsActive(item: NavItem, pathname: string) {
  return (item.children ?? []).some((child) => itemMatches(child, pathname));
}
