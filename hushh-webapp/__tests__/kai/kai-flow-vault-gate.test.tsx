import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const routerPushMock = vi.fn();
const routerReplaceMock = vi.fn();
const routerMock = {
  push: routerPushMock,
  replace: routerReplaceMock,
};

let vaultState: {
  vaultKey: string | null;
  vaultOwnerToken: string | null;
} = {
  vaultKey: null,
  vaultOwnerToken: null,
};

const getMetadataMock = vi.fn();
const importPortfolioStreamMock = vi.fn();
const consumeStreamMock = vi.fn();
const cacheState = {
  getPortfolioData: vi.fn(() => null),
  setPortfolioData: vi.fn(),
  invalidateDomain: vi.fn(),
};
const kaiStore = {
  setBusyOperation: vi.fn(),
  busyOperations: {},
  setLosersInput: vi.fn(),
  setAnalysisParams: vi.fn(),
};

vi.mock("next/navigation", () => ({
  useRouter: () => routerMock,
}));

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({
    user: { uid: "uid-1" },
    loading: false,
    isAuthenticated: true,
  }),
}));

vi.mock("@/lib/vault/vault-context", () => ({
  useVault: () => ({
    vaultKey: vaultState.vaultKey,
    vaultOwnerToken: vaultState.vaultOwnerToken,
  }),
}));

vi.mock("@/lib/cache/cache-context", () => ({
  useCache: () => cacheState,
}));

vi.mock("@/lib/stores/kai-session-store", () => ({
  useKaiSession: (selector: any) => selector(kaiStore),
}));

vi.mock("@/lib/services/world-model-service", () => ({
  WorldModelService: {
    getMetadata: (...args: any[]) => getMetadataMock(...args),
    loadFullBlob: vi.fn(),
    clearDomain: vi.fn(),
  },
}));

vi.mock("@/lib/services/api-service", () => ({
  ApiService: {
    importPortfolioStream: (...args: any[]) => importPortfolioStreamMock(...args),
  },
}));

vi.mock("@/lib/streaming/kai-stream-client", () => ({
  consumeCanonicalKaiStream: (...args: any[]) => consumeStreamMock(...args),
}));

vi.mock("@/lib/services/kai-service", () => ({
  getStockContext: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
  },
}));

vi.mock("@/components/kai/views/portfolio-import-view", () => ({
  PortfolioImportView: ({ onFileSelect }: any) => (
    <button
      onClick={() =>
        onFileSelect(new File(["file"], "statement.pdf", { type: "application/pdf" }))
      }
    >
      trigger-upload
    </button>
  ),
}));

vi.mock("@/components/kai/views/import-progress-view", () => ({
  ImportProgressView: () => <div>import-progress</div>,
}));

vi.mock("@/components/kai/views/portfolio-review-view", () => ({
  PortfolioReviewView: () => <div>review-view</div>,
}));

vi.mock("@/components/kai/views/dashboard-view", () => ({
  DashboardView: () => <div>dashboard-view</div>,
}));

vi.mock("@/components/kai/views/analysis-view", () => ({
  AnalysisView: () => <div>analysis-view</div>,
}));

vi.mock("@/components/kai/onboarding/KaiPreferencesSheet", () => ({
  KaiPreferencesSheet: () => null,
}));

vi.mock("@/components/vault/vault-flow", () => ({
  VaultFlow: ({ onSuccess }: any) => (
    <button
      onClick={() => {
        vaultState = {
          vaultKey: "vault-key-1",
          vaultOwnerToken: "vault-owner-token-1",
        };
        onSuccess?.();
      }}
    >
      complete-vault
    </button>
  ),
}));

import { KaiFlow } from "@/components/kai/kai-flow";

describe("KaiFlow vault-gated upload", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vaultState = {
      vaultKey: null,
      vaultOwnerToken: null,
    };
    cacheState.getPortfolioData.mockReturnValue(null);

    getMetadataMock.mockResolvedValue({
      domains: [],
    });

    importPortfolioStreamMock.mockResolvedValue(new Response(null, { status: 200 }));

    consumeStreamMock.mockImplementation(async (_response: Response, onEvent: any) => {
      onEvent({
        event: "complete",
        payload: {
          portfolio_data_v2: {
            holdings: [],
            account_summary: { ending_value: 0 },
          },
          quality_report_v2: {
            raw_count: 0,
            validated_count: 0,
            aggregated_count: 0,
          },
          progress_pct: 100,
          message: "done",
        },
        terminal: true,
      });
    });
  });

  it("opens vault flow when upload starts without vault", async () => {
    render(
      <KaiFlow
        userId="uid-1"
        mode="import"
        vaultOwnerToken=""
      />
    );

    await waitFor(() => {
      expect(screen.getByText("trigger-upload")).toBeTruthy();
    });

    fireEvent.click(screen.getByText("trigger-upload"));

    await waitFor(() => {
      expect(screen.getByText(/Create or unlock vault to import portfolio/i)).toBeTruthy();
    });

    expect(importPortfolioStreamMock).not.toHaveBeenCalled();
  });

  it("resumes queued upload after vault flow succeeds", async () => {
    render(
      <KaiFlow
        userId="uid-1"
        mode="import"
        vaultOwnerToken=""
      />
    );

    await waitFor(() => {
      expect(screen.getByText("trigger-upload")).toBeTruthy();
    });

    fireEvent.click(screen.getByText("trigger-upload"));

    await waitFor(() => {
      expect(screen.getByText("complete-vault")).toBeTruthy();
    });

    fireEvent.click(screen.getByText("complete-vault"));

    await waitFor(() => {
      expect(importPortfolioStreamMock).toHaveBeenCalledTimes(1);
    });
  });
});
