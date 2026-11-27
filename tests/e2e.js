// End-to-end test ng CoolFix gamit ang in-memory na mock ng Supabase (tests/mock-supabase.js).
// Sinusubok ang UI flow: sign-up, booking, status, chat at admin. Hindi nito sinusubok ang RLS.
// Patakbuhin: node tests/e2e.js
const { chromium } = require("playwright");
const http = require("http"), fs = require("fs"), path = require("path");
const WWW = path.join(__dirname, "..", "www");
const srv = http.createServer((q, r) => { const f = path.join(WWW, decodeURIComponent(q.url.split("?")[0]).replace(/\/$/, "/index.html")); fs.readFile(f, (e, d) => { if (e) { r.writeHead(404); return r.end() } r.writeHead(200, { "content-type": f.endsWith(".js") ? "application/javascript" : f.endsWith(".html") ? "text/html" : "application/octet-stream" }); r.end(d) }) });
const ok = (c, m) => { if (!c) throw new Error("FAIL: " + m); console.log("ok -", m) };
(async () => {
  await new Promise(r => srv.listen(0, r)); const url = `http://localhost:${srv.address().port}/`;
  const b = await chromium.launch(); const ctx = await b.newContext({ geolocation: { latitude: 14.68, longitude: 121.05 }, permissions: ["geolocation"] }); const p = await ctx.newPage();
  const errs = []; p.on("pageerror", e => errs.push(e.message));
  await p.route("**/vendor/supabase.js", r => r.fulfill({ contentType: "application/javascript", body: fs.readFileSync(path.join(__dirname, "mock-supabase.js"), "utf8") }));
  await p.route("**/config.js", r => r.fulfill({ contentType: "application/javascript", body: 'window.COOLFIX_CONFIG={supabaseUrl:"x",supabaseAnonKey:"y"}' }));
  await p.goto(url); await p.waitForTimeout(300);
  await p.click("[data-m=signup]"); await p.click("[data-r=technician]");
  await p.fill("#f_n", "Rodel Santos"); await p.fill("#f_p", "09171234567"); await p.fill("#f_e", "rodel@test.com"); await p.fill("#f_w", "password123");
  await p.click('[data-v="Aircon cleaning"]'); await p.fill("#f_a", "Quezon City"); await p.click("#go"); await p.waitForTimeout(400);
  await p.click("#ol"); await p.waitForTimeout(400); ok((await p.textContent("#ol")).includes("Online ka"), "technician can go online");
  await p.click("#lo"); await p.waitForTimeout(300);
  await p.click("[data-m=signup]"); await p.fill("#f_n", "Maria Reyes"); await p.fill("#f_p", "09181234567"); await p.fill("#f_e", "maria@test.com"); await p.fill("#f_w", "password123"); await p.fill("#f_a", "Brgy. Kamuning, QC"); await p.click("#go"); await p.waitForTimeout(600);
  await p.click('.cat[data-c="0"]'); await p.click('.sv[data-g="1"][data-x="1"]'); await p.click("#panel .t"); await p.click("#bk"); await p.waitForTimeout(400);
  ok((await p.textContent("#panel")).includes("Naghihintay"), "customer booking created");
  await p.click("#tc"); await p.waitForTimeout(300); await p.fill("#mi", "Hello po"); await p.click("#sn"); await p.waitForTimeout(300);
  ok((await p.textContent("#ms")).includes("Hello po"), "customer can send a message");
  await p.click("#lo"); await p.fill("#f_e", "rodel@test.com"); await p.fill("#f_w", "password123"); await p.click("#go"); await p.waitForTimeout(500);
  for (const s of ["Papunta na", "Dumating na", "Natapos"]) { await p.click(`[data-s="${s}"]`); await p.waitForTimeout(300) }
  ok(await p.evaluate(() => __DB.bookings[0].status) == "Natapos", "technician completes the job");
  await p.click("#lo"); await p.fill("#f_e", "maria@test.com"); await p.fill("#f_w", "bad"); await p.click("#go"); await p.waitForTimeout(200);
  ok((await p.textContent("#er")).includes("Mali"), "wrong password is rejected");
  await p.evaluate(() => { __DB.profiles.find(x => x.email == "maria@test.com").role = "admin" });
  await p.fill("#f_w", "password123"); await p.click("#go"); await p.waitForTimeout(500);
  for (const t of ["tx", "tt", "sv", "pr", "rg"]) { await p.click(`[data-t=${t}]`); await p.waitForTimeout(150) }
  await p.click("[data-t=sv]"); await p.click("#ss"); await p.waitForTimeout(200); ok((await p.textContent("#se")).includes("Na-save"), "admin saves services");
  ok(errs.length == 0, "no page errors " + errs.join("; "));
  await b.close(); srv.close();
})().catch(e => { console.error(e); process.exit(1) });
