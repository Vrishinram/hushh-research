"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

import {
  RiaCompatibilityState,
  RiaPageShell,
  RiaSurface,
} from "@/components/ria/ria-page-shell";
import { useAuth } from "@/hooks/use-auth";
import {
  isIAMSchemaNotReadyError,
  RiaService,
  type RiaClientAccess,
  type RiaRequestRecord,
} from "@/lib/services/ria-service";

function describeRequestAction(action: string) {
  switch (action) {
    case "REQUESTED":
      return "Awaiting approval";
    case "CONSENT_GRANTED":
      return "Consent granted";
    case "CONSENT_DENIED":
      return "Consent denied";
    case "CANCELLED":
      return "Request cancelled";
    case "REVOKED":
      return "Consent revoked";
    case "TIMEOUT":
      return "Request expired";
    default:
      return action;
  }
}

export default function RiaRequestsPage() {
  const { user } = useAuth();
  const searchParams = useSearchParams();
  const [clientOptions, setClientOptions] = useState<RiaClientAccess[]>([]);
  const [selectedUserId, setSelectedUserId] = useState(searchParams.get("investor") || "");
  const [durationHours, setDurationHours] = useState(168);
  const [scopeTemplate, setScopeTemplate] = useState("ria_financial_summary_v1");
  const [items, setItems] = useState<RiaRequestRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [iamUnavailable, setIamUnavailable] = useState(false);

  async function loadRequests() {
    if (!user) {
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      setIamUnavailable(false);
      const idToken = await user.getIdToken();
      const [nextRequests, nextClients] = await Promise.all([
        RiaService.listRequests(idToken),
        RiaService.listClients(idToken),
      ]);
      setItems(nextRequests);
      setClientOptions(nextClients.filter((item) => Boolean(item.investor_user_id)));
    } catch (loadError) {
      setItems([]);
      setClientOptions([]);
      setIamUnavailable(isIAMSchemaNotReadyError(loadError));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadRequests();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const selectedClient = useMemo(
    () => clientOptions.find((item) => item.investor_user_id === selectedUserId) || null,
    [clientOptions, selectedUserId]
  );

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user || !selectedUserId) return;

    setSaving(true);
    setError(null);
    try {
      const idToken = await user.getIdToken();
      await RiaService.createRequest(idToken, {
        subject_user_id: selectedUserId,
        scope_template_id: scopeTemplate,
        duration_mode: "preset",
        duration_hours: durationHours,
        requester_actor_type: "ria",
        subject_actor_type: "investor",
      });
      await loadRequests();
    } catch (submitError) {
      if (isIAMSchemaNotReadyError(submitError)) {
        setIamUnavailable(true);
      }
      setError(submitError instanceof Error ? submitError.message : "Failed to create request");
    } finally {
      setSaving(false);
    }
  }

  return (
    <RiaPageShell
      eyebrow="Activity Center"
      title="Request access from known investor context only"
      description="Consent requests are created from a selected client or marketplace lead, not a raw user-id input. This keeps the workflow auditable and human-readable."
    >
      {iamUnavailable ? (
        <RiaCompatibilityState
          title="RIA activity is blocked by the current environment"
          description="The request center is fully wired, but this environment is still running without the IAM schema. Once migrations land, the same UI becomes active without a route change."
        />
      ) : null}

      {!iamUnavailable ? (
        <>
          <div className="grid gap-5 lg:grid-cols-[1.2fr_1.8fr]">
            <RiaSurface>
              <h2 className="text-xl font-semibold text-foreground">Create a new request</h2>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                Pick an investor you already know from your roster or from marketplace handoff, then
                apply a scope template and duration policy.
              </p>
              <form className="mt-5 space-y-4" onSubmit={onSubmit}>
                <select
                  value={selectedUserId}
                  onChange={(event) => setSelectedUserId(event.target.value)}
                  className="min-h-11 w-full rounded-2xl border border-border bg-background px-4 text-sm"
                >
                  <option value="">Select an investor</option>
                  {clientOptions.map((item) => (
                    <option key={item.id} value={item.investor_user_id || ""}>
                      {item.investor_display_name || item.investor_user_id}
                    </option>
                  ))}
                </select>

                <select
                  value={scopeTemplate}
                  onChange={(event) => setScopeTemplate(event.target.value)}
                  className="min-h-11 w-full rounded-2xl border border-border bg-background px-4 text-sm"
                >
                  <option value="ria_financial_summary_v1">RIA financial summary</option>
                  <option value="ria_risk_profile_v1">RIA risk profile</option>
                </select>

                <select
                  value={durationHours}
                  onChange={(event) => setDurationHours(Number(event.target.value))}
                  className="min-h-11 w-full rounded-2xl border border-border bg-background px-4 text-sm"
                >
                  <option value={24}>24 hours</option>
                  <option value={168}>7 days</option>
                  <option value={720}>30 days</option>
                  <option value={2160}>90 days</option>
                </select>

                {selectedClient ? (
                  <div className="rounded-2xl border border-border/50 bg-background/60 p-4">
                    <p className="text-sm font-medium text-foreground">
                      {selectedClient.investor_display_name || selectedClient.investor_user_id}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Current state: {selectedClient.status} · next action:{" "}
                      {selectedClient.next_action || "request_access"}
                    </p>
                  </div>
                ) : null}

                {error ? <p className="text-sm text-red-500">{error}</p> : null}

                <button
                  type="submit"
                  disabled={saving || !selectedUserId}
                  className="inline-flex min-h-11 w-full items-center justify-center rounded-full bg-foreground px-4 text-sm font-medium text-background disabled:opacity-60"
                >
                  {saving ? "Creating request..." : "Create request"}
                </button>
              </form>
            </RiaSurface>

            <RiaSurface>
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">
                Activity feed
              </p>
              <div className="mt-4 space-y-3">
                {items.map((item) => (
                  <div
                    key={item.request_id}
                    className="rounded-2xl border border-border/50 bg-background/60 p-4"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-foreground">
                          {item.subject_display_name || "Investor"} ·{" "}
                          {describeRequestAction(item.action)}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {item.subject_headline || item.scope}
                        </p>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {new Date(item.issued_at).toLocaleString()}
                      </p>
                    </div>
                    {item.metadata ? (
                      <div className="mt-3 grid gap-3 md:grid-cols-3">
                        <div className="rounded-2xl border border-border/50 bg-background/70 p-3">
                          <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                            Template
                          </p>
                          <p className="mt-2 text-sm text-foreground">
                            {String(item.metadata.scope_template_id || "n/a")}
                          </p>
                        </div>
                        <div className="rounded-2xl border border-border/50 bg-background/70 p-3">
                          <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                            Duration
                          </p>
                          <p className="mt-2 text-sm text-foreground">
                            {String(item.metadata.duration_hours || "n/a")}h
                          </p>
                        </div>
                        <div className="rounded-2xl border border-border/50 bg-background/70 p-3">
                          <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                            Direction
                          </p>
                          <p className="mt-2 text-sm text-foreground">
                            {String(item.metadata.requester_actor_type || "ria")} →{" "}
                            {String(item.metadata.subject_actor_type || "investor")}
                          </p>
                        </div>
                      </div>
                    ) : null}
                  </div>
                ))}
                {loading ? <p className="text-sm text-muted-foreground">Loading requests…</p> : null}
                {!loading && items.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No requests yet.</p>
                ) : null}
              </div>
            </RiaSurface>
          </div>
        </>
      ) : null}
    </RiaPageShell>
  );
}
