import { ROUTES } from "@/lib/navigation/routes";

export const RIA_ROUTE_TABS = [
  { id: "home", label: "Home", href: ROUTES.RIA_HOME },
  { id: "clients", label: "Clients", href: ROUTES.RIA_CLIENTS },
  { id: "activity", label: "Activity", href: ROUTES.RIA_REQUESTS },
  { id: "settings", label: "Settings", href: ROUTES.RIA_SETTINGS },
] as const;

export type RiaRouteTabId = (typeof RIA_ROUTE_TABS)[number]["id"];

export function activeRiaRouteTabFromPath(pathname: string): RiaRouteTabId {
  if (pathname === ROUTES.RIA_HOME || pathname.startsWith(`${ROUTES.RIA_HOME}?`)) return "home";
  if (pathname.startsWith(ROUTES.RIA_CLIENTS) || pathname.startsWith("/ria/workspace/")) {
    return "clients";
  }
  if (pathname.startsWith(ROUTES.RIA_REQUESTS)) return "activity";
  if (pathname.startsWith(ROUTES.RIA_SETTINGS)) return "settings";
  return "home";
}
