// CoolFix app — Supabase version
const CFG = window.COOLFIX_CONFIG || {};
const $ = id => document.getElementById(id);
const A = $("auth");
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = n => "₱" + Number(n || 0).toLocaleString("en-PH");
const fee = a => Math.round(a * .15);
const dstr = t => new Date(t).toLocaleDateString("en-PH", { month: "short", day: "numeric" });
const tm = t => new Date(t).toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" });
const cl = x => JSON.parse(JSON.stringify(x));
const ini = n => String(n || "?").trim().split(/\s+/).map(w => w[0]).slice(0, 2).join("").toUpperCase();
const first = n => String(n || "").split(" ")[0];

if (!CFG.supabaseUrl || !CFG.supabaseAnonKey || !window.supabase) {
  A.innerHTML = `<div class="panel au"><h2>Hindi pa naka-setup ang CoolFix</h2><p class="mute">Ilagay ang Supabase URL at anon key sa <b>config.js</b>.</p></div>`;
  throw new Error("CoolFix: missing Supabase config");
}
const sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey);

// ---------- Static data ----------
const SERVICES = ["Lahat", "Aircon cleaning", "Aircon repair", "Aircon install", "Ref cleaning", "Ref repair", "Freon refill"];
const DEFCAT = [
  { k: 'Aircon cleaning', t: 'Aircon Cleaning', d: 'General cleaning / preventive maintenance', n: 'Presyo ayon sa uri at laki (HP) ng aircon.', g: [['Window Type', [['Window 0.5 HP', 600], ['Window 1.0 HP', 700], ['Window 1.5 HP', 800], ['Window 2.0 HP', 900]]], ['Split Type', [['Split 1.0 HP', 950], ['Split 1.5 HP', 1100], ['Split 2.0 HP', 1350], ['Split 2.5 HP', 1600]]], ['Floor Standing at Cassette', [['Floor Standing', 2000], ['Ceiling Cassette', 2750]]]] },
  { k: 'Aircon repair', t: 'Aircon Repair', d: 'Check-up, parte, freon at compressor', n: 'Labor lang ang presyo. Hiwalay ang singil sa parte.', g: [['Check-up', [['Initial Check-up / Diagnosis', 550]]], ['Electrical at parte', [['Capacitor Replacement', 650], ['Fan Motor Replacement', 950], ['Thermostat Replacement', 700], ['PCB Troubleshooting', 1150], ['PCB Replacement', 1150], ['Electrical Wiring Repair', 1000]]], ['Drainage at refrigerant', [['Drainage Repair', 750], ['Refrigerant Leak Detection', 1150], ['Refrigerant Recharging', 1500], ['Compressor Replacement', 3250]]]] },
  { k: 'Ref cleaning', t: 'Refrigerator Cleaning', d: 'General cleaning at maintenance', n: 'Presyo ayon sa uri ng ref o freezer.', g: [['Refrigerator', [['Single Door', 600], ['Two Door', 750], ['No Frost Refrigerator', 1000], ['Side-by-Side Refrigerator', 1250], ['French Door Refrigerator', 1500]]], ['Commercial at Freezer', [['Commercial Refrigerator', 2250], ['Chest Freezer', 950], ['Upright Freezer', 1150]]]] },
  { k: 'Ref repair', t: 'Refrigerator Repair', d: 'Thermostat, fan motor, gasket, freon, compressor', n: 'Labor lang ang presyo. Hiwalay ang singil sa parte.', g: [['Check-up', [['Check-up / Diagnosis', 550]]], ['Electrical at parte', [['Thermostat Repair', 750], ['Defrost Timer Replacement', 700], ['Fan Motor Replacement', 950], ['Relay Replacement', 700], ['Overload Protector Replacement', 700]]], ['Pinto at drainage', [['Door Gasket Replacement', 750], ['Drainage Repair', 700]]], ['Refrigerant system', [['Refrigerant Leak Detection', 1150], ['Refrigerant Charging', 1500], ['Compressor Replacement', 3750]]]] }];
const DEFOC = [{ n: 'Home Service / Dispatch Fee', k: 'fixed', p: 300, a: true }, { n: 'Additional Unit Inspection', k: 'fixed', p: 250, a: false }, { n: 'Emergency Service', k: 'pct', p: 30, a: false }, { n: 'After-hours Service', k: 'pct', p: 20, a: false }, { n: 'Out-of-town Service', k: 'custom', a: false }, { n: 'Ladder / Special Equipment', k: 'fixed', p: 400, a: false }];
const SVM = { "Aircon cleaning": ["Aircon cleaning"], "Aircon repair": ["Aircon repair", "Freon refill"], "Ref cleaning": ["Ref cleaning"], "Ref repair": ["Ref repair", "Freon refill"] };
const DEF = { 'Aircon cleaning': 500, 'Aircon repair': 900, 'Aircon install': 2500, 'Ref cleaning': 600, 'Ref repair': 700, 'Freon refill': 650 };
const ACTIVE = ["Bago", "Papunta na", "Dumating na"];

// ---------- State ----------
let USER = null, TECHS = [], TX = [], CONVS = [], PROFILES = [];
let CAT = cl(DEFCAT), OC = cl(DEFOC), PRICES = { ...DEF };
let mode = "login", role = "customer", err = "", sset = new Set();
let TAB = "find", CUR = null, VIEW = "", TRACK = null, svc = "Lahat", sel = null, cat = null, item = null;
let channel = null, watchId = null, lastLoc = 0;
let ED = null, EC = 0, AF = { st: 'Lahat', q: '' };

// ---------- Location helpers ----------
let C = { lat: 14.676, lng: 121.0437 };
const KM = .09;
const hv = (a, b) => { const R = 6371, r = Math.PI / 180, dl = (b.lat - a.lat) * r, dn = (b.lng - a.lng) * r, h = Math.sin(dl / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dn / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)) };
const ll = (x, y) => ({ lat: C.lat + (50 - y) * 0.000808, lng: C.lng + (x - 50) * 0.000836 });
const hash = s => { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) | 0; return Math.abs(h) };
function place(t) {
  if (t.lat != null && t.lng != null) {
    t.x = Math.min(95, Math.max(5, 50 + (t.lng - C.lng) / 0.000836));
    t.y = Math.min(95, Math.max(5, 50 - (t.lat - C.lat) / 0.000808));
  } else { const h = hash(t.id); t.x = 15 + h % 70; t.y = 15 + (h >> 8) % 70; if (Math.abs(t.x - 50) < 6 && Math.abs(t.y - 50) < 6) t.x += 12 }
  return t;
}
const tpos = t => t.lat != null ? { lat: t.lat, lng: t.lng } : ll(t.x, t.y);
const dist = t => t.lat != null ? hv(C, { lat: t.lat, lng: t.lng }) : Math.hypot(t.x - 50, t.y - 50) * KM;
const eta = t => Math.max(4, Math.round(dist(t) * 5 + 3));
const getLoc = () => new Promise(r => { if (!navigator.geolocation) return r(null); navigator.geolocation.getCurrentPosition(p => r({ lat: p.coords.latitude, lng: p.coords.longitude }), () => r(null), { enableHighAccuracy: true, timeout: 8000 }) });

// ---------- Data loading ----------
const toTech = p => place({ id: p.id, n: p.name, s: p.services || [], online: p.online, lat: p.lat, lng: p.lng, addr: p.addr });
async function loadSettings() {
  const { data } = await sb.from("settings").select("key,value");
  const m = Object.fromEntries((data || []).map(r => [r.key, r.value]));
  if (Array.isArray(m.catalog) && m.catalog.length) CAT = m.catalog;
  if (Array.isArray(m.other_charges) && m.other_charges.length) OC = m.other_charges;
  if (m.prices && typeof m.prices == "object") PRICES = { ...DEF, ...m.prices };
}
async function saveSetting(key, value) {
  const { error } = await sb.from("settings").upsert({ key, value, updated_at: new Date().toISOString() });
  return error;
}
async function loadTechs() {
  const { data } = await sb.from("profiles").select("id,name,services,online,lat,lng,addr").eq("role", "technician");
  const all = data || [];
  TECHS = all.filter(p => p.online && p.id != USER?.id).map(toTech);
  return all;
}
async function loadTX() {
  const { data } = await sb.from("bookings").select("*").order("created_at", { ascending: false }).limit(500);
  TX = (data || []).map(normTx);
}
const normTx = b => ({ ...b, ts: new Date(b.created_at).getTime(), cust: b.cust_name, tech: b.tech_name, st: b.status });
function upsertTx(b) { const n = normTx(b), i = TX.findIndex(x => x.id == n.id); if (i >= 0) TX[i] = n; else TX.unshift(n); return n }
async function loadConvs() {
  const { data: cs } = await sb.from("conversations").select("*");
  const ids = (cs || []).map(c => c.id);
  let ms = [];
  if (ids.length) { const r = await sb.from("messages").select("*").in("conv_id", ids).order("created_at"); ms = r.data || [] }
  CONVS = (cs || []).map(c => ({ ...c, m: ms.filter(m => m.conv_id == c.id).map(m => ({ id: m.id, f: m.sender, t: m.body, ts: new Date(m.created_at).getTime() })) }));
}
async function loadProfiles() { const { data } = await sb.from("profiles").select("*"); PROFILES = data || [] }

