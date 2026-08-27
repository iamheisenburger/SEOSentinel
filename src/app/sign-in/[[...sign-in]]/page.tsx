"use client";

import { SignIn } from "@clerk/nextjs";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { AuthShell } from "@/components/auth/auth-shell";
import {
  authCounterpartUrl,
  postAuthDestination,
} from "@/lib/auth-redirect";

function SignInForm() {
  const searchParams = useSearchParams();
  const plan = searchParams.get("plan");
  const billing = searchParams.get("billing");
  const requestedRedirect = searchParams.get("redirect_url");

  const redirectUrl = postAuthDestination({
    redirectUrl: requestedRedirect,
    plan,
    billing,
  });
  const signUpUrl = authCounterpartUrl("/sign-up", {
    redirectUrl: requestedRedirect,
    plan,
    billing,
  });

  return (
    <SignIn
      routing="path"
      path="/sign-in"
      signUpUrl={signUpUrl}
      forceRedirectUrl={redirectUrl}
    />
  );
}

export default function SignInPage() {
  return (
    <AuthShell mode="sign-in">
      <Suspense>
        <SignInForm />
      </Suspense>
    </AuthShell>
  );
}
