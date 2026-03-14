"use client";

import { ApiService } from "@/lib/services/api-service";
import type {
  PlaidPortfolioStatusResponse,
  PortfolioSource,
} from "@/lib/kai/brokerage/portfolio-sources";

export interface PlaidLinkTokenResponse {
  configured: boolean;
  mode: string;
  link_token: string | null;
  expiration?: string | null;
  redirect_uri?: string | null;
  request_id?: string | null;
  resume_session_id?: string | null;
}

export interface PlaidRefreshResponse {
  accepted: boolean;
  runs: Array<Record<string, unknown>>;
}

export class PlaidPortfolioService {
  static async getStatus(params: {
    userId: string;
    vaultOwnerToken: string;
  }): Promise<PlaidPortfolioStatusResponse> {
    const response = await ApiService.apiFetch(
      `/api/kai/plaid/status/${encodeURIComponent(params.userId)}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${params.vaultOwnerToken}`,
        },
      }
    );
    if (!response.ok) {
      throw new Error(`Failed to load Plaid portfolio status: ${response.status}`);
    }
    return (await response.json()) as PlaidPortfolioStatusResponse;
  }

  static async createLinkToken(params: {
    userId: string;
    vaultOwnerToken: string;
    itemId?: string;
    updateMode?: boolean;
    redirectUri?: string;
  }): Promise<PlaidLinkTokenResponse> {
    const path = params.updateMode
      ? "/api/kai/plaid/link-token/update"
      : "/api/kai/plaid/link-token";
    const response = await ApiService.apiFetch(path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${params.vaultOwnerToken}`,
      },
      body: JSON.stringify({
        user_id: params.userId,
        item_id: params.itemId,
        redirect_uri: params.redirectUri || null,
      }),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`Failed to create Plaid link token: ${response.status} ${detail}`);
    }
    return (await response.json()) as PlaidLinkTokenResponse;
  }

  static async exchangePublicToken(params: {
    userId: string;
    publicToken: string;
    vaultOwnerToken: string;
    metadata?: Record<string, unknown> | null;
    resumeSessionId?: string | null;
  }): Promise<PlaidPortfolioStatusResponse> {
    const response = await ApiService.apiFetch("/api/kai/plaid/exchange-public-token", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${params.vaultOwnerToken}`,
      },
      body: JSON.stringify({
        user_id: params.userId,
        public_token: params.publicToken,
        metadata: params.metadata || null,
        resume_session_id: params.resumeSessionId || null,
      }),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`Failed to exchange Plaid public token: ${response.status} ${detail}`);
    }
    return (await response.json()) as PlaidPortfolioStatusResponse;
  }

  static async refresh(params: {
    userId: string;
    vaultOwnerToken: string;
    itemId?: string;
  }): Promise<PlaidRefreshResponse> {
    const response = await ApiService.apiFetch("/api/kai/plaid/refresh", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${params.vaultOwnerToken}`,
      },
      body: JSON.stringify({
        user_id: params.userId,
        item_id: params.itemId,
      }),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`Failed to refresh Plaid connection: ${response.status} ${detail}`);
    }
    return (await response.json()) as PlaidRefreshResponse;
  }

  static async resumeOAuth(params: {
    userId: string;
    resumeSessionId: string;
    vaultOwnerToken: string;
  }): Promise<PlaidLinkTokenResponse> {
    const response = await ApiService.apiFetch("/api/kai/plaid/oauth/resume", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${params.vaultOwnerToken}`,
      },
      body: JSON.stringify({
        user_id: params.userId,
        resume_session_id: params.resumeSessionId,
      }),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`Failed to resume Plaid OAuth: ${response.status} ${detail}`);
    }
    return (await response.json()) as PlaidLinkTokenResponse;
  }

  static async getRefreshRun(params: {
    userId: string;
    runId: string;
    vaultOwnerToken: string;
  }): Promise<{ run: Record<string, unknown> }> {
    const query = new URLSearchParams({ user_id: params.userId }).toString();
    const response = await ApiService.apiFetch(
      `/api/kai/plaid/refresh/${encodeURIComponent(params.runId)}?${query}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${params.vaultOwnerToken}`,
        },
      }
    );
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`Failed to fetch Plaid refresh run: ${response.status} ${detail}`);
    }
    return (await response.json()) as { run: Record<string, unknown> };
  }

  static async setActiveSource(params: {
    userId: string;
    activeSource: PortfolioSource;
    vaultOwnerToken: string;
  }): Promise<{ user_id: string; active_source: PortfolioSource }> {
    const response = await ApiService.apiFetch("/api/kai/plaid/source", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${params.vaultOwnerToken}`,
      },
      body: JSON.stringify({
        user_id: params.userId,
        active_source: params.activeSource,
      }),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`Failed to update portfolio source preference: ${response.status} ${detail}`);
    }
    return (await response.json()) as { user_id: string; active_source: PortfolioSource };
  }
}
