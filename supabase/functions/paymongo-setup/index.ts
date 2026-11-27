// CoolFix: isang beses na setup. Gumagawa ng PayMongo webhook gamit ang PAYMONGO_SECRET_KEY na nasa Secrets,
// at itinatago ang webhook secret sa pm_config (server lang ang nakakabasa). Walang key na ibinabalik o ipinapakita.
// Ligtas tawagin ulit: kapag may naka-save na, wala itong gagawin.
import { createClient } from "jsr:@supabase/supabase-js@2";

const out = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "access-control-allow-origin": "*" } });

Deno.serve(async (req) => {
  if (req.method !== "POST") return out({ error: "POST lang" }, 405);
  const SK = (Deno.env.get("PAYMONGO_SECRET_KEY") ?? "").trim().replace(/^["']|["']$/g, "");
  if (!/^sk_(test|live)_/.test(SK)) return out({ error: "walang PAYMONGO_SECRET_KEY" }, 503);
  const mode = SK.startsWith("sk_live_") ? "live" : "test";
  const url = Deno.env.get("SUPABASE_URL")!;
  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

  const key = "webhook_secret", idKey = "webhook_id_" + mode;
  const { data: have } = await admin.from("pm_config").select("key, value").in("key", [key, "webhook_mode"]);
  const got = Object.fromEntries((have ?? []).map((r) => [r.key, r.value]));
  if (got[key] && got.webhook_mode === mode) return out({ status: "already", mode });

  const auth = { authorization: "Basic " + btoa(SK + ":"), accept: "application/json", "content-type": "application/json" };
  // Iba't ibang URL kada setup para hindi bumangga sa lumang webhook na pareho ang URL
  const hook = `${url}/functions/v1/paymongo-webhook?k=${crypto.randomUUID().slice(0, 8)}`;
  const r = await fetch("https://api.paymongo.com/v1/webhooks", {
    method: "POST", headers: auth,
    body: JSON.stringify({ data: { attributes: { url: hook, events: ["checkout_session.payment.paid"] } } }),
  });
  const j = await r.json().catch(() => ({}));
  const secret = j?.data?.attributes?.secret_key as string | undefined, id = j?.data?.id as string | undefined;
  if (!r.ok || !secret || !id) {
    console.error("PayMongo webhook create", r.status, JSON.stringify(j?.errors ?? j));
    return out({ error: "Hindi nagawa ang webhook", status: r.status, detail: (j?.errors ?? []).map((e: any) => e?.detail).join("; ") }, 502);
  }
  const now = new Date().toISOString();
  const { error } = await admin.from("pm_config").upsert([
    { key, value: secret, updated_at: now }, { key: "webhook_mode", value: mode, updated_at: now }, { key: idKey, value: id, updated_at: now },
  ]);
  if (error) { console.error("pm_config", error.message); return out({ error: "Hindi na-save" }, 500); }
  return out({ status: "created", mode, webhook_id: id });
});
