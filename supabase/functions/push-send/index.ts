// CoolFix: nagpapadala ng push notification (Web Push) mula sa push_outbox (017_engagement.sql).
// Tinatawag ng database (pg_net) tuwing may bagong notification, at bawat 5 minuto ng cron.
// Ang VAPID keys ay nasa pm_config (server lang): vapid_public, vapid_private, vapid_subject.
// I-deploy nang walang JWT check (--no-verify-jwt). Ligtas ito: ang kaya lang nito ay ipadala ang mga nakapila na.
import webpush from "npm:web-push@3.6.7";
import { createClient } from "jsr:@supabase/supabase-js@2";

const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } });

Deno.serve(async () => {
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const { data: cfgRows } = await admin.from("pm_config").select("key,value").in("key", ["vapid_public", "vapid_private", "vapid_subject"]);
  const cfg = Object.fromEntries((cfgRows ?? []).map((r) => [r.key, String(r.value).trim()]));
  if (!cfg.vapid_public || !cfg.vapid_private) return json({ error: "Walang VAPID keys sa pm_config" }, 503);
  webpush.setVapidDetails(cfg.vapid_subject || "https://coollfix.com", cfg.vapid_public, cfg.vapid_private);

  let sent = 0, failed = 0, rounds = 0;
  const gone = new Set<number>();
  while (rounds++ < 5) {
    const { data: rows, error } = await admin.rpc("push_claim", { n: 200 });
    if (error) return json({ error: error.message }, 500);
    if (!rows?.length) break;
    const users = [...new Set(rows.map((r: { user_id: string }) => r.user_id))];
    const { data: subs } = await admin.from("push_subs").select("id,user_id,endpoint,p256dh,auth").in("user_id", users);
    const jobs: Promise<void>[] = [];
    for (const r of rows) {
      const payload = JSON.stringify({ t: r.title, b: r.body, u: r.url, g: r.tag });
      for (const s of (subs ?? []).filter((x) => x.user_id === r.user_id && !gone.has(x.id))) {
        jobs.push(webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 6 * 3600, urgency: "high" })
          .then(() => { sent++; })
          .catch((e: { statusCode?: number; body?: string }) => {
            if (e.statusCode === 404 || e.statusCode === 410) gone.add(s.id);
            else { failed++; console.warn("push fail", e.statusCode, e.body); }
          }));
      }
    }
    await Promise.all(jobs);
    if (rows.length < 200) break;
  }
  if (gone.size) await admin.from("push_subs").delete().in("id", [...gone]);
  return json({ sent, failed, removed: gone.size });
});
