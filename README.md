# CoolFix

Aircon at ref technician app: hanapin ang malapit na technician, mag-book, i-track ang pagdating niya, at makipag-chat. May dashboard para sa technician at admin.

- **Website:** `www/` (plain HTML, CSS at JS, walang build step)
- **Backend:** [Supabase](https://supabase.com) (login, database at realtime)
- **Mobile apps:** [Capacitor](https://capacitorjs.com) (`android/` at `ios/`)

## 1. I-set up ang Supabase (isang beses lang)

1. Gumawa ng project sa supabase.com.
2. Sa **SQL Editor**, i-paste ang buong `supabase/schema.sql` at i-Run.
3. Sa **Project Settings → API**, kopyahin ang **Project URL** at ang **anon public** key, tapos ilagay sa `www/config.js`.
   Ligtas na public ang anon key dahil protektado ng Row Level Security ang data. **Huwag kailanman** ilagay ang `service_role` key sa app.
4. Sa **Authentication → URL Configuration**, ilagay ang website URL mo bilang **Site URL**, at idagdag din ito sa **Redirect URLs**. Kailangan ito para sa email confirmation at password reset.
5. Gumawa ng admin. Mag-sign up muna sa app gamit ang email mo, tapos patakbuhin ito sa SQL Editor:

   ```sql
   update public.profiles set role = 'admin'
   where id = (select id from auth.users where email = 'IYONG-EMAIL@example.com');
   ```

**Google login (opsyonal):** I-on ang Google provider sa **Authentication → Providers**, tapos gawing `googleLogin: true` sa `config.js`. Sa website lang ito lalabas; sa app, email login ang gagamitin.

## 2. Website

Awtomatikong nade-deploy ang `www/` sa GitHub Pages tuwing may push sa `main` (`.github/workflows/pages.yml`).
Sa GitHub repo, pumunta sa **Settings → Pages → Source: GitHub Actions**.

**Sariling domain:** Sa **Settings → Pages → Custom domain**, ilagay ang `coollfix.com`. Sa DNS ng domain provider mo, gumawa ng:
- `CNAME` record para sa `www` na nakaturo sa `<username>.github.io`
- `A` records para sa root domain: `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153`

Pagkatapos, idagdag ang bagong domain sa Supabase **Redirect URLs** at gawin itong **Site URL**.

Para subukan sa sariling computer:

```bash
npm install
npm run serve
```

## Installable app (PWA)

Puwedeng i-install ang website bilang app nang libre, nang hindi dumadaan sa Play Store o App Store:
- `www/manifest.webmanifest` at `www/img/icons/`: pangalan, kulay at icon ng app.
- `www/sw.js`: service worker. Hindi nito kina-cache ang Supabase, PayMongo o Google Maps. Laging kinukuha sa internet ang `index.html`, kaya lumalabas agad ang bagong `app.js` kapag pinalitan ang `?v=`. Palitan ang `CACHE` sa `sw.js` kung kailangang burahin ang lahat ng naka-cache.
- `www/pwa.js`: "I-install ang app" na banner. Sa Android, lumalabas ang install prompt ng Chrome. Sa iPhone, may instructions para sa Share → Add to Home Screen. Sa Facebook/Messenger browser, sinasabing buksan muna sa Chrome o Safari.

## 3. Mobile apps (Capacitor)

```bash
npm install
npm run sync      # kinokopya ang www/ papunta sa android/ at ios/
```

- **Android:** `npm run android` (bubuksan ang Android Studio). Gumagawa rin ang GitHub Actions ng debug APK sa bawat push (`.github/workflows/android.yml`), na makukuha sa tab na **Actions → Build Android app → Artifacts**.
- **iPhone:** `npm run ios` (kailangan ng Mac na may Xcode).

### Bago i-submit sa store
- **App icon at splash:** Maglagay ng 1024×1024 PNG sa `assets/icon.png` (at opsyonal na `assets/splash.png`), tapos patakbuhin ang `npx @capacitor/assets generate`. 160×160 lang ang kasalukuyang logo, kaya kulang ito para sa store.
- **Google Play:** gumawa ng developer account ($25, isang beses). Gumawa ng signed release build (`Build → Generate Signed Bundle` sa Android Studio).
- **Apple App Store:** Apple Developer Program ($99 kada taon). Para tanggapin ng Apple, siguraduhing gumagana ang login, booking at lokasyon gamit ang totoong Supabase. Magbigay din ng test account sa review.
- **Privacy Policy:** required ng parehong store at ng Data Privacy Act. Kumokolekta ang app ng pangalan, cellphone, email, address at lokasyon.

## Tests

```bash
npm test
node tests/wallet.js   # wallet, top-up, quote, warranty at rating
```

Sinusubok nito ang buong daloy (sign-up, booking, live status, chat at admin) gamit ang mock ng Supabase. Para sa security rules ng database, tingnan ang mga comment sa `supabase/schema.sql`.

## Mga dapat malaman
- **Bayad at Tech Wallet** (`supabase/006_wallet.sql`): cash o GCash diretso sa technician. Ang commission (default 20%) at booking fee ay awtomatikong ibinabawas sa **wallet credits** ng technician pagka-Natapos ng job. Nagto-top up ang technician sa GCash/Maya ng CoolFix, at inaaprubahan ito ng admin sa tab na **Wallet**. Doon din ang minimum na balance, commission %, warranty at GCash/Maya number. Sa server na kinukuwenta ang presyo, quote, commission at warranty.
- Hindi na nakikita ng technician ang cellphone ng customer, at tinatakpan ang mga cellphone number sa chat. In-app chat ang gamit.
- Nag-a-update ang lokasyon ng technician kada 15 segundo habang naka-online at bukas ang app.
- Nakikita ng sinumang naka-log in ang pangalan, serbisyo at lokasyon ng mga technician. Nakikita lang ng technician ang pangalan, cellphone at address ng customer na may booking o chat sa kanya.

## Notification, paalala, warranty, referral at paulit-ulit na cleaning (017)
- `supabase/017_engagement.sql`: patakbuhin sa SQL Editor. Kailangan ng `pg_net` at `pg_cron` (kusang ina-on ng file).
- **Push notification**: Web Push sa `www/sw.js`. Ang edge function na `supabase/functions/push-send` ang nagpapadala (i-deploy nang naka-off ang "Verify JWT"). Ilagay ang VAPID keys sa `pm_config` (`vapid_public`, `vapid_private`, `vapid_subject`), ang `push_url` ng function, at ang public key sa settings na `push_public`. Huwag i-commit ang private key. Sa iPhone, gumagana lang ito kapag naka-install na sa Home Screen (iOS 16.4 pataas).
- **Paalala**: bawat 5 minuto (`cf_tick`), may abiso 1 araw at 1 oras bago ang schedule.
- **Warranty**: "Humingi ng libreng balik" sa natapos na booking habang may warranty. Libre, walang commission, sa parehong technician. May PDF na resibo.
- **Referral at promo**: ₱50 sa bagong customer at ₱50 sa nag-imbita (palitan sa admin tab na **Promo**). Doon din gumagawa ng promo code. Sagot ng CoolFix ang discount: ibinabalik ito sa wallet ng technician pagka-Natapos.
- **Paulit-ulit na cleaning**: tuwing 3 o 6 na buwan; kusang nagbu-book 3 araw bago ang petsa.
- Test: `node tests/engage.js`
