// End-to-end test ng CoolFix gamit ang in-memory na mock ng Supabase.
// Hindi nito sinusubok ang RLS (para diyan ang supabase/schema.sql tests);
// sinusubok nito ang daloy ng UI: sign-up, booking, status, chat at admin.
// Patakbuhin: node tests/e2e.js
const { chromium } = require("playwright");
const path = require("path");

const DB = { profiles: [], bookings: [], messages: [], settings: [], users: [] };
let seq = 1;
const pages = new Set();

function run(q, uid) {
  let rows = DB[q.table];
  const match = r => q.filters.every(([op, c, v]) =>
    op == "eq" ? String(r[c]) == String(v) : op == "neq" ? String(r[c]) != String(v) :
      op == "in" ? v.map(String).includes(String(r[c])) : op == "is" ? r[c] === v : true);
  const emit = (ev, row) => pages.forEach(p => p.evaluate(([t, e, r]) => window.__emit && window.__emit(t, e, r), [q.table, ev, row]).catch(() => { }));
  if (q.op == "insert" || q.op == "upsert") {
    const out = [];
    for (const v of [].concat(q.values)) {
      if (q.table == "settings") { const i = rows.findIndex(r => r.key == v.key); if (i >= 0) rows[i] = { ...rows[i], ...v }; else rows.push({ ...v }); out.push(v); continue; }
      const r = { id: seq++, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), read_at: null, status: q.table == "bookings" ? "pending" : undefined, extras: [], ...v };
      rows.push(r); out.push(r); emit("INSERT", r);
    }
    return q.single ? out[0] : out;
  }
  if (q.op == "update") {
    const hit = rows.filter(match);
    hit.forEach(r => { Object.assign(r, q.values, { updated_at: new Date().toISOString() }); emit("UPDATE", r); });
    return hit;
  }
  let res = rows.filter(match);
  if (q.order) res = [...res].sort((a, b) => (a[q.order.c] > b[q.order.c] ? 1 : -1) * (q.order.asc ? 1 : -1));
  if (q.limit) res = res.slice(0, q.limit);
  if (q.count) return { count: res.length };
  return q.single ? res[0] || null : res;
}

function auth(op, a) {
  if (op == "signUp") {
    if (DB.users.some(u => u.email == a.email)) return { error: { message: "User already registered" } };
    const u = { id: "u" + seq++, email: a.email, password: a.password };
    DB.users.push(u);
    const m = a.options.data;
    DB.profiles.push({ id: u.id, role: m.role == "technician" ? "technician" : "customer", name: m.name, phone: m.phone, addr: m.addr, svc: m.role == "technician" ? m.svc : [], online: false, lat: null, lng: null });
    return { data: { session: { user: { id: u.id, email: u.email } } } };
  }
  if (op == "signIn") {
    const u = DB.users.find(x => x.email == a.email && x.password == a.password);
    return u ? { data: { session: { user: { id: u.id, email: u.email } } } } : { error: { message: "Invalid login credentials" } };
  }
}

