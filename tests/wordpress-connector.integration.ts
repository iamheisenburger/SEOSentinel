import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { setup, pumpUntil, selectGrowth, slcBusinesses, managedMeasuredFollowups, exerciseImmediateFactCorrection, incorrectBusinessParagraph, correctionSurvivor, exerciseBrokenLinkCorrection, brokenLinkParagraph, createEmptyContentSite, exerciseReadyPause, exerciseSetupReconfirmation, exerciseReceiptSetup, exerciseUncertainSetup, exerciseRollbackReceipt, exerciseRollbackUnknown } from './core-pipeline-integration.test.ts';
import { START } from './helpers/core-pipeline-fixture.ts';
import { correctionVisibleText } from '../convex/lib/publishedCorrection.ts';
import { renderSafePublicationHtml } from '../convex/lib/safeMarkdownHtml.ts';

const runtime = process.env.PENTRA_FIXTURE_PHP ?? '.wordpress-fixture/frankenphp';
const root = 'http://127.0.0.1:18927';
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const key = () => hash(randomUUID());
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
function command(input: Json): Json {
  const p = spawnSync(runtime, ['php-cli', 'tests/fixtures/wordpress-command.php'], { input: JSON.stringify(input), encoding: 'utf8', timeout: 30000 });
  assert.equal(p.status, 0, p.stderr + p.stdout.slice(0, 1000));
  return JSON.parse(p.stdout);
}

test('real WordPress SLC30 changed setup and old delivery reconciliation reach new publication and fresh refill', async t => {
  for (const scenario of ['empty', 'ready', 'rotated_credentials', 'creation_receipt', 'revoked_selected_receipt', 'unknown_delivery']) await t.test(scenario, async () => {
    const local = command({ operation: 'setup' });
    const [username, password] = Buffer.from(local.auth, 'base64').toString().split(':');
    const suffix = randomUUID().slice(0, 8), domain = `reconfirm-${suffix}.example`;
    let outage = false, dropped = false;
    const f = setup({ growthFirst: true, businesses: [{ ...slcBusinesses[0], domain }], wordpress: { username, password,
      transport: async (url, init) => {
        assert.equal(url.hostname, domain);
        if (outage && url.pathname.startsWith('/wp-json/')) return new Response('{"code":"synthetic_receipt_read_outage"}', { status: 503 });
        const response = await fetch(root + url.pathname + url.search, { ...init, headers: { ...Object.fromEntries(new Headers(init.headers).entries()), 'X-Pentra-Fixture-Host': domain }, redirect: 'manual' });
        if (scenario === 'unknown_delivery' && !dropped && response.ok && url.pathname.endsWith('/pentra/v1/write') && JSON.parse(String(init.body)).operation === 'create') {
          outage = true; dropped = true;
          return new Response('{"code":"synthetic_acknowledgement_lost"}', { status: 503 });
        }
        return response;
      } } });
    const site = f.sites[0]; await f.invoke('publisher:verifyPublicationDestinationInternal', { siteId: site.id });
    const rotate = async () => {
      // Rotate only this local fixture's generated application password.
      const next = command({ operation: 'setup' });
      const [wpUsername, wpAppPassword] = Buffer.from(next.auth, 'base64').toString().split(':');
      await f.invoke('sites:upsert', { id: site.id, domain, wpUsername, wpAppPassword });
      await f.invoke('publisher:verifyPublicationDestination', { siteId: site.id });
    };
    if (scenario === 'unknown_delivery') await exerciseUncertainSetup(f, () => { outage = false; });
    else if (scenario.endsWith('receipt')) {
      let pageId: string | undefined;
      if (scenario === 'revoked_selected_receipt') {
        const p = command({ operation: 'create', slug: `selected-${suffix}`, title: slcBusinesses[0].keywords[0],
          content: '<p>Preserve the confirmed customer facts and original explanation. Ask an authorized reviewer to clarify uncertainties before making a decision.</p>' });
        f.setIdentity(`synthetic-owner-${domain}`);
        const preview = await f.invoke('actions/selectedPages:preview', { siteId: site.id, wordpressId: p.id });
        pageId = await f.invoke('actions/selectedPages:select', { siteId: site.id, wordpressId: p.id, revision: preview.revision, reviewToken: preview.reviewToken, confirm: true });
        f.get(site.id)!.gscDateEpochs = [{ date: '2026-09-10', syncEpoch: 'reconfirmation-selected' }];
        f.add('search_performance', { siteId: site.id, date: '2026-09-10', syncEpoch: 'reconfirmation-selected', page: preview.url, query: slcBusinesses[0].keywords[0],
          syncVersion: 2, syncedAt: f.now(), clicks: 1, impressions: 60, ctr: 1 / 60, position: 12, createdAt: f.now() });
        f.setIdentity(null);
      }
      await exerciseReceiptSetup(f, pageId, rotate);
    } else await exerciseSetupReconfirmation(f, scenario !== 'empty', scenario === 'rotated_credentials' ? rotate : undefined);
    const delivered = f.tables.jobs.filter(j => j.contentWork?.stage === 'verified').sort((a,b) => b.contentWork.verifiedAt - a.contentWork.verifiedAt)[0].contentWork;
    t.diagnostic(JSON.stringify({ scenario, database: local.database, provider: 'synthetic', wordpressCore: 'real loopback',
      deadline: delivered.deadlineAt, publishedAt: delivered.publishedAt, verifiedAt: delivered.verifiedAt, ready: 2 }));
  });
});

