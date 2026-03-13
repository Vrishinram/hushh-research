"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";

import {
  LiquidGlassSceneProvider,
  LiquidGlassSceneRoot,
} from "@/components/labs/liquid-glass-scene";
import { useLiquidGlassRendererMode } from "@/components/labs/liquid-glass-renderer-mode";
import { useSpringValue } from "@/lib/labs/liquid-glass-core";

import { LiquidGlassBody, LiquidGlassFilter } from "./liquid-glass-filter";

type SliderSize = "small" | "medium" | "large";

const SIZE_PRESETS: Record<
  SliderSize,
  {
    sliderHeight: number;
    thumbWidth: number;
    thumbHeight: number;
    thumbRadius: number;
    bezelWidth: number;
    glassThickness: number;
  }
> = {
  small: {
    sliderHeight: 10,
    thumbWidth: 54,
    thumbHeight: 36,
    thumbRadius: 18,
    bezelWidth: 30,
    glassThickness: 30,
  },
  medium: {
    sliderHeight: 14,
    thumbWidth: 90,
    thumbHeight: 60,
    thumbRadius: 30,
    bezelWidth: 40,
    glassThickness: 40,
  },
  large: {
    sliderHeight: 18,
    thumbWidth: 126,
    thumbHeight: 84,
    thumbRadius: 42,
    bezelWidth: 50,
    glassThickness: 40,
  },
};

const SCALE_REST = 0.6;
const SCALE_DRAG = 1;
const CONTROL_RESET_CLASS =
  "appearance-none border-0 bg-transparent p-0 m-0 outline-none shadow-none";

export function LiquidGlassSliderDemo() {
  const [smallValue, setSmallValue] = useState(30);
  const [mediumValue, setMediumValue] = useState(50);
  const [largeValue, setLargeValue] = useState(70);
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
      <div className="relative -ml-4 w-[calc(100%+32px)] overflow-hidden rounded-xl border border-black/10 px-8 py-12 text-black/5 dark:border-white/10 dark:text-white/5">
        <LiquidGlassSceneRoot className="absolute inset-0">
          <div className="absolute inset-x-10 top-10 grid grid-cols-3 gap-4">
            {Array.from({ length: 3 }).map((_, index) => (
              <div
                key={index}
                className="h-24 rounded-[2rem] border border-white/10 bg-black/16"
                style={{ opacity: 0.42 + index * 0.06 }}
              />
            ))}
          </div>
          <div className="absolute inset-x-10 bottom-10 grid grid-cols-5 gap-3">
            {Array.from({ length: 10 }).map((_, index) => (
              <div
                key={index}
                className="h-14 rounded-[1.5rem] border border-white/8 bg-white/8"
                style={{ opacity: 0.24 + (index % 5) * 0.06 }}
              />
            ))}
          </div>
        </LiquidGlassSceneRoot>

        <div className="relative z-10 flex flex-col gap-10">
          <SliderField label="Full Width (Large)" value={largeValue} onValueChange={setLargeValue} size="large" />
          <SliderField label="Medium Container (Medium)" value={mediumValue} onValueChange={setMediumValue} size="medium" />
          <SliderField label="Small Container (Small)" value={smallValue} onValueChange={setSmallValue} size="small" />
        </div>
      </div>
      </section>
    </LiquidGlassSceneProvider>
  );
}

function SliderField({
  label,
  value,
  onValueChange,
  size,
}: {
  label: string;
  value: number;
  onValueChange: (next: number) => void;
  size: SliderSize;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-[0.22em] text-black/50 dark:text-white/50">{label}</span>
        <span className="text-xs font-mono text-black/60 dark:text-white/60">{value.toFixed(0)}</span>
      </div>
      <LiquidGlassSlider value={value} onValueChange={onValueChange} size={size} />
    </div>
  );
}

