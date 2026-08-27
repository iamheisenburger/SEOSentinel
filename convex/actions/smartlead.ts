"use node";

import { createHash } from "node:crypto";
import { internal } from "../_generated/api";
import { internalAction } from "../_generated/server";
import { v } from "convex/values";
import {
  SMARTLEAD_ADAPTER_VERSION,
  SMARTLEAD_WEBHOOK_EVENT_TYPE_MAP,
  smartleadCampaignBindingHash,
  smartleadSequenceCustomFields,
} from "../lib/smartlead.ts";
import {
  decryptSmartleadProviderBinding,
  encryptSmartleadProviderBinding,
  smartleadCoreRequest,
  smartleadCanaryTarget,
  smartleadNodeConfig,
  smartleadPositiveInteger,
  smartleadRecords,
} from "../lib/smartleadNode.ts";

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function dataObject(value: unknown): Record<string, unknown> | null {
  const root = object(value);
  return object(root?.data) ?? root;
}

function campaignName(operationKey: string, generation: number): string {
  return `Pentra ${operationKey.slice(0, 24)} g${generation}`;
}

function campaignRows(value: unknown): Record<string, unknown>[] {
  const root = object(value);
  const data = root && "data" in root ? root.data : value;
  return Array.isArray(data)
    ? data.map(object).filter((row): row is Record<string, unknown> => Boolean(row))
    : smartleadRecords(value);
}

function exactWebhookConfiguration(
  row: Record<string, unknown>,
  name: string,
  webhookUrl: string,
): boolean {
  if (String(row.name ?? "") !== name || String(row.webhook_url ?? "") !== webhookUrl) {
    return false;
  }
  const canonicalEvent = (value: string) => ({
    SENT: "EMAIL_SENT",
    EMAIL_REPLIED: "EMAIL_REPLY",
    LEAD_REPLIED: "EMAIL_REPLY",
    REPLIED: "EMAIL_REPLY",
    EMAIL_BOUNCED: "EMAIL_BOUNCE",
    LEAD_BOUNCED: "EMAIL_BOUNCE",
    BOUNCED: "EMAIL_BOUNCE",
    EMAIL_UNSUBSCRIBED: "LEAD_UNSUBSCRIBED",
    UNSUBSCRIBED: "LEAD_UNSUBSCRIBED",
  }[value.trim().toUpperCase()] ?? value.trim().toUpperCase());
  const expected = Object.keys(SMARTLEAD_WEBHOOK_EVENT_TYPE_MAP)
    .map(canonicalEvent).sort();
  const map = object(row.event_type_map);
  const actual = map
    ? Object.entries(map).filter(([, enabled]) => enabled === true)
      .map(([event]) => canonicalEvent(event)).sort()
    : Array.isArray(row.event_types)
      ? row.event_types.map(String).map(canonicalEvent).sort()
      : [];
  return JSON.stringify(actual) === JSON.stringify(expected);
}

function leadRecord(row: Record<string, unknown>): Record<string, unknown> {
  return object(row.lead) ?? row;
}

type SubmitSequenceResult =
  | { ok: true; queued: true }
  | { ok: false; ambiguous: boolean; reason: string };

type PauseLeadResult = {
  paused: boolean;
  reason?: string;
};

type ReconcileSequenceResult = {
  reconciled: boolean;
  terminal?: boolean;
};

const CONTROLLED_CANARY_KINDS = [
  "delivery", "reply", "bounce", "unsubscribe",
] as const;

