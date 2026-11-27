// CoolFix: gumawa ng PayMongo checkout para sa top-up ng Tech Wallet.
// Tinatawag ng app (naka-login na technician). Ibinabalik ang checkout_url na bubuksan ng app.
// Kailangang secret sa Supabase > Edge Functions > Secrets: PAYMONGO_SECRET_KEY (sk_test_... muna, saka sk_live_...).
// Naka-off ang JWT check ng Supabase (--no-verify-jwt); ang function mismo ang nagche-check ng login sa ibaba.
// Opsyonal: PAYMONGO_METHODS (hal. "gcash,paymaya,card"), APP_URL (hal. "https://coollfix.com/").
import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const out = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "content-type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return out({ error: "POST lang" }, 405);

  const SK = (Deno.env.get("PAYMONGO_SECRET_KEY") ?? "").trim().replace(/^["']|["']$/g, "");
  if (!/^sk_(test|live)_/.test(SK)) {
    // Walang ibinubunyag na key; uri lang ng problema para madaling ayusin
    const why = !SK ? "walang PAYMONGO_SECRET_KEY" : SK.startsWith("pk_") ? "public key (pk_) ang nailagay, dapat secret key (sk_)" : "hindi sk_test_ o sk_live_ ang simula";
    return out({ error: "Hindi pa naka-set up ang online na bayad. Makipag-ugnayan sa admin.", setup: why }, 503);
  }

  const url = Deno.env.get("SUPABASE_URL")!;
  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

  // Sino ang nagtatanong (mula sa login token ng app)
  const jwt = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: who } = await admin.auth.getUser(jwt);
  const uid = who?.user?.id;
  if (!uid) return out({ error: "Mag-login muna." }, 401);

  const { data: prof } = await admin.from("profiles").select("id, role, name, email").eq("id", uid).single();
  if (!prof || prof.role !== "technician") return out({ error: "Technician lang ang pwedeng mag-top up." }, 403);

  const { data: on } = await admin.from("settings").select("value").eq("key", "paymongo_on").maybeSingle();
  if (on?.value !== true) return out({ error: "Naka-off pa ang online na top-up." }, 403);

  let body: { amt?: unknown } = {};
  try { body = await req.json(); } catch { /* walang laman */ }
  const amt = Math.round(Number(body.amt));
  if (!(amt >= 100 && amt <= 50000)) return out({ error: "Ang halaga ay dapat ₱100 hanggang ₱50,000." }, 400);

  // Iwas spam: hanggang 5 hindi pa bayad na checkout sa loob ng 1 oras
  await admin.rpc("pm_expire_old");
  const since = new Date(Date.now() - 3600e3).toISOString();
  const { count } = await admin.from("topups").select("id", { count: "exact", head: true })
    .eq("tech_id", uid).eq("method", "paymongo").eq("status", "naghihintay").gte("created_at", since);
  if ((count ?? 0) >= 5) return out({ error: "Marami ka pang hindi natapos na bayad. Subukan ulit mamaya." }, 429);

  const app = (Deno.env.get("APP_URL") ?? "https://coollfix.com/").replace(/\/?$/, "/");
  const methods = (Deno.env.get("PAYMONGO_METHODS") ?? "gcash,paymaya,card").split(",").map((s) => s.trim()).filter(Boolean);

  const pm = await fetch("https://api.paymongo.com/v1/checkout_sessions", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json", authorization: "Basic " + btoa(SK + ":") },
    body: JSON.stringify({
      data: {
        attributes: {
          line_items: [{ name: "CoolFix Wallet credits", amount: amt * 100, currency: "PHP", quantity: 1 }],
          payment_method_types: methods,
          description: `Top-up ng Tech Wallet (${amt} credits)`,
          success_url: app + "?topup=ok",
          cancel_url: app + "?topup=cancel",
          send_email_receipt: !!prof.email,
          show_description: true,
          show_line_items: true,
          ...(prof.email ? { billing: { name: prof.name || "CoolFix Technician", email: prof.email } } : {}),
          metadata: { tech_id: uid, amt: String(amt), app: "coolfix" },
        },
      },
    }),
  });
  const j = await pm.json().catch(() => ({}));
  const sess = j?.data?.id as string | undefined, checkout = j?.data?.attributes?.checkout_url as string | undefined;
  if (!pm.ok || !sess || !checkout) {
    console.error("PayMongo error", pm.status, JSON.stringify(j?.errors ?? j));
    return out({ error: "Hindi makakonekta sa PayMongo ngayon. Subukan ulit." }, 502);
  }

  const { error } = await admin.from("topups").insert({ tech_id: uid, amt, method: "paymongo", ref: sess });
  if (error) {
    console.error("topup insert", error.message);
    return out({ error: "Hindi na-save ang top-up. Subukan ulit." }, 500);
  }
  return out({ checkout_url: checkout });
});
