"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getRedirectResult } from "firebase/auth";
import { AlertCircle, Shield } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { AuthService } from "@/lib/services/auth-service";
import { ApiService } from "@/lib/services/api-service";
import { auth } from "@/lib/firebase/config";
import { useAuth } from "@/lib/firebase/auth-context";
import { HushhLoader } from "@/components/ui/hushh-loader";
import { Button } from "@/lib/morphy-ux/button";
import { Card } from "@/lib/morphy-ux/card";
import { CardContent } from "@/components/ui/card";
import { useStepProgress } from "@/lib/progress/step-progress-context";
import { isAndroid } from "@/lib/capacitor/platform";

export function AuthStep({ redirectPath }: { redirectPath: string }) {
  const router = useRouter();
  const { user, loading: authLoading, setNativeUser } = useAuth();
  const { registerSteps, completeStep, reset } = useStepProgress();

  const [error, setError] = useState<string | null>(null);
  const [reviewModeConfig, setReviewModeConfig] = useState<{ enabled: boolean }>(
    { enabled: false }
  );

  const debugLog = (...args: unknown[]) => {
    if (process.env.NODE_ENV !== "production") {
      console.log(...args);
    }
  };

  const debugError = (label: string, error?: unknown) => {
    if (process.env.NODE_ENV !== "production" && error !== undefined) {
      console.error(label, error);
      return;
    }
    console.error(label);
  };

  useEffect(() => {
    registerSteps(1);
    return () => reset();
  }, [registerSteps, reset]);

  useEffect(() => {
    if (authLoading) return;
    completeStep();

    getRedirectResult(auth)
      .then((result) => {
        if (result?.user) {
          debugLog("[AuthStep] Redirect result found, navigating to:", redirectPath);
          setNativeUser(result.user);
          router.push(redirectPath);
        }
      })
      .catch((err) => {
        debugError("[AuthStep] Redirect auth error", err);
      });

    if (user) {
      debugLog("[AuthStep] User authenticated, navigating to:", redirectPath);
      router.push(redirectPath);
    }
  }, [redirectPath, user, authLoading, completeStep, router, setNativeUser]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const config = await ApiService.getAppReviewModeConfig();
      if (!cancelled) setReviewModeConfig(config);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (authLoading || user) {
    return <HushhLoader label="Checking session..." variant="fullscreen" />;
  }

  const handleGoogleLogin = async () => {
    try {
      setError(null);
      const authResult = await AuthService.signInWithGoogle();
      const user = authResult.user;

      debugLog("[AuthStep] signInWithGoogle returned user");

      if (user) {
        setNativeUser(user);
        router.push(redirectPath);
      } else {
        debugError("[AuthStep] No user returned from signInWithGoogle");
        setError("Login succeeded but no user returned");
      }
    } catch (err: any) {
      debugError("[AuthStep] Google login failed", err);
      setError(err.message || "Failed to sign in");
    }
  };

  const handleAppleLogin = async () => {
    try {
      setError(null);
      const authResult = await AuthService.signInWithApple();
      const user = authResult.user;

      debugLog("[AuthStep] signInWithApple returned user");

      if (user) {
        setNativeUser(user);
        router.push(redirectPath);
      } else {
        debugError("[AuthStep] No user returned from signInWithApple");
        setError("Login succeeded but no user returned");
      }
    } catch (err: any) {
      debugError("[AuthStep] Apple login failed", err);
      if (
        !err.message?.includes("cancelled") &&
        !err.message?.includes("canceled")
      ) {
        setError(err.message || "Failed to sign in with Apple");
      }
    }
  };

  const handleReviewerLogin = async () => {
    try {
      setError(null);

      if (!reviewModeConfig.enabled) {
        throw new Error("Reviewer mode is not enabled");
      }

      const { token } = await ApiService.createAppReviewModeSession();
      const authResult = await AuthService.signInWithCustomToken(token);
      const user = authResult.user;

      if (user) {
        setNativeUser(user);
        router.push(redirectPath);
      } else {
        setError("Reviewer login failed - no user returned");
      }
    } catch (err: any) {
      debugError("[AuthStep] Reviewer login failed", err);
      setError(err.message || "Failed to sign in as reviewer");
    }
  };

  return (
    <main className="h-full w-full bg-transparent flex flex-col items-center overflow-hidden px-6 pt-5 pb-[calc(16px+var(--app-bottom-fixed-ui)+env(safe-area-inset-bottom))]">
      <div className="w-full max-w-sm flex-1 min-h-0 flex flex-col">
        <div className="flex-1 min-h-0 flex flex-col space-y-6">
          <div className="text-center space-y-2">
            <div className="mx-auto h-20 w-20 rounded-3xl bg-black text-white dark:bg-white dark:text-black grid place-items-center shadow-[0_18px_50px_rgba(0,0,0,0.18)]">
              <span className="text-3xl font-black">Kai</span>
            </div>
            <h1 className="text-2xl font-extrabold tracking-tight">
              Sign in to continue
            </h1>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Phone onboarding is coming soon. For now, use Apple or Google.
            </p>
          </div>

          {reviewModeConfig.enabled && (
            <Card variant="none" effect="glass" className="border-yellow-500/30">
              <CardContent className="flex items-center gap-3 p-3 text-sm font-medium">
                <Shield className="h-5 w-5 text-yellow-600 dark:text-yellow-400 shrink-0" />
                <span>App Review Mode Active</span>
              </CardContent>
            </Card>
          )}

          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <div className="space-y-4 pt-1">
            <div className="space-y-3">
              {isAndroid() ? (
                <>
                  <Button
                    variant="link"
                    effect="glass"
                    size="lg"
                    fullWidth
                    className="rounded-2xl"
                    onClick={handleGoogleLogin}
                    showRipple
                  >
                    <GoogleIcon className="mr-3" />
                    Continue with Google
                  </Button>
                  <Button
                    variant="link"
                    effect="glass"
                    size="lg"
                    fullWidth
                    className="rounded-2xl"
                    onClick={handleAppleLogin}
                    showRipple
                  >
                    <AppleIcon className="mr-3" />
                    Continue with Apple
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    variant="link"
                    effect="glass"
                    size="lg"
                    fullWidth
                    className="rounded-2xl"
                    onClick={handleAppleLogin}
                    showRipple
                  >
                    <AppleIcon className="mr-3" />
                    Continue with Apple
                  </Button>
                  <Button
                    variant="link"
                    effect="glass"
                    size="lg"
                    fullWidth
                    className="rounded-2xl"
                    onClick={handleGoogleLogin}
                    showRipple
                  >
                    <GoogleIcon className="mr-3" />
                    Continue with Google
                  </Button>
                </>
              )}

              {reviewModeConfig.enabled && (
                <Button
                  variant="link"
                  effect="glass"
                  size="lg"
                  fullWidth
                  className="rounded-2xl"
                  onClick={handleReviewerLogin}
                  showRipple
                >
                  <Shield className="w-5 h-5 mr-3" />
                  Continue as Reviewer
                </Button>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="phone" className="text-sm font-semibold">
                Phone number
              </Label>
              <Input
                id="phone"
                placeholder="+1 (555) 123-4567"
                disabled
                aria-disabled="true"
              />
              <p className="text-xs text-muted-foreground">
                Coming soon. Phone sign-in is disabled in this build.
              </p>
            </div>
          </div>

          <div className="mt-auto pt-6">
            <p className="text-center text-xs text-muted-foreground/70">
              By continuing, you agree to our Terms of Service and Privacy Policy.
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}

function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg
      className={cn("w-5 h-5", className)}
      viewBox="0 0 24 24"
      aria-hidden
    >
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      />
    </svg>
  );
}

function AppleIcon({ className }: { className?: string }) {
  return (
    <svg
      className={cn("w-5 h-5", className)}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden
    >
      <path d="M17.05 20.28c-.98.95-2.05.88-3.08.38-1.07-.52-2.07-.51-3.2 0-1.01.43-2.1.49-2.98-.38C5.22 17.63 2.7 12 5.45 8.04c1.47-2.09 3.8-2.31 5.33-1.18 1.1.75 3.3.73 4.45-.04 2.1-1.31 3.55-.95 4.5 1.14-.15.08.2.14 0 .2-2.63 1.34-3.35 6.03.95 7.84-.46 1.4-1.25 2.89-2.26 4.4l-.07.08-.05-.2zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.17 2.22-1.8 4.19-3.74 4.25z" />
    </svg>
  );
}
