<?php
// ISOLATED TEST CONFIGURATION. Never install on a public WordPress instance.
$fixture_mysql = getenv('PENTRA_FIXTURE_DB') === 'mysql';
define('DB_NAME', $fixture_mysql ? 'pentra_local_mysql_fixture' : 'pentra_local_fixture');
define('DB_USER', $fixture_mysql ? 'pentra_fixture' : 'synthetic-local');
define('DB_PASSWORD', $fixture_mysql ? 'synthetic-local-fixture' : '');
define('DB_HOST', $fixture_mysql ? '127.0.0.1:18928' : '127.0.0.1');
if ($fixture_mysql) { define('DB_ENGINE', 'mysql'); }
define('DB_CHARSET', 'utf8');
define('DB_COLLATE', '');
define('WP_ENVIRONMENT_TYPE', 'local');
define('WP_HTTP_BLOCK_EXTERNAL', true);
define('DISABLE_WP_CRON', true);
define('AUTOMATIC_UPDATER_DISABLED', true);
define('WP_AUTO_UPDATE_CORE', false);
$fixture_host = $_SERVER['HTTP_X_PENTRA_FIXTURE_HOST'] ?? $_SERVER['HTTP_HOST'] ?? '127.0.0.1:18927';
$fixture_origin = preg_match('/^[a-z0-9-]+\.example$/D', $fixture_host) ? 'https://' . $fixture_host : 'http://127.0.0.1:18927';
if (str_starts_with($fixture_origin, 'https://')) {
    $_SERVER['HTTPS'] = 'on'; $_SERVER['HTTP_HOST'] = $fixture_host; $_SERVER['SERVER_PORT'] = '443';
}
define('WP_HOME', $fixture_origin);
define('WP_SITEURL', $fixture_origin);
foreach (['AUTH_KEY','SECURE_AUTH_KEY','LOGGED_IN_KEY','NONCE_KEY','AUTH_SALT','SECURE_AUTH_SALT','LOGGED_IN_SALT','NONCE_SALT'] as $fixture_key) {
    define($fixture_key, 'synthetic-local-fixture-not-a-real-credential-' . $fixture_key);
}
$table_prefix = 'wp_';
if (!defined('ABSPATH')) { define('ABSPATH', __DIR__ . '/'); }
require_once ABSPATH . 'wp-settings.php';
