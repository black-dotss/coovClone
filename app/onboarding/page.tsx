"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { ProgressBar } from "@/components/ui/progress-bar";
import { useSession } from "@/lib/auth/auth-client";
import { apiFetch } from "@/lib/client/api";

type OnboardingStep = 1 | 2 | 3 | 4;

interface UserDevice {
  id: string;
  deviceId: string;
  label?: string | null;
  status: "active" | "revoked";
  trialClaimed?: boolean;
}

export default function OnboardingPage() {
  const { data: session } = useSession();

  const [step, setStep] = useState<OnboardingStep>(1);
  const [targetTitle, setTargetTitle] = useState("");
  const [seniority, setSeniority] = useState("mid");
  const [industry, setIndustry] = useState("Technology & Software");
  const [cvText, setCvText] = useState("");
  const [devices, setDevices] = useState<UserDevice[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadDeviceData() {
      try {
        const res = await apiFetch<{ devices: UserDevice[] }>("/api/devices");
        if (res?.devices) {
          setDevices(res.devices);
        }
      } catch (_err) {
        // Continue with mock device state if needed
      }
    }

    if (session) {
      loadDeviceData();
    }
  }, [session]);

  const activeDevice = devices.find((d) => d.status === "active");

  const handleStep1Submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetTitle.trim()) {
      setError("Please specify your target job title or role");
      return;
    }
    setError(null);
    setStep(2);
  };

  const handleStep2Submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (cvText.trim().length < 50) {
      setError("Please provide at least 50 characters of CV text or experience summary");
      return;
    }
    setError(null);
    setStep(3);
  };

  const handleCompleteOnboarding = async () => {
    setSubmitting(true);
    setError(null);

    try {
      // Store draft or profile preferences if needed
      if (cvText.trim().length >= 50) {
        try {
          await apiFetch("/api/documents", {
            method: "POST",
            body: JSON.stringify({
              type: "cv",
              filename: `${targetTitle.replace(/\s+/g, "_") || "Candidate"}_CV.txt`,
              extractedText: cvText.trim(),
            }),
          });
        } catch (_docErr) {
          // Non-blocking in onboarding
        }
      }

      setStep(4);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to finalize onboarding");
    } finally {
      setSubmitting(false);
    }
  };

  const progressPercent = ((step - 1) / 3) * 100;

  return (
    <div className="min-h-[calc(100vh-4rem)] flex flex-col items-center justify-center px-4 sm:px-6 py-12">
      <div className="w-full max-w-xl flex flex-col gap-6">
        {/* Step Progress Bar */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between text-xs font-mono text-text-muted">
            <span>Step {step} of 4</span>
            <span>
              {step === 1 && "Target Role & Seniority"}
              {step === 2 && "Experience & CV Draft"}
              {step === 3 && "Device Verification & Trial"}
              {step === 4 && "Ready to Simulate"}
            </span>
          </div>
          <ProgressBar value={progressPercent} color="purple" size="sm" />
        </div>

        {error && (
          <Alert variant="danger" title="Notice">
            {error}
          </Alert>
        )}

        {/* Step 1: Target Role & Level */}
        {step === 1 && (
          <Card className="border border-border bg-surface p-6 sm:p-8">
            <CardHeader className="p-0 pb-6">
              <Badge variant="neutral" size="sm" className="w-fit mb-2">
                Candidate Setup
              </Badge>
              <CardTitle className="text-xl font-bold tracking-tight text-text">
                What role are you targeting?
              </CardTitle>
              <CardDescription className="text-xs sm:text-sm text-text-secondary mt-1">
                The 6 evaluators adapt their interview rubrics and scoring standards based on your seniority level.
              </CardDescription>
            </CardHeader>

            <CardContent className="p-0">
              <form onSubmit={handleStep1Submit} className="flex flex-col gap-5">
                <Input
                  label="Target Job Title"
                  placeholder="e.g. Senior Fullstack Engineer, Product Manager"
                  value={targetTitle}
                  onChange={(e) => setTargetTitle(e.target.value)}
                  required
                />

                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-semibold text-text">
                    Seniority Level
                  </label>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {[
                      { id: "junior", label: "Junior", exp: "0-2 yrs" },
                      { id: "mid", label: "Mid-level", exp: "3-5 yrs" },
                      { id: "senior", label: "Senior", exp: "5-8 yrs" },
                      { id: "lead", label: "Staff / Lead", exp: "8+ yrs" },
                    ].map((lvl) => (
                      <button
                        key={lvl.id}
                        type="button"
                        onClick={() => setSeniority(lvl.id)}
                        className={`p-3 rounded-lg border text-left flex flex-col gap-0.5 transition-all cursor-pointer ${
                          seniority === lvl.id
                            ? "border-text bg-surface-elevated font-semibold shadow-xs"
                            : "border-border hover:border-text-muted bg-surface"
                        }`}
                      >
                        <span className="text-xs text-text">{lvl.label}</span>
                        <span className="text-[10px] font-mono text-text-muted">{lvl.exp}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <Input
                  label="Target Industry"
                  placeholder="e.g. Fintech, E-commerce, Enterprise SaaS"
                  value={industry}
                  onChange={(e) => setIndustry(e.target.value)}
                />

                <Button type="submit" variant="primary" size="md" className="w-full mt-2 font-semibold">
                  Continue to CV Upload →
                </Button>
              </form>
            </CardContent>
          </Card>
        )}

        {/* Step 2: CV Text / Draft */}
        {step === 2 && (
          <Card className="border border-border bg-surface p-6 sm:p-8">
            <CardHeader className="p-0 pb-6">
              <Badge variant="neutral" size="sm" className="w-fit mb-2">
                CV Context
              </Badge>
              <CardTitle className="text-xl font-bold tracking-tight text-text">
                Paste your current CV text
              </CardTitle>
              <CardDescription className="text-xs sm:text-sm text-text-secondary mt-1">
                You can paste the plain text of your resume or resume summary below. You can also upload PDF/DOCX files anytime later.
              </CardDescription>
            </CardHeader>

            <CardContent className="p-0">
              <form onSubmit={handleStep2Submit} className="flex flex-col gap-5">
                <div className="flex flex-col gap-1.5">
                  <div className="flex justify-between items-center text-xs">
                    <label className="font-semibold text-text">CV Experience Text</label>
                    <span className="font-mono text-text-muted text-[11px]">
                      {cvText.length} characters
                    </span>
                  </div>
                  <textarea
                    rows={8}
                    placeholder="Paste your work experience, education, skills, and accomplishments here..."
                    value={cvText}
                    onChange={(e) => setCvText(e.target.value)}
                    required
                    className="w-full p-3 rounded-lg border border-border bg-surface text-text text-xs leading-relaxed focus:outline-hidden focus:border-text font-mono resize-y"
                  />
                </div>

                <div className="flex gap-3">
                  <Button
                    type="button"
                    variant="outline"
                    size="md"
                    onClick={() => setStep(1)}
                    className="flex-1"
                  >
                    ← Back
                  </Button>
                  <Button type="submit" variant="primary" size="md" className="flex-2 font-semibold">
                    Continue to Device Verification →
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        )}

        {/* Step 3: Device Verification & Trial Claim Notice */}
        {step === 3 && (
          <Card className="border border-border bg-surface p-6 sm:p-8">
            <CardHeader className="p-0 pb-6">
              <Badge variant="success" size="sm" className="w-fit mb-2" dot>
                Security & Allowance
              </Badge>
              <CardTitle className="text-xl font-bold tracking-tight text-text">
                Device Verification & Free Trial
              </CardTitle>
              <CardDescription className="text-xs sm:text-sm text-text-secondary mt-1">
                CookMyCV links your browser session and tracks your 3 lifetime free reviews across both your account and shared device allowance without requiring credit cards.
              </CardDescription>
            </CardHeader>

            <CardContent className="p-0 flex flex-col gap-5">
              <div className="p-4 rounded-lg border border-border bg-surface-elevated flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-text">Registered Device Status</span>
                  <Badge variant="success" size="sm">
                    {activeDevice?.label ? activeDevice.label : "Active & Authenticated"}
                  </Badge>
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs font-mono">
                  <div className="p-2.5 rounded-md bg-surface border border-border/80 flex flex-col gap-0.5">
                    <span className="text-[10px] text-text-muted">Free Trial Allowance</span>
                    <span className="font-bold text-text">3 Lifetime Reviews</span>
                  </div>
                  <div className="p-2.5 rounded-md bg-surface border border-border/80 flex flex-col gap-0.5">
                    <span className="text-[10px] text-text-muted">Daily Boundary</span>
                    <span className="font-bold text-text">Africa/Addis_Ababa</span>
                  </div>
                </div>

                <p className="text-[11px] text-text-muted leading-relaxed">
                  Your device identifier is cryptographically signed. If you switch computers or phones later, you can transfer your account using your verified email recovery code in the Profile screen.
                </p>
              </div>

              <div className="flex gap-3">
                <Button
                  type="button"
                  variant="outline"
                  size="md"
                  onClick={() => setStep(2)}
                  className="flex-1"
                >
                  ← Back
                </Button>
                <Button
                  type="button"
                  variant="primary"
                  size="md"
                  onClick={handleCompleteOnboarding}
                  isLoading={submitting}
                  className="flex-2 font-semibold"
                >
                  Confirm & Claim Free Trial →
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Step 4: Ready to Simulate */}
        {step === 4 && (
          <Card className="border border-border bg-surface p-8 text-center flex flex-col items-center justify-center">
            <div className="w-12 h-12 rounded-xl bg-purple-500/10 border border-purple-500/30 flex items-center justify-center text-purple-600 dark:text-purple-400 mb-4">
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>

            <CardTitle className="text-2xl font-bold tracking-tight text-text">
              Onboarding Complete
            </CardTitle>

            <CardDescription className="text-xs sm:text-sm text-text-secondary max-w-sm mt-2 mb-6 leading-relaxed">
              Your profile is configured for <strong className="text-text">{targetTitle || "Target Role"}</strong>. You have 3 free recruitment committee reviews available.
            </CardDescription>

            <div className="flex flex-col sm:flex-row gap-3 w-full max-w-sm">
              <Link href="/evaluations/new" className="flex-1">
                <Button variant="primary" size="md" className="w-full font-semibold">
                  Start First Review →
                </Button>
              </Link>
              <Link href="/profile" className="flex-1">
                <Button variant="outline" size="md" className="w-full">
                  Go to Profile
                </Button>
              </Link>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
