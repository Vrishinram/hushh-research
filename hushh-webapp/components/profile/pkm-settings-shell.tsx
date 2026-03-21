"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ArrowLeft, Code2, Database, FolderTree } from "lucide-react";

import {
  AppPageContentRegion,
  AppPageHeaderRegion,
  AppPageShell,
} from "@/components/app-ui/app-page-shell";
import { PageHeader } from "@/components/app-ui/page-sections";
import { SurfaceStack } from "@/components/app-ui/surfaces";
import { Badge } from "@/components/ui/badge";
import {
  SettingsGroup,
  SettingsRow,
} from "@/components/profile/settings-ui";
import { usePageEnterAnimation } from "@/lib/morphy-ux/hooks/use-page-enter";
import { ensureMorphyGsapReady, getMorphyEaseName } from "@/lib/morphy-ux/gsap-init";
import { getGsap, prefersReducedMotion } from "@/lib/morphy-ux/gsap";

type PkmPageKey = "viewer" | "agent-lab";

const PKM_NAV_ITEMS: Array<{
  key: PkmPageKey;
  href: string;
  label: string;
  description: string;
  icon: typeof Database;
}> = [
  {
    key: "viewer",
    href: "/profile/pkm",
    label: "PKM Viewer",
    description: "Inspect live domains, manifests, scopes, and decrypted first-party previews.",
    icon: Database,
  },
  {
    key: "agent-lab",
    href: "/profile/pkm-agent-lab",
    label: "Intent Capture Lab",
    description: "Turn natural language into a saved PKM structure with a clear backend storage plan.",
    icon: Code2,
  },
];

export function PkmSettingsShell({
  activePage,
  title,
  description,
  actions,
  children,
}: {
  activePage: PkmPageKey;
  title: string;
  description: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const shellRef = useRef<HTMLDivElement | null>(null);

  usePageEnterAnimation(shellRef, {
    key: pathname,
  });

  useEffect(() => {
    if (prefersReducedMotion()) return;
    const root = shellRef.current;
    if (!root) return;

    let revert: null | (() => void) = null;
    let cancelled = false;

    void (async () => {
      await ensureMorphyGsapReady();
      const gsap = await getGsap();
      if (!gsap || cancelled) return;

      if (gsap.context) {
        const ctx = gsap.context(() => {
          const navRows = Array.from(
            root.querySelectorAll<HTMLElement>("[data-pkm-nav-row='true']")
          );
          const detailPanel = root.querySelector<HTMLElement>("[data-pkm-detail-panel='true']");
          if (navRows.length > 0) {
            gsap.fromTo(
              navRows,
              { opacity: 0, x: -12 },
              {
                opacity: 1,
                x: 0,
                duration: 0.28,
                stagger: 0.04,
                ease: getMorphyEaseName("emphasized"),
                overwrite: "auto",
                clearProps: "opacity,transform",
              }
            );
          }
          if (detailPanel) {
            gsap.fromTo(
              detailPanel,
              { opacity: 0, x: 18, scale: 0.992 },
              {
                opacity: 1,
                x: 0,
                scale: 1,
                duration: 0.34,
                ease: getMorphyEaseName("emphasized"),
                overwrite: "auto",
                clearProps: "opacity,transform",
              }
            );
          }
        }, root);
        revert = () => ctx.revert();
      }
    })();

    return () => {
      cancelled = true;
      revert?.();
    };
  }, [pathname]);

  return (
    <AppPageShell>
      <AppPageHeaderRegion>
        <PageHeader
          eyebrow="Profile / Personal Knowledge Model"
          title={title}
          description={description}
          actions={actions}
        />
      </AppPageHeaderRegion>

      <AppPageContentRegion>
        <div ref={shellRef} className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
          <aside className="space-y-4 lg:sticky lg:top-4 lg:self-start">
            <SettingsGroup
              eyebrow="Navigation"
              title="Move through PKM like settings"
              description="Jump between saved knowledge and intent capture without losing your place."
            >
              <div data-pkm-nav-row="true">
                <SettingsRow
                  icon={ArrowLeft}
                  title="Back to Profile"
                  description="Return to your main profile settings."
                  chevron
                  onClick={() => router.push("/profile?tab=account")}
                />
              </div>
              {PKM_NAV_ITEMS.map((item) => {
                const isActive = item.key === activePage;
                return (
                  <div key={item.key} data-pkm-nav-row="true">
                    <SettingsRow
                      icon={item.icon}
                      title={item.label}
                      description={item.description}
                      trailing={isActive ? <Badge variant="secondary">Open</Badge> : undefined}
                      chevron
                      onClick={() => {
                        if (isActive) return;
                        router.push(item.href);
                      }}
                    />
                  </div>
                );
              })}
            </SettingsGroup>

            <SettingsGroup
              eyebrow="Flow"
              title="How this stays organized"
              description="Capture intent first, then inspect how the same data becomes encrypted segments and scope handles."
            >
              <div data-pkm-nav-row="true">
                <SettingsRow
                  icon={FolderTree}
                  title="Capture"
                  description="Natural language becomes a target domain, manifest, and structure decision."
                />
              </div>
              <div data-pkm-nav-row="true">
                <SettingsRow
                  icon={Database}
                  title="Inspect"
                  description="Review stored segments, manifests, and scope exposure after save."
                />
              </div>
            </SettingsGroup>
          </aside>

          <div data-pkm-detail-panel="true">
            <SurfaceStack compact>{children}</SurfaceStack>
          </div>
        </div>
      </AppPageContentRegion>
    </AppPageShell>
  );
}