function subscribe() {
  if (channel) sb.removeChannel(channel);
  channel = sb.channel("coolfix-" + USER.id)
    .on("postgres_changes", { event: "*", schema: "public", table: "bookings" }, p => { if (p.new && p.new.id) { const b = upsertTx(p.new); onBooking(b) } })
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, async p => {
      const m = p.new, c = CONVS.find(x => x.id == m.conv_id);
      if (!c) { await loadConvs() } else if (!c.m.some(x => x.id == m.id)) c.m.push({ id: m.id, f: m.sender, t: m.body, ts: new Date(m.created_at).getTime() });
      refresh("msg");
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "profiles" }, p => {
      const r = p.new; if (!r || r.role != "technician" || r.id == USER.id) return;
      const i = TECHS.findIndex(t => t.id == r.id);
      if (r.online) { const t = toTech(r); if (i >= 0) TECHS[i] = t; else TECHS.push(t) } else if (i >= 0 && !(TRACK && TRACK.tech_id == r.id)) TECHS.splice(i, 1);
      if (TRACK && TRACK.tech_id == r.id) { const t = i >= 0 ? TECHS[i] : toTech(r); Object.assign(t, toTech(r)) }
      refresh("tech");
    })
    .subscribe();
}
function onBooking(b) {
  if (USER.role == "technician") syncWatch();
  if (TRACK && TRACK.id == b.id) TRACK = b;
  refresh("booking");
}
// Re-render only views that show live data, so typing elsewhere is not interrupted.
function refresh(kind) {
  if (!USER) return;
  tabsBar();
  if (VIEW == "chat" && kind == "msg") chatView();
  else if (VIEW == "inbox" && kind == "msg") inbox();
  else if (VIEW == "dash" && kind != "tech") techDash();
  else if (VIEW == "track" && kind != "msg") trackView();
  else if (VIEW == "home" && kind == "tech") home();
  else if (VIEW == "home") homeStats();
  else if (USER.role == "admin" && kind == "booking" && ["ov", "tx", "tt"].includes(TAB)) adminView();
}

// ---------- Auth ----------
function authView(notice) {
  VIEW = "auth"; A.hidden = false; $("app").hidden = true; $("lo").hidden = true; $("tabs").hidden = true; $("who").textContent = "";
  const su = mode == "signup", tc = role == "technician";
  A.innerHTML = `<div class="panel au"><img class="logo big" src="img/logo.png" alt="CoolFix">${notice ? `<p class="note">${notice}</p>` : ""}<div class="chips"><button class="chip" aria-pressed="${!su}" data-m="login">Mag-log in</button><button class="chip" aria-pressed="${su}" data-m="signup">Gumawa ng account</button></div>
 ${su ? `<p class="mute" style="margin:0 0 6px">Mag-sign up bilang</p><div class="chips"><button class="chip" aria-pressed="${!tc}" data-r="customer">Customer</button><button class="chip" aria-pressed="${tc}" data-r="technician">Technician</button></div><label>Buong pangalan<input id="f_n" autocomplete="name"></label><label>Cellphone number<input id="f_p" type="tel" placeholder="09XXXXXXXXX" autocomplete="tel"></label>` : ""}
 <label>Email<input id="f_e" type="email" autocomplete="email"></label>
 <label>Password${su ? " (hindi bababa sa 8 character)" : ""}<input id="f_w" type="password" autocomplete="${su ? "new-password" : "current-password"}"></label>
 ${su && !tc ? `<label>Address<input id="f_a" placeholder="Brgy., Lungsod"></label>` : ""}
 ${su && tc ? `<p class="mute" style="margin:12px 0 6px">Anong serbisyo ang kaya mo?</p><div class="chips">${SERVICES.slice(1).map(s => `<button class="chip" data-v="${s}" aria-pressed="${sset.has(s)}">${s}</button>`).join("")}</div><label>Lugar na sakop<input id="f_a" placeholder="hal. Quezon City, Marikina"></label>` : ""}
 <p class="err" id="er" role="alert">${esc(err)}</p>
 <button class="btn" id="go">${su ? "Gumawa ng account" : "Mag-log in"}</button>
 ${su ? "" : `<button class="chip" id="fp" style="margin-top:10px;border:0">Nakalimutan ang password?</button>`}
 ${CFG.googleLogin ? `<p class="or">o</p><button class="gbtn" id="gg"><svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z"/><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4.1 7.1-10.1 7.1-17.5z"/><path fill="#FBBC05" d="M10.5 28.7c-.5-1.5-.8-3-.8-4.7s.3-3.2.8-4.7l-7.9-6.1C.9 16.4 0 20.1 0 24s.9 7.6 2.6 10.8l7.9-6.1z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.5-5.8c-2.1 1.4-4.8 2.3-8.4 2.3-6.3 0-11.6-4.1-13.5-9.8l-7.9 6.1C6.5 42.6 14.6 48 24 48z"/></svg>${su ? "Mag-sign up gamit ang Google" : "Mag-log in gamit ang Google"}</button>` : ""}</div>`;
  A.querySelectorAll("[data-m]").forEach(b => b.onclick = () => { mode = b.dataset.m; err = ""; authView() });
  A.querySelectorAll("[data-r]").forEach(b => b.onclick = () => { role = b.dataset.r; err = ""; authView() });
  A.querySelectorAll("[data-v]").forEach(b => b.onclick = () => { const v = b.dataset.v; sset.has(v) ? sset.delete(v) : sset.add(v); b.setAttribute("aria-pressed", sset.has(v)) });
  $("go").onclick = su ? doSignup : doLogin;
  $("f_w").onkeydown = e => { if (e.key == "Enter") $("go").click() };
  if ($("fp")) $("fp").onclick = doForgot;
  if ($("gg")) $("gg").onclick = doGoogle;
}
const busy = (id, on) => { const b = $(id); if (b) b.disabled = on };
const redirect = () => location.origin + location.pathname;
function authErr(e) {
  const m = String(e?.message || e || "");
  if (/invalid login/i.test(m)) return "Mali ang email o password.";
  if (/not confirmed/i.test(m)) return "Hindi pa na-confirm ang email mo. Tingnan ang inbox mo para sa confirmation link.";
  if (/already registered|already exists/i.test(m)) return "May account na gamit ang email na ito. Subukang mag-log in.";
  if (/rate limit|too many/i.test(m)) return "Masyadong maraming subok. Maghintay ng ilang minuto.";
  return "May problema: " + m;
}
async function doSignup() {
  const v = i => ($(i)?.value || "").trim(), n = v("f_n"), p = v("f_p").replace(/[\s-]/g, ""), e = v("f_e").toLowerCase(), w = $("f_w").value, a = v("f_a");
  const bad = !n ? "Ilagay ang buong pangalan mo." : !/^(09|\+639)\d{9}$/.test(p) ? "Mali ang cellphone number. Gamitin ang format na 09XXXXXXXXX." : !/^\S+@\S+\.\S+$/.test(e) ? "Mali ang email address." : w.length < 8 ? "Masyadong maikli ang password. Gamitin ang hindi bababa sa 8 character." : role == "technician" && !sset.size ? "Pumili ng kahit isang serbisyo." : "";
  if (bad) { $("er").textContent = err = bad; return }
  busy("go", true);
  const { data, error } = await sb.auth.signUp({ email: e, password: w, options: { emailRedirectTo: redirect(), data: { role, name: n, phone: p, addr: a, services: [...sset] } } });
  busy("go", false);
  if (error) { $("er").textContent = err = authErr(error); return }
  sset = new Set();
  if (data.session) return start(data.session);
  mode = "login"; err = "";
  authView(`Halos tapos na! Nagpadala kami ng confirmation link sa <b>${esc(e)}</b>. I-click ito, tapos bumalik dito para mag-log in.`);
}
async function doLogin() {
  const e = $("f_e").value.trim().toLowerCase(), w = $("f_w").value;
  if (!e || !w) { $("er").textContent = err = "Ilagay ang email at password."; return }
  busy("go", true);
  const { data, error } = await sb.auth.signInWithPassword({ email: e, password: w });
  busy("go", false);
  if (error) { $("er").textContent = err = authErr(error); return }
  start(data.session);
}
async function doForgot() {
  const e = $("f_e").value.trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(e)) { $("er").textContent = "Ilagay muna ang email mo sa itaas."; return }
  const { error } = await sb.auth.resetPasswordForEmail(e, { redirectTo: redirect() });
  if (error) { $("er").textContent = authErr(error); return }
  authView(`Nagpadala kami ng link sa <b>${esc(e)}</b> para makagawa ng bagong password.`);
}
function newPasswordView() {
  VIEW = "auth"; A.hidden = false; $("app").hidden = true; $("tabs").hidden = true;
  A.innerHTML = `<div class="panel au"><h2>Gumawa ng bagong password</h2><label>Bagong password (hindi bababa sa 8 character)<input id="np" type="password" autocomplete="new-password"></label><p class="err" id="er" role="alert"></p><button class="btn" id="ns">I-save ang password</button></div>`;
  $("ns").onclick = async () => {
    const w = $("np").value; if (w.length < 8) { $("er").textContent = "Masyadong maikli ang password."; return }
    const { error } = await sb.auth.updateUser({ password: w });
    if (error) { $("er").textContent = authErr(error); return }
    RECOVERY = false; history.replaceState(null, '', redirect());
    const { data } = await sb.auth.getSession(); start(data.session);
  };
}
async function doGoogle() {
  if (mode == "signup") localStorage.setItem("coolfix_pending", JSON.stringify({ role, services: [...sset], addr: ($("f_a")?.value || "").trim(), at: Date.now() }));
  else localStorage.removeItem("coolfix_pending");
  const { error } = await sb.auth.signInWithOAuth({ provider: "google", options: { redirectTo: redirect() } });
  if (error) $("er").textContent = authErr(error);
}
async function applyPending(p) {
  let pend = null; try { pend = JSON.parse(localStorage.getItem("coolfix_pending")) } catch (e) { }
  localStorage.removeItem("coolfix_pending");
  if (!pend || Date.now() - pend.at > 15 * 60e3 || Date.now() - new Date(p.created_at).getTime() > 15 * 60e3) return p;
  const upd = { addr: pend.addr || p.addr };
  if (pend.role == "technician" && p.role == "customer") { upd.role = "technician"; upd.services = pend.services }
  const { data } = await sb.from("profiles").update(upd).eq("id", p.id).select().single();
  return data || p;
}

