# Pentra conditional WordPress publisher

## Install on your website

1. [Download the plugin ZIP](https://pentra.dev/pentra-wordpress-plugin.zip).
2. In your WordPress admin, open **Plugins → Add New Plugin → Upload Plugin**, upload the ZIP, install and activate it.
3. In **Users → Profile → Application Passwords**, create an application password for the existing user who may edit and publish your chosen content. Do not use your main login password or grant extra administrator access to the publisher.
4. In Pentra's website publishing settings, choose WordPress, enter the exact HTTPS website URL, username and application password, then save. Pentra verifies both the connection and the conditional connector before allowing growth-first delivery.
5. Review the saved business, schedule and publication consent. Existing pages remain uneditable until separately selected; unsupported layouts stay excluded. Test your theme/plugin compatibility before relying on unattended delivery.

Installation requires your site's normal plugin-install permission. Publishing
after installation requires only the documented content capabilities below.

Version1.1.0 is required for unattended lost-response recovery. Replace the
existing connector file using the same authorized installation workflow before
enabling the updated publisher. Existing receipt/permission tables are reused;
no data reset or new authentication credential is needed. Older installations
fail closed with an update requirement, never silently retry an uncertain write.

Install only `pentra-conditional-publisher.php` in a same-named plugin directory
and activate it on the explicitly authorized WordPress destination. Use core
WordPress application-password authentication over HTTPS. The authenticated
user must be able to edit and publish the exact post/page. No administrator role
or new authentication mechanism is introduced by this connector.

The connector rejects unsupported layouts, custom blocks, shortcodes, protected
commerce/legal content, passwords, non-public content and non-transactional
storage. Selection binds an exact source revision and revocable permission to
the current connection. Writes use one database transaction for the post row,
permission and idempotency receipt. MySQL uses InnoDB and row locks; the local
SQLite fixture uses the official modern WordPress driver with BEGIN IMMEDIATE.
An ordinary core edit racing the connector cannot be silently overwritten.
Rollback requires the retained receipt and refuses later customer changes.

Supported updates are exact append, bounded single-span replacement, and
conditional rollback. Replacements must describe the exact old/new span and
the resulting full source; unrelated-byte changes are rejected. When an owner
correction omits metadata, the connector retains the previous metadata exactly,
including absence. Pentra's reviewed discretionary changes supply explicit
metadata. A PHP API acknowledgement never substitutes for rendered verification.

`GET /wp-json/pentra/v1/receipt` reads one exact existing receipt. It requires
core authentication plus the original site/binding, request key, SHA-256 hash of
the exact serialized write body, and target ID or creation type/slug. Missing,
foreign-owner and conflicting receipts share an unavailable response. The read
checks current content capabilities, the original permission (which may be
revoked but not replaced), source revision, metadata and target. It never writes
content, changes permissions, or treats absence as permission to try again.
Responses are private/no-store and omit the previous source snapshot; reads are
bounded. Historical delivery evidence includes whether the permission is still
active and must never renew a revoked editing grant.

Both creation and selected-page improvement can reconcile a lost response using
this GET, then verify the retained rendered artifact through the existing work
record. A customer edit before lookup rejects the receipt; an edit after lookup
still fails the subsequent live verification. Missing/conflicting proof stays
unresolved. The connector's `writtenAt` records its original external transaction
time; Pentra's receipt `receivedAt` records when it observed the receipt, including
late recovery. Recovery is not a new publication. Fixed missed deadlines, costs
and prior attempts remain; only verified delivery permits normal fresh refill.

Transactions cover core DB state, not arbitrary side effects performed by other
installed plugins. Third-party publishing hooks, caches, custom themes and SEO
plugins require destination-specific compatibility verification. Successful API
delivery is not acceptance: Pentra separately checks the actual rendered URL,
canonical, title, metadata and full reviewed prose. Failed verification remains
an unresolved job and does not advance its delivery deadline.

## Reproducible free local integration

On macOS arm64, run `npm run test:wordpress`. First setup downloads checksum-pinned
FrankenPHP1.12.7 (PHP8.5.10), WordPress7.1 and SQLite Database Integration3.0.2 from
their official distributions. Runtime, DB and server state stay in the ignored
`.wordpress-fixture` directory. It retains the DB and creates only synthetic
local accounts, application passwords and posts. No provider or production
Convex calls are permitted by the connected fixture's injected transport.

The test server binds only 127.0.0.1:18927. The synthetic virtual-host header is
implemented **only in test config**, never in this installable connector. Do not
copy the test configuration to a public server. To keep the server open, run
`node scripts/wordpress-fixture.mjs`; to check/install files without starting it,
pass `--setup-only`. Stop any existing fixture listener before the npm test.

Run `npm run test:wordpress:mysql` for real MySQL8.4.11/InnoDB. The bootstrap
downloads the pinned official macOS ARM64 tarball and runs its own isolated
server on127.0.0.1:18928, without a global installation or service changes.
Its synthetic database and a separate WordPress tree stay in `.wordpress-fixture`;
the SQLite database is not replaced. Both servers stop when the test completes.
Existing databases are retained; no production credentials are read.

Both database gates exercise actual core-editor transactions, conditional
creates/updates, retry/lost responses, revocation, rollback, targeted edits and
connected jobs. MySQL additionally switches only the isolated receipt table to
MyISAM and verifies rejection, then restores InnoDB. Its ordinary-editor race
uses an actual post-row `FOR UPDATE` lock, not SQLite's database-wide lock.
The connected suite covers automatic managed-page enrollment, two measured
improvements of a long page, fresh refill, factual correction and a demonstrated
broken internal link. Models, measurements, deadlines and tenant data remain
synthetic; this is not production Pentra/LeadPilot evidence. Destination-specific
theme/plugin compatibility is still a deployment gate.

Primary documentation: [custom REST endpoint permissions](https://developer.wordpress.org/rest-api/extending-the-rest-api/adding-custom-endpoints/),
[WordPress authentication](https://developer.wordpress.org/rest-api/using-the-rest-api/authentication/),
[official SQLite integration](https://wordpress.org/plugins/sqlite-database-integration/),
[MySQL isolated data-directory initialization](https://dev.mysql.com/doc/refman/8.4/en/data-directory-initialization.html).
