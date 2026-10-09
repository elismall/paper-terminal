# Paper Terminal

A market terminal with trading bots for stocks and crypto that you run yourself. It starts on **paper trading** (practice
money, nothing real at stake). Your copy uses your own free accounts and your own keys; nobody else can see your accounts or
trade for you, including the person who shared this with you.

Please read [DISCLAIMER.md](DISCLAIMER.md) first: this is software, not financial advice.

**Easiest way to set up:** the step-by-step guide at https://paper-terminal-setup.vercel.app walks you through everything below with buttons, and it
makes the two random codes for you. It is invite-only: sign in with the Google account whose address you gave the person who
shared this. No invite? This page is the same guide in writing.

---

## What you need and what it costs

| Account | What it's for | Cost | Sign up |
|---|---|---|---|
| GitHub | holds your copy of the code | Free | https://github.com/signup |
| Vercel | runs your app on the internet | Free (Hobby plan). Pro is $20/month and optional | https://vercel.com/signup |
| Alpaca (paper) | the practice brokerage account the bots trade in | Free, no money needed | https://app.alpaca.markets/signup |
| cron-job.org | wakes the bots up every 15 minutes | Free | https://console.cron-job.org/signup |
| FRED (optional) | the Macro tab (interest rates, inflation) | Free | https://fredaccount.stlouisfed.org/apikeys |

Total to start: **$0**. You need an email address and about the patience of setting up a new phone. You do not need to know
how to code. You never type a command.

