// ============================================================================
// Leather Showroom — SEO Image Processor (secure team server)
//
// What changed vs. the old single-file tool:
//   - The Anthropic API key NEVER reaches the browser. It lives only in the
//     server's environment (.env). The browser asks THIS server to name an
//     image; the server calls Anthropic and returns just the suggested name.
//   - The whole tool is gated behind a shared team password. Unlocking sets a
//     signed, httpOnly session cookie — so the password isn't stored in the
//     browser bundle either.
// ============================================================================

import express from 'express';
import cookieParser from 'cookie-parser';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// --- Load .env (tiny parser so we don't need an extra dependency) ----------
function loadEnv() {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    const key = m[1];
    let val = m[2];
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
}
loadEnv();

const {
  ANTHROPIC_API_KEY,
  TEAM_PASSWORD,
  SESSION_SECRET,
  ANTHROPIC_MODEL = 'claude-sonnet-4-6',
  PORT = 3000,
} = process.env;

// --- Fail fast on misconfiguration -----------------------------------------
const missing = [];
if (!ANTHROPIC_API_KEY) missing.push('ANTHROPIC_API_KEY');
if (!TEAM_PASSWORD) missing.push('TEAM_PASSWORD');
if (!SESSION_SECRET) missing.push('SESSION_SECRET');
if (missing.length) {
  console.error(`\n[config error] Missing required env vars: ${missing.join(', ')}`);
  console.error('Copy .env.example to .env and fill it in.\n');
  process.exit(1);
}

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '25mb' })); // base64 images can be large
app.use(cookieParser(SESSION_SECRET));

// ============================================================================
// AUTH — shared password -> signed session cookie
// ============================================================================

// Token = base64(payload).hmac  where payload carries an expiry.
function signToken(ttlMs = 1000 * 60 * 60 * 12) { // 12h sessions
  const payload = Buffer.from(JSON.stringify({ exp: Date.now() + ttlMs })).toString('base64url');
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

function verifyToken(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return false;
  const [payload, sig] = token.split('.');
  const expected = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');
  // constant-time compare
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  try {
    const { exp } = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return typeof exp === 'number' && exp > Date.now();
  } catch {
    return false;
  }
}

function isAuthed(req) {
  return verifyToken(req.signedCookies?.session);
}

function requireAuth(req, res, next) {
  if (isAuthed(req)) return next();
  res.status(401).json({ error: 'Not authenticated' });
}

// Constant-time password check
function passwordMatches(input) {
  const a = Buffer.from(String(input ?? ''));
  const b = Buffer.from(TEAM_PASSWORD);
  if (a.length !== b.length) {
    // still do a compare to avoid leaking length via timing
    crypto.timingSafeEqual(b, b);
    return false;
  }
  return crypto.timingSafeEqual(a, b);
}

app.post('/api/login', (req, res) => {
  if (!passwordMatches(req.body?.password)) {
    return res.status(401).json({ ok: false, error: 'Wrong password' });
  }
  res.cookie('session', signToken(), {
    httpOnly: true,
    sameSite: 'lax',
    secure: req.secure || req.headers['x-forwarded-proto'] === 'https',
    signed: true,
    maxAge: 1000 * 60 * 60 * 12,
  });
  res.json({ ok: true });
});

app.post('/api/logout', (req, res) => {
  res.clearCookie('session');
  res.json({ ok: true });
});

app.get('/api/session', (req, res) => {
  res.json({ authed: isAuthed(req) });
});

// ============================================================================
// AI NAMING PROXY — the only place the API key is ever used
// ============================================================================

const STYLE_GUIDES = {
  ecom: 'an ecommerce-SEO filename: lowercase, hyphenated, 4-8 words, keyword-rich (color + material + product type + descriptor)',
  descriptive: 'a descriptive filename: lowercase, hyphenated, 3-6 words, describes what is visually in the image',
  minimal: 'a minimal keyword filename: lowercase, hyphenated, 2-4 words, just the core product keywords',
};

function slugify(s) {
  return String(s || '').toLowerCase().trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

app.post('/api/suggest-name', requireAuth, async (req, res) => {
  try {
    const { imageBase64, mediaType, style = 'ecom', brand = '' } = req.body || {};
    if (!imageBase64 || !mediaType) {
      return res.status(400).json({ error: 'imageBase64 and mediaType are required' });
    }
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (!allowed.includes(mediaType)) {
      return res.status(400).json({ error: `Unsupported media type: ${mediaType}` });
    }
    const styleGuide = STYLE_GUIDES[style] || STYLE_GUIDES.ecom;
    const brandName = String(brand).slice(0, 120) || 'the brand';

    const apiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: 100,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBase64 } },
            { type: 'text', text: `Look at this product image for ${brandName} (a premium leather furniture retailer). Return ONLY ${styleGuide}. No quotes, no extension, no explanation. Just the filename slug. Example output: cognac-leather-sectional-with-chaise` },
          ],
        }],
      }),
    });

    if (!apiRes.ok) {
      const detail = await apiRes.text();
      console.error('Anthropic API error', apiRes.status, detail.slice(0, 500));
      return res.status(502).json({ error: `Anthropic API returned ${apiRes.status}` });
    }

    const data = await apiRes.json();
    const text = data?.content?.[0]?.text || '';
    const name = slugify(text);
    if (!name) return res.status(502).json({ error: 'Model returned an empty name' });
    res.json({ name });
  } catch (e) {
    console.error('suggest-name failed:', e);
    res.status(500).json({ error: 'Internal error generating name' });
  }
});

// ============================================================================
// STATIC FILES — the browser tool itself
// ============================================================================
app.use(express.static(path.join(__dirname, 'public')));

app.listen(PORT, () => {
  console.log(`\n  SEO Image Processor running on http://localhost:${PORT}`);
  console.log(`  Model: ${ANTHROPIC_MODEL}  ·  Sessions: 12h  ·  Key: server-side only\n`);
});
