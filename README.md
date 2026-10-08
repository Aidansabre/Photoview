# Photoview

Minimal live photo sharing for photography workshops. Plain PHP + vanilla JS, no database.

## How it works

- **Join:** enter a session passphrase. Only passphrases listed in `passphrases.php` work (case-insensitive). Each passphrase is its own session.
- **Upload:** enter your name and pick one or more JPG/PNG photos. The browser resizes them to max 2560 px (long edge), creates a thumbnail and removes metadata (e.g. GPS) before uploading. Other file types are refused, both in the browser and on the server.
- **Live gallery:** all photos of the session appear on the same page and refresh every 3 seconds. Click **Presenter mode** on the classroom screen to hide the upload form and show bigger tiles.
- **Fullscreen:** click a photo; use arrow keys / swipe to browse, Esc to close. Right-click → "Save image as…" to download one.
- **Delete:** the × in the top-right corner of a photo deletes it permanently (anyone in the session can).
- **Auto-delete:** a session (and all its photos) is deleted when its passphrase has not been used for a login or upload for 48 hours. The check runs automatically on incoming requests; no cron job needed.

## Deploy (DirectAdmin)

1. Upload `index.html`, `app.js`, `style.css`, `api.php`, `config.php`, `passphrases.php`, `.htaccess` and `.user.ini` to a folder in `public_html` (e.g. `public_html/photos/`) via File Manager or FTP.
2. Make sure PHP 8.1+ is selected for the domain (DirectAdmin → *PHP Version Selector* / *Domain Setup*).
3. Edit `passphrases.php` and list the passphrase(s) for your workshop.
4. Open `https://your-domain/photos/`. The `data/` folder is created automatically on first use and is protected by its own `.htaccess`.

## Managing passphrases

Edit `passphrases.php` (DirectAdmin File Manager → Edit):

```php
return [
    'portrait-tuesday',
    'street-photo-oct',
];
```

- **Add a line** to open a session. It starts empty.
- **Remove or comment out a line** to close it: joining is refused and anyone still on the page is sent back to the login screen. The photos stay on the server until the normal 48h expiry deletes them; re-adding the passphrase before then brings the session back.

Use HTTPS so passphrases and photos are not sent in plain text.

Optional:
- Move storage outside the web root by changing `DATA_DIR` in `config.php` (e.g. `/home/USER/photoview-data`).
- If uploads fail with large photos, check that `upload_max_filesize` ≥ 16M and `post_max_size` ≥ 20M (set by `.user.ini`; changes can take a few minutes to apply).

## Files

| File | Purpose |
|---|---|
| `index.html`, `style.css`, `app.js` | The single page: login, upload, live gallery, lightbox |
| `api.php` | JSON API: `login`, `logout`, `list`, `upload`, `delete`, `img` |
| `config.php` | Limits: session lifetime, max file size, name length |
| `passphrases.php` | List of active session passphrases |
| `data/<session>/` | Photos (`<id>.jpg/png`), thumbnails (`<id>_t.jpg`), metadata (`<id>.json`) |

Session folders are named by an HMAC of the passphrase with a random server secret (`data/.secret`); the passphrases themselves live only in `passphrases.php`, which is blocked from web access.