Real money (optional, much later) is its own section at the bottom. Alpaca stock and ETF trades have no commission; crypto
trades cost 0.15% to 0.25% of the trade (Alpaca's fee page: https://docs.alpaca.markets/docs/crypto-fees).

**One rule for the whole setup:** your keys and passcode go only into Vercel's settings page. Never paste them into a chat, an
email, a text, a screenshot, or a file in GitHub. If you think one leaked, make a new one (steps under "If something goes wrong").

Keep a note open (your phone's Notes app is fine, or a password manager, which is better) to hold four things while you set up:
your Alpaca key ID, your Alpaca secret key, your passcode, and your cron secret.

---

## Step 1. Make a GitHub account

1. Go to https://github.com/signup and follow the prompts (email, password, username, email code).
2. Choose the **Free** plan if asked.
3. Recommended: turn on two-factor sign-in: your picture (top right) → **Settings** → **Password and authentication** →
   **Enable two-factor authentication**.

## Step 2. Copy the app into your GitHub ("fork")

1. While signed in to GitHub, open **https://github.com/elismall/paper-terminal**
2. Click **Fork** (top right, next to Star).
3. Leave everything as it is and click **Create fork**.

You now have your own copy at `github.com/YOUR-USERNAME/paper-terminal`. Nothing in it is secret; the secrets go into Vercel.

## Step 3. Make a free Alpaca paper account and get your paper keys

1. Go to https://app.alpaca.markets/signup, enter your email and a password, confirm the email.
2. You do **not** need to fund anything or finish the "open a brokerage account" forms for paper trading. If Alpaca asks, choose
   to continue with paper trading.
3. Top left, make sure the account menu says **Paper** (switch to it if it says Live).
4. On the Paper home page, find **API Keys** (right side) → **Generate New Keys** (or **Regenerate**).
5. Copy the **Key ID** (starts with `PK`) and the **Secret Key** into your note. The secret is shown **only once**; if you lose
   it, just generate new keys.
6. Recommended: turn on two-factor sign-in in Alpaca's account settings.

Your paper account starts with $100,000 of practice money. You can reset it any time in Alpaca.

## Step 4. Make your passcode and your cron secret

- **Passcode** (`DASH_PASSCODE`): what you type to sign in to your app. Use **12 or more characters**; a short sentence you'll
  remember works well, like `purple Tacos run at 9`. The app locks out anyone who guesses wrong 5 times.
- **Cron secret** (`CRON_SECRET`): a long random code the scheduler uses to wake the bots. You never type it; you only paste it
  twice. Get one from the setup guide (https://paper-terminal-setup.vercel.app, "Make my codes" button, made on your own device and never sent
  anywhere), or from a password manager's generator (40 or more letters and numbers, no spaces).

Put both in your note. The two must be different.

## Step 5. Make a Vercel account and put your copy online

1. Go to https://vercel.com/signup, choose **Hobby** (free), and pick **Continue with GitHub**. Approve the connection.
2. Go to https://vercel.com/new. Under **Import Git Repository**, find **paper-terminal** and click **Import**.
   (If you don't see it: click **Adjust GitHub App Permissions**, allow Vercel to see the paper-terminal repository, come back.)
3. Leave **Framework Preset** as **Other**. Don't change the build settings.
4. Open **Environment Variables** and add these four, one at a time (Key on the left, Value on the right, then **Add**):

   | Key | Value |
   |---|---|
   | `ALPACA_KEY_ID` | your Alpaca paper Key ID (starts with PK) |
   | `ALPACA_SECRET_KEY` | your Alpaca paper Secret Key |
   | `DASH_PASSCODE` | your passcode |
   | `CRON_SECRET` | your cron secret |

   Keys must be spelled exactly like this (capital letters, underscores). No quotes, no spaces before or after the value.
5. Click **Deploy** and wait for the confetti. Click **Continue to Dashboard**.
6. Your app's link is shown under **Domains**, something like `https://paper-terminal-abc123.vercel.app`. Put it in your note.

## Step 6. Give the app a place to save its data (Blob storage)

The bots keep their memory (training results, trade notes, your notification devices) in a small free storage box.

1. In your Vercel project, click the **Storage** tab.
2. Click **Create Database** (or **Create**), choose **Blob**, then **Continue**.
3. Give it any name (for example `paper-terminal-data`). If it asks for access, choose **Public** (the app needs this; it never
   stores your keys or passcode there). Click **Create**.
4. When it asks which environments to connect, keep all of them checked and click **Connect**. This adds a setting called
   `BLOB_READ_WRITE_TOKEN` for you.
5. Now redeploy so the app sees it: **Deployments** tab → the top deployment → the **⋯** menu → **Redeploy** → **Redeploy**.

Free storage allows 1 GB and 10,000 simple operations a month; the app is built to stay far inside that.

## Step 7. Wake the bots every 15 minutes (cron-job.org)

Vercel's free plan only runs scheduled jobs once a day, so a free outside service does the waking.

1. Go to https://console.cron-job.org/signup, make an account, confirm the email, sign in.
2. Click **Create cronjob**.
3. **Title:** `Paper Terminal`
4. **URL:** your app link plus `/api/tick?every=15`, for example
   `https://paper-terminal-abc123.vercel.app/api/tick?every=15`
5. **Execution schedule:** choose **Every 15 minutes**.
6. Open the **Advanced** tab. Under **Headers**, click **Add**:
   - Key: `Authorization`
   - Value: the word `Bearer`, one space, then your cron secret, like `Bearer 7fK2...` (the whole code, no quotes).
7. Leave the request method as **GET**. Click **Create** (or **Save**).
8. Click the job, then **Test run** (or wait 15 minutes) and check **History**: a good run shows **202 Accepted** or **200 OK**.
   **401** means the Authorization value doesn't match your `CRON_SECRET` in Vercel exactly.

The app also has one daily backup run built in, and it downloads crypto price history once a day by itself.

## Step 8. Sign in

1. Open your app link.
2. Tap **Settings** (top right), type your passcode in **Passcode**, tap **Save**. You stay signed in on that device for 7 days.
3. Settings shows a **Setup checklist**. Every **Required** row should be green. Anything red tells you what's missing.

The bots trade only while the market is open (stocks 9:30 AM to 4:00 PM Eastern on market days) and crypto around the clock.
The first day, the bots train themselves on past prices, so give it a day before judging anything.

## Step 9. Put the app on your home screen (so it opens like a real app)

This isn't in the App Store; your phone adds it straight from the website. It gets its own icon and opens full screen.

**iPhone or iPad (use Safari; other browsers can't do this on iPhone):**

1. Open your app link in **Safari**.
2. Tap the **Share** button: the square with an arrow pointing up (bottom of the screen on iPhone, top on iPad). On newer iOS,
   tap **⋯** first, then **Share**.
3. Scroll down and tap **Add to Home Screen**.
4. If you see **Open as Web App**, leave it on. Tap **Add**.
5. Close Safari and open the app from its new icon. Sign in once more there (the home-screen app keeps its own sign-in).

**Android (use Chrome):**

1. Open your app link in **Chrome**.
2. Tap the **⋮** menu (top right).
3. Tap **Add to Home screen** (or **Install app**), then **Install** / **Add**.
4. Open it from the new icon and sign in.

**Computer (Chrome or Edge):** open the link, click the install icon at the right end of the address bar (a screen with a down
arrow), then **Install**.

## Step 10 (optional). Phone notifications when the bots trade

1. Make two notification codes with the setup guide (https://paper-terminal-setup.vercel.app, "Make my codes" also makes these).
2. In Vercel → your project → **Settings** → **Environment Variables**, add `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` with
   those values, then redeploy (Deployments → ⋯ → Redeploy).
3. On your phone, open the app **from the home-screen icon** (iPhone only allows notifications there, iOS 16.4 or newer),
   Settings → **Turn on notifications** → Allow.

## Optional extras

| Setting | What it adds | Cost |
|---|---|---|
| `FRED_API_KEY` | Macro tab data | Free: https://fredaccount.stlouisfed.org/apikeys |
| `SEC_USER_AGENT` | company financials from the SEC. Value: your name and email, like `Jane Doe jane@example.com` | Free, no account |
| `APP_NAME` | the name shown on screen | Free |
| `TYPESAFE_API_KEY` | Jev, an AI second opinion that rates each setup (it never places orders) | Paid per use by TypeSafe; skip it at first |
| `JEV_MODE` | What Jev's opinion does. Leave it empty (or `shadow`) and Jev only writes notes. `gate` lets Jev skip weak setups and halve doubtful ones. `off` turns Jev off. Only switch to `gate` once Jev's scorecard (Jev tab) shows it helps | Free (Jev itself is paid per use) |
| `JEV_MODEL` | Which Jev version to ask. Leave it empty unless TypeSafe tells you a new name | Free |
| `NEWS_MODE` | What the news check does. Leave it empty (or `shadow`) and news is only written down next to each trade. `gate` lets bad news (an offering, a downgrade) skip a stock trade. `off` turns news off | Free |
| `LEVERAGE_MODE` | What the crypto crowding check does. Leave it empty (or `shadow`) and it is only written down. `gate` holds back new crypto DCA deals when too many traders are betting on a rise with borrowed money. `off` turns it off | Free |
| `CRYPTO_SWING` | `on` lets the crypto swing bot open new trades. Leave it empty and crypto is only bought through the DCA bot | Free |
| `VAPID_SUBJECT` | The contact sent along with phone notifications, like `mailto:you@example.com`. Leave it empty and your app's own address is used | Free |

Add any of them in Vercel → Settings → Environment Variables, then redeploy.

---

## Getting updates

When the app gets fixes or new features:

1. Open your copy on GitHub (`github.com/YOUR-USERNAME/paper-terminal`).
2. If you see "This branch is … commits behind", click **Sync fork** → **Update branch**.
3. That's it. Vercel notices and puts the new version online by itself in a minute or two. Your settings and data stay.

Settings → Setup checklist shows your version number.

---

## Real money (advanced, optional)

Only after you've watched it on paper for a while, and only with money you can afford to lose. Everything in
[DISCLAIMER.md](DISCLAIMER.md) applies.

**How the switch works.** Your copy stays on paper unless **all five** settings below are in Vercel. If any is missing or
misspelled, it stays on paper and the Setup checklist says which one is missing. Your paper keys stay in place; the app just
stops using them while live mode is on.

1. **Open and fund a live Alpaca account** at https://app.alpaca.markets (switch the top-left menu to **Live** and finish the
   application: identity check, then a bank transfer). Crypto availability depends on your state.
2. In the **Live** account, generate **API Keys** (same as Step 3, but on the Live side; they start with `AK`).
3. In Vercel → Settings → Environment Variables, add:

   | Key | Value |
   |---|---|
   | `ALPACA_LIVE_KEY_ID` | your LIVE Key ID |
   | `ALPACA_LIVE_SECRET_KEY` | your LIVE Secret Key |
   | `LIVE_MAX_USD` | the most the bots may have in the market at once, in dollars. Start small, like `100` |
   | `LIVE_CONFIRM` | exactly: `I understand this trades real money` |
   | `TRADING_MODE` | `live` |

4. Redeploy (Deployments → ⋯ → Redeploy).

**What changes when it's live:**

- A red **REAL MONEY** bar across the top, and every account, ticket and bot label says LIVE.
- Every buy is checked before it's sent: what you hold + buys waiting to fill + this order must stay under `LIVE_MAX_USD`.
  If it wouldn't, the order is refused and never reaches Alpaca.
- No short selling, no selling options to open (option spreads must be ones you pay for, where the most you can lose is the price),
  and orders can't be resized (only canceled and re-placed). Raising the price of a buy that's waiting is checked against the limit again.
- The stock and crypto swing bots size their trades from `LIVE_MAX_USD`, not from everything in the account.
- The DCA bot uses half of `LIVE_MAX_USD` and fewer, bigger deals so each one is at least $25.
- Selling what you already hold is always allowed, so stops, exits and **Emergency stop** keep working.

**Back to paper:** change `TRADING_MODE` to `paper` (or delete it) and redeploy. Anything already bought with real money stays in
your live Alpaca account; close it there if you want to. The app shows the paper account again.

**Stop everything right now:** the **Bot** tab → **Emergency stop** (pauses the bots, cancels their orders and sells their positions), or set
`BOT_PAUSED` to `true` in Vercel and redeploy (no new trades until you remove it). **Pause** stops new trades and also takes back the
DCA bot's waiting dip buys; take profits, stops and exits keep working. If the app ever can't read whether you paused, it acts as if
you did (no new trades) until it can.

---

## Keeping it safe

- Passcode 12+ characters, different from every other password you use.
- Turn on two-factor sign-in for GitHub, Vercel and Alpaca. Those accounts are the real keys to your copy.
- Share your app link with nobody who doesn't need it, and your passcode with nobody at all.
- Your keys live only in Vercel's settings. The code in GitHub has no secrets in it; don't ever add any.
- If Vercel offers a **Sensitive** checkbox when adding a secret, tick it (then even you can't read it back, which is fine).
- On a shared computer, use Settings → Setup checklist → **Sign out** when done.
- Lost a phone or think someone else signed in? Settings → Setup checklist → **Sign out everywhere** (tap it twice). Every device,
  this one too, needs the passcode again.
- Too many wrong passcodes lock sign-in for a while (it gets longer each time) and send you a notification if you set those up.
  Phones and computers you signed in on before (in the last month or so) can still sign in during that lock.
- Extra protection (optional, if your Vercel plan offers it): Vercel → your project → **Firewall** → a rate limit rule for `/api/session`
  (for example 20 requests a minute per IP). It stops floods of guesses before they reach the app.

## If something goes wrong

| What you see | What to do |
|---|---|
| Checklist says Alpaca keys don't work | Re-copy both paper keys into Vercel (no spaces), redeploy. Make sure they're from the **Paper** side. |
| "Passcode not set" or can't sign in | Check `DASH_PASSCODE` in Vercel, redeploy, try again. Locked out? Wait 15 minutes, or sign in from a phone or computer you used before. |
| Checklist says no scheduled run lately | Check cron-job.org → your job → History. 401 = the Authorization header doesn't match `CRON_SECRET`. |
| Storage shows red | Step 6 again: the Blob store must be connected to the project, then redeploy. Until it is, the bots manage open trades but make no new ones. |
| A key or passcode may have leaked | Make a new one (Alpaca: Regenerate keys; others: make a new code), replace it in Vercel (and cron-job.org for `CRON_SECRET`), redeploy. The old one stops working. |
| Something else | Settings → Setup checklist usually names it. Otherwise ask the person who shared this with you, and send a screenshot of the checklist (it never shows your keys). |

## License

MIT (see [LICENSE](LICENSE)). Provided as is, without warranty.
