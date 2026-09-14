import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { setup, pumpUntil, selectGrowth, slcBusinesses, managedMeasuredFollowups, exerciseImmediateFactCorrection, incorrectBusinessParagraph, correctionSurvivor, exerciseBrokenLinkCorrection, brokenLinkParagraph } from './core-pipeline-integration.test.ts';
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
  t.diagnostic(JSON.stringify({ synthetic: true, adapter: 'wordpress', database: local.database, deadlines: result.deadlines, ready: 2,
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
  const pageId = await f.invoke('actions/selectedPages:select', { siteId: site.id, wordpressId: p.id, revision: preview.revision, confirm: true });
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
  const pageId = await f.invoke('actions/selectedPages:select', { siteId: site.id, wordpressId: p.id, revision: preview.revision, confirm: true });
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
        assert.ok(url.pathname.startsWith('/wp-json/') || url.pathname.startsWith('/blog/') || url.pathname === `/selected-${suffix}/`);
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
    const site = f.sites[0];
    await f.invoke('publisher:verifyPublicationDestinationInternal', { siteId: site.id });
    const slug = `selected-${suffix}`;
    const original = '<p>Preserve the confirmed customer facts and original explanation. Ask an authorized reviewer to clarify uncertainties before making a decision.</p>';
    const p = command({ operation: 'create', slug, type: index % 2 ? 'page' : 'post', title: business.keywords[0][0].toUpperCase() + business.keywords[0].slice(1), content: original });
    f.setIdentity(`synthetic-owner-${domain}`);
    const preview = await f.invoke('actions/selectedPages:preview', { siteId: site.id, wordpressId: p.id });
    const pageId = await f.invoke('actions/selectedPages:select', { siteId: site.id, wordpressId: p.id, revision: preview.revision, confirm: true });
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
    f.assertOffline();
  });
});
