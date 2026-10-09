# MeeTab 1.1 — პროფილი, Microsoft/Google კალენდარი, Android APK-ის პროექტი

ეს არის **საწყისი ინტეგრირებული პროექტი**, არა უკვე გააქტიურებული Microsoft/Google ანგარიში. გაცემულია ვებკოდი, უსაფრთხო OAuth backend-ის კოდი და Android Studio/GitHub Actions build პროექტი. OAuth-ს ამოქმედებისთვის საჭიროა ორი პროვაიდერის აპ-რეგისტრაცია, საიდუმლოებები და გაშვებული HTTPS backend. აქ განზრახ არ არის ჩაწერილი სხვისი პაროლები ან ყალბი ავტორიზაცია.

## რას იღებ

- `website/` — MeeTab-ის იგივე HTML/CSS/JS გვერდები და ანიმაციები; ზედ ემატება პროფილის ღილაკი, შესვლის ფანჯარა და ოთახის კალენდრის არჩევა.
- `backend/server.js` — Node.js 20+ OAuth authorization code + PKCE; Microsoft Graph და Google Calendar რეალური წაკითხვა/ჩაწერა, კონფლიქტის დამატებითი შემოწმება, მოკლევადიანი ავტორიზაციის ticket და სესიები.
- `android/` — Android Studio Gradle პროექტი. აპი WebViewAssetLoader-ით ასრულებს *APK-ში ჩაშენებულ* ვებვერსიას (`website/`-დან კომპილაციისას). OAuth იხსნება გარე ბრაუზერში, დაბრუნება `meetab://auth?ticket=...` ბმულით. მხარდაჭერა Android 6+.
- `.github/workflows/` — GitHub-ზე ვებსაიტის გამოქვეყნება და დასაყენებელი **debug** APK-ის ავტომატური აგება.

## მნიშვნელოვანი: ორიგინალი ფონტები

ამ გადაცემულ პაკეტში **ფონტის ბინარული ფაილები არ შედის**. ზუსტად იგივე ქართული შრიფტისა და ტექსტის გამოსახულებისთვის შენი ორიგინალი `fonts/PingGeL-Light.otf`, `PingGeL-Regular.otf`, `PingGeL-Medium.otf`, `PingGeL-Bold.otf` ფაილები **შენ თვითონ** დააკოპირე `website/fonts/` საქაღალდეში *სანამ* ვებსაიტს გამოაქვეყნებ ან APK-ს ააგებ. CSS-ის არსებული ანიმაციები და ფერები უცვლელად რჩება.

## 1. Backend

Node.js >=20 სერვერზე (მაგ. Azure App Service / Render / VPS):

```sh
cd backend
# set environment variables from .env.example using host's secret settings
node server.js
```

საჭირო ENV:

- `API_ORIGIN=https://api.yourdomain.com` — backend-ის ნამდვილი საჯარო HTTPS origin (ბოლოში `/` არა).
- `FRONTEND_URL=https://giorgigiorgadze18.github.io/MeeTab/` — GitHub Pages-ის URL; ბოლოდან `/`.
- `MS_CLIENT_ID` / `MS_CLIENT_SECRET` — Microsoft Entra ID App Registration (Web).
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` — Google Cloud OAuth 2.0 Web Application.
- `DATA_ENCRYPTION_KEY` — 32 random byte-ის 64-ნიშნა HEX: `openssl rand -hex 32`. შეინახე მხოლოდ backend secret settings-ში.
- `DATA_FILE` — მუდმივ დისკზე ფაილის გზა. სესიები და OAuth refresh token-ები შიფრირდება AES-256-GCM-ით. თუ Cloud ჰოსტინგის დისკი დროებითია, გადატვირთვისას მომხმარებელს თავიდან შესვლა დასჭირდება. პროდაქშენში უმჯობესია მართული DB/secret store.

Backend-ის `/health` მისამართმა უნდა დააბრუნოს `{ "ok": true }`.

**არ ატვირთო `.env`, secret, keystore ან `meetab-private.enc` GitHub-ზე.** არ გამოაქვეყნო public endpoint OAuth კლიენტების პაროლებით.

## 2. Microsoft / Google OAuth რეგისტრაცია

**Microsoft Entra ID**: შექმენი App registration, supported account types განსაზღვრე (ორგანიზაციები ან პირადი Microsoft ანგარიშები), Redirect URI ტიპით **Web**: `https://api.yourdomain.com/auth/microsoft/callback`. დაამატე Delegated permissions `User.Read`, `Calendars.ReadWrite`, `Calendars.ReadWrite.Shared`, `offline_access`, `openid`, `profile`, `email`. საჭიროების შემთხვევაში IT Admin Consent.

