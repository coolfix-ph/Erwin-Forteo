/* CoolFix app: konektado sa Supabase (auth, database, realtime). */
"use strict";

const CFG = window.COOLFIX_CONFIG || {};
const $ = id => document.getElementById(id);
const A = $("auth");
const LOGO = "img/logo.png";
$("hl").src = LOGO;

const CONFIGURED = CFG.supabaseUrl && CFG.supabaseAnonKey && !/YOUR-/.test(CFG.supabaseUrl + CFG.supabaseAnonKey);
const sb = CONFIGURED ? supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey) : null;
const NATIVE = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());

/* ---------- maliliit na helper ---------- */
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = n => "₱" + Number(n || 0).toLocaleString("en-PH");
const fee = a => Math.round(a * 0.15);
const ini = n => String(n || "?").trim().split(/\s+/).map(w => w[0]).slice(0, 2).join("").toUpperCase();
const first = n => String(n || "").split(" ")[0];
const tm = t => new Date(t).toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" });
const dstr = t => new Date(t).toLocaleDateString("en-PH", { month: "short", day: "numeric" });
const cl = x => JSON.parse(JSON.stringify(x));
const code = b => "CF-" + (1000 + Number(b.id));
const errMsg = e => {
  const m = (e && (e.message || e.error_description)) || String(e);
  if (/Invalid login credentials/i.test(m)) return "Mali ang email o password.";
  if (/Email not confirmed/i.test(m)) return "Hindi pa na-confirm ang email mo. I-check ang inbox mo.";
  if (/already registered|already exists/i.test(m)) return "May account na gamit ang email na ito. Subukang mag-log in.";
  if (/Failed to fetch|NetworkError/i.test(m)) return "Walang koneksyon sa server. I-check ang internet mo.";
  if (/rate limit/i.test(m)) return "Masyadong maraming subok. Maghintay muna ng ilang minuto.";
  return m;
};

/* ---------- catalog ng serbisyo (default; pinapalitan ng admin sa Supabase) ---------- */
const SERVICES = ["Aircon cleaning", "Aircon repair", "Aircon install", "Ref cleaning", "Ref repair", "Freon refill"];
const DEFCAT = [
  { k: "Aircon cleaning", t: "Aircon Cleaning", d: "General cleaning / preventive maintenance", n: "Presyo ayon sa uri at laki (HP) ng aircon.", g: [["Window Type", [["Window 0.5 HP", 600], ["Window 1.0 HP", 700], ["Window 1.5 HP", 800], ["Window 2.0 HP", 900]]], ["Split Type", [["Split 1.0 HP", 950], ["Split 1.5 HP", 1100], ["Split 2.0 HP", 1350], ["Split 2.5 HP", 1600]]], ["Floor Standing at Cassette", [["Floor Standing", 2000], ["Ceiling Cassette", 2750]]]] },
  { k: "Aircon repair", t: "Aircon Repair", d: "Check-up, parte, freon at compressor", n: "Labor lang ang presyo. Hiwalay ang singil sa parte.", g: [["Check-up", [["Initial Check-up / Diagnosis", 550]]], ["Electrical at parte", [["Capacitor Replacement", 650], ["Fan Motor Replacement", 950], ["Thermostat Replacement", 700], ["PCB Troubleshooting", 1150], ["PCB Replacement", 1150], ["Electrical Wiring Repair", 1000]]], ["Drainage at refrigerant", [["Drainage Repair", 750], ["Refrigerant Leak Detection", 1150], ["Refrigerant Recharging", 1500], ["Compressor Replacement", 3250]]]] },
  { k: "Ref cleaning", t: "Refrigerator Cleaning", d: "General cleaning at maintenance", n: "Presyo ayon sa uri ng ref o freezer.", g: [["Refrigerator", [["Single Door", 600], ["Two Door", 750], ["No Frost Refrigerator", 1000], ["Side-by-Side Refrigerator", 1250], ["French Door Refrigerator", 1500]]], ["Commercial at Freezer", [["Commercial Refrigerator", 2250], ["Chest Freezer", 950], ["Upright Freezer", 1150]]]] },
  { k: "Ref repair", t: "Refrigerator Repair", d: "Thermostat, fan motor, gasket, freon, compressor", n: "Labor lang ang presyo. Hiwalay ang singil sa parte.", g: [["Check-up", [["Check-up / Diagnosis", 550]]], ["Electrical at parte", [["Thermostat Repair", 750], ["Defrost Timer Replacement", 700], ["Fan Motor Replacement", 950], ["Relay Replacement", 700], ["Overload Protector Replacement", 700]]], ["Pinto at drainage", [["Door Gasket Replacement", 750], ["Drainage Repair", 700]]], ["Refrigerant system", [["Refrigerant Leak Detection", 1150], ["Refrigerant Charging", 1500], ["Compressor Replacement", 3750]]]] }];
const DEFOC = [{ n: "Home Service / Dispatch Fee", k: "fixed", p: 300, a: true }, { n: "Additional Unit Inspection", k: "fixed", p: 250, a: false }, { n: "Emergency Service", k: "pct", p: 30, a: false }, { n: "After-hours Service", k: "pct", p: 20, a: false }, { n: "Out-of-town Service", k: "custom", a: false }, { n: "Ladder / Special Equipment", k: "fixed", p: 400, a: false }];
const SVM = { "Aircon cleaning": ["Aircon cleaning"], "Aircon repair": ["Aircon repair", "Freon refill"], "Ref cleaning": ["Ref cleaning"], "Ref repair": ["Ref repair", "Freon refill"] };
let CAT = cl(DEFCAT), OC = cl(DEFOC);
const ocs = o => o.k == "pct" ? "+" + o.p + "%" : o.k == "custom" ? "Custom quotation" : fmt(o.p);

/* ---------- estado ng app ---------- */
let USER = null;           // { id, email, role, name, phone, addr, svc, online, lat, lng }
let TECHS = [];            // mga online na technician
let TAB = "find", CUR = null, cat = null, item = null, sel = null, BK = null;
let mode = "login", role = "customer", err = "", sset = new Set();
let UNREAD = 0, chans = [], watchId = null, booted = false;
const STEPS = [["pending", "Hinihintay ang sagot ng technician"], ["accepted", "Tinanggap ang booking"], ["enroute", "Papunta na"], ["arrived", "Dumating na"], ["done", "Tapos na ang trabaho"]];
const STL = { pending: "Naghihintay", accepted: "Tinanggap", enroute: "Papunta na", arrived: "Dumating na", done: "Natapos", cancelled: "Kinansela", declined: "Tinanggihan" };
const ACTIVE = ["pending", "accepted", "enroute", "arrived"];

/* ---------- lokasyon at mapa ---------- */
let C = { lat: 14.676, lng: 121.0437 };  // default: Quezon City
const hv = (a, b) => { const R = 6371, r = Math.PI / 180, dl = (b.lat - a.lat) * r, dn = (b.lng - a.lng) * r, h = Math.sin(dl / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dn / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); };
const hasLoc = t => t && t.lat != null && t.lng != null;
const dist = t => hasLoc(t) ? hv(C, t) : null;
const eta = t => { const d = dist(t); return d == null ? null : Math.max(4, Math.round(d * 3 + 3)); };
const xy = t => ({ x: Math.max(4, Math.min(96, 50 + (t.lng - C.lng) / 0.000836)), y: Math.max(4, Math.min(96, 50 - (t.lat - C.lat) / 0.000808)) });
const kmTxt = t => { const d = dist(t); return d == null ? "—" : d.toFixed(1) + " km"; };
function locate() {
  return new Promise(res => {
    if (!navigator.geolocation) return res(null);
    navigator.geolocation.getCurrentPosition(p => res({ lat: p.coords.latitude, lng: p.coords.longitude }), () => res(null), { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 });
  });
}

/* ---------- data mula sa Supabase ---------- */
async function loadSettings() {
  const { data } = await sb.from("settings").select("key,value");
  (data || []).forEach(r => {
    if (r.key == "catalog" && Array.isArray(r.value) && r.value.length) CAT = r.value;
    if (r.key == "other_charges" && Array.isArray(r.value) && r.value.length) OC = r.value;
  });
}
async function loadTechs() {
  const { data, error } = await sb.from("profiles").select("id,name,svc,lat,lng,online").eq("role", "technician").eq("online", true);
  if (!error) TECHS = data || [];
}
async function loadProfile(u) {
  const { data, error } = await sb.from("profiles").select("*").eq("id", u.id).single();
  if (error) throw error;
  return { ...data, email: u.email };
}
async function refreshUnread() {
  if (!USER) return;
  const { count } = await sb.from("messages").select("id", { count: "exact", head: true }).neq("sender_id", USER.id).is("read_at", null);
  UNREAD = count || 0;
  const dot = document.querySelector('[data-t="chat"]');
  if (dot) dot.innerHTML = "Mensahe" + (UNREAD ? ' <i class="dot"></i>' : "");
}