test('real WordPress SLC41 service rollback preserves receipts, revoked access and customer edits after lost responses', async t => {
  for (const scenario of ['receipt', 'revoked_selected', 'lost_unchanged_requires_disposition', 'lost_edited']) await t.test(scenario, async () => {
    const local = command({ operation: 'setup' });
    const [username, password] = Buffer.from(local.auth, 'base64').toString().split(':');
    const suffix = randomUUID().slice(0, 8), domain = `rollback-${suffix}.example`;
    let outage = false, writes = 0, createdId: number | undefined;
    const f = setup({ growthFirst: true, businesses: [{ ...slcBusinesses[0], domain }], wordpress: { username, password,
      transport: async (url, init) => {
        assert.equal(url.hostname, domain);
        if (outage && url.pathname.startsWith('/wp-json/')) return new Response('{"code":"synthetic_read_outage"}', { status: 503, headers: { 'Content-Type': 'application/json' } });
        const response = await fetch(root + url.pathname + url.search, { ...init, headers: { ...Object.fromEntries(new Headers(init.headers).entries()), 'X-Pentra-Fixture-Host': domain }, redirect: 'manual' });
        if (scenario === 'lost_unchanged_requires_disposition' && writes > 0 && url.pathname.endsWith('/pentra/v1/connection') && response.ok) {
          const old = await response.json(); delete old.receiptLookup; return Response.json(old); // Retain the41 older-connector fallback test.
        }
        if (response.ok && url.pathname.endsWith('/pentra/v1/write')) {
          writes++; createdId = (await response.clone().json()).id;
          if (scenario.startsWith('lost_') && writes === 1) { outage = true; return new Response('{"code":"synthetic_lost_response"}', { status: 503, headers: { 'Content-Type': 'application/json' } }); }
        }
        return response;
      } } });
    const site = f.sites[0]; await f.invoke('publisher:verifyPublicationDestinationInternal', { siteId: site.id });
    if (scenario.startsWith('lost_')) {
      await exerciseRollbackUnknown(f, async () => {
        assert.ok(createdId);
        if (scenario === 'lost_edited') command({ operation: 'edit', id: createdId, content: '<p>Customer-owned later edit must survive the service switch.</p>' });
        outage = false;
      // This connector exposes no read-only creation-receipt lookup. The
      // existing watchdog must refuse its POST replay even if unchanged.
      // Explicit owner disposition closes ambiguity, never claims delivery.
      }, true);
      if (scenario === 'lost_edited') {
        const current = await fetch(`${root}/wp-json/wp/v2/posts/${createdId}`, { headers: { Authorization: `Basic ${local.auth}` } });
        assert.match((await current.json()).content.rendered, /Customer-owned later edit must survive/);
      }
    } else {
      let pageId: string | undefined;
      if (scenario === 'revoked_selected') {
        const p = command({ operation: 'create', slug: `rollback-selected-${suffix}`, title: slcBusinesses[0].keywords[0], content: '<p>Preserve the confirmed customer facts and original explanation. Ask an authorized reviewer to clarify uncertainties before making a decision.</p>' });
        f.setIdentity(f.get(site.id)!.userId);
        const preview = await f.invoke('actions/selectedPages:preview', { siteId: site.id, wordpressId: p.id });
        pageId = await f.invoke('actions/selectedPages:select', { siteId: site.id, wordpressId: p.id, revision: preview.revision, reviewToken: preview.reviewToken, confirm: true });
        f.get(site.id)!.gscDateEpochs = [{ date: '2026-09-10', syncEpoch: 'rollback-selected' }];
        f.add('search_performance', { siteId: site.id, date: '2026-09-10', syncEpoch: 'rollback-selected', page: preview.url, query: slcBusinesses[0].keywords[0], syncVersion: 2, syncedAt: f.now(), clicks: 1, impressions: 60, ctr: 1 / 60, position: 12, createdAt: f.now() });
      }
      await exerciseRollbackReceipt(f, pageId);
    }
    assert.equal(writes, 1, 'A service switch never replays the external write');
    t.diagnostic(JSON.stringify({ scenario, database: local.database, provider: 'synthetic', wordpress: 'real loopback', writes }));
  });
});

test('real WordPress SLC42 lost creation response recovers read-only during explicit service rollback', async () => {
  const local = command({ operation: 'setup' });
  const [username, password] = Buffer.from(local.auth, 'base64').toString().split(':');
  const domain = `receipt-${randomUUID().slice(0, 8)}.example`;
  let outage = false, writes = 0;
  const f = setup({ growthFirst: true, businesses: [{ ...slcBusinesses[0], domain }], wordpress: { username, password,
    transport: async (url, init) => {
      assert.equal(url.hostname, domain);
      if (outage && url.pathname.startsWith('/wp-json/')) return new Response('{"code":"synthetic_read_outage"}', { status: 503, headers: { 'Content-Type': 'application/json' } });
      const response = await fetch(root + url.pathname + url.search, { ...init, headers: { ...Object.fromEntries(new Headers(init.headers).entries()), 'X-Pentra-Fixture-Host': domain }, redirect: 'manual' });
      if (response.ok && url.pathname.endsWith('/pentra/v1/write')) {
        writes++;
        if (writes === 1) { outage = true; return new Response('{"code":"synthetic_lost_response"}', { status: 503, headers: { 'Content-Type': 'application/json' } }); }
      }
      return response;
    } } });
  await f.invoke('publisher:verifyPublicationDestinationInternal', { siteId: f.sites[0].id });
  await exerciseRollbackUnknown(f, async () => { outage = false; }, false);
  assert.equal(writes, 1);
});

