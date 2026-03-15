"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { RiaPageShell, RiaSurface } from "@/components/ria/ria-page-shell";
import { useAuth } from "@/hooks/use-auth";
import { usePersonaState } from "@/lib/persona/persona-context";
import { ROUTES } from "@/lib/navigation/routes";
import {
  isIAMSchemaNotReadyError,
  RiaService,
  type MarketplaceInvestor,
  type MarketplaceRia,
  type RiaClientAccess,
} from "@/lib/services/ria-service";

export default function MarketplacePage() {
  const { isAuthenticated, user } = useAuth();
  const { personaState } = usePersonaState();
  const [tab, setTab] = useState<"rias" | "investors">("rias");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [actionLoadingUserId, setActionLoadingUserId] = useState<string | null>(null);
  const [rias, setRias] = useState<MarketplaceRia[]>([]);
  const [investors, setInvestors] = useState<MarketplaceInvestor[]>([]);
  const [relationships, setRelationships] = useState<RiaClientAccess[]>([]);
  const [iamUnavailable, setIamUnavailable] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function loadRelationshipContext() {
      if (!user) return;
      try {
        const idToken = await user.getIdToken();
        const nextClients = await RiaService.listClients(idToken).catch(
          () => [] as RiaClientAccess[]
        );
        if (!cancelled) {
          setRelationships(nextClients);
        }
      } catch {
        if (!cancelled) {
          setRelationships([]);
        }
      }
    }

    void loadRelationshipContext();
    return () => {
      cancelled = true;
    };
  }, [user]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setIamUnavailable(false);
      try {
        if (tab === "rias") {
          const data = await RiaService.searchRias({ query, limit: 20 });
          if (!cancelled) setRias(data);
          return;
        }

        const data = await RiaService.searchInvestors({ query, limit: 20 });
        if (!cancelled) setInvestors(data);
      } catch (error) {
        if (!cancelled) {
          setIamUnavailable(isIAMSchemaNotReadyError(error));
          if (tab === "rias") setRias([]);
          else setInvestors([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [query, tab]);

  const relationshipMap = useMemo(() => {
    const map = new Map<string, RiaClientAccess>();
    for (const item of relationships) {
      if (item.investor_user_id) {
        map.set(item.investor_user_id, item);
      }
    }
    return map;
  }, [relationships]);

  const currentPersona =
    personaState?.active_persona || personaState?.last_active_persona || "investor";

  async function createInvite(investor: MarketplaceInvestor) {
    if (!user) return;
    try {
      setActionLoadingUserId(investor.user_id);
      const idToken = await user.getIdToken();
      await RiaService.createInvites(idToken, {
        scope_template_id: "ria_financial_summary_v1",
        duration_mode: "preset",
        duration_hours: 168,
        targets: [
          {
            display_name: investor.display_name,
            investor_user_id: investor.user_id,
            source: "marketplace",
          },
        ],
      });
      const nextClients = await RiaService.listClients(idToken);
      setRelationships(nextClients);
    } finally {
      setActionLoadingUserId(null);
    }
  }

  return (
    <RiaPageShell
      eyebrow="Marketplace"
      title="Public discovery first. Private access only after consent."
      description="Marketplace cards expose verified public metadata only. Relationship actions stay persona-aware and never bypass the consent boundary."
    >
      <RiaSurface>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setTab("rias")}
            className={`min-h-11 rounded-full px-4 text-sm font-medium ${
              tab === "rias"
                ? "bg-foreground text-background"
                : "border border-border bg-background text-foreground"
            }`}
          >
            Find RIAs
          </button>
          <button
            type="button"
            onClick={() => setTab("investors")}
            className={`min-h-11 rounded-full px-4 text-sm font-medium ${
              tab === "investors"
                ? "bg-foreground text-background"
                : "border border-border bg-background text-foreground"
            }`}
          >
            Find Investors
          </button>
        </div>

        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={tab === "rias" ? "Search RIAs by name" : "Search investors"}
          className="mt-4 min-h-11 w-full rounded-2xl border border-border bg-background px-4 text-sm"
        />
      </RiaSurface>

      {loading ? <p className="text-sm text-muted-foreground">Loading marketplace…</p> : null}
      {iamUnavailable ? (
        <RiaSurface className="border-dashed border-amber-500/40 bg-amber-500/5">
          <p className="text-sm text-muted-foreground">
            Marketplace surfaces are waiting on IAM schema readiness in this environment.
          </p>
        </RiaSurface>
      ) : null}

      {tab === "rias" ? (
        <div className="grid gap-4 md:grid-cols-2">
          {rias.map((ria) => (
            <RiaSurface key={ria.id} className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-lg font-semibold text-foreground">{ria.display_name}</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {ria.verification_status}
                    {ria.headline ? ` · ${ria.headline}` : ""}
                  </p>
                </div>
                <Link
                  href={`${ROUTES.MARKETPLACE_RIA_PROFILE}/${encodeURIComponent(ria.id)}`}
                  className="inline-flex min-h-11 items-center justify-center rounded-full border border-border bg-background px-4 text-sm font-medium text-foreground"
                >
                  Open profile
                </Link>
              </div>
              {Array.isArray(ria.firms) && ria.firms.length > 0 ? (
                <p className="mt-3 text-xs text-muted-foreground">
                  {ria.firms.map((firm) => firm.legal_name).join(" · ")}
                </p>
              ) : null}
            </RiaSurface>
          ))}

          {rias.length === 0 && !loading && !iamUnavailable ? (
            <p className="text-sm text-muted-foreground">No RIA profiles found.</p>
          ) : null}
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {investors.map((investor) => {
            const relationship = relationshipMap.get(investor.user_id);
            return (
              <RiaSurface key={investor.user_id} className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-lg font-semibold text-foreground">{investor.display_name}</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {investor.headline || "Opt-in investor profile"}
                    </p>
                  </div>
                  <span className="rounded-full border border-border/60 px-3 py-2 text-xs text-muted-foreground">
                    {relationship?.status || "lead"}
                  </span>
                </div>
                <p className="mt-3 text-sm text-muted-foreground">
                  {investor.strategy_summary || investor.location_hint || "Public discovery metadata only."}
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  {isAuthenticated && currentPersona === "ria" ? (
                    <>
                      <button
                        type="button"
                        onClick={() => void createInvite(investor)}
                        disabled={actionLoadingUserId === investor.user_id}
                        className="inline-flex min-h-11 items-center justify-center rounded-full bg-foreground px-4 text-sm font-medium text-background disabled:opacity-60"
                      >
                        {actionLoadingUserId === investor.user_id ? "Inviting..." : "Invite"}
                      </button>
                      <Link
                        href={`${ROUTES.CONSENTS}?view=pending&investor=${encodeURIComponent(
                          investor.user_id
                        )}`}
                        className="inline-flex min-h-11 items-center justify-center rounded-full border border-border bg-background px-4 text-sm font-medium text-foreground"
                      >
                        Request access
                      </Link>
                    </>
                  ) : (
                    <span className="text-xs text-muted-foreground">
                      View lead details after switching into RIA mode.
                    </span>
                  )}
                </div>
              </RiaSurface>
            );
          })}

          {investors.length === 0 && !loading && !iamUnavailable ? (
            <p className="text-sm text-muted-foreground">No investor profiles found.</p>
          ) : null}
        </div>
      )}
    </RiaPageShell>
  );
}
