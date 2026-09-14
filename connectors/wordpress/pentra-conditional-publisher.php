<?php
/**
 * Plugin Name: Pentra Conditional Publisher
 * Description: Authenticated, revision-bound publishing of explicitly selected classic posts/pages.
 * Version: 1.1.0
 * Requires PHP: 8.1
 * License: GPL-2.0-or-later
 */
if (!defined('ABSPATH')) { exit; }

final class Pentra_Conditional_Publisher {
    const NS = 'pentra/v1';
    static function table() { global $wpdb; return $wpdb->prefix . 'pentra_receipts'; }
    static function permissions() { global $wpdb; return $wpdb->prefix . 'pentra_permissions'; }
    static function sql($sql) {
        global $wpdb;
        $result = $wpdb->query($sql);
        if ($result === false) { throw new RuntimeException('database_operation_failed'); }
        return $result;
    }
    static function install() {
        global $wpdb;
        $charset = $wpdb->get_charset_collate();
        self::sql('CREATE TABLE IF NOT EXISTS ' . self::table() . " (
            request_key varchar(64) NOT NULL, request_hash varchar(64) NOT NULL,
            owner_id bigint(20) NOT NULL, binding varchar(64) NOT NULL,
            post_id bigint(20) NOT NULL, receipt longtext NOT NULL,
            PRIMARY KEY (request_key)
        ) ENGINE=InnoDB $charset");
        self::sql('CREATE TABLE IF NOT EXISTS ' . self::permissions() . " (
            post_id bigint(20) NOT NULL, owner_id bigint(20) NOT NULL,
            binding varchar(64) NOT NULL, permission varchar(64) NOT NULL,
            active tinyint NOT NULL, metadata longtext NOT NULL,
            PRIMARY KEY (post_id)
        ) ENGINE=InnoDB $charset");
        self::assert_engine();
    }
    static function assert_engine() {
        global $wpdb;
        if (defined('DB_ENGINE') && DB_ENGINE === 'sqlite') {
            // Only the modern WordPress.org driver implements explicit write
            // transactions using BEGIN IMMEDIATE, including wpdb operations.
            if (!class_exists('WP_SQLite_Driver')) { throw new RuntimeException('unsupported_database_driver'); }
            return;
        }
        foreach ([$wpdb->posts, $wpdb->postmeta, $wpdb->options, self::table(), self::permissions()] as $table) {
            $engine = $wpdb->get_var($wpdb->prepare(
                'SELECT ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = %s', $table));
            if (strtolower((string)$engine) !== 'innodb') { throw new RuntimeException('transactional_tables_required'); }
        }
    }
    static function auth() {
        // Core authenticates cookies/nonces and application passwords. Never
        // implement a second secret or a logged-in-only permission shortcut.
        return is_user_logged_in() && (current_user_can('edit_posts') || current_user_can('edit_pages'))
            ? true : new WP_Error('pentra_forbidden', 'Publishing capability required.', ['status' => 403]);
    }
    static function routes() {
        foreach (['connection' => 'GET', 'source' => 'GET', 'receipt' => 'GET', 'select' => 'POST', 'revoke' => 'POST', 'write' => 'POST'] as $name => $method) {
            register_rest_route(self::NS, '/' . $name, [
                'methods' => $method, 'permission_callback' => [__CLASS__, 'auth'],
                'callback' => function($request) use ($name) {
                    try { return new WP_REST_Response(self::dispatch($name, $request), 200, $name === 'receipt' ? ['Cache-Control'=>'private, no-store'] : []); }
                    catch (Throwable $e) {
                        // Never echo SQL, credentials, request bodies or stack traces.
                        $safe = ['binding_changed', 'source_changed', 'permission_revoked', 'idempotency_conflict',
                            'unsupported_content', 'protected_content', 'invalid_request', 'post_forbidden',
                            'no_change', 'rollback_conflict', 'transactional_tables_required', 'unsupported_database_driver', 'receipt_unavailable'];
                        $code = in_array($e->getMessage(), $safe, true) ? $e->getMessage() : 'database_operation_failed';
                        return new WP_Error('pentra_' . $code, $code, ['status' => $code === 'post_forbidden' ? 403 : ($code === 'receipt_unavailable' ? 404 : 409)]);
                    }
                },
            ]);
        }
    }
    static function hex($value) {
        if (!is_string($value) || !preg_match('/^[a-f0-9]{64}$/D', $value)) { throw new RuntimeException('invalid_request'); }
        return $value;
    }
    static function post($id, $lock = false) {
        global $wpdb;
        $suffix = $lock && !(defined('DB_ENGINE') && DB_ENGINE === 'sqlite') ? ' FOR UPDATE' : '';
        $row = $wpdb->get_row($wpdb->prepare("SELECT * FROM {$wpdb->posts} WHERE ID = %d" . $suffix, $id), ARRAY_A);
        if (!$row || !in_array($row['post_type'], ['post', 'page'], true) || !current_user_can('edit_post', $id) ||
            !current_user_can($row['post_type'] === 'page' ? 'publish_pages' : 'publish_posts')) {
            throw new RuntimeException('post_forbidden');
        }
        return $row;
    }
    static function supported($row) {
        $path = strtolower($row['post_name']);
        if (preg_match('/(?:^|[-_])(pricing|checkout|cart|legal|privacy|terms|refund|billing)(?:$|[-_])/', $path) ||
            get_post_meta((int)$row['ID'], '_pentra_protected', true) ||
            in_array((int)$row['ID'], array_filter(array_map('intval', [get_option('wp_page_for_privacy_policy'),
                get_option('woocommerce_checkout_page_id'), get_option('woocommerce_cart_page_id'),
                get_option('woocommerce_terms_page_id')])), true)) { throw new RuntimeException('protected_content'); }
        $template = get_post_meta((int)$row['ID'], '_wp_page_template', true);
        if ($row['post_status'] !== 'publish' || $row['post_password'] !== '' || ($template && $template !== 'default')) {
            throw new RuntimeException('unsupported_content');
        }
        self::html($row['post_content']);
    }
    static function html($html) {
        // Classic semantic HTML only. Gutenberg/custom blocks, shortcodes,
        // scripts, media and layouts are rejected, not silently rewritten.
        if (!is_string($html) || strlen($html) > 350000 || preg_match('/<!--|\[[a-zA-Z_][^\]]*\]|<\?|\x00/', $html)) {
            throw new RuntimeException('unsupported_content');
        }
        $allowed = ['p'=>[], 'h2'=>[], 'h3'=>[], 'h4'=>[], 'h5'=>[], 'h6'=>[], 'hr'=>[], 'ul'=>[], 'ol'=>[], 'li'=>[],
            'strong'=>[], 'em'=>[], 'blockquote'=>[], 'code'=>[], 'pre'=>[], 'br'=>[],
            'a'=>['href'=>true, 'rel'=>true, 'title'=>true], 'table'=>[], 'thead'=>[], 'tbody'=>[], 'tr'=>[], 'th'=>['align'=>true], 'td'=>['align'=>true]];
        if (wp_kses($html, $allowed, ['https', 'http']) !== $html) { throw new RuntimeException('unsupported_content'); }
    }
    static function revision($row) {
        // Include every core source field, including visibility/template-affecting
        // fields. Normalize DB scalar types across MySQL and SQLite drivers.
        ksort($row);
        return hash('sha256', wp_json_encode(array_map('strval', $row), JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE));
    }
    static function permission($id, $lock = false) {
        global $wpdb;
        $suffix = $lock && !(defined('DB_ENGINE') && DB_ENGINE === 'sqlite') ? ' FOR UPDATE' : '';
        return $wpdb->get_row($wpdb->prepare('SELECT * FROM ' . self::permissions() . ' WHERE post_id = %d' . $suffix, $id), ARRAY_A);
    }
    static function require_permission($p, $binding, $permission, $allow_inactive = false) {
        if (!$p || (!$allow_inactive && !(int)$p['active']) || (int)$p['owner_id'] !== get_current_user_id() ||
            !hash_equals($p['binding'], $binding) || !hash_equals($p['permission'], $permission)) {
            throw new RuntimeException('permission_revoked');
        }
    }
    static function source($row, $p = null) {
        return ['id'=>(int)$row['ID'], 'type'=>$row['post_type'], 'title'=>$row['post_title'],
            'content'=>$row['post_content'], 'renderedContent'=>apply_filters('the_content', $row['post_content']),
            'slug'=>$row['post_name'], 'revision'=>self::revision($row),
            'url'=>get_permalink((int)$row['ID']), 'permission'=>$p ? $p['permission'] : null,
            'metadata'=>$p ? json_decode($p['metadata'], true) : null];
    }
    static function dispatch($name, $r) {
        global $wpdb;
        self::assert_engine();
        $origin = untrailingslashit(home_url());
        if ($name === 'connection') { return ['version'=>1, 'atomic'=>true, 'receiptLookup'=>1, 'site'=>$origin, 'userId'=>get_current_user_id()]; }
        if ($r['site'] !== $origin) { throw new RuntimeException('binding_changed'); }
        $binding = self::hex($r['binding']);
        if ($name === 'write') { return self::write($r, $binding); }
        if ($name === 'receipt') { return self::receipt($r, $binding); }
        $id = filter_var($r['id'], FILTER_VALIDATE_INT, ['options'=>['min_range'=>1]]);
        if (!$id) { throw new RuntimeException('invalid_request'); }
        $row = self::post($id); if ($name !== 'revoke') { self::supported($row); }
        if ($name === 'source') { return self::source($row); }
        self::sql('START TRANSACTION');
        try {
            $row = self::post($id, true); if ($name !== 'revoke') { self::supported($row); }
            $p = self::permission($id, true);
            if ($name === 'select') {
                if ($r['revision'] !== self::revision($row) || $r['confirm'] !== true) { throw new RuntimeException('source_changed'); }
                if ($p && (int)$p['active'] && ($p['binding'] !== $binding || (int)$p['owner_id'] !== get_current_user_id())) {
                    throw new RuntimeException('binding_changed');
                }
                // Selecting again changes the grant even if bytes are unchanged.
                $token = hash('sha256', wp_generate_uuid4());
                $metadata = $p ? $p['metadata'] : '{}';
                self::sql($wpdb->prepare('REPLACE INTO ' . self::permissions() .
                    ' (post_id,owner_id,binding,permission,active,metadata) VALUES (%d,%d,%s,%s,1,%s)',
                    $id, get_current_user_id(), $binding, $token, $metadata));
            } else {
                self::require_permission($p, $binding, self::hex($r['permission']), true);
                self::sql($wpdb->prepare('UPDATE ' . self::permissions() . ' SET active=0 WHERE post_id=%d', $id));
            }
            $result = self::source($row, self::permission($id));
            self::sql('COMMIT'); return $result;
        } catch (Throwable $e) { $wpdb->query('ROLLBACK'); throw $e; }
    }
    static function receipt($r, $binding) {
        global $wpdb;
        $key = self::hex($r['key']); $hash = self::hex($r['requestHash']);
        // One indexed owner-scoped lookup. Missing and foreign/conflicting
        // keys have the same response; never enumerate receipts.
        self::sql('START TRANSACTION');
        try {
            $prior = $wpdb->get_row($wpdb->prepare('SELECT * FROM ' . self::table() .
                ' WHERE request_key=%s AND request_hash=%s AND owner_id=%d AND binding=%s LIMIT 1',
                $key, $hash, get_current_user_id(), $binding), ARRAY_A);
            if (!$prior || strlen($prior['receipt']) > 4000000) { throw new RuntimeException('receipt_unavailable'); }
            $receipt = json_decode($prior['receipt'], true); $id = (int)$prior['post_id'];
            if (!$receipt || $id < 1 || ($receipt['key'] ?? '') !== $key || ($receipt['requestHash'] ?? '') !== $hash ||
                ($receipt['binding'] ?? '') !== $binding || (int)($receipt['id'] ?? 0) !== $id) { throw new RuntimeException('receipt_unavailable'); }
            $row = self::post($id, true); self::supported($row);
            if (($r['id'] !== null && (string)$r['id'] !== (string)$id) ||
                ($r['id'] === null && ($r['type'] !== $row['post_type'] || $r['slug'] !== $row['post_name']))) { throw new RuntimeException('receipt_unavailable'); }
            $p = self::permission($id, true);
            // Revocation forbids future writes, not proof of this user's prior
            // delivery. Reselection/ownership/binding still fence this lookup.
            self::require_permission($p, $binding, self::hex($receipt['permission'] ?? null), true);
            if (self::revision($row) !== ($receipt['revision'] ?? '') || $row['post_content'] !== ($receipt['content'] ?? null) ||
                $row['post_title'] !== ($receipt['title'] ?? null) || get_permalink($id) !== ($receipt['url'] ?? null) ||
                json_decode($p['metadata'], true) !== ($receipt['metadata'] ?? null)) { throw new RuntimeException('source_changed'); }
            $result = array_intersect_key($receipt, array_flip(['key','requestHash','binding','id','permission','url','revision','content','title','metadata','writtenAt']));
            $result['permissionActive'] = (bool)$p['active']; $result['type'] = $row['post_type']; $result['slug'] = $row['post_name'];
            self::sql('COMMIT'); return $result;
        } catch (Throwable $e) { $wpdb->query('ROLLBACK'); throw $e; }
    }
    static function write($r, $binding) {
        global $wpdb;
        $body = $r->get_json_params();
        $key = self::hex($body['key'] ?? null);
        // Exact payload bytes bind every field; the client persists and reuses
        // the same serialized request on retry rather than inventing a new key.
        $hash = hash('sha256', $r->get_body());
        $operation = $body['operation'] ?? '';
        if (!in_array($operation, ['create','append','replace','rollback'], true)) { throw new RuntimeException('invalid_request'); }
        self::sql('START TRANSACTION');
        try {
            $prior = $wpdb->get_row($wpdb->prepare('SELECT * FROM ' . self::table() . ' WHERE request_key=%s', $key), ARRAY_A);
            if ($prior) {
                if ($prior['request_hash'] !== $hash || $prior['binding'] !== $binding || (int)$prior['owner_id'] !== get_current_user_id()) {
                    throw new RuntimeException('idempotency_conflict');
                }
                $receipt = json_decode($prior['receipt'], true);
                $row = self::post((int)$prior['post_id'], true); self::supported($row);
                $p = self::permission((int)$prior['post_id'], true);
                self::require_permission($p, $binding, $receipt['permission']);
                if (self::revision($row) !== $receipt['revision']) { throw new RuntimeException('source_changed'); }
                self::sql('COMMIT'); return $receipt;
            }
            // The unique claim and mutation share one transaction. A duplicate
            // concurrent request blocks/fails here before changing any post.
            self::sql($wpdb->prepare('INSERT INTO ' . self::table() .
                ' (request_key,request_hash,owner_id,binding,post_id,receipt) VALUES (%s,%s,%d,%s,0,%s)',
                $key, $hash, get_current_user_id(), $binding, '{}'));
            $base = null; $old_meta = '{}';
            if ($operation === 'create') {
                $type = $body['type'] ?? '';
                if (!in_array($type, ['post','page'], true) || !current_user_can($type === 'page' ? 'publish_pages' : 'publish_posts')) {
                    throw new RuntimeException('post_forbidden');
                }
                $slug = $body['slug'] ?? '';
                if (!preg_match('/^[a-z0-9]+(?:-[a-z0-9]+)*$/D', $slug)) { throw new RuntimeException('invalid_request'); }
                if ($wpdb->get_var($wpdb->prepare("SELECT ID FROM {$wpdb->posts} WHERE post_name=%s AND post_type=%s LIMIT 1", $slug, $type))) {
                    throw new RuntimeException('source_changed');
                }
                self::html($body['content'] ?? null);
                if (!is_string($body['title'] ?? null) || wp_strip_all_tags($body['title']) !== $body['title']) { throw new RuntimeException('invalid_request'); }
                $id = wp_insert_post(wp_slash(['post_type'=>$type, 'post_status'=>'publish', 'post_name'=>$slug,
                    'post_title'=>$body['title'], 'post_content'=>$body['content'], 'post_author'=>get_current_user_id()]), true, false);
                if (is_wp_error($id)) { throw new RuntimeException('database_operation_failed'); }
                $row = self::post($id, true); self::supported($row);
                if ($row['post_name'] !== $slug || $row['post_content'] !== $body['content'] || $row['post_title'] !== $body['title']) {
                    throw new RuntimeException('source_changed');
                }
                $permission = hash('sha256', wp_generate_uuid4());
                self::sql($wpdb->prepare('INSERT INTO ' . self::permissions() .
                    ' (post_id,owner_id,binding,permission,active,metadata) VALUES (%d,%d,%s,%s,1,%s)',
                    $id, get_current_user_id(), $binding, $permission, '{}'));
            } else {
                $id = filter_var($body['id'] ?? null, FILTER_VALIDATE_INT, ['options'=>['min_range'=>1]]);
                if (!$id) { throw new RuntimeException('invalid_request'); }
                $base = self::post($id, true); self::supported($base);
                $p = self::permission($id, true);
                $permission = self::hex($body['permission'] ?? null);
                self::require_permission($p, $binding, $permission);
                if (self::hex($body['baseRevision'] ?? null) !== self::revision($base)) { throw new RuntimeException('source_changed'); }
                $old_meta = $p['metadata'];
                if ($operation === 'rollback') {
                    $previous = $wpdb->get_row($wpdb->prepare('SELECT * FROM ' . self::table() . ' WHERE request_key=%s', self::hex($body['rollbackKey'] ?? null)), ARRAY_A);
                    if (!$previous || $previous['binding'] !== $binding || (int)$previous['owner_id'] !== get_current_user_id() || (int)$previous['post_id'] !== $id) { throw new RuntimeException('rollback_conflict'); }
                    $restore = json_decode($previous['receipt'], true);
                    if (!$restore['base'] || $restore['revision'] !== self::revision($base)) { throw new RuntimeException('rollback_conflict'); }
                    $content = $restore['base']['post_content'];
                    $metadata = json_decode($restore['baseMetadata'], true);
                } else {
                    $content = $body['content'] ?? null; self::html($content);
                    if ($operation === 'replace') {
                        $before = $body['before'] ?? null; $after = $body['after'] ?? null;
                        if (!is_string($before) || !is_string($after) || $before === '' || $before === $after || strlen($before) > 20000 || strlen($after) > 24000 ||
                            substr_count($base['post_content'], $before) !== 1 || str_replace($before, $after, $base['post_content']) !== $content) {
                            throw new RuntimeException('targeted_edit_mismatch');
                        }
                    } elseif (!str_starts_with($content, $base['post_content']) || strlen(trim(substr($content, strlen($base['post_content'])))) < 40) { throw new RuntimeException('no_change'); }
                    // Exact owner corrections may retain the original metadata,
                    // including its deliberate absence, instead of inventing it.
                    $metadata = $body['metadata'] ?? json_decode($old_meta, true);
                }
                // Row lock plus binary field predicate: core editor writes use
                // this same wp_posts row, not a plugin-only advisory lock.
                $changed = self::sql($wpdb->prepare("UPDATE {$wpdb->posts} SET post_content=%s, post_modified=%s, post_modified_gmt=%s
                    WHERE ID=%d AND HEX(post_content)=HEX(%s) AND HEX(post_title)=HEX(%s) AND HEX(post_name)=HEX(%s) AND post_status='publish'
                    AND NOT EXISTS (SELECT 1 FROM {$wpdb->postmeta} pm WHERE pm.post_id={$wpdb->posts}.ID
                        AND ((pm.meta_key='_pentra_protected' AND pm.meta_value NOT IN ('','0'))
                          OR (pm.meta_key='_wp_page_template' AND pm.meta_value NOT IN ('','default'))))
                    AND NOT EXISTS (SELECT 1 FROM {$wpdb->options} opt WHERE opt.option_name IN
                        ('wp_page_for_privacy_policy','woocommerce_checkout_page_id','woocommerce_cart_page_id','woocommerce_terms_page_id')
                        AND opt.option_value=CAST({$wpdb->posts}.ID AS CHAR))",
                    $content, current_time('mysql'), current_time('mysql', true), $id, $base['post_content'], $base['post_title'], $base['post_name']));
                if ($changed !== 1) { throw new RuntimeException('source_changed'); }
            }
            $row = self::post($id, true);
            if ($operation === 'create') { $metadata = $body['metadata'] ?? []; }
            if (!is_array($metadata)) { throw new RuntimeException('invalid_request'); }
            $canonical = $metadata['canonical'] ?? '';
            $url = get_permalink($id);
            if (!(($operation === 'rollback' || ($operation === 'replace' && !array_key_exists('metadata', $body))) && $metadata === []) && ($canonical !== $url || !is_string($metadata['description'] ?? null) ||
                !is_string($metadata['title'] ?? null) || strlen($metadata['description']) > 400 ||
                strlen($metadata['title']) > 200 || wp_strip_all_tags($metadata['description']) !== $metadata['description'] ||
                wp_strip_all_tags($metadata['title']) !== $metadata['title'])) { throw new RuntimeException('binding_changed'); }
            if ($metadata !== []) { $metadata['sourceRevision'] = self::revision($row); }
            self::sql($wpdb->prepare('UPDATE ' . self::permissions() . ' SET metadata=%s WHERE post_id=%d', wp_json_encode($metadata), $id));
            $receipt = ['key'=>$key, 'requestHash'=>$hash, 'binding'=>$binding, 'id'=>$id, 'permission'=>$permission,
                'url'=>$url, 'revision'=>self::revision($row), 'content'=>$row['post_content'], 'title'=>$row['post_title'],
                'base'=>$base, 'baseMetadata'=>$old_meta, 'metadata'=>$metadata, 'writtenAt'=>gmdate('c')];
            self::sql($wpdb->prepare('UPDATE ' . self::table() . ' SET post_id=%d,receipt=%s WHERE request_key=%s', $id, wp_json_encode($receipt), $key));
            self::sql('COMMIT');
            clean_post_cache($id);
            return $receipt;
        } catch (Throwable $e) { $wpdb->query('ROLLBACK'); throw $e; }
    }
    static function metadata() {
        global $wpdb;
        if (!is_singular(['post','page'])) { return null; }
        $p = self::permission(get_queried_object_id());
        $meta = $p ? json_decode($p['metadata'], true) : null;
        $row = $meta ? $wpdb->get_row($wpdb->prepare("SELECT * FROM {$wpdb->posts} WHERE ID=%d", get_queried_object_id()), ARRAY_A) : null;
        return $row && ($meta['sourceRevision'] ?? '') === self::revision($row) && ($meta['canonical'] ?? '') === get_permalink((int)$row['ID']) ? $meta : null;
    }
    static function head() {
        $meta = self::metadata(); if (!$meta || empty($meta['canonical'])) { return; }
        // Core canonical is removed only for the exact selected/owned page.
        remove_action('wp_head', 'rel_canonical');
        echo '<link rel="canonical" href="' . esc_url($meta['canonical']) . '" />' . "\n";
        echo '<meta name="description" content="' . esc_attr($meta['description']) . '" />' . "\n";
    }
}
register_activation_hook(__FILE__, ['Pentra_Conditional_Publisher', 'install']);
add_action('rest_api_init', ['Pentra_Conditional_Publisher', 'routes']);
add_action('wp_head', ['Pentra_Conditional_Publisher', 'head'], 1);
add_filter('pre_get_document_title', function($title) {
    $meta = Pentra_Conditional_Publisher::metadata(); return $meta['title'] ?? $title;
});
