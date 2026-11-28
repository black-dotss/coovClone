"use client";

import React, { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { ErrorPopup } from "@/components/ui/error-popup";
import { FullPageLoading } from "@/components/ui/loading-spinner";
import { signIn, signUp, authClient } from "@/lib/auth/auth-client";

function AuthForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const refParam = searchParams.get("ref");
  const callbackUrlParam = searchParams.get("callbackUrl");
  const isSignUpFromUrl = searchParams.get("register") === "true" || searchParams.get("mode") === "signup";
  const [userSelectedMode, setUserSelectedMode] = useState<boolean | null>(null);
  const isRegister = userSelectedMode ?? isSignUpFromUrl;

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  const [isGithubLoading, setIsGithubLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // OTP Verification State
  const [isOtpMode, setIsOtpMode] = useState(false);
  const [otpEmail, setOtpEmail] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [isVerifyingOtp, setIsVerifyingOtp] = useState(false);
  const [isResendingOtp, setIsResendingOtp] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [otpSuccessMessage, setOtpSuccessMessage] = useState<string | null>(null);
  const [otpErrorMessage, setOtpErrorMessage] = useState<string | null>(null);

  // Store referral parameter if present in localStorage & cookies
  useEffect(() => {
    if (refParam && refParam.trim()) {
      try {
        const clean = refParam.trim();
        localStorage.setItem("cookmycv_pending_ref", clean);
        document.cookie = `cookmycv_ref=${encodeURIComponent(clean)}; Path=/; Max-Age=2592000; SameSite=Lax`;
      } catch {}
    }
  }, [refParam]);

  // Cooldown countdown for OTP resend
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const interval = setInterval(() => {
      setResendCooldown((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(interval);
  }, [resendCooldown]);

  const handleResendOtp = async () => {
    if (resendCooldown > 0 || !otpEmail || isResendingOtp) return;
    setIsResendingOtp(true);
    setOtpErrorMessage(null);
    setOtpSuccessMessage(null);

    try {
      let sent = false;
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const clientOtp = (authClient as any).emailOtp;
        if (typeof clientOtp?.sendVerificationOtp === "function") {
          const res = await clientOtp.sendVerificationOtp({
            email: otpEmail,
            type: "email-verification",
          });
          if (res && !res.error) sent = true;
        }
      } catch {}

      if (!sent) {
        await fetch("/api/auth/email-otp/send-verification-otp", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ email: otpEmail, type: "email-verification" }),
        });
      }

      setOtpSuccessMessage("A fresh 6-digit verification code has been sent to your email.");
      setResendCooldown(60);
    } catch {
      setOtpErrorMessage("Failed to send verification code. Please try again shortly.");
    } finally {
      setIsResendingOtp(false);
    }
  };

  const handleVerifyOtp = async (codeToVerify?: string) => {
    const code = (codeToVerify || otpCode).trim();
    if (code.length < 6) {
      setOtpErrorMessage("Please enter the complete 6-digit verification code.");
      return;
    }

    setIsVerifyingOtp(true);
    setOtpErrorMessage(null);
    setOtpSuccessMessage(null);

    try {
      let verified = false;
      let failMessage = "Invalid or expired verification code.";

      // 1. Better Auth client emailOtp plugin
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const clientOtp = (authClient as any).emailOtp;
        if (typeof clientOtp?.verifyEmail === "function") {
          const res = await clientOtp.verifyEmail({
            email: otpEmail,
            otp: code,
          });
          if (res && !res.error) {
            verified = true;
          } else if (res?.error) {
            failMessage = res.error.message || failMessage;
          }
        }
      } catch (err: unknown) {
        if (err instanceof Error) failMessage = err.message;
      }

      // 2. Direct POST to /api/auth/email-otp/verify-email
      if (!verified) {
        try {
          const resp = await fetch("/api/auth/email-otp/verify-email", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ email: otpEmail, otp: code }),
          });
          if (resp.ok) {
            verified = true;
          } else {
            const data = await resp.json().catch(() => ({}));
            failMessage = data?.message || data?.error || failMessage;
          }
        } catch {}
      }

      // 3. Fallback to /api/auth/verify-email
      if (!verified) {
        try {
          const resp2 = await fetch("/api/auth/verify-email", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ email: otpEmail, token: code }),
          });
          if (resp2.ok) {
            verified = true;
          } else {
            const data2 = await resp2.json().catch(() => ({}));
            failMessage = data2?.message || data2?.error || failMessage;
          }
        } catch {}
      }

      if (!verified) {
        throw new Error(failMessage);
      }

      // If password is in state, sign in now to guarantee active session cookie
      if (password) {
        try {
          await signIn.email({
            email: otpEmail,
            password,
          });
        } catch {}
      }

      // Auto-claim pending referral
      try {
        const rawRef =
          localStorage.getItem("cookmycv_pending_ref") ||
          (document.cookie.match(/cookmycv_ref=([^;]+)/) || [])[1];
        if (rawRef) {
          const pendingRef = decodeURIComponent(rawRef).trim();
          await fetch("/api/referrals/claim", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ referrerId: pendingRef }),
          });
          localStorage.removeItem("cookmycv_pending_ref");
          document.cookie = "cookmycv_ref=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT";
        }
      } catch {}

      if (callbackUrlParam && callbackUrlParam.startsWith("/")) {
        router.push(callbackUrlParam);
      } else {
        router.push("/onboarding");
      }
    } catch (err) {
      setOtpErrorMessage(err instanceof Error ? err.message : "Verification failed. Please try again.");
    } finally {
      setIsVerifyingOtp(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setIsGoogleLoading(true);
    setErrorMessage(null);

    try {
      const targetPath = callbackUrlParam && callbackUrlParam.startsWith("/") ? callbackUrlParam : "/profile";
      const callbackURL =
        typeof window !== "undefined"
          ? `${window.location.origin}${targetPath}`
          : targetPath;

      const res = await signIn.social({
        provider: "google",
        callbackURL,
      });

      if (res?.error) {
        throw new Error(res.error.message || "Failed to start Google sign-in");
      }
      if (res?.data?.url) {
        window.location.href = res.data.url;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Google sign-in failed";
      setErrorMessage(msg);
      setIsGoogleLoading(false);
    }
  };

  const handleGithubSignIn = async () => {
    setIsGithubLoading(true);
    setErrorMessage(null);

    try {
      const targetPath = callbackUrlParam && callbackUrlParam.startsWith("/") ? callbackUrlParam : "/profile";
      const callbackURL =
        typeof window !== "undefined"
          ? `${window.location.origin}${targetPath}`
          : targetPath;

      const res = await signIn.social({
        provider: "github",
        callbackURL,
      });

      if (res?.error) {
        throw new Error(res.error.message || "Failed to start GitHub sign-in");
      }
      if (res?.data?.url) {
        window.location.href = res.data.url;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "GitHub sign-in failed";
      setErrorMessage(msg);
      setIsGithubLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setIsLoading(true);

    try {
      if (isRegister) {
        const res = await signUp.email({
          name: name.trim() || email.split("@")[0],
          email: email.trim(),
          password,
        });

        if (res.error) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const rawErr = (res.error as any)?.error || res.error;
          const msg =
            rawErr?.message ||
            res.error?.message ||
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (res.error as any)?.statusText ||
            "Failed to create account";
          const code = rawErr?.code || res.error?.code || "";

          const isVerificationRequired =
            code === "EMAIL_NOT_VERIFIED" ||
            code === "VERIFY_EMAIL" ||
            code === "EMAIL_VERIFICATION_REQUIRED" ||
            msg.toLowerCase().includes("verify") ||
            msg.toLowerCase().includes("verification") ||
            msg.toLowerCase().includes("otp") ||
            msg.toLowerCase().includes("code sent") ||
            msg.toLowerCase().includes("check your email");

          if (isVerificationRequired) {
            setOtpEmail(email.trim());
            setIsOtpMode(true);
            setResendCooldown(60);
            setErrorMessage(null);
            return;
          }

          throw new Error(msg);
        }

        const user = res.data?.user;
        if (user && user.emailVerified === false) {
          setOtpEmail(email.trim());
          setIsOtpMode(true);
          setResendCooldown(60);
          setErrorMessage(null);
          return;
        }

        try {
          const rawRef =
            localStorage.getItem("cookmycv_pending_ref") ||
            (document.cookie.match(/cookmycv_ref=([^;]+)/) || [])[1] ||
            refParam;
          if (rawRef) {
            const pendingRef = decodeURIComponent(rawRef).trim();
            await fetch("/api/referrals/claim", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              credentials: "include",
              body: JSON.stringify({ referrerId: pendingRef }),
            });
            localStorage.removeItem("cookmycv_pending_ref");
            document.cookie = "cookmycv_ref=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT";
          }
        } catch {}

        if (callbackUrlParam && callbackUrlParam.startsWith("/")) {
          router.push(callbackUrlParam);
        } else {
          router.push("/onboarding");
        }
      } else {
        const res = await signIn.email({
          email: email.trim(),
          password,
        });

        if (res.error) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const rawErr = (res.error as any)?.error || res.error;
          const msg =
            rawErr?.message ||
            res.error?.message ||
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (res.error as any)?.statusText ||
            "Invalid email or password";
          const code = rawErr?.code || res.error?.code || "";

          const isUnverified =
            code === "EMAIL_NOT_VERIFIED" ||
            msg.toLowerCase().includes("email not verified") ||
            msg.toLowerCase().includes("verify your email") ||
            msg.toLowerCase().includes("unverified");

          if (isUnverified) {
            setOtpEmail(email.trim());
            setIsOtpMode(true);
            setResendCooldown(60);
            setErrorMessage(null);
            handleResendOtp();
            return;
          }

          throw new Error(msg);
        }

        if (callbackUrlParam && callbackUrlParam.startsWith("/")) {
          router.push(callbackUrlParam);
        } else {
          router.push("/profile");
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Authentication failed";
      setErrorMessage(msg);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="relative min-h-[calc(100vh-4.5rem)] flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8">
      <div className="relative w-full max-w-sm">
        {/* Mascot peeking from top-right */}
        <div className="absolute -top-14 right-1 sm:-right-4 w-28 sm:w-34 z-20 pointer-events-none transition-transform hover:scale-105">
          <Image
            src="/doll/hanging_doll.png"
            alt="CookMyCV Mascot"
            width={140}
            height={140}
            priority
            className="w-full h-auto object-contain drop-shadow-lg"
          />
        </div>

        <Card className="w-full relative z-10 border border-border bg-surface rounded-xl p-2 shadow-xs">
          {isOtpMode ? (
            /* OTP VERIFICATION MODE */
            <>
              <CardHeader className="text-center pb-2">
                <div className="flex flex-col items-center justify-center mb-3">
                  <Link href="/">
                    <Image
                      src="/logo/logo.png"
                      alt="COOV Logo"
                      width={200}
                      height={54}
                      className="h-11 sm:h-12 w-auto object-contain mx-auto transition-transform hover:scale-105"
                      priority
                    />
                  </Link>
                </div>
                <CardTitle className="text-xl font-bold tracking-tight text-white">
                  Verify Your Email
                </CardTitle>
                <CardDescription className="text-xs text-text-secondary mt-1 leading-relaxed">
                  Enter the 6-digit verification code sent to{" "}
                  <span className="font-semibold text-white">{otpEmail}</span>.
                </CardDescription>
              </CardHeader>

              <CardContent className="pt-3 space-y-4">
                <ErrorPopup
                  title="Verification Notice"
                  message={otpErrorMessage}
                  onDismiss={() => setOtpErrorMessage(null)}
                />

                {otpSuccessMessage && (
                  <Alert variant="info" title="Code Sent">
                    {otpSuccessMessage}
                  </Alert>
                )}

                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    handleVerifyOtp();
                  }}
                  className="space-y-4"
                >
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-text-secondary block text-center">
                      6-Digit Code
                    </label>
                    <input
                      type="text"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      maxLength={6}
                      value={otpCode}
                      onChange={(e) => {
                        const val = e.target.value.replace(/\D/g, "").slice(0, 6);
                        setOtpCode(val);
                        if (val.length === 6) {
                          handleVerifyOtp(val);
                        }
                      }}
                      placeholder="••••••"
                      autoFocus
                      className="w-full text-center text-2xl font-bold font-mono tracking-[0.45em] py-3 px-4 rounded-xl border border-border bg-surface-elevated text-white focus:outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500 transition-colors"
                    />
                  </div>

                  <Button
                    type="submit"
                    variant="primary"
                    size="md"
                    className="w-full font-semibold h-10"
                    isLoading={isVerifyingOtp}
                    disabled={isVerifyingOtp || otpCode.trim().length < 6}
                  >
                    Verify & Activate Account
                  </Button>

                  <div className="pt-2 border-t border-border/60 flex flex-col items-center gap-2 text-xs">
                    <button
                      type="button"
                      onClick={handleResendOtp}
                      disabled={resendCooldown > 0 || isResendingOtp}
                      className={`font-semibold transition-colors cursor-pointer ${
                        resendCooldown > 0 || isResendingOtp
                          ? "text-text-muted cursor-not-allowed"
                          : "text-purple-400 hover:text-purple-300"
                      }`}
                    >
                      {isResendingOtp
                        ? "Sending code..."
                        : resendCooldown > 0
                        ? `Resend code in ${resendCooldown}s`
                        : "Didn't receive the code? Resend"}
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setIsOtpMode(false);
                        setOtpErrorMessage(null);
                        setOtpSuccessMessage(null);
                        setErrorMessage(null);
                      }}
                      className="text-text-muted hover:text-white transition-colors cursor-pointer text-[11px]"
                    >
                      ← Back to Sign In / Use another email
                    </button>
                  </div>
                </form>
              </CardContent>
            </>
          ) : (
            /* STANDARD SIGN-IN / REGISTER MODE */
            <>
              <CardHeader className="text-center pb-4">
                <div className="flex flex-col items-center justify-center mb-3">
                  <Link href="/">
                    <Image
                      src="/logo/logo.png"
                      alt="COOV Logo"
                      width={200}
                      height={54}
                      className="h-11 sm:h-12 w-auto object-contain mx-auto transition-transform hover:scale-105"
                      priority
                    />
                  </Link>
                </div>
                <CardTitle className="text-xl font-bold tracking-tight text-text">
                  {isRegister ? "Create Account" : "Sign In"}
                </CardTitle>
                <CardDescription className="text-xs text-text-secondary mt-1">
                  {isRegister
                    ? "Start with 3 free multi-rubric candidate audits"
                    : "Access your evaluations, reports, and mock interviews"}
                </CardDescription>

                {/* Segmented Tab Switcher */}
                <div className="mt-5 p-1 bg-surface-elevated border border-border rounded-lg flex gap-1">
                  <button
                    type="button"
                    onClick={() => {
                      setUserSelectedMode(false);
                      setErrorMessage(null);
                    }}
                    className={`flex-1 py-1.5 text-xs font-semibold rounded-md transition-all cursor-pointer ${
                      !isRegister
                        ? "bg-surface text-text shadow-xs border border-border/80"
                        : "text-text-muted hover:text-text"
                    }`}
                  >
                    Sign In
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setUserSelectedMode(true);
                      setErrorMessage(null);
                    }}
                    className={`flex-1 py-1.5 text-xs font-semibold rounded-md transition-all cursor-pointer ${
                      isRegister
                        ? "bg-surface text-text shadow-xs border border-border/80"
                        : "text-text-muted hover:text-text"
                    }`}
                  >
                    Register
                  </button>
                </div>
              </CardHeader>

              <CardContent className="pt-2">
                <ErrorPopup
                  title="Authentication Notice"
                  message={errorMessage}
                  onDismiss={() => setErrorMessage(null)}
                />

                {/* Social Logins */}
                <div className="flex flex-col gap-2.5">
                  <Button
                    type="button"
                    variant="outline"
                    size="md"
                    onClick={handleGoogleSignIn}
                    isLoading={isGoogleLoading}
                    disabled={isLoading || isGoogleLoading || isGithubLoading}
                    className="w-full flex items-center justify-center gap-2.5 border-border hover:bg-surface-elevated text-xs font-medium h-10 transition-colors"
                  >
                    <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24">
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
                        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                      />
                      <path
                        fill="#EA4335"
                        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                      />
                    </svg>
                    <span>Continue with Google</span>
                  </Button>

                  <Button
                    type="button"
                    variant="outline"
                    size="md"
                    onClick={handleGithubSignIn}
                    isLoading={isGithubLoading}
                    disabled={isLoading || isGoogleLoading || isGithubLoading}
                    className="w-full flex items-center justify-center gap-2.5 border-border hover:bg-surface-elevated text-xs font-medium h-10 transition-colors"
                  >
                    <svg className="w-4 h-4 shrink-0 fill-current text-white" viewBox="0 0 24 24">
                      <path
                        fillRule="evenodd"
                        clipRule="evenodd"
                        d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"
                      />
                    </svg>
                    <span>Continue with GitHub</span>
                  </Button>
                </div>

                {/* Divider */}
                <div className="relative my-4">
                  <div className="absolute inset-0 flex items-center">
                    <span className="w-full border-t border-border" />
                  </div>
                  <div className="relative flex justify-center text-xs uppercase tracking-wider">
                    <span className="bg-surface px-2.5 text-text-muted font-mono text-[10px]">
                      or continue with email
                    </span>
                  </div>
                </div>

                <form onSubmit={handleSubmit} className="flex flex-col gap-3.5">
                  {isRegister && (
                    <Input
                      label="Full Name"
                      placeholder="Abebe Kebede"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      required
                    />
                  )}

                  <Input
                    label="Email Address"
                    type="email"
                    placeholder="candidate@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />

                  <Input
                    label="Password"
                    type="password"
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />

                  <Button
                    type="submit"
                    variant="primary"
                    size="md"
                    className="w-full mt-2 font-semibold"
                    isLoading={isLoading}
                    disabled={isLoading || isGoogleLoading || isGithubLoading}
                  >
                    {isRegister ? "Create Account & Start Onboarding" : "Sign In to Dashboard"}
                  </Button>
                </form>
              </CardContent>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}

export default function AuthPage() {
  return (
    <Suspense fallback={<FullPageLoading />}>
      <AuthForm />
    </Suspense>
  );
}