**Google Cloud**: ჩართე Google Calendar API, გააკეთე OAuth consent screen და OAuth Client ტიპით **Web application**. Redirect URI: `https://api.yourdomain.com/auth/google/callback`. scopes გამოიყენება `calendar.events`, `calendar.calendarlist.readonly`, `openid`, `email`, `profile`; ტესტირების რეჟიმში დაამატე test users, ხოლო ფართო გამოყენებისთვის შეიძლება OAuth app verification დაგჭირდეს.

`website/app-config.js` ფაილში მიუთითე backend-ის საჯარო მისამართი:

```js
window.MEETAB_API_BASE = 'https://api.yourdomain.com';
```

Google/Microsoft **შესვლა ხდება სისტემური ბრაუზერით**, არა APK-ის WebView-ის შიგნით; ეს მნიშვნელოვანია Google-ის უსაფრთხოების წესისთვის.

## 3. რომელი კალენდარი ჩანს ეკრანზე?

1. პროფილი → Microsoft ან Google შესვლა.
2. პროფილი → კონკრეტული ოთახის კალენდრის არჩევა სიიდან, ან ID/ელფოსტის ჩაწერა.
3. დაჯავშნა და წაკითხვა ამ **ერთსა და იმავე კალენდარზე** შესრულდება. აპი პერსონალურ კალენდარს *ავტომატურად არ აირჩევს*, რათა შეხვედრის ოთახის ტაბლეტზე სხვისი პირადი შეხვედრები არ გამოჩნდეს.

Microsoft: საკუთარი მთავარი კალენდრის ID `me`; ოთახის რესურსი, მაგალითად `guliskari@ip13.onmicrosoft.com`, იმუშავებს **მხოლოდ** მაშინ, თუ შესულ მომხმარებელს ამ calendar/mailbox-ზე შესაბამისი delegated წვდომა აქვს. ზოგიერთ Microsoft 365 ორგანიზაციაში Room Mailbox-ზე პირდაპირ ჩაწერას ადმინისტრატორის ნებართვა ან სპეციალური backend/service application სჭირდება. Google: `primary` ან ოთახისთვის გაზიარებული Google Calendar ID. ერთი პროვაიდერის ანგარიშით მეორე პროვაიდერის კალენდარს ავტომატურად ვერ წაიკითხავ.

გარე პროვაიდერის მონაცემის შეცვლის უფლება მხოლოდ რეალურად მინიჭებული უფლებებით მოქმედებს. მიმდინარე კოდში `IT დახმარების` გაგზავნა საჭიროებს ცალკე IT webhook-ის გამართვას; ღილაკი აღარ აგზავნის ყალბ წარმატებას.

## 4. ვერსია GitHub Pages-ზე

ატვირთე **მთლიანი პროექტი** GitHub-ის `MeeTab` repository-ში (`website/`, `backend/`, `android/`, `.github/` საქაღალდეებით). `Settings → Pages → Build and deployment → Source: GitHub Actions`, შემდეგ `Actions → Deploy MeeTab website`. ამ workflow-ს საიტი `website/` საქაღალდიდან გამოაქვს. არსებულ GitHub Pages ვებსაიტს *მხოლოდ ამის შემდეგ* შეუცვლის კოდს. ავტორიზაციის backend GitHub Pages-ზე ვერ გაეშვება, მას სჭირდება ზემოთ აღწერილი ცალკე ჰოსტინგი.

## 5. Android APK, ფლეშკა, დაყენება

**GitHub Actions**: იგივე repo-ში `Actions → Build MeeTab Android APK → Run workflow` (ან `main` branch-ზე ატვირთვა). დასრულებულ run-ში `Artifacts` → `MeeTab-Android-installable-debug-apk` → ჩამოტვირთე ZIP; შიგნით იქნება **`app-debug.apk`**. ის არის ხელით დასაყენებელი და შეიცავს ვებფაილებს. თუ აპს backend URL-ით აშენებ, ავტორიზაციაც იმუშავებს რეალური პროვაიდერების გააქტიურების შემდეგ.

