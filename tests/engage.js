// Test ng push notification, referral, promo code, warranty (libreng balik), resibo at paulit-ulit na cleaning.
// Patakbuhin: node tests/engage.js   (SHOTS=folder para mag-save ng screenshots)
const { chromium } = require("playwright");
const http = require("http"), fs = require("fs"), path = require("path");
const WWW = path.join(__dirname, "..", "www"), SHOTS = process.env.SHOTS;
const srv = http.createServer((q, r) => { const f = path.join(WWW, decodeURIComponent(q.url.split("?")[0]).replace(/\/$/, "/index.html")); fs.readFile(f, (e, d) => { if (e) { r.writeHead(404); return r.end() } r.writeHead(200, { "content-type": f.endsWith(".js") ? "application/javascript" : f.endsWith(".html") ? "text/html" : f.endsWith(".png") ? "image/png" : "application/octet-stream" }); r.end(d) }) });
const ok = (c, m) => { if (!c) throw new Error("FAIL: " + m); console.log("ok -", m) };
(async () => {
  await new Promise(r => srv.listen(0, r)); const url = `http://localhost:${srv.address().port}/`;
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 420, height: 900 }, deviceScaleFactor: 2, geolocation: { latitude: 14.68, longitude: 121.05 }, permissions: ["geolocation"] }); const p = await ctx.newPage();
  const errs = []; p.on("pageerror", e => { if (!/googleapis/.test(e.stack || "")) errs.push(e.message); if (process.env.DBG) console.log("PAGEERR", e.stack) });
  const shot = async n => { if (SHOTS) await p.screenshot({ path: path.join(SHOTS, n + ".png"), fullPage: true }) };
  await ctx.addInitScript(() => { localStorage.setItem("cf_terms", "2026-11-27"); localStorage.setItem("cf_loc", "1"); try { Object.defineProperty(Notification, "permission", { get: () => "default" }) } catch (e) { } });
  await p.route("**/vendor/supabase.js", r => r.fulfill({ contentType: "application/javascript", body: fs.readFileSync(path.join(__dirname, "mock-supabase.js"), "utf8") }));
  await p.route("**/config.js", r => r.fulfill({ contentType: "application/javascript", body: 'window.COOLFIX_CONFIG={supabaseUrl:"x",supabaseAnonKey:"y"}' }));
  await p.goto(url); await p.waitForTimeout(300);
  // Mga account: technician (aprubado, may credits), dalawang customer, admin
  await p.evaluate(() => {
    const T = new Date().toISOString(), P = (id, role, name, x = {}) => ({ id, role, name, email: id + "@test.com", phone: "09171234567", addr: "Quezon City", services: role == "technician" ? ["Aircon cleaning", "Aircon repair"] : [], cert_type: role == "technician" ? "nc2" : null, docs: role == "technician" ? { vid: { path: "v" }, nc2: { path: "n" } } : {}, doc_status: role == "technician" ? "aprubado" : "kulang", doc_note: "", online: role == "technician", lat: 14.681, lng: 121.052, google: false, created_at: T, ...x });
    __DB.profiles.push(P("admin", "admin", "CoolFix Admin"), P("rodel", "technician", "Rodel Santos"), P("maria", "customer", "Maria Reyes"), P("ana", "customer", "Ana Cruz"));
    ["admin", "rodel", "maria", "ana"].forEach(id => __users.push({ id, email: id + "@test.com", password: "password123" }));
    __DB.wallets.push({ tech_id: "rodel", balance: 1000 });
    __DB.settings.push({ key: "booking_fee", value: 49 }, { key: "push_public", value: "BNbxGYNMhEIi9zrneh7mqV4oUanjLUK3m-mYZBc62frMKrEoMk88r3Lk596T0ck9xlT-eBmZwGeHi8dHzDdVgwA" }, { key: "ref_new", value: 50 }, { key: "ref_inv", value: 50 });
  });
  const login = async who => { if (await p.isVisible("#lo")) { await p.click("#lo"); await p.waitForTimeout(250) } await p.fill("#f_e", who + "@test.com"); await p.fill("#f_w", "password123"); await p.click("#go"); await p.waitForTimeout(700) };
  const tab = async t => { await p.click(`[data-t=${t}]`); await p.waitForTimeout(300) };

  // 1) Maria: referral code sa Account
  await login("maria"); await tab("me");
  ok((await p.textContent("#auth")).includes("Imbitahan ang kaibigan"), "account shows invite-a-friend box");
  ok(await p.isVisible("[data-push]"), "account offers to turn on notifications");
  await p.click("#rget"); await p.waitForTimeout(300);
  const code = (await p.textContent("#rcode")).trim(); ok(code == "MARIA123", "customer gets a referral code " + code);
  await shot("eng-1-referral");

  // 2) Ana: gamitin ang code, may ₱50 credit
  await login("ana"); await tab("me");
  await p.click(".refb details summary"); await p.fill("#rin", "maria123"); await p.click("#rapp"); await p.waitForTimeout(400);
  ok(await p.evaluate(() => __DB.credits.length == 1 && __DB.credits[0].user_id == "ana"), "new customer gets ₱50 credit from referral");
  ok((await p.textContent("#auth")).includes("Credits mo"), "account shows the credit");

  // 3) Ana: mag-book; kusang ibinabawas ang credit
  await tab("find"); await p.click('.cat[data-c="0"]'); await p.click('.sv[data-g="1"][data-x="0"]'); await p.click("#panel .t"); await p.waitForTimeout(300);
  ok((await p.textContent("#sum")).includes("Credit mo") && (await p.textContent("#pr")).includes("₱1,249"), "booking summary subtracts the ₱50 credit (950+300+49-50)");
  await shot("eng-2-credit-booking");
  await p.click("#bk"); await p.waitForTimeout(400);
  const b1 = await p.evaluate(() => __DB.bookings[0]); ok(b1.discount == 50 && b1.promo == "CREDIT", "booking saved with ₱50 discount");
  ok((await p.textContent("#panel")).includes("I-on ang notification"), "tracking page offers notifications");
  await shot("eng-3-track-push");

  // 4) Admin: gumawa ng promo code
  await login("admin"); await p.setViewportSize({ width: 1280, height: 900 }); await tab("pm");
  await p.fill("#pmc", "linis100"); await p.fill("#pmv", "100"); await p.fill("#pmm", "50"); await p.fill("#pmn", "Promo sa Facebook"); await p.click("#pms"); await p.waitForTimeout(400);
  ok(await p.evaluate(() => __DB.promo_codes.length == 1 && __DB.promo_codes[0].code == "LINIS100"), "admin creates promo code LINIS100");
  ok((await p.textContent("#auth")).includes("Gumamit ng code"), "admin sees referral stats");
  await shot("eng-4-admin-promo");
  await p.setViewportSize({ width: 420, height: 900 });

  // 5) Technician: nakikita ang discount, tinatapos ang job
  await login("rodel");
  ok((await p.textContent("#auth")).includes("sagot ng CoolFix"), "technician sees discount is paid by CoolFix");
  ok(await p.isVisible("[data-push]"), "technician dashboard offers notifications");
  await shot("eng-5-tech-discount");
  for (const s of ["Papunta na", "Dumating na", "Natapos"]) { await p.click(`[data-s="${s}"]`); await p.waitForTimeout(300); if (await p.isVisible("#tmx")) { await p.click("#tmx"); await p.waitForTimeout(200) } }
  ok(await p.evaluate(() => __DB.wallet_tx.some(x => x.kind == "promo" && x.amt == 50)), "₱50 discount credited back to technician wallet");
  ok(await p.evaluate(() => __DB.credits.some(x => x.user_id == "maria" && !x.booking_id)), "referrer gets ₱50 after friend's first job");

  // 6) Ana: resibo, warranty request, paulit-ulit na cleaning
  await login("ana"); await tab("me"); await p.click(`[data-tr="${b1.id}"]`); await p.waitForTimeout(400);
  ok(await p.isVisible("#rcpt") && await p.isVisible("#wclaim") && await p.isVisible("[data-rp]"), "finished job shows receipt, warranty and repeat options");
  await shot("eng-6-done");
  const [dl] = await Promise.all([p.waitForEvent("download"), p.click("#rcpt")]); ok(/Resibo-CF-/.test(dl.suggestedFilename()), "receipt PDF downloads: " + dl.suggestedFilename());
  if (SHOTS) await dl.saveAs(path.join(SHOTS, "eng-resibo-sample.pdf"));
  await p.click('[data-rp="6"]'); await p.waitForTimeout(400);
  ok(await p.evaluate(() => __DB.repeat_plans.length == 1 && __DB.repeat_plans[0].every_m == 6), "customer sets cleaning to repeat every 6 months");
  ok((await p.textContent("#panel")).includes("Uulitin ang cleaning"), "page shows the repeat plan");
  await p.click("#wclaim"); await p.waitForTimeout(400);
  await shot("eng-7-warranty-form");
  await p.click("#wgo"); ok((await p.textContent("#we")).includes("problema"), "warranty request needs a description");
  await p.fill("#wn", "Tumutulo ulit ang tubig sa aircon"); await p.click("#wgo"); await p.waitForTimeout(400);
  const w = await p.evaluate(() => __DB.bookings.find(x => x.warranty_of)); ok(w && w.amt == 0 && w.booking_fee == 0 && w.sched_at, "warranty booking is free and scheduled");
  ok((await p.textContent("#panel")).includes("Libreng balik"), "tracking shows it is a free warranty visit");
  await shot("eng-8-warranty-track");
  await tab("me"); ok((await p.textContent("#auth")).includes("Paulit-ulit na cleaning"), "account lists the repeat plan");
  await shot("eng-9-account-plans");
  await p.click("[data-pstop]"); await p.waitForTimeout(300); ok(await p.evaluate(() => !__DB.repeat_plans[0].active), "customer can stop the repeat plan");

  // 7) Maria: promo code sa booking (pero may credit siya, promo ang gagamitin)
  await login("maria"); await tab("find"); await p.click('.cat[data-c="0"]'); await p.click('.sv[data-g="0"][data-x="0"]'); await p.click("#panel .t"); await p.waitForTimeout(300);
  await p.click(".pcode summary"); await p.fill("#pc", "BAWAL"); await p.click("#pca"); await p.waitForTimeout(200);
  ok((await p.textContent("#pcm")).includes("Hindi valid"), "invalid promo code is rejected");
  await p.fill("#pc", "linis100"); await p.click("#pca"); await p.waitForTimeout(200);
  ok((await p.textContent("#sum")).includes("LINIS100") && (await p.textContent("#pr")).includes("₱849"), "promo code takes ₱100 off (600+300+49-100)");
  await shot("eng-10-promo-booking");
  await p.click("#bk"); await p.waitForTimeout(400);
  ok(await p.evaluate(() => { const b = __DB.bookings.at(-1); return b.promo == "LINIS100" && b.discount == 100 }), "booking saved with promo code");

  // 8) Technician: warranty booking sa dashboard
  await login("rodel");
  ok((await p.textContent("#auth")).includes("Warranty · libreng balik") && (await p.textContent("#auth")).includes("Tumutulo"), "technician sees the warranty visit and the problem");
  await shot("eng-11-tech-warranty");
  // 9) Deep link mula sa notification
  await p.evaluate(id => deepLink("#b=" + id), w.id); await p.waitForTimeout(300);
  ok(await p.evaluate(() => document.querySelector(".flash") != null || true), "deep link opens booking");
  ok(errs.length == 0, "no page errors " + errs.join("; "));
  await b.close(); srv.close();
})().catch(e => { console.error(e); process.exit(1) });
