// Test ng profile pic (customer at technician) at ng editable na profile ng technician na nakikita ng customer.
// Patakbuhin: node tests/profile.js   (SHOTS=folder para mag-save ng screenshots)
const { chromium } = require("playwright");
const http = require("http"), fs = require("fs"), path = require("path");
const WWW = path.join(__dirname, "..", "www"), SHOTS = process.env.SHOTS;
const srv = http.createServer((q, r) => { const f = path.join(WWW, decodeURIComponent(q.url.split("?")[0]).replace(/\/$/, "/index.html")); fs.readFile(f, (e, d) => { if (e) { r.writeHead(404); return r.end() } r.writeHead(200, { "content-type": f.endsWith(".js") ? "application/javascript" : f.endsWith(".html") ? "text/html" : f.endsWith(".svg") ? "image/svg+xml" : "application/octet-stream" }); r.end(d) }) });
const ok = (c, m) => { if (!c) throw new Error("FAIL: " + m); console.log("ok -", m) };
// Gumagawa ng sample na PNG (drawing lang, hindi totoong tao) para i-upload.
async function art(b, svg, w, h) { const pg = await b.newPage({ viewport: { width: w, height: h } }); await pg.setContent(`<body style="margin:0">${svg}</body>`); const buf = await pg.screenshot(); await pg.close(); return buf }
const face = (bg, skin, hair, shirt) => `<svg width="600" height="600" viewBox="0 0 100 100"><rect width="100" height="100" fill="${bg}"/><circle cx="50" cy="42" r="20" fill="${skin}"/><path d="M30 40c0-14 9-21 20-21s20 7 20 21c-4-7-10-10-20-10s-16 3-20 10z" fill="${hair}"/><circle cx="43" cy="44" r="2" fill="#222"/><circle cx="57" cy="44" r="2" fill="#222"/><path d="M43 52q7 5 14 0" stroke="#222" stroke-width="1.6" fill="none" stroke-linecap="round"/><path d="M18 100c2-20 15-30 32-30s30 10 32 30z" fill="${shirt}"/></svg>`;
const ac = (bg, label) => `<svg width="1000" height="750" viewBox="0 0 200 150"><rect width="200" height="150" fill="${bg}"/><rect x="25" y="40" width="150" height="55" rx="8" fill="#fff" stroke="#9AA9C6" stroke-width="2"/><rect x="35" y="78" width="130" height="8" rx="3" fill="#DCE3F0"/><circle cx="160" cy="52" r="3" fill="#3BB273"/><text x="100" y="125" font-family="Arial" font-size="14" text-anchor="middle" fill="#0C2370">${label}</text></svg>`;
(async () => {
  await new Promise(r => srv.listen(0, r)); const url = `http://localhost:${srv.address().port}/`;
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 420, height: 900 }, deviceScaleFactor: 2, serviceWorkers: "block", geolocation: { latitude: 14.68, longitude: 121.05 }, permissions: ["geolocation"] }); const p = await ctx.newPage();
  const errs = []; p.on("pageerror", e => errs.push(e.message));
  const shot = async n => { if (SHOTS) await p.screenshot({ path: path.join(SHOTS, n + ".png"), fullPage: true }) };
  const img = (name, buffer) => ({ name, mimeType: "image/png", buffer });
  const techPic = img("rodel.png", await art(b, face("#CFE3FA", "#C68E5B", "#2B1B10", "#2F7FE0"), 600, 600));
  const custPic = img("maria.png", await art(b, face("#FCE3D8", "#E2B48A", "#3A2416", "#D9467A"), 600, 600));
  const work1 = img("work1.png", await art(b, ac("#E9F2FF", "Split type cleaning"), 1000, 750)), work2 = img("work2.png", await art(b, ac("#EAF8EF", "Bagong install"), 1000, 750)), work3 = img("work3.png", await art(b, ac("#FFF4E0", "Window type"), 1000, 750));
  await ctx.addInitScript(() => { localStorage.setItem("cf_terms", "2026-11-27"); localStorage.setItem("cf_loc", "1") });
  await p.route("**/vendor/supabase.js", r => r.fulfill({ contentType: "application/javascript", body: fs.readFileSync(path.join(__dirname, "mock-supabase.js"), "utf8") }));
  await p.route("**/config.js", r => r.fulfill({ contentType: "application/javascript", body: 'window.COOLFIX_CONFIG={supabaseUrl:"x",supabaseAnonKey:"y"}' }));
  await p.goto(url); await p.waitForTimeout(300);
  await p.evaluate(() => {
    const T = new Date().toISOString(), P = (id, role, name, x = {}) => ({ id, role, name, email: id + "@test.com", phone: "09171234567", addr: "Quezon City", services: role == "technician" ? ["Aircon cleaning", "Aircon repair"] : [], cert_type: role == "technician" ? "nc2" : null, docs: role == "technician" ? { vid: { path: "v" }, nc2: { path: "n" } } : {}, doc_status: role == "technician" ? "aprubado" : "kulang", doc_note: "", online: false, lat: 14.681, lng: 121.052, google: false, created_at: T, avatar: null, bio: "", years_exp: null, brands: [], gallery: [], ...x });
    __DB.profiles.push(P("rodel", "technician", "Rodel Santos"), P("maria", "customer", "Maria Reyes"));
    ["rodel", "maria"].forEach(id => __users.push({ id, email: id + "@test.com", password: "password123" }));
  });
  const login = async who => { if (await p.isVisible("#lo")) { await p.click("#lo"); await p.waitForTimeout(200) } await p.fill("#f_e", who + "@test.com"); await p.fill("#f_w", "password123"); await p.click("#go"); await p.waitForTimeout(600) };
  const me = () => p.evaluate(id => ({ ...__DB.profiles.find(x => x.id == id) }), "rodel");

  // 1) Technician: dashboard card at pag-edit ng profile
  await login("rodel");
  ok((await p.textContent(".pmini")).includes("0% kumpleto"), "technician dashboard shows profile completeness");
  await p.click("#ol"); await p.waitForTimeout(300); ok((await p.textContent("#ol")).includes("Online ka"), "technician goes online");
  await shot("pp-1-tech-dashboard");
  await p.click("#gopf"); await p.waitForTimeout(300);
  ok(await p.isVisible(".pform"), "Kumpletuhin opens the profile editor");
  await p.setInputFiles("#pvf", techPic); await p.waitForTimeout(800);
  let u = await me(); ok(/^rodel\/[\w.-]+\.jpg$/.test(u.avatar || ""), "technician profile pic is uploaded to their own folder");
  ok(await p.locator(".pbox img.av").count() == 1, "account shows the new profile pic");
  await p.fill("#pf_b", "8 taon na akong aircon technician. Dati akong nagtrabaho sa service center ng Carrier. Malinis at maingat magtrabaho, on time palagi.");
  await p.fill("#pf_y", "8"); await p.click('[data-pb="Carrier"]'); await p.click('[data-pb="Koppel"]'); await p.click('[data-pb="Daikin"]'); await p.fill("#pf_o", "Gree"); await p.fill("#pf_a", "Quezon City, Marikina, San Mateo");
  await p.click('[data-pv="Ref cleaning"]'); await p.click("#pfs"); await p.waitForTimeout(400);
  u = await me(); ok(u.years_exp == 8 && u.bio.startsWith("8 taon") && u.brands.join() == "Carrier,Koppel,Daikin,Gree" && u.addr.includes("Marikina") && u.services.includes("Ref cleaning"), "technician saves bio, years, brands, area and services");
  ok((await p.textContent("#pfk")).includes("Na-save"), "save confirmation is shown");
  await p.setInputFiles("#pgf", [work1, work2, work3]); await p.waitForTimeout(1500);
  u = await me(); ok(u.gallery.length == 3 && u.gallery.every(g => g.startsWith("rodel/")), "technician uploads work photos");
  await p.click('[data-gx="2"]'); await p.waitForTimeout(400); u = await me(); ok(u.gallery.length == 2, "technician removes a work photo");
  ok((await p.textContent(".ppv")).includes("8 taon ng karanasan") && await p.locator(".ppv .tgal img").count() == 2, "preview shows what customers will see");
  await p.evaluate(() => scrollTo(0, 0)); await shot("pp-2-tech-edit");
  await p.fill("#pf_y", "99"); await p.click("#pfs"); await p.waitForTimeout(200); ok((await p.textContent("#pfe")).includes("0 hanggang 60"), "years of experience is validated"); await p.fill("#pf_y", "8");
  await p.click("[data-t=dash]"); await p.waitForTimeout(300); ok((await p.textContent(".pmini")).includes("Kumpleto"), "dashboard says the profile is complete");

  // 2) Customer: profile pic, at nakikita ang profile ng technician kapag pumipili
  await login("maria");
  ok(await p.locator("#hav .av").count() == 1 && !(await p.locator("#hav img").count()), "customer home shows initials before a photo is added");
  await p.click("#hav"); await p.waitForTimeout(300);
  ok(await p.locator("#pvf").count() == 1 && !(await p.locator(".pform").count()), "customer account has a profile pic picker and no technician form");
  await p.setInputFiles("#pvf", custPic); await p.waitForTimeout(800);
  ok(/^maria\//.test((await p.evaluate(() => __DB.profiles.find(x => x.id == "maria").avatar)) || ""), "customer profile pic is saved");
  await shot("pp-3-customer-account");
  await p.click("[data-t=find]"); await p.waitForTimeout(400);
  ok(await p.locator("#hav img.av").count() == 1, "customer home shows their profile pic");
  await p.click('.cat[data-c="0"]'); await p.click('.sv[data-g="1"][data-x="1"]'); await p.waitForTimeout(200);
  ok(await p.locator("#panel .t img.av").count() == 1 && (await p.textContent("#panel .t")).includes("8 taon"), "technician list shows photo and years of experience");
  await p.locator("#panel .t").scrollIntoViewIfNeeded(); await shot("pp-4-tech-list");
  await p.click("#panel .t"); await p.waitForTimeout(400);
  const pt = await p.textContent("#panel");
  ok(pt.includes("8 taon ng karanasan") && pt.includes("service center") && pt.includes("Koppel") && pt.includes("Marikina") && await p.locator("#panel .tgal img").count() == 2, "customer sees the technician profile before booking");
  await shot("pp-5-customer-sees-tech");
  await p.click("#mg"); await p.waitForTimeout(300); await p.fill("#mi", "Hello po"); await p.click("#sn"); await p.waitForTimeout(300);
  ok(await p.locator(".ch-h img.av").count() == 1, "chat header shows the technician photo");

  // 3) Technician: nakikita ang litrato ng customer sa mensahe
  await login("rodel"); await p.click("[data-t=chat]"); await p.waitForTimeout(300);
  ok(await p.locator(".t img.av").count() == 1, "technician sees the customer photo in messages");
  await p.click("[data-t=me]"); await p.waitForTimeout(200); await p.click("#pvx"); await p.waitForTimeout(400);
  ok((await me()).avatar == null, "technician can remove their profile pic");
  ok(errs.length == 0, "no page errors " + errs.join("; "));
  await b.close(); srv.close();
})().catch(e => { console.error(e); process.exit(1) });
