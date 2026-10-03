"use strict";

/* ------------------------------------------------------------------ *
 * A UPI payment page.
 *
 * Payee details come from the server (environment variables). The amount
 * comes from ?am= in the URL when present, otherwise from the payer.
 * Everything is assembled into a upi:// deep link, rendered as both a
 * tappable button and a QR code.
 * ------------------------------------------------------------------ */

const $ = (id) => document.getElementById(id);

const ua = navigator.userAgent;
const IS_ANDROID = /Android/i.test(ua);
const IS_IOS =
  /iPhone|iPad|iPod/i.test(ua) ||
  (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const IS_MOBILE = IS_ANDROID || IS_IOS;

const AMOUNT = /^\d+(\.\d{1,2})?$/;

/* Per-app launch targets. Android gets intent:// with an explicit package so
 * the chooser is skipped; iOS only understands each app's own scheme. */
const APPS = [
  { name: "Google Pay", pkg: "com.google.android.apps.nbu.paisa.user", scheme: "tez://upi/pay" },
  { name: "PhonePe", pkg: "com.phonepe.app", scheme: "phonepe://pay" },
  { name: "Paytm", pkg: "net.one97.paytm", scheme: "paytmmp://pay" },
  { name: "BHIM", pkg: "in.org.npci.upiapp", scheme: "bhim://pay" },
];

let CONFIG = null;

/* ------------------------------------------------------------------ *
 * Link building
 * ------------------------------------------------------------------ */

/**
 * Build the UPI deep link. Every value is percent-encoded, which is the part
 * LinkPe gets wrong: it interpolates raw values into a template literal, so a
 * payee name containing & or # silently truncates the link.
 */
function buildUpiLink(amount) {
  const params = {
    pa: CONFIG.vpa,
    pn: CONFIG.payeeName,
    am: amount,
    cu: CONFIG.currency,
    tn: CONFIG.note,
    tr: CONFIG.ref,
    mc: CONFIG.merchantCode,
  };

  const qs = Object.keys(params)
    .filter((k) => params[k] !== "" && params[k] != null)
    .map((k) => k + "=" + encodeURIComponent(params[k]))
    .join("&");

  return "upi://pay?" + qs;
}

const intentLink = (upi, pkg) =>
  "intent://pay?" + upi.slice(upi.indexOf("?") + 1) +
  "#Intent;scheme=upi;package=" + pkg + ";end";

const schemeLink = (upi, scheme) => scheme + upi.slice(upi.indexOf("?"));

/* ------------------------------------------------------------------ *
 * Rendering
 * ------------------------------------------------------------------ */

function drawQr(value) {
  try {
    new QRious({
      element: $("qr"),
      value: value,
      size: 240,
      background: "#ffffff",
      foreground: "#000000",
      level: "M",
      padding: 0,
    });
    return true;
  } catch (e) {
    return false;
  }
}

/** Re-derive every link and the QR from the current amount. */
function update() {
  const raw = $("amount").value.trim();
  const err = $("amount-err");
  const payBtn = $("pay");

  // An empty amount is legitimate: the payer types it inside their UPI app.
  let amount = "";
  let valid = true;

  if (raw !== "") {
    if (!AMOUNT.test(raw)) {
      valid = false;
      err.textContent = "Enter an amount like 499 or 499.50";
    } else if (Number(raw) === 0) {
      valid = false;
      err.textContent = "Amount must be more than zero.";
    } else {
      amount = raw;
    }
  }

  err.hidden = valid;
  payBtn.classList.toggle("disabled", !valid);
  payBtn.setAttribute("aria-disabled", String(!valid));

  if (!valid) {
    payBtn.removeAttribute("href");
    $("apps").querySelectorAll("a").forEach((a) => a.removeAttribute("href"));
    return;
  }

  const upi = buildUpiLink(amount);
  payBtn.href = upi;
  payBtn.textContent = amount
    ? "Pay " + CONFIG.symbol + amount
    : "Pay with any UPI app";

  $("apps").querySelectorAll("a").forEach((a) => {
    const app = APPS[Number(a.dataset.index)];
    a.href = IS_ANDROID ? intentLink(upi, app.pkg) : schemeLink(upi, app.scheme);
  });

  drawQr(upi);
}

function renderApps() {
  const wrap = $("apps");
  // On desktop these schemes resolve to nothing, so offering them is a dead end.
  if (!IS_MOBILE) {
    wrap.hidden = true;
    return;
  }
  wrap.replaceChildren(
    ...APPS.map((app, i) => {
      const a = document.createElement("a");
      a.className = "app-btn";
      a.textContent = app.name;
      a.dataset.index = String(i);
      a.rel = "noopener";
      return a;
    })
  );
}

function applyPlatformCopy() {
  if (IS_MOBILE) {
    $("pay-hint").textContent =
      "Opens your UPI app. If nothing happens, pick your app below.";
    return;
  }

  // On a desktop there is no upi:// handler, so the QR is the only route that
  // works. Lead with it rather than letting the button fail silently.
  document.body.classList.add("desktop");
  $("qr-title").textContent = "Scan with any UPI app to pay";
  $("pay-hint").textContent =
    "The button needs a phone. On a computer, scan the code above instead.";
}

/* ------------------------------------------------------------------ *
 * Boot
 * ------------------------------------------------------------------ */

function fail(title, message, setup) {
  $("loading").hidden = true;
  $("sheet").hidden = true;
  $("fatal").hidden = false;
  $("fatal-title").textContent = title;
  $("fatal-msg").textContent = message;
  if (setup) {
    $("fatal-setup").textContent = setup;
    $("fatal-setup").hidden = false;
  }
}

async function start() {
  const url = new URL(location.href);

  let res;
  try {
    res = await fetch("/api/config");
  } catch (e) {
    fail(
      "Cannot reach the server",
      "The page could not load its payment configuration.",
      "Running locally? Use:  npx vercel dev\n\nOpening index.html straight from disk will not work, because /api/config needs a server."
    );
    return;
  }

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    fail(
      "Not configured yet",
      data.message || "The payment details are missing.",
      data.missing
        ? data.missing.map((k) => k + "=...").join("\n")
        : null
    );
    return;
  }

  CONFIG = {
    vpa: data.vpa,
    payeeName: data.payeeName,
    currency: data.currency,
    merchantCode: data.merchantCode,
    symbol: data.currency === "INR" ? "₹" : "",
    // A per-transaction note and reference may come from the link you share.
    note: url.searchParams.get("tn") || data.note || "",
    ref: url.searchParams.get("tr") || "",
  };

  $("payee").textContent = CONFIG.payeeName;
  $("vpa").textContent = CONFIG.vpa;
  $("symbol").textContent = CONFIG.symbol;

  if (CONFIG.note) $("note").textContent = CONFIG.note;
  else $("note-block").hidden = true;

  // Amount precedence: the URL wins, then the configured default, then empty.
  const fromUrl = url.searchParams.get("am");
  const amountInput = $("amount");
  let locked = false;

  // Unique-amount mode: the server picks this payment's amount, and it is the
  // only thing that ties the money in the bank back to this payer.
  let payment = null;
  if (data.uniqueAmount) {
    payment = await obtainPayment();
    if (!payment) return;
    amountInput.value = payment.amount;
    locked = true;
    $("exact-hint").hidden = false;
  } else if (fromUrl && AMOUNT.test(fromUrl) && Number(fromUrl) > 0) {
    amountInput.value = fromUrl;
    locked = true; // A link that names a price should not be editable in the page.
  } else if (data.defaultAmount) {
    amountInput.value = data.defaultAmount;
    locked = data.lockAmount;
  }

  if (locked) {
    amountInput.hidden = true;
    $("amount-label").textContent = "Amount to pay";
    $("amount-fixed").textContent = CONFIG.symbol + amountInput.value;
    $("amount-fixed").hidden = false;
  } else {
    renderQuickAmounts();
  }

  renderApps();
  applyPlatformCopy();
  amountInput.addEventListener("input", update);
  update();
  if (payment) setupTracking(payment);

  $("loading").hidden = true;
  $("sheet").hidden = false;
}