async function lostWordPressFixture(selected: boolean) {
  const local = command({ operation: 'setup' });
  const [username, password] = Buffer.from(local.auth, 'base64').toString().split(':');
  const suffix = randomUUID().slice(0, 8), domain = `recover-${suffix}.example`;
  const wire: Json = { outage: false, fault: '', writes: 0, reads: 0 };
  const f = setup({ growthFirst: true, businesses: [{ ...slcBusinesses[0], domain }], wordpress: { username, password,
    transport: async (original, init) => {
      assert.equal(original.hostname, domain);
      const url = new URL(original), receipt = url.pathname.endsWith('/pentra/v1/receipt');
      if (url.pathname.endsWith('/pentra/v1/write')) wire.writes++;
      if (receipt) {
        wire.reads++; assert.equal(init.method, 'GET'); assert.equal(init.body, undefined);
        if (['key', 'requestHash', 'binding'].includes(wire.fault)) url.searchParams.set(wire.fault, key());
        if (wire.fault === 'target') url.searchParams.set('id', '2147483000');
        if (wire.fault === 'missing_route') return Response.json({ code: 'rest_no_route' }, { status: 404 });
      }
      if (wire.outage && url.pathname.startsWith('/wp-json/')) return Response.json({ code: 'synthetic_read_outage' }, { status: 503 });
      const headers = { ...Object.fromEntries(new Headers(init.headers).entries()), 'X-Pentra-Fixture-Host': domain,
        ...(receipt && wire.fault === 'owner' ? { Authorization: `Basic ${local.otherAuth}` } : {}) };
      const response = await fetch(root + url.pathname + url.search, { ...init, headers, redirect: 'manual' });
      if (receipt && response.ok && wire.fault === 'edit_after_lookup' && !wire.edited) {
        command({ operation: 'edit', id: wire.proof.id, content: '<p>Customer edit after receipt lookup must survive.</p>' }); wire.edited = true;
      }
      if (wire.fault === 'old_connector' && url.pathname.endsWith('/pentra/v1/connection') && response.ok) {
        const old = await response.json(); delete old.receiptLookup; return Response.json(old);
      }
      if (response.ok && url.pathname.endsWith('/pentra/v1/write') && wire.writes === 1) {
        wire.proof = await response.clone().json(); wire.body = JSON.parse(String(init.body)); wire.outage = true;
        return Response.json({ code: 'synthetic_lost_response' }, { status: 503 });
      }
      return response;
    } } });
  const site = f.sites[0]; await f.invoke('publisher:verifyPublicationDestinationInternal', { siteId: site.id });
  let pageId: string | undefined;
  if (selected) {
    const p = command({ operation: 'create', slug: `recovery-selected-${suffix}`, title: slcBusinesses[0].keywords[0],
      content: '<p>Preserve the confirmed customer facts and original explanation. Ask an authorized reviewer to clarify uncertainties before making a decision.</p>' });
    f.setIdentity(f.get(site.id)!.userId);
    const preview = await f.invoke('actions/selectedPages:preview', { siteId: site.id, wordpressId: p.id });
    pageId = await f.invoke('actions/selectedPages:select', { siteId: site.id, wordpressId: p.id, revision: preview.revision, reviewToken: preview.reviewToken, confirm: true });
    f.get(site.id)!.gscDateEpochs = [{ date: '2026-09-10', syncEpoch: 'receipt-selected' }];
    f.add('search_performance', { siteId: site.id, date: '2026-09-10', syncEpoch: 'receipt-selected', page: preview.url, query: slcBusinesses[0].keywords[0], syncVersion: 2, syncedAt: f.now(), clicks: 1, impressions: 60, ctr: 1 / 60, position: 12, createdAt: f.now() });
  }
  await selectGrowth(f);
  await pumpUntil(f, () => selected ? f.tables.published_article_revisions?.some(r => r.attemptedAt && !r.receipt)
    : f.tables.articles?.some(a => a.publicationOutcomeUnverifiedAt), 180);
  const job = f.tables.jobs.find(j => selected ? j.contentWork?.revisionId : f.get(j.articleId)?.publicationOutcomeUnverifiedAt)!;
  assert.ok(job); assert.equal(wire.writes, 1); assert.ok(wire.proof);
  const before = structuredClone(job), hold = structuredClone(f.get(job.providerSpendReservationId)), calls = f.modelCalls.length;
  f.setIdentity(f.get(site.id)!.userId);
  return { f, site, pageId, wire, jobId: job._id, before, hold, calls, local };
}

