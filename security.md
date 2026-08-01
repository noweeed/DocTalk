# DocTalk — Security Hardening Notes (M3–M7, L1–L3)

What was found, and how each issue was fixed, in plain words.

Current status: **96/96 backend tests passing** across 7 suites.

---

## M3 — Error messages leaking internal details

**Issue:** When something crashed on the server, the client got the raw error text (e.g. database secrets, internal query details). That leaks information an attacker can use.

**Fix:** Every `catch` block now:
- returns `{ "message": "Something went wrong" }` to the client for any 5xx (server) error, and
- logs the **full** error server-side with a tag like `[document.controller]` so developers can still debug.

The global error handler (`error.middleware.js`) keeps intentional 4xx messages (like "Invalid credentials") but genericizes everything 5xx. Tests verify the word `secret` never appears in any 500 response body.

---

## M4 — Forged PDF / image uploads

**Issue:** Upload validation only trusted the `Content-Type` header the client sent. An attacker could upload a `.html` file or a script and label it `application/pdf` (or `image/png`), and it would be accepted.

**Fix:** Added real **magic-byte checks** in `fileValidation.js`:
- a PDF must start with `%PDF-`,
- an image must start with PNG (`89 50 4E 47`), JPEG (`FF D8 FF`), or WebP magic bytes. Everything else — including SVG — is rejected with `400 Invalid PDF file` / `400 Invalid image file`, no matter what the client claims the type is.

Also added a **30-second timeout** around the PDF text parser so a malicious/broken PDF can't hang the server forever. The mimetype check in multer stays as a first line of defense; avatars are capped at 2MB, documents at 20MB.

---

## M5 — Missing security headers (helmet + CSP)

**Issue:** The server sent no security headers (`X-Content-Type-Options`, `X-Frame-Options`, HSTS, `Content-Security-Policy`...). Browsers are more permissive without them, making clickjacking / MIME-sniffing / XSS easier.

**Fix (backend — done):** Added **helmet** (`helmet: ^8.3.0`) right after CORS in `server.js`, with a strict CSP (`default-src 'none'`, `connect-src 'self'`). Verified with a new `security.test.js` that headers appear on health, document, and error responses, and that the PDF streaming / SSE / Stripe webhook routes still work.

**Status (frontend — still to do):** The `frontend/index.html` `<meta>` CSP tag is **not added yet**. It needs the Google Fonts allowlist (`fonts.googleapis.com`, `fonts.gstatic.com`) and care so Vite's dev-mode inline script doesn't break. This is the one open item.

---

## M6 — Rate limiting broken behind a reverse proxy

**Issue:** The app sits behind a proxy/load balancer, so every request showed the proxy's IP address. That meant the IP-based rate limiter saw one single IP for everyone — useless for blocking brute-force login attempts.

**Fix:**
- `server.js` now sets `app.set("trust proxy", 1)` — trust exactly one proxy hop so `req.ip` is the real client.
- The login/signup limiter (`authLimiter`) now keys on **client IP + attempted email**, so many users sharing one IP aren't blocked because one person hammered a different account. Used the library's `ipKeyGenerator` helper so IPv6 handling stays correct.

Added `tests/rate-limit.test.js` to confirm the setting is active and proxied requests still work in tests.

---

## M7 — Stripe webhook "success" on failure

**Issue:** If a Stripe webhook handler crashed (e.g. database hiccup), the endpoint still replied `200 OK`. Stripe then assumes the event was handled and **never retries**, silently losing subscription/plan updates.

**Fix:** `handleWebhook` in `billing.controller.js` now replies:
- `200 { received: true }` when everything is handled — including the expected "no user found" cases (those are logged as warnings, not errors), and
- `500` when a handler unexpectedly throws, so **Stripe retries**.

Signature verification is untouched. Added a test that forces a handler to throw and confirms the `500`.

---

## L1 — Avatar SVG / weak MIME validation

**Status:** Already fixed by M4. SVG and any non-PNG/JPEG/WebP bytes are rejected via magic bytes (test at `auth.test.js`), and the avatar upload is capped at 2MB. No further change needed.

---

## L2 — Unsafe filename in the download header

**Issue:** The PDF download response set `Content-Disposition: inline; filename="${document.title}"` using the client-supplied filename directly. A filename containing `"`, `\`, or newline characters could break out of the header's quoted-string form (header injection / malformed responses).

**Fix:** Added `buildContentDisposition()` in `document.controller.js`:
- an **ASCII-safe fallback** (`filename="..."`) that strips `"`, `\`, control chars, and non-ASCII, and
- an **RFC 5987** `filename*=UTF-8''...` with the real name percent-encoded, so browsers still show the correct name.

Test: renames a document to `my"doc.pdf` and asserts the header comes back well-formed (`filename="my_doc.pdf"; filename*=UTF-8''my%22doc.pdf`).

---

## L3 — Server logs could leak credentials

**Issue:** On a DB connection failure, `config/db.js` logged the raw `error.message`, which can include the connection string (with username/password). `email.service.js` logged the whole Nodemailer error object. These go to server logs, not the client, but a leaked Mongo URI/email password in logs is still a risk.

**Fix:**
- `db.js`: logs a fixed `"MongoDB connection failed"` plus only safe fields (`error.name`, `error.code`). The full detail is only logged when not in production.
- `email.service.js`: new `logEmailError()` helper — in production logs only `{ name, code }`; outside production logs the full object.
- `error.middleware.js`: **unchanged** — it keeps logging `err.stack` server-side, which is normal and expected for debugging (it's not the client response, so it isn't the same leak as M3).

---

## Test count history

| Milestone | Tests |
|---|---|
| Before M3 | 68 |
| After M3 | 83 |
| After M4 | 88 |
| After M5 (backend) | 91 |
| After M6 + M7 + L2 | 96 |
