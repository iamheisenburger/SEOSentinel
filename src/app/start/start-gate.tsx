"use client";

import { UserButton, useAuth, useUser } from "@clerk/nextjs";
import { useConvexAuth } from "convex/react";
import { ToastProvider } from "@/components/ui/toast";
import { usePlanLimits } from "@/hooks/usePlanLimits";
import { StartFlow, type StartAuth } from "@/components/answers/onboarding/start-flow";

/**
 * Who is here: the server's reading of the session paints the first frame (a signed-out visitor sees the domain step
 * at once, without waiting for Clerk's script), then Clerk and Convex take over. Owner data is read only once Convex
 * has accepted the session.
 */
export function StartGate({ serverSignedIn }: { serverSignedIn: boolean }) {
  const { isLoaded, isSignedIn } = useAuth();
  const { user } = useUser();
  const convex = useConvexAuth();
  // POST /api/billing/sync-plan once signed in (again when the session's features change, as after checkout).
  usePlanLimits();
  const signedIn = isLoaded ? Boolean(isSignedIn) : serverSignedIn;
  const auth: StartAuth = !signedIn ? "signed-out" : convex.isLoading || !isLoaded ? "loading" : convex.isAuthenticated ? "signed-in" : "session-error";
  return (
    <ToastProvider>
      <StartFlow auth={auth} email={user?.primaryEmailAddress?.emailAddress ?? null} account={<UserButton userProfileMode="modal" />} />
    </ToastProvider>
  );
}
