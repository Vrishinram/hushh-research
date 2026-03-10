"use client";

import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export function RiaPageShell({
  eyebrow,
  title,
  description,
  actions,
  children,
  className,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <main className={cn("mx-auto w-full max-w-5xl px-4 pb-28 pt-4 sm:px-6", className)}>
      <section className="rounded-[28px] border border-amber-500/15 bg-[radial-gradient(circle_at_top_left,_rgba(244,196,48,0.16),_transparent_34%),linear-gradient(180deg,rgba(18,18,20,0.94),rgba(11,12,14,0.98))] p-5 shadow-[0_20px_70px_rgba(0,0,0,0.28)]">
        {eyebrow ? (
          <p className="text-[11px] font-semibold uppercase tracking-[0.3em] text-amber-200/75">
            {eyebrow}
          </p>
        ) : null}
        <div className="mt-2 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="max-w-2xl">
            <h1 className="text-3xl font-semibold tracking-tight text-zinc-50 sm:text-4xl">
              {title}
            </h1>
            {description ? (
              <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-300 sm:text-base">
                {description}
              </p>
            ) : null}
          </div>
          {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
        </div>
      </section>

      <div className="mt-5 space-y-5">{children}</div>
    </main>
  );
}

export function RiaSurface({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "rounded-[24px] border border-border/60 bg-card/70 p-5 shadow-sm backdrop-blur-sm",
        className
      )}
    >
      {children}
    </section>
  );
}

export function RiaCompatibilityState({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <RiaSurface className="border-dashed border-amber-500/40 bg-amber-500/5">
      <div className="max-w-xl">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-amber-200/80">
          Compatibility Mode
        </p>
        <h2 className="mt-2 text-xl font-semibold text-zinc-50">{title}</h2>
        <p className="mt-2 text-sm leading-6 text-zinc-300">{description}</p>
      </div>
    </RiaSurface>
  );
}

export function MetricTile({
  label,
  value,
  helper,
}: {
  label: string;
  value: string;
  helper?: string;
}) {
  return (
    <div className="rounded-[22px] border border-border/60 bg-background/75 p-4">
      <p className="text-xs uppercase tracking-[0.22em] text-muted-foreground">{label}</p>
      <p className="mt-2 text-2xl font-semibold tracking-tight text-foreground">{value}</p>
      {helper ? <p className="mt-1 text-xs text-muted-foreground">{helper}</p> : null}
    </div>
  );
}
