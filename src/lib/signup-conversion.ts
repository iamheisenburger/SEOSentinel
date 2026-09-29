/** A new account reports one GA4 "sign_up" event, so each acquisition channel's
 * sign-ups are measurable. Only accounts created in the last 30 minutes count,
 * once per browser; nothing personal (no email or user id) is sent. */
export const SIGNUP_REPORT_WINDOW_MS = 30 * 60_000;

export function shouldReportSignup(createdAt: number | null | undefined, now: number, alreadyReported: boolean) {
  return typeof createdAt === "number" && Number.isFinite(createdAt) && !alreadyReported &&
    now >= createdAt && now - createdAt <= SIGNUP_REPORT_WINDOW_MS;
}

export const signupReportKey = (userId: string) => `pentra_signup_reported_${userId}`;
