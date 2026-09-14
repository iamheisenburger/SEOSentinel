// Free, pinned real-WordPress fixture. No application/provider credentials, no
// production Convex connection, no global package installation or DB deletion.
import { mkdirSync, existsSync, readFileSync, copyFileSync, chmodSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(project);
const fixture = path.join(project, '.wordpress-fixture');
if (process.platform !== 'darwin' || process.arch !== 'arm64') throw new Error('Pinned fixture runtime currently supports macOS arm64 only; do not silently substitute a different runtime.');
mkdirSync(fixture, { recursive: true });
for (const [file, url, checksum] of [
  ['frankenphp', 'https://github.com/php/frankenphp/releases/download/v1.12.7/frankenphp-mac-arm64', 'ccee0d248da3d0112aea7e73fd903a3cc325ef9d096ad63462b6bd3f9005a753'],
  ['wordpress.zip', 'https://wordpress.org/wordpress-7.1.zip', 'd1ae02b5ae18428031ffc3943659fa87ab361d827f4aa804adf9276e4dc75df6'],
  ['sqlite.zip', 'https://downloads.wordpress.org/plugin/sqlite-database-integration.3.0.2.zip', '1602e75577ad9b3a7e3e4a6a44a81b9541cdee2124d48928faf61c6fd3cd4f74'],
]) {
  const target = path.join(fixture, file);
  if (!existsSync(target)) execFileSync('curl', ['--fail', '--location', '--proto', '=https', '--proto-redir', '=https', '--output', target, url], { stdio: 'inherit' });
  if (createHash('sha256').update(readFileSync(target)).digest('hex') !== checksum) throw new Error(`Pinned fixture checksum mismatch: ${file}`);
}
const runtime = path.join(fixture, 'frankenphp'), wordpress = path.join(fixture, 'wordpress');
chmodSync(runtime, 0o755);
if (!existsSync(path.join(wordpress, 'wp-load.php'))) execFileSync('unzip', ['-q', path.join(fixture, 'wordpress.zip'), '-d', fixture]);
const plugins = path.join(wordpress, 'wp-content/plugins');
if (!existsSync(path.join(plugins, 'sqlite-database-integration/db.copy'))) execFileSync('unzip', ['-q', path.join(fixture, 'sqlite.zip'), '-d', plugins]);
copyFileSync(path.join(plugins, 'sqlite-database-integration/db.copy'), path.join(wordpress, 'wp-content/db.php'));
copyFileSync('tests/fixtures/wordpress-config.php', path.join(wordpress, 'wp-config.php'));
const installed = path.join(plugins, 'pentra-conditional-publisher');
mkdirSync(installed, { recursive: true });
// Existing developer symlink points to this exact source; avoid copying a file
// over itself. Fresh setup copies only the one installable connector file.
const { realpathSync } = await import('node:fs');
const source = path.join(project, 'connectors/wordpress/pentra-conditional-publisher.php');
const destination = path.join(installed, 'pentra-conditional-publisher.php');
if (!existsSync(destination) || realpathSync(destination) !== realpathSync(source)) copyFileSync(source, destination);
console.log('Verified pinned WordPress 7.1 / SQLite Integration 3.0.2 / FrankenPHP 1.12.7 fixture. Existing local DB retained.');
if (!process.argv.includes('--setup-only')) {
  const { createServer } = await import('node:net');
  await new Promise((resolve, reject) => {
    const probe = createServer(); probe.once('error', reject);
    probe.listen(18927, '127.0.0.1', () => probe.close(resolve));
  });
  const server = spawn(runtime, ['php-server', '--root', wordpress, '--listen', '127.0.0.1:18927'], {
    stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, XDG_DATA_HOME: path.join(fixture, 'data'), XDG_CONFIG_HOME: path.join(fixture, 'config') },
  });
  let errors = '';
  server.stderr.on('data', d => { errors = (errors + d.toString()).slice(-3000); });
  const stop = () => server.kill('SIGTERM');
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  try {
    let ready = false;
    for (let i = 0; i < 100; i++) {
      if (server.exitCode !== null) throw new Error(`Local fixture server stopped: ${errors}`);
      try { await fetch('http://127.0.0.1:18927/', { signal: AbortSignal.timeout(500), redirect: 'manual' }); ready = true; break; } catch {}
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (!ready) throw new Error('Local fixture server did not become ready');
    if (process.argv.includes('--test')) {
      const test = spawn(process.execPath, ['--experimental-strip-types', '--test', '--test-name-pattern=real WordPress', 'tests/wordpress-connector.integration.ts'], { stdio: 'inherit' });
      const code = await new Promise(resolve => test.once('exit', resolve));
      if (code !== 0) process.exitCode = 1;
    } else {
      console.log('Local fixture listening only at http://127.0.0.1:18927; Ctrl-C stops it.');
      await new Promise(resolve => server.once('exit', resolve));
    }
  } finally { stop(); }
}
