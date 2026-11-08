"use client";

/**
 * Pentra Answers: where the screens read and write. In the app every call goes to the functions in
 * ops/design/answers-api.md (plus the site's existing connection functions, as the legacy Settings section uses them).
 * The dev-only harness under /e2e-acceptance swaps in a synthetic store with the same shapes, so the very same
 * components render for screenshots and click-throughs without a signed-in session.
 */
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { anyApi, type FunctionReference } from "convex/server";
import { api } from "../../../convex/_generated/api";
import type {
  AnswerPage, Check, CheckWithText, Competitor, GithubRepository, MySite, Overview, QuestionEvidence, RunProgress, SetupState,
  SiteConnection,
} from "./types";

export type QueryMap = {
  mySites: [Record<string, never>, MySite[]];
  setupState: [{ siteId: string }, SetupState | null];
  overview: [{ siteId: string }, Overview | null];
  runProgress: [{ runId: string }, RunProgress | null];
  questionEvidence: [{ questionId: string; limit?: number }, QuestionEvidence | null];
  runAnswers: [{ runId: string; limit?: number }, Check[] | null];
  answerText: [{ checkId: string }, CheckWithText | null];
  page: [{ pageId: string }, AnswerPage | null];
  /** `api.sites.get`: the site's own publishing connection (only "configured" flags for secrets). */
  siteConnection: [{ siteId: string }, SiteConnection | null];
};
export type QueryName = keyof QueryMap;

/** The site's own blog connection, saved the way the legacy Settings section saves it. */
export type ConnectionInput =
  | { siteId: string; domain: string; publishMethod: "github"; repoOwner?: string; repoName?: string }
  | { siteId: string; domain: string; publishMethod: "wordpress"; wpUrl?: string; wpUsername?: string; wpAppPassword?: string }
  | { siteId: string; domain: string; publishMethod: "webhook"; webhookUrl?: string; webhookSecret?: string }
  | { siteId: string; domain: string; publishMethod: "webflow" | "shopify" | "ghost"; cmsEndpoint?: string; cmsClientId?: string; cmsSecret?: string; cmsCollection?: string };

export type AnswersActions = {
  /** `email` (the Clerk user's primary address) lets the first hour's "ready" email reach the owner. */
  createSite(args: { domain: string; email?: string }): Promise<{ siteId: string; created: boolean }>;
  updateBusiness(args: { siteId: string; name: string; sells: string; buyers: string; offerings: string[] }): Promise<unknown>;
  confirmSetup(args: { siteId: string; name?: string; competitors: Competitor[]; country?: string }): Promise<unknown>;
  addQuestion(args: { siteId: string; question: string }): Promise<{ questionId: string }>;
  setQuestionStatus(args: { questionId: string; status: "active" | "paused" | "removed" }): Promise<unknown>;
  setPreferences(args: { siteId: string; autopublish?: boolean; weeklyEmail?: boolean }): Promise<unknown>;
  runNow(args: { siteId: string }): Promise<unknown>;
  switchToAnswers(args: { siteId: string }): Promise<unknown>;
  editDraft(args: { pageId: string; title: string; metaDescription: string; markdown: string }): Promise<unknown>;
  publishDraft(args: { pageId: string }): Promise<unknown>;
  setHostedDomain(args: { siteId: string; domain: string }): Promise<{ host: string; cname: string }>;
  usePublishingConnection(args: { siteId: string }): Promise<unknown>;
  /** Pages that failed for lack of a destination publish at once, after one is connected (answerPublish.retryFailed). */
  retryFailed(args: { siteId: string }): Promise<unknown>;
  saveConnection(args: ConnectionInput): Promise<unknown>;
  verifyConnection(args: { siteId: string }): Promise<unknown>;
  listGithubRepositories(args: { siteId: string }): Promise<GithubRepository[]>;
};

export type AnswersBackend = {
  useQuery<K extends QueryName>(name: K, args: QueryMap[K][0] | "skip"): QueryMap[K][1] | undefined;
  useActions(): AnswersActions;
  /** The clock the screens count from (the harness freezes it so screenshots are stable). */
  useNow(intervalMs: number): number;
  /** Where in-app links point ("" in the app; the harness keeps its own prefix so click-throughs stay inside it). */
  base: string;
  /** The harness has no Clerk session: account menus and checkout render stand-ins. */
  synthetic: boolean;
};

/* ─── Live: Convex ─────────────────────────────────────────────────────── */

// Ids are plain strings in these screens; Convex checks them on the server.
type AnyQuery = FunctionReference<"query">;
const QUERY_REFS: Record<QueryName, AnyQuery> = {
  mySites: api.answers.mySites,
  setupState: api.answers.setupState,
  overview: api.answers.overview,
  runProgress: api.answers.runProgress,
  questionEvidence: api.answers.questionEvidence,
  runAnswers: api.answers.runAnswers,
  answerText: api.answers.answerText,
  page: api.answerPages.page,
  siteConnection: api.sites.get,
} as unknown as Record<QueryName, AnyQuery>;

function useLiveQuery<K extends QueryName>(name: K, args: QueryMap[K][0] | "skip"): QueryMap[K][1] | undefined {
  // One generic call site for every query; the API's argument types are checked by the shapes in QueryMap.
  const query = useQuery as unknown as (ref: AnyQuery, args: Record<string, unknown> | "skip") => unknown;
  return query(QUERY_REFS[name], args as Record<string, unknown> | "skip") as QueryMap[K][1] | undefined;
}

