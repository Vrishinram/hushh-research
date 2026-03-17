"use client";

import * as React from "react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  type CardProps,
} from "@/lib/morphy-ux/card";
import { cn } from "@/lib/utils";

type SurfaceTone = "default" | "feature" | "warning";

type SurfaceCardProps = Omit<CardProps, "effect" | "preset" | "showRipple" | "variant"> & {
  tone?: SurfaceTone;
};

const SURFACE_TONE_CLASSES: Record<SurfaceTone, string> = {
  default: "",
  feature: "",
  warning:
    "!border-amber-500/24 bg-amber-50/72 shadow-[0_16px_42px_rgba(146,64,14,0.09)] dark:bg-amber-950/16",
};

export const SurfaceCard = React.forwardRef<HTMLDivElement, SurfaceCardProps>(
  ({ tone = "default", className, children, ...props }, ref) => (
    <Card
      ref={ref}
      preset={tone === "feature" ? "surface-feature" : "surface"}
      variant="none"
      effect="glass"
      showRipple={false}
      className={cn(SURFACE_TONE_CLASSES[tone], className)}
      {...props}
    >
      {children}
    </Card>
  )
);

SurfaceCard.displayName = "SurfaceCard";

export const SurfaceCardHeader = React.forwardRef<
  HTMLDivElement,
  React.ComponentProps<typeof CardHeader>
>(({ className, ...props }, ref) => (
  <CardHeader
    ref={ref}
    className={cn("px-5 pb-2 pt-5 sm:px-6 sm:pt-6", className)}
    {...props}
  />
));

SurfaceCardHeader.displayName = "SurfaceCardHeader";

export const SurfaceCardTitle = React.forwardRef<
  HTMLDivElement,
  React.ComponentProps<typeof CardTitle>
>(({ className, ...props }, ref) => (
  <CardTitle
    ref={ref}
    className={cn("text-sm font-semibold tracking-tight", className)}
    {...props}
  />
));

SurfaceCardTitle.displayName = "SurfaceCardTitle";

export const SurfaceCardDescription = React.forwardRef<
  HTMLDivElement,
  React.ComponentProps<typeof CardDescription>
>(({ className, ...props }, ref) => (
  <CardDescription
    ref={ref}
    className={cn("text-xs leading-5 text-muted-foreground", className)}
    {...props}
  />
));

SurfaceCardDescription.displayName = "SurfaceCardDescription";

export const SurfaceCardContent = React.forwardRef<
  HTMLDivElement,
  React.ComponentProps<typeof CardContent>
>(({ className, ...props }, ref) => (
  <CardContent
    ref={ref}
    className={cn("px-5 pb-5 pt-0 sm:px-6 sm:pb-6", className)}
    {...props}
  />
));

SurfaceCardContent.displayName = "SurfaceCardContent";

export function SurfaceInset({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-[20px] border border-border/60 bg-background/72 p-4",
        className
      )}
      {...props}
    />
  );
}

type ChartSurfaceCardProps = Omit<SurfaceCardProps, "title"> & {
  title: React.ReactNode;
  description?: React.ReactNode;
  headerClassName?: string;
  contentClassName?: string;
};

export function ChartSurfaceCard({
  title,
  description,
  children,
  className,
  headerClassName,
  contentClassName,
  tone = "default",
  ...props
}: ChartSurfaceCardProps) {
  return (
    <SurfaceCard tone={tone} className={className} {...props}>
      <SurfaceCardHeader className={headerClassName}>
        <SurfaceCardTitle>{title}</SurfaceCardTitle>
        {description ? <SurfaceCardDescription>{description}</SurfaceCardDescription> : null}
      </SurfaceCardHeader>
      <SurfaceCardContent className={contentClassName}>{children}</SurfaceCardContent>
    </SurfaceCard>
  );
}

type FallbackSurfaceCardProps = Omit<SurfaceCardProps, "title"> & {
  title: React.ReactNode;
  detail: React.ReactNode;
  contentClassName?: string;
};

export function FallbackSurfaceCard({
  title,
  detail,
  className,
  contentClassName,
  tone = "default",
  ...props
}: FallbackSurfaceCardProps) {
  return (
    <ChartSurfaceCard
      title={title}
      tone={tone}
      className={className}
      contentClassName={cn("space-y-0", contentClassName)}
      {...props}
    >
      <div className="rounded-[20px] border border-dashed border-border/60 bg-background/60 p-4 text-sm text-muted-foreground">
        {detail}
      </div>
    </ChartSurfaceCard>
  );
}
