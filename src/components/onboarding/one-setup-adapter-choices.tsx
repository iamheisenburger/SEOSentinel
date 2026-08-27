"use client";

export type PublisherKind = "github" | "wordpress" | "webhook";
export type OutreachTransport = "smartlead_managed" | "gmail_oauth" | "smtp";

const FULL_MANAGED_BETA_ENABLED =
  process.env.NEXT_PUBLIC_PENTRA_FULL_MANAGED_BETA === "true";

const PUBLISHERS = [
  ["github", "GitHub", "Commit verified content to your repository", false],
  ["wordpress", "WordPress", "Beta — not included in bootstrap v1 GA", true],
  ["webhook", "Signed webhook", "Beta — not included in bootstrap v1 GA", true],
] as const;

const SENDERS = [
  ["smtp", "SMTP + IMAP", "Default: encrypted customer-managed mailbox; approval only", false],
  ["gmail_oauth", "Gmail OAuth", "Optional customer-managed send permission", false],
  ["smartlead_managed", "Managed sender", "Beta — not included in bootstrap v1 GA", true],
] as const;

function ChoiceGroup<T extends string>({
  label,
  choices,
  value,
  onChange,
}: {
  label: string;
  choices: readonly (readonly [T, string, string, boolean])[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="mt-5">
      <label className="mb-2 block text-[11px] font-medium text-[#8B8FA3]">
        {label}
      </label>
      <div className="grid gap-2 sm:grid-cols-3">
        {choices.map(([choice, title, detail, beta]) => {
          const disabled = beta && !FULL_MANAGED_BETA_ENABLED;
          return (
          <button
            key={choice}
            type="button"
            onClick={() => onChange(choice)}
            disabled={disabled}
            aria-pressed={value === choice}
            className={`rounded-lg border px-3 py-3 text-left transition ${
              value === choice
                ? "border-[#0EA5E9]/40 bg-[#0EA5E9]/[0.07]"
                : disabled
                  ? "cursor-not-allowed border-white/[0.04] bg-white/[0.01] opacity-50"
                  : "border-white/[0.06] bg-white/[0.02] hover:border-white/[0.12]"
            }`}
          >
            <span className="block text-[11px] font-medium text-[#EDEEF1]">
              {title}{disabled ? " · coming later" : ""}
            </span>
            <span className="mt-1 block text-[9px] leading-relaxed text-[#565A6E]">{detail}</span>
          </button>
          );
        })}
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
        Bootstrap v1 supports GitHub plus customer-managed SMTP/IMAP in
        mandatory approval mode. Beta adapters cannot be selected or advertised as GA.
      </p>
    </>
  );
}
