# GAMBROS Wager Race

Live wager race leaderboard for your Discord community, powered by the Damble.io Partners API.

---

## LOCAL SETUP (your PC only)

### Step 1 — Install Node.js (one-time)
1. Go to https://nodejs.org
2. Download the **LTS** version (green button)
3. Run the installer, click Next through everything
4. **Close and reopen** your Command Prompt after installing

Verify it worked:
```
node --version
```
You should see `v22.x.x` or similar.

### Step 2 — Extract and install
Extract the zip to your Desktop, then:
```
cd Desktop\gambros-wager-race
npm install
```

### Step 3 — Run it
```
set API_KEY=1f1cIRNwmM
set PARTNER_EMAIL=Taygambros@outlook.com
node server.js
```

### Step 4 — Open it
Go to **http://localhost:3000** in your browser.

This only works on your machine. To share it in Discord, follow the next section.

---

## MAKING IT PUBLIC (so Discord can see it)

You have two options: quick/temporary (ngrok) or permanent (Render).

---

### OPTION A — Quick & free with ngrok (temporary link)

Good for: testing, short races, showing the community something fast.
The link changes every time you restart.

**1. Install ngrok**
```
npm install -g ngrok
```

**2. Start your server** (in one Command Prompt):
```
cd Desktop\gambros-wager-race
set API_KEY=1f1cIRNwmM
set PARTNER_EMAIL=Taygambros@outlook.com
node server.js
```

**3. Open a SECOND Command Prompt** and run:
```
ngrok http 3000
```

**4. Copy the public URL**
ngrok will show something like:
```
Forwarding    https://a1b2c3d4.ngrok-free.app -> http://localhost:3000
```

**5. Paste that URL in Discord** — anyone who clicks it sees your live leaderboard.

Note: The URL changes each time you restart ngrok. Your PC must stay on
and both commands must keep running.

---

### OPTION B — Permanent & free with Render (recommended)

Good for: always-on, permanent URL, no need to keep your PC running.

**1. Create a GitHub account** (if you don't have one)
Go to https://github.com and sign up.

**2. Create a new repository**
- Click the green **New** button
- Name it `gambros-wager-race`
- Set it to **Private**
- Click **Create repository**

**3. Upload your files**
On the repository page, click **"uploading an existing file"** link.
Drag in ALL the files from your gambros-wager-race folder:
- `package.json`
- `server.js`
- `public/index.html`

Click **Commit changes**.

**4. Create a Render account**
Go to https://render.com and sign up (free, use your GitHub account).

**5. Create a new Web Service**
- Click **New** → **Web Service**
- Connect your GitHub account if prompted
- Select your `gambros-wager-race` repository
- Fill in:
  - **Name**: `gambros-wager-race`
  - **Region**: Pick the closest to you (EU West for UK)
  - **Runtime**: Node
  - **Build Command**: `npm install`
  - **Start Command**: `node server.js`
  - **Instance Type**: Free

**6. Add your API credentials**
Scroll down to **Environment Variables** and add:
- `API_KEY` = `1f1cIRNwmM`
- `PARTNER_EMAIL` = `Taygambros@outlook.com`

**7. Click Deploy**
Render will build and deploy. After a minute you'll get a permanent URL like:
```
https://gambros-wager-race.onrender.com
```

**8. Share in Discord**
Paste that URL — it's always live, always on, no PC needed.

Note: Render free tier spins down after 15 min of no traffic. First visit
after inactivity takes ~30 seconds to wake up, then it's instant.

---

## CONFIGURING A NEW RACE

Edit the `RACE_CONFIG` block at the top of `server.js`:

```js
const RACE_CONFIG = {
  name: "APRIL WAGER WAR",           // Race title
  subtitle: "Wager big, win bigger",  // Description under title
  startDate: "2026-04-01",            // YYYY-MM-DD
  endDate: "2026-04-30",              // YYYY-MM-DD
  prizes: [
    { place: "1st", reward: "$150" },
    { place: "2nd", reward: "$75" },
    { place: "3rd", reward: "$25" },
  ],
  signupLink: "https://damble.io",    // Join button URL ("" to hide)
  brandName: "GAMBROS",
};
```

If running locally: save the file and restart the server.
If on Render: push the change to GitHub and Render auto-redeploys.

---

## ADDING THE GAMBROS LOGO

1. Put `gambroslowqual.png` (or any logo file) in the `public` folder
2. In `public/index.html`, find the `<div class="brand-pill">` line
3. Add this line directly ABOVE it:
```html
<img src="/gambroslowqual.png" style="width:90px;height:90px;border-radius:18px;margin-bottom:14px;display:block;margin-left:auto;margin-right:auto" alt="Gambros">
```

---

## FEATURES

- Real-time data from Damble Partners API
- Server-side caching (60s) to avoid hammering the API
- Auto-refresh every 60 seconds in browser
- Live countdown timer
- Unique pixel avatars per player
- Click any player to expand stats
- Active/inactive indicators
- WHALE tag for big spenders
- Scrolling activity ticker
- Stats summary bar
- Prize display
- Join CTA button
- Mobile responsive
- Live reload for development
- Discord-friendly meta tags

## TROUBLESHOOTING

**"npm is not recognised"**
Node.js isn't installed, or you didn't reopen Command Prompt after installing.

**Page shows "COULD NOT LOAD DATA"**
- Check your API_KEY and PARTNER_EMAIL are correct
- Make sure you set them BEFORE running node server.js
- Check the Command Prompt for error messages

**"Invalid API key or email"**
- Double check the API key matches what Damble shows
- Make sure the email is the exact one on your Damble partner account

**ngrok shows "ERR_NGROK_6022"**
You need to sign up for a free ngrok account at https://ngrok.com
and run `ngrok config add-authtoken YOUR_TOKEN` once.

**Render deploy fails**
Make sure all three files are in the repo: package.json, server.js, public/index.html