/* ---------- realtime ---------- */
function subscribe() {
  unsubscribe();
  const me = USER.id;
  chans.push(sb.channel("msg-" + me)
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, p => onMessage(p.new))
    .subscribe());
  const col = USER.role == "technician" ? "tech_id" : "customer_id";
  if (USER.role != "admin") chans.push(sb.channel("bk-" + me)
    .on("postgres_changes", { event: "*", schema: "public", table: "bookings", filter: col + "=eq." + me }, p => onBooking(p.new))
    .subscribe());
  if (USER.role == "customer") chans.push(sb.channel("tech-" + me)
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "profiles", filter: "role=eq.technician" }, p => onTech(p.new))
    .subscribe());
}
function unsubscribe() { chans.forEach(c => sb.removeChannel(c)); chans = []; }

function onMessage(m) {
  if (!USER || (m.customer_id != USER.id && m.tech_id != USER.id)) return;
  const other = USER.role == "customer" ? m.tech_id : m.customer_id;
  if (TAB == "chat" && CUR && CUR.id == other) { CUR.msgs.push(m); if (m.sender_id != USER.id) sb.rpc("mark_read", { other }); drawMsgs(); }
  else if (TAB == "chat" && !CUR) inbox();
  refreshUnread();
}
function onBooking(b) {
  if (USER.role == "technician") { if (TAB == "dash") techDash(); return; }
  if (BK && BK.id == b.id) { BK = { ...BK, ...b }; trackView(); }
}
function onTech(t) {
  const i = TECHS.findIndex(x => x.id == t.id);
  if (t.online) { if (i >= 0) TECHS[i] = { ...TECHS[i], ...t }; else TECHS.push(t); }
  else if (i >= 0 && !(BK && BK.tech_id == t.id)) TECHS.splice(i, 1);
  if (BK && BK.tech_id == t.id) { BK.tech = { ...BK.tech, ...t }; if (TAB == "find") trackView(); }
  else if (TAB == "find" && !sel && !BK) home();
  else pins();
}

/* ============================================================
   AUTH
   ============================================================ */
function setupView() {
  A.hidden = false; $("app").hidden = true;
  A.innerHTML = `<div class="panel au"><img class="logo big" src="${LOGO}" alt="CoolFix"><h2>Kailangang i-set up ang Supabase</h2>
  <p class="mute">Hindi pa naka-configure ang <code>config.js</code>. Ilagay ang Supabase URL at anon key mo (makikita sa Supabase Dashboard &gt; Project Settings &gt; API), tapos i-reload ang page.</p></div>`;
}
function authView() {
  A.hidden = false; $("app").hidden = true; $("lo").hidden = true; $("tabs").hidden = true; $("who").textContent = "";
  const su = mode == "signup", tc = role == "technician", google = CFG.googleLogin && !NATIVE && !(su && tc);
  A.innerHTML = `<div class="panel au"><img class="logo big" src="${LOGO}" alt="CoolFix"><div class="chips"><button class="chip" aria-pressed="${!su}" data-m="login">Mag-log in</button><button class="chip" aria-pressed="${su}" data-m="signup">Gumawa ng account</button></div>
 ${su ? `<p class="mute" style="margin:0 0 6px">Mag-sign up bilang</p><div class="chips"><button class="chip" aria-pressed="${!tc}" data-r="customer">Customer</button><button class="chip" aria-pressed="${tc}" data-r="technician">Technician</button></div><label>Buong pangalan<input id="f_n" autocomplete="name"></label><label>Cellphone number<input id="f_p" type="tel" placeholder="09XXXXXXXXX" autocomplete="tel"></label>` : ""}
 <label>Email<input id="f_e" type="email" autocomplete="email"></label>
 <label>Password${su ? " (hindi bababa sa 8 character)" : ""}<input id="f_w" type="password" autocomplete="${su ? "new-password" : "current-password"}"></label>
 ${su && !tc ? `<label>Address<input id="f_a" placeholder="Brgy., Lungsod" autocomplete="street-address"></label>` : ""}
 ${su && tc ? `<p class="mute" style="margin:12px 0 6px">Anong serbisyo ang kaya mo?</p><div class="chips">${SERVICES.map(s => `<button class="chip" data-v="${s}" aria-pressed="${sset.has(s)}">${s}</button>`).join("")}</div><label>Lugar na sakop<input id="f_a" placeholder="hal. Quezon City, Marikina"></label>` : ""}
 <p class="err" id="er" role="alert">${esc(err)}</p>
 <button class="btn" id="go">${su ? "Gumawa ng account" : "Mag-log in"}</button>
 ${su ? "" : `<p class="or"><button class="chip" id="fp">Nakalimutan ang password?</button></p>`}
 ${google ? `<p class="or">o</p><button class="gbtn" id="gg"><svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z"/><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4.1 7.1-10.1 7.1-17.5z"/><path fill="#FBBC05" d="M10.5 28.7c-.5-1.5-.8-3-.8-4.7s.3-3.2.8-4.7l-7.9-6.1C.9 16.4 0 20.1 0 24s.9 7.6 2.6 10.8l7.9-6.1z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.5-5.8c-2.1 1.4-4.8 2.3-8.4 2.3-6.3 0-11.6-4.1-13.5-9.8l-7.9 6.1C6.5 42.6 14.6 48 24 48z"/></svg>${su ? "Mag-sign up gamit ang Google" : "Mag-log in gamit ang Google"}</button>${su ? `<p class="mute" style="font-size:12px;margin:6px 0 0">Ang Google sign-up ay para sa customer. Mag-email sign-up ang mga technician.</p>` : ""}` : ""}</div>`;
  A.querySelectorAll("[data-m]").forEach(b => b.onclick = () => { mode = b.dataset.m; err = ""; authView(); });
  A.querySelectorAll("[data-r]").forEach(b => b.onclick = () => { role = b.dataset.r; err = ""; authView(); });
  A.querySelectorAll("[data-v]").forEach(b => b.onclick = () => { const v = b.dataset.v; sset.has(v) ? sset.delete(v) : sset.add(v); b.setAttribute("aria-pressed", sset.has(v)); });
  $("go").onclick = su ? doSignup : doLogin;
  $("f_w").onkeydown = e => { if (e.key == "Enter") $("go").click(); };
  if ($("fp")) $("fp").onclick = doForgot;
  if ($("gg")) $("gg").onclick = doGoogle;
}
const busy = (b, on, txt) => { b.disabled = on; if (txt) b.textContent = txt; };
const showErr = m => { err = m; $("er").textContent = m; };

