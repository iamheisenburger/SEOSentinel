import { SignIn } from "@clerk/nextjs";
import { Radar, CheckCircle2 } from "lucide-react";

export default function SignInPage() {
  return (
    <div className="flex min-h-screen">
      {/* Left — branding & value props */}
      <div className="hidden lg:flex lg:w-1/2 flex-col items-center justify-center bg-[#0F1117] px-12">
        <div className="max-w-md">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[#0EA5E9]/[0.1] mb-6">
            <Radar className="h-6 w-6 text-[#0EA5E9]" />
          </div>
          <h1 className="text-[28px] font-bold tracking-tight text-[#F1F5F9]">
            Welcome back
          </h1>
          <p className="mt-2 text-[15px] text-[#94A3B8] leading-relaxed">
            Sign in to your Pentra dashboard and continue generating SEO content on autopilot.
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

      {/* Right — Clerk sign-in form */}
      <div className="flex w-full lg:w-1/2 items-center justify-center bg-[#08090E] px-6">
        <SignIn signUpUrl="/sign-up" forceRedirectUrl="/dashboard" />
      </div>
    </div>
  );
}