test('real WordPress SLC42 actual lost create/improvement responses recover once and replenish under active, paused and rollback modes', async t => {
  for (const selected of [false, true]) for (const mode of ['active', 'paused', 'rollback', 'revoked', 'remote_revoked']) await t.test(`${selected ? 'improve' : 'create'}/${mode}`, async () => {
    const { f, site, pageId, wire, jobId, before, hold, calls } = await lostWordPressFixture(selected);
    const request = { siteId: site.id, mode: 'legacy_articles', confirmBusinessProfile: false };
    if (!['active', 'remote_revoked'].includes(mode)) await f.invoke('contentWork:control', { siteId: site.id, action: 'pause', reviewToken: (await f.invoke('contentWork:readiness', { siteId: site.id })).reviewToken });
    if (mode === 'rollback') assert.equal((await f.invoke('contentWork:selectServiceMode', request)).status, 'needs_action');
    wire.outage = false;
    if (mode.includes('revoked')) {
      if (pageId && mode === 'revoked') await f.invoke('selectedPages:revoke', { siteId: site.id, pageId });
      else {
        const revoked = await fetch(root + '/wp-json/pentra/v1/revoke', { method: 'POST', headers: { Authorization: `Basic ${Buffer.from(`${f.get(site.id)!.wpUsername}:${f.get(site.id)!.wpAppPassword}`).toString('base64')}`, 'Content-Type': 'application/json', 'X-Pentra-Fixture-Host': site.domain },
          body: JSON.stringify({ site: wire.body.site, binding: wire.body.binding, id: wire.proof.id, permission: wire.proof.permission }) });
        assert.equal(revoked.status, 200);
      }
    }
    // Duplicate wakes use the existing receipt/live verifier lease. No new
    // provider calls or remote mutation can occur while reconciling this job.
    await Promise.all([f.invoke('publisher:verifyContentImprovement', { siteId: site.id, jobId }), f.invoke('publisher:verifyContentImprovement', { siteId: site.id, jobId })]);
    await pumpUntil(f, () => f.get(jobId)!.contentWork.stage === 'verified', 220, f.now() + 3_600_000);
    assert.equal(wire.writes, 1); assert.ok(wire.reads >= 1); assert.equal(f.modelCalls.length, calls);
    assert.deepEqual(f.get(before.providerSpendReservationId), hold); assert.equal(f.get(jobId)!.contentWork.deadlineAt, before.contentWork.deadlineAt);
    assert.equal(f.get(jobId)!.publicationAttempts, before.publicationAttempts);
    if (selected) assert.equal(f.get(before.contentWork.revisionId)!.attempts, 1);
    if (mode.includes('revoked')) {
      if (pageId) assert.equal(f.get(pageId)!.editable.active, false);
      else assert.ok(!f.tables.pages.some(p => p.editable?.managedArticleId === before.articleId));
    }
    const verified = structuredClone(f.get(jobId)!);
    if (mode === 'rollback') {
      assert.equal((await f.invoke('contentWork:selectServiceMode', request)).status, 'completed');
      assert.equal(f.get(jobId)!.contentWork.retiredAt, undefined);
      await f.invoke('contentWork:selectServiceMode', { siteId: site.id, mode: 'growth_first', confirmBusinessProfile: true,
        reviewToken: (await f.invoke('contentWork:readiness', { siteId: site.id })).reviewToken, firstDeadlineAt: f.now() + 600_000, intervalMs: 1_800_000 });
    } else if (!['active', 'remote_revoked'].includes(mode)) await f.invoke('contentWork:control', { siteId: site.id, action: 'resume', reviewToken: (await f.invoke('contentWork:readiness', { siteId: site.id })).reviewToken });
    await pumpUntil(f, () => f.tables.jobs.filter(j => j.contentWork?.stage === 'ready' && !j.contentWork.retiredAt).length === 2, 220, f.now() + 3_600_000);
    assert.equal(wire.writes, 1); assert.ok(f.tables.jobs.some(j => j._id !== jobId && j.createdAt > before.createdAt && j.contentWork?.stage === 'ready'));
    assert.equal(f.get(jobId)!.contentWork.verifiedAt, verified.contentWork.verifiedAt); f.assertOffline();
    t.diagnostic(JSON.stringify({ selected, mode, database: process.env.PENTRA_FIXTURE_DB ?? 'sqlite', writes: wire.writes, receiptReads: wire.reads, originalDeadline: before.contentWork.deadlineAt, receiptObservedAt: verified.contentWork.publishedAt, liveVerifiedAt: verified.contentWork.verifiedAt, ready: 2 }));
  });
});

