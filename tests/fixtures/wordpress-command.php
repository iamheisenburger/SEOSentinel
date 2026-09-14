<?php
// Local real-core fixture driver, not installed with the connector. No network.
$request = json_decode(stream_get_contents(STDIN), true);
if (!$request) { exit(2); }
define('WP_INSTALLING', $request['operation'] === 'setup');
$_SERVER['HTTP_HOST'] = '127.0.0.1:18927';
$_SERVER['REQUEST_URI'] = '/';
require dirname(__DIR__, 2) . (getenv('PENTRA_FIXTURE_DB') === 'mysql' ? '/.wordpress-fixture/mysql-wordpress/wordpress/wp-load.php' : '/.wordpress-fixture/wordpress/wp-load.php');
if ($request['operation'] === 'setup') {
    require_once ABSPATH . 'wp-admin/includes/upgrade.php';
    if (!is_blog_installed()) { wp_install('Pentra local fixture', 'fixture-owner', 'owner@synthetic.example', false, '', wp_generate_password(40)); }
    require_once ABSPATH . 'wp-admin/includes/plugin.php';
    $result = activate_plugin('pentra-conditional-publisher/pentra-conditional-publisher.php');
    if (is_wp_error($result)) { throw new RuntimeException($result->get_error_message()); }
    update_option('permalink_structure', '/blog/%postname%/');
    $wp_rewrite->set_permalink_structure('/blog/%postname%/');
    flush_rewrite_rules(false);
    $owner = get_user_by('login', 'fixture-owner');
    WP_Application_Passwords::delete_all_application_passwords($owner->ID);
    $password = WP_Application_Passwords::create_new_application_password($owner->ID, ['name'=>'Pentra synthetic fixture']);
    $subscriber = get_user_by('login', 'fixture-subscriber');
    if (!$subscriber) { $sid = wp_create_user('fixture-subscriber', wp_generate_password(40), 'subscriber@synthetic.example'); $subscriber = get_user_by('ID', $sid); $subscriber->set_role('subscriber'); }
    WP_Application_Passwords::delete_all_application_passwords($subscriber->ID);
    $low = WP_Application_Passwords::create_new_application_password($subscriber->ID, ['name'=>'Pentra synthetic fixture']);
    $other = get_user_by('login', 'fixture-other-owner');
    if (!$other) { $oid = wp_create_user('fixture-other-owner', wp_generate_password(40), 'other-owner@synthetic.example'); $other = get_user_by('ID', $oid); $other->set_role('editor'); }
    WP_Application_Passwords::delete_all_application_passwords($other->ID);
    $other_password = WP_Application_Passwords::create_new_application_password($other->ID, ['name'=>'Pentra synthetic fixture']);
    echo wp_json_encode(['wordpress'=>$wp_version, 'php'=>PHP_VERSION, 'database'=>DB_ENGINE,
        'auth'=>base64_encode('fixture-owner:' . $password[0]), 'lowAuth'=>base64_encode('fixture-subscriber:' . $low[0]), 'otherAuth'=>base64_encode('fixture-other-owner:' . $other_password[0])]);
    exit;
}
$owner = get_user_by('login', 'fixture-owner'); wp_set_current_user($owner->ID);
if ($request['operation'] === 'create') {
    $id = wp_insert_post(['post_type'=>$request['type'] ?? 'post', 'post_status'=>'publish',
        'post_name'=>$request['slug'], 'post_title'=>$request['title'] ?? 'Supported local article',
        'post_content'=>$request['content'] ?? '<p>Original confirmed facts remain unchanged.</p>', 'post_author'=>$owner->ID]);
    echo wp_json_encode(['id'=>$id, 'url'=>get_permalink($id)]);
} elseif ($request['operation'] === 'edit') {
    // This is the ordinary WordPress edit API, not the connector's SQL.
    wp_update_post(['ID'=>$request['id'], 'post_content'=>$request['content']]);
    echo wp_json_encode(['ok'=>true]);
} elseif ($request['operation'] === 'protect') {
    update_post_meta($request['id'], '_pentra_protected', 1);
    echo wp_json_encode(['ok'=>true]);
} elseif ($request['operation'] === 'lock_edit') {
    $wpdb->query('START TRANSACTION');
    // SQLite's BEGIN IMMEDIATE holds the write lock before announcing readiness.
    if (DB_ENGINE === 'mysql') { $wpdb->get_row($wpdb->prepare("SELECT ID FROM {$wpdb->posts} WHERE ID=%d FOR UPDATE", $request['id'])); }
    echo "locked\n"; flush();
    usleep(500000);
    wp_update_post(['ID'=>$request['id'], 'post_content'=>$request['content']]);
    $wpdb->query('COMMIT');
    echo wp_json_encode(['ok'=>true]);
} elseif ($request['operation'] === 'receipt_engine' && DB_ENGINE === 'mysql') {
    // Only this isolated fixture's adapter table, never customer tables.
    $engine = ($request['transactional'] ?? true) ? 'InnoDB' : 'MyISAM';
    $ok = $wpdb->query("ALTER TABLE {$wpdb->prefix}pentra_receipts ENGINE=$engine");
    echo wp_json_encode(['ok'=>$ok !== false]);
} else { exit(3); }
