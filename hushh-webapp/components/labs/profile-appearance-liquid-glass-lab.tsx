"use client";

import { Aperture, Box, Search, SlidersHorizontal, Sparkles, ToggleLeft } from "lucide-react";
import { useMemo, useState, type ComponentType, type ReactNode } from "react";

import { cn } from "@/lib/utils";

import { LiquidGlassBottomNavDemo } from "./liquid-glass-bottom-nav-demo";
import { LiquidGlassContainerDemo } from "./liquid-glass-container-demo";
import { LiquidGlassSearchDemo } from "./liquid-glass-search-demo";
import { LiquidGlassSliderDemo } from "./liquid-glass-slider-demo";
import { LiquidGlassSwitchDemo } from "./liquid-glass-switch-demo";

type LabTabId = "navbar" | "searchbox" | "switch" | "slider" | "container";

type LabTab = {
  id: LabTabId;
  label: string;
  icon: ComponentType<{ className?: string }>;
  description: string;
  render: () => ReactNode;
};

export default function ProfileAppearanceLiquidGlassLab() {
  const [activeTab, setActiveTab] = useState<LabTabId>("navbar");

  const tabs = useMemo<LabTab[]>(
    () => [
      {
        id: "navbar",
        label: "Navbar",
        icon: Aperture,
        description:
          "Port of the Vue bottom-nav demo with thumb motion, drag behavior, quick glass visibility, and background filtering.",
        render: () => <LiquidGlassBottomNavDemo />,
      },
      {
        id: "searchbox",
        label: "Searchbox",
        icon: Search,
        description:
          "Port of the Vue searchbox demo with the expanding field, isolated orb close button, and resize-driven filter regeneration.",
        render: () => <LiquidGlassSearchDemo />,
      },
      {
        id: "switch",
        label: "Switch",
        icon: ToggleLeft,
        description:
          "Port of the Vue liquid-glass switch with drag-to-toggle behavior, state-based background blending, and springy thumb motion.",
        render: () => <LiquidGlassSwitchDemo />,
      },
      {
        id: "slider",
        label: "Slider",
        icon: SlidersHorizontal,
        description:
          "Port of the Vue slider with a responsive-width track, blue fill progress, and liquid thumb scale response during drag.",
        render: () => <LiquidGlassSliderDemo />,
      },
      {
        id: "container",
        label: "Container",
        icon: Box,
        description:
          "Port of the Vue container pattern showing the glass shell and content separation without binding it into the app chrome.",
        render: () => <LiquidGlassContainerDemo />,
      },
    ],
    []
  );

  const active = tabs.find((tab) => tab.id === activeTab) ?? tabs[0]!;
  const ActiveIcon = active.icon;

  return (
    <div className="min-h-screen bg-[#050505] text-white">
      <div
        className="min-h-screen"
        style={{
          backgroundImage:
            "linear-gradient(to right, rgba(255,255,255,0.06) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.06) 1px, transparent 1px)",
          backgroundSize: "24px 24px",
        }}
      >
        <div className="mx-auto max-w-6xl px-8 py-12">
          <header className="mb-10 space-y-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.32em] text-white/45">
              Labs
            </p>
            <h1 className="flex items-center gap-3 text-4xl font-semibold tracking-tight">
              <Sparkles className="h-8 w-8 text-white/72" />
              Liquid Glass Trace
            </h1>
            <p className="max-w-3xl text-base leading-7 text-white/62">
              React lab rebuilt from the Vue reference mechanics. This route stays isolated from the
              app shell and is gated to development-only runtime so the experiments remain off the
              production path.
            </p>
          </header>

          <div className="mb-8 flex flex-wrap gap-3">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              const selected = tab.id === active.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={cn(
                    "inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium transition-colors",
                    selected
                      ? "border-white/30 bg-white/14 text-white"
                      : "border-white/10 bg-white/6 text-white/62 hover:border-white/16 hover:bg-white/10 hover:text-white"
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {tab.label}
                </button>
              );
            })}
          </div>

          <section className="space-y-6">
            <div className="space-y-2">
              <h2 className="flex items-center gap-3 text-2xl font-semibold tracking-tight">
                <ActiveIcon className="h-6 w-6 text-white/70" />
                {active.label}
              </h2>
              <p className="max-w-3xl text-base leading-7 text-white/58">{active.description}</p>
            </div>
            {active.render()}
          </section>
        </div>
      </div>
    </div>
  );
}
