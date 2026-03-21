"use client";

import { useEffect, useMemo, useState } from "react";
import { Code2, Loader2, ShieldAlert, Vault } from "lucide-react";

import {
  AppPageContentRegion,
  AppPageHeaderRegion,
  AppPageShell,
} from "@/components/app-ui/app-page-shell";
import { PageHeader } from "@/components/app-ui/page-sections";
import { SurfaceInset, SurfaceStack } from "@/components/app-ui/surfaces";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/lib/morphy-ux/morphy";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/use-auth";
import { ApiService } from "@/lib/services/api-service";
import {
  getDeveloperAccess,
  type DeveloperPortalAccess,
} from "@/lib/services/developer-portal-service";
import { WorldModelService } from "@/lib/services/world-model-service";
import { useVault } from "@/lib/vault/vault-context";

type AgentLabResponse = {
  agent_id: string;
  agent_name: string;
  model: string;
  used_fallback: boolean;
  error?: string | null;
  structure_decision: Record<string, unknown>;
  manifest_draft?: Record<string, unknown> | null;
};

const INITIAL_JSON = `{
  "notes": {
    "preferred_workflow": "weekly meal prep",
    "travel_style": "short city breaks"
  }
}`;

export default function PkmAgentLabPage() {
  const { user, loading } = useAuth();
  const { isVaultUnlocked, vaultOwnerToken } = useVault();
  const [access, setAccess] = useState<DeveloperPortalAccess | null>(null);
  const [accessLoading, setAccessLoading] = useState(true);
  const [currentDomains, setCurrentDomains] = useState<string[]>([]);
  const [message, setMessage] = useState("Remember that I prefer short city breaks and weekly meal prep.");
  const [candidateDomain, setCandidateDomain] = useState("");
  const [candidateJson, setCandidateJson] = useState(INITIAL_JSON);
  const [response, setResponse] = useState<AgentLabResponse | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadAccess() {
      if (loading) {
        return;
      }
      if (!user) {
        if (!cancelled) {
          setAccess(null);
          setAccessLoading(false);
        }
        return;
      }

      setAccessLoading(true);
      try {
        const idToken = await user.getIdToken();
        const [developerAccess, metadata] = await Promise.all([
          getDeveloperAccess(idToken),
          isVaultUnlocked && vaultOwnerToken
            ? WorldModelService.getMetadata(user.uid, false, vaultOwnerToken).catch(() => null)
            : Promise.resolve(null),
        ]);
        if (!cancelled) {
          setAccess(developerAccess);
          setCurrentDomains(metadata?.domains.map((domain) => domain.key) || []);
        }
      } catch (nextError) {
        if (!cancelled) {
          setAccess(null);
          setCurrentDomains([]);
          setError(nextError instanceof Error ? nextError.message : "Failed to load developer access.");
        }
      } finally {
        if (!cancelled) {
          setAccessLoading(false);
        }
      }
    }

    void loadAccess();
    return () => {
      cancelled = true;
    };
  }, [isVaultUnlocked, loading, user, vaultOwnerToken]);

  const canUseLab = Boolean(user && access?.access_enabled && isVaultUnlocked && vaultOwnerToken);
  const prettyResponse = useMemo(
    () => (response ? JSON.stringify(response, null, 2) : ""),
    [response]
  );

  async function handlePreview() {
    if (!user || !vaultOwnerToken) {
      setError("Unlock your vault before using Agent Lab.");
      return;
    }

    let candidateData: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(candidateJson || "{}");
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("Candidate JSON must be an object.");
      }
      candidateData = parsed as Record<string, unknown>;
    } catch (parseError) {
      setError(parseError instanceof Error ? parseError.message : "Invalid JSON payload.");
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const result = await ApiService.apiFetch("/api/pkm/agent-lab/structure", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${vaultOwnerToken}`,
        },
        body: JSON.stringify({
          user_id: user.uid,
          message,
          current_domains: currentDomains,
          candidate_domain: candidateDomain || null,
          candidate_data: candidateData,
        }),
      });

      if (!result.ok) {
        const detail = await result.text();
        throw new Error(detail || `Agent lab request failed with ${result.status}`);
      }

      const payload = (await result.json()) as AgentLabResponse;
      setResponse(payload);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to preview PKM structure.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AppPageShell>
      <AppPageHeaderRegion>
        <PageHeader
          eyebrow="Profile / Developer Tools"
          title="PKM Agent Lab"
          description="Use your live account, unlocked vault, and current domains to inspect deterministic PKM structure decisions before we store anything."
        />
      </AppPageHeaderRegion>

      <AppPageContentRegion>
        <SurfaceStack compact>
          <SurfaceInset className="space-y-3 px-4 py-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary">{user ? "Signed in" : "Signed out"}</Badge>
              <Badge variant="secondary">{isVaultUnlocked ? "Vault unlocked" : "Vault locked"}</Badge>
              <Badge variant="secondary">
                {access?.access_enabled ? "Developer access enabled" : "Developer access required"}
              </Badge>
              {currentDomains.length > 0 ? (
                <Badge variant="secondary">{currentDomains.length} current domains</Badge>
              ) : null}
            </div>
            {accessLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading developer access and PKM metadata...
              </div>
            ) : null}
            {!user ? (
              <div className="flex items-center gap-2 text-sm text-amber-700">
                <ShieldAlert className="h-4 w-4" />
                Sign in first to use Agent Lab.
              </div>
            ) : null}
            {user && !isVaultUnlocked ? (
              <div className="flex items-center gap-2 text-sm text-amber-700">
                <Vault className="h-4 w-4" />
                Unlock your vault from Profile before previewing PKM structure.
              </div>
            ) : null}
            {user && isVaultUnlocked && !access?.access_enabled ? (
              <div className="flex items-center gap-2 text-sm text-amber-700">
                <Code2 className="h-4 w-4" />
                Developer access is required for this tool.
              </div>
            ) : null}
          </SurfaceInset>

          <SurfaceInset className="space-y-4 px-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Natural language prompt</label>
              <Textarea
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                placeholder="Describe the memory or user preference you want Kai to structure."
                className="min-h-28"
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Candidate domain hint</label>
              <Input
                value={candidateDomain}
                onChange={(event) => setCandidateDomain(event.target.value)}
                placeholder="Optional, for example travel or food"
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Candidate JSON payload</label>
              <Textarea
                value={candidateJson}
                onChange={(event) => setCandidateJson(event.target.value)}
                className="min-h-64 font-mono text-xs"
                spellCheck={false}
              />
            </div>

            <Button onClick={() => void handlePreview()} disabled={!canUseLab || submitting}>
              {submitting ? "Generating preview..." : "Preview PKM structure"}
            </Button>

            {error ? (
              <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-3 text-sm text-red-700">
                {error}
              </div>
            ) : null}
          </SurfaceInset>

          <SurfaceInset className="space-y-3 px-4 py-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold">Structured output</h2>
                <p className="text-sm text-muted-foreground">
                  This is the exact payload returned by the PKM structure path.
                </p>
              </div>
              {response ? (
                <Badge variant="secondary">
                  {response.used_fallback ? "Deterministic fallback" : response.model}
                </Badge>
              ) : null}
            </div>
            <pre className="overflow-x-auto rounded-2xl border bg-muted/40 p-4 text-xs leading-6">
              {prettyResponse || "No preview generated yet."}
            </pre>
          </SurfaceInset>
        </SurfaceStack>
      </AppPageContentRegion>
    </AppPageShell>
  );
}
