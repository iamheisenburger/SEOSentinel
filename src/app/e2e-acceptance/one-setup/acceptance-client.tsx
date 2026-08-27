"use client";

import { useState } from "react";

import {
  OneSetupAdapterChoices,
  type OutreachTransport,
  type PublisherKind,
} from "@/components/onboarding/one-setup-adapter-choices";

export function OneSetupAcceptanceClient() {
  const [publisherKind, setPublisherKind] = useState<PublisherKind>("github");
  const [outreachTransport, setOutreachTransport] =
    useState<OutreachTransport>("smtp");
  return (
    <main className="mx-auto min-h-screen max-w-2xl bg-[#08090E] px-5 py-10 text-[#EDEEF1]">
      <h1 className="text-xl font-semibold">Set up Pentra once</h1>
      <OneSetupAdapterChoices
        publisherKind={publisherKind}
        outreachTransport={outreachTransport}
        onPublisherChange={setPublisherKind}
        onOutreachTransportChange={setOutreachTransport}
      />
      <button
        type="button"
        disabled
        className="mt-6 w-full rounded-lg bg-[#0EA5E9] px-4 py-3 disabled:opacity-40"
      >
        Start one setup
      </button>
    </main>
  );
}
