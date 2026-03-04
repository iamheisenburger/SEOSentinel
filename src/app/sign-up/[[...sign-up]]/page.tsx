"use client";

import { SignUp } from "@clerk/nextjs";
import { Radar, CheckCircle2 } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

function SignUpForm() {
  const searchParams = useSearchParams();
  const plan = searchParams.get("plan");

  // If a paid plan was selected, redirect to billing after sign-up
  const redirectUrl = plan && plan !== "free"
    ? "/settings/billing"
    : "/dashboard";

  return (
    <SignUp
      signInUrl="/sign-in"
      forceRedirectUrl={redirectUrl}
    />
  );
}

export default function SignUpPage() {
  return (
    <div className="flex min-h-screen">
      {/* Left — branding & value props */}
      <div className="hidden lg:flex lg:w-1/2 flex-col items-center justify-center bg-[#0F1117] px-12">
        <div className="max-w-md">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[#0EA5E9]/[0.1] mb-6">
            <Radar className="h-6 w-6 text-[#0EA5E9]" />
          </div>
          <h1 className="text-[28px] font-bold tracking-tight text-[#F1F5F9]">
            Start ranking on autopilot
          </h1>
          <p className="mt-2 text-[15px] text-[#94A3B8] leading-relaxed">
            Connect your site and let the AI pipeline research, write, fact-check, and publish SEO articles for you.
          </p>

          <div className="mt-8 space-y-4">
            {[
              "Full AI pipeline — research to publish",
              "Fact-checked, brand-aware content",
              "Multi-platform publishing",
            ].map((item) => (
              <div key={item} className="flex items-center gap-3">
                <div className="flex h-6 w-6 items-center justify-center rounded-md bg-[#0EA5E9]/[0.1]">
                  <CheckCircle2 className="h-3.5 w-3.5 text-[#0EA5E9]" />
                </div>
                <span className="text-[14px] text-[#CBD5E1]">{item}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Right — Clerk sign-up form */}
      <div className="flex w-full lg:w-1/2 items-center justify-center bg-[#08090E] px-6">
        <Suspense>
          <SignUpForm />
        </Suspense>
      </div>
    </div>
  );
}
