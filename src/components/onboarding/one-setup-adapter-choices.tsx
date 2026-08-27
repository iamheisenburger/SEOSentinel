"use client";

export type PublisherKind = "github" | "wordpress" | "webhook";
export type OutreachTransport = "smartlead_managed" | "gmail_oauth" | "smtp";

const PUBLISHERS = [
  ["github", "GitHub", "Commit verified content to your repository"],
  ["wordpress", "WordPress", "Publish through a WordPress application password"],
  ["webhook", "Signed webhook", "Deliver to your CMS through an HMAC-signed endpoint"],
] as const;

const SENDERS = [
  ["smartlead_managed", "Managed sender", "Isolated secondary domain and mailbox; warm-up required"],
  ["gmail_oauth", "Gmail", "Customer-managed Gmail send permission"],
  ["smtp", "SMTP", "Customer-managed TLS mailbox credentials"],
] as const;

function ChoiceGroup<T extends string>({
  label,
  choices,
  value,
  onChange,
}: {
  label: string;
  choices: readonly (readonly [T, string, string])[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="mt-5">
      <label className="mb-2 block text-[11px] font-medium text-[#8B8FA3]">
        {label}
      </label>
      <div className="grid gap-2 sm:grid-cols-3">
        {choices.map(([choice, title, detail]) => (
          <button
            key={choice}
            type="button"
            onClick={() => onChange(choice)}
            aria-pressed={value === choice}
            className={`rounded-lg border px-3 py-3 text-left transition ${
              value === choice
                ? "border-[#0EA5E9]/40 bg-[#0EA5E9]/[0.07]"
                : "border-white/[0.06] bg-white/[0.02] hover:border-white/[0.12]"
            }`}
          >
            <span className="block text-[11px] font-medium text-[#EDEEF1]">{title}</span>
            <span className="mt-1 block text-[9px] leading-relaxed text-[#565A6E]">{detail}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export function OneSetupAdapterChoices({
  publisherKind,
  outreachTransport,
  onPublisherChange,
  onOutreachTransportChange,
}: {
  publisherKind: PublisherKind;
  outreachTransport: OutreachTransport;
  onPublisherChange: (value: PublisherKind) => void;
  onOutreachTransportChange: (value: OutreachTransport) => void;
}) {
  return (
    <>
      <ChoiceGroup
        label="Publishing destination"
        choices={PUBLISHERS}
        value={publisherKind}
        onChange={onPublisherChange}
      />
      <ChoiceGroup
        label="Authority sender"
        choices={SENDERS}
        value={outreachTransport}
        onChange={onOutreachTransportChange}
      />
      <p className="mt-2 text-[9px] leading-relaxed text-[#565A6E]">
        Managed sending stays in waiting-provider or warming until domain authentication,
        provider access, warm-up, and all safety canaries have verified.
      </p>
    </>
  );
}