let starting = false;
async function start(session) {
  if (!session || starting || (USER && USER.id == session.user.id)) return;
  starting = true;
  try {
    A.innerHTML = `<div class="panel au"><p class="mute">Naglo-load…</p></div>`;
    let { data: p, error } = await sb.from("profiles").select("*").eq("id", session.user.id).single();
    if (error || !p) { console.error("profile load", error); await sb.auth.signOut(); err = "Hindi ma-load ang account mo" + (error ? " (" + (error.code || "") + " " + error.message + ")" : " (walang profile)") + ". Subukan ulit o sabihan ang admin."; return authView() }
    if (p.google) p = await applyPending(p);
    USER = p;
    await Promise.all([loadSettings(), loadTX(), loadConvs()]);
    await enter();
  } catch (e) {
    console.error(e); USER = null; err = "May error habang naglo-load: " + (e.message || e); authView();
  } finally { starting = false }
}
async function enter() {
  const u = USER; err = "";
  $("who").textContent = first(u.name) + " · " + (u.role == "customer" ? "Customer" : u.role == "admin" ? "Admin" : "Technician"); $("lo").hidden = false;
  subscribe(); document.body.classList.toggle('adm', u.role == 'admin'); document.documentElement.style.background = u.role == 'admin' ? '#091233' : '';
  TAB = u.role == "customer" ? "find" : u.role == "admin" ? "ov" : "dash"; CUR = null;
  if (u.role == "customer") {
    await loadTechs(); show(); initGM();
    getLoc().then(p => { if (p) { C = p; TECHS.forEach(place); if (VIEW == "home") home(); if (GL) { gme.setPosition(C); gmap.setCenter(C); gpins() } } });
  } else if (u.role == "admin") { await Promise.all([loadProfiles(), loadTechs()]); show() }
  else { syncWatch(); show() }
}
$("lo").onclick = async () => { stopWatch(); if (channel) sb.removeChannel(channel); channel = null; await sb.auth.signOut(); USER = null; TRACK = null; document.body.classList.remove("adm"); document.documentElement.style.background = ""; mode = "login"; role = "customer"; cat = null; item = null; authView() };

// ---------- Navigation ----------
const rk = () => USER.role == 'customer' ? 'c' : 't';
const myRead = c => new Date(rk() == 'c' ? c.read_c : c.read_t).getTime();
const unreadOf = c => c.m.filter(m => m.f != rk() && m.ts > myRead(c)).length;
const unreadN = () => USER && USER.role != 'admin' ? CONVS.reduce((n, c) => n + unreadOf(c), 0) : 0;
function tabList() {
  const c = USER.role == 'customer', ad = USER.role == 'admin';
  return ad ? [['ov', 'Overview'], ['tx', 'Transaction'], ['tt', 'Technician'], ['sv', 'Serbisyo'], ['pr', 'Base price'], ['rg', 'Rate guide']] : c ? [['find', 'Hanapin'], ['rg', 'Rate guide'], ['chat', 'Mensahe'], ['me', 'Account']] : [['dash', 'Dashboard'], ['rg', 'Rate guide'], ['chat', 'Mensahe'], ['me', 'Account']];
}
const ICON = { ov: '<path d="M3 13h8V3H3zM13 21h8V11h-8zM3 21h8v-6H3zM13 3v6h8V3z"/>', tx: '<path d="M4 6h16M4 12h16M4 18h10"/>', tt: '<circle cx="9" cy="8" r="4"/><path d="M2 21c0-4 3-6 7-6s7 2 7 6M17 11l2 2 4-4"/>', sv: '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-2.4-.6-.6-2.4z"/>', pr: '<path d="M20 12l-8 8-9-9V3h8zM7.5 7.5h.01"/>', rg: '<path d="M4 4h12l4 4v12H4zM8 12h8M8 16h5"/>' };
function tabsBar() {
  const nb = $('tabs'); nb.hidden = false;
  nb.innerHTML = tabList().map(([k, l]) => `<button class='tab' aria-pressed='${TAB == k}' data-t='${k}'>${ICON[k] ? `<svg class="ti" viewBox="0 0 24 24" aria-hidden="true">${ICON[k]}</svg>` : ''}<span>${l}</span>${k == 'chat' && unreadN() ? ' <i class="dot"></i>' : ''}</button>`).join('');
  nb.querySelectorAll('button').forEach(b => b.onclick = () => { TAB = b.dataset.t; CUR = null; if (TAB == 'find') TRACK = null; show() });
}
function show() {
  const c = USER.role == 'customer', ad = USER.role == 'admin';
  tabsBar();
  const mapTab = c && TAB == 'find';
  $('app').hidden = !mapTab; A.hidden = mapTab;
  if (mapTab) return TRACK ? trackView() : home();
  if (TAB == 'rg') { VIEW = "rg"; rateGuide() }
  else if (ad) adminView();
  else if (TAB == 'chat') CUR ? chatView(1) : inbox();
  else if (TAB == 'me') profile();
  else techDash();
}

