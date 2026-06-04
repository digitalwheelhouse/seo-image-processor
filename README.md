# Leather Showroom — SEO Image Processor (Team Edition)

A browser tool for bulk-processing product images for SEO: rename, embed
ownership/SEO metadata (EXIF + XMP), resize, convert to WebP/JPEG, and download
as a ZIP. AI-assisted naming uses Claude to look at each image and suggest an
SEO-friendly filename.

**What's different from the original single-file version:** the Anthropic API
key is no longer in the browser. It lives only on the server. The whole tool is
behind a shared team password, so only your team can use it (and spend your API
budget).

---

## How it works

```
Browser (your team)                 This server                 Anthropic
─────────────────                   ───────────                 ─────────
unlock with team password  ───►  verifies password
                                  sets signed session cookie
upload images (stay local)
"suggest a name"           ───►  /api/suggest-name  ──── key ───►  Claude
                           ◄───  just the filename   ◄────────────
resize/convert/metadata
(all in the browser)
download ZIP
```

The key only ever exists in the server's environment. The browser never sees it.

---

## 1. Run it locally (to test)

You need Node 18+.

```bash
cd seo-image-processor
cp .env.example .env        # then edit .env with real values
npm install
npm start
```

Open http://localhost:3000, enter the team password, and you're in.

Generate a strong `SESSION_SECRET` with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

## 2. Deploy so your remote team can reach it

Pick whichever is easiest for you. All of them need three environment variables
set in the host's dashboard (never commit `.env`):

- `ANTHROPIC_API_KEY`
- `TEAM_PASSWORD`
- `SESSION_SECRET`

### Option A — Render (easiest, free tier)

1. Push this folder to a private GitHub repo.
2. Render → New → Web Service → connect the repo.
3. Build command: `npm install` · Start command: `npm start`.
4. Add the three environment variables under **Environment**.
5. Deploy. Render gives you an HTTPS URL — share that with the team.

### Option B — Railway

1. Push to GitHub, then Railway → New Project → Deploy from repo.
2. Add the three variables under **Variables**.
3. Railway auto-detects Node and runs `npm start`. Generate a public domain
   under **Settings → Networking**.

### Option C — Docker (any host, internal infra)

```bash
docker build -t seo-image-processor .
docker run -d -p 3000:3000 \
  -e ANTHROPIC_API_KEY=sk-ant-... \
  -e TEAM_PASSWORD=your-team-password \
  -e SESSION_SECRET=your-long-random-secret \
  --name seo-tool seo-image-processor
```

### Option D — A plain VPS (Ubuntu, etc.)

```bash
# on the server
git clone <your-repo> && cd seo-image-processor
cp .env.example .env   # fill it in
npm install
npm install -g pm2
pm2 start server.js --name seo-tool
pm2 save && pm2 startup
```

Put it behind Nginx/Caddy with HTTPS so the password and cookie travel encrypted.

---

## Security notes

- **Always serve over HTTPS** in production. The session cookie is marked
  `secure` automatically when it detects HTTPS (directly or via
  `x-forwarded-proto`), and `httpOnly` so scripts can't read it.
- **Rotate the password** by changing `TEAM_PASSWORD` and redeploying. Changing
  `SESSION_SECRET` invalidates all existing logins immediately.
- Sessions last 12 hours, then the user re-enters the password.
- Images are processed entirely in the browser. The only thing sent to the
  server (and on to Anthropic) is the image bytes for AI naming — and only when
  a user picks the "AI suggests names" mode.
- The repo's `.gitignore` and `.dockerignore` exclude `.env` so the key never
  ends up in version control or an image layer.

---

## Changing the model

Set `ANTHROPIC_MODEL` in your environment (defaults to `claude-sonnet-4-6`).
