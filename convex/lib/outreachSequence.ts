import { outreachMessageOwnerMatches } from "./outreachAutonomy.ts";
import { outreachOrganisationDomain } from "./outreachContacts.ts";
import { MAX_SEQUENCE_STEP, nextFollowUpAt } from "./outreachPacing.ts";

type SequenceMessageProof = {
  _id: string;
  siteId: string;
  ownerAccountKey?: string;
  ownerLineageUnresolvedAt?: number;
  inboxId?: string;
  opportunityId: string;
  toEmail: string;
  toDomain: string;
  threadKey: string;
  sequenceStep: number;
  status: string;
  scheduledAt?: number;
  sentAt?: number;
  providerThreadId?: string;
  inboundRelayOutboundMessageIdHash?: string;
  parentMessageId?: string;
  deliveryExpectedThreadId?: string;
  inReplyToRfcMessageIdHash?: string;
};

export type FollowUpPredecessorDecision =
  | { allowed: true; providerThreadId: string }
  | {
      allowed: false;
      reason: "thread_stopped" | "predecessor_mismatch";
    };

/** Pure due-time proof for one queued follow-up. It deliberately accepts only
 * a direct, provider-verified `sent` predecessor; a manually reviewed or
 * ambiguous send cannot continue an autonomous sequence. */
export function followUpPredecessorDecision(args: {
  message: SequenceMessageProof;
  predecessor: SequenceMessageProof | null | undefined;
  ownerAccountKey: string;
  threadStopped: boolean;
}): FollowUpPredecessorDecision {
  if (args.threadStopped) return { allowed: false, reason: "thread_stopped" };
  const { message, predecessor, ownerAccountKey } = args;
  const expectedDue = predecessor?.sentAt
    ? nextFollowUpAt({
        sequenceStep: predecessor.sequenceStep,
        lastSentAt: predecessor.sentAt,
      })
    : null;
  const providerThreadId = message.deliveryExpectedThreadId;
  if (
    !predecessor ||
    !Number.isSafeInteger(message.sequenceStep) ||
    message.sequenceStep < 1 ||
    message.sequenceStep > MAX_SEQUENCE_STEP ||
    message.parentMessageId !== predecessor._id ||
    !outreachMessageOwnerMatches(message, ownerAccountKey) ||
    !outreachMessageOwnerMatches(predecessor, ownerAccountKey) ||
    predecessor.siteId !== message.siteId ||
    predecessor.opportunityId !== message.opportunityId ||
    predecessor.threadKey !== message.threadKey ||
    predecessor.sequenceStep !== message.sequenceStep - 1 ||
    predecessor.status !== "sent" ||
    !predecessor.sentAt ||
    predecessor.inboxId !== message.inboxId ||
    predecessor.toEmail !== message.toEmail ||
    outreachOrganisationDomain(predecessor.toDomain) !==
      outreachOrganisationDomain(message.toDomain) ||
    !providerThreadId ||
    providerThreadId !== predecessor.providerThreadId ||
    !/^[a-zA-Z0-9_-]{1,200}$/.test(providerThreadId) ||
    !message.inReplyToRfcMessageIdHash ||
    !/^[a-f0-9]{64}$/.test(message.inReplyToRfcMessageIdHash) ||
    !predecessor.inboundRelayOutboundMessageIdHash ||
    message.inReplyToRfcMessageIdHash !==
      predecessor.inboundRelayOutboundMessageIdHash ||
    expectedDue === null ||
    message.scheduledAt !== expectedDue
  ) {
    return { allowed: false, reason: "predecessor_mismatch" };
  }
  return { allowed: true, providerThreadId };
}