// ---------- Customer: find & book ----------
function list() { return TECHS.filter(t => t.online && (svc == "Lahat" || (SVM[svc] || [svc]).some(x => t.s.includes(x)))).sort((a, b) => dist(a) - dist(b)) }
function pins() {
  $("pins").innerHTML = list().map((t, i) => `<g class="pin" tabindex="0" data-i="${esc(t.id)}"><circle cx="${t.x}" cy="${t.y}" r="${sel === t ? 4.4 : 3.4}" fill="var(--orange)" stroke="#fff" stroke-width="1"/><text x="${t.x}" y="${t.y + 1.2}" text-anchor="middle" font-size="3" font-weight="700" fill="#fff">${esc(ini(t.n)[0])}</text></g>`).join("");
  document.querySelectorAll(".pin").forEach(p => { p.onclick = () => pick(TECHS.find(t => t.id == p.dataset.i)); p.onkeydown = e => { if (e.key == "Enter") p.onclick() } }); if (GL) gpins();
}
const myBookings = () => TX.filter(x => x.customer_id == USER.id);
function homeStats() { const s = $("hstats"); if (s) s.innerHTML = statsHtml() }
const statsHtml = () => `<div><b>${myBookings().length}</b><small>Booking mo</small></div><div><b>${TECHS.filter(t => t.online).length}</b><small>Online na technician</small></div><div><b>${unreadN()}</b><small>Bagong mensahe</small></div>`;
function home() {
  VIEW = "home"; $("app").hidden = false; A.hidden = true;
  if (GL) gClear(); $("route").innerHTML = ""; sel = null;
  svc = cat ? (cat.m || cat.k) : "Lahat"; pins();
  const L = list(), act = myBookings().filter(x => ACTIVE.includes(x.st));
  const tl = L.map(t => `<button class="t" data-i="${esc(t.id)}"><div class="av">${esc(ini(t.n))}</div><div><b>${esc(t.n)}</b><small>${esc(t.s.join(', '))}</small></div><div class="km">${dist(t).toFixed(1)} km<small>~${eta(t)} min</small></div></button>`).join("") || '<p class="mute">Wala pang online na technician para sa serbisyong ito. Subukan ulit mamaya.</p>';
  const hd = `<div class='hello'><b>Kumusta, ${esc(first(USER.name))}!</b><span>${TECHS.filter(t => t.online).length} technician ang online ngayon</span></div><div class='stats' id='hstats'>${statsHtml()}</div>${act.length ? `<p class="note">May aktibo kang booking. <button class="chip" id="ab">Tingnan</button></p>` : ""}`;
  let body;
  if (!cat) body = `<h2>Anong serbisyo ang kailangan mo?</h2><div class="cats">${CAT.map((c, i) => `<button class="cat" data-c="${i}"><b>${esc(c.t)}</b><small>${esc(c.d)}</small></button>`).join("")}</div><p class="mute" style="font-size:13px">Tingnan ang <b>Rate guide</b> tab para sa lahat ng presyo at iba pang singil.</p>`;
  else body = `<button class="chip" id="cb">‹ Lahat ng serbisyo</button><h2 style="margin:10px 0 2px">${esc(cat.t)}</h2><p class="mute" style="margin:0 0 4px;font-size:13px">${esc(cat.n)}</p>
 ${cat.g.map((g, gi) => `<p class="gh">${esc(g[0])}</p>${g[1].map((x, xi) => `<button class="sv" aria-pressed="${!!item && item.n == x[0] && item.c == cat.k}" data-g="${gi}" data-x="${xi}"><span>${esc(x[0])}</span><b>${fmt(x[1])}</b></button>`).join("")}`).join("")}
 <h3 style="margin:16px 0 4px">${item ? 'Pumili ng technician' : 'Pumili muna ng serbisyo sa itaas'}</h3>${item ? `<p class="mute" style="margin:0 0 4px;font-size:13px">${L.length} technician na malapit sa'yo para sa ${esc(item.n)}</p>${tl}` : ''}`;
  $("panel").innerHTML = hd + body;
  if ($("ab")) $("ab").onclick = () => { TRACK = act[0]; trackView() };
  document.querySelectorAll(".cat").forEach(b => b.onclick = () => { cat = CAT[b.dataset.c]; item = null; home() });
  if (cat) {
    $("cb").onclick = () => { cat = null; item = null; home() };
    document.querySelectorAll(".sv").forEach(b => b.onclick = () => { const x = cat.g[b.dataset.g][1][b.dataset.x]; item = { c: cat.k, n: x[0], p: x[1], t: cat.t }; home() })
  }
  document.querySelectorAll(".t").forEach(c => c.onclick = () => pick(TECHS.find(t => t.id == c.dataset.i)));
}
const ocs = o => o.k == 'pct' ? '+' + o.p + '%' : o.k == 'custom' ? 'Custom quotation' : fmt(o.p);
function pick(t) {
  if (!t) return;
  if (!item) { sel = t; pins(); $("panel").insertAdjacentHTML("afterbegin", `<p class="note">Pumili muna ng serbisyo bago mag-book kay ${esc(first(t.n))}.</p>`); return }
  VIEW = "pick"; sel = t; pins();
  const au = OC.filter(o => o.a), opt = OC.map((o, i) => o.a ? '' : `<label class="ck"><input type="checkbox" data-oc="${i}"> ${esc(o.n)} <small>${ocs(o)}</small></label>`).join("");
  $("panel").innerHTML = `<h2>${esc(t.n)}</h2><p class="mute" style="margin:0">${esc(t.s.join(', '))} · ${dist(t).toFixed(1)} km ang layo</p>
 <div class="price" style="margin-top:12px"><span>${esc(item.t)}<br><b style="font-size:16px">${esc(item.n)}</b></span><span class="mute">${fmt(item.p)}</span></div>
 ${opt ? `<p class="gh">Dagdag na singil (kung kailangan)</p>${opt}` : ''}
 <label class="mute" style="display:block;margin-top:10px">Address<input id="ad" value="${esc(USER.addr || '')}" placeholder="Bahay/Unit, Kalye, Brgy., Lungsod"></label>
 <label class="mute" style="display:block;margin-top:10px">Oras<select id="tm"><option>Ngayon (~${eta(t)} min)</option><option>Mamayang hapon</option><option>Bukas ng umaga</option></select></label>
 <div class="price"><span>Tinatayang bayad${au.length ? `<br><small class="mute">kasama ang ${au.map(o => esc(o.n)).join(', ')}</small>` : ''}</span><b id="pr"></b></div><p class="mute" style="font-size:13px;margin:4px 0 0">Suggested starting rates ito. Maaaring magbago ang huling bayad depende sa aktwal na check ng unit. Hiwalay ang singil sa parte.</p>
 <p class="err" id="be" role="alert"></p>
 <button class="btn" id="bk">I-book si ${esc(first(t.n))}</button>
 <button class="btn alt" id="mg">Mag-message kay ${esc(first(t.n))}</button>
 <button class="btn alt" id="bc">Bumalik sa listahan</button>`;
  const on = i => OC[i].a || !!document.querySelector(`[data-oc="${i}"]:checked`);
  const est = () => { let a = item.p, p = 0, cu = 0; OC.forEach((o, i) => { if (!on(i)) return; if (o.k == 'fixed') a += o.p; else if (o.k == 'pct') p += o.p / 100; else cu = 1 }); const v = Math.round(a * (1 + p)); return [v, cu] },
    up = () => { const e = est(); $("pr").textContent = fmt(e[0]) + (e[1] ? ' + custom' : '') };
  document.querySelectorAll("[data-oc]").forEach(i => i.onchange = up); up();
  $("bc").onclick = home; $("mg").onclick = () => openChat(t);
  $("bk").onclick = async () => {
    const ad = $("ad").value.trim(); if (ad.length < 5) { $("be").textContent = "Ilagay ang buong address mo."; return }
    const extras = OC.filter((o, i) => !o.a && on(i)).map(o => o.n);
    busy("bk", true);
    const { data, error } = await sb.from("bookings").insert({ customer_id: USER.id, tech_id: t.id, cust_name: USER.name, cust_phone: USER.phone || "", tech_name: t.n, svc: item.t + ': ' + item.n + (extras.length ? ' + ' + extras.join(', ') : ''), address: ad, sched: $("tm").value, amt: est()[0] }).select().single();
    busy("bk", false);
    if (error) { $("be").textContent = "Hindi na-book: " + error.message; return }
    if (!USER.addr) { USER.addr = ad; sb.from("profiles").update({ addr: ad }).eq("id", USER.id) }
    TRACK = upsertTx(data); trackView();
  };
}
const STEPS = ["Hinihintay ang sagot ng technician", "Papunta na", "Dumating na", "Tapos na ang trabaho"];
function trackView() {
  const b = TRACK; if (!b) return home();
  VIEW = "track"; $("app").hidden = false; A.hidden = true;
  let t = TECHS.find(x => x.id == b.tech_id);
  if (!t) { t = place({ id: b.tech_id, n: b.tech_name, s: [] }); TECHS.push(t) }
  sel = t; pins();
  const p = [[t.x, t.y], [50, t.y], [50, 50]];
  $("route").innerHTML = ACTIVE.includes(b.st) ? `<polyline points="${p.map(q => q.join(",")).join(" ")}" fill="none" stroke="var(--blue)" stroke-width="1.2" stroke-dasharray="2 2"/>` : "";
  if (GL) gtrack(t, b);
  const stage = { "Bago": 0, "Papunta na": 1, "Dumating na": 2, "Natapos": 3 }[b.st];
  const big = b.st == "Bago" ? "Naghihintay…" : b.st == "Papunta na" ? `~${eta(t)} min` : b.st == "Dumating na" ? "Dumating na!" : b.st == "Natapos" ? "Tapos na!" : b.st;
  const sub = b.st == "Papunta na" ? `${dist(t).toFixed(1)} km ang layo` : b.st == "Tinanggihan" ? "Hindi available ang technician. Pumili ng iba." : b.st == "Kinansela" ? "Kinansela ang booking na ito." : "";
  $("panel").innerHTML = `<h2>Booking ${esc(b.code || '')} · ${esc(first(b.tech_name))}</h2>
 <p class="mute" style="margin:0 0 12px">${esc(b.svc)} · ${esc(b.address)}</p>
 <div class="eta">${big}</div><div class="mute">${sub}</div>
 ${stage != null ? `<ul class="steps">${STEPS.map((s, i) => `<li class="${i <= stage ? 'on' : ''}">${s}</li>`).join('')}</ul>` : ''}
 <div class="row"><span class="mute">Tinatayang bayad</span><b>${fmt(b.amt)}</b></div>
 <button class="btn" id="tc">Mag-message sa technician</button>
 ${["Bago", "Papunta na"].includes(b.st) ? `<button class="btn alt" id="cx">Kanselahin ang booking</button>` : ""}
 <button class="btn alt" id="bh">Bumalik</button><p class="err" id="te" role="alert"></p>`;
  $("tc").onclick = () => openChat(t);
  $("bh").onclick = () => { TRACK = null; home() };
  if ($("cx")) $("cx").onclick = async () => { const r = await setStatus(b.id, 'Kinansela'); if (r) $("te").textContent = r };
}
async function setStatus(id, st) {
  const { data, error } = await sb.from("bookings").update({ status: st }).eq("id", id).select().single();
  if (error) return "Hindi na-update: " + error.message;
  onBooking(upsertTx(data)); return "";
}

// ---------- Technician ----------
const myJobs = () => TX.filter(x => x.tech_id == USER.id);
function techDash() {
  VIEW = "dash"; const u = USER, J = myJobs();
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const done = J.filter(x => x.st == 'Natapos'), earn = done.filter(x => new Date(x.updated_at) >= today).reduce((n, x) => n + x.amt - fee(x.amt), 0);
  const act = J.filter(x => ACTIVE.includes(x.st)).sort((a, b) => a.ts - b.ts);
  const card = b => `<div class="jb"><b>${esc(b.svc)}</b><p class="mute" style="margin:4px 0">${esc(b.cust_name)}${b.cust_phone ? ' · <a href="tel:' + esc(b.cust_phone) + '">' + esc(b.cust_phone) + '</a>' : ''}<br>${esc(b.address)}<br>${esc(b.sched || '')} · ${fmt(b.amt)} · <span class="pill">${esc(b.st)}</span></p>
  ${b.st == 'Bago' ? `<button class="btn" data-s="Papunta na" data-b="${b.id}">Tanggapin at pumunta</button><button class="btn alt" data-s="Tinanggihan" data-b="${b.id}">Tanggihan</button>` : b.st == 'Papunta na' ? `<button class="btn" data-s="Dumating na" data-b="${b.id}">Dumating na ako</button>` : `<button class="btn" data-s="Natapos" data-b="${b.id}">Tapos na ang trabaho</button>`}
  <button class="btn alt" data-c="${b.id}">Mag-message sa customer</button></div>`;
  A.innerHTML = `<div class="panel au"><h2>Kumusta, ${esc(first(u.name))}!</h2><p class="mute" style="margin:0">${esc((u.services || []).join(", "))} · ${esc(u.addr || "—")}</p><div class='stats'><div><b>${fmt(earn)}</b><small>Kita ngayon (85%)</small></div><div><b>${done.length}</b><small>Natapos</small></div><div><b>${unreadN()}</b><small>Bagong mensahe</small></div></div><button class="btn ${u.online ? "" : "alt"}" id="ol">${u.online ? "Online ka (i-tap para mag-offline)" : "Offline ka (i-tap para mag-online)"}</button><p class="err" id="de" role="alert"></p><div aria-live="polite">${act.length ? act.map(card).join('') : `<p class="mute">${u.online ? "Naghihintay ng request… Lalabas dito ang bagong booking." : "Offline ka. I-on ang Online para makita ka ng mga customer."}</p>`}</div></div>`;
  $("ol").onclick = async () => {
    busy("ol", true);
    const upd = { online: !u.online };
    if (upd.online) { const p = await getLoc(); if (p) { upd.lat = p.lat; upd.lng = p.lng } else $("de").textContent = "Hindi makuha ang lokasyon mo. Payagan ang location para mas tama ang layo na makikita ng customer." }
    const { data, error } = await sb.from("profiles").update(upd).eq("id", u.id).select().single();
    if (error) { busy("ol", false); $("de").textContent = "Hindi na-update: " + error.message; return }
    USER = data; techDash();
  };
  A.querySelectorAll("[data-s]").forEach(b => b.onclick = async () => { b.disabled = true; const r = await setStatus(+b.dataset.b, b.dataset.s); if (r) { $("de").textContent = r; b.disabled = false } });
  A.querySelectorAll("[data-c]").forEach(b => b.onclick = () => { const j = TX.find(x => x.id == b.dataset.c); openChatWithCustomer(j) });
}
// While on the way to a customer, share the technician's live location.
function syncWatch() {
  const going = myJobs().some(x => x.st == 'Papunta na');
  if (going && watchId == null && navigator.geolocation) {
    watchId = navigator.geolocation.watchPosition(p => {
      if (Date.now() - lastLoc < 15000) return; lastLoc = Date.now();
      sb.from("profiles").update({ lat: p.coords.latitude, lng: p.coords.longitude }).eq("id", USER.id).then(() => { });
    }, () => { }, { enableHighAccuracy: true, maximumAge: 10000 });
  } else if (!going) stopWatch();
}
function stopWatch() { if (watchId != null) navigator.geolocation.clearWatch(watchId); watchId = null }

