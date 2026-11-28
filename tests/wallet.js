// Test ng Tech Wallet, top-up, quote, bayad, warranty at rating gamit ang mock ng Supabase.
// Patakbuhin: node tests/wallet.js   (SHOTS=folder para mag-save ng screenshots)
const { chromium } = require("playwright");
const http = require("http"), fs = require("fs"), path = require("path");
const WWW = path.join(__dirname, "..", "www"), SHOTS = process.env.SHOTS;
const srv = http.createServer((q, r) => { const f = path.join(WWW, decodeURIComponent(q.url.split("?")[0]).replace(/\/$/, "/index.html")); fs.readFile(f, (e, d) => { if (e) { r.writeHead(404); return r.end() } r.writeHead(200, { "content-type": f.endsWith(".js") ? "application/javascript" : f.endsWith(".html") ? "text/html" : f.endsWith(".png") ? "image/png" : "application/octet-stream" }); r.end(d) }) });
const ok = (c, m) => { if (!c) throw new Error("FAIL: " + m); console.log("ok -", m) };
(async () => {
  await new Promise(r => srv.listen(0, r)); const url = `http://localhost:${srv.address().port}/`;
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 420, height: 900 }, deviceScaleFactor: 2, geolocation: { latitude: 14.68, longitude: 121.05 }, permissions: ["geolocation"] }); const p = await ctx.newPage();
  const errs = []; p.on("pageerror", e => { if (!/googleapis/.test(e.stack || "")) errs.push(e.message) });
  const shot = async n => { if (SHOTS) await p.screenshot({ path: path.join(SHOTS, n + ".png"), fullPage: true }) };
  await ctx.addInitScript(() => { localStorage.setItem("cf_terms", "2026-11-27"); localStorage.setItem("cf_loc", "1") });
  await p.route("**/vendor/supabase.js", r => r.fulfill({ contentType: "application/javascript", body: fs.readFileSync(path.join(__dirname, "mock-supabase.js"), "utf8") }));
  await p.route("**/config.js", r => r.fulfill({ contentType: "application/javascript", body: 'window.COOLFIX_CONFIG={supabaseUrl:"x",supabaseAnonKey:"y"}' }));
  await p.goto(url); await p.waitForTimeout(300);
  // Mga account: admin, technician (aprubado, offline), customer. Naka-on ang minimum na wallet balance.
  await p.evaluate(() => {
    const T = new Date().toISOString(), P = (id, role, name, x = {}) => ({ id, role, name, email: id + "@test.com", phone: "09171234567", addr: "Quezon City", services: role == "technician" ? ["Aircon cleaning", "Aircon repair"] : [], cert_type: role == "technician" ? "nc2" : null, docs: role == "technician" ? { vid: { path: "v" }, nc2: { path: "n" } } : {}, doc_status: role == "technician" ? "aprubado" : "kulang", doc_note: "", online: false, lat: 14.681, lng: 121.052, google: false, created_at: T, ...x });
    __DB.profiles.push(P("admin", "admin", "CoolFix Admin"), P("rodel", "technician", "Rodel Santos"), P("maria", "customer", "Maria Reyes", { phone: "09181234567" }));
    ["admin", "rodel", "maria"].forEach(id => __users.push({ id, email: id + "@test.com", password: "password123" }));
    __DB.settings.push({ key: "wallet_required", value: true }, { key: "wallet_min", value: 200 }, { key: "booking_fee", value: 49 }, { key: "topup_info", value: { gcash: { number: "09171112222", name: "CoolFix" }, maya: { number: "", name: "" } } });
  });
  const login = async who => { if (await p.isVisible("#lo")) { await p.click("#lo"); await p.waitForTimeout(200) } await p.fill("#f_e", who + "@test.com"); await p.fill("#f_w", "password123"); await p.click("#go"); await p.waitForTimeout(600) };

  // 1) Technician na walang credits: hindi makakapag-online
  await login("rodel");
  ok(await p.isDisabled("#ol") && (await p.textContent("#ol")).includes("wallet"), "technician with no credits cannot go online");
  ok((await p.textContent(".wmini")).includes("₱0"), "dashboard shows wallet balance");
  await shot("wallet-1-tech-kulang");
  await p.click(".wmini"); await p.waitForTimeout(200);
  ok((await p.textContent("#auth")).includes("09171112222"), "top-up page shows CoolFix GCash number");
  await p.click('[data-ta="500"]'); await p.fill("#tref", "1012 345 678 901");
  await p.click("#tps"); ok((await p.textContent("#tpe")).includes("screenshot"), "top-up needs a receipt screenshot");
  await p.setInputFiles("#tpf", path.join(__dirname, "fixtures/nc2.png")); await p.click("#tps"); await p.waitForTimeout(400);
  ok(await p.evaluate(() => __DB.topups.length == 1 && __DB.topups[0].amt == 500), "technician submits a ₱500 top-up");
  await shot("wallet-2-tech-topup");

  // 2) Admin: aprubahan ang top-up
  await login("admin"); await p.setViewportSize({ width: 1280, height: 900 });
  await p.click("[data-t=wl]"); await p.waitForTimeout(400);
  ok((await p.textContent("#auth")).includes("Ref"), "admin sees the pending top-up");
  await shot("wallet-3-admin-topup");
  await p.click("[data-tno]"); ok((await p.textContent("[data-te]")).includes("bakit"), "rejecting a top-up needs a reason");
  await p.click("[data-tok]"); await p.waitForTimeout(300);
  ok(await p.evaluate(() => __DB.wallets[0].balance) == 500, "approved top-up adds ₱500 credits");
  for (const t of ["ov", "tx", "tt", "pr"]) { await p.click(`[data-t=${t}]`); await p.waitForTimeout(150) }

  // 3) Technician: online na
  await p.setViewportSize({ width: 420, height: 900 }); await login("rodel");
  await p.click("#ol"); await p.waitForTimeout(400); ok((await p.textContent("#ol")).includes("Online ka"), "technician goes online after top-up");

  // 4) Customer: mag-book (Split 1.5 HP cleaning)
  await login("maria");
  await p.click('.cat[data-c="0"]'); await p.click('.sv[data-g="1"][data-x="1"]'); await p.click("#panel .t"); await p.waitForTimeout(200);
  ok((await p.textContent("#panel")).includes("Cash o GCash sa technician"), "customer sees payment options");
  await shot("wallet-4-cust-booking");
  await p.click("#bk"); await p.waitForTimeout(400);
  const bk = await p.evaluate(() => __DB.bookings[0]);
  ok(bk.items && bk.items.cart[0].n == "Split 1.5 HP" && !("cust_phone" in bk && bk.cust_phone), "booking sends items for server pricing and no customer phone");

  // 5) Technician: walang numero ng customer, magpadala ng quote
  await login("rodel");
  ok(!(await p.textContent("#auth")).includes("09181234567"), "technician cannot see the customer's phone");
  for (const s of ["Papunta na", "Dumating na"]) { await p.click(`[data-s="${s}"]`); await p.waitForTimeout(300); if (await p.isVisible("#tmx")) { await p.click("#tmx"); await p.waitForTimeout(200) } }
  await p.click(".qf summary"); await p.fill(`#qa-${bk.id}`, "800"); await p.fill(`#qn-${bk.id}`, "Bagong capacitor at labor"); await p.click(`[data-q="${bk.id}"]`); await p.waitForTimeout(300);
  ok(await p.evaluate(() => __DB.bookings[0].q_status) == "hinihintay", "technician sends a quote");
  ok(!(await p.$('[data-s="Natapos"]')), "technician cannot finish while the quote is pending");
  await shot("wallet-5-tech-quote");

  // 6) Customer: aprubahan ang quote
  await login("maria"); await p.click("#ab"); await p.waitForTimeout(300);
  ok((await p.textContent("#panel")).includes("+ ₱800"), "customer sees the quote");
  await shot("wallet-6-cust-quote");
  await p.click("#qok"); await p.waitForTimeout(300);
  ok(await p.evaluate(() => __DB.bookings[0].extra_amt) == 800, "customer approves the quote");

  // 7) Technician: tapos na, ibinawas ang commission at booking fee
  await login("rodel");
  const total = 1400 + 800 + 49; // 1100 + 300 dispatch + 800 quote + 49 booking fee
  ok((await p.textContent(`[data-s="Natapos"]`)).includes("₱" + total.toLocaleString("en-PH")), "finish button shows the amount to collect");
  await p.click('[data-s="Natapos"]'); await p.waitForTimeout(400);
  const w = await p.evaluate(() => __DB.wallets[0].balance);
  ok(w == 500 - Math.round(2200 * .2) - 49, "commission (20%) and booking fee deducted from wallet: " + w);
  await p.click("[data-t=wl]"); await p.waitForTimeout(200);
  ok((await p.textContent("#auth")).includes("Commission"), "wallet history shows the commission");
  await shot("wallet-7-tech-wallet");

  // 8) Customer: babayaran, warranty at rating
  await login("maria");
  ok((await p.textContent("#panel")).includes("I-rate"), "home asks the customer to rate");
  await p.click("#rtb"); await p.waitForTimeout(300);
  ok((await p.textContent("#panel")).includes("warranty"), "finished booking shows warranty");
  await p.click('[data-rs="5"]'); await p.fill("#rv", "Mabilis at malinis"); await p.click("#rsub"); await p.waitForTimeout(300);
  ok(await p.evaluate(() => __DB.bookings[0].rating) == 5, "customer rates the job");
  await shot("wallet-8-cust-tapos");
  ok(errs.length == 0, "no page errors " + errs.join("; "));
  await b.close(); srv.close();
})().catch(e => { console.error(e); process.exit(1) });
