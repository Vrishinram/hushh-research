import { useEffect, useSyncExternalStore } from "react";

const MIN_SCROLL_Y_FOR_HIDE = 6;
const JITTER_DELTA_PX = 0.15;
const CHROME_TRAVEL_DISTANCE_PX = 150;
const PROGRESS_EPSILON = 0.001;
const APP_SCROLL_ROOT_SELECTOR = '[data-app-scroll-root="true"]';

type Listener = () => void;

interface VisibilityState {
  progress: number;
  lastY: number;
  initialized: boolean;
}

const listeners = new Set<Listener>();
let listenerRefCount = 0;
let scrollListenerAttached = false;
let activeScrollTarget: Window | HTMLElement | null = null;
const handleScroll = () => onScroll(readActiveScrollY());

const state: VisibilityState = {
  progress: 0,
  lastY: 0,
  initialized: false,
};

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

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
    state.progress = 0;
    return;
  }

  const delta = nextY - state.lastY;
  state.lastY = nextY;

  if (Math.abs(delta) < JITTER_DELTA_PX) {
    return;
  }

  if (nextY <= MIN_SCROLL_Y_FOR_HIDE) {
    if (state.progress > 0) {
      state.progress = 0;
      emit();
    }
    return;
  }

  const nextProgress = clamp01(state.progress + delta / CHROME_TRAVEL_DISTANCE_PX);
  if (Math.abs(nextProgress - state.progress) <= PROGRESS_EPSILON) {
    return;
  }
  state.progress = nextProgress;
  emit();
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
  state.progress = 0;
  state.initialized = false;
  state.lastY = readActiveScrollY();
  emit();
}

function subscribe(listener: Listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): number {
  return state.progress;
}

export function useKaiBottomChromeVisibility(enabled: boolean): {
  hidden: boolean;
  progress: number;
  onScroll: (y: number) => void;
} {
  const progress = useSyncExternalStore(subscribe, getSnapshot, () => 0);
  const hidden = progress >= 0.98;

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

  return { hidden: enabled ? hidden : false, progress: enabled ? progress : 0, onScroll };
}
