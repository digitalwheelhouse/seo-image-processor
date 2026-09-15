// ============================================================================
// Digital Wheelhouse — Internal SEO Image Processor (multi-client studio)
//
//   - The Anthropic API key NEVER reaches the browser (server-side only).
//   - Gated behind a shared team password (signed httpOnly session cookie).
//   - Stores CLIENT PROFILES on the server so the whole team shares one list.
//     Each profile holds a client's Ownership/SEO metadata + per-image content.
//     Profiles live in a JSON file under DATA_DIR — on Render, point DATA_DIR
//     at a mounted persistent disk so they survive redeploys.
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
  DATA_DIR,
} = process.env;

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
app.use(express.json({ limit: '25mb' }));
app.use(cookieParser(SESSION_SECRET));

// ============================================================================
// AUTH — shared password -> signed session cookie
// ============================================================================
function signToken(ttlMs = 1000 * 60 * 60 * 12) {
  const payload = Buffer.from(JSON.stringify({ exp: Date.now() + ttlMs })).toString('base64url');
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}
function verifyToken(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return false;
  const [payload, sig] = token.split('.');
  const expected = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');
  const a = Buffer.from(sig), b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  try {
    const { exp } = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return typeof exp === 'number' && exp > Date.now();
  } catch { return false; }
}
function isAuthed(req) { return verifyToken(req.signedCookies?.session); }
function requireAuth(req, res, next) {
  if (isAuthed(req)) return next();
  res.status(401).json({ error: 'Not authenticated' });
}
function passwordMatches(input) {
  const a = Buffer.from(String(input ?? ''));
  const b = Buffer.from(TEAM_PASSWORD);
  if (a.length !== b.length) { crypto.timingSafeEqual(b, b); return false; }
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
app.post('/api/logout', (req, res) => { res.clearCookie('session'); res.json({ ok: true }); });
app.get('/api/session', (req, res) => { res.json({ authed: isAuthed(req) }); });

// ============================================================================
// CLIENT PROFILES — stored as JSON on disk (DATA_DIR), shared by the team
// ============================================================================
const dataDir = DATA_DIR || path.join(__dirname, 'data');
fs.mkdirSync(dataDir, { recursive: true });
const profilesPath = path.join(dataDir, 'profiles.json');

const DEFAULT_PROFILES = {
  'hill-country-interiors': {
    id: 'hill-country-interiors', name: 'Hill Country Interiors',
    brand: 'Hill Country Interiors', url: 'https://hillcountryinteriors.com',
    copyright: '© 2026 Hill Country Interiors. All rights reserved.',
    author: 'Hill Country Interiors', email: 'brandon@hillcountryinteriors.com',
    keywords: 'upscale leather furniture, rustic furniture, Western furniture, old-world furniture, Hill Country Interiors',
    titleTpl: '{name} | Hill Country Interiors',
    descTpl: '{name} — from Hill Country Interiors. Upscale leather, rustic, Western, and old-world furniture, made to last.',
    vendor: '',
  },
  'leather-showroom': {
    id: 'leather-showroom', name: 'Leather Showroom',
    brand: 'Leather Showroom', url: 'https://leatherfurniture.com',
    copyright: '© 2026 Leather Showroom. All rights reserved.',
    author: 'Leather Showroom', email: 'sales@leatherfurniture.com',
    keywords: 'leather furniture, premium leather sofa, top grain leather, leather sectional, leather recliner, Leather Showroom',
    titleTpl: '{name} | Premium Leather Furniture | Leather Showroom',
    descTpl: '{name} — handcrafted premium leather furniture from Leather Showroom. Top-grain leather, made to last.',
    vendor: '',
  },
  'arizona-leather': {
    id: 'arizona-leather', name: 'Arizona Leather',
    brand: 'Arizona Leather', url: 'https://arizonaleather.com',
    copyright: '© 2026 Arizona Leather. All rights reserved.',
    author: 'Arizona Leather', email: 'jimriedl@arizonaleather.com',
    keywords: 'leather furniture, leather sofa, leather sectional, leather recliner, top grain leather, Arizona Leather',
    titleTpl: '{name} | Arizona Leather',
    descTpl: '{name} — premium leather furniture from Arizona Leather. Leather sofas, sectionals, and recliners, made to last.',
    vendor: '',
  },
  'gratr-landscaping': {
    id: 'gratr-landscaping', name: 'Gratr Landscaping',
    brand: 'Gratr Landscaping', url: '', copyright: '© 2026 Gratr Landscaping. All rights reserved.',
    author: 'Gratr Landscaping', email: '', keywords: '',
    titleTpl: '{name} | Gratr Landscaping', descTpl: '{name} — from Gratr Landscaping.', vendor: '',
  },
  'terra-excavating': {
    id: 'terra-excavating', name: 'Terra Excavating',
    brand: 'Terra Excavating', url: '', copyright: '© 2026 Terra Excavating. All rights reserved.',
    author: 'Terra Excavating', email: '', keywords: '',
    titleTpl: '{name} | Terra Excavating', descTpl: '{name} — from Terra Excavating.', vendor: '',
  },
  '1st-call-plumbing': {
    id: '1st-call-plumbing', name: '1st Call Plumbing',
    brand: '1st Call Plumbing', url: '', copyright: '© 2026 1st Call Plumbing. All rights reserved.',
    author: '1st Call Plumbing', email: '', keywords: '',
    titleTpl: '{name} | 1st Call Plumbing', descTpl: '{name} — from 1st Call Plumbing.', vendor: '',
  },
  'walker-homes-remodeling': {
    id: 'walker-homes-remodeling', name: 'Walker Homes Remodeling',
    brand: 'Walker Homes Remodeling', url: '', copyright: '© 2026 Walker Homes Remodeling. All rights reserved.',
    author: 'Walker Homes Remodeling', email: '', keywords: '',
    titleTpl: '{name} | Walker Homes Remodeling', descTpl: '{name} — from Walker Homes Remodeling.', vendor: '',
  },
  'karen-dietz-interiors': {
    id: 'karen-dietz-interiors', name: 'Karen Dietz Interiors',
    brand: 'Karen Dietz Interiors', url: '', copyright: '© 2026 Karen Dietz Interiors. All rights reserved.',
    author: 'Karen Dietz Interiors', email: '', keywords: '',
    titleTpl: '{name} | Karen Dietz Interiors', descTpl: '{name} — from Karen Dietz Interiors.', vendor: '',
  },
  'southern-tattoo-society': {
    id: 'southern-tattoo-society', name: 'Southern Tattoo Society',
    brand: 'Southern Tattoo Society', url: '', copyright: '© 2026 Southern Tattoo Society. All rights reserved.',
    author: 'Southern Tattoo Society', email: '', keywords: '',
    titleTpl: '{name} | Southern Tattoo Society', descTpl: '{name} — from Southern Tattoo Society.', vendor: '',
  },
};

function readProfiles() {
  try { return JSON.parse(fs.readFileSync(profilesPath, 'utf8')); }
  catch { return null; }
}
function writeProfiles(obj) {
  fs.writeFileSync(profilesPath, JSON.stringify(obj, null, 2));
}
// Seed defaults on first run (when no profiles file exists yet)
if (!readProfiles()) writeProfiles(DEFAULT_PROFILES);

const ALLOWED_KEYS = ['name', 'brand', 'url', 'copyright', 'author', 'email', 'keywords', 'titleTpl', 'descTpl', 'vendor'];
function cleanProfile(body, id) {
  const out = { id };
  for (const k of ALLOWED_KEYS) out[k] = typeof body?.[k] === 'string' ? body[k].slice(0, 2000) : '';
  if (!out.name) out.name = id;
  return out;
}

app.get('/api/profiles', requireAuth, (req, res) => {
  res.json(readProfiles() || {});
});
app.put('/api/profiles/:id', requireAuth, (req, res) => {
  const id = String(req.params.id).replace(/[^a-z0-9-]/gi, '').slice(0, 100);
  if (!id) return res.status(400).json({ error: 'Invalid id' });
  const profiles = readProfiles() || {};
  profiles[id] = cleanProfile(req.body, id);
  writeProfiles(profiles);
  res.json({ ok: true, id, profile: profiles[id] });
});
app.delete('/api/profiles/:id', requireAuth, (req, res) => {
  const id = String(req.params.id);
  const profiles = readProfiles() || {};
  delete profiles[id];
  writeProfiles(profiles);
  res.json({ ok: true });
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
    .replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

app.post('/api/suggest-name', requireAuth, async (req, res) => {
  try {
    const { imageBase64, mediaType, style = 'ecom', brand = '' } = req.body || {};
    if (!imageBase64 || !mediaType) return res.status(400).json({ error: 'imageBase64 and mediaType are required' });
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (!allowed.includes(mediaType)) return res.status(400).json({ error: `Unsupported media type: ${mediaType}` });
    const styleGuide = STYLE_GUIDES[style] || STYLE_GUIDES.ecom;
    const brandName = String(brand).slice(0, 120) || 'this brand';

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
            { type: 'text', text: `Look at this product image for ${brandName}. Return ONLY ${styleGuide}. No quotes, no extension, no explanation. Just the filename slug. Example output: cognac-leather-sectional-with-chaise` },
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
    const name = slugify(data?.content?.[0]?.text || '');
    if (!name) return res.status(502).json({ error: 'Model returned an empty name' });
    res.json({ name });
  } catch (e) {
    console.error('suggest-name failed:', e);
    res.status(500).json({ error: 'Internal error generating name' });
  }
});

// ============================================================================
// STATIC FILES
// ============================================================================
app.use(express.static(path.join(__dirname, 'public')));

app.listen(PORT, () => {
  console.log(`\n  DW Studio SEO Image Processor on http://localhost:${PORT}`);
  console.log(`  Profiles: ${profilesPath}  ·  Model: ${ANTHROPIC_MODEL}\n`);
});
