// CoolFix: tinatawag ng PayMongo kapag bayad na ang checkout. Dito pumapasok ang credits sa Tech Wallet.
// Kailangang secret: PAYMONGO_SECRET_KEY. Ang webhook secret (whsk_...) ay galing sa Secrets (PAYMONGO_WEBHOOK_SECRET)
// o, kung wala, sa table na pm_config na pinupunan ng paymongo-setup.
// I-deploy nang walang JWT check (--no-verify-jwt), dahil PayMongo ang tumatawag, hindi ang app.
import { createClient } from "jsr:@supabase/supabase-js@2";

const enc = new TextEncoder();
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
const same = (a: string, b: string) => {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
};
async function hmac(secret: string, msg: string) {
  const k = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", k, enc.encode(msg)));
}
const ok = (msg = "ok", status = 200) => new Response(msg, { status });

// Secret key ng PayMongo: ang live key (COOLFIX_LIVE_KEY o "COOLFIX_LIVE KEY") kung meron, kung wala ay PAYMONGO_SECRET_KEY.
function pmKey(): { key: string; from: string } {
  const env = Deno.env.toObject();
  const clean = (v?: string) => (v ?? "").trim().replace(/^["']|["']$/g, "");
  const names = Object.keys(env).filter((n) => /^COOLFIX[\s_-]*LIVE[\s_-]*KEY$/i.test(n.trim()));
  for (const n of names) { const v = clean(env[n]); if (/^sk_(test|live)_/.test(v)) return { key: v, from: n }; }
  return { key: clean(env.PAYMONGO_SECRET_KEY), from: "PAYMONGO_SECRET_KEY" };
}

Deno.serve(async (req) => {
  const clean = (k: string) => (Deno.env.get(k) ?? "").trim().replace(/^["']|["']$/g, "");
  const PK = pmKey(), SK = PK.key;
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  // Webhook secret: mula sa Secrets, o mula sa pm_config (ginawa ng paymongo-setup)
  let WH = clean("PAYMONGO_WEBHOOK_SECRET");
  if (!WH) { const { data } = await admin.from("pm_config").select("value").eq("key", "webhook_secret").maybeSingle(); WH = (data?.value ?? "").trim(); }
  // GET: pang-check lang kung kumpleto ang setup (walang ibinubunyag na key)
  if (req.method === "GET") return new Response(JSON.stringify({ secret_key: /^sk_(test|live)_/.test(SK) ? SK.slice(0, 8) : !!SK, from: PK.from, webhook_secret: WH.startsWith("whsk_") ? true : !!WH && "iba ang simula" }), { headers: { "content-type": "application/json", "access-control-allow-origin": "*" } });
  if (req.method !== "POST") return ok("POST lang", 405);
  if (!WH || !SK) { console.error("Kulang ang secrets"); return ok("not configured", 503); }

  const raw = await req.text();
  // 1) Suriin ang pirma ng PayMongo
  const parts = Object.fromEntries((req.headers.get("paymongo-signature") ?? "").split(",").map((p) => {
    const i = p.indexOf("="); return [p.slice(0, i).trim(), p.slice(i + 1).trim()];
  }));
  let ev: any;
  try { ev = JSON.parse(raw); } catch { return ok("bad json", 400); }
  const live = ev?.data?.attributes?.livemode === true;
  const sig = live ? parts.li : parts.te;
  if (!parts.t || !sig || !same(await hmac(WH, `${parts.t}.${raw}`), sig)) {
    console.warn("Maling pirma");
    return ok("bad signature", 401);
  }
  // Test key = test event lang; live key = live event lang
  if (live !== SK.startsWith("sk_live_")) return ok("mode mismatch, ignored");

  const type = ev?.data?.attributes?.type;
  if (type !== "checkout_session.payment.paid") return ok("ignored");
  const sess = ev?.data?.attributes?.data?.id as string | undefined;
  if (!sess || !sess.startsWith("cs_")) return ok("no session", 400);

  // 2) Kumpirmahin mismo sa PayMongo (hindi lang umaasa sa laman ng mensahe)
  const r = await fetch(`https://api.paymongo.com/v1/checkout_sessions/${encodeURIComponent(sess)}`, {
    headers: { accept: "application/json", authorization: "Basic " + btoa(SK + ":") },
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { console.error("PayMongo GET", r.status, JSON.stringify(j?.errors ?? j)); return ok("retry", 502); }
  const pays = ((j?.data?.attributes?.payments ?? []) as any[]).filter((p) => p?.attributes?.status === "paid");
  if (!pays.length) return ok("not paid yet");
  const centavos = pays.reduce((s, p) => s + Number(p.attributes.amount || 0), 0);
  const via = String(pays[0]?.attributes?.source?.type ?? "").replace("paymaya", "maya");

  // 3) Ipasok ang credits (isang beses lang, kahit ilang beses tumawag ang PayMongo)
  const { data, error } = await admin.rpc("pm_paid", { sess, pay_id: pays[0].id, centavos, via });
  if (error) { console.error("pm_paid", error.message); return ok("retry", 500); }
  console.log("pm_paid", sess, data);
  return ok(String(data));
});
