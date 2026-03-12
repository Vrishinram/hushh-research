"use client";

import { Search, X } from "lucide-react";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";

import { cn } from "@/lib/utils";

import { LiquidGlassFilter, glassBackdropStyle } from "./liquid-glass-filter";

const CONTROL_RESET_CLASS =
  "appearance-none border-0 bg-transparent p-0 m-0 outline-none shadow-none";

type SearchSize = "xs" | "small" | "medium" | "large";

const SIZE_PRESETS: Record<
  SearchSize,
  {
    height: number;
    orbSize: number;
    radius: number;
    iconSize: number;
    fontSize: number;
    gap: number;
    bezelWidth: number;
    glassThickness: number;
    translateX: number;
  }
> = {
  xs: {
    height: 32,
    orbSize: 24,
    radius: 16,
    iconSize: 14,
    fontSize: 12,
    gap: 6,
    bezelWidth: 8,
    glassThickness: 40,
    translateX: 20,
  },
  small: {
    height: 40,
    orbSize: 32,
    radius: 20,
    iconSize: 16,
    fontSize: 13,
    gap: 8,
    bezelWidth: 12,
    glassThickness: 60,
    translateX: 25,
  },
  medium: {
    height: 52,
    orbSize: 42,
    radius: 26,
    iconSize: 20,
    fontSize: 15,
    gap: 12,
    bezelWidth: 12,
    glassThickness: 80,
    translateX: 31,
  },
  large: {
    height: 64,
    orbSize: 52,
    radius: 32,
    iconSize: 24,
    fontSize: 17,
    gap: 16,
    bezelWidth: 20,
    glassThickness: 100,
    translateX: 37,
  },
};

