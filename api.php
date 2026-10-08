<?php
// Photoview API: login | logout | list | upload | delete | img
// Storage: DATA_DIR/<session-id>/<photo-id>.{jpg|png}, <photo-id>_t.jpg, <photo-id>.json

declare(strict_types=1);
require __DIR__ . '/config.php';

const COOKIE = 'pv_sid';
const ID_RE = '/^[0-9]{13}-[0-9a-f]{8}$/';
const SID_RE = '/^[0-9a-f]{64}$/';

function fail(int $code, string $msg): never {
    http_response_code($code);
    header('Content-Type: application/json');
    echo json_encode(['error' => $msg]);
    exit;
}

function ok(array $data = []): never {
    header('Content-Type: application/json');
    header('Cache-Control: no-store');
    echo json_encode($data);
    exit;
}

function ensure_data_dir(): void {
    if (!is_dir(DATA_DIR) && !mkdir(DATA_DIR, 0750, true)) {
        fail(500, 'Cannot create data directory');
    }
    $ht = DATA_DIR . '/.htaccess';
    if (!file_exists($ht)) {
        file_put_contents($ht, "Require all denied\nDeny from all\n<IfModule mod_php.c>\nphp_flag engine off\n</IfModule>\n");
    }
}

function secret(): string {
    $f = DATA_DIR . '/.secret';
    if (!file_exists($f)) {
        file_put_contents($f, bin2hex(random_bytes(32)), LOCK_EX);
    }
    return trim((string)file_get_contents($f));
}

function rrmdir(string $dir): void {
    foreach (array_diff(scandir($dir) ?: [], ['.', '..']) as $f) {
        is_dir("$dir/$f") ? rrmdir("$dir/$f") : unlink("$dir/$f");
    }
    rmdir($dir);
}

// Delete sessions not used for SESSION_TTL_SECONDS. Throttled, runs on any request.
function cleanup(): void {
    $stamp = DATA_DIR . '/.last_cleanup';
    if (file_exists($stamp) && time() - filemtime($stamp) < CLEANUP_INTERVAL_SECONDS) return;
    touch($stamp);
    foreach (glob(DATA_DIR . '/*', GLOB_ONLYDIR) ?: [] as $dir) {
        if (!preg_match(SID_RE, basename($dir))) continue;
        $used = @filemtime($dir . '/.last_used') ?: filemtime($dir);
        if (time() - $used > SESSION_TTL_SECONDS) rrmdir($dir);
    }
}

function normalize_passphrase(string $p): string {
    return mb_strtolower(trim($p));
}

// Session ids (folder names) of the passphrases currently listed in passphrases.php.
function active_sids(): array {
    $list = require __DIR__ . '/passphrases.php';
    $sids = [];
    foreach (is_array($list) ? $list : [] as $p) {
        $p = normalize_passphrase((string)$p);
        if ($p !== '') $sids[hash_hmac('sha256', $p, secret())] = true;
    }
    return $sids;
}

function session_dir(): string {
    $sid = $_COOKIE[COOKIE] ?? '';
    if (!preg_match(SID_RE, $sid) || !isset(active_sids()[$sid]) || !is_dir(DATA_DIR . '/' . $sid)) {
        fail(401, 'Not logged in or session expired');
    }
    return DATA_DIR . '/' . $sid;
}

function mark_used(string $dir): void {
    touch($dir . '/.last_used');
}

function require_post(): void {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') fail(405, 'POST required');
}

function photo_id(): string {
    return sprintf('%013d', (int)(microtime(true) * 1000)) . '-' . bin2hex(random_bytes(4));
}

function list_photos(string $dir): array {
    $out = [];
    foreach (glob($dir . '/*.json') ?: [] as $f) {
        $m = json_decode((string)@file_get_contents($f), true);
        if (is_array($m)) $out[] = ['id' => $m['id'], 'name' => $m['name'], 'ts' => $m['ts']];
    }
    usort($out, fn($a, $b) => strcmp($b['id'], $a['id'])); // newest first
    return $out;
}

