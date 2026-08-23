import assert from "node:assert/strict";
import test from "node:test";

import {
  contactDiscoveryUrls,
  extractContactCandidates,
  isContactableAddress,
  isSameOrganisation,
  isSameOrganisationHost,
  selectBestContact,
} from "../convex/lib/outreachContacts.ts";

test("machine and legal addresses are never contactable", () => {
  for (const email of [
    "noreply@example-blog.com",
    "abuse@example-blog.com",
    "legal@example-blog.com",
    "dmca@example-blog.com",
    "careers@example-blog.com",
  ]) {
    assert.equal(isContactableAddress(email), false, email);
  }
  assert.equal(isContactableAddress("editor@example-blog.com"), true);
});

test("asset filenames and tracking addresses are not treated as emails", () => {
  assert.equal(isContactableAddress("sprite@2x.png"), false);
  assert.equal(isContactableAddress("a1b2c3d4e5f6a7b8@example-blog.com"), false);
  assert.equal(isContactableAddress("someone@sentry.wixpress.com"), false);
});

test("only addresses belonging to the target organisation qualify", () => {
  assert.equal(isSameOrganisation("editor@example-blog.com", "example-blog.com"), true);
  assert.equal(isSameOrganisation("editor@mail.example-blog.com", "example-blog.com"), true);
  assert.equal(isSameOrganisation("editor@example-blog.com", "www.example-blog.com"), true);
  assert.equal(isSameOrganisation("advertiser@othercompany.com", "example-blog.com"), false);
  assert.equal(isSameOrganisationHost("www.example-blog.com", "example-blog.com"), true);
  assert.equal(isSameOrganisationHost("blog.example-blog.com", "example-blog.com"), true);
  assert.equal(
    isSameOrganisationHost("attacker.co.uk", "example.co.uk"),
    false,
    "sharing a public suffix is not an organisation relationship",
  );
});

test("extraction keeps the site's own editor and drops third parties", () => {
  const html = `
    <a href="mailto:editor@example-blog.com">Email the editor</a>
    <p>Ad sales handled by partners@adnetwork.io</p>
    <p>General enquiries: hello@example-blog.com</p>
    <img src="logo@2x.png">
    <script>Sentry.init({dsn:"https://abc@sentry.io/1"})</script>
  `;
  const candidates = extractContactCandidates({ html, siteDomain: "example-blog.com" });
  const emails = candidates.map((c) => c.email);
  assert.deepEqual(emails.sort(), ["editor@example-blog.com", "hello@example-blog.com"]);

  // The editorial desk outranks the generic mailbox.
  const best = selectBestContact(candidates);
  assert.equal(best?.email, "editor@example-blog.com");
  assert.equal(best?.role, "editorial");
  assert.equal(best?.discoveryMethod, "mailto");
});

test("a page with no published address yields no contact", () => {
  const candidates = extractContactCandidates({
    html: "<p>Use the contact form below.</p>",
    siteDomain: "example-blog.com",
  });
  assert.deepEqual(candidates, []);
  assert.equal(selectBestContact(candidates), null);
});

test("discovery starts at the page carrying the opportunity", () => {
  const urls = contactDiscoveryUrls({
    sourceUrl: "https://example-blog.com/posts/cro-guide",
    siteDomain: "example-blog.com",
  });
  assert.equal(urls[0], "https://example-blog.com/posts/cro-guide");
  assert.ok(urls.includes("https://example-blog.com/contact"));
  assert.ok(urls.length <= 4);
  assert.ok(urls.every((u) => u.startsWith("https://")));
});