function canaryCampaignName(kind: string, operationKey: string): string {
  return `Pentra controlled ${kind} ${operationKey.slice(0, 20)}`;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function findExactLead(args: {
  config: NonNullable<ReturnType<typeof smartleadNodeConfig>>;
  campaignId: number;
  toEmail: string;
  operationKey: string;
}): Promise<{ state: "missing" | "found" | "conflict" | "unavailable"; leadId?: number }> {
  const matches: number[] = [];
  for (let offset = 0; offset < 1_000; offset += 100) {
    const response = await smartleadCoreRequest({
      config: args.config,
      path: `/api/v1/campaigns/${args.campaignId}/leads?offset=${offset}&limit=100`,
    });
    if (!response.ok) return { state: "unavailable" };
    const rows = smartleadRecords(response.json);
    for (const row of rows) {
      const lead = leadRecord(row);
      const custom = object(lead.custom_fields) ?? object(row.custom_fields);
      if (
        String(lead.email ?? "").trim().toLowerCase() === args.toEmail &&
        String(custom?.pentra_operation_key ?? "") === args.operationKey
      ) {
        const id = smartleadPositiveInteger(lead.id ?? row.campaign_lead_map_id);
        if (id) matches.push(id);
      }
    }
    if (rows.length < 100) break;
  }
  const unique = [...new Set(matches)];
  if (unique.length > 1) return { state: "conflict" };
  return unique.length === 1
    ? { state: "found", leadId: unique[0] }
    : { state: "missing" };
}

type PlannedSequence = {
  sequenceStep: number;
  subject: string;
  body: string;
  delayDays: number;
};

type CampaignConfigurationExpectation = {
  name: string;
  mailboxId: number;
  sequences: PlannedSequence[];
  startHour: string;
  endHour: string;
};

type CampaignConfigurationResult =
  | { ready: true }
  | { ready: false; ambiguous: boolean; reason: string };

function nestedNumber(
  value: Record<string, unknown> | null,
  ...keys: string[]
): number | null {
  for (const key of keys) {
    const parsed = Number(value?.[key]);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function nestedString(
  value: Record<string, unknown> | null,
  ...keys: string[]
): string {
  for (const key of keys) {
    const candidate = value?.[key];
    if (typeof candidate === "string") return candidate;
  }
  return "";
}

function exactSequenceConfiguration(
  value: unknown,
  expected: PlannedSequence[],
): "missing" | "exact" | "conflict" {
  const rows = smartleadRecords(value).sort((left, right) =>
    Number(left.seq_number ?? 0) - Number(right.seq_number ?? 0));
  if (rows.length === 0) return "missing";
  if (rows.length !== expected.length) return "conflict";
  return rows.every((row, index) => {
    const delay = object(row.seq_delay_details);
    return Number(row.seq_number) === index + 1 &&
      String(row.subject ?? "") === `{{pentra_subject_${index}}}` &&
      String(row.email_body ?? "") === `{{pentra_body_${index}}}` &&
      (nestedNumber(delay, "delay_in_days", "delayInDays") ?? 0) ===
        expected[index].delayDays;
  }) ? "exact" : "conflict";
}

function exactAccountConfiguration(
  value: unknown,
  mailboxId: number,
): "missing" | "exact" | "conflict" {
  const ids = [...new Set(smartleadRecords(value)
    .map((row) => smartleadPositiveInteger(row.id))
    .filter((id): id is number => Boolean(id)))];
  if (ids.length === 0) return "missing";
  return ids.length === 1 && ids[0] === mailboxId ? "exact" : "conflict";
}

function campaignSettingsExact(
  campaign: Record<string, unknown>,
  expected: CampaignConfigurationExpectation,
): boolean {
  const track = Array.isArray(campaign.track_settings)
    ? campaign.track_settings.map(String)
    : [String(campaign.track_settings ?? "")];
  return String(campaign.name ?? "") === expected.name &&
    track.some((value) =>
      ["DONT_EMAIL_OPEN", "DONT_TRACK_EMAIL_OPEN"].includes(value)) &&
    String(campaign.stop_lead_settings ?? "") === "REPLY_TO_AN_EMAIL" &&
    campaign.send_as_plain_text === true;
}

function campaignScheduleExact(
  campaign: Record<string, unknown>,
  expected: CampaignConfigurationExpectation,
): boolean {
  const schedule = object(
    campaign.scheduler_cron_value ?? campaign.schedule,
  );
  const days = schedule?.days ?? schedule?.days_of_week ??
    schedule?.daysOfWeek;
  const normalizedDays = Array.isArray(days)
    ? days.map(Number).filter(Number.isFinite).sort()
    : [];
  return nestedString(schedule, "timezone", "timezone_name", "tz") ===
      "America/New_York" &&
    JSON.stringify(normalizedDays) === JSON.stringify([1, 2, 3, 4, 5]) &&
    nestedString(schedule, "start_hour", "start_time", "startHour") ===
      expected.startHour &&
    nestedString(schedule, "end_hour", "end_time", "endHour") ===
      expected.endHour &&
    nestedNumber(
      schedule,
      "min_time_btw_emails",
      "min_time_between_emails",
      "minTimeBetweenEmails",
    ) === 120;
}

/** Re-read every externally visible configuration surface before a lead is
 * added. Missing state may be repaired only after the durable boundary is
 * recorded; conflicting state is never overwritten. Every write is followed
 * by the same read contract, so a lost acknowledgement cannot cause a blind
 * replay on the next invocation. */
async function ensureCampaignConfiguration(args: {
  config: NonNullable<ReturnType<typeof smartleadNodeConfig>>;
  campaignId: number;
  expected: CampaignConfigurationExpectation;
  allowRepair: boolean;
}): Promise<CampaignConfigurationResult> {
  const inspect = async () => {
    const [campaignResponse, sequenceResponse, accountResponse] =
      await Promise.all([
        smartleadCoreRequest({
          config: args.config,
          path: `/api/v1/campaigns/${args.campaignId}`,
        }),
        smartleadCoreRequest({
          config: args.config,
          path: `/api/v1/campaigns/${args.campaignId}/sequences`,
        }),
        smartleadCoreRequest({
          config: args.config,
          path: `/api/v1/campaigns/${args.campaignId}/email-accounts`,
        }),
      ]);
    if (!campaignResponse.ok || !sequenceResponse.ok || !accountResponse.ok) {
      return { available: false as const };
    }
    const campaign = dataObject(campaignResponse.json);
    if (!campaign || String(campaign.name ?? "") !== args.expected.name) {
      return { available: true as const, conflict: true as const };
    }
    const sequences = exactSequenceConfiguration(
      sequenceResponse.json,
      args.expected.sequences,
    );
    const accounts = exactAccountConfiguration(
      accountResponse.json,
      args.expected.mailboxId,
    );
    return {
      available: true as const,
      conflict: sequences === "conflict" || accounts === "conflict",
      sequences,
      accounts,
      settings: campaignSettingsExact(campaign, args.expected),
      schedule: campaignScheduleExact(campaign, args.expected),
    };
  };

  let current = await inspect();
  if (!current.available) {
    return { ready: false, ambiguous: true, reason: "campaign_configuration_reconciliation_failed" };
  }
  if (current.conflict) {
    return { ready: false, ambiguous: false, reason: "campaign_configuration_conflict" };
  }
  if (
    current.sequences === "exact" && current.accounts === "exact" &&
    current.settings && current.schedule
  ) return { ready: true };
  if (!args.allowRepair) {
    return { ready: false, ambiguous: false, reason: "campaign_configuration_drift" };
  }

  const post = async (path: string, body: Record<string, unknown>) => {
    const response = await smartleadCoreRequest({
      config: args.config,
      path,
      method: "POST",
      body,
    });
    return response.ok;
  };
  if (current.sequences === "missing" && !await post(
    `/api/v1/campaigns/${args.campaignId}/sequences`,
    {
      sequences: args.expected.sequences.map((entry) => ({
        id: null,
        seq_number: entry.sequenceStep + 1,
        subject: `{{pentra_subject_${entry.sequenceStep}}}`,
        email_body: `{{pentra_body_${entry.sequenceStep}}}`,
        seq_delay_details: { delay_in_days: entry.delayDays },
      })),
    },
  )) return { ready: false, ambiguous: true, reason: "campaign_sequences_ack_ambiguous" };
  if (current.accounts === "missing" && !await post(
    `/api/v1/campaigns/${args.campaignId}/email-accounts`,
    { email_account_ids: [args.expected.mailboxId] },
  )) return { ready: false, ambiguous: true, reason: "campaign_accounts_ack_ambiguous" };
  if (!current.settings && !await post(
    `/api/v1/campaigns/${args.campaignId}/settings`,
    {
      name: args.expected.name,
      track_settings: "DONT_TRACK_EMAIL_OPEN",
      stop_lead_settings: "REPLY_TO_AN_EMAIL",
      unsubscribe_text: "Unsubscribe: {{unsubscribe_link}}",
      send_as_plain_text: true,
      force_plain_text: true,
      follow_up_percentage: 100,
      auto_pause_domain_leads_on_reply: true,
      domain_level_rate_limit: true,
    },
  )) return { ready: false, ambiguous: true, reason: "campaign_settings_ack_ambiguous" };
  if (!current.schedule && !await post(
    `/api/v1/campaigns/${args.campaignId}/schedule`,
    {
      schedule: {
        timezone: "America/New_York",
        days: [1, 2, 3, 4, 5],
        start_hour: args.expected.startHour,
        end_hour: args.expected.endHour,
        min_time_btw_emails: 120,
      },
    },
  )) return { ready: false, ambiguous: true, reason: "campaign_schedule_ack_ambiguous" };

  current = await inspect();
  if (!current.available) {
    return { ready: false, ambiguous: true, reason: "campaign_configuration_verification_failed" };
  }
  if (current.conflict) {
    return { ready: false, ambiguous: false, reason: "campaign_configuration_conflict" };
  }
  return current.sequences === "exact" && current.accounts === "exact" &&
      current.settings && current.schedule
    ? { ready: true }
    : { ready: false, ambiguous: true, reason: "campaign_configuration_unverified" };
}

export const submitSequence = internalAction({
  args: {
    siteId: v.id("sites"),
    messageId: v.id("outreach_messages"),
    attemptId: v.string(),
  },
  handler: async (ctx, args): Promise<SubmitSequenceResult> => {
    const config = smartleadNodeConfig();
    if (!config) return { ok: false as const, ambiguous: false as const, reason: "runtime_unavailable" };
    const operation = await ctx.runQuery(
      internal.outreach.getSmartleadDeliveryOperationInternal,
      args,
    );
    if (!operation) return { ok: false as const, ambiguous: false as const, reason: "fence_changed" };
    const baseBinding = decryptSmartleadProviderBinding(
      config,
      operation.resource.encryptedProviderBinding,
    );
    if (!baseBinding) return { ok: false as const, ambiguous: false as const, reason: "binding_invalid" };
    const generation = operation.resource.generation;
    const expectedName = campaignName(operation.resource.operationKey, generation);
    const campaigns = await smartleadCoreRequest({
      config,
      path: `/api/v1/campaigns/?client_id=${baseBinding.clientId}`,
    });
    if (!campaigns.ok) return { ok: false as const, ambiguous: true as const, reason: "campaign_reconciliation_failed" };
    const exactCampaigns = campaignRows(campaigns.json).filter((row) =>
      String(row.name ?? "") === expectedName &&
      smartleadPositiveInteger(row.client_id) === baseBinding.clientId
    );
    if (exactCampaigns.length > 1) {
      return { ok: false as const, ambiguous: true as const, reason: "campaign_identity_conflict" };
    }
    let campaignId = exactCampaigns.length === 1
      ? smartleadPositiveInteger(exactCampaigns[0].id)
      : null;
    const storedCampaign = decryptSmartleadProviderBinding(
      config,
      operation.resource.encryptedProviderCampaignBinding,
    );
    if (
      storedCampaign?.campaignId && campaignId &&
      storedCampaign.campaignId !== campaignId
    ) return { ok: false as const, ambiguous: true as const, reason: "campaign_binding_conflict" };
    campaignId = campaignId ?? storedCampaign?.campaignId ?? null;
    if (!campaignId) {
      if (operation.resource.campaignRequestedAt) {
        return { ok: false as const, ambiguous: true as const, reason: "campaign_ack_ambiguous" };
      }
      const boundary = await ctx.runMutation(
        internal.outreach.recordSmartleadProviderProgressInternal,
        { ...args, phase: "campaign" },
      );
      if (!boundary.recorded) return { ok: false as const, ambiguous: false as const, reason: "fence_changed" };
      const created = await smartleadCoreRequest({
        config,
        path: "/api/v1/campaigns/create",
        method: "POST",
        body: { name: expectedName, client_id: baseBinding.clientId },
      });
      campaignId = created.ok
        ? smartleadPositiveInteger(dataObject(created.json)?.id)
        : null;
      if (!campaignId) return { ok: false as const, ambiguous: true as const, reason: "campaign_ack_ambiguous" };
      const encryptedCampaignBinding = encryptSmartleadProviderBinding(config, {
        ...baseBinding,
        campaignId,
      });
      const stored = await ctx.runMutation(
        internal.outreach.recordSmartleadProviderProgressInternal,
        { ...args, phase: "campaign", encryptedCampaignBinding },
      );
      if (!stored.recorded) return { ok: false as const, ambiguous: true as const, reason: "campaign_receipt_unstored" };
    }
    const webhookName = `Pentra ${operation.resource.operationKey.slice(0, 24)}`;
    const webhooks = await smartleadCoreRequest({
      config,
      path: `/api/v1/campaigns/${campaignId}/webhooks`,
    });
    if (!webhooks.ok) {
      return { ok: false as const, ambiguous: true as const, reason: "webhook_reconciliation_failed" };
    }
    const matchingWebhooks = smartleadRecords(webhooks.json).filter((row) =>
      String(row.name ?? "") === webhookName &&
      String(row.webhook_url ?? "") === config.webhookUrl);
    if (matchingWebhooks.length === 1 && !exactWebhookConfiguration(
      matchingWebhooks[0], webhookName, config.webhookUrl,
    )) {
      return { ok: false as const, ambiguous: false as const, reason: "webhook_configuration_conflict" };
    }
    const exactWebhooks = matchingWebhooks.filter((row) =>
      exactWebhookConfiguration(row, webhookName, config.webhookUrl));
    if (exactWebhooks.length > 1) {
      return { ok: false as const, ambiguous: true as const, reason: "webhook_identity_conflict" };
    }
    let webhookId = exactWebhooks.length === 1
      ? smartleadPositiveInteger(exactWebhooks[0].id)
      : storedCampaign?.webhookId ?? null;
    if (!webhookId) {
      if (operation.resource.webhookRequestedAt) {
        return { ok: false as const, ambiguous: true as const, reason: "webhook_ack_ambiguous" };
      }
      const webhookBoundary = await ctx.runMutation(
        internal.outreach.recordSmartleadProviderProgressInternal,
        { ...args, phase: "webhook" },
      );
      if (!webhookBoundary.recorded) {
        return { ok: false as const, ambiguous: false as const, reason: "fence_changed" };
      }
      const createdWebhook = await smartleadCoreRequest({
        config,
        path: "/api/v1/webhook/create",
        method: "POST",
        body: {
          name: webhookName,
          webhook_url: config.webhookUrl,
          association_type: "campaign",
          email_campaign_id: campaignId,
          event_type_map: SMARTLEAD_WEBHOOK_EVENT_TYPE_MAP,
        },
      });
      webhookId = createdWebhook.ok
        ? smartleadPositiveInteger(dataObject(createdWebhook.json)?.id)
        : null;
      if (!webhookId) {
        return { ok: false as const, ambiguous: true as const, reason: "webhook_ack_ambiguous" };
      }
    }
    const providerBinding = {
      ...baseBinding,
      campaignId,
      webhookId,
    };
    const encryptedCampaignBinding =
      encryptSmartleadProviderBinding(config, providerBinding);
    const webhookStored = await ctx.runMutation(
      internal.outreach.recordSmartleadProviderProgressInternal,
      { ...args, phase: "webhook", encryptedCampaignBinding },
    );
    if (!webhookStored.recorded) {
      return { ok: false as const, ambiguous: true as const, reason: "webhook_receipt_unstored" };
    }
    if (!operation.resource.campaignConfiguredAt) {
      const boundary = await ctx.runMutation(
        internal.outreach.recordSmartleadProviderProgressInternal,
        { ...args, phase: "configuration", encryptedCampaignBinding },
      );
      if (!boundary.recorded) return { ok: false as const, ambiguous: false as const, reason: "fence_changed" };
    }
    const configuration = await ensureCampaignConfiguration({
      config,
      campaignId,
      expected: {
        name: expectedName,
        mailboxId: baseBinding.mailboxId,
        sequences: operation.message.providerPlannedSequence!,
        startHour: "09:00",
        endHour: "17:00",
      },
      allowRepair: !operation.resource.campaignConfiguredAt,
    });
    if (!configuration.ready) {
      return {
        ok: false as const,
        ambiguous: configuration.ambiguous,
        reason: configuration.reason,
      };
    }
    if (!operation.resource.campaignConfiguredAt) {
      const configured = await ctx.runMutation(
        internal.outreach.recordSmartleadProviderProgressInternal,
        {
          ...args,
          phase: "configuration",
          encryptedCampaignBinding,
          completed: true,
        },
      );
      if (!configured.recorded) return { ok: false as const, ambiguous: true as const, reason: "campaign_configuration_unstored" };
    }
    const existingLead = await findExactLead({
      config,
      campaignId,
      toEmail: operation.message.toEmail,
      operationKey: operation.message.providerOperationKey!,
    });
    if (existingLead.state === "conflict" || existingLead.state === "unavailable") {
      return { ok: false as const, ambiguous: true as const, reason: "lead_reconciliation_failed" };
    }
    let leadId = existingLead.leadId ?? null;
    if (!leadId) {
      if (operation.message.providerAcknowledgementState === "lead_boundary_crossed") {
        return { ok: false as const, ambiguous: true as const, reason: "lead_ack_ambiguous" };
      }
      const boundary = await ctx.runMutation(
        internal.outreach.recordSmartleadProviderProgressInternal,
        { ...args, phase: "lead" },
      );
      if (!boundary.recorded) return { ok: false as const, ambiguous: false as const, reason: "fence_changed" };
      const customFields = smartleadSequenceCustomFields({
        operationKey: operation.message.providerOperationKey!,
        messages: operation.message.providerPlannedSequence!,
      });
      const added = await smartleadCoreRequest({
        config,
        path: `/api/v1/campaigns/${campaignId}/leads`,
        method: "POST",
        body: {
          lead_list: [{
            email: operation.message.toEmail,
            company_name: operation.message.toDomain,
            custom_fields: customFields,
          }],
          settings: {
            ignore_global_block_list: false,
            ignore_unsubscribe_list: false,
            ignore_duplicate_leads_in_other_campaign: false,
            ignore_community_bounce_list: false,
            return_lead_ids: true,
          },
        },
      });
      const addedBody = dataObject(added.json);
      const leadIds = Array.isArray(addedBody?.lead_ids)
        ? addedBody!.lead_ids as unknown[]
        : [];
      leadId = added.ok && leadIds.length === 1
        ? smartleadPositiveInteger(leadIds[0])
        : null;
      if (!leadId) {
        const reconciled = await findExactLead({
          config,
          campaignId,
          toEmail: operation.message.toEmail,
          operationKey: operation.message.providerOperationKey!,
        });
        leadId = reconciled.state === "found" ? reconciled.leadId! : null;
      }
      if (!leadId) return { ok: false as const, ambiguous: true as const, reason: "lead_ack_ambiguous" };
    }
    const currentCampaign = await smartleadCoreRequest({
      config,
      path: `/api/v1/campaigns/${campaignId}`,
    });
    const currentStatus = String(dataObject(currentCampaign.json)?.status ?? "");
    if (currentStatus !== "ACTIVE") {
      const started = await smartleadCoreRequest({
        config,
        path: `/api/v1/campaigns/${campaignId}/status`,
        method: "POST",
        body: { status: "START" },
      });
      if (!started.ok) {
        const reconciled = await smartleadCoreRequest({
          config,
          path: `/api/v1/campaigns/${campaignId}`,
        });
        if (String(dataObject(reconciled.json)?.status ?? "") !== "ACTIVE") {
          return { ok: false as const, ambiguous: true as const, reason: "campaign_activation_ambiguous" };
        }
      }
    }
    const encryptedLeadBinding = encryptSmartleadProviderBinding(config, {
      ...providerBinding,
      leadId,
    });
    const providerLeadBindingHash = createHash("sha256")
      .update(`${SMARTLEAD_ADAPTER_VERSION}:${campaignId}:${leadId}`)
      .digest("hex");
    const providerCampaignBindingHash =
      smartleadCampaignBindingHash(campaignId);
    const providerRecipientHash = createHash("sha256")
      .update(operation.message.toEmail.trim().toLowerCase())
      .digest("hex");
    const queued: { recorded: boolean } = await ctx.runMutation(
      internal.outreach.recordSmartleadProviderProgressInternal,
      {
        ...args,
        phase: "queued",
        encryptedLeadBinding,
        providerLeadBindingHash,
        providerCampaignBindingHash,
        providerRecipientHash,
      },
    );
    return queued.recorded
      ? { ok: true as const, queued: true as const }
      : { ok: false as const, ambiguous: true as const, reason: "lead_receipt_unstored" };
  },
});

export const pauseLead = internalAction({
  args: {
    siteId: v.id("sites"),
    messageId: v.id("outreach_messages"),
    operationKey: v.string(),
  },
  handler: async (ctx, args): Promise<PauseLeadResult> => {
    const config = smartleadNodeConfig();
    if (!config) {
      await ctx.runMutation(
        internal.outreach.recordSmartleadPauseFailureInternal,
        { ...args, reason: "runtime_unavailable" },
      );
      return { paused: false as const, reason: "runtime_unavailable" };
    }
    const operation = await ctx.runQuery(
      internal.outreach.getSmartleadPauseOperationInternal,
      args,
    );
    if (!operation) return { paused: false as const, reason: "fence_changed" };
    const binding = decryptSmartleadProviderBinding(
      config,
      operation.encryptedProviderLeadBinding,
    );
    if (!binding?.campaignId || !binding.leadId) {
      await ctx.runMutation(
        internal.outreach.recordSmartleadPauseFailureInternal,
        { ...args, reason: "binding_invalid" },
      );
      return { paused: false as const, reason: "binding_invalid" };
    }
    if (operation.requiresGlobalUnsubscribe) {
      const current = await smartleadCoreRequest({
        config,
        path: `/api/v1/leads/${binding.leadId}`,
      });
      const alreadyUnsubscribed = current.ok &&
        dataObject(current.json)?.is_unsubscribed === true;
      if (!alreadyUnsubscribed) {
        if (operation.globalUnsubscribeAttemptedAt) {
          await ctx.runMutation(
            internal.outreach.recordSmartleadPauseFailureInternal,
            { ...args, reason: "global_unsubscribe_unverified" },
          );
          return { paused: false as const, reason: "global_unsubscribe_unverified" };
        }
        const boundary: { recorded: boolean } = await ctx.runMutation(
          internal.outreach.recordSmartleadGlobalUnsubscribeBoundaryInternal,
          args,
        );
        if (!boundary.recorded) {
          return { paused: false as const, reason: "fence_changed" };
        }
        const unsubscribe = await smartleadCoreRequest({
          config,
          path: `/api/v1/leads/${binding.leadId}/unsubscribe`,
          method: "POST",
        });
        if (!unsubscribe.ok || dataObject(unsubscribe.json)?.ok !== true) {
          await ctx.runMutation(
            internal.outreach.recordSmartleadPauseFailureInternal,
            { ...args, reason: "global_unsubscribe_unverified" },
          );
          return { paused: false as const, reason: "global_unsubscribe_unverified" };
        }
      }
      const unsubscribeReceipt: { recorded: boolean } = await ctx.runMutation(
        internal.outreach.recordSmartleadGlobalUnsubscribeReceiptInternal,
        args,
      );
      if (!unsubscribeReceipt.recorded) {
        return { paused: false as const, reason: "fence_changed" };
      }
    }
    const response = await smartleadCoreRequest({
      config,
      path: `/api/v1/campaigns/${binding.campaignId}/leads/${binding.leadId}/pause`,
      method: "POST",
    });
    if (!response.ok) {
      await ctx.runMutation(
        internal.outreach.recordSmartleadPauseFailureInternal,
        { ...args, reason: "pause_unverified" },
      );
      return { paused: false as const, reason: "pause_unverified" };
    }
    const stored: { recorded: boolean } = await ctx.runMutation(
      internal.outreach.recordSmartleadPauseReceiptInternal,
      args,
    );
    return { paused: stored.recorded, reason: stored.recorded ? undefined : "fence_changed" };
  },
});

/** Read-only provider recovery for an acknowledgement that was lost after a
 * boundary. It can discover the exact existing campaign/lead, but it never
 * creates or re-adds anything. */
export const reconcileSequence = internalAction({
  args: {
    siteId: v.id("sites"),
    messageId: v.id("outreach_messages"),
    operationKey: v.string(),
  },
  handler: async (ctx, args): Promise<ReconcileSequenceResult> => {
    const config = smartleadNodeConfig();
    const operation = await ctx.runQuery(
      internal.outreach.getSmartleadReconciliationOperationInternal,
      args,
    );
    if (!config || !operation) return { reconciled: false };
    const baseBinding = decryptSmartleadProviderBinding(
      config,
      operation.resource.encryptedProviderBinding,
    );
    if (!baseBinding) return { reconciled: false };
    const expectedName = campaignName(
      operation.resource.operationKey,
      operation.resource.generation,
    );
    const campaigns = await smartleadCoreRequest({
      config,
      path: `/api/v1/campaigns/?client_id=${baseBinding.clientId}`,
    });
    const exact = campaigns.ok
      ? campaignRows(campaigns.json).filter((row) =>
          String(row.name ?? "") === expectedName &&
          smartleadPositiveInteger(row.client_id) === baseBinding.clientId)
      : [];
    const stored = decryptSmartleadProviderBinding(
      config,
      operation.resource.encryptedProviderCampaignBinding,
    );
    const campaignId = exact.length === 1
      ? smartleadPositiveInteger(exact[0].id)
      : stored?.campaignId ?? null;
    let leadId: number | null = null;
    if (campaignId && campaigns.ok && exact.length <= 1) {
      const lead = await findExactLead({
        config,
        campaignId,
        toEmail: operation.message.toEmail,
        operationKey: args.operationKey,
      });
      leadId = lead.state === "found" ? lead.leadId! : null;
    }
    if (campaignId && leadId) {
      const providerBinding = {
        ...baseBinding,
        campaignId,
        webhookId: stored?.webhookId,
      };
      const encryptedCampaignBinding =
        encryptSmartleadProviderBinding(config, providerBinding);
      const encryptedLeadBinding = encryptSmartleadProviderBinding(config, {
        ...providerBinding,
        leadId,
      });
      const receipt: { recorded: boolean } = await ctx.runMutation(
        internal.outreach.recordSmartleadReconciliationInternal,
        {
          ...args,
          found: true,
          encryptedCampaignBinding,
          encryptedLeadBinding,
          providerLeadBindingHash: createHash("sha256")
            .update(`${SMARTLEAD_ADAPTER_VERSION}:${campaignId}:${leadId}`)
            .digest("hex"),
          providerCampaignBindingHash:
            smartleadCampaignBindingHash(campaignId),
          providerRecipientHash: createHash("sha256")
            .update(operation.message.toEmail.trim().toLowerCase())
            .digest("hex"),
        },
      );
      return { reconciled: receipt.recorded };
    }
    const receipt: { recorded: boolean; terminal?: boolean } =
      await ctx.runMutation(
        internal.outreach.recordSmartleadReconciliationInternal,
        { ...args, found: false },
      );
    return { reconciled: false, terminal: receipt.terminal };
  },
});

/** Seed only secret-configured addresses controlled by Pentra. This lane is
 * intentionally separate from opportunity drafts and customer send counts. */
export const runControlledCanaries = internalAction({
  args: { resourceId: v.id("managed_outreach_mailbox_resources") },
  handler: async (ctx, { resourceId }): Promise<unknown> => {
    const config = smartleadNodeConfig();
    if (!config) {
      return ctx.runMutation(
        internal.outreach.recordSmartleadCanaryCoordinatorBlockerInternal,
        { resourceId, reason: "runtime_unavailable" },
      );
    }
    const targets = CONTROLLED_CANARY_KINDS.map((kind) => ({
      kind,
      email: smartleadCanaryTarget(kind),
    }));
    if (targets.some((target) => !target.email)) {
      return ctx.runMutation(
        internal.outreach.recordSmartleadCanaryCoordinatorBlockerInternal,
        { resourceId, reason: "canary_targets_unavailable" },
      );
    }
    try {
      return await ctx.runMutation(
        internal.outreach.ensureSmartleadControlledCanariesInternal,
        {
          resourceId,
          targets: targets.map((target) => ({
            kind: target.kind,
            targetHash: sha256(target.email!),
          })),
        },
      );
    } catch {
      return ctx.runMutation(
        internal.outreach.recordSmartleadCanaryCoordinatorBlockerInternal,
        { resourceId, reason: "resource_not_ready" },
      );
    }
  },
});

export const runControlledCanary = internalAction({
  args: { operationId: v.id("smartlead_canary_operations") },
  handler: async (ctx, { operationId }): Promise<{ queued: boolean; reason?: string }> => {
    const claim = await ctx.runMutation(
      internal.outreach.claimSmartleadControlledCanaryInternal,
      { operationId },
    );
    if (!claim) return { queued: false, reason: "not_claimable" };
    const fail = async (reason: string) => {
      await ctx.runMutation(
        internal.outreach.failSmartleadControlledCanaryInternal,
        { operationId, leaseToken: claim.operation.leaseToken, reason },
      );
      return { queued: false as const, reason };
    };
    const config = smartleadNodeConfig();
    const target = smartleadCanaryTarget(claim.operation.kind);
    if (!config || !target || sha256(target) !== claim.operation.targetHash) {
      return fail("runtime_or_target_unavailable");
    }
    const base = decryptSmartleadProviderBinding(
      config,
      claim.resource.encryptedProviderBinding,
    );
    if (!base) return fail("resource_binding_invalid");

    const expectedName = canaryCampaignName(
      claim.operation.kind,
      claim.operation.operationKey,
    );
    const campaigns = await smartleadCoreRequest({
      config,
      path: `/api/v1/campaigns/?client_id=${base.clientId}`,
    });
    if (!campaigns.ok) return fail("canary_campaign_reconciliation_failed");
    const exactCampaigns = campaignRows(campaigns.json).filter((row) =>
      String(row.name ?? "") === expectedName &&
      smartleadPositiveInteger(row.client_id) === base.clientId
    );
    if (exactCampaigns.length > 1) return fail("canary_campaign_identity_conflict");
    const stored = decryptSmartleadProviderBinding(
      config,
      claim.operation.encryptedProviderBinding,
    );
    let campaignId = exactCampaigns.length === 1
      ? smartleadPositiveInteger(exactCampaigns[0].id)
      : stored?.campaignId ?? null;
    if (!campaignId) {
      if (claim.operation.campaignRequestedAt) {
        return fail("canary_campaign_ack_ambiguous");
      }
      const boundary = await ctx.runMutation(
        internal.outreach.recordSmartleadControlledCanaryProgressInternal,
        {
          operationId,
          leaseToken: claim.operation.leaseToken,
          phase: "campaign",
        },
      );
      if (!boundary.recorded) return { queued: false, reason: "fence_changed" };
      const created = await smartleadCoreRequest({
        config,
        path: "/api/v1/campaigns/create",
        method: "POST",
        body: { name: expectedName, client_id: base.clientId },
      });
      campaignId = created.ok
        ? smartleadPositiveInteger(dataObject(created.json)?.id)
        : null;
      if (!campaignId) return fail("canary_campaign_ack_ambiguous");
    }

    const webhookName = `Pentra canary ${claim.operation.operationKey.slice(0, 20)}`;
    const webhooks = await smartleadCoreRequest({
      config,
      path: `/api/v1/campaigns/${campaignId}/webhooks`,
    });
    if (!webhooks.ok) return fail("canary_webhook_reconciliation_failed");
    const matchingWebhooks = smartleadRecords(webhooks.json).filter((row) =>
      String(row.name ?? "") === webhookName &&
      String(row.webhook_url ?? "") === config.webhookUrl);
    if (matchingWebhooks.length === 1 && !exactWebhookConfiguration(
      matchingWebhooks[0], webhookName, config.webhookUrl,
    )) return fail("canary_webhook_configuration_conflict");
    const exactWebhooks = matchingWebhooks.filter((row) =>
      exactWebhookConfiguration(row, webhookName, config.webhookUrl));
    if (exactWebhooks.length > 1) return fail("canary_webhook_identity_conflict");
    let webhookId = exactWebhooks.length === 1
      ? smartleadPositiveInteger(exactWebhooks[0].id)
      : stored?.webhookId ?? null;
    if (!webhookId) {
      if (claim.operation.webhookRequestedAt) {
        return fail("canary_webhook_ack_ambiguous");
      }
      const boundary = await ctx.runMutation(
        internal.outreach.recordSmartleadControlledCanaryProgressInternal,
        {
          operationId,
          leaseToken: claim.operation.leaseToken,
          phase: "webhook",
        },
      );
      if (!boundary.recorded) return { queued: false, reason: "fence_changed" };
      const created = await smartleadCoreRequest({
        config,
        path: "/api/v1/webhook/create",
        method: "POST",
        body: {
          name: webhookName,
          webhook_url: config.webhookUrl,
          association_type: "campaign",
          email_campaign_id: campaignId,
          event_type_map: SMARTLEAD_WEBHOOK_EVENT_TYPE_MAP,
        },
      });
      webhookId = created.ok
        ? smartleadPositiveInteger(dataObject(created.json)?.id)
        : null;
      if (!webhookId) return fail("canary_webhook_ack_ambiguous");
    }
    const campaignBinding = { ...base, campaignId, webhookId };
    const encryptedCampaignBinding =
      encryptSmartleadProviderBinding(config, campaignBinding);
    const webhookStored = await ctx.runMutation(
      internal.outreach.recordSmartleadControlledCanaryProgressInternal,
      {
        operationId,
        leaseToken: claim.operation.leaseToken,
        phase: "webhook",
        encryptedProviderBinding: encryptedCampaignBinding,
      },
    );
    if (!webhookStored.recorded) return { queued: false, reason: "fence_changed" };

    if (!claim.operation.configurationCompletedAt) {
      const boundary = await ctx.runMutation(
        internal.outreach.recordSmartleadControlledCanaryProgressInternal,
        {
          operationId,
          leaseToken: claim.operation.leaseToken,
          phase: "configuration",
          encryptedProviderBinding: encryptedCampaignBinding,
        },
      );
      if (!boundary.recorded) return { queued: false, reason: "fence_changed" };
    }
    const configuration = await ensureCampaignConfiguration({
      config,
      campaignId,
      expected: {
        name: expectedName,
        mailboxId: base.mailboxId,
        sequences: [{
          sequenceStep: 0,
          subject: `Pentra controlled ${claim.operation.kind} canary`,
          body: "This is a controlled Pentra safety canary. No customer or prospect is involved.",
          delayDays: 0,
        }],
        startHour: "00:00",
        endHour: "23:59",
      },
      allowRepair: !claim.operation.configurationCompletedAt,
    });
    if (!configuration.ready) return fail(
      configuration.ambiguous
        ? configuration.reason
        : `terminal_${configuration.reason}`,
    );
    if (!claim.operation.configurationCompletedAt) {
      const completed = await ctx.runMutation(
        internal.outreach.recordSmartleadControlledCanaryProgressInternal,
        {
          operationId,
          leaseToken: claim.operation.leaseToken,
          phase: "configuration",
          encryptedProviderBinding: encryptedCampaignBinding,
          completed: true,
        },
      );
      if (!completed.recorded) return { queued: false, reason: "fence_changed" };
    }

    const existingLead = await findExactLead({
      config,
      campaignId,
      toEmail: target,
      operationKey: claim.operation.operationKey,
    });
    if (["conflict", "unavailable"].includes(existingLead.state)) {
      return fail("canary_lead_reconciliation_failed");
    }
    let leadId = existingLead.leadId ?? null;
    if (!leadId) {
      if (claim.operation.leadRequestedAt) return fail("canary_lead_ack_ambiguous");
      const boundary = await ctx.runMutation(
        internal.outreach.recordSmartleadControlledCanaryProgressInternal,
        {
          operationId,
          leaseToken: claim.operation.leaseToken,
          phase: "lead",
        },
      );
      if (!boundary.recorded) return { queued: false, reason: "fence_changed" };
      const added = await smartleadCoreRequest({
        config,
        path: `/api/v1/campaigns/${campaignId}/leads`,
        method: "POST",
        body: {
          lead_list: [{
            email: target,
            company_name: "Pentra controlled canary",
            custom_fields: {
              pentra_operation_key: claim.operation.operationKey,
              pentra_subject_0: `Pentra controlled ${claim.operation.kind} canary`,
              pentra_body_0: "This is a controlled Pentra safety canary. No customer or prospect is involved.",
            },
          }],
          settings: {
            ignore_global_block_list: false,
            ignore_unsubscribe_list: false,
            ignore_duplicate_leads_in_other_campaign: false,
            ignore_community_bounce_list: false,
            return_lead_ids: true,
          },
        },
      });
      const data = dataObject(added.json);
      const leadIds = Array.isArray(data?.lead_ids) ? data!.lead_ids as unknown[] : [];
      leadId = added.ok && leadIds.length === 1
        ? smartleadPositiveInteger(leadIds[0])
        : null;
      if (!leadId) {
        const reconciled = await findExactLead({
          config,
          campaignId,
          toEmail: target,
          operationKey: claim.operation.operationKey,
        });
        leadId = reconciled.state === "found" ? reconciled.leadId! : null;
      }
      if (!leadId) return fail("canary_lead_ack_ambiguous");
    }
    const campaign = await smartleadCoreRequest({
      config,
      path: `/api/v1/campaigns/${campaignId}`,
    });
    if (String(dataObject(campaign.json)?.status ?? "") !== "ACTIVE") {
      const activated = await smartleadCoreRequest({
        config,
        path: `/api/v1/campaigns/${campaignId}/status`,
        method: "POST",
        body: { status: "START" },
      });
      if (!activated.ok) return fail("canary_activation_unverified");
    }
    const encryptedProviderBinding = encryptSmartleadProviderBinding(config, {
      ...campaignBinding,
      leadId,
    });
    const recorded = await ctx.runMutation(
      internal.outreach.recordSmartleadControlledCanaryQueuedInternal,
      {
        operationId,
        leaseToken: claim.operation.leaseToken,
        encryptedProviderBinding,
        campaignBindingHash: smartleadCampaignBindingHash(campaignId),
        recipientHash: sha256(target),
      },
    );
    return recorded.recorded
      ? { queued: true as const }
      : { queued: false as const, reason: "canary_queue_receipt_unstored" };
  },
});

export const pauseControlledCanary = internalAction({
  args: { operationId: v.id("smartlead_canary_operations") },
  handler: async (ctx, { operationId }): Promise<{ paused: boolean }> => {
    const config = smartleadNodeConfig();
    const operation = await ctx.runQuery(
      internal.outreach.getSmartleadControlledCanaryPauseOperationInternal,
      { operationId },
    );
    if (!operation) return { paused: false as const };
    if (!config) {
      await ctx.runMutation(
        internal.outreach.recordSmartleadControlledCanaryPauseFailureInternal,
        { operationId, reason: "runtime_unavailable" },
      );
      return { paused: false as const };
    }
    const binding = decryptSmartleadProviderBinding(
      config,
      operation.encryptedProviderBinding,
    );
    if (!binding?.campaignId || !binding.leadId) {
      await ctx.runMutation(
        internal.outreach.recordSmartleadControlledCanaryPauseFailureInternal,
        { operationId, reason: "binding_invalid" },
      );
      return { paused: false as const };
    }
    const response = await smartleadCoreRequest({
      config,
      path: `/api/v1/campaigns/${binding.campaignId}/leads/${binding.leadId}/pause`,
      method: "POST",
    });
    if (!response.ok) {
      await ctx.runMutation(
        internal.outreach.recordSmartleadControlledCanaryPauseFailureInternal,
        { operationId, reason: "pause_unverified" },
      );
      return { paused: false as const };
    }
    const receipt: { recorded: boolean } = await ctx.runMutation(
      internal.outreach.recordSmartleadControlledCanaryPauseReceiptInternal,
      {
        operationId,
        providerResponseHash: sha256(JSON.stringify(response.json)),
      },
    );
    return { paused: receipt.recorded };
  },
});
