// Test ng online na top-up (PayMongo) gamit ang mock ng Supabase.
// Patakbuhin: node tests/paymongo.js   (SHOTS=folder para mag-save ng screenshots)
const { chromium } = require("playwright");
const http = require("http"), fs = require("fs"), path = require("path");
const WWW = path.join(__dirname, "..", "www"), SHOTS = process.env.SHOTS;
const srv = http.createServer((q, r) => { const f = path.join(WWW, decodeURIComponent(q.url.split("?")[0]).replace(/\/$/, "/index.html")); fs.readFile(f, (e, d) => { if (e) { r.writeHead(404); return r.end() } r.writeHead(200, { "content-type": f.endsWith(".js") ? "application/javascript" : f.endsWith(".html") ? "text/html" : "application/octet-stream" }); r.end(d) }) });
const ok = (c, m) => { if (!c) throw new Error("FAIL: " + m); console.log("ok -", m) };
(async () => {
  await new Promise(r => srv.listen(0, r)); const url = `http://localhost:${srv.address().port}/`;
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 420, height: 900 }, deviceScaleFactor: 2 }); const p = await ctx.newPage();
  const errs = []; p.on("pageerror", e => errs.push(e.message));
  const shot = async n => { if (SHOTS) await p.screenshot({ path: path.join(SHOTS, n + ".png"), fullPage: true }) };
  await ctx.addInitScript(() => { localStorage.setItem("cf_terms", "2026-11-27"); localStorage.setItem("cf_loc", "1") });
  await p.route("**/vendor/supabase.js", r => r.fulfill({ contentType: "application/javascript", body: fs.readFileSync(path.join(__dirname, "mock-supabase.js"), "utf8") }));
  await p.route("**/config.js", r => r.fulfill({ contentType: "application/javascript", body: 'window.COOLFIX_CONFIG={supabaseUrl:"x",supabaseAnonKey:"y"}' }));
  const seed = async (pmOn, extra) => p.evaluate(([pmOn, extra]) => {
    const T = new Date().toISOString(), P = (id, role, name) => ({ id, role, name, email: id + "@test.com", phone: "09171234567", addr: "QC", services: role == "technician" ? ["Aircon cleaning"] : [], cert_type: "nc2", docs: {}, doc_status: "aprubado", doc_note: "", online: false, lat: 14.68, lng: 121.05, created_at: T });
    __DB.profiles.push(P("admin", "admin", "CoolFix Admin"), P("rodel", "technician", "Rodel Santos"));
    ["admin", "rodel"].forEach(id => __users.push({ id, email: id + "@test.com", password: "password123" }));
    __DB.settings.push({ key: "paymongo_on", value: pmOn }, { key: "topup_info", value: { gcash: { number: "09171112222", name: "CoolFix" }, maya: { number: "", name: "" } } });
    if (extra) extra.forEach(x => __DB.topups.push(x));
  }, [pmOn, extra]);
  const login = async who => { if (await p.isVisible("#lo")) { await p.click("#lo"); await p.waitForTimeout(200) } await p.fill("#f_e", who + "@test.com"); await p.fill("#f_w", "password123"); await p.click("#go"); await p.waitForTimeout(600) };

  // 1) Naka-off: walang "Bayad online", may lumang GCash na paraan pa rin
  await p.goto(url); await p.waitForTimeout(300); await seed(false);
  await login("rodel"); await p.click(".wmini"); await p.waitForTimeout(200);
  ok(!(await p.isVisible("#pas")) && await p.isVisible("#tps"), "when off: only the manual GCash top-up shows");

  // 2) Naka-on: may "Bayad online"
  await p.goto(url); await p.waitForTimeout(300); await seed(true);
  await p.evaluate(() => { window.__FN = { "paymongo-checkout": body => ({ data: { checkout_url: "#paymongo-" + body.amt }, error: null }) } });
  await login("rodel"); await p.click(".wmini"); await p.waitForTimeout(200);
  ok(await p.isVisible("#pas") && await p.isVisible("#tps"), "when on: online payment and manual GCash both show");
  await shot("pm-1-tech-wallet");
  await p.fill("#pa", "50"); await p.click("#pas"); ok((await p.textContent("#pae")).includes("₱100"), "online top-up needs at least ₱100");
  await p.click('[data-pa="500"]'); await p.click("#pas"); await p.waitForTimeout(300);
  ok(await p.evaluate(() => location.hash) == "#paymongo-500", "opens the PayMongo checkout for ₱500");
  ok(await p.evaluate(() => __INVOKED[0] == "paymongo-checkout" && __INVOKED[1].amt == 500), "asks the server to make the checkout (no key in the app)");

  // 3) Error mula sa server: ipinapakita nang malinaw
  await p.evaluate(() => { window.__FN = {} }); await p.evaluate(() => location.hash = "");
  await p.evaluate(() => walletView());
  await p.fill("#pa", "500"); await p.click("#pas"); await p.waitForTimeout(200);
  ok((await p.textContent("#pae")).includes("naka-set up"), "shows the server's error when PayMongo is not set up");

  // 4) Pagbalik mula PayMongo (bayad na, pumasok na ang credits sa webhook)
  await p.goto(url + "?topup=ok"); await p.waitForTimeout(300);
  await seed(true, [{ id: 91, tech_id: "rodel", amt: 500, method: "paymongo", ref: "cs_test_abc", status: "aprubado", paid_with: "gcash", note: "", created_at: new Date().toISOString() },
                    { id: 92, tech_id: "rodel", amt: 300, method: "paymongo", ref: "cs_test_old", status: "expired", paid_with: "", note: "", created_at: new Date().toISOString() }]);
  await p.evaluate(() => { __DB.wallets.push({ tech_id: "rodel", balance: 500 }); __DB.wallet_tx.push({ id: 93, tech_id: "rodel", kind: "topup", amt: 500, balance_after: 500, note: "Top-up online (gcash) · pay_test_1", created_at: new Date().toISOString() }) });
  await login("rodel"); await p.waitForTimeout(200);
  ok((await p.textContent("#auth")).includes("Salamat!"), "after paying, the wallet page says credits are coming");
  ok(!(await p.evaluate(() => location.search)), "cleans ?topup from the address");
  const t = await p.textContent("#auth");
  ok(t.includes("Online (GCash)") && t.includes("Pumasok na") && !t.includes("₱300"), "list shows the paid online top-up and hides the expired one");
  await shot("pm-2-tech-paid");

  // 5) Admin: may switch para i-on/i-off
  await login("admin"); await p.setViewportSize({ width: 1280, height: 900 });
  await p.click("[data-t=wl]"); await p.waitForTimeout(300);
  ok(await p.isChecked("#pmon"), "admin sees the PayMongo switch (on)");
  ok((await p.textContent("#auth")).includes("PayMongo, awtomatiko"), "admin sees the online top-up in history");
  await p.uncheck("#pmon"); await p.click("#wss"); await p.waitForTimeout(200);
  ok(await p.evaluate(() => __DB.settings.find(s => s.key == "paymongo_on").value) === false, "admin can turn online top-up off");
  await shot("pm-3-admin");

  ok(!errs.length, "no page errors " + errs.join(" | "));
  await b.close(); srv.close(); console.log("ALL OK");
})().catch(e => { console.error(e); process.exit(1) });
