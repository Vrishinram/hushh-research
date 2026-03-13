"use client";

import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";

import {
  useLiquidGlassScene,
} from "@/components/labs/liquid-glass-scene";
import { useLiquidFilterAssets, type LiquidFilterOptions } from "@/lib/labs/liquid-glass-core";
import {
  resolveLiquidGlassStyle,
  resolveMirrorCloneLayerStyle,
  resolveMirrorCloneViewportStyle,
  resolveMirrorGlassContainerStyle,
  resolveMirrorHighlightStyle,
  type LiquidGlassRendererMode,
} from "@/lib/labs/liquid-glass-renderer";

export function LiquidGlassFilter({
  filterId,
  enabled,
  options,
  mode = "reference",
}: {
  filterId: string;
  enabled: boolean;
  options: LiquidFilterOptions;
  mode?: LiquidGlassRendererMode;
}) {
  const assets = useLiquidFilterAssets(enabled, options);
  const overscan = Math.ceil(
    Math.max(
      16,
      options.bezelWidth * 1.75,
      assets ? assets.scale * 0.45 : 0,
      (assets ? assets.blur : options.blur ?? 0) * 24
    )
  );

  if (!enabled || !assets) return null;

  return (
    <svg
      aria-hidden
      className="pointer-events-none absolute h-0 w-0 overflow-hidden opacity-0"
      focusable="false"
      colorInterpolationFilters="sRGB"
      shapeRendering="geometricPrecision"
    >
      <defs>
        <filter
          id={filterId}
          x={-overscan}
          y={-overscan}
          width={options.width + overscan * 2}
          height={options.height + overscan * 2}
          filterUnits="userSpaceOnUse"
          primitiveUnits="userSpaceOnUse"
          colorInterpolationFilters="sRGB"
        >
          <feGaussianBlur in="SourceGraphic" stdDeviation={assets.blur} result="blurred_source" />
          <feImage
            href={assets.displacementMapUrl}
            x="0"
            y="0"
            width={options.width}
            height={options.height}
            result="displacement_map"
          />
          <feDisplacementMap
            in="blurred_source"
            in2="displacement_map"
            scale={assets.scale}
            xChannelSelector="R"
            yChannelSelector="G"
            result="displaced"
          />
          <feColorMatrix
            in="displaced"
            type="saturate"
            values={String(assets.specularSaturation)}
            result="displaced_saturated"
          />
          <feImage
            href={assets.specularMapUrl}
            x="0"
            y="0"
            width={options.width}
            height={options.height}
            result="specular_layer"
          />
          <feComposite
            in="displaced_saturated"
            in2="specular_layer"
            operator="in"
            result="specular_saturated"
          />
          <feComponentTransfer in="specular_layer" result="specular_faded">
            <feFuncA type="linear" slope={assets.specularOpacity} />
          </feComponentTransfer>
          <feBlend in="specular_saturated" in2="displaced" mode="normal" result="withSaturation" />
          <feBlend in="specular_faded" in2="withSaturation" mode="normal" />
        </filter>
      </defs>
    </svg>
  );
}

function LiquidGlassMirrorLayer({
  filterId,
  bodyRef,
  borderRadius,
  compact,
  pressed,
}: {
  filterId: string;
  bodyRef: React.RefObject<HTMLDivElement | null>;
  borderRadius: CSSProperties["borderRadius"];
  compact?: boolean;
  pressed?: boolean;
}) {
  const { sceneRootRef, sceneVersion } = useLiquidGlassScene();
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const cloneLayerRef = useRef<HTMLDivElement | null>(null);
  const cloneNodeRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const sceneRoot = sceneRootRef.current;
    const cloneLayer = cloneLayerRef.current;
    if (!sceneRoot || !cloneLayer) return;

    cloneLayer.replaceChildren();
    const clone = sceneRoot.cloneNode(true) as HTMLElement;
    clone.removeAttribute("data-liquid-scene-root");
    clone.setAttribute("aria-hidden", "true");
    clone.style.position = "absolute";
    clone.style.left = "0";
    clone.style.top = "0";
    clone.style.margin = "0";
    clone.style.pointerEvents = "none";
    clone.style.transformOrigin = "top left";
    clone.querySelectorAll("[id]").forEach((node) => node.removeAttribute("id"));
    cloneLayer.appendChild(clone);
    cloneNodeRef.current = clone;

    return () => {
      cloneLayer.replaceChildren();
      cloneNodeRef.current = null;
    };
  }, [sceneRootRef, sceneVersion]);

  useEffect(() => {
    let rafId = 0;

    const sync = () => {
      const sceneRoot = sceneRootRef.current;
      const bodyNode = bodyRef.current;
      const clone = cloneNodeRef.current;
      if (sceneRoot && bodyNode && clone) {
        const sceneRect = sceneRoot.getBoundingClientRect();
        const bodyRect = bodyNode.getBoundingClientRect();
        clone.style.width = `${sceneRect.width}px`;
        clone.style.height = `${sceneRect.height}px`;
        clone.style.transform = `translate3d(${sceneRect.left - bodyRect.left}px, ${sceneRect.top - bodyRect.top}px, 0)`;
      }
      rafId = window.requestAnimationFrame(sync);
    };

    rafId = window.requestAnimationFrame(sync);
    return () => window.cancelAnimationFrame(rafId);
  }, [bodyRef, sceneRootRef, sceneVersion]);

  return (
    <div ref={viewportRef} className="absolute inset-0 overflow-hidden" style={resolveMirrorCloneViewportStyle(borderRadius)}>
      <div
        ref={cloneLayerRef}
        className="absolute inset-0 overflow-hidden"
        style={resolveMirrorCloneLayerStyle(filterId, { compact, pressed })}
      />
    </div>
  );
}

export function LiquidGlassBody({
  filterId,
  mode,
  style,
  compact = false,
  pressed = false,
  className,
  children,
}: {
  filterId: string;
  mode: LiquidGlassRendererMode;
  style?: CSSProperties;
  compact?: boolean;
  pressed?: boolean;
  className?: string;
  children?: ReactNode;
}) {
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const borderRadius = style?.borderRadius ?? "inherit";

  if (mode === "reference") {
    return (
      <div
        ref={bodyRef}
        className={className}
        style={glassBackdropStyle(filterId, style ?? {}, { mode, compact, pressed })}
      >
        {children}
      </div>
    );
  }

  return (
    <div
      ref={bodyRef}
      className={className}
      style={resolveMirrorGlassContainerStyle(style ?? {}, { compact, pressed })}
    >
      <LiquidGlassMirrorLayer
        filterId={filterId}
        bodyRef={bodyRef}
        borderRadius={borderRadius}
        compact={compact}
        pressed={pressed}
      />
      <div style={resolveMirrorHighlightStyle({ compact, pressed })} />
      {children}
    </div>
  );
}

export function glassBackdropStyle(
  filterId: string,
  base: CSSProperties = {},
  {
    mode = "reference",
    compact = false,
    pressed = false,
  }: {
    mode?: LiquidGlassRendererMode;
    compact?: boolean;
    pressed?: boolean;
  } = {}
): CSSProperties {
  return resolveLiquidGlassStyle(filterId, mode, base, { compact, pressed });
}