async function doSignup() {
  const v = i => ($(i)?.value || "").trim(), n = v("f_n"), p = v("f_p").replace(/[\s-]/g, ""), e = v("f_e").toLowerCase(), w = $("f_w").value, a = v("f_a");
  const bad = !n ? "Ilagay ang buong pangalan mo." : !/^(09|\+639)\d{9}$/.test(p) ? "Mali ang cellphone number. Gamitin ang format na 09XXXXXXXXX." : !/^\S+@\S+\.\S+$/.test(e) ? "Mali ang email address." : w.length < 8 ? "Masyadong maikli ang password. Gamitin ang hindi bababa sa 8 character." : role == "technician" && !sset.size ? "Pumili ng kahit isang serbisyo." : "";
  if (bad) return showErr(bad);
  const b = $("go"); busy(b, true, "Ginagawa ang account…");
  const { data, error } = await sb.auth.signUp({ email: e, password: w, options: { emailRedirectTo: location.origin + location.pathname, data: { role, name: n, phone: p, addr: a, svc: [...sset] } } });
  if (error) { busy(b, false, "Gumawa ng account"); return showErr(errMsg(error)); }
  sset = new Set(); err = "";
  if (!data.session) {
    A.innerHTML = `<div class="panel au"><img class="logo big" src="${LOGO}" alt="CoolFix"><h2>I-check ang email mo</h2><p class="mute">Nagpadala kami ng link sa <b>${esc(e)}</b>. I-click ito para ma-confirm ang account mo, tapos bumalik dito para mag-log in.</p><button class="btn" id="bl">Bumalik sa log in</button></div>`;
    $("bl").onclick = () => { mode = "login"; authView(); };
  }
}
async function doLogin() {
  const e = $("f_e").value.trim().toLowerCase(), w = $("f_w").value;
  if (!e || !w) return showErr("Ilagay ang email at password mo.");
  const b = $("go"); busy(b, true, "Nagla-log in…");
  const { error } = await sb.auth.signInWithPassword({ email: e, password: w });
  if (error) { busy(b, false, "Mag-log in"); showErr(errMsg(error)); }
}
async function doForgot() {
  const e = $("f_e").value.trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(e)) return showErr("Ilagay muna ang email mo sa itaas.");
  const { error } = await sb.auth.resetPasswordForEmail(e, { redirectTo: location.origin + location.pathname });
  if (error) return showErr(errMsg(error));
  $("er").className = "mute"; $("er").textContent = "Kung may account ang email na ito, nagpadala kami ng link para mag-reset ng password.";
}
async function doGoogle() {
  const { error } = await sb.auth.signInWithOAuth({ provider: "google", options: { redirectTo: location.origin + location.pathname } });
  if (error) showErr(errMsg(error));
}
function newPasswordView() {
  A.hidden = false; $("app").hidden = true; $("tabs").hidden = true;
  A.innerHTML = `<div class="panel au"><h2>Bagong password</h2><label>Password (hindi bababa sa 8 character)<input id="np" type="password" autocomplete="new-password"></label><p class="err" id="er" role="alert"></p><button class="btn" id="ns">I-save ang password</button></div>`;
  $("ns").onclick = async () => {
    const w = $("np").value; if (w.length < 8) return showErr("Masyadong maikli ang password.");
    const { error } = await sb.auth.updateUser({ password: w });
    if (error) return showErr(errMsg(error));
    const { data } = await sb.auth.getSession(); if (data.session) enter(data.session.user);
  };
}

async function enter(authUser) {
  try { USER = await loadProfile(authUser); }
  catch (e) { err = "Hindi ma-load ang profile mo. " + errMsg(e); await sb.auth.signOut(); return authView(); }
  err = ""; cat = null; item = null; sel = null; BK = null; CUR = null;
  $("who").textContent = first(USER.name) + " · " + (USER.role == "customer" ? "Customer" : USER.role == "admin" ? "Admin" : "Technician");
  $("lo").hidden = false;
  await loadSettings();
  subscribe(); refreshUnread();
  if (USER.role == "customer") {
    await loadTechs();
    const { data } = await sb.from("bookings").select("*").eq("customer_id", USER.id).in("status", ACTIVE).order("created_at", { ascending: false }).limit(1);
    if (data && data[0]) await openBooking(data[0]);
    locate().then(p => { if (p) { C = p; if (TAB == "find") BK ? trackView() : sel ? pins() : home(); if (GL) { gme.setPosition(C); gmap.setCenter(C); } } });
    initGM();
  }
  if (USER.role == "technician" && USER.online) startWatch();
  TAB = USER.role == "customer" ? "find" : USER.role == "admin" ? "ov" : "dash";
  show();
}
async function logout() {
  stopWatch();
  if (USER && USER.role == "technician" && USER.online) await sb.from("profiles").update({ online: false }).eq("id", USER.id);
  unsubscribe(); USER = null; BK = null; cancelAnimationFrame(anim);
  await sb.auth.signOut();
  mode = "login"; authView();
}
$("lo").onclick = logout;

/* ============================================================
   NAVIGATION
   ============================================================ */
function show() {
  const c = USER.role == "customer", ad = USER.role == "admin";
  const T = ad ? [["ov", "Overview"], ["tx", "Transaction"], ["tt", "Technician"], ["sv", "Serbisyo"], ["rg", "Rate guide"]]
    : c ? [["find", "Hanapin"], ["rg", "Rate guide"], ["chat", "Mensahe"], ["me", "Account"]]
      : [["dash", "Dashboard"], ["rg", "Rate guide"], ["chat", "Mensahe"], ["me", "Account"]];
  const nb = $("tabs"); nb.hidden = false;
  nb.innerHTML = T.map(([k, l]) => `<button class="tab" aria-pressed="${TAB == k}" data-t="${k}">${l}${k == "chat" && UNREAD ? ' <i class="dot"></i>' : ""}</button>`).join("");
  nb.querySelectorAll("button").forEach(b => b.onclick = () => { TAB = b.dataset.t; CUR = null; show(); });
  $("app").hidden = !(c && TAB == "find"); A.hidden = c && TAB == "find";
  if (TAB == "rg") rateGuide();
  else if (ad) adminView();
  else if (TAB == "chat") CUR ? chatView() : inbox();
  else if (TAB == "me") profile();
  else if (c) BK ? trackView() : home();
  else techDash();
}

/* ============================================================
   CUSTOMER: hanap, book, track
   ============================================================ */