const MOCK = () => {
  const subs = [];
  let session = JSON.parse(sessionStorage.getItem("mocksess") || "null"), cb = () => { };
  window.__emit = (table, ev, row) => subs.forEach(s => {
    if (s.table != table || (s.event != "*" && s.event != ev)) return;
    if (s.filter) { const [c, v] = s.filter.split("=eq."); if (String(row[c]) != v) return; }
    s.fn({ new: row });
  });
  class Q {
    constructor(t) { this.q = { table: t, op: "select", filters: [] }; }
    select(c, o) { if (this.q.op == "select" && o && o.count) this.q.count = 1; this.q.sel = true; return this; }
    insert(v) { this.q.op = "insert"; this.q.values = v; return this; }
    upsert(v) { this.q.op = "upsert"; this.q.values = v; return this; }
    update(v) { this.q.op = "update"; this.q.values = v; return this; }
    eq(c, v) { this.q.filters.push(["eq", c, v]); return this; }
    neq(c, v) { this.q.filters.push(["neq", c, v]); return this; }
    in(c, v) { this.q.filters.push(["in", c, v]); return this; }
    is(c, v) { this.q.filters.push(["is", c, v]); return this; }
    order(c, o) { this.q.order = { c, asc: !o || o.ascending !== false }; return this; }
    limit(n) { this.q.limit = n; return this; }
    single() { this.q.single = 1; return this; }
    then(res, rej) {
      return window.mockdb(this.q).then(r => r && r.count != null ? { count: r.count, data: null, error: null } : { data: r, error: null }).then(res, rej);
    }
  }
  const set = s => { session = s; sessionStorage.setItem("mocksess", JSON.stringify(s)); };
  window.supabase = {
    createClient: () => ({
      from: t => new Q(t),
      rpc: () => Promise.resolve({ data: null, error: null }),
      channel: () => { const ch = { on: (_, o, fn) => { subs.push({ ...o, fn }); return ch; }, subscribe: () => ch }; return ch; },
      removeChannel: () => { subs.length = 0; },
      auth: {
        getSession: async () => ({ data: { session } }),
        onAuthStateChange: f => { cb = f; },
        signUp: async a => { const r = await window.mockauth("signUp", a); if (r.data) { set(r.data.session); cb("SIGNED_IN", session); } return { data: r.data || {}, error: r.error }; },
        signInWithPassword: async a => { const r = await window.mockauth("signIn", a); if (r.data) { set(r.data.session); cb("SIGNED_IN", session); } return { error: r.error }; },
        signOut: async () => { set(null); },
        resetPasswordForEmail: async () => ({}),
      },
    }),
  };
  window.COOLFIX_CONFIG_OVERRIDE = true;
};

