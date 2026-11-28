// Test ng certificate ng technician na nakikita ng customer (018_tech_certs.sql):
// technician nag-a-upload, admin nag-aapruba o tumatanggi, customer nakikita ang aprubado lang.
// Patakbuhin: node tests/certs.js   (SHOTS=folder para mag-save ng screenshots)
const { chromium } = require("playwright");
const http = require("http"), fs = require("fs"), path = require("path");
const WWW = path.join(__dirname, "..", "www"), SHOTS = process.env.SHOTS;
const srv = http.createServer((q, r) => { const f = path.join(WWW, decodeURIComponent(q.url.split("?")[0]).replace(/\/$/, "/index.html")); fs.readFile(f, (e, d) => { if (e) { r.writeHead(404); return r.end() } r.writeHead(200, { "content-type": f.endsWith(".js") ? "application/javascript" : f.endsWith(".html") ? "text/html" : f.endsWith(".svg") ? "image/svg+xml" : "application/octet-stream" }); r.end(d) }) });
const ok = (c, m) => { if (!c) throw new Error("FAIL: " + m); console.log("ok -", m) };
async function art(b, svg, w, h) { const pg = await b.newPage({ viewport: { width: w, height: h } }); await pg.setContent(`<body style="margin:0">${svg}</body>`); const buf = await pg.screenshot(); await pg.close(); return buf }
const certSvg = (title, by) => `<svg width="1100" height="780" viewBox="0 0 220 156"><rect width="220" height="156" fill="#FFFDF4"/><rect x="6" y="6" width="208" height="144" fill="none" stroke="#B8862B" stroke-width="3"/><text x="110" y="34" font-family="Georgia" font-size="11" text-anchor="middle" fill="#5A4410">CERTIFICATE OF COMPLETION</text><text x="110" y="62" font-family="Georgia" font-size="7" text-anchor="middle" fill="#555">ito ay iginagawad kay</text><text x="110" y="80" font-family="Georgia" font-size="13" text-anchor="middle" fill="#0C2370">Rodel Santos</text><text x="110" y="100" font-family="Arial" font-size="8" text-anchor="middle" fill="#333">${title}</text><text x="110" y="132" font-family="Arial" font-size="7" text-anchor="middle" fill="#777">${by} · SAMPLE LANG</text></svg>`;
(async () => {
  await new Promise(r => srv.listen(0, r)); const url = `http://localhost:${srv.address().port}/`;
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 420, height: 900 }, deviceScaleFactor: 2, serviceWorkers: "block", geolocation: { latitude: 14.68, longitude: 121.05 }, permissions: ["geolocation"] }); const p = await ctx.newPage();
  const errs = []; p.on("pageerror", e => { if (!/googleapis/.test(e.stack || "")) errs.push(e.message); if (process.env.DBG) console.log("PAGEERR", e.stack) });
  const shot = async n => { if (SHOTS) await p.screenshot({ path: path.join(SHOTS, n + ".png") }) };
  const nc2 = (await art(b, certSvg("Refrigeration and Airconditioning Servicing NC II", "TESDA"), 1100, 780)).toString("base64");
  const training = { name: "carrier.png", mimeType: "image/png", buffer: await art(b, certSvg("Inverter Aircon Installation and Troubleshooting", "Carrier Philippines"), 1100, 780) };
  const bad = { name: "malabo.png", mimeType: "image/png", buffer: await art(b, `<svg width="600" height="400"><rect width="600" height="400" fill="#ddd"/></svg>`, 600, 400) };
  await ctx.addInitScript(() => { localStorage.setItem("cf_terms", "2026-11-27"); localStorage.setItem("cf_loc", "1") });
  await p.route("**/vendor/supabase.js", r => r.fulfill({ contentType: "application/javascript", body: fs.readFileSync(path.join(__dirname, "mock-supabase.js"), "utf8") }));
  await p.route("**/config.js", r => r.fulfill({ contentType: "application/javascript", body: 'window.COOLFIX_CONFIG={supabaseUrl:"x",supabaseAnonKey:"y"}' }));
  await p.goto(url); await p.waitForTimeout(300);
  await p.evaluate(async b64 => {
    const T = new Date().toISOString(), P = (id, role, name, x = {}) => ({ id, role, name, email: id + "@test.com", phone: "09171234567", addr: "Quezon City", services: role == "technician" ? ["Aircon cleaning", "Aircon repair"] : [], cert_type: role == "technician" ? "nc2" : null, docs: role == "technician" ? { vid: { path: "rodel/vid.png", type: "image/png" }, nc2: { path: "rodel/nc2.png", type: "image/png" } } : {}, doc_status: role == "technician" ? "aprubado" : "kulang", doc_note: "", online: role == "technician", lat: 14.681, lng: 121.052, google: false, created_at: T, avatar: null, bio: "8 taon na akong aircon technician.", years_exp: 8, brands: ["Carrier"], gallery: [], ...x });
    __DB.profiles.push(P("rodel", "technician", "Rodel Santos"), P("maria", "customer", "Maria Reyes"), P("admin", "admin", "Admin"));
    ["rodel", "maria", "admin"].forEach(id => __users.push({ id, email: id + "@test.com", password: "password123" }));
    __FILES["tech-docs/rodel/nc2.png"] = await (await fetch("data:image/png;base64," + b64)).blob();
    __FILES["tech-docs/rodel/vid.png"] = new Blob(["valid id"], { type: "image/png" });
  }, nc2);
  const login = async who => { if (await p.isVisible("#lo")) { await p.click("#lo"); await p.waitForTimeout(200) } await p.fill("#f_e", who + "@test.com"); await p.fill("#f_w", "password123"); await p.click("#go"); await p.waitForTimeout(700) };
  const certs = () => p.evaluate(() => __DB.tech_certs.map(c => ({ ...c })));

  // 1) Technician: ipakita ang NC II mula sa sign-up, at magdagdag ng training certificate
  await login("rodel");
  ok(await p.isVisible("#cbox") && (await p.textContent("#cbox")).includes("Wala ka pang certificate"), "tech dashboard has a certificates box");
  await p.click("#csig"); await p.waitForTimeout(500);
  let C = await certs(); ok(C.length == 1 && C[0].kind == "nc2" && C[0].status == "sinusuri" && C[0].path.startsWith("rodel/") && await p.evaluate(k => !!__FILES["tech-certs/" + k], C[0].path), "signup NC II is copied to tech-certs and waits for review");
  ok(!(await p.isVisible("#csig")), "signup NC II shortcut hides once used");
  await p.click("#cadd summary"); await p.selectOption("#cf_k", "training"); await p.fill("#cf_t", "Inverter Aircon Installation and Troubleshooting"); await p.fill("#cf_i", "Carrier Philippines"); await p.fill("#cf_y", "2023");
  await p.click("#cf_s"); await p.waitForTimeout(200); ok((await p.textContent("#cfe")).includes("Pumili ng litrato"), "certificate file is required");
  await p.setInputFiles("#cf_f", training); await p.waitForTimeout(200);
  ok(await p.inputValue("#cf_t") == "Inverter Aircon Installation and Troubleshooting", "form keeps typed values after choosing a file");
  await p.click("#cf_s"); await p.waitForTimeout(900);
  C = await certs(); ok(C.length == 2 && C[1].kind == "training" && C[1].issued_year == 2023 && C[1].mime == "image/jpeg", "training certificate is uploaded");
  await p.click("#cadd summary"); await p.selectOption("#cf_k", "training"); await p.fill("#cf_t", "Aircon Cleaning Seminar"); await p.setInputFiles("#cf_f", bad); await p.waitForTimeout(200); await p.click("#cf_s"); await p.waitForTimeout(900);
  ok((await certs()).length == 3, "third certificate is uploaded");
  ok(await p.locator("#cbox .pill.wt").count() == 3 && await p.locator("#cbox .tci img").count() == 3, "dashboard lists the certificates as Sinusuri with thumbnails");
  await p.locator("#cbox").scrollIntoViewIfNeeded(); await shot("cert-1-tech-sinusuri");

  // 2) Customer: wala pang aprubado, kaya walang lumalabas
  await login("maria");
  await p.click('.cat[data-c="0"]'); await p.click('.sv[data-g="1"][data-x="1"]'); await p.waitForTimeout(200);
  ok(!(await p.locator("#panel .ctag").count()), "customer list shows no certificate tag before approval");
  await p.click("#panel .t"); await p.waitForTimeout(400); ok(!(await p.locator("#panel .tcrt").count()), "customer does not see pending certificates");

  // 3) Admin: aprubahan ang dalawa, tanggihan ang malabo
  await login("admin"); await p.click("[data-t=rq]"); await p.waitForTimeout(400);
  ok((await p.textContent("#crq")).includes("3 naghihintay") && await p.locator("#crq .tci img").count() == 3, "admin sees pending certificates with previews");
  await shot("cert-2-admin-suriin");
  const id = n => C[n] ? C[n].id : (null);
  const all = await certs();
  await p.click(`[data-cr="${all[2].id}"]`); await p.waitForTimeout(200); ok((await p.textContent("#cae")).includes("Ilagay kung bakit"), "rejecting needs a reason");
  await p.fill(`[data-cn="${all[2].id}"]`, "Malabo ang litrato, hindi mabasa ang pangalan"); await p.click(`[data-cr="${all[2].id}"]`); await p.waitForTimeout(300);
  await p.click(`[data-ca="${all[0].id}"]`); await p.waitForTimeout(300); await p.click(`[data-ca="${all[1].id}"]`); await p.waitForTimeout(300);
  const st = (await certs()).map(c => c.status).join(); ok(st == "aprubado,aprubado,tinanggihan", "admin approves two and rejects one (" + st + ")");
  ok((await p.textContent("#crq")).includes("Walang naghihintay"), "pending list is empty after review");

  // 4) Customer: nakikita ang aprubadong certificate na may Verified
  await login("maria");
  await p.click('.cat[data-c="0"]'); await p.click('.sv[data-g="1"][data-x="1"]'); await p.waitForTimeout(300);
  ok((await p.textContent("#panel .t")).includes("2 verified na certificate"), "technician list shows the verified certificate count");
  await p.locator("#panel .t").scrollIntoViewIfNeeded(); await shot("cert-3-customer-list");
  await p.click("#panel .t"); await p.waitForTimeout(600);
  const pt = await p.textContent("#panel");
  ok(await p.locator("#panel .tcrt").count() == 2 && pt.includes("Verified ng CoolFix") && pt.includes("Carrier Philippines") && !pt.includes("Aircon Cleaning Seminar"), "customer sees only approved certificates, marked Verified");
  ok(await p.locator("#panel .tcrt a.tci[href] img").count() == 2, "customer can open each certificate");
  await p.locator("#panel .tcrts").scrollIntoViewIfNeeded(); await shot("cert-4-customer-profile");

  // 5) Technician: nakikita ang resulta at pwedeng alisin ang tinanggihan
  await login("rodel");
  ok(await p.locator("#cbox .pill.ok").count() == 2 && (await p.textContent("#cbox")).includes("Malabo ang litrato"), "technician sees Verified and the rejection reason");
  await p.locator("#cbox").scrollIntoViewIfNeeded(); await shot("cert-5-tech-verified");
  await p.click(`[data-cx="${all[2].id}"]`); await p.waitForTimeout(400); ok((await certs()).length == 2, "technician removes the rejected certificate");
  await p.click("[data-t=me]"); await p.waitForTimeout(300); ok(await p.locator(".ppv .tcrt").count() == 2, "profile preview shows the verified certificates");
  ok(errs.length == 0, "no page errors " + errs.join("; "));
  await b.close(); srv.close();
})().catch(e => { console.error(e); process.exit(1) });
