import assert from "node:assert/strict";
import test from "node:test";

import {
  oneSetupFormBlockers,
  postalAddressError,
  type OneSetupFormReadinessInput,
} from "../src/lib/one-setup-form.ts";

const readyInput: OneSetupFormReadinessInput = {
  capacityReady: true,
  domain: "example.com",
  businessName: "Example",
  businessSummary: "Software that helps teams finish important work.",
  targetCountry: "Germany",
  targetAudience: "Small business owners",
  productUsage: "Customers automate repetitive work.",
  cadence: 12,
  fullAutopilot: true,
  autopublishConsentAccepted: true,
  senderName: "Example",
  postalAddress: "Example Street 6, 50170 Example, Germany",
  confirmsSenderIdentityAndAddress: true,
  authorizesDeliveryEventCanary: true,
  confirmsSeparateAutomaticSendingConsent: true,
  managedOutreach: false,
  managedSenderDomain: "",
  confirmsDedicatedManagedSenderIdentity: false,
};

test("a country alone is not accepted as an outreach postal address", () => {
  assert.match(postalAddressError("Germany") ?? "", /full street or PO Box/);
  assert.equal(
    postalAddressError("Example Street 6, 50170 Example, Germany"),
    undefined,
  );
  assert.match(
    postalAddressError("pentra@example.com") ?? "",
    /not an email address/,
  );
});

test("the setup form reports every blocker instead of silently disabling", () => {
  const blockers = oneSetupFormBlockers({
    ...readyInput,
    businessSummary: "Too short",
    postalAddress: "Germany",
    autopublishConsentAccepted: false,
  });
  assert.deepEqual(
    blockers.map((blocker) => blocker.key),
    ["business_summary", "autopublish_consent", "postal_address"],
  );
});

test("a valid target cadence may exceed the remaining monthly allowance", () => {
  assert.deepEqual(oneSetupFormBlockers(readyInput), []);
  assert.equal(
    oneSetupFormBlockers({ ...readyInput, cadence: 22 }).some(
      (blocker) => blocker.key === "cadence",
    ),
    true,
  );
});