(async () => {
  const b = await chromium.launch();
  const errors = [];
  const ctx = async (geo) => {
    const c = await b.newContext({ viewport: { width: 430, height: 900 }, geolocation: geo, permissions: ["geolocation"] });
    await c.exposeFunction("mockdb", q => run(q));
    await c.exposeFunction("mockauth", (op, a) => auth(op, a));
    await c.addInitScript(MOCK);
    await c.route("**/vendor/supabase.js", r => r.fulfill({ body: "", contentType: "text/javascript" }));
    await c.route("**/config.js", r => r.fulfill({ contentType: "text/javascript", body: 'window.COOLFIX_CONFIG={supabaseUrl:"https://test.supabase.co",supabaseAnonKey:"k"}' }));
    const p = await c.newPage();
    p.on("pageerror", e => errors.push(e.message));
    pages.add(p);
    await p.goto("file://" + path.resolve(__dirname, "../www/index.html"));
    return p;
  };
  const step = (n, ok) => { console.log((ok ? "PASS " : "FAIL ") + n); if (!ok) process.exitCode = 1; };
  const signup = async (p, r, name, email, extra) => {
    await p.click('[data-m="signup"]'); await p.click(`[data-r="${r}"]`);
    if (extra) await extra();
    await p.fill("#f_n", name); await p.fill("#f_p", "09171234567"); await p.fill("#f_e", email); await p.fill("#f_w", "password123");
    if (await p.$("#f_a")) await p.fill("#f_a", "Brgy. Kamuning, Quezon City");
    await p.click("#go"); await p.waitForTimeout(400);
  };

  // Technician
  const T = await ctx({ latitude: 14.68, longitude: 121.05 });
  await signup(T, "technician", "Rodel Santos", "tech@test.ph", () => T.click('[data-v="Aircon cleaning"]'));
  step("technician sign-up → dashboard", (await T.textContent("#who")).includes("Technician"));
  await T.click("#ol"); await T.waitForTimeout(400);
  step("technician online", DB.profiles.find(p => p.role == "technician").online === true);

  // Customer
  const Cu = await ctx({ latitude: 14.676, longitude: 121.0437 });
  await signup(Cu, "customer", "Maria Reyes", "cust@test.ph");
  step("customer sign-up → home", (await Cu.textContent("#panel")).includes("Kumusta, Maria"));
  await Cu.click('.cat[data-c="0"]'); await Cu.click('.sv[data-g="1"][data-x="1"]'); await Cu.waitForTimeout(200);
  step("online technician listed", (await Cu.textContent("#panel")).includes("Rodel Santos"));
  await Cu.click(".t"); await Cu.waitForTimeout(200);
  step("estimate includes dispatch fee", (await Cu.textContent("#pr")) == "₱1,400");
  await Cu.click("#bk"); await Cu.waitForTimeout(500);
  step("booking created as pending", DB.bookings.length == 1 && DB.bookings[0].status == "pending" && DB.bookings[0].amount == 1400);
  step("customer sees waiting state", (await Cu.textContent("#panel")).includes("Naghihintay"));

  // Technician gets it live and moves it along
  await T.waitForTimeout(500);
  step("technician sees new booking live", (await T.textContent("#auth")).includes("Split 1.5 HP"));
  for (const [s, label] of [["accepted", "Tinanggap ang booking"], ["enroute", "Papunta na"], ["arrived", "Dumating na!"]]) {
    await T.click(`[data-s="${s}"]`); await T.waitForTimeout(500);
    step(`status ${s} reaches customer`, (await Cu.textContent("#panel")).includes(label));
  }

  // Chat
  await Cu.click("#tc"); await Cu.waitForTimeout(400);
  await Cu.fill("#mi", "Nasa gate na po ako"); await Cu.click("#sn"); await Cu.waitForTimeout(400);
  step("customer message shows", (await Cu.textContent("#ms")).includes("Nasa gate na po ako"));
  await T.click('[data-t="chat"]'); await T.waitForTimeout(400);
  step("technician inbox has message", (await T.textContent("#auth")).includes("Nasa gate na po ako"));
  await T.click("[data-k]"); await T.waitForTimeout(400);
  await T.fill("#mi", "Sige po, papasok na"); await T.press("#mi", "Enter"); await T.waitForTimeout(500);
  step("reply reaches customer live", (await Cu.textContent("#ms")).includes("Sige po, papasok na"));

  // Done
  await T.click('[data-t="dash"]'); await T.waitForTimeout(400);
  await T.click('[data-s="done"]'); await T.waitForTimeout(500);
  await Cu.click('[data-t="find"]'); await Cu.waitForTimeout(300);
  step("customer sees done", (await Cu.textContent("#panel")).includes("Tapos na!"));
  step("technician earnings 85%", (await T.textContent("#auth")).includes("₱1,190"));

  // Admin (promoted via SQL in real life)
  const Ad = await ctx({ latitude: 14.6, longitude: 121 });
  await signup(Ad, "customer", "Boss Admin", "admin@test.ph");
  DB.profiles.find(p => p.name == "Boss Admin").role = "admin";
  await Ad.click("#lo"); await Ad.waitForTimeout(300);
  await Ad.fill("#f_e", "admin@test.ph"); await Ad.fill("#f_w", "password123"); await Ad.click("#go"); await Ad.waitForTimeout(600);
  step("admin overview totals", (await Ad.textContent("#auth")).includes("₱1,400") && (await Ad.textContent("#auth")).includes("₱210"));
  await Ad.click('[data-t="tx"]'); await Ad.waitForTimeout(400);
  step("admin transactions list", (await Ad.textContent("#auth")).includes("Maria Reyes"));
  await Ad.click('[data-t="sv"]'); await Ad.waitForTimeout(300);
  await Ad.fill('[data-i="0:0:1"]', "650"); await Ad.click("#ss"); await Ad.waitForTimeout(400);
  step("admin price saved to settings", DB.settings.find(s => s.key == "catalog").value[0].g[0][1][0][1] == 650);

  // Wrong password message
  await Cu.click("#lo"); await Cu.waitForTimeout(300);
  await Cu.fill("#f_e", "cust@test.ph"); await Cu.fill("#f_w", "wrongpass"); await Cu.click("#go"); await Cu.waitForTimeout(300);
  step("wrong password message", (await Cu.textContent("#er")).includes("Mali ang email o password"));

  if (process.argv.includes("--shots")) {
    const out = process.argv[process.argv.indexOf("--shots") + 1];
    await T.click('[data-t="dash"]'); await T.waitForTimeout(300);
    await T.screenshot({ path: out + "/tech.png", fullPage: true });
    await Ad.click('[data-t="ov"]'); await Ad.waitForTimeout(400);
    await Ad.screenshot({ path: out + "/admin.png", fullPage: true });
  }
  step("no page errors", errors.length == 0); if (errors.length) console.log(errors);
  await b.close();
})();
