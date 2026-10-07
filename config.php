<?php
// Photoview settings. Adjust as needed.

// Where photos are stored. Keep the default (protected by data/.htaccess) or
// point it to a folder outside public_html, e.g. '/home/USER/photoview-data'.
const DATA_DIR = __DIR__ . '/data';

// Sessions whose password was not used (login or upload) for this long are deleted.
const SESSION_TTL_SECONDS = 48 * 3600;

// How often (at most) the cleanup of expired sessions runs.
const CLEANUP_INTERVAL_SECONDS = 600;

const MIN_PASSWORD_LENGTH = 4;
const MAX_NAME_LENGTH = 40;
const MAX_FILE_BYTES = 15 * 1024 * 1024;
const MAX_PHOTOS_PER_SESSION = 3000;
