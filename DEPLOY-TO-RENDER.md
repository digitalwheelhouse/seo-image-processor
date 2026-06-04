# Putting the SEO Image Processor online with Render

A no-jargon, click-by-click guide. Total time: about 20 minutes, once.
You do this **once**. After that, your team just visits a link and types a password.

You'll set up two free accounts: **GitHub** (a cloud filing cabinet for the code)
and **Render** (the host that runs it). Render reads the code from GitHub.

---

## Before you start: three secrets you'll paste in later

Keep these handy in a note. You'll enter them into Render near the end.

1. **ANTHROPIC_API_KEY** — your Anthropic key (starts with `sk-ant-...`).
   Get it from console.anthropic.com → API Keys if you don't have it.

2. **TEAM_PASSWORD** — make one up. This is what your team types to get in.
   Pick something not easily guessed, e.g. `LeatherShowroom-Photos-2026!`

3. **SESSION_SECRET** — a long random string (a security signature, behind the scenes).
   You can use this freshly generated one, or invent your own random gibberish:

   ```
   a1f4c9e2b7d83056e1c4a9f70b2d6e8c3f5a1b9d4e7c20f6a8b3d1e5c7f9a2b4
   ```

---

## Part 1 — Put the code on GitHub (your filing cabinet)

1. Go to **github.com** and create a free account (or sign in).

2. Click the **+** in the top-right corner → **New repository**.

3. Name it `seo-image-processor`. Set it to **Private** (so the code isn't public).
   Click **Create repository**.

4. On the next page, click the link **"uploading an existing file"**
   (it's in the line: *"…or upload an existing file"*).

5. Open your `seo-image-processor` folder on your computer. Drag these items
   into the browser upload box:
   - the `public` folder
   - `server.js`
   - `package.json`
   - `README.md`
   - `Dockerfile`
   - `.gitignore`
   - `.env.example`

   **Do NOT upload:**
   - the `node_modules` folder (it's big and unnecessary — Render rebuilds it)
   - any `.env` file (that would leak your secrets — there shouldn't be one yet)

   > Tip: if you see a `node_modules` folder in there, just don't drag it in.
   > If it's easier, delete that one folder first — nothing depends on it.

6. Click the green **Commit changes** button. Your code is now on GitHub.

---

## Part 2 — Deploy it on Render (the host)

1. Go to **dashboard.render.com** and sign up. When it offers, choose
   **Sign in with GitHub** — this lets Render see the repo you just made.

2. Click **New** (top right) → **Web Service**.

3. Find `seo-image-processor` in the repository list and click **Connect**.
   (If you don't see it, click "Configure account" to give Render permission
   to that repo, then come back.)

4. Render shows a settings page. Check/fill these fields:
   - **Name:** `seo-image-processor` (this becomes part of your web address)
   - **Region:** pick the one closest to your team
   - **Branch:** `main`
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Instance Type:** choose **Free**

5. Scroll to **Environment Variables** (may be under an "Advanced" section).
   Click **Add Environment Variable** three times and enter your secrets —
   the **Key** on the left, the **Value** on the right. Type the keys exactly:

   | Key                 | Value                                  |
   |---------------------|----------------------------------------|
   | `ANTHROPIC_API_KEY` | your `sk-ant-...` key                   |
   | `TEAM_PASSWORD`     | the password you chose                  |
   | `SESSION_SECRET`    | the long random string from up top      |

   > You do **not** need to set `PORT` — Render handles that automatically.

6. Click **Create Web Service** at the bottom.

7. Render starts building. Watch the **Logs / Events** — after a minute or two
   you'll see it go **Live**, with a web address like:

   ```
   https://seo-image-processor.onrender.com
   ```

8. Click that link. You should see the password screen. Type your `TEAM_PASSWORD`.
   You're in. 🎉

---

## Part 3 — Give it to your team

Send your team two things:

- the link (e.g. `https://seo-image-processor.onrender.com`)
- the team password

That's it. They don't install anything. The Anthropic key stays on Render and
never touches their browsers.

---

## Good to know

**The free plan "sleeps."** After 15 minutes of nobody using it, Render pauses
the tool to save resources. The next person to open the link waits about a
minute while it wakes up, then it's fast again. Nothing is broken — it's just
yawning. If that minute annoys the team, upgrading to Render's cheapest paid
plan (a few dollars a month) keeps it always-on. Free also includes 750 hours
per month, which is plenty for a team tool.

**Always https.** Your Render link already starts with `https://` (note the
lock). Good — that keeps the password protected in transit. Don't share an
`http://` version.

**To change the password later:** in the Render dashboard, open your service →
**Environment** → edit `TEAM_PASSWORD` → save. Render redeploys automatically.
Changing `SESSION_SECRET` instead will instantly log everyone out.

**To update the tool later:** upload the changed file(s) to the same GitHub repo
(repeat Part 1, step 4–6). Render notices and redeploys on its own.

---

## If something goes wrong

- **"Wrong password" when you know it's right:** double-check `TEAM_PASSWORD` in
  Render's Environment tab for stray spaces. Re-save and wait for redeploy.
- **Build failed:** open the **Logs** tab. Most often it's a typo in one of the
  three environment variable **keys** — they must match exactly (all caps,
  underscores).
- **AI naming says "error":** that means Render reached Anthropic but something
  was off — usually a bad or out-of-credit `ANTHROPIC_API_KEY`. Check the key
  and your Anthropic billing.
