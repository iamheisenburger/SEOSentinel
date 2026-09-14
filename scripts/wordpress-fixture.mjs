// Free, pinned real-WordPress fixture. No application/provider credentials, no
// production Convex connection, no global package installation or DB deletion.
import { mkdirSync, existsSync, readFileSync, copyFileSync, chmodSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { stopOwnedProcess } from './owned-process.mjs';
const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(project);
const fixture = path.join(project, '.wordpress-fixture');
const mysql = process.argv.includes('--mysql');
const env = { ...process.env, PENTRA_FIXTURE_DB: mysql ? 'mysql' : 'sqlite', XDG_DATA_HOME: path.join(fixture, 'data'), XDG_CONFIG_HOME: path.join(fixture, 'config') };
if (process.platform !== 'darwin' || process.arch !== 'arm64') throw new Error('Pinned fixture runtime currently supports macOS arm64 only; do not silently substitute a different runtime.');
mkdirSync(fixture, { recursive: true });
for (const [file, url, checksum] of [
  ['frankenphp', 'https://github.com/php/frankenphp/releases/download/v1.12.7/frankenphp-mac-arm64', 'ccee0d248da3d0112aea7e73fd903a3cc325ef9d096ad63462b6bd3f9005a753'],
  ['wordpress.zip', 'https://wordpress.org/wordpress-7.1.zip', 'd1ae02b5ae18428031ffc3943659fa87ab361d827f4aa804adf9276e4dc75df6'],
  ['sqlite.zip', 'https://downloads.wordpress.org/plugin/sqlite-database-integration.3.0.2.zip', '1602e75577ad9b3a7e3e4a6a44a81b9541cdee2124d48928faf61c6fd3cd4f74'],
  ...(mysql ? [['mysql-8.4.11-macos15-arm64.tar.gz', 'https://cdn.mysql.com/Downloads/MySQL-8.4/mysql-8.4.11-macos15-arm64.tar.gz', 'b96e00493bc3499b9ffd7f08d65c5d64933af0383a8287d9873b64f94c2d6009']] : []),
]) {
  const target = path.join(fixture, file);
  if (!existsSync(target)) execFileSync('curl', ['--fail', '--location', '--proto', '=https', '--proto-redir', '=https', '--output', target, url], { stdio: 'inherit' });
  if (createHash('sha256').update(readFileSync(target)).digest('hex') !== checksum) throw new Error(`Pinned fixture checksum mismatch: ${file}`);
}
const runtime = path.join(fixture, 'frankenphp'), installation = mysql ? path.join(fixture, 'mysql-wordpress') : fixture;
mkdirSync(installation, { recursive: true });
const wordpress = path.join(installation, 'wordpress');
chmodSync(runtime, 0o755);
if (!existsSync(path.join(wordpress, 'wp-load.php'))) execFileSync('unzip', ['-q', path.join(fixture, 'wordpress.zip'), '-d', installation]);
const plugins = path.join(wordpress, 'wp-content/plugins');
if (!mysql) {
  if (!existsSync(path.join(plugins, 'sqlite-database-integration/db.copy'))) execFileSync('unzip', ['-q', path.join(fixture, 'sqlite.zip'), '-d', plugins]);
  copyFileSync(path.join(plugins, 'sqlite-database-integration/db.copy'), path.join(wordpress, 'wp-content/db.php'));
} else if (existsSync(path.join(wordpress, 'wp-content/db.php'))) throw new Error('MySQL fixture must use native wpdb, not a database drop-in');
copyFileSync('tests/fixtures/wordpress-config.php', path.join(wordpress, 'wp-config.php'));
const installed = path.join(plugins, 'pentra-conditional-publisher');
mkdirSync(installed, { recursive: true });
// Existing developer symlink points to this exact source; avoid copying a file
// over itself. Fresh setup copies only the one installable connector file.
const { realpathSync } = await import('node:fs');
const source = path.join(project, 'connectors/wordpress/pentra-conditional-publisher.php');
const destination = path.join(installed, 'pentra-conditional-publisher.php');
if (!existsSync(destination) || realpathSync(destination) !== realpathSync(source)) copyFileSync(source, destination);
console.log(`Verified pinned WordPress 7.1 / ${mysql ? 'MySQL 8.4.11 InnoDB' : 'SQLite Integration 3.0.2'} / FrankenPHP 1.12.7 fixture. Existing local DB retained.`);
const { createServer } = await import('node:net');
async function unused(port) {
  await new Promise((resolve, reject) => {
    const probe = createServer(); probe.once('error', reject);
    probe.listen(port, '127.0.0.1', () => probe.close(resolve));
  });
}
let database, server, test;
let stopping;
const stop = () => stopping ??= (async () => {
  await stopOwnedProcess(test);
  await stopOwnedProcess(server);
  await stopOwnedProcess(database);
})();
process.once('SIGINT', () => { process.exitCode = 130; void stop(); });
process.once('SIGTERM', () => { process.exitCode = 143; void stop(); });
try {
if (mysql) {
  const basedir = path.join(fixture, 'mysql-8.4.11-macos15-arm64'), datadir = path.join(fixture, 'mysql-data');
  if (!existsSync(path.join(basedir, 'bin/mysqld'))) execFileSync('tar', ['-xzf', path.join(fixture, 'mysql-8.4.11-macos15-arm64.tar.gz'), '-C', fixture]);
  if (!existsSync(path.join(datadir, 'auto.cnf'))) execFileSync(path.join(basedir, 'bin/mysqld'), ['--no-defaults', '--initialize-insecure', `--basedir=${basedir}`, `--datadir=${datadir}`], { stdio: 'inherit' });
  await unused(18928);
  if (stopping) throw new Error('Fixture startup interrupted');
  database = spawn(path.join(basedir, 'bin/mysqld'), ['--no-defaults', `--basedir=${basedir}`, `--datadir=${datadir}`, '--bind-address=127.0.0.1', '--port=18928', '--mysqlx=OFF', '--socket=mysql.sock', `--pid-file=${path.join(fixture, 'mysql.pid')}`, `--log-error=${path.join(fixture, 'mysql.log')}`, '--skip-log-bin', '--innodb-buffer-pool-size=67108864'], { cwd: fixture, stdio: 'ignore' });
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (database.exitCode !== null) throw new Error('Isolated MySQL stopped; inspect .wordpress-fixture/mysql.log');
    try {
      // Synthetic loopback-only database. No global installation or real account.
      execFileSync(path.join(basedir, 'bin/mysql'), ['--no-defaults', '--protocol=TCP', '--host=127.0.0.1', '--port=18928', '--user=root', '--execute', "CREATE DATABASE IF NOT EXISTS pentra_local_mysql_fixture; CREATE USER IF NOT EXISTS 'pentra_fixture'@'127.0.0.1' IDENTIFIED BY 'synthetic-local-fixture'; GRANT ALL ON pentra_local_mysql_fixture.* TO 'pentra_fixture'@'127.0.0.1';"], { stdio: 'pipe' });
      ready = true; break;
    } catch { await new Promise(resolve => setTimeout(resolve, 100)); }
  }
  if (!ready) throw new Error('Isolated MySQL was not ready');
}
if (!process.argv.includes('--setup-only')) {
  if (stopping) throw new Error('Fixture startup interrupted');
  await unused(18927);
  if (stopping) throw new Error('Fixture startup interrupted');
  server = spawn(runtime, ['php-server', '--root', wordpress, '--listen', '127.0.0.1:18927'], {
    stdio: ['ignore', 'pipe', 'pipe'], env,
  });
  let errors = '';
  server.stderr.on('data', d => { errors = (errors + d.toString()).slice(-3000); });
    let ready = false;
    for (let i = 0; i < 100; i++) {
      if (server.exitCode !== null) throw new Error(`Local fixture server stopped: ${errors}`);
      try { await fetch('http://127.0.0.1:18927/', { signal: AbortSignal.timeout(500), redirect: 'manual' }); ready = true; break; } catch {}
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (!ready) throw new Error('Local fixture server did not become ready');
    if (stopping) throw new Error('Fixture startup interrupted');
    if (process.argv.includes('--test')) {
      test = spawn(process.execPath, ['--experimental-strip-types', '--test', '--test-name-pattern=real WordPress', 'tests/wordpress-connector.integration.ts'], { stdio: 'inherit', env });
      const code = await new Promise(resolve => test.once('exit', resolve));
      if (code !== 0) process.exitCode = 1;
    } else {
      console.log('Local fixture listening only at http://127.0.0.1:18927; Ctrl-C stops it.');
      await new Promise(resolve => server.once('exit', resolve));
    }
}
} finally { await stop(); }
