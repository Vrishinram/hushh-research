"use client";

import { useEffect, useLayoutEffect, type RefObject } from "react";
import { prefersReducedMotion, getGsap } from "@/lib/morphy-ux/gsap";
import { ensureMorphyGsapReady, getMorphyEaseName } from "@/lib/morphy-ux/gsap-init";
import { getMotionCssVars } from "@/lib/morphy-ux/motion";

const useIsoLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

export function usePageEnterAnimation(
  ref: RefObject<HTMLElement | null>,
  opts?: { enabled?: boolean; key?: string }
) {
  const enabled = opts?.enabled ?? true;
  const key = opts?.key;

  useIsoLayoutEffect(() => {
    if (!enabled) return;
    if (prefersReducedMotion()) return;
    const el = ref.current;
    if (!el) return;

    let revert: null | (() => void) = null;

    void (async () => {
      await ensureMorphyGsapReady();
      const gsap = await getGsap();
      if (!gsap) return;
      const { pageEnterDurationMs } = getMotionCssVars();

      // Use gsap.context when available so animations are scoped and safely reverted.
      if (gsap.context) {
        const ctx = gsap.context(() => {
          gsap.fromTo(
            el,
            { opacity: 0, y: 8 },
            {
              opacity: 1,
              y: 0,
              duration: pageEnterDurationMs / 1000,
              ease: getMorphyEaseName("emphasized"),
              overwrite: "auto",
              clearProps: "opacity,transform",
            }
          );
        }, el);
        revert = () => ctx.revert();
        return;
      }

      // Fallback: just run the tween.
      gsap.fromTo(
        el,
        { opacity: 0, y: 8 },
        {
          opacity: 1,
          y: 0,
          duration: pageEnterDurationMs / 1000,
          ease: getMorphyEaseName("emphasized"),
          overwrite: "auto",
          clearProps: "opacity,transform",
        }
      );
    })();

    return () => {
      revert?.();
    };
  }, [enabled, ref, key]);
}
