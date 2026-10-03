// Payment storage. Files under api/_lib are not turned into functions.
//
// Production (Vercel): Upstash Redis over its REST API, so there is nothing to
// install. Add "Upstash for Redis" from the Vercel Marketplace and it injects
// KV_REST_API_URL / KV_REST_API_TOKEN (or set UPSTASH_REDIS_REST_URL / _TOKEN).
//
// Local dev: a JSON file at data/store.json. Vercel's disk is read-only and
// wiped between invocations, so the file store refuses to run there.
//
// Two kinds of data:
//   payments  one record per payment, kept forever as history
//   slots     "this amount is taken" locks that expire on their own, which is
//             what makes an amount unique for an hour and reusable after it

const fs = require("fs");
const path = require("path");

const HASH = "upi:payments";
const SLOT = "upi:slot:";

function redisConfig() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url, token } : null;
}

async function redis(cmd) {
  const { url, token } = redisConfig();
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body: JSON.stringify(cmd),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) throw new Error("Redis: " + (data.error || res.status));
  return data.result;
}

const FILE = path.join(__dirname, "..", "..", "data", "store.json");

function readFile() {
  try {
    const d = JSON.parse(fs.readFileSync(FILE, "utf8"));
    return { payments: d.payments || {}, slots: d.slots || {} };
  } catch (e) {
    return { payments: {}, slots: {} };
  }
}

function writeFile(d) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(d, null, 2));
}

function assertUsable() {
  if (!redisConfig() && process.env.VERCEL) {
    const err = new Error(
      "No database configured. Add Upstash for Redis to this project on Vercel " +
        "(Storage tab), which sets KV_REST_API_URL and KV_REST_API_TOKEN, then redeploy."
    );
    err.code = "no_store";
    throw err;
  }
}

/** Take the lock on `name` for `seconds`. False if someone already holds it. */
async function claimSlot(name, seconds) {
  assertUsable();
  if (redisConfig()) {
    return (await redis(["SET", SLOT + name, "1", "NX", "EX", String(seconds)])) === "OK";
  }
  const d = readFile();
  const now = Date.now();
  if (d.slots[name] > now) return false;
  d.slots[name] = now + seconds * 1000;
  for (const k of Object.keys(d.slots)) if (d.slots[k] <= now) delete d.slots[k];
  writeFile(d);
  return true;
}

async function get(id) {
  assertUsable();
  if (redisConfig()) {
    const raw = await redis(["HGET", HASH, id]);
    return raw ? JSON.parse(raw) : null;
  }
  return readFile().payments[id] || null;
}

async function list() {
  assertUsable();
  let records;
  if (redisConfig()) {
    const flat = (await redis(["HGETALL", HASH])) || [];
    records = [];
    for (let i = 1; i < flat.length; i += 2) records.push(JSON.parse(flat[i]));
  } else {
    records = Object.values(readFile().payments);
  }
  return records.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

async function save(record) {
  assertUsable();
  if (redisConfig()) {
    await redis(["HSET", HASH, record.id, JSON.stringify(record)]);
    return;
  }
  const d = readFile();
  d.payments[record.id] = record;
  writeFile(d);
}

module.exports = { claimSlot, get, list, save };