test('real WordPress SLC42 exact read-only receipt rejects missing/foreign/conflicting targets and preserves revocation and edits', async () => {
  const env = command({ operation: 'setup' }), binding = key(), slug = `read-only-${randomUUID()}`;
  const body = { site: root, binding, key: key(), operation: 'create', type: 'post', slug, title: 'Exact receipt test',
    content: '<p>Original reviewed source is retained.</p>', metadata: { canonical: `${root}/blog/${slug}/`, title: 'Exact receipt test', description: 'Exact first-party metadata.' } };
  const payload = JSON.stringify(body);
  const written = await fetch(root + '/wp-json/pentra/v1/write', { method: 'POST', headers: { Authorization: `Basic ${env.auth}`, 'Content-Type': 'application/json' }, body: payload });
  assert.equal(written.status, 200); const proof = await written.json();
  const query = { site: root, binding, key: body.key, requestHash: hash(payload), type: 'post', slug };
  const read = async (patch: Json = {}, auth: string | null = env.auth) => {
    const response = await fetch(root + '/wp-json/pentra/v1/receipt?' + new URLSearchParams({ ...query, ...patch }), { headers: auth ? { Authorization: `Basic ${auth}` } : {} });
    return { status: response.status, data: await response.json(), cache: response.headers.get('cache-control') };
  };
  const reads = await Promise.all(Array.from({ length: 5 }, () => read()));
  for (const result of reads) { assert.equal(result.status, 200); assert.equal(result.data.id, proof.id); assert.equal(result.data.revision, proof.revision); assert.equal(result.data.requestHash, hash(payload)); assert.equal(result.data.permissionActive, true); assert.match(result.cache!, /no-store/); assert.equal(result.data.base, undefined); }
  for (const patch of [{ key: key() }, { requestHash: key() }, { binding: key() }, { id: '2147483000' }, { slug: 'not-the-target' }]) {
    const denied = await read(patch); assert.equal(denied.status, 404); assert.equal(denied.data.code, 'pentra_receipt_unavailable'); assert.equal(denied.data.content, undefined);
  }
  const foreign = await read({}, env.otherAuth); assert.equal(foreign.status, 404); assert.equal(foreign.data.code, 'pentra_receipt_unavailable');
  assert.notEqual((await read({}, env.lowAuth)).status, 200); assert.notEqual((await read({}, null)).status, 200);
  const post = async (route: string, data: Json) => fetch(root + '/wp-json/pentra/v1/' + route, { method: 'POST', headers: { Authorization: `Basic ${env.auth}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ site: root, binding, ...data }) });
  assert.equal((await post('revoke', { id: proof.id, permission: proof.permission })).status, 200);
  const revoked = await read(); assert.equal(revoked.status, 200); assert.equal(revoked.data.permissionActive, false);
  const replay = await fetch(root + '/wp-json/pentra/v1/write', { method: 'POST', headers: { Authorization: `Basic ${env.auth}`, 'Content-Type': 'application/json' }, body: payload });
  assert.equal(replay.status, 409, 'Historical read never renews permission to replay');
  assert.equal((await post('select', { id: proof.id, revision: proof.revision, confirm: true })).status, 200);
  assert.equal((await read()).status, 409, 'A different current grant cannot authenticate the old receipt');
  command({ operation: 'edit', id: proof.id, content: '<p>Later customer edit remains authoritative.</p>' });
  assert.equal((await read()).status, 409);
  const current = await fetch(`${root}/wp-json/wp/v2/posts/${proof.id}`); assert.match((await current.json()).content.rendered, /Later customer edit remains authoritative/);
});

test('real WordPress SLC42 rejected receipt recovery never becomes success or permission to replay', async t => {
  for (const selected of [false, true]) for (const fault of ['key', 'requestHash', 'binding', 'owner', 'target', 'old_connector', 'missing_route', 'edited', 'edit_after_lookup']) await t.test(`${selected ? 'improve' : 'create'}/${fault}`, async () => {
    const { f, site, wire, jobId, before, hold, calls } = await lostWordPressFixture(selected);
    await f.invoke('contentWork:control', { siteId: site.id, action: 'pause', reviewToken: (await f.invoke('contentWork:readiness', { siteId: site.id })).reviewToken });
    wire.outage = false; wire.fault = fault;
    if (fault === 'edited') command({ operation: 'edit', id: wire.proof.id, content: '<p>Later customer edit must survive recovery.</p>' });
    f.setTime(Math.max(f.get(site.id)!.publicationLeaseExpiresAt, f.now()) + 1);
    if (selected) {
      await Promise.all([f.invoke('publisher:verifyContentImprovement', { siteId: site.id, jobId }), f.invoke('publisher:verifyContentImprovement', { siteId: site.id, jobId })]);
    } else {
      const a = f.get(before.articleId)!;
      await Promise.all(Array.from({ length: 2 }, () => f.invoke('publisher:recoverInitialPublicationLeaseInternal', { siteId: site.id, articleId: a._id, expectedContentHash: a.publicationLeaseHash, expectedLeaseOwner: a.publicationLeaseOwner })));
    }
    if (fault === 'edit_after_lookup') await pumpUntil(f, () => selected ? f.get(before.contentWork.revisionId)!.status === 'failed' : f.get(before.articleId)!.publicUrlStatus === 'failed', 200, f.now() + 7 * 86_400_000);
    assert.notEqual(f.get(jobId)!.contentWork.stage, 'verified'); assert.equal(f.get(site.id)!.contentSchedule.nextDeadlineAt, before.contentWork.deadlineAt);
    assert.equal(wire.writes, 1); assert.equal(f.modelCalls.length, calls); assert.deepEqual(f.get(before.providerSpendReservationId), hold);
    const result = await f.invoke('contentWork:selectServiceMode', { siteId: site.id, mode: 'legacy_articles', confirmBusinessProfile: false });
    assert.notEqual(result.status, 'completed'); assert.equal(f.get(jobId)!.contentWork.retiredAt, undefined);
    if (fault === 'old_connector' || fault === 'missing_route') {
      const message = selected ? f.get(before.contentWork.revisionId)!.failureDetail : f.get(before.articleId)!.publicationOutcomeDetail;
      assert.match(message, /wordpress_receipt_update_required|Update the Pentra WordPress connector/);
      // Updating the existing connector and checking the same retained work
      // recovers within the original read budget; never reset an attempt.
      wire.fault = ''; f.setTime(f.now() + 60_001);
      await f.invoke('contentWork:selectServiceMode', { siteId: site.id, mode: 'legacy_articles', confirmBusinessProfile: false });
      await pumpUntil(f, () => f.get(jobId)!.contentWork.stage === 'verified', 180, f.now() + 3_600_000);
      assert.equal(wire.writes, 1); assert.equal(f.modelCalls.length, calls); assert.deepEqual(f.get(before.providerSpendReservationId), hold);
      if (selected) assert.equal(f.get(before.contentWork.revisionId)!.liveVerificationAttempts, 3);
    }
    if (fault.includes('edit')) { const current = await fetch(`${root}/wp-json/wp/v2/posts/${wire.proof.id}`); assert.match((await current.json()).content.rendered, /[Cc]ustomer edit/); }
    f.assertOffline();
  });
});

test('real WordPress/core database: authentication, permissions, CAS, replay, edit races and rollback', async t => {
  const env = command({ operation: 'setup' });
  t.diagnostic(`WordPress ${env.wordpress}, PHP ${env.php}, database ${env.database}; loopback only`);
  const binding = key();
  async function request(route: string, body?: Json, auth: string | null = env.auth) {
    const response = await fetch(root + '/wp-json/pentra/v1/' + route, {
      method: body ? 'POST' : 'GET', headers: { ...(auth ? { Authorization: `Basic ${auth}` } : {}), 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: response.status, data: await response.json() as Json };
  }
  const scoped = (extra: Json): Json => ({ site: root, binding, ...extra });
  async function source(id: number) {
    return request('source?' + new URLSearchParams({ site: root, binding, id: String(id) }));
  }
  async function select(id: number) {
    const s = await source(id); assert.equal(s.status, 200, JSON.stringify(s.data));
    const r = await request('select', scoped({ id, revision: s.data.revision, confirm: true }));
    assert.equal(r.status, 200, JSON.stringify(r.data)); return r.data;
  }
  const metadata = (url: string) => ({ canonical: url, title: 'Supported local article', description: 'Supported first-party guidance.' });
  const addition = '<p>A useful additional explanation supported by the confirmed source facts.</p>';
  const append = (s: Json, extra = addition) => scoped({ key: key(), operation: 'append', id: s.id,
    permission: s.permission, baseRevision: s.revision, content: s.content + extra, metadata: metadata(s.url) });

  await t.test('core application-password authentication and capability checks', async () => {
    assert.notEqual((await request('connection', undefined, null)).status, 200);
    assert.notEqual((await request('connection', undefined, env.lowAuth)).status, 200);
    const r = await request('connection'); assert.equal(r.status, 200); assert.equal(r.data.atomic, true); assert.equal(r.data.site, root);
  });
  await t.test('reject protected, custom block/layout, stale selection and wrong binding', async () => {
    for (const [slug, content] of [['pricing-' + randomUUID(), '<p>Protected price</p>'], ['blocks-' + randomUUID(), '<!-- wp:paragraph --><p>Block</p><!-- /wp:paragraph -->'], ['custom-' + randomUUID(), '<div class="layout">Custom</div>']]) {
      const p = command({ operation: 'create', slug, content }); assert.equal((await source(p.id)).status, 409);
    }
    const p = command({ operation: 'create', slug: 'stale-' + randomUUID() }); const s = (await source(p.id)).data;
    command({ operation: 'edit', id: p.id, content: '<p>A normal customer edit.</p>' });
    assert.equal((await request('select', scoped({ id: p.id, revision: s.revision, confirm: true }))).status, 409);
    const selected = await select(p.id);
    assert.equal((await request('write', { ...append(selected), binding: key() })).status, 409);
  });
  await t.test('concurrent create/retry commits one post and exact idempotency receipt', async () => {
    const slug = 'created-' + randomUUID();
    const body = scoped({ key: key(), operation: 'create', type: 'post', slug, title: 'Supported local article',
      content: '<p>Original confirmed facts remain unchanged.</p>', metadata: metadata(root + '/blog/' + slug + '/') });
    const results = await Promise.all(Array.from({ length: 5 }, () => request('write', body)));
    const good = results.find(r => r.status === 200); assert.ok(good, JSON.stringify(results));
    for (const r of results.filter(r => r.status === 200)) { assert.equal(r.data.id, good.data.id); assert.equal(r.data.revision, good.data.revision); }
    const replay = await request('write', body); assert.equal(replay.status, 200); assert.equal(replay.data.id, good.data.id);
    assert.equal((await request('write', { ...body, content: body.content + addition })).status, 409);
    assert.equal((await request('write', { ...body, key: key() })).status, 409);
  });
  await t.test('concurrent updates: only one different artifact may win the same base', async () => {
    const p = command({ operation: 'create', slug: 'race-' + randomUUID() }); const s = await select(p.id);
    const a = append(s), b = append(s, '<p>A different useful explanation that is supported by the same source facts.</p>');
    const result = await Promise.all([request('write', a), request('write', b)]);
    assert.equal(result.filter(r => r.status === 200).length, 1, JSON.stringify(result));
    const winner = result[0].status === 200 ? a : b;
    // Simulates discarding a successful response; retry uses unchanged bytes.
    assert.equal((await request('write', winner)).status, 200);
    const current = (await source(p.id)).data; assert.equal(current.content, winner.content);
    const rollback = scoped({ key: key(), operation: 'rollback', id: p.id, permission: s.permission,
      baseRevision: current.revision, rollbackKey: winner.key });
    const rolled = await request('write', rollback); assert.equal(rolled.status, 200, JSON.stringify(rolled.data));
    assert.equal((await source(p.id)).data.content, s.content);
  });
  await t.test('ordinary core editor racing before CAS is preserved; later edits block rollback and retry', async () => {
    const p = command({ operation: 'create', slug: 'customer-' + randomUUID() }); const s = await select(p.id);
    const content = '<p>The customer changed this through the ordinary WordPress editor API.</p>';
    const child = spawn(runtime, ['php-cli', 'tests/fixtures/wordpress-command.php'], { stdio: ['pipe','pipe','pipe'] });
    child.stdin.end(JSON.stringify({ operation: 'lock_edit', id: p.id, content }));
    await new Promise<void>((resolve, reject) => { child.stdout.once('data', () => resolve()); child.once('error', reject); });
    const r = await request('write', append(s)); assert.equal(r.status, 409);
    await new Promise<void>(resolve => child.exitCode === null ? child.once('exit', () => resolve()) : resolve());
    assert.equal((await source(p.id)).data.content, content);
    const fresh = await select(p.id), body = append(fresh); const written = await request('write', body); assert.equal(written.status, 200);
    command({ operation: 'edit', id: p.id, content: '<p>A subsequent customer edit must survive rollback.</p>' });
    assert.equal((await request('write', body)).status, 409);
    assert.equal((await request('write', scoped({ key: key(), operation: 'rollback', id: p.id, permission: fresh.permission,
      baseRevision: written.data.revision, rollbackKey: body.key }))).status, 409);
    assert.match((await source(p.id)).data.content, /subsequent customer edit/);
  });
  await t.test('revocation, re-selection, newly protected text and no-op never mutate', async () => {
    const p = command({ operation: 'create', slug: 'revoke-' + randomUUID(), type: 'page' }); const s = await select(p.id);
    assert.equal((await request('write', { ...append(s), content: s.content })).status, 409);
    assert.equal((await request('revoke', scoped({ id: p.id, permission: s.permission }))).status, 200);
    assert.equal((await request('revoke', scoped({ id: p.id, permission: s.permission }))).status, 200, 'Lost revocation acknowledgement is replayable');
    assert.equal((await request('write', append(s))).status, 409);
    const fresh = await select(p.id); assert.notEqual(fresh.permission, s.permission);
    assert.equal((await request('write', append(s))).status, 409);
    command({ operation: 'protect', id: p.id }); assert.equal((await request('write', append(fresh))).status, 409);
    assert.equal((await request('revoke', scoped({ id: p.id, permission: fresh.permission }))).status, 200, 'New protection must not prevent revocation');
  });
  await t.test('exact bounded replacement, retry and rollback preserve all unrelated source bytes', async () => {
    const p = command({ operation: 'create', slug: 'replace-' + randomUUID(), content: '<p>Retained confirmed fact.</p><p>Old proposed guidance.</p><p>Another unchanged fact.</p>' });
    const s = await select(p.id), before = '<p>Old proposed guidance.</p>', after = '<p>A clarified proposed workflow for a reversible handoff.</p>';
    const body: Json = { ...append(s), operation: 'replace', before, after, content: s.content.replace(before, after) };
    assert.equal((await request('write', { ...body, content: body.content.replace('Retained', 'Invented') })).status, 409);
    const written = await request('write', body); assert.equal(written.status, 200, JSON.stringify(written.data));
    assert.equal((await request('write', body)).status, 200);
    assert.equal((await source(p.id)).data.content, body.content);
    const rolled = await request('write', scoped({ key: key(), operation: 'rollback', id: p.id, permission: s.permission,
      baseRevision: written.data.revision, rollbackKey: body.key }));
    assert.equal(rolled.status, 200); assert.equal(rolled.data.content, s.content);
  });
  if (env.database === 'mysql') await t.test('nontransactional receipt table fails closed before creation', async () => {
    assert.equal(command({ operation: 'receipt_engine', transactional: false }).ok, true);
    try { assert.notEqual((await request('connection')).status, 200); }
    finally { assert.equal(command({ operation: 'receipt_engine', transactional: true }).ok, true); }
    assert.equal((await request('connection')).status, 200);
  });
});

test('real WordPress managed creation becomes editable and executes two measured improvements with fresh refill', async t => {
  const local = command({ operation: 'setup' });
  const [username, password] = Buffer.from(local.auth, 'base64').toString().split(':');
  const domain = `managed-${randomUUID().slice(0, 8)}.example`;
  const f = setup({ growthFirst: true, longManagedPage: true, businesses: [{ ...slcBusinesses[0], domain }], wordpress: { username, password,
    transport: async (url, init) => {
      assert.equal(url.hostname, domain);
      return fetch(root + url.pathname + url.search, { ...init, headers: { ...Object.fromEntries(new Headers(init.headers).entries()), 'X-Pentra-Fixture-Host': domain }, redirect: 'manual' });
    } } });
  await f.invoke('publisher:verifyPublicationDestinationInternal', { siteId: f.sites[0].id });
  const result = await managedMeasuredFollowups(f);
  assert.ok(result.original.split(/\s+/).length >= 2400 && result.finalText.split(/\s+/).length <= 2600);
  t.diagnostic(JSON.stringify({ synthetic: true, adapter: 'wordpress', database: local.database, observations: result.observations, deadlines: result.deadlines, ready: 2,
    originalWords: result.original.split(/\s+/).length, finalWords: result.finalText.split(/\s+/).length }));
});

test('real WordPress immediate owner factual correction retains source metadata, overdue deadline and conditional rollback', async () => {
  const local = command({ operation: 'setup' });
  const [username, password] = Buffer.from(local.auth, 'base64').toString().split(':');
  const suffix = randomUUID().slice(0, 8), domain = `correct-${suffix}.example`;
  const f = setup({ growthFirst: true, businesses: [{ ...slcBusinesses[0], domain }], wordpress: { username, password,
    transport: async (url, init) => {
      assert.equal(url.hostname, domain);
      return fetch(root + url.pathname + url.search, { ...init, headers: { ...Object.fromEntries(new Headers(init.headers).entries()), 'X-Pentra-Fixture-Host': domain }, redirect: 'manual' });
    } } });
  const site = f.sites[0]; await f.invoke('publisher:verifyPublicationDestinationInternal', { siteId: site.id });
  const p = command({ operation: 'create', slug: `selected-${suffix}`, content: `<p>${incorrectBusinessParagraph}</p><p>${correctionSurvivor}</p>` });
  f.setIdentity(`synthetic-owner-${domain}`);
  const preview = await f.invoke('actions/selectedPages:preview', { siteId: site.id, wordpressId: p.id });
  const pageId = await f.invoke('actions/selectedPages:select', { siteId: site.id, wordpressId: p.id, revision: preview.revision, reviewToken: preview.reviewToken, confirm: true });
  f.setIdentity(null);
  await exerciseImmediateFactCorrection(f, pageId);
});

test('real WordPress observed broken-link repair is live-verified and conditionally reversible through the same jobs', async () => {
  const local = command({ operation: 'setup' });
  const [username, password] = Buffer.from(local.auth, 'base64').toString().split(':');
  const suffix = randomUUID().slice(0, 8), domain = `link-${suffix}.example`;
  const f = setup({ growthFirst: true, businesses: [{ ...slcBusinesses[0], domain }], wordpress: { username, password,
    transport: async (url, init) => {
      assert.equal(url.hostname, domain);
      return fetch(root + url.pathname + url.search, { ...init, headers: { ...Object.fromEntries(new Headers(init.headers).entries()), 'X-Pentra-Fixture-Host': domain }, redirect: 'manual' });
    } } });
  const site = f.sites[0]; await f.invoke('publisher:verifyPublicationDestinationInternal', { siteId: site.id });
  const p = command({ operation: 'create', slug: `selected-${suffix}`, content: renderSafePublicationHtml(`${brokenLinkParagraph(domain)}\n\n${correctionSurvivor}`) });
  f.setIdentity(`synthetic-owner-${domain}`);
  const preview = await f.invoke('actions/selectedPages:preview', { siteId: site.id, wordpressId: p.id });
  const pageId = await f.invoke('actions/selectedPages:select', { siteId: site.id, wordpressId: p.id, revision: preview.revision, reviewToken: preview.reviewToken, confirm: true });
  f.setIdentity(null);
  await exerciseBrokenLinkCorrection(f, pageId);
});

test('real WordPress/database connected content jobs: fresh creation, selected improvement, exact rendered verification and refill', async t => {
  const local = command({ operation: 'setup' });
  const [username, password] = Buffer.from(local.auth, 'base64').toString().split(':');
  for (const [index, business] of slcBusinesses.entries()) await t.test(business.name, async () => {
    // Each fixture has a fresh exact destination domain and independent Convex
    // records. The only real network transport is this literal loopback server.
    const suffix = randomUUID().slice(0, 8), domain = `${business.name.toLowerCase()}-${suffix}.example`;
    let latestHtml = '', lostAcknowledgement = false;
    const f = setup({ growthFirst: true, businesses: [{ ...business, domain }], wordpress: { username, password,
      transport: async (url, init) => {
        assert.equal(url.hostname, domain);
        assert.ok(url.pathname === '/' || url.pathname.startsWith('/wp-json/') || url.pathname.startsWith('/blog/') || url.pathname === `/selected-${suffix}/`);
        const response = await fetch(root + url.pathname + url.search, { ...init,
          headers: { ...Object.fromEntries(new Headers(init.headers).entries()), 'X-Pentra-Fixture-Host': domain }, redirect: 'manual' });
        if (url.pathname.endsWith('/pentra/v1/connection')) {
          const safe = await response.clone().json(); assert.equal(safe.site, `https://${domain}`, JSON.stringify(safe));
        }
        if (!url.pathname.startsWith('/wp-json/')) latestHtml = await response.clone().text();
        if (index === 0 && !lostAcknowledgement && url.pathname.endsWith('/pentra/v1/write') && JSON.parse(String(init.body)).operation === 'append' && response.ok) {
          lostAcknowledgement = true;
          return new Response(JSON.stringify({ code: 'synthetic_lost_acknowledgement' }), { status: 503, headers: { 'Content-Type': 'application/json' } });
        }
        return response;
      } } });
    const site = await createEmptyContentSite(f);
    const slug = `selected-${suffix}`;
    const original = '<p>Preserve the confirmed customer facts and original explanation. Ask an authorized reviewer to clarify uncertainties before making a decision.</p>';
    const p = command({ operation: 'create', slug, type: index % 2 ? 'page' : 'post', title: business.keywords[0][0].toUpperCase() + business.keywords[0].slice(1), content: original });
    f.setIdentity(`synthetic-owner-${domain}`);
    const preview = await f.invoke('actions/selectedPages:preview', { siteId: site.id, wordpressId: p.id });
    const pageId = await f.invoke('actions/selectedPages:select', { siteId: site.id, wordpressId: p.id, revision: preview.revision, reviewToken: preview.reviewToken, confirm: true });
    f.setIdentity(null);
    f.get(site.id)!.gscDateEpochs = [{ date: '2026-09-10', syncEpoch: 'real-wp-selected' }];
    f.add('search_performance', { siteId: site.id, date: '2026-09-10', syncEpoch: 'real-wp-selected', page: preview.url, query: business.keywords[0],
      syncVersion: 2, syncedAt: f.now(), clicks: 1, impressions: 60, ctr: 1 / 60, position: 12, createdAt: f.now() });
    await selectGrowth(f);
    try { await pumpUntil(f, () => f.tables.jobs?.some(j => j.contentWork?.intent === 'improve' && j.contentWork.stage === 'verified'), 160, START + 3 * 60 * 60_000); }
    catch {
      const r = f.tables.published_article_revisions?.[0], expected = r ? correctionVisibleText(renderSafePublicationHtml(r.nextArtifact.markdown)) : '';
      const visible = correctionVisibleText(latestHtml), start = visible.indexOf(expected.slice(0, 60));
      let mismatch = 0; while (start >= 0 && mismatch < expected.length && visible[start + mismatch] === expected[mismatch]) mismatch++;
      assert.fail(JSON.stringify({ bodyDifference: { start, mismatch, expected: expected.slice(mismatch, mismatch + 180), actual: visible.slice(start + mismatch, start + mismatch + 180) }, revisions: f.tables.published_article_revisions?.map(r => ({ status: r.status, failureDetail: r.failureDetail, attempts: r.liveVerificationAttempts })),
      jobs: f.tables.jobs.map(j => ({ stage: j.contentWork?.stage, intent: j.contentWork?.intent, revisionId: j.contentWork?.revisionId })),
      verification: f.trace.filter(r => /verifyContentImprovement|contentImprovements:verified|verificationContext/.test(r.name)).map(r => ({ name: r.name, error: r.error, empty: r.result === null })) })); }
    const improved = f.tables.jobs.find(j => j.contentWork?.intent === 'improve')!;
    assert.ok(f.get(pageId)!.editable.sourceContent.startsWith(original));
    assert.equal(f.get(improved.contentWork.revisionId)!.status, 'verified');
    await pumpUntil(f, () => f.tables.jobs.filter(j => j.contentWork?.stage === 'verified').length >= 3 &&
      f.tables.jobs.filter(j => j.contentWork?.stage === 'ready').length === 2, 240, START + 4 * 60 * 60_000);
    assert.ok(f.tables.jobs.some(j => j.contentWork?.intent === 'create' && j.createdAt > improved.contentWork.verifiedAt));
    assert.equal(f.tables.jobs.filter(j => j.contentWork?.intent === 'improve').length, 1);
    const deadline = f.get(site.id)!.contentSchedule.nextDeadlineAt, calls = f.modelCalls.length;
    f.setIdentity(`synthetic-owner-${domain}`);
    const rollbackId = await f.invoke('contentImprovements:requestRollback', { siteId: site.id, revisionId: improved.contentWork.revisionId, confirm: true });
    f.setIdentity(null);
    await pumpUntil(f, () => f.get(rollbackId)!.contentWork.stage === 'verified', 100, deadline - 5 * 60_000 - 1);
    assert.equal(f.get(pageId)!.editable.sourceContent, original);
    assert.equal(f.modelCalls.length, calls, 'Restoration must not call any model');
    assert.equal(f.get(site.id)!.contentSchedule.nextDeadlineAt, deadline, 'Restoration does not count as scheduled SEO delivery');
    if (index === 0) assert.equal(lostAcknowledgement, true);
    f.setIdentity(`synthetic-owner-${domain}`);
    await f.invoke('selectedPages:revoke', { siteId: site.id, pageId }); f.setIdentity(null);
    await pumpUntil(f, () => f.get(pageId)!.editable.revocationStatus === 'confirmed', 20, deadline - 5 * 60_000 - 1);
    assert.equal(f.get(pageId)!.editable.active, false);
    t.diagnostic(JSON.stringify({ syntheticOwner: true, realWordPress: true, business: business.name, afterPause: await exerciseReadyPause(f) }));
    f.assertOffline();
  });
});