const svcOf = () => cat ? (cat.m || cat.k) : null;
function list() {
  const s = svcOf();
  return TECHS.filter(t => !s || (SVM[s] || [s]).some(x => (t.svc || []).includes(x)))
    .sort((a, b) => (dist(a) ?? 1e9) - (dist(b) ?? 1e9));
}
function pins() {
  if (GL) return gpins();
  const L = BK ? (hasLoc(BK.tech) ? [BK.tech] : []) : list().filter(hasLoc);
  $("pins").innerHTML = L.map(t => { const p = xy(t); return `<g class="pin" tabindex="0" data-id="${t.id}"><circle cx="${p.x}" cy="${p.y}" r="${sel && sel.id == t.id || BK ? 4.4 : 3.4}" fill="var(--orange)" stroke="#fff" stroke-width="1"/><text x="${p.x}" y="${p.y + 1.2}" text-anchor="middle" font-size="3" font-weight="700" fill="#fff">${esc(ini(t.name)[0])}</text></g>`; }).join("");
  if (!BK) document.querySelectorAll(".pin").forEach(p => { p.onclick = () => pick(TECHS.find(t => t.id == p.dataset.id)); p.onkeydown = e => { if (e.key == "Enter") p.onclick(); }; });
}
function home() {
  cancelAnimationFrame(anim); if (GL) gClear(); $("route").innerHTML = ""; sel = null;
  pins();
  const L = list();
  const tl = L.map(t => `<button class="t" data-id="${t.id}"><div class="av">${esc(ini(t.name))}</div><div><b>${esc(t.name)}</b><small>${esc((t.svc || []).join(", "))}</small></div><div class="km">${kmTxt(t)}${eta(t) ? `<small>~${eta(t)} min</small>` : ""}</div></button>`).join("")
    || '<p class="mute">Walang online na technician para sa serbisyong ito ngayon. Subukan ulit mamaya.</p>';
  const hd = `<div class="hello"><b>Kumusta, ${esc(first(USER.name))}!</b><span>${TECHS.length} technician ang online ngayon</span></div>`;
  let body;
  if (!cat) body = `<h2 style="margin-top:12px">Anong serbisyo ang kailangan mo?</h2><div class="cats">${CAT.map((c, i) => `<button class="cat" data-c="${i}"><b>${esc(c.t)}</b><small>${esc(c.d)}</small></button>`).join("")}</div><p class="mute" style="font-size:13px">Tingnan ang <b>Rate guide</b> tab para sa lahat ng presyo at iba pang singil.</p>`;
  else body = `<button class="chip" id="cb" style="margin-top:10px">‹ Lahat ng serbisyo</button><h2 style="margin:10px 0 2px">${esc(cat.t)}</h2><p class="mute" style="margin:0 0 4px;font-size:13px">${esc(cat.n)}</p>
 ${cat.g.map((g, gi) => `<p class="gh">${esc(g[0])}</p>${g[1].map((x, xi) => `<button class="sv" aria-pressed="${!!item && item.n == x[0] && item.c == cat.k}" data-g="${gi}" data-x="${xi}"><span>${esc(x[0])}</span><b>${fmt(x[1])}</b></button>`).join("")}`).join("")}
 <h3 style="margin:16px 0 4px">${item ? "Pumili ng technician" : "Pumili muna ng serbisyo sa itaas"}</h3>${item ? `<p class="mute" style="margin:0 0 4px;font-size:13px">${L.length} technician para sa ${esc(item.n)}</p>${tl}` : ""}`;
  $("panel").innerHTML = hd + body;
  document.querySelectorAll(".cat").forEach(b => b.onclick = () => { cat = CAT[b.dataset.c]; item = null; home(); });
  if (cat) {
    $("cb").onclick = () => { cat = null; item = null; home(); };
    document.querySelectorAll(".sv").forEach(b => b.onclick = () => { const x = cat.g[b.dataset.g][1][b.dataset.x]; item = { c: cat.k, n: x[0], p: x[1], t: cat.t }; home(); });
  }
  document.querySelectorAll(".t").forEach(c => c.onclick = () => pick(TECHS.find(t => t.id == c.dataset.id)));
}
function pick(t) {
  if (!t) return;
  if (!item) { sel = t; pins(); return; }
  sel = t; pins();
  const au = OC.filter(o => o.a), opt = OC.map((o, i) => o.a ? "" : `<label class="ck"><input type="checkbox" data-oc="${i}"> ${esc(o.n)} <small>${ocs(o)}</small></label>`).join("");
  $("panel").innerHTML = `<h2>${esc(t.name)}</h2><p class="mute" style="margin:0">${esc((t.svc || []).join(", "))} · ${kmTxt(t)} ang layo</p>
 <div class="price" style="margin-top:12px"><span>${esc(item.t)}<br><b style="font-size:16px">${esc(item.n)}</b></span><span class="mute">${fmt(item.p)}</span></div>
 ${opt ? `<p class="gh">Dagdag na singil (kung kailangan)</p>${opt}` : ""}
 <label class="mute" style="display:block;margin-top:10px">Address<input id="ad" value="${esc(USER.addr || "")}" placeholder="Bahay #, kalye, Brgy., Lungsod"></label>
 <label class="mute" style="display:block;margin-top:10px">Oras<select id="tm"><option>Ngayon${eta(t) ? ` (~${eta(t)} min)` : ""}</option><option>Mamayang hapon</option><option>Bukas ng umaga</option></select></label>
 <div class="price"><span>Tinatayang bayad${au.length ? `<br><small class="mute">kasama ang ${au.map(o => esc(o.n)).join(", ")}</small>` : ""}</span><b id="pr"></b></div><p class="mute" style="font-size:13px;margin:4px 0 0">Suggested starting rates ito. Maaaring magbago ang huling bayad depende sa aktwal na check ng unit. Hiwalay ang singil sa parte.</p>
 <p class="err" id="er" role="alert"></p>
 <button class="btn" id="bk">I-book si ${esc(first(t.name))}</button>
 <button class="btn alt" id="mg">Mag-message kay ${esc(first(t.name))}</button>
 <button class="btn alt" id="bc">Bumalik sa listahan</button>`;
  const on = i => OC[i].a || !!document.querySelector(`[data-oc="${i}"]:checked`);
  const est = () => { let a = item.p, p = 0, cu = 0; OC.forEach((o, i) => { if (!on(i)) return; if (o.k == "fixed") a += o.p; else if (o.k == "pct") p += o.p / 100; else cu = 1; }); return [Math.round(a * (1 + p)), cu]; };
  const up = () => { const e = est(); $("pr").textContent = fmt(e[0]) + (e[1] ? " + custom" : ""); };
  document.querySelectorAll("[data-oc]").forEach(i => i.onchange = up); up();
  $("bc").onclick = home; $("mg").onclick = () => openChat(t.id, t.name);
  $("bk").onclick = async () => {
    const ad = $("ad").value.trim(); if (ad.length < 5) return showErr("Ilagay ang buong address mo.");
    const b = $("bk"); busy(b, true, "Bino-book…");
    const extras = OC.filter((o, i) => on(i)).map(o => ({ n: o.n, k: o.k, p: o.p ?? null }));
    const { data, error } = await sb.from("bookings").insert({ customer_id: USER.id, tech_id: t.id, category: item.t, item: item.n, amount: est()[0], extras, address: ad, sched: $("tm").value }).select().single();
    if (error) { busy(b, false, "I-book si " + first(t.name)); return showErr(errMsg(error)); }
    if (!USER.addr) { USER.addr = ad; sb.from("profiles").update({ addr: ad }).eq("id", USER.id); }
    await openBooking(data);
  };
}
async function openBooking(b) {
  let tech = TECHS.find(t => t.id == b.tech_id);
  if (!tech) { const { data } = await sb.from("profiles").select("id,name,svc,lat,lng,online").eq("id", b.tech_id).single(); tech = data || { id: b.tech_id, name: "Technician" }; }
  BK = { ...b, tech }; TAB = "find"; show();
}
let anim = 0;
function trackView() {
  if (!BK || TAB != "find") return;
  const t = BK.tech, s = BK.status, idx = STEPS.findIndex(x => x[0] == s), done = s == "done", off = s == "cancelled" || s == "declined";
  sel = null; pins();
  const p = hasLoc(t) ? xy(t) : null;
  $("route").innerHTML = p && ["accepted", "enroute"].includes(s) ? `<polyline points="${p.x},${p.y} 50,${p.y} 50,50" fill="none" stroke="var(--blue)" stroke-width="1.2" stroke-dasharray="2 2"/>` : "";
  if (GL) gtrack();
  const big = off ? (s == "declined" ? "Tinanggihan" : "Kinansela") : done ? "Tapos na!" : s == "arrived" ? "Dumating na!" : s == "pending" ? "Naghihintay…" : (eta(t) ? eta(t) + " min" : "Papunta na");
  const sub = s == "pending" ? `Hinihintay na tanggapin ni ${esc(first(t.name))} ang booking.` : s == "declined" ? "Hindi available ang technician. Pumili ng iba." : s == "arrived" ? `Nasa harap na ng bahay mo si ${esc(first(t.name))}.` : ["accepted", "enroute"].includes(s) && dist(t) != null ? dist(t).toFixed(1) + " km ang layo" : "";
  $("panel").innerHTML = `<h2>${off ? "Booking " + code(BK) : `Booking ${code(BK)} · ${esc(first(t.name))}`}</h2>
 <p class="mute" style="margin:0 0 12px">${esc(BK.category)}: ${esc(BK.item)} · ${esc(BK.address)}</p>
 <div class="eta">${big}</div><div class="mute">${sub}</div>
 ${off ? "" : `<ul class="steps">${STEPS.map((x, i) => `<li class="${i <= idx ? "on" : ""}">${x[1]}</li>`).join("")}</ul>`}
 <div class="row"><span class="mute">Tinatayang bayad</span><b>${fmt(BK.amount)}</b></div>
 <p class="err" id="er" role="alert"></p>
 ${off || done ? `<button class="btn" id="nw">${done ? "Mag-book ulit" : "Pumili ng ibang technician"}</button>` : `<button class="btn" id="tc">Mag-message sa technician</button>${["pending", "accepted", "enroute"].includes(s) ? '<button class="btn alt" id="cx">Kanselahin ang booking</button>' : ""}`}`;
  const on = (id, f) => $(id) && ($(id).onclick = f);
  on("tc", () => openChat(t.id, t.name));
  on("nw", () => { BK = null; item = null; cat = null; loadTechs().then(home); });
  on("cx", async () => {
    if (!confirm("Sigurado ka bang kakanselahin ang booking?")) return;
    const { error } = await sb.from("bookings").update({ status: "cancelled" }).eq("id", BK.id);
    if (error) showErr(errMsg(error)); else { BK.status = "cancelled"; trackView(); }
  });
}

/* ============================================================
   TECHNICIAN
   ============================================================ */
function startWatch() {
  if (watchId != null || !navigator.geolocation) return;
  let last = 0;
  watchId = navigator.geolocation.watchPosition(p => {
    const now = Date.now(); if (now - last < 15000) return; last = now;
    USER.lat = p.coords.latitude; USER.lng = p.coords.longitude;
    sb.from("profiles").update({ lat: USER.lat, lng: USER.lng }).eq("id", USER.id);
  }, () => { }, { enableHighAccuracy: true, maximumAge: 10000 });
}
function stopWatch() { if (watchId != null) navigator.geolocation.clearWatch(watchId); watchId = null; }

