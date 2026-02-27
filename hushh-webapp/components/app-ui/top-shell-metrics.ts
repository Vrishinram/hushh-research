import { ROUTES } from "@/lib/navigation/routes";

export type TopContentOffsetMode = "normal" | "fullscreen-flow";

export interface TopShellMetrics {
  shellVisible: boolean;
  hasTabs: boolean;
  contentOffsetMode: TopContentOffsetMode;
}

function routeMatches(pathname: string, route: string): boolean {
  return pathname === route || pathname.startsWith(`${route}/`);
}

export function shouldHideTopShell(pathname: string): boolean {
  return (
    pathname === ROUTES.HOME ||
    routeMatches(pathname, ROUTES.LOGIN) ||
    routeMatches(pathname, ROUTES.LOGOUT)
  );
}

export function isTopShellFullscreenFlowRoute(pathname: string): boolean {
  return (
    routeMatches(pathname, ROUTES.KAI_ONBOARDING) ||
    routeMatches(pathname, ROUTES.KAI_IMPORT)
  );
}

export function shouldShowKaiTabsInTopShell(pathname: string): boolean {
  return routeMatches(pathname, ROUTES.KAI_HOME) && !isTopShellFullscreenFlowRoute(pathname);
}

export function resolveTopShellMetrics(pathname: string): TopShellMetrics {
  if (shouldHideTopShell(pathname)) {
    return {
      shellVisible: false,
      hasTabs: false,
      contentOffsetMode: "normal",
    };
  }

  const fullscreenFlow = isTopShellFullscreenFlowRoute(pathname);
  const hasTabs = shouldShowKaiTabsInTopShell(pathname);

  return {
    shellVisible: true,
    hasTabs,
    contentOffsetMode: fullscreenFlow ? "fullscreen-flow" : "normal",
  };
}

export function resolveTopShellHeight(pathname: string): string {
  return resolveTopShellMetrics(pathname).shellVisible
    ? "var(--top-shell-h)"
    : "0px";
}
