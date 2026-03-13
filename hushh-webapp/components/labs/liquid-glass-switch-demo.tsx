"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";

import {
  LiquidGlassSceneProvider,
  LiquidGlassSceneRoot,
} from "@/components/labs/liquid-glass-scene";
import { useLiquidGlassRendererMode } from "@/components/labs/liquid-glass-renderer-mode";
import { useSpringValue } from "@/lib/labs/liquid-glass-core";

import { LiquidGlassBody, LiquidGlassFilter } from "./liquid-glass-filter";

type SwitchSize = "xs" | "small" | "medium" | "large";

const SIZE_PRESETS: Record<
  SwitchSize,
  {
    sliderWidth: number;
    sliderHeight: number;
    thumbWidth: number;
    thumbHeight: number;
    thumbScale: number;
    bezelWidth: number;
    glassThickness: number;
  }
> = {
  xs: {
    sliderWidth: 70,
    sliderHeight: 30,
    thumbWidth: 64,
    thumbHeight: 40,
    thumbScale: 0.65,
    bezelWidth: 8,
    glassThickness: 10,
  },
  small: {
    sliderWidth: 100,
    sliderHeight: 42,
    thumbWidth: 92,
    thumbHeight: 58,
    thumbScale: 0.65,
    bezelWidth: 14,
    glassThickness: 15,
  },
  medium: {
    sliderWidth: 130,
    sliderHeight: 54,
    thumbWidth: 119,
    thumbHeight: 75,
    thumbScale: 0.65,
    bezelWidth: 16,
    glassThickness: 20,
  },
  large: {
    sliderWidth: 160,
    sliderHeight: 67,
    thumbWidth: 146,
    thumbHeight: 92,
    thumbScale: 0.65,
    bezelWidth: 18,
    glassThickness: 25,
  },
};

const CONTROL_RESET_CLASS =
  "appearance-none border-0 bg-transparent p-0 m-0 outline-none shadow-none";

export function LiquidGlassSwitchDemo() {
  const [xs, setXs] = useState(true);
  const [small, setSmall] = useState(false);
  const [medium, setMedium] = useState(true);
  const [large, setLarge] = useState(true);
  const sceneStyle = useMemo(
    () => ({
      backgroundImage:
        "linear-gradient(to right, currentColor 1px, transparent 1px),linear-gradient(to bottom, currentColor 1px, transparent 1px),radial-gradient(120% 100% at 10% 0%, var(--bg1), var(--bg2))",
      backgroundSize: "24px 24px, 24px 24px, 100% 100%",
      backgroundPosition: "12px 12px, 12px 12px, 0 0",
      backgroundRepeat: "repeat, repeat, no-repeat",
      backgroundAttachment: "scroll",
    }),
    []
  );

  return (
    <LiquidGlassSceneProvider sceneStyle={sceneStyle}>
      <section className="space-y-5">
      <div className="relative -ml-4 flex h-[36rem] w-[calc(100%+32px)] items-center justify-center overflow-hidden rounded-xl border border-black/10 text-black/5 dark:border-white/10 dark:text-white/5">
        <LiquidGlassSceneRoot className="absolute inset-0">
          <div className="absolute inset-x-14 top-12 grid grid-cols-4 gap-6">
            {Array.from({ length: 4 }).map((_, index) => (
              <div
                key={index}
                className="h-24 rounded-[2rem] border border-white/10 bg-black/16"
                style={{ opacity: 0.42 + index * 0.06 }}
              />
            ))}
          </div>
          <div className="absolute inset-x-10 bottom-12 grid grid-cols-2 gap-6 md:grid-cols-4">
            {Array.from({ length: 8 }).map((_, index) => (
              <div
                key={index}
                className="h-16 rounded-[1.6rem] border border-white/8 bg-white/8"
                style={{ opacity: 0.28 + (index % 4) * 0.08 }}
              />
            ))}
          </div>
        </LiquidGlassSceneRoot>

        <div className="relative z-10 grid grid-cols-2 gap-x-20 gap-y-10 md:grid-cols-4">
          <SwitchCluster label="XS" checked={xs} onCheckedChange={setXs} size="xs" />
          <SwitchCluster label="Small" checked={small} onCheckedChange={setSmall} size="small" />
          <SwitchCluster label="Medium" checked={medium} onCheckedChange={setMedium} size="medium" />
          <SwitchCluster label="Large" checked={large} onCheckedChange={setLarge} size="large" />
        </div>
      </div>
      </section>
    </LiquidGlassSceneProvider>
  );
}

function SwitchCluster({
  label,
  checked,
  onCheckedChange,
  size,
}: {
  label: string;
  checked: boolean;
  onCheckedChange: (next: boolean) => void;
  size: SwitchSize;
}) {
  return (
    <div className="flex flex-col items-center gap-3">
      <span className="text-xs font-semibold uppercase tracking-[0.28em] text-white/60">{label}</span>
      <LiquidGlassSwitch checked={checked} onCheckedChange={onCheckedChange} size={size} />
      <span className="text-[10px] font-medium uppercase tracking-[0.24em] text-white/44">
        {checked ? "On" : "Off"}
      </span>
    </div>
  );
}