async function techDash() {
  if (TAB != "dash") return;
  const u = USER;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const { data: bks } = await sb.from("bookings").select("*").eq("tech_id", u.id).order("created_at", { ascending: false }).limit(100);
  const B = bks || [];
  const act = B.filter(b => ACTIVE.includes(b.status));
  const doneToday = B.filter(b => b.status == "done" && new Date(b.updated_at) >= today);
  const earn = doneToday.reduce((n, b) => n + b.amount - fee(b.amount), 0);
  const ids = [...new Set(act.map(b => b.customer_id))];
  const { data: cs } = ids.length ? await sb.from("profiles").select("id,name,phone").in("id", ids) : { data: [] };
  const cn = Object.fromEntries((cs || []).map(c => [c.id, c]));
  if (TAB != "dash") return;
  const NEXT = { pending: [["accepted", "Tanggapin"], ["declined", "Tanggihan"]], accepted: [["enroute", "Papunta na ako"]], enroute: [["arrived", "Dumating na ako"]], arrived: [["done", "Tapos na ang trabaho"]] };
  const card = b => { const c = cn[b.customer_id] || {}; return `<div class="ged"><div class="row"><b>${code(b)} · ${esc(STL[b.status])}</b><span class="mute">${tm(b.created_at)}</span></div>
   <p style="margin:4px 0">${esc(b.category)}: <b>${esc(b.item)}</b> · ${fmt(b.amount)}</p>
   <p class="mute" style="margin:0">${esc(c.name || "Customer")}${c.phone ? ` · <a href="tel:${esc(c.phone)}">${esc(c.phone)}</a>` : ""}<br>${esc(b.address)} · ${esc(b.sched)}</p>
   ${(NEXT[b.status] || []).map((x, i) => `<button class="btn ${i ? "alt" : ""}" data-b="${b.id}" data-s="${x[0]}">${x[1]}</button>`).join("")}
   <button class="btn alt" data-chat="${b.customer_id}" data-n="${esc(c.name || "Customer")}">Mag-message sa customer</button></div>`; };
  A.innerHTML = `<div class="panel au"><h2>Kumusta, ${esc(first(u.name))}!</h2><p class="mute" style="margin:0">${esc((u.svc || []).join(", "))} · ${esc(u.addr || "—")}</p>
  <div class="stats"><div><b>${fmt(earn)}</b><small>Kita ngayon (85%)</small></div><div><b>${B.filter(b => b.status == "done").length}</b><small>Natapos</small></div><div><b>${UNREAD}</b><small>Bagong mensahe</small></div></div>
  <button class="btn ${u.online ? "" : "alt"}" id="ol">${u.online ? "Online ka (i-tap para mag-offline)" : "Offline ka (i-tap para mag-online)"}</button>
  <p class="err" id="er" role="alert"></p>
  <div style="margin-top:6px" aria-live="polite">${act.length ? act.map(card).join("") : `<p class="mute">${u.online ? "Naghihintay ng request… Lalabas dito agad ang bagong booking." : "Offline ka. I-on ang Online para makita ka ng mga customer."}</p>`}</div></div>`;
  $("ol").onclick = async () => {
    const on = !u.online, upd = { online: on };
    if (on) { const p = await locate(); if (p) { upd.lat = p.lat; upd.lng = p.lng; } else showErr("Hindi makuha ang lokasyon mo. Makikita ka pa rin, pero walang distansya sa mapa."); }
    const { error } = await sb.from("profiles").update(upd).eq("id", u.id);
    if (error) return showErr(errMsg(error));
    Object.assign(u, upd); on ? startWatch() : stopWatch(); techDash();
  };
  A.querySelectorAll("[data-b]").forEach(b => b.onclick = async () => {
    b.disabled = true;
    const { error } = await sb.from("bookings").update({ status: b.dataset.s }).eq("id", b.dataset.b);
    if (error) { b.disabled = false; return showErr(errMsg(error)); }
    if (b.dataset.s == "enroute") startWatch();
    techDash();
  });
  A.querySelectorAll("[data-chat]").forEach(b => b.onclick = () => openChat(b.dataset.chat, b.dataset.n));
}

/* ============================================================
   CHAT
   ============================================================ */
async function inbox() {
  const me = USER.id, isC = USER.role == "customer";
  const { data } = await sb.from("messages").select("*").order("created_at", { ascending: false }).limit(500);
  const conv = {};
  (data || []).forEach(m => { const o = isC ? m.tech_id : m.customer_id; (conv[o] = conv[o] || { last: m, u: 0 }); if (m.sender_id != me && !m.read_at) conv[o].u++; });
  const ids = Object.keys(conv);
  const { data: ps } = ids.length ? await sb.from("profiles").select("id,name").in("id", ids) : { data: [] };
  const nm = Object.fromEntries((ps || []).map(p => [p.id, p.name]));
  if (TAB != "chat" || CUR) return;
  A.innerHTML = `<div class="panel au"><h2>Mensahe</h2>${ids.length ? ids.map(id => { const v = conv[id], n = nm[id] || (isC ? "Technician" : "Customer"); return `<button class="t" data-k="${id}" data-n="${esc(n)}"><div class="av">${esc(ini(n))}</div><div><b>${esc(n)}</b><small>${esc(v.last.body.slice(0, 44))}</small></div><div class="km">${tm(v.last.created_at)}${v.u ? `<small><span class="badge">${v.u}</span></small>` : ""}</div></button>`; }).join("")
    : `<p class="mute">Wala ka pang mensahe. ${isC ? "Pumili ng technician sa Hanapin at i-tap ang Mag-message." : "Lalabas dito ang mga mensahe ng customer."}</p>`}</div>`;
  A.querySelectorAll("[data-k]").forEach(b => b.onclick = () => openChat(b.dataset.k, b.dataset.n));
}
async function openChat(id, name) {
  CUR = { id, name, msgs: [] }; TAB = "chat"; show();
}
async function chatView() {
  const c = CUR, isC = USER.role == "customer";
  const col = isC ? "tech_id" : "customer_id";
  const qr = isC ? ["Magkano po ang cleaning?", "Pwede po ba ngayon?", "Salamat po!"] : ["Papunta na po ako.", "Ilang unit po ang aircon?", "Pwede po ba bukas ng umaga?"];
  A.innerHTML = `<div class="panel au chat"><div class="ch-h"><button class="chip" id="cb">‹ Bumalik</button><div class="av">${esc(ini(c.name))}</div><b>${esc(c.name)}</b></div><div class="msgs" id="ms"><p class="mute">Naglo-load…</p></div><div class="chips" style="margin:8px 0">${qr.map(q => `<button class="chip" data-q="${esc(q)}">${esc(q)}</button>`).join("")}</div><div class="send"><input id="mi" placeholder="Mag-type ng mensahe" maxlength="500" autocomplete="off"><button class="btn" id="sn" style="width:auto;margin:0;padding:10px 16px">Ipadala</button></div><p class="err" id="er" role="alert"></p></div>`;
  $("cb").onclick = () => { CUR = null; show(); };
  const go = async () => {
    const t = $("mi").value.trim(); if (!t) return;
    $("mi").value = "";
    const row = isC ? { customer_id: USER.id, tech_id: c.id } : { customer_id: c.id, tech_id: USER.id };
    const { error } = await sb.from("messages").insert({ ...row, sender_id: USER.id, body: t });
    if (error) { $("mi").value = t; showErr(errMsg(error)); }
  };
  $("sn").onclick = go; $("mi").onkeydown = e => { if (e.key == "Enter") go(); };
  A.querySelectorAll("[data-q]").forEach(b => b.onclick = () => { $("mi").value = b.dataset.q; go(); });
  const { data } = await sb.from("messages").select("*").eq(col, c.id).order("created_at").limit(300);
  if (CUR !== c) return;
  c.msgs = (data || []).filter(m => m.customer_id == USER.id || m.tech_id == USER.id);
  drawMsgs();
  await sb.rpc("mark_read", { other: c.id }); refreshUnread();
}
function drawMsgs() {
  const ms = $("ms"); if (!ms || !CUR) return;
  ms.innerHTML = CUR.msgs.map(m => `<div class="b ${m.sender_id == USER.id ? "me" : "them"}">${esc(m.body)}<small>${tm(m.created_at)}</small></div>`).join("") || '<p class="mute">Simulan ang usapan. Mag-hi!</p>';
  ms.scrollTop = ms.scrollHeight;
}

/* ============================================================
   ACCOUNT
   ============================================================ */