// Returns 'jpg' or 'png' if the uploaded file really is such an image, else null.
function image_ext(array $file): ?string {
    if (($file['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) return null;
    if ($file['size'] > MAX_FILE_BYTES) return null;
    $info = @getimagesize($file['tmp_name']);
    if (!$info) return null;
    return match ($info[2]) { IMAGETYPE_JPEG => 'jpg', IMAGETYPE_PNG => 'png', default => null };
}

ensure_data_dir();
cleanup();

$action = $_GET['action'] ?? '';

switch ($action) {
    case 'login':
        require_post();
        $pw = normalize_passphrase((string)($_POST['passphrase'] ?? ''));
        $sid = hash_hmac('sha256', $pw, secret());
        if ($pw === '' || !isset(active_sids()[$sid])) fail(403, 'Unknown passphrase');
        $dir = DATA_DIR . '/' . $sid;
        $created = !is_dir($dir);
        if ($created && !mkdir($dir, 0750)) fail(500, 'Cannot create session');
        mark_used($dir);
        setcookie(COOKIE, $sid, [
            'expires' => time() + SESSION_TTL_SECONDS,
            'path' => '/',
            'secure' => !empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off',
            'httponly' => true,
            'samesite' => 'Lax',
        ]);
        ok(['created' => $created]);

    case 'logout':
        require_post();
        setcookie(COOKIE, '', ['expires' => 1, 'path' => '/', 'httponly' => true, 'samesite' => 'Lax']);
        ok();

    case 'list':
        ok(['photos' => list_photos(session_dir())]);

    case 'upload':
        require_post();
        $dir = session_dir();
        $name = trim(preg_replace('/\s+/u', ' ', (string)($_POST['name'] ?? '')));
        if ($name === '') fail(400, 'Name is required');
        $name = mb_substr($name, 0, MAX_NAME_LENGTH);
        if (count(glob($dir . '/*.json') ?: []) >= MAX_PHOTOS_PER_SESSION) {
            fail(400, 'This session is full');
        }
        $ext = image_ext($_FILES['photo'] ?? []);
        if ($ext === null) fail(400, 'Only JPG and PNG images are allowed');
        if (image_ext($_FILES['thumb'] ?? []) === null) fail(400, 'Invalid thumbnail');

        $id = photo_id();
        if (!move_uploaded_file($_FILES['photo']['tmp_name'], "$dir/$id.$ext")
            || !move_uploaded_file($_FILES['thumb']['tmp_name'], "$dir/{$id}_t.jpg")) {
            fail(500, 'Could not store photo');
        }
        $meta = ['id' => $id, 'name' => $name, 'ts' => time(), 'ext' => $ext];
        // Metadata written last: a photo only appears in the list once complete.
        file_put_contents("$dir/$id.json", json_encode($meta), LOCK_EX);
        mark_used($dir);
        ok(['photo' => ['id' => $id, 'name' => $name, 'ts' => $meta['ts']]]);

    case 'delete':
        require_post();
        $dir = session_dir();
        $id = (string)($_POST['id'] ?? '');
        if (!preg_match(ID_RE, $id)) fail(400, 'Invalid id');
        @unlink("$dir/$id.json");
        foreach (["$id.jpg", "$id.png", "{$id}_t.jpg"] as $f) @unlink("$dir/$f");
        ok();

    case 'img':
        $dir = session_dir();
        $id = (string)($_GET['id'] ?? '');
        if (!preg_match(ID_RE, $id)) fail(400, 'Invalid id');
        $meta = json_decode((string)@file_get_contents("$dir/$id.json"), true);
        if (!is_array($meta)) fail(404, 'Not found');
        $thumb = ($_GET['s'] ?? '') === 't';
        $ext = $thumb ? 'jpg' : $meta['ext'];
        $path = $thumb ? "$dir/{$id}_t.jpg" : "$dir/$id.$ext";
        if (!is_file($path)) fail(404, 'Not found');
        $safeName = preg_replace('/[^A-Za-z0-9_-]+/', '_', $meta['name']) ?: 'photo';
        header('Content-Type: ' . ($ext === 'png' ? 'image/png' : 'image/jpeg'));
        header('Content-Length: ' . filesize($path));
        header('Content-Disposition: inline; filename="' . $safeName . '-' . $id . '.' . $ext . '"');
        header('Cache-Control: private, max-age=172800, immutable');
        header('X-Content-Type-Options: nosniff');
        readfile($path);
        exit;

    default:
        fail(400, 'Unknown action');
}