// ---------- Chat ----------
function mine() { return CONVS.filter(c => c.m.length).sort((a, b) => (b.m.at(-1)?.ts || 0) - (a.m.at(-1)?.ts || 0)) }
function inbox() {
  VIEW = "inbox"; const r = rk(), L = mine();
  A.innerHTML = `<div class='panel au'><h2>Mensahe</h2>${L.length ? L.map(c => { const n = r == 'c' ? c.tech_name : c.cust_name, l = c.m.at(-1), u = unreadOf(c); return `<button class='t' data-k='${esc(c.id)}'><div class='av'>${esc(ini(n))}</div><div><b>${esc(n)}</b><small>${esc(l.t.slice(0, 44))}</small></div><div class='km'>${tm(l.ts)}${u ? `<small><span class='badge'>${u}</span></small>` : ''}</div></button>` }).join('') : `<p class='mute'>Wala ka pang mensahe. ${r == 'c' ? 'Pumili ng technician sa Hanapin at i-tap ang Mag-message.' : 'Lalabas dito ang mga mensahe ng customer.'}</p>`}</div>`;
  A.querySelectorAll('[data-k]').forEach(b => b.onclick = () => { CUR = b.dataset.k; show() });
}
async function openChat(t) {
  let c = CONVS.find(x => x.tech_id == t.id && x.customer_id == USER.id);
  if (!c) {
    const { data, error } = await sb.from("conversations").upsert({ customer_id: USER.id, tech_id: t.id, cust_name: USER.name, tech_name: t.n }, { onConflict: "customer_id,tech_id" }).select().single();
    if (error) return alertNote("Hindi mabuksan ang chat: " + error.message);
    c = { ...data, m: [] }; CONVS.push(c);
  }
  CUR = c.id; TAB = 'chat'; show();
}
async function openChatWithCustomer(j) {
  if (!j) return;
  let c = CONVS.find(x => x.customer_id == j.customer_id && x.tech_id == USER.id);
  if (!c) {
    const { data, error } = await sb.from("conversations").insert({ customer_id: j.customer_id, tech_id: USER.id, cust_name: j.cust_name, tech_name: USER.name }).select().single();
    if (error) { await loadConvs(); c = CONVS.find(x => x.customer_id == j.customer_id && x.tech_id == USER.id); if (!c) return alertNote("Hindi mabuksan ang chat: " + error.message) }
    else { c = { ...data, m: [] }; CONVS.push(c) }
  }
  CUR = c.id; TAB = 'chat'; show();
}
function alertNote(m) { const p = VIEW == "pick" || VIEW == "track" || VIEW == "home" ? $("panel") : A.firstElementChild || A; p.insertAdjacentHTML("afterbegin", `<p class="err">${esc(m)}</p>`) }
function markRead(c) {
  const col = rk() == 'c' ? 'read_c' : 'read_t', now = new Date().toISOString();
  if (unreadOf(c) == 0 && c[col]) return;
  c[col] = now; sb.from("conversations").update({ [col]: now }).eq("id", c.id).then(() => { }); tabsBar();
}
function chatView(f) {
  const c = CONVS.find(x => x.id == CUR), r = rk();
  if (!c) { CUR = null; return inbox() }
  VIEW = "chat"; markRead(c);
  const keep = $('mi') ? $('mi').value : '';
  const n = r == 'c' ? c.tech_name : c.cust_name, qr = r == 't' ? ['Papunta na po ako.', 'Ilang unit po ang aircon?', 'Pwede po ba bukas ng umaga?'] : ['Magkano po ang cleaning?', 'Pwede po ba ngayon?', 'Salamat po!'];
  A.innerHTML = `<div class='panel au chat'><div class='ch-h'><button class='chip' id='cb'>‹ Bumalik</button><div class='av'>${esc(ini(n))}</div><b>${esc(n)}</b></div><div class='msgs' id='ms'>${c.m.map(m => `<div class='b ${m.f == r ? 'me' : 'them'}'>${esc(m.t)}<small>${tm(m.ts)}</small></div>`).join('') || '<p class="mute">Simulan ang usapan. Mag-hi!</p>'}</div><div class='chips' style='margin:8px 0'>${qr.map(q => `<button class='chip' data-q='${esc(q)}'>${esc(q)}</button>`).join('')}</div><div class='send'><input id='mi' placeholder='Mag-type ng mensahe' maxlength='500' autocomplete='off'><button class='btn' id='sn' style='width:auto;margin:0;padding:10px 16px'>Ipadala</button></div><p class="err" id="ce" role="alert"></p></div>`;
  const ms = $('ms'); ms.scrollTop = ms.scrollHeight;
  $('mi').value = keep;
  const go = async t => {
    t = t.trim(); if (!t) return;
    $('sn').disabled = true;
    const { data, error } = await sb.from("messages").insert({ conv_id: c.id, sender: r, body: t }).select().single();
    if (error) { $('sn').disabled = false; $('ce').textContent = "Hindi naipadala: " + error.message; return }
    if (!c.m.some(x => x.id == data.id)) c.m.push({ id: data.id, f: r, t: data.body, ts: new Date(data.created_at).getTime() });
    $('mi').value = ''; chatView(1);
  };
  $('cb').onclick = () => { CUR = null; show() };
  $('sn').onclick = () => go($('mi').value); $('mi').onkeydown = e => { if (e.key == 'Enter') go($('mi').value) };
  A.querySelectorAll('[data-q]').forEach(b => b.onclick = () => go(b.dataset.q));
  if (f) $('mi').focus();
}

// ---------- Account ----------
function profile() {
  VIEW = "me"; const u = USER, c = u.role == 'customer', row = (a, b) => `<div class='row'><span class='mute'>${a}</span><span>${esc(b)}</span></div>`;
  const B = c ? myBookings() : myJobs();
  A.innerHTML = `<div class='panel au'><div class='who'><div class='av big'>${esc(ini(u.name))}</div><div><h2 style='margin:0'>${esc(u.name)}</h2><span class='mute'>${c ? 'Customer' : 'Technician'}${u.google ? ' · Google' : ''}</span></div></div>${row('Email', u.email || '')}${u.phone ? row('Cellphone', u.phone) : ''}${u.addr ? row(c ? 'Address' : 'Lugar na sakop', u.addr) : ''}${c ? '' : row('Serbisyo', (u.services || []).join(', '))}
 <h2 style='margin-top:16px'>${c ? 'Mga booking' : 'Mga trabaho'}</h2>${B.length ? B.slice(0, 10).map(b => `<div class='row'><span>${esc(b.svc)}<br><small class='mute'>${esc(c ? b.tech_name : b.cust_name)} · ${esc(b.code || '')}</small></span><span style="text-align:right"><span class='pill ${b.st == 'Natapos' ? 'ok' : ['Kinansela', 'Tinanggihan'].includes(b.st) ? 'no' : ''}'>${esc(b.st)}</span><br><small class='mute'>${dstr(b.ts)}</small>${c && ACTIVE.includes(b.st) ? `<br><button class="chip" data-tr="${b.id}">I-track</button>` : ''}</span></div>`).join('') : '<p class="mute">Wala pa.</p>'}<button class='btn alt' id='pl'>Mag-log out</button></div>`;
  $('pl').onclick = () => $('lo').click();
  A.querySelectorAll('[data-tr]').forEach(b => b.onclick = () => { TRACK = TX.find(x => x.id == b.dataset.tr); TAB = 'find'; show() });
}