async function profile() {
  const u = USER, c = u.role == "customer", row = (a, b) => `<div class="row"><span class="mute">${a}</span><span>${esc(b)}</span></div>`;
  A.innerHTML = `<div class="panel au"><div class="who"><div class="av big">${esc(ini(u.name))}</div><div><h2 style="margin:0">${esc(u.name)}</h2><span class="mute">${c ? "Customer" : "Technician"}</span></div></div>
  ${row("Email", u.email)}
  <label class="mute" style="display:block;margin-top:10px">Cellphone<input id="pp" type="tel" value="${esc(u.phone)}"></label>
  <label class="mute" style="display:block;margin-top:10px">${c ? "Address" : "Lugar na sakop"}<input id="pa" value="${esc(u.addr)}"></label>
  ${c ? "" : row("Serbisyo", (u.svc || []).join(", "))}
  <p class="mute" id="pe" role="status"></p><button class="btn" id="ps">I-save ang pagbabago</button>
  <div id="hist"></div><button class="btn alt" id="pl">Mag-log out</button></div>`;
  $("pl").onclick = logout;
  $("ps").onclick = async () => {
    const ph = $("pp").value.replace(/[\s-]/g, ""), ad = $("pa").value.trim(), e = $("pe");
    if (ph && !/^(09|\+639)\d{9}$/.test(ph)) { e.className = "err"; e.textContent = "Mali ang cellphone number."; return; }
    const { error } = await sb.from("profiles").update({ phone: ph, addr: ad }).eq("id", u.id);
    if (error) { e.className = "err"; e.textContent = errMsg(error); return; }
    u.phone = ph; u.addr = ad; e.className = "mute"; e.textContent = "Na-save!";
  };
  const { data } = await sb.from("bookings").select("*").eq(c ? "customer_id" : "tech_id", u.id).order("created_at", { ascending: false }).limit(10);
  if (TAB != "me") return;
  $("hist").innerHTML = `<h2 style="margin-top:16px">Mga booking</h2>${(data || []).length ? data.map(b => `<div class="row"><span>${esc(b.item)}<br><small class="mute">${code(b)} · ${esc(STL[b.status])}</small></span><span class="mute">${fmt(b.amount)}<br><small>${dstr(b.created_at)}</small></span></div>`).join("") : '<p class="mute">Wala pang booking.</p>'}`;
  if (c) document.querySelectorAll("#hist .row").forEach((r, i) => { const b = data[i]; if (ACTIVE.includes(b.status)) { r.style.cursor = "pointer"; r.onclick = () => openBooking(b); } });
}

/* ============================================================
   RATE GUIDE
   ============================================================ */
