"use client";

import type { CSSProperties } from "react";

import { useLiquidFilterAssets, type LiquidFilterOptions } from "@/lib/labs/liquid-glass-core";

export function LiquidGlassFilter({
  filterId,
  enabled,
  options,
}: {
  filterId: string;
  enabled: boolean;
  options: LiquidFilterOptions;
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
          <feGaussianBlur
            in="SourceGraphic"
            stdDeviation={assets.blur}
            result="blurred_source"
          />
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

export function glassBackdropStyle(filterId: string, base: CSSProperties = {}): CSSProperties {
  return {
    ...base,
    backdropFilter: `url(#${filterId})`,
    WebkitBackdropFilter: `url(#${filterId})`,
    willChange: "transform, backdrop-filter",
    isolation: "isolate",
  };
}
