import { useEffect, useSyncExternalStore } from "react";

const HIDE_DELTA_PX = 24;
const REVEAL_DELTA_PX = 8;
const MIN_SCROLL_Y_FOR_HIDE = 72;
const APP_SCROLL_ROOT_SELECTOR = '[data-app-scroll-root="true"]';

type Listener = () => void;

interface VisibilityState {
  hidden: boolean;
  lastY: number;
  downDistance: number;
  upDistance: number;
  initialized: boolean;
}

const listeners = new Set<Listener>();
let listenerRefCount = 0;
let scrollListenerAttached = false;
let activeScrollTarget: Window | HTMLElement | null = null;
const handleScroll = () => onScroll(readActiveScrollY());

const state: VisibilityState = {
  hidden: false,
  lastY: 0,
  downDistance: 0,
  upDistance: 0,
  initialized: false,
};

function emit() {
  listeners.forEach((listener) => listener());
}

function readWindowY(): number {
  if (typeof window === "undefined") return 0;
  return Math.max(0, window.scrollY || window.pageYOffset || 0);
}

function readElementY(target: HTMLElement): number {
  return Math.max(0, target.scrollTop || 0);
}

function isWindowTarget(target: Window | HTMLElement | null): target is Window {
  return (
    typeof window !== "undefined" &&
    target !== null &&
    "scrollY" in target &&
    "pageYOffset" in target
  );
}

function resolveScrollTarget(): Window | HTMLElement | null {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return null;
  }
  const appScrollRoot = document.querySelector<HTMLElement>(APP_SCROLL_ROOT_SELECTOR);
  if (appScrollRoot) {
    return appScrollRoot;
  }
  return window;
}

function readActiveScrollY(): number {
  if (!activeScrollTarget || isWindowTarget(activeScrollTarget)) {
    return readWindowY();
  }
  return readElementY(activeScrollTarget);
}

export function onScroll(y: number): void {
  const nextY = Math.max(0, Number.isFinite(y) ? y : 0);

  if (!state.initialized) {
    state.initialized = true;
    state.lastY = nextY;
    return;
  }

  const delta = nextY - state.lastY;
  state.lastY = nextY;

  if (Math.abs(delta) < 1) {
    return;
  }

  if (delta > 0) {
    state.downDistance += delta;
    state.upDistance = 0;

    if (
      !state.hidden &&
      nextY >= MIN_SCROLL_Y_FOR_HIDE &&
      state.downDistance >= HIDE_DELTA_PX
    ) {
      state.hidden = true;
      state.downDistance = 0;
      emit();
    }
    return;
  }

  state.upDistance += Math.abs(delta);
  state.downDistance = 0;

  if (state.hidden && (state.upDistance >= REVEAL_DELTA_PX || nextY <= 8)) {
    state.hidden = false;
    state.upDistance = 0;
    emit();
  }
}

function attachScrollListener() {
  if (scrollListenerAttached) return;

  const target = resolveScrollTarget();
  if (!target) return;

  activeScrollTarget = target;
  target.addEventListener("scroll", handleScroll, { passive: true });
  scrollListenerAttached = true;

  onScroll(readActiveScrollY());
}

function detachScrollListener() {
  if (!scrollListenerAttached || !activeScrollTarget) return;

  activeScrollTarget.removeEventListener("scroll", handleScroll);
  scrollListenerAttached = false;
  activeScrollTarget = null;
}

export function resetKaiBottomChromeVisibility(): void {
  state.hidden = false;
  state.downDistance = 0;
  state.upDistance = 0;
  state.initialized = false;
  state.lastY = readActiveScrollY();
  emit();
}

function subscribe(listener: Listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): boolean {
  return state.hidden;
}

export function useKaiBottomChromeVisibility(enabled: boolean): {
  hidden: boolean;
  onScroll: (y: number) => void;
} {
  const hidden = useSyncExternalStore(subscribe, getSnapshot, () => false);

  useEffect(() => {
    if (!enabled) {
      resetKaiBottomChromeVisibility();
      return;
    }

    listenerRefCount += 1;
    attachScrollListener();

    return () => {
      listenerRefCount = Math.max(0, listenerRefCount - 1);
      if (listenerRefCount === 0) {
        resetKaiBottomChromeVisibility();
        detachScrollListener();
      }
    };
  }, [enabled]);

  return { hidden: enabled ? hidden : false, onScroll };
}
