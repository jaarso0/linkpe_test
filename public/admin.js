"use strict";

/* Owner page: list payment claims and mark them verified or rejected.
 * The token lives in sessionStorage only, so closing the tab locks it. */

const $ = (id) => document.getElementById(id);
const TOKEN_KEY = "upi-pay:admin-token";

let token = "";
let filter = "pending";
let claims = [];

const store = {
  get: () => {
    try { return sessionStorage.getItem(TOKEN_KEY) || ""; } catch (e) { return ""; }
  },
  set: (v) => {
    try { v ? sessionStorage.setItem(TOKEN_KEY, v) : sessionStorage.removeItem(TOKEN_KEY); } catch (e) {}
  },
};

async function api(method, body) {
  const res = await fetch("/api/admin", {
    method,
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.message || "Request failed (" + res.status + ")");
    err.status = res.status;
    throw err;
  }
  return data;
}

function showError(id, msg) {
  $(id).textContent = msg || "";
  $(id).hidden = !msg;
}

async function load() {
  showError("board-err", "");
  try {
    claims = (await api("GET")).payments;
    $("login").hidden = true;
    $("board").hidden = false;
    render();
  } catch (e) {
    if (e.status === 401) return lock("Wrong admin token.");
    if (!$("board").hidden) showError("board-err", e.message);
    else showError("login-err", e.message);
  }
}

function lock(msg) {
  token = "";
  store.set("");
  $("board").hidden = true;
  $("login").hidden = false;
  showError("login-err", msg || "");
}

const fmtTime = (iso) => (iso ? new Date(iso).toLocaleString() : "");
const LABEL = { awaiting: "not tapped", pending: "says paid", verified: "verified", rejected: "rejected" };

function render() {
  const q = $("search").value.trim().replace(/^₹/, "");
  let shown = claims;
  // Searching by amount looks across every status: the credit is what you trust.
  if (q) shown = shown.filter((c) => c.amount.startsWith(q));
  else if (filter !== "all") shown = shown.filter((c) => c.status === filter);
  const list = $("list");

  if (!shown.length) {
    const p = document.createElement("p");
    p.className = "empty";
    p.textContent = q
      ? "No payment with that amount."
      : filter === "pending" ? "Nobody is waiting for confirmation." : "Nothing here.";
    return list.replaceChildren(p);
  }

  list.replaceChildren(
    ...shown.map((c) => {
      const card = document.createElement("div");
      card.className = "claim";

      const top = document.createElement("div");
      const amt = document.createElement("span");
      amt.className = "amt mono";
      amt.textContent = "₹" + c.amount + "  ";
      const pill = document.createElement("span");
      pill.className = "pill " + c.status;
      pill.textContent = LABEL[c.status] || c.status;
      top.append(amt, pill);

      const when = document.createElement("div");
      when.className = "when";
      when.textContent = c.paidAt ? "Tapped “I've paid” " + fmtTime(c.paidAt) : "Amount shown " + fmtTime(c.createdAt);

      const meta = document.createElement("div");
      meta.className = "meta";
      meta.textContent = [
        c.ref && "Ref " + c.ref,
        c.note,
        "Amount held until " + fmtTime(c.expiresAt),
        c.reviewedAt && "Reviewed " + fmtTime(c.reviewedAt),
      ].filter(Boolean).join(" · ");

      const actions = document.createElement("div");
      actions.className = "actions";
      const btn = (label, cls, status) => {
        const b = document.createElement("button");
        b.className = "act " + cls;
        b.textContent = label;
        b.addEventListener("click", () => setStatus(c.id, status, b));
        return b;
      };
      if (c.status !== "verified") actions.append(btn("Verify", "ok", "verified"));
      if (c.status !== "rejected") actions.append(btn("Reject", "no", "rejected"));
      if (c.status === "verified" || c.status === "rejected") {
        actions.append(btn("Undo", "", c.paidAt ? "pending" : "awaiting"));
      }

      card.append(top, actions, when, meta);
      return card;
    })
  );
}

async function setStatus(id, status, button) {
  button.disabled = true;
  try {
    const updated = await api("POST", { id, status });
    claims = claims.map((c) => (c.id === id ? updated : c));
    render();
  } catch (e) {
    if (e.status === 401) return lock("Session expired. Enter the token again.");
    showError("board-err", e.message);
    button.disabled = false;
  }
}

$("login").addEventListener("submit", (e) => {
  e.preventDefault();
  token = $("token").value.trim();
  if (!token) return showError("login-err", "Enter the token.");
  store.set(token);
  showError("login-err", "");
  load();
});

document.querySelectorAll("[data-filter]").forEach((b) =>
  b.addEventListener("click", () => {
    filter = b.dataset.filter;
    document.querySelectorAll("[data-filter]").forEach((x) =>
      x.setAttribute("aria-pressed", String(x === b))
    );
    render();
  })
);

$("refresh").addEventListener("click", load);
$("search").addEventListener("input", render);
$("logout").addEventListener("click", () => lock(""));

token = store.get();
if (token) load();
