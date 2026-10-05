# UPI Pay Page

A payment page you deploy once. Your UPI details live in environment variables; every visitor gets a QR code and a pay button that opens their own UPI app with the amount pre-filled.

No dependencies, no build step, no framework.

FINDING: only supports payments recieved for merchant UPI accounts

## Setup

```bash
cp .env.example .env.local
```

Fill in your details:

```
UPI_VPA=yourname@okaxis
UPI_PAYEE_NAME=Your Business Name
```

Run it:

```bash
npm run dev
```

Open http://localhost:3000.

> A `.env.local` with demo values is already there so the page runs out of the box. Replace it with yours.

## Deploy to Vercel

Push the repo, import it on Vercel, then add the same two variables under **Project Settings → Environment Variables** and redeploy. No `vercel.json` needed — `public/` is served statically and `api/config.js` becomes a serverless function automatically.

`.env.local` is gitignored and is not used in production; Vercel reads the dashboard variables instead.

## Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `UPI_VPA` | yes | Your UPI ID, e.g. `yourname@okaxis` |
| `UPI_PAYEE_NAME` | yes | Name the payer sees |
| `UPI_CURRENCY` | no | Defaults to `INR` |
| `UPI_DEFAULT_AMOUNT` | no | Pre-fills the amount |
| `UPI_LOCK_AMOUNT` | no | `true` makes the default amount non-editable |
| `UPI_NOTE` | no | Default transaction note |
| `UPI_MERCHANT_CODE` | no | 4-digit MCC, merchants only |

## Per-payment links

Override the amount and note per link, so one deployment covers every invoice:

```
https://yoursite.vercel.app/?am=499
https://yoursite.vercel.app/?am=1250&tn=Invoice%20INV-204
https://yoursite.vercel.app/?am=99&tn=Order%20112&tr=ORD112
```

| Query param | Meaning |
|---|---|
| `am` | Amount. When present it is **locked** — the payer cannot edit it |
| `tn` | Transaction note shown on the page and in the UPI app |
| `tr` | Your reference id, passed through to the app |

Without `am`, the payer types the amount themselves and gets quick-pick buttons.

## How the payer reaches their app

**On a phone** the green button opens `upi://pay?...`, which Android resolves to the app chooser. Below it are direct buttons per app — `intent://` with an explicit package on Android, each app's own scheme on iOS — because iOS apps often do not register the generic `upi://` scheme.

**On a computer** there is no `upi://` handler, so the page reorders itself to lead with the QR and demotes the button. Nothing fails silently.

## About the VPA and env vars

Your VPA is **not a secret**. It is inside every `upi://` link and every QR you hand out — it has to be, that is how the payer's bank knows where to send money. Env vars keep it out of git and let you change it per deployment. They do not hide it.

## Verifying payments

A UPI deep link is fire-and-forget: **no callback ever reaches the page**, so it cannot know on its own whether money arrived. Instead, every payment gets its **own amount**, and the amount is how you find it in your bank.

```
UPI_DEFAULT_AMOUNT=10
UPI_UNIQUE_AMOUNT=true
```

1. Each visitor is given an amount from **₹10.01 to ₹10.99**. It goes into the QR and pay button, and the payer types nothing.
2. After paying, they tap **I've paid**. The page then says *Checking* and updates itself.
3. You open `/admin.html` (log in with `ADMIN_TOKEN`). For each credit in your bank app, type its amount, for example `10.37`, and click **Verify** on the match. The payer's page turns to *Paid*.

An amount is held for **one hour** from when it is handed out, then it can go to someone else. That gives 99 payments in progress at once. A 100th visitor in the same hour gets "try again in a few minutes". Because an amount can be reused after an hour, check the time as well as the amount. A payer still on the page when their hour ends is given a new amount automatically.

A reload keeps the same payment and amount, so refreshing does not use up amounts. Payments that never get a tap still appear under **Not tapped**, in case someone paid and forgot to tap.

"I've paid" is only a claim. Verify only once the credit is in your bank.

**Storage.** Locally, payments go to `data/store.json` (gitignored). Vercel's disk is not persistent, so in production add **Upstash for Redis** from the project's Storage tab. It sets `KV_REST_API_URL` / `KV_REST_API_TOKEN`, and the code calls its REST API directly, with no dependency. Also set `ADMIN_TOKEN` to a long random string.

| Variable | Purpose |
|---|---|
| `UPI_UNIQUE_AMOUNT` | `true` turns on per-payment amounts and tracking. Needs a whole-rupee `UPI_DEFAULT_AMOUNT` |
| `ADMIN_TOKEN` | Unlocks `/admin.html` and `/api/admin` |
| `KV_REST_API_URL`, `KV_REST_API_TOKEN` | Upstash Redis (production). `UPSTASH_REDIS_REST_URL` / `_TOKEN` also work |

To verify with no human in the loop, the next step is to forward your bank's credit alerts (SMS or email) to the server and match them by amount automatically, or use a payment gateway with webhooks.

## Layout

```
api/config.js        reads env, serves payee config (Vercel function)
api/payments.js      hands out a unique amount, records "I've paid", reports status
api/admin.js         owner lists payments and marks them verified (ADMIN_TOKEN)
api/_lib/store.js    Upstash Redis in production, data/store.json locally
api/_lib/unique.js   unique-amount settings and the one-hour hold
dev.js               local preview only; Vercel does not run this
public/index.html    the payment page
public/app.js        link building, validation, QR, app targets, payment tracking
public/admin.html    verification page for the owner
public/styles.css
public/vendor/       QRious, vendored so there is no CDN dependency
```

## Note on LinkPe

This started as a test of [PtPrashantTripathi/linkpe](https://github.com/PtPrashantTripathi/linkpe). Its links work for plain inputs but break on punctuation, because both of its steps build URLs by string interpolation:

```js
linkpeURL += `?pa=${pa}&pn=${pn}&cu=INR`;   // linkpe.html
const url = 'upi://pay' + queryString;      // index.html
```

A payee name or note containing `&` truncates the link and spawns a junk parameter; one containing `#` opens the URI fragment and **silently drops the amount**; a missing `pn` emits the literal string `null` as the payee name.

This project builds the same `upi://` link with `encodeURIComponent` on every value, so those inputs survive intact.
