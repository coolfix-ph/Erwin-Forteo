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
  if (standalone) return; // naka-install na
  const ios = /iphone|ipad|ipod/i.test(ua) || (N.platform === "MacIntel" && N.maxTouchPoints > 1);
  const android = /android/i.test(ua);
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
  W.CoolFixInstall = install; // para sa ibang button kung kailangan
})();
