"use client";

import { ClerkLoaded, ClerkLoading, SignUp } from "@clerk/nextjs";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { AuthFormLoading, AuthShell } from "@/components/auth/auth-shell";
import {
  authCounterpartUrl,
  postAuthDestination,
} from "@/lib/auth-redirect";

function SignUpForm() {
  const searchParams = useSearchParams();
  const plan = searchParams.get("plan");
  const billing = searchParams.get("billing");
  const requestedRedirect = searchParams.get("redirect_url");

  const redirectUrl = postAuthDestination({
    redirectUrl: requestedRedirect,
    plan,
    billing,
  });
  const signInUrl = authCounterpartUrl("/sign-in", {
    redirectUrl: requestedRedirect,
    plan,
    billing,
  });

  return (
    <SignUp
      routing="path"
      path="/sign-up"
      signInUrl={signInUrl}
      forceRedirectUrl={redirectUrl}
    />
  );
}

export default function SignUpPage() {
  return (
    <AuthShell mode="sign-up">
      <ClerkLoading>
        <AuthFormLoading label="Preparing secure account creation…" />
      </ClerkLoading>
      <ClerkLoaded>
        <Suspense>
          <SignUpForm />
        </Suspense>
      </ClerkLoaded>
    </AuthShell>
  );
}
