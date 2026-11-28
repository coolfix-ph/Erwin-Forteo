// CoolFix PWA: service worker at "I-install ang app" na banner (Android at iPhone).
(function () {
  const W = window, N = navigator, D = document;
  const native = !!(W.Capacitor && W.Capacitor.isNativePlatform && W.Capacitor.isNativePlatform());
  if (native) return; // nasa Android/iOS app na mismo

  if ("serviceWorker" in N && (location.protocol === "https:" || location.hostname === "localhost")) {
    W.addEventListener("load", () => N.serviceWorker.register("sw.js").catch(() => { }));
  }

  const ua = N.userAgent || "";
  const standalone = W.matchMedia("(display-mode: standalone)").matches || N.standalone === true;
  const ios = /iphone|ipad|ipod/i.test(ua) || (N.platform === "MacIntel" && N.maxTouchPoints > 1);
  const android = /android/i.test(ua);
  // Bilang ng install para sa admin (016_app_installs.sql). Isang beses lang kada device at paraan.
  // Sa iPhone, walang install event, kaya nabibilang lang ito kapag binuksan na mula sa home screen.
  const logging = {};
  function logInstall(via) {
    try {
      const done = "cf_inst_" + via; if (logging[via] || localStorage.getItem(done)) return; logging[via] = 1;
      let dev = localStorage.getItem("cf_dev");
      if (!dev) { dev = (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 12)); localStorage.setItem("cf_dev", dev) }
      const C = W.COOLFIX_CONFIG || {}; if (!C.supabaseUrl || !C.supabaseAnonKey) return;
      fetch(C.supabaseUrl.replace(/\/$/, "") + "/rest/v1/rpc/log_install", {
        method: "POST", keepalive: true,
        headers: { "content-type": "application/json", apikey: C.supabaseAnonKey },
        body: JSON.stringify({ p_device: dev, p_platform: ios ? "iphone" : android ? "android" : "desktop", p_via: via })
      }).then(r => { if (r.ok) localStorage.setItem(done, Date.now()); else logging[via] = 0 }).catch(() => { logging[via] = 0 });
    } catch (e) { }
  }
  W.addEventListener("appinstalled", () => logInstall("install"));
  if (standalone) { logInstall("open"); return } // naka-install na
  const mac = /Macintosh/.test(ua) && !ios;
  const inapp = /FBAN|FBAV|FB_IAB|Instagram|Line\/|MicroMessenger|TikTok|; wv\)/i.test(ua);
  const KEY = "cf_pwa_x", DAYS = 7;
  const snoozed = () => { const t = +localStorage.getItem(KEY) || 0; return Date.now() - t < DAYS * 864e5 };
  let deferred = null, bar = null;

  const SHARE = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="vertical-align:-3px"><path d="M12 3v12M7 8l5-5 5 5"/><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/></svg>';
  const PLUS = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true" style="vertical-align:-3px"><rect x="3" y="3" width="18" height="18" rx="4"/><path d="M12 8v8M8 12h8"/></svg>';

  function hide(snooze) { if (bar) { bar.remove(); bar = null } if (snooze) localStorage.setItem(KEY, Date.now()) }

  function steps() {
    const d = D.createElement("div"); d.className = "sheet-bg";
    let body;
    if (inapp) body = `<h2 id="pwt">Buksan muna sa browser</h2><p class="mute">Hindi puwedeng mag-install mula sa loob ng Facebook o Messenger.</p><ol class="pws"><li>Pindutin ang <b>⋯</b> o <b>⋮</b> sa itaas.</li><li>Piliin ang <b>${ios ? "Open in Safari" : "Open in Chrome"}</b> (o “Buksan sa browser”).</li><li>Sa ${ios ? "Safari" : "Chrome"}, pindutin ulit ang <b>I-install ang app</b>.</li></ol>`;
    else if (ios) body = `<h2 id="pwt">I-install sa iPhone</h2><ol class="pws"><li>Pindutin ang <b>Share</b> ${SHARE} sa ibaba (o sa itaas) ng Safari.</li><li>Mag-scroll pababa at piliin ang <b>Add to Home Screen</b> ${PLUS}.</li><li>Pindutin ang <b>Add</b> sa kanang itaas.</li></ol><p class="mute">Lalabas ang CoolFix icon sa home screen mo, at bubukas ito na parang app.</p>`;
    else if (!android && /Firefox\//.test(ua)) body = `<h2 id="pwt">Buksan sa Chrome o Edge</h2><p class="mute">Hindi pa kayang mag-install ng app ang Firefox. Buksan ang <b>coollfix.com</b> sa Google Chrome o Microsoft Edge, tapos pindutin ulit ang <b>I-download ang app</b>.</p>`;
    else if (!android && mac && /Safari\//.test(ua) && !/Chrome|Chromium|Edg\//.test(ua)) body = `<h2 id="pwt">I-install sa Mac</h2><ol class="pws"><li>Sa menu sa itaas, piliin ang <b>File</b>.</li><li>Piliin ang <b>Add to Dock…</b></li><li>Pindutin ang <b>Add</b>.</li></ol><p class="mute">Lalabas ang CoolFix sa Dock at sa Launchpad.</p>`;
    else if (!android) body = `<h2 id="pwt">I-install sa computer</h2><ol class="pws"><li>Hanapin ang install icon <b>⊕</b> sa kanan ng address bar, o pindutin ang <b>⋮</b> (o <b>⋯</b> sa Edge) sa kanang itaas.</li><li>Piliin ang <b>Install CoolFix</b> (o <b>Cast, save, and share → Install page as app</b>).</li><li>Pindutin ang <b>Install</b>.</li></ol><p class="mute">Bubukas ang CoolFix sa sarili nitong window, at may icon ito sa desktop at Start menu.</p>`;
    else body = `<h2 id="pwt">I-install sa Android</h2><ol class="pws"><li>Pindutin ang <b>⋮</b> sa kanang itaas ng Chrome.</li><li>Piliin ang <b>Add to Home screen</b> o <b>Install app</b>.</li><li>Pindutin ang <b>Install</b>.</li></ol>`;
    d.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="pwt"><img src="img/icons/icon-192.png" alt="" width="72" height="72" style="border-radius:18px;margin-bottom:8px">${body}<button class="btn ob-go" id="pwok">Sige</button></div>`;
    D.body.appendChild(d);
    const close = () => d.remove();
    d.addEventListener("click", e => { if (e.target === d || e.target.id === "pwok") close() });
  }

  async function install() {
    if (deferred) {
      deferred.prompt();
      const r = await deferred.userChoice.catch(() => ({}));
      deferred = null;
      hide(r.outcome !== "accepted");
    } else steps();
  }

  function show() {
    if (bar || snoozed()) return;
    bar = D.createElement("div"); bar.className = "pwa"; bar.setAttribute("role", "region"); bar.setAttribute("aria-label", "I-install ang app");
    bar.innerHTML = `<img src="img/icons/icon-192.png" alt="" width="44" height="44"><div class="pwt"><b>I-install ang CoolFix app</b><small>Libre. Bukas agad mula sa home screen mo.</small></div><button class="pwi" id="pwi" type="button">I-install</button><button class="pwx" id="pwx" type="button" aria-label="Isara">✕</button>`;
    D.body.appendChild(bar);
    bar.querySelector("#pwi").onclick = install;
    bar.querySelector("#pwx").onclick = () => hide(true);
  }

  W.addEventListener("beforeinstallprompt", e => { e.preventDefault(); deferred = e; setTimeout(show, 1500) });
  W.addEventListener("appinstalled", () => { deferred = null; hide(true) });
  // iPhone at in-app browser: walang beforeinstallprompt, kaya instructions ang ipapakita
  if (ios || (android && inapp)) W.addEventListener("load", () => setTimeout(show, 4000));
  // Laging nakikitang "I-download ang app" na button sa header
  const DL = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12M7 10l5 5 5-5"/><path d="M5 19h14"/></svg>';
  function addBtn() {
    const hd = D.querySelector("header"); if (!hd || D.getElementById("pwdl")) return;
    const b = D.createElement("button"); b.type = "button"; b.id = "pwdl"; b.className = "chip pwdl";
    b.innerHTML = `${DL}<span class="pwl">I-download ang app</span><span class="pws2">App</span>`;
    b.onclick = install;
    const who = D.getElementById("who");
    if (who) who.after(b); else hd.appendChild(b);
  }
  if (D.readyState === "loading") D.addEventListener("DOMContentLoaded", addBtn); else addBtn();
  W.addEventListener("appinstalled", () => { const b = D.getElementById("pwdl"); if (b) b.remove() });
  W.CoolFixInstall = install; // para sa ibang button kung kailangan
})();