export function LiquidGlassSearchDemo() {
  const [query, setQuery] = useState("");
  const [showBackgroundImage, setShowBackgroundImage] = useState(false);

  return (
    <section className="space-y-5">
      <div className="flex justify-end px-4">
        <label className="inline-flex items-center gap-2 rounded-full bg-black/5 px-3 py-1.5 text-sm font-medium text-black/60 transition-colors hover:bg-black/10 dark:bg-white/10 dark:text-white/60 dark:hover:bg-white/20">
          <input
            type="checkbox"
            checked={showBackgroundImage}
            onChange={(event) => setShowBackgroundImage(event.target.checked)}
            className="accent-black dark:accent-white"
          />
          Show Background Image
        </label>
      </div>

      <div
        className={cn(
          "relative -ml-4 flex h-96 w-[calc(100%+32px)] items-center justify-center overflow-hidden rounded-xl border border-black/10 text-black/5 transition-all duration-500 ease-in-out dark:border-white/10 dark:text-white/5",
          showBackgroundImage ? "animate-bg-pan" : ""
        )}
        style={
          showBackgroundImage
            ? {
                backgroundImage:
                  "url(https://images.unsplash.com/photo-1651784627380-58168977f4f9?q=80&w=987&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D)",
                backgroundSize: "cover",
                backgroundPosition: "center",
              }
            : {
                backgroundImage:
                  "linear-gradient(to right, currentColor 1px, transparent 1px),linear-gradient(to bottom, currentColor 1px, transparent 1px),radial-gradient(120% 100% at 10% 0%, var(--bg1), var(--bg2))",
                backgroundSize: "24px 24px, 24px 24px, 100% 100%",
                backgroundPosition: "12px 12px, 12px 12px, 0 0",
              }
        }
      >
        {showBackgroundImage ? (
          <a
            href="https://unsplash.com/@visaxslr"
            target="_blank"
            rel="noreferrer"
            className="absolute left-3 top-3 inline-block text-[9px] uppercase tracking-wider text-white/40"
          >
            Photo by @visaxslr
            <br />
            on Unsplash
          </a>
        ) : null}

        <div className="w-[420px] max-w-[90%]">
          <LiquidGlassSearchBar
            value={query}
            onValueChange={setQuery}
            placeholder="Search"
            size="large"
          />
        </div>

        {query ? (
          <div className="absolute bottom-6 left-1/2 -translate-x-1/2 rounded-full bg-white/20 px-4 py-2 text-sm font-medium text-black/80 backdrop-blur dark:bg-black/20 dark:text-white/80">
            Query: <span className="font-bold">{query}</span>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function LiquidGlassSearchBar({
  value,
  onValueChange,
  placeholder,
  size,
}: {
  value: string;
  onValueChange: (next: string) => void;
  placeholder: string;
  size: SearchSize;
}) {
  const dimensions = SIZE_PRESETS[size];
  const inputFilterId = `${useId().replace(/:/g, "-")}-input`;
  const orbFilterId = `${useId().replace(/:/g, "-")}-orb`;
  const inputContainerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [inputWidth, setInputWidth] = useState(100);
  const [focused, setFocused] = useState(false);
  const [transitioning, setTransitioning] = useState(false);
  const transitionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hasQuery = value.length > 0;
  const isExpanded = focused || hasQuery;
  const showCloseOrb = hasQuery;
  const orbScale = showCloseOrb ? 1.3 : 0.5;
  const orbOpacity = showCloseOrb ? 1 : 0;

  useEffect(() => {
    setTransitioning(true);
    if (transitionTimeoutRef.current) clearTimeout(transitionTimeoutRef.current);
    transitionTimeoutRef.current = setTimeout(() => {
      setTransitioning(false);
      if (inputContainerRef.current) {
        setInputWidth(inputContainerRef.current.offsetWidth);
      }
    }, 550);
    return () => {
      if (transitionTimeoutRef.current) clearTimeout(transitionTimeoutRef.current);
    };
  }, [isExpanded]);

  useEffect(() => {
    if (!inputContainerRef.current) return;
    const node = inputContainerRef.current;
    const updateWidth = () => setInputWidth(node.offsetWidth);
    updateWidth();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateWidth);
      return () => window.removeEventListener("resize", updateWidth);
    }

    const observer = new ResizeObserver((entries) => {
      if (transitioning) return;
      for (const entry of entries) {
        setInputWidth(entry.contentRect.width);
      }
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [transitioning]);

  const inputFilterOptions = useMemo(
    () => ({
      width: inputWidth,
      height: dimensions.height,
      radius: dimensions.radius,
      bezelWidth: dimensions.bezelWidth,
      glassThickness: dimensions.glassThickness,
      refractiveIndex: 1.4,
      bezelType: "convex_squircle" as const,
      shape: "pill" as const,
      blur: 1,
      scaleRatio: 0.4,
      specularOpacity: 0.4,
      specularSaturation: 8,
    }),
    [dimensions, inputWidth]
  );

  const orbFilterOptions = useMemo(
    () => ({
      width: dimensions.orbSize,
      height: dimensions.orbSize,
      radius: dimensions.orbSize / 2,
      bezelWidth: dimensions.bezelWidth,
      glassThickness: dimensions.glassThickness,
      refractiveIndex: 1.4,
      bezelType: "convex_squircle" as const,
      shape: "pill" as const,
      blur: 1,
      scaleRatio: 0.2,
      specularOpacity: 0.4,
      specularSaturation: 10,
    }),
    [dimensions]
  );

  return (
    <div className="relative flex w-full select-none items-center" style={{ height: dimensions.height }}>
      <div
        ref={inputContainerRef}
        className="absolute inset-0 transition-all duration-300 ease-[cubic-bezier(0.25,0.8,0.25,1)]"
        style={{
          zIndex: 10,
          transform: isExpanded
            ? `scale(1.02) translateX(${showCloseOrb ? -dimensions.translateX : 0}px)`
            : "scale(1)",
          transformOrigin: "center center",
        }}
      >
        <LiquidGlassFilter filterId={inputFilterId} enabled options={inputFilterOptions} />

        <div
          className="absolute inset-0 z-0 overflow-hidden transition-all duration-300"
          style={glassBackdropStyle(inputFilterId, {
            borderRadius: dimensions.radius,
            backgroundColor: "rgba(255,255,255,0.05)",
            border: "1px solid rgba(255,255,255,0.08)",
            boxShadow: isExpanded
              ? "0 4px 24px rgba(0,0,0,0.1)"
              : "0 2px 10px rgba(0,0,0,0.05)",
          })}
        />

        <div
          className="absolute inset-0 z-10 flex items-center"
          style={{ paddingLeft: dimensions.radius * 0.8 }}
        >
          <Search
            className={cn(
              "shrink-0 transition-colors duration-300",
              isExpanded
                ? "text-black dark:text-white"
                : "text-black/50 dark:text-white/50"
            )}
            size={dimensions.iconSize}
            style={{ marginRight: dimensions.gap }}
          />

          <input
            ref={inputRef}
            type="text"
            value={value}
            onChange={(event) => onValueChange(event.target.value)}
            placeholder={placeholder}
            className="h-full w-full flex-1 appearance-none border-none bg-transparent font-medium leading-none text-black/90 outline-none transition-[padding] duration-300 placeholder:text-black/40 dark:text-white/90 dark:placeholder:text-white/40"
            style={{
              fontSize: dimensions.fontSize,
              paddingRight: showCloseOrb
                ? dimensions.orbSize + dimensions.gap
                : dimensions.radius,
            }}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
          />
        </div>
      </div>

      <button
        type="button"
        className={`absolute top-1/2 ${CONTROL_RESET_CLASS} cursor-pointer transition-transform duration-500 ease-[cubic-bezier(0.34,1.56,0.64,1)]`}
        style={{
          width: dimensions.orbSize,
          height: dimensions.orbSize,
          right: (dimensions.height - dimensions.orbSize) / 2,
          transform: `translateX(${dimensions.translateX}px) translateY(-50%) scale(${orbScale}) rotate(${showCloseOrb ? 0 : -90}deg)`,
          opacity: orbOpacity,
          pointerEvents: showCloseOrb ? "auto" : "none",
          zIndex: 20,
        }}
        onMouseDown={(event) => {
          event.preventDefault();
          onValueChange("");
          inputRef.current?.focus();
        }}
      >
        <LiquidGlassFilter filterId={orbFilterId} enabled options={orbFilterOptions} />

        <div className="relative h-full w-full">
          <div
            className="absolute inset-0 z-10 overflow-hidden"
            style={glassBackdropStyle(orbFilterId, {
              borderRadius: dimensions.radius,
              backgroundColor: "rgba(255,255,255,0.05)",
              border: "1px solid rgba(255,255,255,0.08)",
              boxShadow:
                "0 4px 15px rgba(0,0,0,0.1), inset 0 0 5px rgba(255,255,255,0.1)",
            })}
          />

          <div className="absolute inset-0 z-20 flex items-center justify-center text-black/60 dark:text-white/70">
            <X size={dimensions.iconSize} />
          </div>
        </div>
      </button>
    </div>
  );
}