function LiquidGlassSlider({
  value,
  onValueChange,
  size,
  min = 0,
  max = 100,
  disabled,
}: {
  value: number;
  onValueChange: (next: number) => void;
  size: SliderSize;
  min?: number;
  max?: number;
  disabled?: boolean;
}) {
  const rendererMode = useLiquidGlassRendererMode();
  const dimensions = SIZE_PRESETS[size];
  const filterId = `liquid-slider-${useId().replace(/:/g, "-")}`;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [containerWidth, setContainerWidth] = useState(300);
  const [dragging, setDragging] = useState(false);
  const [thumbX, setThumbX] = useState(0);
  const startXRef = useRef(0);
  const startThumbXRef = useRef(0);

  const trackLeftInset = (dimensions.thumbWidth * (1 - SCALE_REST)) / 2;
  const range = Math.max(1, containerWidth - dimensions.thumbWidth);

  useEffect(() => {
    const normalized = (value - min) / (max - min || 1);
    setThumbX(Math.max(0, Math.min(range, normalized * range)));
  }, [value, min, max, range]);

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    const updateWidth = () => setContainerWidth(node.offsetWidth);
    updateWidth();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateWidth);
      return () => window.removeEventListener("resize", updateWidth);
    }

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerWidth(entry.contentRect.width);
      }
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const handleMove = (event: PointerEvent) => {
      if (!dragging || disabled) return;
      const deltaX = event.clientX - startXRef.current;
      const maxThumbX = Math.max(0, containerWidth - dimensions.thumbWidth);
      const newThumbX = Math.max(0, Math.min(maxThumbX, startThumbXRef.current + deltaX));
      setThumbX(newThumbX);
      const normalizedValue = newThumbX / Math.max(1, maxThumbX);
      const nextValue = min + normalizedValue * (max - min);
      onValueChange(nextValue);
    };

    const handleUp = () => {
      setDragging(false);
    };

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
    };
  }, [containerWidth, dimensions.thumbWidth, disabled, dragging, max, min, onValueChange]);

  const pressMultiplier = dragging ? 0.9 : 0.4;
  const scaleRatio = pressMultiplier;
  const scaleSpring = dragging ? SCALE_DRAG : SCALE_REST;
  const backgroundOpacity = dragging ? 0.1 : 1;
  const springThumbX = useSpringValue(thumbX, {
    stiffness: 140,
    damping: 18,
    mass: 1,
    precision: 0.001,
  });

  return (
    <div
      ref={containerRef}
      className={disabled ? "relative w-full opacity-50" : "relative w-full"}
      style={{ height: dimensions.thumbHeight }}
    >
      <div
        className={disabled ? "absolute cursor-not-allowed" : "absolute cursor-pointer"}
        style={{
          height: dimensions.sliderHeight,
          top: (dimensions.thumbHeight - dimensions.sliderHeight) / 2,
          left: trackLeftInset,
          right: trackLeftInset,
          backgroundColor: "#89898F66",
          borderRadius: dimensions.sliderHeight / 2,
        }}
      >
        <div className="h-full w-full overflow-hidden rounded-full">
          <div
            style={{
              height: dimensions.sliderHeight,
              width: Math.max(0, springThumbX + dimensions.thumbWidth / 2 - trackLeftInset),
              borderRadius: dimensions.sliderHeight / 2,
              backgroundColor: "#0377F7",
            }}
          />
        </div>
      </div>

      <LiquidGlassFilter
        filterId={filterId}
        enabled
        mode={rendererMode}
        options={{
          width: dimensions.thumbWidth,
          height: dimensions.thumbHeight,
          radius: dimensions.thumbRadius,
          bezelWidth: dimensions.bezelWidth,
          glassThickness: dimensions.glassThickness,
          refractiveIndex: 1.45,
          bezelType: "convex_squircle",
          shape: "pill",
          blur: 0,
          scaleRatio,
          specularOpacity: 0.4,
          specularSaturation: 7,
        }}
      />

        <button
          type="button"
          className={
          disabled
            ? `absolute ${CONTROL_RESET_CLASS} cursor-not-allowed`
            : rendererMode === "mirror"
              ? `absolute ${CONTROL_RESET_CLASS} cursor-pointer`
              : `absolute ${CONTROL_RESET_CLASS} cursor-pointer transition-transform duration-150 ease-out`
        }
        style={{
          height: dimensions.thumbHeight,
          width: dimensions.thumbWidth,
          top: "50%",
          left: springThumbX + dimensions.thumbWidth / 2,
          borderRadius: dimensions.thumbRadius,
          transform: `translate(-50%, -50%) scale(${scaleSpring})`,
          transformOrigin: "center center",
        }}
        disabled={disabled}
        onPointerDown={(event) => {
          if (disabled) return;
          setDragging(true);
          startXRef.current = event.clientX;
          startThumbXRef.current = thumbX;
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
      >
        <div className="relative h-full w-full">
          <LiquidGlassBody
            filterId={filterId}
            mode={rendererMode}
            pressed={dragging}
            className="absolute inset-0 overflow-hidden"
            style={{
              borderRadius: dimensions.thumbRadius,
              backgroundColor: `rgba(255,255,255,${backgroundOpacity})`,
              boxShadow: "0 3px 14px rgba(0,0,0,0.1)",
              border: "1px solid rgba(255,255,255,0.08)",
            }}
          />
        </div>
      </button>
    </div>
  );
}
