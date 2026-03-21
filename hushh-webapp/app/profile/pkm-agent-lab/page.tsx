"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronUp, Code2, Loader2, ShieldAlert, Vault } from "lucide-react";
import { useRouter } from "next/navigation";

import { SurfaceInset } from "@/components/app-ui/surfaces";
import { PkmSettingsShell } from "@/components/profile/pkm-settings-shell";
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
import { type DomainManifest } from "@/lib/personal-knowledge-model/manifest";
import { PersonalKnowledgeModelService } from "@/lib/services/personal-knowledge-model-service";
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
  const router = useRouter();
  const { user, loading } = useAuth();
  const { isVaultUnlocked, vaultKey, vaultOwnerToken } = useVault();
  const [access, setAccess] = useState<DeveloperPortalAccess | null>(null);
  const [accessLoading, setAccessLoading] = useState(true);
  const [currentDomains, setCurrentDomains] = useState<string[]>([]);
  const [message, setMessage] = useState("Remember that I prefer short city breaks and weekly meal prep.");
  const [candidateDomain, setCandidateDomain] = useState("");
  const [candidateJson, setCandidateJson] = useState(INITIAL_JSON);
  const [response, setResponse] = useState<AgentLabResponse | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [showDeveloperOverrides, setShowDeveloperOverrides] = useState(false);

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
            ? PersonalKnowledgeModelService.getMetadata(user.uid, false, vaultOwnerToken).catch(
                () => null
              )
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
  const backendOrganization = useMemo(() => {
    if (!response) return null;
    const structureDecision =
      response.structure_decision && typeof response.structure_decision === "object"
        ? response.structure_decision
        : {};
    const manifestDraft =
      response.manifest_draft && typeof response.manifest_draft === "object"
        ? response.manifest_draft
        : null;
    const toStringArray = (value: unknown): string[] =>
      Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
    const targetDomain =
      (typeof manifestDraft?.domain === "string" && manifestDraft.domain) ||
      (typeof structureDecision.target_domain === "string" && structureDecision.target_domain) ||
      "general";
    const segmentIds = toStringArray(manifestDraft?.segment_ids);
    const topLevelScopes = toStringArray(
      manifestDraft?.top_level_scope_paths ?? structureDecision.top_level_scope_paths
    );
    const externalizablePaths = toStringArray(
      manifestDraft?.externalizable_paths ?? structureDecision.externalizable_paths
    );
    const pathCount =
      typeof manifestDraft?.path_count === "number"
        ? manifestDraft.path_count
        : Array.isArray(manifestDraft?.paths)
          ? manifestDraft.paths.length
          : 0;
    const scopeRegistryCount = Array.isArray(manifestDraft?.scope_registry)
      ? manifestDraft.scope_registry.length
      : 0;
    const manifestVersion =
      typeof manifestDraft?.manifest_version === "number" ? manifestDraft.manifest_version : 1;
    return {
      targetDomain,
      action:
        typeof structureDecision.action === "string"
          ? structureDecision.action
          : "match_existing_domain",
      segmentIds,
      topLevelScopes,
      externalizablePaths,
      pathCount,
      scopeRegistryCount,
      manifestVersion,
    };
  }, [response]);

  function parseCandidatePayload(): Record<string, unknown> {
    const parsed = JSON.parse(candidateJson || "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Candidate JSON must be an object.");
    }
    return parsed as Record<string, unknown>;
  }

  async function handlePreview() {
    if (!user || !vaultOwnerToken) {
      setError("Unlock your vault before using Agent Lab.");
      return;
    }

    try {
      const candidateData = parseCandidatePayload();
      setSubmitting(true);
      setError(null);
      setSaveMessage(null);
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
    } catch (parseError) {
      setError(parseError instanceof Error ? parseError.message : "Invalid JSON payload.");
    }
  }

  async function handleSaveToPkm() {
    if (!user || !vaultOwnerToken || !vaultKey) {
      setError("Unlock your vault before saving to PKM.");
      return;
    }
    if (!response) {
      setError("Generate a preview before saving to PKM.");
      return;
    }

    try {
      const candidateData = parseCandidatePayload();
      const structureDecision =
        response.structure_decision && typeof response.structure_decision === "object"
          ? response.structure_decision
          : {};
      const manifestDraft =
        response.manifest_draft && typeof response.manifest_draft === "object"
          ? response.manifest_draft
          : null;
      const targetDomain =
        (typeof manifestDraft?.domain === "string" && manifestDraft.domain) ||
        (typeof structureDecision.target_domain === "string" && structureDecision.target_domain) ||
        "";
      if (!targetDomain) {
        throw new Error("Preview did not produce a target domain.");
      }

      const summaryProjection =
        structureDecision.summary_projection &&
        typeof structureDecision.summary_projection === "object"
          ? (structureDecision.summary_projection as Record<string, unknown>)
          : {};

      setSaving(true);
      setError(null);
      setSaveMessage(null);
      const result = await PersonalKnowledgeModelService.storePreparedDomain({
        userId: user.uid,
        vaultKey,
        vaultOwnerToken,
        domain: targetDomain,
        domainData: candidateData,
        summary: {
          ...summaryProjection,
          message_excerpt: message.slice(0, 160),
        },
        structureDecision: structureDecision as Record<string, unknown>,
        manifest: manifestDraft as DomainManifest | null,
      });

      if (!result.success) {
        throw new Error(result.message || "Failed to save candidate payload to PKM.");
      }

      const metadata = await PersonalKnowledgeModelService.getMetadata(
        user.uid,
        true,
        vaultOwnerToken
      ).catch(() => null);
      setCurrentDomains(metadata?.domains.map((domain) => domain.key) || currentDomains);
      setSaveMessage(`Saved ${targetDomain} to your PKM.`);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to save PKM payload.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <PkmSettingsShell
      activePage="agent-lab"
      title="PKM Agent Lab"
      description="Use your live account, unlocked vault, and current domains to inspect deterministic PKM structure decisions, backend organization, and optional PKM writes."
    >
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
          <p className="text-xs text-muted-foreground">
            This is the real intent-capture input. The rest of this page is here to help us inspect
            how the prompt maps into PKM storage.
          </p>
        </div>

        <div className="rounded-2xl border bg-muted/20">
          <button
            type="button"
            className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
            onClick={() => setShowDeveloperOverrides((current) => !current)}
          >
            <div>
              <p className="text-sm font-semibold">Developer overrides</p>
              <p className="text-xs text-muted-foreground">
                Optional domain and payload hints for deterministic PKM debugging.
              </p>
            </div>
            {showDeveloperOverrides ? (
              <ChevronUp className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            )}
          </button>
          {showDeveloperOverrides ? (
            <div className="space-y-4 border-t px-4 py-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Optional domain hint</label>
                <Input
                  value={candidateDomain}
                  onChange={(event) => setCandidateDomain(event.target.value)}
                  placeholder="Optional developer override, for example travel or food"
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Optional developer payload override</label>
                <Textarea
                  value={candidateJson}
                  onChange={(event) => setCandidateJson(event.target.value)}
                  className="min-h-64 font-mono text-xs"
                  spellCheck={false}
                />
              </div>
            </div>
          ) : null}
        </div>

        <div className="flex flex-wrap gap-3">
          <Button onClick={() => void handlePreview()} disabled={!canUseLab || submitting || saving}>
            {submitting ? "Generating preview..." : "Preview PKM structure"}
          </Button>
          <Button
            variant="none"
            effect="fade"
            onClick={() => void handleSaveToPkm()}
            disabled={!canUseLab || !response || submitting || saving}
          >
            {saving ? "Saving to PKM..." : "Save to PKM"}
          </Button>
          <Button variant="none" effect="fade" onClick={() => router.push("/profile/pkm")}>
            Open PKM Viewer
          </Button>
        </div>

        {error ? (
          <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-3 text-sm text-red-700">
            {error}
          </div>
        ) : null}
        {saveMessage ? (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-3 text-sm text-emerald-700">
            {saveMessage}
          </div>
        ) : null}
      </SurfaceInset>

      <SurfaceInset className="space-y-3 px-4 py-4">
        <div>
          <h2 className="text-sm font-semibold">Backend organization</h2>
          <p className="text-sm text-muted-foreground">
            This shows how the preview would map into PKM storage on the backend.
          </p>
        </div>
        {backendOrganization ? (
          <div className="space-y-3 rounded-2xl border bg-muted/30 p-4 text-sm">
            <div className="flex flex-wrap gap-2">
              <Badge variant="secondary">Domain: {backendOrganization.targetDomain}</Badge>
              <Badge variant="secondary">Action: {backendOrganization.action}</Badge>
              <Badge variant="secondary">Manifest v{backendOrganization.manifestVersion}</Badge>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <p className="font-medium">Segments</p>
                <p className="text-muted-foreground">
                  {backendOrganization.segmentIds.length > 0
                    ? backendOrganization.segmentIds.join(", ")
                    : "No explicit segments yet"}
                </p>
              </div>
              <div>
                <p className="font-medium">Top-level scopes</p>
                <p className="text-muted-foreground">
                  {backendOrganization.topLevelScopes.length > 0
                    ? backendOrganization.topLevelScopes.join(", ")
                    : "No scopes derived yet"}
                </p>
              </div>
              <div>
                <p className="font-medium">Manifest paths</p>
                <p className="text-muted-foreground">{backendOrganization.pathCount}</p>
              </div>
              <div>
                <p className="font-medium">Scope registry entries</p>
                <p className="text-muted-foreground">{backendOrganization.scopeRegistryCount}</p>
              </div>
            </div>
            <div>
              <p className="font-medium">Backend tables touched on save</p>
              <p className="text-muted-foreground">
                pkm_blobs, pkm_manifests, pkm_manifest_paths, pkm_scope_registry, pkm_index, and
                pkm_events
              </p>
            </div>
            <div>
              <p className="font-medium">Externalizable paths</p>
              <p className="text-muted-foreground">
                {backendOrganization.externalizablePaths.length > 0
                  ? backendOrganization.externalizablePaths.join(", ")
                  : "No externalizable paths derived yet"}
              </p>
            </div>
          </div>
        ) : (
          <div className="rounded-2xl border bg-muted/30 p-4 text-sm text-muted-foreground">
            Generate a preview to see the backend storage plan.
          </div>
        )}
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
    </PkmSettingsShell>
  );
}
