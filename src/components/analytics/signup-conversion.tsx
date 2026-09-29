"use client";

import { useEffect } from "react";
import { useUser } from "@clerk/nextjs";
import { shouldReportSignup, signupReportKey } from "@/lib/signup-conversion";

type DataLayerWindow = Window & { dataLayer?: unknown[] };

/** Reports a completed sign-up to Google Analytics once (see shouldReportSignup). */
export function SignupConversion() {
  const { user, isLoaded } = useUser();
  useEffect(() => {
    if (!isLoaded || !user) return;
    const key = signupReportKey(user.id);
    let reported = false;
    try { reported = window.localStorage.getItem(key) !== null; } catch { /* storage unavailable */ }
    const createdAt = user.createdAt ? new Date(user.createdAt).getTime() : null;
    if (!shouldReportSignup(createdAt, Date.now(), reported)) return;
    // The same queue gtag.js reads: safe to call before the script has loaded.
    const w = window as DataLayerWindow;
    w.dataLayer = w.dataLayer || [];
    // eslint-disable-next-line prefer-rest-params, @typescript-eslint/no-unused-vars
    const gtag = function gtag(..._args: unknown[]) { w.dataLayer!.push(arguments); };
    gtag("event", "sign_up", { method: user.externalAccounts?.[0]?.provider ?? "email" });
    try { window.localStorage.setItem(key, String(Date.now())); } catch { /* storage unavailable */ }
  }, [isLoaded, user]);
  return null;
}