// ---------- Rate guide ----------
function rateGuide() {
  rateMarket();
  const tb = (h, r) => `<div class='tw'><table style='min-width:420px'><thead><tr>${h.map(x => `<th>${x}</th>`).join('')}</tr></thead><tbody>${r.map(a => `<tr>${a.map(x => `<td>${x}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  A.insertAdjacentHTML('afterbegin', `<div class='panel au wide'><h2>Rate guide ng CoolFix</h2><p class='mute' style='margin:0'>Suggested starting rates para sa CoolFix catalog. Hindi ito verified na pambansang standard na presyo.</p>${CAT.map(c => `<h3 style='margin:18px 0 0'>${esc(c.t)}</h3><p class='mute' style='margin:0;font-size:13px'>${esc(c.n)}</p>${tb(['Serbisyo', 'Presyo'], c.g.flatMap(g => g[1].map(x => [esc(x[0]), fmt(x[1])])))}`).join('')}<h3 style='margin:18px 0 0'>Iba pang singil</h3>${tb(['Serbisyo', 'Presyo'], OC.map(o => [esc(o.n), ocs(o)]))}<p class='mute' style='font-size:13px'>Ito ay suggested app pricing rules, hindi fixed industry rates.</p></div>`);
}
function rateMarket() {
  const P = n => n == null ? '—' : fmt(n), tb = (h, r) => `<div class='tw'><table style='min-width:560px'><thead><tr>${h.map(x => `<th>${x}</th>`).join('')}</tr></thead><tbody>${r.map(a => `<tr>${a.map(x => `<td>${typeof x == 'number' || x == null ? P(x) : x}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  const AC = [['Window (hanggang 1.5 HP)', 990, 450, 1200, 1500, 890, 2100], ['U-shaped (hanggang 1.5 HP)', 1775, 450, 1200, 1800, 990, 2500], ['Split / Wall mount', 1775, 450, 1200, 9500, 2100, 12200], ['Tower / Floor mount', 2550, 450, 1200, 10500, 3200, 14500], ['Cassette / Ceiling mount', 3675, 450, 1200, null, 5400, null], ['Suspended', 3675, 450, 1200, null, 5400, null], ['Concealed', 3675, 450, 1200, null, 5400, null]];
  const RF = [['Refrigerator (lahat ng uri)', 450, 1200], ['Chest freezer', 450, 1200], ['Light commercial chiller', 450, 1200]];
  const AD = [['Window: dagdag kada +0.5 HP lampas 1.5 HP', 350], ['Window: bagong bracket', 1300], ['Hagdan (ladder) para sa mataas na unit', 450], ['Minor repair, walang pinalitan na parte (labor)', 1100], ['Major repair, may/walang parte (labor)', 2500], ['System repair at reprocess hanggang 2.5 HP (labor)', 2500], ['System repair at reprocess hanggang 2.5 HP (materyales)', 2500], ['Compressor replacement hanggang 2.5 HP (labor lang)', 3000]];
  A.innerHTML = `<div class='panel au wide'><h2>Market reference (Teko, Metro Manila)</h2><p class='mute' style='margin:0'>Gabay na presyo sa Metro Manila para ihambing. Labor/serbisyo lang ito. Hindi kasama ang parte, freon, materyales at parking.</p>
 <h3 style='margin:18px 0 0'>Aircon: ayon sa uri ng unit</h3>${tb(['Uri ng aircon', 'Cleaning', 'Check-up', 'Repair (minimum)', 'Install', 'Dismantle', 'Relocate'], AC)}
 <p class='mute' style='font-size:13px'>Pareho ang presyo ng inverter at non-inverter sa mga rate na ito. Walang hiwalay na presyo kada brand (Carrier, Daikin, LG, Samsung, atbp.). Ang HP at uri ng unit ang batayan.</p>
 <h3 style='margin:18px 0 0'>Refrigeration</h3>${tb(['Uri ng unit', 'Check-up', 'Repair (minimum)'], RF)}
 <p class='mute' style='font-size:13px'>Ang check-up ay may kasamang diagnosis at repair quotation. Ang aktwal na repair ay depende sa sira, kaya mag-quote muna ang technician bago gumawa.</p>
 <h3 style='margin:18px 0 0'>Dagdag na gawain at singil ng technician</h3>${tb(['Gawain', 'Presyo'], AD)}
 <p class='mute' style='font-size:13px'>Mas mababa nang kaunti ang ilang labor rate na ito kumpara sa talahanayan sa itaas, dahil iba ang pinagkunan.</p>
 <h3 style='margin:18px 0 0'>Tips bago pumayag sa presyo</h3>
 <ul class='mute' style='margin:6px 0 0;padding-left:20px'><li>Humingi ng nakasulat o chat na quotation bago simulan ang repair.</li><li>Itanong kung kasama ba ang parte, freon at materyales.</li><li>Ang low freon ay kadalasang palatandaan ng leak. Dapat hanapin at ayusin ang leak, hindi basta i-refill.</li><li>Linisin ang aircon tuwing 3 hanggang 4 na buwan para tumagal at mas makatipid sa kuryente.</li></ul>
 <p class='mute' style='font-size:12px;margin-top:14px'>Pinagkunan: Teko Out-of-Warranty Service Rates at Teko Pro Field Service Rates (NCR, 2026), at Home Credit PH para sa tantiya ng ref repair. Magkakaiba ang presyo sa bawat lugar at technician, kaya gabay lang ito.</p></div>`;
}

// ---------- Admin ----------
function adminView() { VIEW = "admin"; TAB == 'ov' ? admOv() : TAB == 'tx' ? admTx() : TAB == 'sv' ? admSv() : TAB == 'pr' ? admPr() : admTc() }
let AP = 7;
function admOv() {
  const DAY = 864e5, t0 = new Date(); t0.setHours(0, 0, 0, 0);
  const st = t0.getTime() - (AP - 1) * DAY, pst = st - AP * DAY;
  const cur = TX.filter(x => x.ts >= st), prev = TX.filter(x => x.ts >= pst && x.ts < st);
  const done = a => a.filter(x => x.st == 'Natapos'), sum = a => a.reduce((n, x) => n + x.amt, 0);
  const g = sum(done(cur)), gp = sum(done(prev)), nd = done(cur).length, ndp = done(prev).length;
  const act = TX.filter(x => ACTIVE.includes(x.st));
  const techs = PROFILES.filter(u => u.role == 'technician'), custs = PROFILES.filter(u => u.role == 'customer');
  const dl = (a, b) => b ? (a >= b ? '▲ ' : '▼ ') + Math.abs(Math.round((a - b) / b * 100)) + '% kumpara sa dati' : (a ? 'Bago ngayong period' : 'Wala pa');
  const days = [...Array(AP)].map((_, i) => { const a = st + i * DAY, L = done(TX.filter(x => x.ts >= a && x.ts < a + DAY)); return { d: new Date(a), v: sum(L), n: L.length } });
  const raw = Math.max(...days.map(x => x.v)), step = raw <= 0 ? 1000 : Math.pow(10, Math.floor(Math.log10(raw))) * (raw / Math.pow(10, Math.floor(Math.log10(raw))) > 5 ? 2 : raw / Math.pow(10, Math.floor(Math.log10(raw))) > 2 ? 1 : .5), mx = Math.max(step, Math.ceil(raw * 1.08 / step) * step);
  const ticks = [mx, mx / 2, 0], peak = days.reduce((m, x, i) => x.v > days[m].v ? i : m, 0);
  const lbl = (d, i) => AP <= 7 ? d.toLocaleDateString('en-PH', { weekday: 'short' }) : (i % 5 == 0 || i == AP - 1) ? d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' }) : '';
  const SS = ['Bago', 'Papunta na', 'Dumating na', 'Natapos', 'Kinansela', 'Tinanggihan'], sc = SS.map(s => [s, cur.filter(x => x.st == s).length]), smx = Math.max(1, ...sc.map(x => x[1]));
  const tm = {}; done(cur).forEach(x => { const o = tm[x.tech_id] = tm[x.tech_id] || { n: x.tech_name, g: 0, j: 0 }; o.g += x.amt; o.j++ });
  const top = Object.values(tm).sort((a, b) => b.g - a.g).slice(0, 5), recent = [...TX].sort((a, b) => b.ts - a.ts).slice(0, 6);
  const pill = s => `<span class='pill ${s == 'Natapos' ? 'ok' : ['Kinansela', 'Tinanggihan'].includes(s) ? 'no' : ''}'>${esc(s)}</span>`;
  const kpi = (l, v, sub) => `<div class='kpi'><small>${l}</small><b>${v}</b><span>${sub}</span></div>`;
  A.innerHTML = `<div class='dash'>
  <div class='dh'><div><h2>Overview</h2><p class='mute'>${t0.toLocaleDateString('en-PH', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</p></div>
   <div class='chips' role='group' aria-label='Period'>${[[1, 'Ngayon'], [7, '7 araw'], [30, '30 araw']].map(([n, l]) => `<button class='chip' aria-pressed='${AP == n}' data-ap='${n}'>${l}</button>`).join('')}</div></div>
  <div class='kpis'>${kpi('Kabuuang bayad', fmt(g), dl(g, gp))}${kpi('Kita ng CoolFix (15%)', fmt(fee(g)), dl(fee(g), fee(gp)))}${kpi('Natapos na booking', nd + `<small> / ${cur.length}</small>`, dl(nd, ndp))}${kpi('Aktibong booking', act.length, act.filter(x => x.st == 'Bago').length + ' naghihintay ng technician')}</div>
  <div class='grid2'>
   <section class='card'><div class='ch'><h3>Kita kada araw</h3><span class='mute'>Natapos na booking lang</span></div>
    ${AP == 1 ? `<div class='hero'><b>${fmt(g)}</b><span class='mute'>${nd} natapos na booking ngayong araw</span></div>` : `<div class='chart' id='ch'><div class='yax'>${ticks.map(t => `<span>${t >= 1000 ? '₱' + (t / 1000) + 'k' : fmt(t)}</span>`).join('')}</div>
    <div class='plot'>${ticks.map((t, i) => `<i class='gl' style='top:${i * 50}%'></i>`).join('')}<div class='cols'>${days.map((x, i) => `<div class='col' tabindex='0' data-i='${i}'>${i == peak && x.v > 0 ? `<em style='bottom:calc(${x.v / mx * 100}% + 4px)'>${fmt(x.v)}</em>` : ''}<i style='height:${x.v / mx * 100}%'></i></div>`).join('')}</div></div>
    <div class='xax'>${days.map((x, i) => `<span>${lbl(x.d, i)}</span>`).join('')}</div><div class='tip' id='tip' hidden></div></div>`}
   </section>
   <section class='card'><div class='ch'><h3>Status ng booking</h3><span class='mute'>${cur.length} booking</span></div>
    ${sc.map(([s, n]) => `<div class='hb'><span>${s}</span><div><i style='width:${n / smx * 100}%'></i></div><b>${n}</b></div>`).join('')}
    <div class='mini'><div><b>${techs.filter(u => u.online).length}<small> / ${techs.length}</small></b><span>Technician na online</span></div><div><b>${custs.length}</b><span>Customer</span></div></div>
   </section>
  </div>
  <div class='grid2'>
   <section class='card'><div class='ch'><h3>Pinakabagong booking</h3><button class='chip' id='allTx'>Tingnan lahat</button></div>
    ${recent.length ? recent.map(x => `<div class='li'><div class='av'>${esc(ini(x.cust))}</div><div><b>${esc(x.cust)}</b><small>${esc(x.svc)} · ${esc(first(x.tech))}</small></div><div class='km'>${fmt(x.amt)}<small>${pill(x.st)}</small></div></div>`).join('') : `<p class='mute'>Wala pang booking.</p>`}
   </section>
   <section class='card'><div class='ch'><h3>Top technician</h3><span class='mute'>ayon sa kita</span></div>
    ${top.length ? top.map((o, i) => `<div class='li'><div class='rk'>${i + 1}</div><div><b>${esc(o.n)}</b><small>${o.j} natapos</small></div><div class='km'>${fmt(o.g)}<small>${fmt(o.g - fee(o.g))} sa technician</small></div></div>`).join('') : `<p class='mute'>Wala pang natapos na booking sa period na ito.</p>`}
   </section>
  </div></div>`;
  A.querySelectorAll('[data-ap]').forEach(b => b.onclick = () => { AP = +b.dataset.ap; admOv() });
  $('allTx').onclick = () => { TAB = 'tx'; show() };
  const tip = $('tip');
  if (tip) A.querySelectorAll('.col').forEach(c => {
    const on = () => { const x = days[c.dataset.i]; tip.innerHTML = `<b>${x.d.toLocaleDateString('en-PH', { weekday: 'short', month: 'short', day: 'numeric' })}</b><br>${fmt(x.v)} · ${x.n} booking`; tip.hidden = false; const r = c.getBoundingClientRect(), p = $('ch').getBoundingClientRect(); tip.style.left = Math.min(p.width - 140, Math.max(0, r.left - p.left + r.width / 2 - 70)) + 'px'; c.classList.add('on') };
    const off = () => { tip.hidden = true; c.classList.remove('on') };
    c.onmouseenter = on; c.onfocus = on; c.onmouseleave = off; c.onblur = off;
  });
}
function admTx() {
  const S = ['Lahat', 'Bago', 'Papunta na', 'Dumating na', 'Natapos', 'Kinansela', 'Tinanggihan'], q = AF.q.toLowerCase();
  const L = TX.filter(x => (AF.st == 'Lahat' || x.st == AF.st) && (x.tech + x.cust + x.svc + x.code).toLowerCase().includes(q)).sort((a, b) => b.ts - a.ts);
  A.innerHTML = `<div class='panel au wide'><h2>Mga transaction</h2><div class='chips'>${S.map(s => `<button class='chip' aria-pressed='${AF.st == s}' data-s='${s}'>${s}</button>`).join('')}</div><input id='aq' placeholder='Hanapin: technician, customer, serbisyo' value='${esc(AF.q)}'><div class='tw'><table><thead><tr><th>ID</th><th>Petsa</th><th>Customer</th><th>Technician</th><th>Serbisyo</th><th>Bayad</th><th>Fee (15%)</th><th>Status</th></tr></thead><tbody>${L.map(x => `<tr><td>${esc(x.code)}</td><td>${dstr(x.ts)}</td><td>${esc(x.cust)}</td><td>${esc(x.tech)}</td><td>${esc(x.svc)}</td><td>${fmt(x.amt)}</td><td>${x.st == 'Natapos' ? fmt(fee(x.amt)) : '—'}</td><td><span class='pill ${x.st == 'Natapos' ? 'ok' : ['Kinansela', 'Tinanggihan'].includes(x.st) ? 'no' : ''}'>${esc(x.st)}</span></td></tr>`).join('') || `<tr><td colspan='8' class='mute'>Walang transaction na tugma.</td></tr>`}</tbody></table></div><p class='mute'>${L.length} transaction · Kabuuang natapos: ${fmt(L.filter(x => x.st == 'Natapos').reduce((n, x) => n + x.amt, 0))}</p></div>`;
  A.querySelectorAll('[data-s]').forEach(b => b.onclick = () => { AF.st = b.dataset.s; admTx() });
  $('aq').oninput = e => { AF.q = e.target.value; admTx(); const i = $('aq'); i.focus(); i.setSelectionRange(i.value.length, i.value.length) };
}
function admPr() {
  A.innerHTML = `<div class='panel au'><h2>Presyo ng mga serbisyo</h2><p class='mute' style='margin:0 0 8px'>Base price ng bawat uri ng serbisyo.</p>${SERVICES.slice(1).map(s => `<label class='prow'><span>${s}</span><span>₱ <input type='number' min='0' step='50' inputmode='numeric' data-p='${s}' value='${PRICES[s]}' aria-label='Presyo ng ${s}'></span></label>`).join('')}<p class='mute' id='pe' role='status'></p><button class='btn' id='ps'>I-save ang presyo</button><button class='btn alt' id='pd'>Ibalik sa dating presyo</button></div>`;
  $('ps').onclick = async () => { const n = {}; let bad = 0; A.querySelectorAll('[data-p]').forEach(i => { const v = Math.round(Number(i.value)); if (i.value === '' || !(v >= 0)) bad = 1; n[i.dataset.p] = v }); const e = $('pe'); if (bad) { e.className = 'err'; e.textContent = 'Maglagay ng tamang presyo sa bawat serbisyo.'; return } const er = await saveSetting('prices', n); if (er) { e.className = 'err'; e.textContent = 'Hindi na-save: ' + er.message; return } PRICES = n; e.className = 'mute'; e.textContent = 'Na-save na ang mga presyo.' };
  $('pd').onclick = async () => { PRICES = { ...DEF }; await saveSetting('prices', PRICES); admPr() };
}
function admTc() {
  const m = {};
  PROFILES.filter(u => u.role == 'technician').forEach(u => { m[u.id] = { n: u.name, j: 0, g: 0, c: 0, u } });
  TX.forEach(x => { const o = m[x.tech_id] = m[x.tech_id] || { n: x.tech, j: 0, g: 0, c: 0 }; if (x.st == 'Natapos') { o.j++; o.g += x.amt } if (['Kinansela', 'Tinanggihan'].includes(x.st)) o.c++ });
  const L = Object.values(m).sort((a, b) => b.g - a.g);
  A.innerHTML = `<div class='panel au wide'><h2>Mga technician</h2><div class='tw'><table><thead><tr><th>Pangalan</th><th>Cellphone</th><th>Natapos</th><th>Kinansela</th><th>Kabuuang bayad</th><th>Kita ng technician (85%)</th><th>Fee ng CoolFix</th><th>Status</th></tr></thead><tbody>${L.map(o => `<tr><td>${esc(o.n)}</td><td>${esc(o.u?.phone || '')}</td><td>${o.j}</td><td>${o.c}</td><td>${fmt(o.g)}</td><td>${fmt(o.g - fee(o.g))}</td><td>${fmt(fee(o.g))}</td><td><span class='pill ${o.u && o.u.online ? 'ok' : ''}'>${o.u ? (o.u.online ? 'Online' : 'Offline') : '—'}</span></td></tr>`).join('') || `<tr><td colspan='8' class='mute'>Wala pang technician.</td></tr>`}</tbody></table></div></div>`;
}
function admSv() {
  if (!ED) ED = { c: cl(CAT), o: cl(OC) };
  EC = Math.max(0, Math.min(EC, ED.c.length - 1)); const c = ED.c[EC], E = x => esc(String(x ?? ''));
  const num = (d, v) => `<input type="number" min="0" inputmode="numeric" data-${d} value="${v == null ? '' : v}">`;
  A.innerHTML = `<div class='panel au wide'><h2>Mga serbisyo at presyo</h2><p class='mute' style='margin:0'>I-edit ang presyo at serbisyo, o magdagdag ng bago. Pindutin ang I-save sa ibaba para lumabas ito sa customer.</p>
 <div class='chips' style='margin-top:12px'>${ED.c.map((x, i) => `<button class='chip' aria-pressed='${i == EC}' data-ec='${i}'>${E(x.t || 'Walang pangalan')}</button>`).join('')}<button class='chip' id='acat'>+ Bagong kategorya</button></div>
 <label>Pangalan ng kategorya<input data-f='t' value='${E(c.t)}'></label>
 <label>Maikling paglalarawan<input data-f='d' value='${E(c.d)}'></label>
 <label>Paalala sa customer<input data-f='n' value='${E(c.n)}'></label>
 <label>Technician na pwedeng kumuha<select data-f='m'>${SERVICES.slice(1).map(s => `<option ${(c.m || c.k) == s ? 'selected' : ''}>${s}</option>`).join('')}</select></label>
 ${c.g.map((g, gi) => `<div class='ged'><div class='grow'><input data-gn='${gi}' value='${E(g[0])}' aria-label='Pangalan ng group'><button class='chip' data-dg='${gi}'>Alisin ang group</button></div><div class='irow mute' style='margin:8px 0 0;font-size:12px'><span style='flex:3 1 160px'>Serbisyo</span><span style='flex:1 1 90px'>Presyo (₱)</span><span style='width:44px'></span></div>${g[1].map((x, xi) => `<div class='irow'><input data-i='${gi}:${xi}:0' value='${E(x[0])}' aria-label='Serbisyo'>${num(`i='${gi}:${xi}:1'`, x[1])}<button class='chip' data-dx='${gi}:${xi}' aria-label='Alisin ang serbisyo'>✕</button></div>`).join('')}<button class='chip' data-ax='${gi}'>+ Dagdag na serbisyo</button></div>`).join('')}
 <button class='btn alt' id='ag'>+ Dagdag na group</button><button class='btn alt' id='dcat'>Alisin ang kategoryang ito</button>
 <h3 style='margin:22px 0 0'>Iba pang singil</h3><p class='mute' style='margin:0;font-size:13px'>Ang may tsek sa Awtomatiko ay laging kasama sa tinatayang bayad. Ang iba ay pipiliin ng customer.</p>
 ${ED.o.map((o, i) => `<div class='irow'><input data-o='${i}:n' value='${E(o.n)}' aria-label='Pangalan ng singil'><select data-o='${i}:k' aria-label='Uri'><option value='fixed' ${o.k == 'fixed' ? 'selected' : ''}>Fixed (₱)</option><option value='pct' ${o.k == 'pct' ? 'selected' : ''}>Porsyento (%)</option><option value='custom' ${o.k == 'custom' ? 'selected' : ''}>Custom quotation</option></select>${num(`o='${i}:p'`, o.p)}<label class='ck' style='border:0;padding:0'><input type='checkbox' data-o='${i}:a' ${o.a ? 'checked' : ''}> Awtomatiko</label><button class='chip' data-do='${i}' aria-label='Alisin ang singil'>✕</button></div>`).join('')}
 <button class='chip' id='ao'>+ Dagdag na singil</button><p class='mute' style='font-size:12px;margin:6px 0 0'>Para sa Porsyento, ilagay ang % (hal. 30). Para sa Custom quotation, hindi na kailangan ang number.</p>
 <p class='err' id='se' role='alert'></p><button class='btn' id='ss'>I-save</button><button class='btn alt' id='sr'>Ibalik sa default</button></div>`;
  const q = s => A.querySelectorAll(s), re = () => admSv();
  q('[data-f]').forEach(i => i.oninput = i.onchange = () => { c[i.dataset.f] = i.value; if (i.dataset.f == 't') q('[data-ec]')[EC].textContent = i.value || 'Walang pangalan' });
  q('[data-gn]').forEach(i => i.oninput = () => { c.g[i.dataset.gn][0] = i.value });
  q('[data-i]').forEach(i => i.oninput = () => { const [a, b, f] = i.dataset.i.split(':').map(Number); c.g[a][1][b][f] = f ? (i.value === '' ? '' : Number(i.value)) : i.value });
  q('[data-o]').forEach(i => { const h = () => { const [n, f] = i.dataset.o.split(':'), o = ED.o[n]; o[f] = f == 'a' ? i.checked : f == 'p' ? (i.value === '' ? '' : Number(i.value)) : i.value }; i.oninput = h; i.onchange = h });
  q('[data-ec]').forEach(b => b.onclick = () => { EC = +b.dataset.ec; re() });
  $('acat').onclick = () => { ED.c.push({ k: 'c' + Date.now(), t: 'Bagong kategorya', d: '', n: '', m: 'Aircon repair', g: [['Bagong group', [['Bagong serbisyo', 500]]]] }); EC = ED.c.length - 1; re() };
  q('[data-dg]').forEach(b => b.onclick = () => { c.g.splice(+b.dataset.dg, 1); re() });
  q('[data-dx]').forEach(b => b.onclick = () => { const [a, x] = b.dataset.dx.split(':').map(Number); c.g[a][1].splice(x, 1); re() });
  q('[data-ax]').forEach(b => b.onclick = () => { c.g[+b.dataset.ax][1].push(['Bagong serbisyo', 500]); re() });
  $('ag').onclick = () => { c.g.push(['Bagong group', [['Bagong serbisyo', 500]]]); re() };
  $('dcat').onclick = () => { if (ED.c.length < 2) { const e = $('se'); e.className = 'err'; e.textContent = 'Kailangan ng kahit isang kategorya.'; return } ED.c.splice(EC, 1); EC = 0; re() };
  q('[data-do]').forEach(b => b.onclick = () => { ED.o.splice(+b.dataset.do, 1); re() });
  $('ao').onclick = () => { ED.o.push({ n: 'Bagong singil', k: 'fixed', p: 150, a: false }); re() };
  $('sr').onclick = async () => { CAT = cl(DEFCAT); OC = cl(DEFOC); await saveSetting('catalog', CAT); await saveSetting('other_charges', OC); cat = null; item = null; ED = null; admSv(); const e = $('se'); e.className = 'mute'; e.textContent = 'Naibalik sa default ang mga serbisyo at singil.' };
  $('ss').onclick = async () => {
    const e = $('se'); e.className = 'err'; let m = ''; const bad = v => v === '' || !(v >= 0);
    ED.c.forEach(k => { if (!k.t.trim()) m = m || 'Lagyan ng pangalan ang bawat kategorya.'; if (!k.g.length) m = m || `Walang group ang ${k.t || 'kategorya'}.`; k.g.forEach(g => { if (!g[0].trim()) m = m || `Lagyan ng pangalan ang group sa ${k.t}.`; if (!g[1].length) m = m || `Walang serbisyo ang group na ${g[0]}.`; g[1].forEach(x => { if (!String(x[0]).trim()) m = m || `May serbisyong walang pangalan sa ${k.t}.`; if (bad(x[1])) m = m || `Maglagay ng tamang presyo sa ${x[0]}.` }) }) });
    ED.o.forEach(o => { if (!o.n.trim()) m = m || 'Lagyan ng pangalan ang bawat singil.'; if (o.k == 'fixed') { if (bad(o.p)) m = m || `Ayusin ang presyo ng ${o.n}.` } else if (o.k == 'pct' && (bad(o.p) || o.p > 100)) m = m || `Maglagay ng % (0 hanggang 100) sa ${o.n}.` });
    if (m) { e.textContent = m; return }
    const e1 = await saveSetting('catalog', ED.c), e2 = await saveSetting('other_charges', ED.o);
    if (e1 || e2) { e.textContent = 'Hindi na-save: ' + (e1 || e2).message; return }
    CAT = cl(ED.c); OC = cl(ED.o); cat = null; item = null; ED = null; admSv(); const e3 = $('se'); e3.className = 'mute'; e3.textContent = 'Na-save! Makikita na ito ng mga customer.';
  };
}

// ---------- Google Maps (optional) ----------
const GM = !!CFG.mapsKey;
let GL = false, gmap, gme, gmk = [], gRt = [], GT = 0;
const dot = (s, c) => ({ path: google.maps.SymbolPath.CIRCLE, scale: s, fillColor: c, fillOpacity: 1, strokeColor: '#fff', strokeWeight: 2 });
window.gm_authFailure = () => { GL = false; $('gm').hidden = true; $('svg').style.display = ''; pins() };
function loadGM() { return new Promise(r => { if (!GM) return r(false); if (window.google?.maps) return r(true); window.__gm = () => r(true); const s = document.createElement('script'); s.src = 'https://maps.googleapis.com/maps/api/js?key=' + encodeURIComponent(CFG.mapsKey) + '&callback=__gm&loading=async'; s.onerror = () => r(false); document.head.appendChild(s) }) }
async function initGM() {
  if (GL || !GM || !await loadGM()) return;
  GL = true; $('svg').style.display = 'none'; const el = $('gm'); el.hidden = false;
  gmap = new google.maps.Map(el, { center: C, zoom: 14, disableDefaultUI: true, zoomControl: true, clickableIcons: false, gestureHandling: 'greedy' });
  gme = new google.maps.Marker({ position: C, map: gmap, title: 'Ikaw', icon: dot(9, '#2F7FE0') });
  gpins();
}
function gpins() {
  if (!GL) return;
  gmk.forEach(m => m.setMap(null)); gmk = [];
  const b = new google.maps.LatLngBounds(C);
  list().forEach(t => { const p = tpos(t); b.extend(p); const m = new google.maps.Marker({ position: p, map: gmap, title: t.n, label: { text: ini(t.n)[0], color: '#fff', fontWeight: '700' }, icon: dot(sel === t ? 16 : 12, '#14378F') }); m.addListener('click', () => pick(t)); gmk.push(m) });
  if (sel) gmap.panTo(tpos(sel)); else gmap.fitBounds(b, 40);
}
function gClear() { GT++; gRt.forEach(x => x.setMap(null)); gRt = [] }
async function gRoute(a, b) { try { const { Route } = await google.maps.importLibrary('routes'); const r = await Route.computeRoutes({ origin: a, destination: b, travelMode: 'DRIVING', fields: ['path', 'durationMillis'] }), q = r.routes[0], g = p => ({ lat: typeof p.lat == 'function' ? p.lat() : p.lat, lng: typeof p.lng == 'function' ? p.lng() : p.lng }); return { path: q.path.map(g), min: Math.max(1, Math.round(q.durationMillis / 6e4)) } } catch (e) { return null } }
async function gtrack(t, b) {
  gClear(); const tk = GT; gmk.forEach(m => m.setMap(null));
  const o = tpos(t), d = C;
  const mv = new google.maps.Marker({ position: o, map: gmap, label: { text: ini(t.n)[0], color: '#fff', fontWeight: '700' }, icon: dot(15, '#14378F') }); gRt.push(mv);
  if (!ACTIVE.includes(b.st)) return;
  const r = await gRoute(o, d); if (tk != GT) return;
  const path = r ? r.path : [o, d];
  gRt.push(new google.maps.Polyline({ path, strokeColor: '#2F7FE0', strokeWeight: 5, strokeOpacity: .85, map: gmap }));
  const bb = new google.maps.LatLngBounds(); path.forEach(p => bb.extend(p)); gmap.fitBounds(bb, 50);
}

// ---------- Boot ----------
let RECOVERY = /type=recovery/.test(location.hash);
sb.auth.onAuthStateChange((ev, session) => {
  if (ev == "PASSWORD_RECOVERY") { RECOVERY = true; return newPasswordView() }
  if (ev == "SIGNED_IN" && session && !USER && !RECOVERY) setTimeout(() => start(session), 0);
});
(async () => {
  if (RECOVERY) return;
  const { data } = await sb.auth.getSession();
  if (data.session) start(data.session); else authView();
})();