function LiquidGlassSwitch({
  checked,
  onCheckedChange,
  size,
  disabled,
}: {
  checked: boolean;
  onCheckedChange: (next: boolean) => void;
  size: SwitchSize;
  disabled?: boolean;
}) {
  const rendererMode = useLiquidGlassRendererMode();
  const dimensions = SIZE_PRESETS[size];
  const filterId = `liquid-switch-${useId().replace(/:/g, "-")}`;
  const [pointerDown, setPointerDown] = useState(false);
  const [xDragRatio, setXDragRatio] = useState(checked ? 1 : 0);
  const initialPointerXRef = useRef(0);
  const currentCheckedRef = useRef(checked);

  useEffect(() => {
    currentCheckedRef.current = checked;
    if (!pointerDown) {
      setXDragRatio(checked ? 1 : 0);
    }
  }, [checked, pointerDown]);

  const sliderWidth = dimensions.sliderWidth;
  const sliderHeight = dimensions.sliderHeight;
  const thumbWidth = dimensions.thumbWidth;
  const thumbHeight = dimensions.thumbHeight;
  const thumbRadius = thumbHeight / 2;
  const thumbRestScale = dimensions.thumbScale;
  const thumbActiveScale = 0.9;
  const thumbRestOffset = ((1 - thumbRestScale) * thumbWidth) / 2;
  const travel =
    sliderWidth - sliderHeight - (thumbWidth - thumbHeight) * thumbRestScale;

  const activeThumbScale = pointerDown ? thumbActiveScale : thumbRestScale;
  const backgroundOpacity = pointerDown ? 0.1 : 1;
  const scaleRatio = pointerDown ? 0.9 : 0.4;

  const springRatio = useSpringValue(xDragRatio, {
    stiffness: 140,
    damping: 16,
    mass: 1,
    precision: 0.001,
  });

  const thumbX = springRatio * travel;
  const thumbMarginLeft = -thumbRestOffset + (sliderHeight - thumbHeight * thumbRestScale) / 2;
  const backgroundColor = useMemo(() => {
    const ratio = xDragRatio;
    const r = Math.round(148 + (59 - 148) * ratio);
    const g = Math.round(148 + (191 - 148) * ratio);
    const b = Math.round(159 + (78 - 159) * ratio);
    const a = Math.round(119 + (238 - 119) * ratio);
    return `rgba(${r}, ${g}, ${b}, ${a / 255})`;
  }, [xDragRatio]);

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      if (!pointerDown || disabled) return;
      const baseRatio = currentCheckedRef.current ? 1 : 0;
      const displacementX = event.clientX - initialPointerXRef.current;
      const ratio = baseRatio + displacementX / travel;
      const overflow = ratio < 0 ? -ratio : ratio > 1 ? ratio - 1 : 0;
      const overflowSign = ratio < 0 ? -1 : 1;
      const dampedOverflow = (overflowSign * overflow) / 22;
      setXDragRatio(Math.min(1, Math.max(0, ratio)) + dampedOverflow);
    };

    const handlePointerUp = (event: PointerEvent) => {
      if (!pointerDown) return;
      setPointerDown(false);
      const distance = event.clientX - initialPointerXRef.current;
      if (Math.abs(distance) > 4) {
        const nextChecked = xDragRatio > 0.5;
        onCheckedChange(nextChecked);
        setXDragRatio(nextChecked ? 1 : 0);
      } else {
        const nextChecked = !currentCheckedRef.current;
        onCheckedChange(nextChecked);
        setXDragRatio(nextChecked ? 1 : 0);
      }
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [disabled, onCheckedChange, pointerDown, travel, xDragRatio]);

  return (
    <div className={disabled ? "cursor-not-allowed opacity-50" : "select-none touch-none"}>
      <div
        className="relative transition-colors duration-150"
        style={{
          width: sliderWidth,
          height: sliderHeight,
          backgroundColor,
          borderRadius: sliderHeight / 2,
        }}
      >
        <LiquidGlassFilter
          filterId={filterId}
          enabled
          mode={rendererMode}
          options={{
            width: thumbWidth,
            height: thumbHeight,
            radius: thumbRadius,
            bezelWidth: dimensions.bezelWidth,
            glassThickness: dimensions.glassThickness,
            refractiveIndex: 1.5,
            bezelType: "lip",
            shape: "pill",
            blur: 0.2,
            scaleRatio,
            specularOpacity: 0.5,
            specularSaturation: 6,
          }}
        />

        <button
          type="button"
          aria-pressed={checked}
          disabled={disabled}
          onPointerDown={(event) => {
            if (disabled) return;
            setPointerDown(true);
            initialPointerXRef.current = event.clientX;
          }}
          className={
          disabled
            ? `absolute ${CONTROL_RESET_CLASS} cursor-not-allowed`
              : rendererMode === "mirror"
                ? `absolute ${CONTROL_RESET_CLASS}`
                : `absolute ${CONTROL_RESET_CLASS} transition-transform duration-100 ease-out`
          }
          style={{
            height: thumbHeight,
            width: thumbWidth,
            marginLeft: thumbMarginLeft,
            transform: `translateX(${thumbX}px) translateY(-50%) scale(${activeThumbScale})`,
            top: sliderHeight / 2,
            left: 0,
            borderRadius: thumbRadius,
          }}
        >
          <div className="relative h-full w-full">
            <LiquidGlassBody
              filterId={filterId}
              mode={rendererMode}
              pressed={pointerDown}
              className="absolute inset-0 overflow-hidden"
              style={{
                borderRadius: thumbRadius,
                backgroundColor: `rgba(255,255,255,${backgroundOpacity})`,
                boxShadow: pointerDown
                  ? "0 4px 22px rgba(0,0,0,0.1), inset 2px 7px 24px rgba(0,0,0,0.09), inset -2px -7px 24px rgba(255,255,255,0.09)"
                  : "0 4px 22px rgba(0,0,0,0.1)",
                border: "1px solid rgba(255,255,255,0.08)",
              }}
            />
          </div>
        </button>
      </div>
    </div>
  );
}