/** Tap targets for common amounts, so a phone payer avoids the keyboard. */
function renderQuickAmounts() {
  const quick = $("quick");
  const values = ["100", "200", "500", "1000"];
  quick.replaceChildren(
    ...values.map((v) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "quick-btn";
      b.textContent = CONFIG.symbol + v;
      b.addEventListener("click", () => {
        $("amount").value = v;
        update();
      });
      return b;
    })
  );
  quick.hidden = false;
}

/* ------------------------------------------------------------------ *
 * Payment tracking (unique-amount mode)
 *
 * UPI tells the page nothing. Instead each payment gets its own amount, like
 * 10.37, so the owner can find it in their bank by amount alone. The payer
 * taps "I've paid"; the owner marks it verified on /admin.html; this page
 * only reflects what the owner decided.
 * ------------------------------------------------------------------ */

const PAYMENT_KEY = "upi-pay:payment-id";
const STATUS_COPY = {
  pending: ["Checking", "Thanks! We will confirm as soon as your payment shows up in our account."],
  verified: ["Paid", "Payment received. Thank you!"],
  rejected: ["Not received", "We could not find this payment. If money left your account, contact us."],
};
let payment = null;
let pollTimer = null;
let expiryTimer = null;

const remember = (id) => {
  try {
    if (id) localStorage.setItem(PAYMENT_KEY, id);
    else localStorage.removeItem(PAYMENT_KEY);
  } catch (e) {}
};