ან **Android Studio**: გახსენი `android/` საქაღალდე და `Build → Build APK(s)`; debug APK იდება `android/app/build/outputs/apk/debug/app-debug.apk`.

გადაიტანე `app-debug.apk` USB-ზე → Android-ის File Manager-ით გახსენი → დააჭირე Install; საჭიროების შემთხვევაში ნება დართე **Install unknown apps** კონკრეტულ File Manager-ზე. Android უსაფრთხოების გამო არ აძლევს APK-ს უფლებას, მომხმარებლის დადასტურების გარეშე უბრალოდ „თავისით“ ჩაიდგას. GitHub Actions-ის ახალ გაშვებებზე დროებით გენერირებული **debug signing key შეიძლება შეიცვალოს**, ამიტომ შემდგომი განახლებებისთვის გამოიყენე ერთი და იგივე release signing key. Debug ხელმოწერა განსხვავდება წინა MeeTab.apk-ის ხელმოწერისგან: თუ `App not installed` წერს, საჭიროა ძველი აპის წაშლა ან იმავე წარმოების keystore-ით ახალი APK-ის ხელმოწერა (ძველი აპის წაშლა მის ლოკალურ მონაცემებს შლის). Debug ხელმოწერით განაწილება ტესტირებისთვისაა; ხანგრძლივი საწარმოო გამოყენებისთვის გამოიყენე შენს მიერ დაცული release signing key.

**მნიშვნელოვანი**: ეს გარემო არ შეიცავს Android SDK/Gradle build tools-ს, ამიტომ აქ ახალი APK არ არის აწყობილი/ინსტალაციით შემოწმებული. მოცემულია წყარო + GitHub Actions build ინსტრუქცია. `.apk` სახელით დაუტესტავი ZIP ან ძველი APK არ არის გადაცემული როგორც ახალი აშენებული ვერსია.

## 6. კიოსკის ფუნქციები

აპი fullscreen WebView-ია, ეკრანს არ ათიშავს, აქვს უკანა ღილაკის შეზღუდვა და ზედა მარცხენა კუთხის დიდხანს დაჭერით ადმინისტრატორის ფანჯარა. საწყისი PIN კოდია `2580` — უსაფრთხოების მიზნით **შეცვალე `android/app/src/main/java/ge/evex/meetab/MainActivity.java`-ში**. ეს **სრული Android device-owner lock task არ არის**; მომხმარებელმა სისტემიდან გამოსვლა მაინც შეიძლება. მკაცრი kiosk lock-down მოითხოვს Android Enterprise/MDM provisioning-ს.

## შემოწმების გეგმა

- Profile → Google/Microsoft → გარე ბრაუზერში OAuth → `დაბრუნება MeeTab-ში` → აპში შესული მომხმარებლის სახელი.
- აირჩიე ოთახის კალენდარი → აჩვენოს რეალური შეხვედრები მთავარზე, კალენდარზე და გვერდით პანელზე.
- ახალ 15/30 წუთიან დაჯავშნაზე გადაამოწმე ჩანაწერი Google Calendar/Outlook-ში. დაკავებული დროის დაჯავშნა უნდა დაბრუნდეს შეცდომით.
- App restart/Logout-ის შემდეგ დარწმუნდი, რომ პირადი შეხვედრები გაუფრთხილებლად არ ჩანს. Backend რესტარტზე DB persistence, permission, date/timezone და ქსელიც გადაამოწმე.

### შეზღუდვები

ეს არის რეალური API-ზე დაერთებისთვის მომზადებული ინტეგრაცია, მაგრამ **ჯერ არ არის live OAuth / კალენდრის სატესტო ანგარიშებით end-to-end შემოწმებული**. არ არსებობს არაგამჟღავნებული `CLIENT_ID`, Microsoft tenant admin consent ან Google Calendar calendar ID. საერთო საჯარო ოთახის ტაბლეტისთვის ოპტიმალურია სპეციალური ოთახის ანგარიში და IT-ის მიერ შეთანხმებული delegated/application წვდომა. `Apple ID` შესვლა არ არის დამატებული, რადგან მხოლოდ Apple-ში ავტორიზაცია Google/Microsoft ოთახის კალენდარზე API-წვდომას არ ნიშნავს; ჯერჯერობით მუშაობისთვის მომზადებულია ორი რეალური კალენდრის პროვაიდერი.
