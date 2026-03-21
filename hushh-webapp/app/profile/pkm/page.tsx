"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Database,
  FileJson,
  FolderTree,
  KeyRound,
  Loader2,
  RefreshCw,
  ShieldAlert,
  Vault,
} from "lucide-react";

import { SectionHeader } from "@/components/app-ui/page-sections";
import {
  SurfaceCard,
  SurfaceCardContent,
  SurfaceInset,
} from "@/components/app-ui/surfaces";
import { PkmSettingsShell } from "@/components/profile/pkm-settings-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/lib/morphy-ux/morphy";
import { useAuth } from "@/hooks/use-auth";
import {
  PersonalKnowledgeModelService,
  type DomainSummary,
  type EncryptedDomainBlob,
  type ScopeDiscovery,
  type WorldModelMetadata,
} from "@/lib/services/personal-knowledge-model-service";
import { type DomainManifest } from "@/lib/personal-knowledge-model/manifest";
import { useVault } from "@/lib/vault/vault-context";

type DomainInspectorState = {
  manifest: DomainManifest | null;
  encrypted: EncryptedDomainBlob | null;
  decrypted: Record<string, unknown> | null;
  error: string | null;
  loading: boolean;
};

function formatTimestamp(value: string | null | undefined): string {
  if (!value) return "Unavailable";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function prettyJson(value: unknown): string {
  if (value === null || value === undefined) return "Unavailable";
  return JSON.stringify(value, null, 2);
}

export default function PkmViewerPage() {
  const { user, loading } = useAuth();
  const { isVaultUnlocked, vaultKey, vaultOwnerToken } = useVault();

  const [metadata, setMetadata] = useState<WorldModelMetadata | null>(null);
  const [scopeDiscovery, setScopeDiscovery] = useState<ScopeDiscovery | null>(null);
  const [selectedDomain, setSelectedDomain] = useState<string | null>(null);
  const [bootstrapLoading, setBootstrapLoading] = useState(true);
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);
  const [domainState, setDomainState] = useState<DomainInspectorState>({
    manifest: null,
    encrypted: null,
    decrypted: null,
    error: null,
    loading: false,
  });

  useEffect(() => {
    let cancelled = false;

    async function loadBootstrap(forceRefresh = false) {
      if (loading) {
        return;
      }
      if (!user) {
        if (!cancelled) {
          setMetadata(null);
          setScopeDiscovery(null);
          setSelectedDomain(null);
          setBootstrapLoading(false);
        }
        return;
      }
      if (!isVaultUnlocked || !vaultOwnerToken) {
        if (!cancelled) {
          setMetadata(null);
          setScopeDiscovery(null);
          setSelectedDomain(null);
          setBootstrapLoading(false);
        }
        return;
      }

      setBootstrapLoading(true);
      setBootstrapError(null);
      try {
        const [nextMetadata, nextScopes] = await Promise.all([
          PersonalKnowledgeModelService.getMetadata(user.uid, forceRefresh, vaultOwnerToken),
          PersonalKnowledgeModelService.getAvailableScopes(user.uid, vaultOwnerToken),
        ]);
        if (cancelled) return;
        setMetadata(nextMetadata);
        setScopeDiscovery(nextScopes);
        setSelectedDomain((current) => {
          if (current && nextMetadata.domains.some((domain) => domain.key === current)) {
            return current;
          }
          return nextMetadata.domains[0]?.key || null;
        });
      } catch (nextError) {
        if (!cancelled) {
          setBootstrapError(
            nextError instanceof Error ? nextError.message : "Failed to load PKM viewer."
          );
        }
      } finally {
        if (!cancelled) {
          setBootstrapLoading(false);
        }
      }
    }

    void loadBootstrap();
    return () => {
      cancelled = true;
    };
  }, [isVaultUnlocked, loading, user, vaultKey, vaultOwnerToken]);

  useEffect(() => {
    let cancelled = false;

    async function loadDomainState() {
      if (!user || !selectedDomain || !vaultKey || !vaultOwnerToken || !isVaultUnlocked) {
        if (!cancelled) {
          setDomainState({
            manifest: null,
            encrypted: null,
            decrypted: null,
            error: null,
            loading: false,
          });
        }
        return;
      }

      setDomainState((current) => ({ ...current, loading: true, error: null }));
      try {
        const [manifest, encrypted, decrypted] = await Promise.all([
          PersonalKnowledgeModelService.getDomainManifest(
            user.uid,
            selectedDomain,
            vaultOwnerToken
          ),
          PersonalKnowledgeModelService.getDomainData(user.uid, selectedDomain, vaultOwnerToken),
          PersonalKnowledgeModelService.loadDomainData({
            userId: user.uid,
            domain: selectedDomain,
            vaultKey,
            vaultOwnerToken,
          }),
        ]);
        if (cancelled) return;
        setDomainState({
          manifest,
          encrypted,
          decrypted,
          error: null,
          loading: false,
        });
      } catch (nextError) {
        if (!cancelled) {
          setDomainState({
            manifest: null,
            encrypted: null,
            decrypted: null,
            error: nextError instanceof Error ? nextError.message : "Failed to load PKM domain.",
            loading: false,
          });
        }
      }
    }

    void loadDomainState();
    return () => {
      cancelled = true;
    };
  }, [isVaultUnlocked, selectedDomain, user, vaultKey, vaultOwnerToken]);

  const selectedSummary = useMemo<DomainSummary | null>(() => {
    if (!metadata || !selectedDomain) return null;
    return metadata.domains.find((domain) => domain.key === selectedDomain) || null;
  }, [metadata, selectedDomain]);

  const selectedScopeEntries = useMemo(() => {
    return domainState.manifest?.scope_registry || [];
  }, [domainState.manifest]);

  const selectedPaths = useMemo(() => {
    return domainState.manifest?.paths || [];
  }, [domainState.manifest]);

  async function handleRefresh() {
    if (!user || !vaultOwnerToken || !isVaultUnlocked) {
      return;
    }
    setBootstrapLoading(true);
    setBootstrapError(null);
    try {
      const [nextMetadata, nextScopes] = await Promise.all([
        PersonalKnowledgeModelService.getMetadata(user.uid, true, vaultOwnerToken),
        PersonalKnowledgeModelService.getAvailableScopes(user.uid, vaultOwnerToken),
      ]);
      setMetadata(nextMetadata);
      setScopeDiscovery(nextScopes);
      setSelectedDomain((current) => {
        if (current && nextMetadata.domains.some((domain) => domain.key === current)) {
          return current;
        }
        return nextMetadata.domains[0]?.key || null;
      });
    } catch (nextError) {
      setBootstrapError(nextError instanceof Error ? nextError.message : "Failed to refresh PKM.");
    } finally {
      setBootstrapLoading(false);
    }
  }

  return (
    <PkmSettingsShell
      activePage="viewer"
      title="PKM Viewer"
      description="Inspect your current domains, manifests, scope registry, encrypted segment layout, and first-party decrypted payload preview."
      actions={
        <Button
          variant="none"
          effect="fade"
          onClick={() => void handleRefresh()}
          disabled={!user || !isVaultUnlocked || bootstrapLoading}
        >
          {bootstrapLoading ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="mr-2 h-4 w-4" />
          )}
          Refresh
        </Button>
      }
    >
      <SurfaceInset className="space-y-3 px-4 py-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">{user ? "Signed in" : "Signed out"}</Badge>
          <Badge variant="secondary">{isVaultUnlocked ? "Vault unlocked" : "Vault locked"}</Badge>
          <Badge variant="secondary">
            {metadata ? `${metadata.domains.length} domains` : "No PKM loaded"}
          </Badge>
          {metadata ? <Badge variant="secondary">{metadata.totalAttributes} attributes</Badge> : null}
          {scopeDiscovery ? <Badge variant="secondary">{scopeDiscovery.allScopes.length} scopes</Badge> : null}
        </div>
        {!user ? (
          <div className="flex items-center gap-2 text-sm text-amber-700">
            <ShieldAlert className="h-4 w-4" />
            Sign in first to inspect your PKM.
          </div>
        ) : null}
        {user && !isVaultUnlocked ? (
          <div className="flex items-center gap-2 text-sm text-amber-700">
            <Vault className="h-4 w-4" />
            Unlock your vault from Profile before loading PKM data.
          </div>
        ) : null}
        {bootstrapError ? (
          <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-3 text-sm text-red-700">
            {bootstrapError}
          </div>
        ) : null}
      </SurfaceInset>

      <div className="grid gap-4 xl:grid-cols-[300px_minmax(0,1fr)]">
        <SurfaceInset className="space-y-4 px-4 py-4">
          <SectionHeader
            eyebrow="Domains"
            title="Current PKM domains"
            description="Select a domain to inspect how it is stored and exposed."
            icon={FolderTree}
            accent="sky"
          />
          {metadata?.domains.length ? (
            <div className="space-y-3">
              {metadata.domains.map((domain) => {
                const isActive = selectedDomain === domain.key;
                return (
                  <button
                    key={domain.key}
                    type="button"
                    className={`w-full rounded-2xl border px-4 py-3 text-left transition ${
                      isActive
                        ? "border-sky-400 bg-sky-50/80"
                        : "border-border bg-background hover:bg-muted/40"
                    }`}
                    onClick={() => setSelectedDomain(domain.key)}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold">{domain.displayName}</p>
                        <p className="text-xs text-muted-foreground">{domain.key}</p>
                      </div>
                      <Badge variant="secondary">{domain.attributeCount}</Badge>
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">
                      Updated {formatTimestamp(domain.lastUpdated)}
                    </p>
                  </button>
                );
              })}
            </div>
          ) : (
            <SurfaceCard tone="warning">
              <SurfaceCardContent className="text-sm text-muted-foreground">
                No PKM domains are available yet for this account.
              </SurfaceCardContent>
            </SurfaceCard>
          )}
        </SurfaceInset>

        <div className="space-y-4">
          <SurfaceInset className="space-y-4 px-4 py-4">
            <SectionHeader
              eyebrow="Overview"
              title={selectedSummary?.displayName || "Select a domain"}
              description="Backend organization, segment layout, and scope exposure for the selected PKM domain."
              icon={Database}
              accent="violet"
            />
            {selectedSummary ? (
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <SurfaceCard>
                  <SurfaceCardContent className="space-y-1">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">Last updated</p>
                    <p className="text-sm font-semibold">{formatTimestamp(selectedSummary.lastUpdated)}</p>
                  </SurfaceCardContent>
                </SurfaceCard>
                <SurfaceCard>
                  <SurfaceCardContent className="space-y-1">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">Storage mode</p>
                    <p className="text-sm font-semibold">
                      {domainState.encrypted?.storageMode || "domain"}
                    </p>
                  </SurfaceCardContent>
                </SurfaceCard>
                <SurfaceCard>
                  <SurfaceCardContent className="space-y-1">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">Data version</p>
                    <p className="text-sm font-semibold">
                      {domainState.encrypted?.dataVersion ?? "Unavailable"}
                    </p>
                  </SurfaceCardContent>
                </SurfaceCard>
                <SurfaceCard>
                  <SurfaceCardContent className="space-y-1">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">Manifest version</p>
                    <p className="text-sm font-semibold">
                      {domainState.manifest?.manifest_version ?? "Unavailable"}
                    </p>
                  </SurfaceCardContent>
                </SurfaceCard>
              </div>
            ) : (
              <SurfaceCard tone="warning">
                <SurfaceCardContent className="text-sm text-muted-foreground">
                  Choose a domain from the left to inspect it.
                </SurfaceCardContent>
              </SurfaceCard>
            )}
            {domainState.error ? (
              <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-3 text-sm text-red-700">
                {domainState.error}
              </div>
            ) : null}
          </SurfaceInset>

          {selectedSummary ? (
            <>
              <SurfaceInset className="space-y-4 px-4 py-4">
                <SectionHeader
                  eyebrow="Segments"
                  title="Encrypted segment layout"
                  description="These are the segment ids used to organize encrypted PKM storage for this domain."
                  icon={KeyRound}
                  accent="emerald"
                />
                <div className="flex flex-wrap gap-2">
                  {(domainState.encrypted?.segmentIds || domainState.manifest?.segment_ids || ["root"]).map(
                    (segmentId) => (
                      <Badge key={segmentId} variant="secondary">
                        {segmentId}
                      </Badge>
                    )
                  )}
                </div>
                <p className="text-sm text-muted-foreground">
                  Ciphertext is stored in `pkm_blobs`, while manifest and scope exposure live in
                  `pkm_manifests`, `pkm_manifest_paths`, and `pkm_scope_registry`.
                </p>
              </SurfaceInset>

              <SurfaceInset className="space-y-4 px-4 py-4">
                <SectionHeader
                  eyebrow="Scopes"
                  title="Scope registry"
                  description="These are the scope handles that map the domain into shareable PKM access boundaries."
                  icon={FolderTree}
                  accent="amber"
                />
                {selectedScopeEntries.length ? (
                  <div className="space-y-3">
                    {selectedScopeEntries.map((scope) => (
                      <div key={scope.scope_handle} className="rounded-2xl border p-4">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant="secondary">{scope.scope_label}</Badge>
                          <Badge variant="outline">{scope.scope_handle}</Badge>
                          {(scope.segment_ids || []).map((segmentId) => (
                            <Badge key={segmentId} variant="secondary">
                              {segmentId}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <SurfaceCard tone="warning">
                    <SurfaceCardContent className="text-sm text-muted-foreground">
                      No scope registry entries are available for this domain yet.
                    </SurfaceCardContent>
                  </SurfaceCard>
                )}
              </SurfaceInset>

              <SurfaceInset className="space-y-4 px-4 py-4">
                <SectionHeader
                  eyebrow="Manifest"
                  title="Manifest paths"
                  description="The internal PKM path map that connects structure, sensitivity, and segment placement."
                  icon={FileJson}
                  accent="rose"
                />
                <div className="max-h-[360px] space-y-2 overflow-auto rounded-2xl border p-3">
                  {selectedPaths.length ? (
                    selectedPaths.map((path) => (
                      <div key={path.json_path} className="rounded-xl border bg-muted/20 px-3 py-2 text-sm">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium">{path.json_path}</span>
                          <Badge variant="outline">{path.path_type}</Badge>
                          <Badge variant="secondary">{path.segment_id || "root"}</Badge>
                          {path.sensitivity_label ? (
                            <Badge variant="secondary">{path.sensitivity_label}</Badge>
                          ) : null}
                        </div>
                      </div>
                    ))
                  ) : (
                    <p className="text-sm text-muted-foreground">No manifest paths available.</p>
                  )}
                </div>
              </SurfaceInset>

              <SurfaceInset className="space-y-4 px-4 py-4">
                <SectionHeader
                  eyebrow="Decrypted preview"
                  title="First-party payload preview"
                  description="This is your decrypted domain payload after vault unlock. It is not exposed publicly."
                  icon={FileJson}
                  accent="sky"
                />
                {domainState.loading ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading domain payload...
                  </div>
                ) : null}
                <pre className="overflow-x-auto rounded-2xl border bg-muted/30 p-4 text-xs leading-6">
                  {prettyJson(domainState.decrypted)}
                </pre>
              </SurfaceInset>
            </>
          ) : null}
        </div>
      </div>
    </PkmSettingsShell>
  );
}