function savedId() {
  try {
    return localStorage.getItem(PAYMENT_KEY);
  } catch (e) {
    return null;
  }
}

async function call(method, body, query) {
  const res = await fetch("/api/payments" + (query || ""), {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.message || "Something went wrong. Try again.");
    err.status = res.status;
    throw err;
  }
  return data;
}

const isExpired = (p) => p.status === "awaiting" && Date.parse(p.expiresAt) <= Date.now();

/** Reuse this browser's payment across reloads, so a refresh does not burn an amount. */
async function obtainPayment() {
  const id = savedId();
  if (id) {
    try {
      const p = await call("GET", null, "?id=" + encodeURIComponent(id));
      if (!isExpired(p)) return p;
    } catch (e) {
      if (e.status !== 404) {
        fail("Cannot load your payment", e.message);
        return null;
      }
    }
  }
  try {
    const p = await call("POST", { ref: CONFIG.ref, note: CONFIG.note });
    remember(p.id);
    return p;
  } catch (e) {
    fail("Payment unavailable", e.message);
    return null;
  }
}

/** Swap in a fresh payment and its new amount. */
async function startNew(message) {
  try {
    const p = await call("POST", { ref: CONFIG.ref, note: CONFIG.note });
    remember(p.id);
    $("amount").value = p.amount;
    $("amount-fixed").textContent = CONFIG.symbol + p.amount;
    update();
    showPayment(p);
    if (message) showClaimError(message);
  } catch (e) {
    showClaimError(e.message);
  }
}

function showClaimError(msg) {
  $("claim-err").textContent = msg || "";
  $("claim-err").hidden = !msg;
}

function showPayment(p) {
  payment = p;
  clearInterval(pollTimer);
  clearTimeout(expiryTimer);
  showClaimError("");

  // Once settled, hide the QR and buttons so nobody pays the same amount twice.
  const settled = p.status === "verified" || p.status === "rejected";
  $("pay-block").hidden = settled;
  $("qr-block").hidden = settled;

  if (p.status === "awaiting") {
    $("claim-form").hidden = false;
    $("claim-status").hidden = true;
    // After its hour the amount may go to someone else, so hand out a new one.
    expiryTimer = setTimeout(() => {
      if (payment === p) startNew("That amount expired, so here is a new one. Please pay the amount shown now.");
    }, Math.max(0, Date.parse(p.expiresAt) - Date.now()));
    return;
  }

  const [badge, msg] = STATUS_COPY[p.status] || STATUS_COPY.pending;
  $("claim-form").hidden = true;
  $("claim-status").hidden = false;
  $("claim-status").dataset.state = p.status;
  $("status-badge").textContent = badge;
  $("status-msg").textContent = msg;
  $("status-meta").textContent = CONFIG.symbol + p.amount;
  $("claim-another").hidden = !settled;

  if (p.status === "pending") pollTimer = setInterval(refresh, 15000);
}

async function refresh() {
  if (document.hidden || !payment) return;
  try {
    showPayment(await call("GET", null, "?id=" + encodeURIComponent(payment.id)));
  } catch (e) {
    // Offline for a moment; the next tick retries.
  }
}

function setupTracking(p) {
  $("confirm-block").hidden = false;

  const btn = $("claim-submit");
  btn.addEventListener("click", async () => {
    btn.disabled = true;
    try {
      showPayment(await call("POST", { id: payment.id, action: "paid" }));
    } catch (e) {
      showClaimError(e.message);
    } finally {
      btn.disabled = false;
    }
  });

  $("claim-another").addEventListener("click", () => startNew());

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && payment && payment.status === "pending") refresh();
  });

  showPayment(p);
}

start();
