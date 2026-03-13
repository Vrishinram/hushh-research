import type { CSSProperties } from "react";

export type LiquidGlassRendererMode = "reference" | "mirror";

type MirrorGlassStyleOptions = {
  compact?: boolean;
  pressed?: boolean;
};

export function resolveLiquidGlassStyle(
  filterId: string,
  mode: LiquidGlassRendererMode,
  base: CSSProperties = {},
  _options: MirrorGlassStyleOptions = {}
): CSSProperties {
  if (mode === "reference") {
    return {
      ...base,
      backdropFilter: `url(#${filterId})`,
      WebkitBackdropFilter: `url(#${filterId})`,
      willChange: "transform, backdrop-filter",
      isolation: "isolate",
    };
  }

  return resolveMirrorGlassContainerStyle(base);
}

export function resolveMirrorGlassContainerStyle(
  base: CSSProperties = {},
  options: MirrorGlassStyleOptions = {}
): CSSProperties {
  const edgeOpacity = options.pressed ? 0.28 : options.compact ? 0.16 : 0.2;
  const fillOpacity = options.pressed ? 0.045 : options.compact ? 0.018 : 0.03;
  const innerGlow = options.pressed ? 0.22 : 0.14;
  const shadowOpacity = options.pressed ? 0.2 : 0.15;
  const existingShadow = typeof base.boxShadow === "string" ? base.boxShadow : "";

  return {
    ...base,
    backgroundColor: `rgba(255, 255, 255, ${fillOpacity})`,
    border:
      typeof base.border === "string"
        ? base.border
        : `1px solid rgba(255, 255, 255, ${edgeOpacity})`,
    boxShadow: [
      existingShadow,
      `0 10px 28px rgba(0, 0, 0, ${shadowOpacity})`,
      `inset 0 1px 0 rgba(255, 255, 255, ${innerGlow})`,
      "inset 0 -1px 0 rgba(255, 255, 255, 0.04)",
    ]
      .filter(Boolean)
      .join(", "),
    willChange: "transform",
    isolation: "isolate",
    transform:
      typeof base.transform === "string"
        ? `${base.transform} translateZ(0)`
        : "translateZ(0)",
    backfaceVisibility: "hidden",
    WebkitBackfaceVisibility: "hidden",
    contain: "paint",
    backgroundClip: "padding-box",
  };
}

export function resolveMirrorCloneViewportStyle(borderRadius: CSSProperties["borderRadius"]): CSSProperties {
  return {
    position: "absolute",
    inset: 0,
    overflow: "hidden",
    borderRadius,
    pointerEvents: "none",
  };
}

export function resolveMirrorCloneLayerStyle(
  filterId: string,
  options: MirrorGlassStyleOptions = {}
): CSSProperties {
  return {
    position: "absolute",
    inset: 0,
    filter: `url(#${filterId})`,
    WebkitFilter: `url(#${filterId})`,
    opacity: options.pressed ? 1 : 0.96,
    willChange: "transform",
    transform: "translateZ(0)",
    backfaceVisibility: "hidden",
    WebkitBackfaceVisibility: "hidden",
    transformOrigin: "top left",
    pointerEvents: "none",
  };
}

export function resolveMirrorHighlightStyle(
  options: MirrorGlassStyleOptions = {}
): CSSProperties {
  const topOpacity = options.pressed ? 0.24 : options.compact ? 0.12 : 0.16;
  const rimOpacity = options.pressed ? 0.2 : 0.12;
  const causticOpacity = options.pressed ? 0.18 : 0.08;

  return {
    position: "absolute",
    inset: 0,
    backgroundImage: [
      `linear-gradient(180deg, rgba(255,255,255,${topOpacity}) 0%, rgba(255,255,255,0.08) 28%, rgba(255,255,255,0) 60%)`,
      `radial-gradient(100% 90% at 22% 12%, rgba(255,255,255,${rimOpacity}) 0%, rgba(255,255,255,0) 60%)`,
      `linear-gradient(90deg, rgba(255,255,255,${causticOpacity}) 0%, rgba(255,255,255,0.02) 18%, rgba(255,255,255,0) 42%)`,
    ].join(", "),
    mixBlendMode: "screen",
    pointerEvents: "none",
  };
}
