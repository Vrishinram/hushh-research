"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { CarouselApi } from "@/components/ui/carousel";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from "@/components/ui/carousel";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/lib/morphy-ux/button";
import { cn } from "@/lib/utils";
import { OnboardingLocalService } from "@/lib/services/onboarding-local-service";
import { ChevronRight } from "lucide-react";
import { Icon } from "@/lib/morphy-ux/ui";
import { useCarouselDeckFocus } from "@/lib/morphy-ux/hooks/use-carousel-deck-focus";
import { prefersReducedMotion, getGsap } from "@/lib/morphy-ux/gsap";
import { ensureMorphyGsapReady, getMorphyEaseName } from "@/lib/morphy-ux/gsap-init";
import { getMotionCssVars } from "@/lib/morphy-ux/motion";

import { KycPreviewCompact } from "@/components/onboarding/previews/KycPreviewCompact";
import { PortfolioPreviewCompact } from "@/components/onboarding/previews/PortfolioPreviewCompact";
import { DecisionPreviewCompact } from "@/components/onboarding/previews/DecisionPreviewCompact";

type Slide = {
  title: string;
  subtitle: string;
  preview: React.ReactNode;
};

export function PreviewCarouselStep({ onContinue }: { onContinue: () => void }) {
  const slides: Slide[] = useMemo(
    () => [
      {
        title: "Verified\nWithout friction",
        subtitle:
          "Secure identity verification\nfully compliant and completed in\nminutes",
        preview: <KycPreviewCompact />,
      },
      {
        title: "See your portfolio\nclearly",
        subtitle: "Performance, allocation, and risk\norganized in one place.",
        preview: <PortfolioPreviewCompact />,
      },
      {
        title: "Decide with\nconviction",
        subtitle:
          "Every decision is backed by structured\nanalysis and aligned to your risk profile.",
        preview: <DecisionPreviewCompact />,
      },
    ],
    []
  );

  const [api, setApi] = useState<CarouselApi | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [displayIndex, setDisplayIndex] = useState(0);
  const headerRef = useRef<HTMLDivElement | null>(null);
  const slideEls = useRef<Array<HTMLElement | null>>([]);
  const mountRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!api) return;

    const sync = () => {
      setSelectedIndex(api.selectedScrollSnap());
    };
    sync();
    api.on("select", sync);
    api.on("reInit", sync);

    return () => {
      api.off("select", sync);
      api.off("reInit", sync);
    };
  }, [api]);

  const isLast = selectedIndex === slides.length - 1;

  useCarouselDeckFocus({ activeIndex: selectedIndex, slideEls, api });

  // Step entrance animation: this is what you feel when clicking "Get Started"
  // and transitioning from Step 1 -> Step 2 without a route change.
  useEffect(() => {
    const el = mountRef.current;
    if (!el) return;
    if (prefersReducedMotion()) return;

    let cancelled = false;
    void (async () => {
      await ensureMorphyGsapReady();
      const gsap = await getGsap();
      if (!gsap || cancelled) return;
      const { durationsMs } = getMotionCssVars();
      gsap.fromTo(
        el,
        { opacity: 0, y: 10 },
        {
          opacity: 1,
          y: 0,
          duration: durationsMs.sm / 1000,
          ease: getMorphyEaseName("emphasized"),
          overwrite: "auto",
          clearProps: "opacity,transform",
        }
      );
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Animate header text changes to avoid a jump-cut when the slide index changes.
  // We fade out the old copy, swap the index, then fade in.
  useEffect(() => {
    const el = headerRef.current;
    if (!el) return;

    if (prefersReducedMotion()) {
      setDisplayIndex(selectedIndex);
      return;
    }

    let cancelled = false;

    void (async () => {
      await ensureMorphyGsapReady();
      const gsap = await getGsap();
      if (!gsap || cancelled) return;
      const { durationsMs } = getMotionCssVars();

      // Fade out quickly
      gsap.to(el, {
        opacity: 0,
        y: -4,
        duration: durationsMs.xs / 1000,
        ease: getMorphyEaseName("standard"),
        overwrite: "auto",
        onComplete: () => {
          if (cancelled) return;
          setDisplayIndex(selectedIndex);
          // Fade in new
          gsap.fromTo(
            el,
            { opacity: 0, y: 6 },
            {
              opacity: 1,
              y: 0,
              duration: durationsMs.sm / 1000,
              ease: getMorphyEaseName("emphasized"),
              overwrite: "auto",
              clearProps: "opacity,transform",
            }
          );
        },
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedIndex]);

  async function handlePrimary() {
    if (isLast) {
      await OnboardingLocalService.markMarketingSeen();
      onContinue();
      return;
    }
    api?.scrollNext();
  }

  return (
    <main
      ref={mountRef}
      className={cn(
        "h-[100dvh] w-full bg-transparent flex flex-col overflow-hidden"
      )}
    >
      <header className="flex-none px-6 pt-6 pb-2">
        <div
          ref={headerRef}
          className={cn(
            "w-full mx-auto text-center flex flex-col justify-end gap-3",
            // Responsive allocation so we never clip on tablets/desktop, while keeping mobile tight.
            "min-h-[clamp(168px,24vh,268px)]",
            "sm:max-w-lg"
          )}
        >
          <h2 className="text-[clamp(2.25rem,6vw,3.75rem)] font-black tracking-tight leading-[1.05] whitespace-pre-line">
            {slides[displayIndex]?.title}
          </h2>
          <p className="text-[clamp(0.875rem,2.2vw,1rem)] text-muted-foreground whitespace-pre-line leading-relaxed">
            {slides[displayIndex]?.subtitle}
          </p>
        </div>
      </header>

      {/* Match header/footer gutters so the first slide doesn't feel glued to the screen edge. */}
      <section className="flex-1 min-h-0 flex items-center overflow-hidden px-6">
        {/* Shadcn stock structure (CarouselDemo): Carousel -> CarouselContent -> CarouselItem -> p-1 -> Card -> CardContent */}
        <Carousel
          setApi={setApi}
          className="w-full max-w-xs sm:max-w-sm md:max-w-md mx-auto"
        >
          <CarouselContent>
            {slides.map((slide, idx) => (
              <CarouselItem key={idx}>
                <div className="p-2">
                  <Card className="border-0 bg-transparent shadow-none">
                    <CardContent className="flex items-center justify-center p-0">
                      <div
                        ref={(node) => {
                          slideEls.current[idx] = node;
                        }}
                        className="inline-block max-w-full transform-gpu will-change-transform"
                      >
                        {slide.preview}
                      </div>
                    </CardContent>
                  </Card>
                </div>
              </CarouselItem>
            ))}
          </CarouselContent>
          <CarouselPrevious />
          <CarouselNext />
        </Carousel>
      </section>

      <footer className="flex-none px-6 pt-2 pb-[calc(16px+var(--app-bottom-fixed-ui)+env(safe-area-inset-bottom))]">
        <div className="w-full sm:max-w-md mx-auto flex flex-col justify-end gap-4">
          <Dots count={slides.length} activeIndex={selectedIndex} />

          <Button
            size="lg"
            fullWidth
            onClick={handlePrimary}
            showRipple
          >
            {isLast ? "Continue" : "Next"}
            <Icon icon={ChevronRight} size="md" className="ml-2" />
          </Button>
        </div>
      </footer>
    </main>
  );
}

function Dots(props: { count: number; activeIndex: number }) {
  return (
    <div className="flex items-center justify-center gap-2">
      {Array.from({ length: props.count }).map((_, i) => (
        <span
          key={i}
          className={cn(
            "h-2 w-2 rounded-full transition-colors",
            i === props.activeIndex
              ? "bg-[var(--morphy-primary-start)]"
              : "bg-[var(--morphy-primary-start)]/20"
          )}
          aria-hidden
        />
      ))}
    </div>
  );
}
