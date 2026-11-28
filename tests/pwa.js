// Test ng PWA: manifest, service worker, offline, at "I-install ang app" banner (Android, iPhone, Messenger).
// Patakbuhin: node tests/pwa.js
const { chromium, devices } = require("playwright");
const http = require("http"), fs = require("fs"), path = require("path");
const WWW = path.join(__dirname, "..", "www");
const TYPES = { ".js": "application/javascript", ".html": "text/html", ".css": "text/css", ".png": "image/png", ".webmanifest": "application/manifest+json" };
const srv = http.createServer((q, r) => { const f = path.join(WWW, decodeURIComponent(q.url.split("?")[0]).replace(/\/$/, "/index.html")); fs.readFile(f, (e, d) => { if (e) { r.writeHead(404); return r.end() } r.writeHead(200, { "content-type": TYPES[path.extname(f)] || "application/octet-stream" }); r.end(d) }) });
let URL;
const ok = (c, m) => { if (!c) throw new Error("FAIL: " + m); console.log("ok -", m) };
const mock = fs.readFileSync(path.join(__dirname, "mock-supabase.js"), "utf8");
async function ctxFor(b, dev) {
  const c = await b.newContext({ ...dev, geolocation: { latitude: 14.68, longitude: 121.05 }, permissions: ["geolocation"] });
  await c.route("**/vendor/supabase.js", r => r.fulfill({ contentType: "application/javascript", body: mock }));
  await c.route("**/config.js*", r => r.fulfill({ contentType: "application/javascript", body: 'window.COOLFIX_CONFIG={supabaseUrl:"x",supabaseAnonKey:"y"}' }));
  return c;
}
(async () => {
  await new Promise(r => srv.listen(0, r)); URL = `http://localhost:${srv.address().port}/`;
  const b = await chromium.launch();
  // Android
  let c = await ctxFor(b, devices["Pixel 7"]); let p = await c.newPage(); const errs = []; p.on("pageerror", e => errs.push(e.message));
  await p.goto(URL); await p.evaluate(() => { localStorage.setItem("cf_terms", "x") });
  await p.goto(URL); await p.waitForTimeout(500);
  if (await p.$("#agree")) { await p.click("#agree"); await p.waitForTimeout(200) } if (await p.$("#lno")) await p.click("#lno");
  const reg = await p.evaluate(async () => { const r = await navigator.serviceWorker.ready; return r.active && r.active.scriptURL });
  ok(reg && reg.endsWith("/sw.js"), "service worker active");
  const man = await p.evaluate(async () => (await fetch("manifest.webmanifest")).json());
  ok(man.display == "standalone" && man.icons.length == 3, "manifest loads");
  for (const i of man.icons) ok((await p.evaluate(async s => (await fetch(s)).ok, i.src)), "icon " + i.src);
  ok(!(await p.$(".pwa")), "no banner before beforeinstallprompt");
  await p.evaluate(() => { const e = new Event("beforeinstallprompt"); e.prompt = () => { window.__prompted = 1 }; e.userChoice = Promise.resolve({ outcome: "accepted" }); window.dispatchEvent(e) });
  await p.waitForTimeout(1800); ok(await p.$(".pwa"), "Android banner shows");
    await p.click("#pwi"); await p.waitForTimeout(200); ok(await p.evaluate(() => window.__prompted) && !(await p.$(".pwa")), "I-install opens Chrome install prompt");
  // reload under SW control: app works, cross-origin untouched
  await p.reload(); await p.waitForTimeout(600);
  ok(await p.evaluate(() => !!navigator.serviceWorker.controller), "page controlled by SW");
  const keys = await p.evaluate(async () => (await (await caches.open("coolfix-v1")).keys()).map(r => r.url.replace(location.origin, "")));
  ok(!keys.some(k => k.startsWith("http")), "no cross-origin requests cached");
  // offline
  await c.setOffline(true); await p.reload(); await p.waitForTimeout(600);
  ok(await p.$("header"), "app shell opens offline");
  await c.setOffline(false);
  ok(errs.length == 0, "no page errors (android) " + errs.join(";"));
  await c.close();
  // iPhone
  c = await ctxFor(b, devices["iPhone 14"]); p = await c.newPage();
  await p.goto(URL); await p.evaluate(() => { localStorage.setItem("cf_terms", "x") }); await p.goto(URL); await p.waitForTimeout(500);
  if (await p.$("#agree")) { await p.click("#agree") } if (await p.$("#lno")) await p.click("#lno");
  await p.waitForTimeout(4500); ok(await p.$(".pwa"), "iPhone banner shows");
    await p.click("#pwi"); await p.waitForTimeout(300); ok((await p.textContent(".sheet")).includes("Add to Home Screen"), "iPhone steps shown");
    await p.click("#pwok"); await p.click("#pwx"); await p.reload(); await p.waitForTimeout(4800); ok(!(await p.$(".pwa")), "dismissed banner stays hidden");
  await c.close();
  // Messenger in-app on Android
  c = await ctxFor(b, { ...devices["Pixel 7"], userAgent: devices["Pixel 7"].userAgent + " [FBAN/EMA;FBLC/en_US;FBAV/400.0]" }); p = await c.newPage();
  await p.goto(URL); await p.evaluate(() => { localStorage.setItem("cf_terms", "x") }); await p.goto(URL); await p.waitForTimeout(500);
  if (await p.$("#agree")) { await p.click("#agree") } if (await p.$("#lno")) await p.click("#lno");
  await p.waitForTimeout(4500); await p.click("#pwi"); await p.waitForTimeout(300);
  ok((await p.textContent(".sheet")).includes("Open in Chrome"), "Messenger browser told to open in Chrome");
    // Desktop Chrome: laging may "I-download ang app" button sa header
  c = await ctxFor(b, { viewport: { width: 1400, height: 800 } }); p = await c.newPage();
  await p.goto(URL); await p.evaluate(() => { localStorage.setItem("cf_terms", "x") }); await p.goto(URL); await p.waitForTimeout(500);
  if (await p.$("#agree")) { await p.click("#agree") } if (await p.$("#lno")) await p.click("#lno");
  ok(await p.isVisible("#pwdl") && (await p.textContent("#pwdl")).includes("I-download ang app"), "desktop header has download button");
  await p.click("#pwdl"); await p.waitForTimeout(300); ok((await p.textContent(".sheet")).includes("Install CoolFix"), "desktop steps shown without Chrome prompt");
  await p.click("#pwok");
  await p.evaluate(() => { const e = new Event("beforeinstallprompt"); e.prompt = () => { window.__prompted = 1 }; e.userChoice = Promise.resolve({ outcome: "dismissed" }); window.dispatchEvent(e) });
  await p.click("#pwdl"); await p.waitForTimeout(200); ok(await p.evaluate(() => window.__prompted), "download button opens Chrome install prompt");
  await c.close();
  // Safari sa Mac
  c = await ctxFor(b, { viewport: { width: 1400, height: 800 }, userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15" }); p = await c.newPage();
  await p.goto(URL); await p.evaluate(() => { localStorage.setItem("cf_terms", "x") }); await p.goto(URL); await p.waitForTimeout(500);
  if (await p.$("#agree")) { await p.click("#agree") } if (await p.$("#lno")) await p.click("#lno");
  await p.click("#pwdl"); await p.waitForTimeout(300);
  ok((await p.textContent(".sheet")).includes("Add to Dock"), "Mac Safari told to use Add to Dock");
  await c.close();
  await b.close(); srv.close();
})().catch(e => { console.error(e); process.exit(1) });
