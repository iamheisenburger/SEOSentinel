# Pentra conditional WordPress publisher

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