/* eslint-disable @typescript-eslint/no-explicit-any -- the API's Id<> types meet this layer's plain strings here only. */
function useLiveActions(): AnswersActions {
  const createSite = useMutation(api.answers.createSite);
  const updateBusiness = useMutation(api.answers.updateBusiness);
  const confirmSetup = useMutation(api.answers.confirmSetup);
  const addQuestion = useMutation(api.answers.addQuestion);
  const setQuestionStatus = useMutation(api.answers.setQuestionStatus);
  const setPreferences = useMutation(api.answers.setPreferences);
  const runNow = useMutation(api.answers.runNow);
  const switchToAnswers = useMutation(api.answers.switchToAnswers);
  const editDraft = useMutation(api.answerPages.editDraft);
  const publishDraft = useMutation(api.answerPages.publishDraft);
  const setHostedDomain = useMutation(api.answerPublish.setHostedDomain);
  const usePublishingConnection = useMutation(api.answerPublish.usePublishingConnection);
  // Added by the backend owner alongside this UI (coordinator, Nov 7 2026); referenced untyped until it is generated here.
  const retryFailed = useMutation(anyApi.answerPublish.retryFailed as FunctionReference<"mutation">);
  const updateSite = useMutation(api.sites.updateSite);
  const upsert = useMutation(api.sites.upsert);
  const verify = useAction(api.publisher.verifyPublicationDestination);
  const listRepos = useAction(api.publisher.listGithubRepositories);
  return useMemo<AnswersActions>(() => ({
    createSite: (args) => createSite(args as any) as Promise<{ siteId: string; created: boolean }>,
    updateBusiness: (args) => updateBusiness(args as any),
    confirmSetup: (args) => confirmSetup(args as any),
    addQuestion: (args) => addQuestion(args as any) as Promise<{ questionId: string }>,
    setQuestionStatus: (args) => setQuestionStatus(args as any),
    setPreferences: (args) => setPreferences(args as any),
    runNow: (args) => runNow(args as any),
    switchToAnswers: (args) => switchToAnswers(args as any),
    editDraft: (args) => editDraft(args as any),
    publishDraft: (args) => publishDraft(args as any),
    setHostedDomain: (args) => setHostedDomain(args as any),
    usePublishingConnection: (args) => usePublishingConnection(args as any),
    retryFailed: (args) => retryFailed(args as any),
    saveConnection: (input) => {
      // GitHub, WordPress and webhook through updateSite (answers-api.md); Webflow, Shopify and Ghost through upsert,
      // as the legacy Settings connection section saves them.
      if (input.publishMethod === "github") return updateSite({ siteId: input.siteId as any, publishMethod: "github", repoOwner: input.repoOwner, repoName: input.repoName });
      if (input.publishMethod === "wordpress") return updateSite({ siteId: input.siteId as any, publishMethod: "wordpress", wpUrl: input.wpUrl, wpUsername: input.wpUsername, wpAppPassword: input.wpAppPassword });
      if (input.publishMethod === "webhook") return updateSite({ siteId: input.siteId as any, publishMethod: "webhook", webhookUrl: input.webhookUrl, webhookSecret: input.webhookSecret });
      return upsert({ id: input.siteId as any, domain: input.domain, publishMethod: input.publishMethod, cmsEndpoint: input.cmsEndpoint,
        cmsClientId: input.cmsClientId, cmsSecret: input.cmsSecret, cmsCollection: input.cmsCollection });
    },
    verifyConnection: (args) => verify(args as any),
    listGithubRepositories: (args) => listRepos(args as any) as Promise<GithubRepository[]>,
  }), [createSite, updateBusiness, confirmSetup, addQuestion, setQuestionStatus, setPreferences, runNow, switchToAnswers, editDraft,
    publishDraft, setHostedDomain, usePublishingConnection, retryFailed, updateSite, upsert, verify, listRepos]);
}
/* eslint-enable @typescript-eslint/no-explicit-any */

function useLiveNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}

export const liveBackend: AnswersBackend = { useQuery: useLiveQuery, useActions: useLiveActions, useNow: useLiveNow, base: "", synthetic: false };

/* ─── Context ──────────────────────────────────────────────────────────── */

const BackendContext = createContext<AnswersBackend>(liveBackend);

export function AnswersBackendProvider({ backend, children }: { backend: AnswersBackend; children: ReactNode }) {
  return <BackendContext.Provider value={backend}>{children}</BackendContext.Provider>;
}

export function useAnswersBackend(): AnswersBackend {
  return useContext(BackendContext);
}

export function useAnswersQuery<K extends QueryName>(name: K, args: QueryMap[K][0] | "skip"): QueryMap[K][1] | undefined {
  const backend = useContext(BackendContext);
  return backend.useQuery(name, args);
}

export function useAnswersActions(): AnswersActions {
  const backend = useContext(BackendContext);
  return backend.useActions();
}

export function useNow(intervalMs = 30_000): number {
  const backend = useContext(BackendContext);
  return backend.useNow(intervalMs);
}

const APP_PATH = /^\/(?:dashboard|start|upgrade)(?:[/?#]|$)/;

/** In-app paths, kept inside the harness when it renders the screens (public pages like /method stay as they are). */
export function useAppHref(): (path: string) => string {
  const { base } = useContext(BackendContext);
  return (path: string) => (base && APP_PATH.test(path) ? `${base}${path}` : path);
}
