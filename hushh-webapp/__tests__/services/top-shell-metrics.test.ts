import { describe, expect, it } from "vitest";

import { ROUTES } from "@/lib/navigation/routes";
import {
  resolveTopShellMetrics,
  resolveTopShellRouteProfile,
} from "@/components/app-ui/top-shell-metrics";

describe("top shell metrics route profile", () => {
  it("hides shell on home/login/logout routes", () => {
    const home = resolveTopShellMetrics(ROUTES.HOME);
    const login = resolveTopShellMetrics(ROUTES.LOGIN);
    const logout = resolveTopShellMetrics(ROUTES.LOGOUT);

    expect(home.shellVisible).toBe(false);
    expect(home.hasTabs).toBe(false);

    expect(login.shellVisible).toBe(false);
    expect(logout.shellVisible).toBe(false);
  });

  it("enables tabs for kai routes outside fullscreen flow", () => {
    const kaiHome = resolveTopShellMetrics(ROUTES.KAI_HOME);
    const kaiDashboard = resolveTopShellMetrics(ROUTES.KAI_DASHBOARD);
    const kaiAnalysis = resolveTopShellMetrics(ROUTES.KAI_ANALYSIS);

    expect(kaiHome.shellVisible).toBe(true);
    expect(kaiHome.hasTabs).toBe(true);
    expect(kaiHome.contentOffsetMode).toBe("normal");

    expect(kaiDashboard.hasTabs).toBe(true);
    expect(kaiAnalysis.hasTabs).toBe(true);
  });

  it("uses fullscreen-flow mode only for kai onboarding", () => {
    const onboarding = resolveTopShellMetrics(ROUTES.KAI_ONBOARDING);
    const kaiImport = resolveTopShellMetrics(ROUTES.KAI_IMPORT);

    expect(onboarding.shellVisible).toBe(true);
    expect(onboarding.hasTabs).toBe(false);
    expect(onboarding.contentOffsetMode).toBe("fullscreen-flow");

    expect(kaiImport.shellVisible).toBe(true);
    expect(kaiImport.hasTabs).toBe(true);
    expect(kaiImport.contentOffsetMode).toBe("normal");
  });

  it("keeps shell visible without tabs on non-kai app routes", () => {
    const consents = resolveTopShellMetrics(ROUTES.CONSENTS);
    const profile = resolveTopShellMetrics(ROUTES.PROFILE);
    const chat = resolveTopShellMetrics("/chat");
    const apiDocs = resolveTopShellMetrics("/api-docs");
    const agentNav = resolveTopShellMetrics("/agent-nav");

    expect(consents.shellVisible).toBe(true);
    expect(consents.hasTabs).toBe(false);
    expect(consents.contentOffsetMode).toBe("normal");

    expect(profile.shellVisible).toBe(true);
    expect(profile.hasTabs).toBe(false);

    expect(chat.shellVisible).toBe(true);
    expect(chat.hasTabs).toBe(false);

    expect(apiDocs.shellVisible).toBe(true);
    expect(apiDocs.hasTabs).toBe(false);

    expect(agentNav.shellVisible).toBe(true);
    expect(agentNav.hasTabs).toBe(false);
  });

  it("defaults unknown routes to shell-visible compact spacing", () => {
    const unknown = resolveTopShellMetrics("/new-product-page");
    const unknownProfile = resolveTopShellRouteProfile("/new-product-page");

    expect(unknownProfile.id).toBe("default-no-tabs");
    expect(unknown.shellVisible).toBe(true);
    expect(unknown.hasTabs).toBe(false);
    expect(unknown.contentOffsetMode).toBe("normal");
  });
});