function rateGuide() {
  rateMarket();
  const tb = (h, r) => `<div class="tw"><table style="min-width:420px"><thead><tr>${h.map(x => `<th>${x}</th>`).join("")}</tr></thead><tbody>${r.map(a => `<tr>${a.map(x => `<td>${x}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
  A.insertAdjacentHTML("afterbegin", `<div class="panel au wide"><h2>Rate guide ng CoolFix</h2><p class="mute" style="margin:0">Suggested starting rates para sa CoolFix catalog. Hindi ito verified na pambansang standard na presyo.</p>${CAT.map(c => `<h3 style="margin:18px 0 0">${esc(c.t)}</h3><p class="mute" style="margin:0;font-size:13px">${esc(c.n)}</p>${tb(["Serbisyo", "Presyo"], c.g.flatMap(g => g[1].map(x => [esc(x[0]), fmt(x[1])])))}`).join("")}<h3 style="margin:18px 0 0">Iba pang singil</h3>${tb(["Serbisyo", "Presyo"], OC.map(o => [esc(o.n), ocs(o)]))}<p class="mute" style="font-size:13px">Ito ay suggested app pricing rules, hindi fixed industry rates.</p></div>`);
}
function rateMarket() {
  const P = n => n == null ? "—" : fmt(n), tb = (h, r) => `<div class="tw"><table style="min-width:560px"><thead><tr>${h.map(x => `<th>${x}</th>`).join("")}</tr></thead><tbody>${r.map(a => `<tr>${a.map(x => `<td>${typeof x == "number" || x == null ? P(x) : x}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
  const AC = [["Window (hanggang 1.5 HP)", 990, 450, 1200, 1500, 890, 2100], ["U-shaped (hanggang 1.5 HP)", 1775, 450, 1200, 1800, 990, 2500], ["Split / Wall mount", 1775, 450, 1200, 9500, 2100, 12200], ["Tower / Floor mount", 2550, 450, 1200, 10500, 3200, 14500], ["Cassette / Ceiling mount", 3675, 450, 1200, null, 5400, null], ["Suspended", 3675, 450, 1200, null, 5400, null], ["Concealed", 3675, 450, 1200, null, 5400, null]];
  const RF = [["Refrigerator (lahat ng uri)", 450, 1200], ["Chest freezer", 450, 1200], ["Light commercial chiller", 450, 1200]];
  const AD = [["Window: dagdag kada +0.5 HP lampas 1.5 HP", 350], ["Window: bagong bracket", 1300], ["Hagdan (ladder) para sa mataas na unit", 450], ["Minor repair, walang pinalitan na parte (labor)", 1100], ["Major repair, may/walang parte (labor)", 2500], ["System repair at reprocess hanggang 2.5 HP (labor)", 2500], ["System repair at reprocess hanggang 2.5 HP (materyales)", 2500], ["Compressor replacement hanggang 2.5 HP (labor lang)", 3000]];
  A.innerHTML = `<div class="panel au wide"><h2>Market reference (Teko, Metro Manila)</h2><p class="mute" style="margin:0">Gabay na presyo sa Metro Manila para ihambing. Labor/serbisyo lang ito. Hindi kasama ang parte, freon, materyales at parking.</p>
 <h3 style="margin:18px 0 0">Aircon: ayon sa uri ng unit</h3>${tb(["Uri ng aircon", "Cleaning", "Check-up", "Repair (minimum)", "Install", "Dismantle", "Relocate"], AC)}
 <p class="mute" style="font-size:13px">Pareho ang presyo ng inverter at non-inverter sa mga rate na ito. Walang hiwalay na presyo kada brand (Carrier, Daikin, LG, Samsung, atbp.). Ang HP at uri ng unit ang batayan.</p>
 <h3 style="margin:18px 0 0">Refrigeration</h3>${tb(["Uri ng unit", "Check-up", "Repair (minimum)"], RF)}
 <p class="mute" style="font-size:13px">Ang check-up ay may kasamang diagnosis at repair quotation. Ang aktwal na repair ay depende sa sira, kaya mag-quote muna ang technician bago gumawa.</p>
 <h3 style="margin:18px 0 0">Dagdag na gawain at singil ng technician</h3>${tb(["Gawain", "Presyo"], AD)}
 <p class="mute" style="font-size:13px">Mas mababa nang kaunti ang ilang labor rate na ito kumpara sa talahanayan sa itaas, dahil iba ang pinagkunan.</p>
 <h3 style="margin:18px 0 0">Tips bago pumayag sa presyo</h3>
 <ul class="mute" style="margin:6px 0 0;padding-left:20px"><li>Humingi ng nakasulat o chat na quotation bago simulan ang repair.</li><li>Itanong kung kasama ba ang parte, freon at materyales.</li><li>Ang low freon ay kadalasang palatandaan ng leak. Dapat hanapin at ayusin ang leak, hindi basta i-refill.</li><li>Linisin ang aircon tuwing 3 hanggang 4 na buwan para tumagal at mas makatipid sa kuryente.</li></ul>
 <p class="mute" style="font-size:12px;margin-top:14px">Pinagkunan: Teko Out-of-Warranty Service Rates at Teko Pro Field Service Rates (NCR, 2026), at Home Credit PH para sa tantiya ng ref repair. Magkakaiba ang presyo sa bawat lugar at technician, kaya gabay lang ito.</p></div>`;
}

/* ============================================================
   ADMIN
   ============================================================ */
let AF = { st: "Lahat", q: "" }, ED = null, EC = 0, AX = null;
async function adminData() {
  const [{ data: bks }, { data: ps }] = await Promise.all([
    sb.from("bookings").select("*").order("created_at", { ascending: false }).limit(1000),
    sb.from("profiles").select("id,name,role,online").limit(5000)]);
  const nm = Object.fromEntries((ps || []).map(p => [p.id, p]));
  AX = { B: (bks || []).map(b => ({ ...b, cust: nm[b.customer_id]?.name || "—", tech: nm[b.tech_id]?.name || "—" })), P: ps || [] };
}
async function adminView() {
  if (TAB == "sv") return admSv();
  A.innerHTML = '<div class="panel au wide"><p class="mute">Naglo-load…</p></div>';
  await adminData();
  TAB == "ov" ? admOv() : TAB == "tx" ? admTx() : admTc();
}
function admOv() {
  const B = AX.B, ok = B.filter(x => x.status == "done"), g = ok.reduce((n, x) => n + x.amount, 0);
  const d7 = [...Array(7)].map((_, i) => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - 6 + i); const a = d.getTime(); return { l: d.toLocaleDateString("en-PH", { weekday: "short" }), v: ok.filter(x => { const t = new Date(x.updated_at).getTime(); return t >= a && t < a + 864e5; }).reduce((n, x) => n + x.amount, 0) }; }), mx = Math.max(1, ...d7.map(x => x.v));
  A.innerHTML = `<div class="panel au wide"><h2>Overview</h2><div class="stats s4"><div><b>${fmt(g)}</b><small>Kabuuang bayad</small></div><div><b>${fmt(fee(g))}</b><small>Kita ng CoolFix (15%)</small></div><div><b>${ok.length}/${B.length}</b><small>Natapos na booking</small></div><div><b>${AX.P.filter(u => u.role == "technician").length} / ${AX.P.filter(u => u.role == "customer").length}</b><small>Technician / Customer</small></div></div><h2 style="margin-top:16px">Bayad sa nakaraang 7 araw</h2><div class="bars">${d7.map(x => `<div><i style="height:${Math.round(x.v / mx * 100)}%" title="${fmt(x.v)}"></i><small>${x.l}</small></div>`).join("")}</div></div>`;
}
function admTx() {
  const S = ["Lahat", ...Object.values(STL)], q = AF.q.toLowerCase();
  const L = AX.B.filter(x => (AF.st == "Lahat" || STL[x.status] == AF.st) && (x.tech + x.cust + x.item + code(x)).toLowerCase().includes(q));
  A.innerHTML = `<div class="panel au wide"><h2>Mga transaction</h2><div class="chips">${S.map(s => `<button class="chip" aria-pressed="${AF.st == s}" data-s="${s}">${s}</button>`).join("")}</div><input id="aq" placeholder="Hanapin: technician, customer, serbisyo" value="${esc(AF.q)}"><div class="tw"><table><thead><tr><th>ID</th><th>Petsa</th><th>Customer</th><th>Technician</th><th>Serbisyo</th><th>Bayad</th><th>Fee (15%)</th><th>Status</th></tr></thead><tbody>${L.map(x => `<tr><td>${code(x)}</td><td>${dstr(x.created_at)}</td><td>${esc(x.cust)}</td><td>${esc(x.tech)}</td><td>${esc(x.item)}</td><td>${fmt(x.amount)}</td><td>${x.status == "done" ? fmt(fee(x.amount)) : "—"}</td><td><span class="pill ${x.status == "done" ? "ok" : ["cancelled", "declined"].includes(x.status) ? "no" : ""}">${STL[x.status]}</span></td></tr>`).join("") || `<tr><td colspan="8" class="mute">Walang transaction na tugma.</td></tr>`}</tbody></table></div><p class="mute">${L.length} transaction · Kabuuang natapos: ${fmt(L.filter(x => x.status == "done").reduce((n, x) => n + x.amount, 0))}</p></div>`;
  A.querySelectorAll("[data-s]").forEach(b => b.onclick = () => { AF.st = b.dataset.s; admTx(); });
  $("aq").oninput = e => { AF.q = e.target.value; admTx(); const i = $("aq"); i.focus(); i.setSelectionRange(i.value.length, i.value.length); };
}
function admTc() {
  const m = {};
  AX.P.filter(u => u.role == "technician").forEach(u => m[u.id] = { n: u.name, u, j: 0, g: 0, c: 0 });
  AX.B.forEach(x => { const o = m[x.tech_id]; if (!o) return; if (x.status == "done") { o.j++; o.g += x.amount; } if (x.status == "cancelled" || x.status == "declined") o.c++; });
  const L = Object.values(m).sort((a, b) => b.g - a.g);
  A.innerHTML = `<div class="panel au wide"><h2>Mga technician</h2><div class="tw"><table><thead><tr><th>Pangalan</th><th>Natapos</th><th>Kinansela</th><th>Kabuuang bayad</th><th>Kita ng technician (85%)</th><th>Fee ng CoolFix</th><th>Status</th></tr></thead><tbody>${L.map(o => `<tr><td>${esc(o.n)}</td><td>${o.j}</td><td>${o.c}</td><td>${fmt(o.g)}</td><td>${fmt(o.g - fee(o.g))}</td><td>${fmt(fee(o.g))}</td><td><span class="pill ${o.u.online ? "ok" : ""}">${o.u.online ? "Online" : "Offline"}</span></td></tr>`).join("") || '<tr><td colspan="7" class="mute">Wala pang technician na naka-register.</td></tr>'}</tbody></table></div></div>`;
}
function admSv() {
  if (!ED) ED = { c: cl(CAT), o: cl(OC) };
  EC = Math.max(0, Math.min(EC, ED.c.length - 1)); const c = ED.c[EC], E = x => esc(String(x ?? ""));
  const num = (d, v) => `<input type="number" min="0" inputmode="numeric" data-${d} value="${v == null ? "" : v}">`;
  A.innerHTML = `<div class="panel au wide"><h2>Mga serbisyo at presyo</h2><p class="mute" style="margin:0">I-edit ang presyo at serbisyo, o magdagdag ng bago. Pindutin ang I-save sa ibaba para lumabas ito sa customer.</p>
 <div class="chips" style="margin-top:12px">${ED.c.map((x, i) => `<button class="chip" aria-pressed="${i == EC}" data-ec="${i}">${E(x.t || "Walang pangalan")}</button>`).join("")}<button class="chip" id="acat">+ Bagong kategorya</button></div>
 <label>Pangalan ng kategorya<input data-f="t" value="${E(c.t)}"></label>
 <label>Maikling paglalarawan<input data-f="d" value="${E(c.d)}"></label>
 <label>Paalala sa customer<input data-f="n" value="${E(c.n)}"></label>
 <label>Technician na pwedeng kumuha<select data-f="m">${SERVICES.map(s => `<option ${(c.m || c.k) == s ? "selected" : ""}>${s}</option>`).join("")}</select></label>
 ${c.g.map((g, gi) => `<div class="ged"><div class="grow"><input data-gn="${gi}" value="${E(g[0])}" aria-label="Pangalan ng group"><button class="chip" data-dg="${gi}">Alisin ang group</button></div><div class="irow mute" style="margin:8px 0 0;font-size:12px"><span style="flex:3 1 160px">Serbisyo</span><span style="flex:1 1 90px">Presyo (₱)</span><span style="width:44px"></span></div>${g[1].map((x, xi) => `<div class="irow"><input data-i="${gi}:${xi}:0" value="${E(x[0])}" aria-label="Serbisyo">${num(`i="${gi}:${xi}:1"`, x[1])}<button class="chip" data-dx="${gi}:${xi}" aria-label="Alisin ang serbisyo">✕</button></div>`).join("")}<button class="chip" data-ax="${gi}">+ Dagdag na serbisyo</button></div>`).join("")}
 <button class="btn alt" id="ag">+ Dagdag na group</button><button class="btn alt" id="dcat">Alisin ang kategoryang ito</button>
 <h3 style="margin:22px 0 0">Iba pang singil</h3><p class="mute" style="margin:0;font-size:13px">Ang may tsek sa Awtomatiko ay laging kasama sa tinatayang bayad. Ang iba ay pipiliin ng customer.</p>
 ${ED.o.map((o, i) => `<div class="irow"><input data-o="${i}:n" value="${E(o.n)}" aria-label="Pangalan ng singil"><select data-o="${i}:k" aria-label="Uri"><option value="fixed" ${o.k == "fixed" ? "selected" : ""}>Fixed (₱)</option><option value="pct" ${o.k == "pct" ? "selected" : ""}>Porsyento (%)</option><option value="custom" ${o.k == "custom" ? "selected" : ""}>Custom quotation</option></select>${num(`o="${i}:p"`, o.p)}<label class="ck" style="border:0;padding:0"><input type="checkbox" data-o="${i}:a" ${o.a ? "checked" : ""}> Awtomatiko</label><button class="chip" data-do="${i}" aria-label="Alisin ang singil">✕</button></div>`).join("")}
 <button class="chip" id="ao">+ Dagdag na singil</button><p class="mute" style="font-size:12px;margin:6px 0 0">Para sa Porsyento, ilagay ang % (hal. 30). Para sa Custom quotation, hindi na kailangan ang number.</p>
 <p class="err" id="se" role="alert"></p><button class="btn" id="ss">I-save</button><button class="btn alt" id="sr">Ibalik sa default</button></div>`;
  const q = s => A.querySelectorAll(s), re = () => admSv();
  q("[data-f]").forEach(i => i.oninput = i.onchange = () => { c[i.dataset.f] = i.value; if (i.dataset.f == "t") q("[data-ec]")[EC].textContent = i.value || "Walang pangalan"; });
  q("[data-gn]").forEach(i => i.oninput = () => { c.g[i.dataset.gn][0] = i.value; });
  q("[data-i]").forEach(i => i.oninput = () => { const [a, b, f] = i.dataset.i.split(":").map(Number); c.g[a][1][b][f] = f ? (i.value === "" ? "" : Number(i.value)) : i.value; });
  q("[data-o]").forEach(i => { const h = () => { const [n, f] = i.dataset.o.split(":"), o = ED.o[n]; o[f] = f == "a" ? i.checked : f == "p" ? (i.value === "" ? "" : Number(i.value)) : i.value; }; i.oninput = h; i.onchange = h; });
  q("[data-ec]").forEach(b => b.onclick = () => { EC = +b.dataset.ec; re(); });
  $("acat").onclick = () => { ED.c.push({ k: "c" + Date.now(), t: "Bagong kategorya", d: "", n: "", m: "Aircon repair", g: [["Bagong group", [["Bagong serbisyo", 500]]]] }); EC = ED.c.length - 1; re(); };
  q("[data-dg]").forEach(b => b.onclick = () => { c.g.splice(+b.dataset.dg, 1); re(); });
  q("[data-dx]").forEach(b => b.onclick = () => { const [a, x] = b.dataset.dx.split(":").map(Number); c.g[a][1].splice(x, 1); re(); });
  q("[data-ax]").forEach(b => b.onclick = () => { c.g[+b.dataset.ax][1].push(["Bagong serbisyo", 500]); re(); });
  $("ag").onclick = () => { c.g.push(["Bagong group", [["Bagong serbisyo", 500]]]); re(); };
  $("dcat").onclick = () => { if (ED.c.length < 2) { const e = $("se"); e.className = "err"; e.textContent = "Kailangan ng kahit isang kategorya."; return; } ED.c.splice(EC, 1); EC = 0; re(); };
  q("[data-do]").forEach(b => b.onclick = () => { ED.o.splice(+b.dataset.do, 1); re(); });
  $("ao").onclick = () => { ED.o.push({ n: "Bagong singil", k: "fixed", p: 150, a: false }); re(); };
  const persist = async (cc, oo, msg) => {
    const now = new Date().toISOString();
    const { error } = await sb.from("settings").upsert([{ key: "catalog", value: cc, updated_at: now }, { key: "other_charges", value: oo, updated_at: now }]);
    const e = $("se");
    if (error) { e.className = "err"; e.textContent = errMsg(error); return; }
    CAT = cl(cc); OC = cl(oo); cat = null; item = null; ED = null; admSv();
    const e2 = $("se"); e2.className = "mute"; e2.textContent = msg;
  };
  $("sr").onclick = () => { if (confirm("Ibalik sa default ang lahat ng serbisyo at singil?")) persist(cl(DEFCAT), cl(DEFOC), "Naibalik sa default ang mga serbisyo at singil."); };
  $("ss").onclick = () => {
    const e = $("se"); e.className = "err"; let m = ""; const bad = v => v === "" || !(v >= 0);
    ED.c.forEach(k => { if (!k.t.trim()) m = m || "Lagyan ng pangalan ang bawat kategorya."; if (!k.g.length) m = m || `Walang group ang ${k.t || "kategorya"}.`; k.g.forEach(g => { if (!g[0].trim()) m = m || `Lagyan ng pangalan ang group sa ${k.t}.`; if (!g[1].length) m = m || `Walang serbisyo ang group na ${g[0]}.`; g[1].forEach(x => { if (!String(x[0]).trim()) m = m || `May serbisyong walang pangalan sa ${k.t}.`; if (bad(x[1])) m = m || `Maglagay ng tamang presyo sa ${x[0]}.`; }); }); });
    ED.o.forEach(o => { if (!o.n.trim()) m = m || "Lagyan ng pangalan ang bawat singil."; if (o.k == "fixed") { if (bad(o.p)) m = m || `Ayusin ang presyo ng ${o.n}.`; } else if (o.k == "pct" && (bad(o.p) || o.p > 100)) m = m || `Maglagay ng % (0 hanggang 100) sa ${o.n}.`; });
    if (m) { e.textContent = m; return; }
    persist(ED.c, ED.o, "Na-save! Makikita na ito ng mga customer.");
  };
}

/* ============================================================
   GOOGLE MAPS (opsyonal: kapag may mapsKey sa config.js)
   ============================================================ */
const GM = !!CFG.mapsKey;
let GL = false, gmap, gme, gmk = [], gRt = [];
const dot = (s, c) => ({ path: google.maps.SymbolPath.CIRCLE, scale: s, fillColor: c, fillOpacity: 1, strokeColor: "#fff", strokeWeight: 2 });
window.gm_authFailure = () => { GL = false; $("gm").hidden = true; $("svg").style.display = ""; pins(); };
function loadGM() { return new Promise(r => { if (!GM) return r(false); window.__gm = () => r(true); const s = document.createElement("script"); s.src = "https://maps.googleapis.com/maps/api/js?key=" + encodeURIComponent(CFG.mapsKey) + "&callback=__gm&loading=async"; s.onerror = () => r(false); document.head.appendChild(s); }); }
async function initGM() {
  if (GL || !GM || !await loadGM()) return;
  GL = true; $("svg").style.display = "none"; const el = $("gm"); el.hidden = false;
  gmap = new google.maps.Map(el, { center: C, zoom: 14, disableDefaultUI: true, zoomControl: true, clickableIcons: false, gestureHandling: "greedy" });
  gme = new google.maps.Marker({ position: C, map: gmap, title: "Ikaw", icon: dot(9, "#2F7FE0") });
  BK ? gtrack() : gpins();
}
function gpins() {
  if (!GL) return;
  gmk.forEach(m => m.setMap(null)); gmk = [];
  if (BK) return gtrack();
  const b = new google.maps.LatLngBounds(C);
  list().filter(hasLoc).forEach(t => { const p = { lat: t.lat, lng: t.lng }; b.extend(p); const m = new google.maps.Marker({ position: p, map: gmap, title: t.name, label: { text: ini(t.name)[0], color: "#fff", fontWeight: "700" }, icon: dot(sel && sel.id == t.id ? 16 : 12, "#14378F") }); m.addListener("click", () => pick(t)); gmk.push(m); });
  if (sel && hasLoc(sel)) gmap.panTo({ lat: sel.lat, lng: sel.lng }); else gmap.fitBounds(b, 40);
}
function gClear() { gRt.forEach(x => x.setMap(null)); gRt = []; }
function gtrack() {
  if (!GL) return;
  gClear(); gmk.forEach(m => m.setMap(null)); gmk = [];
  const t = BK.tech; if (!hasLoc(t)) return;
  const p = { lat: t.lat, lng: t.lng };
  gRt.push(new google.maps.Marker({ position: p, map: gmap, label: { text: ini(t.name)[0], color: "#fff", fontWeight: "700" }, icon: dot(15, "#14378F") }));
  if (["accepted", "enroute"].includes(BK.status)) gRt.push(new google.maps.Polyline({ path: [p, C], strokeColor: "#2F7FE0", strokeWeight: 4, strokeOpacity: .7, map: gmap }));
  const b = new google.maps.LatLngBounds(C); b.extend(p); gmap.fitBounds(b, 60);
}

/* ============================================================
   SIMULA
   ============================================================ */
(async () => {
  if (!CONFIGURED) return setupView();
  sb.auth.onAuthStateChange((ev, session) => {
    if (ev == "PASSWORD_RECOVERY") return newPasswordView();
    // setTimeout: iwasang tumawag sa Supabase habang nasa loob ng auth callback
    if (ev == "SIGNED_IN" && session && (!USER || USER.id != session.user.id) && booted) setTimeout(() => enter(session.user));
    if (ev == "SIGNED_OUT" && USER) setTimeout(() => { unsubscribe(); USER = null; authView(); });
  });
  const { data } = await sb.auth.getSession();
  booted = true;
  if (location.hash.includes("type=recovery")) return newPasswordView();
  data.session ? enter(data.session.user) : authView();
})();
