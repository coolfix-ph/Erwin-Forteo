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
