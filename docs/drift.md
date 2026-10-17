# Drift av SM-Planritning

För den som driver tjänsten: lansering, användare, fakturering och felsökning.

## Före lansering (en gång)

1. **Byt nycklar.** Skapa nya OpenAI- och Supabase-nycklar; de gamla har synts i chattar.
   Skapa en ny `AUTH_SECRET` med `openssl rand -hex 32` och en `CRON_SECRET` på samma sätt.
2. **Supabase (hostat projekt).**
   - Kör varje fil i `supabase/migrations/` en gång, i namnordning, i SQL Editor (eller
     `supabase link` + `supabase db push`).
   - Skapa en **privat** bucket `planritningar` med filstorleksgräns 50 MB.
   - Authentication → Sign In / Providers: stäng av *Allow new users to sign up*. Konton skapas
     bara av superadmin.
   - Authentication → Rate Limits: alla inloggningar kommer från Vercels servrar, så höj
     gränsen för inloggningar per IP om många mäklare loggar in samtidigt.
   - Kontrollera att planen har dagliga backuper (Pro eller högre) och notera hur man
     återställer.
3. **Vercel.** Skapa projektet på **Pro** (konverteringen behöver upp till 300 s), koppla
   domänen och lägg in alla variabler från `.env.example`. `vercel.json` schemalägger den
   dagliga rensningen kl. 03:00 UTC.
4. **Första superadmin.**

   ```bash
   NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
     node scripts/create-superadmin.mjs admin@firman.se "Förnamn Efternamn"
   ```

   Skriptet skriver ut ett tillfälligt lösenord som byts vid första inloggningen.
5. **Publicera.** Slå ihop `dev` till `main` och driftsätt från `main`.

## Användare

Under **Användare** i adminpanelen:

- **Skapa användare**: namn, e-post och roll. Det tillfälliga lösenordet visas en gång;
  lämna det personligen eller via säker kanal. Mäklaren väljer eget lösenord (minst 10
  tecken) vid första inloggningen.
- **Återställ lösenord**: ger ett nytt tillfälligt lösenord och loggar ut användaren överallt.
- **Inaktivera**: loggar ut direkt och stoppar inloggning. Använd när någon slutar; deras
  planritningar och fakturerade planer finns kvar.
- **Ta bort** fungerar bara för konton utan planritningar eller fakturerade planer.

Fem felaktiga lösenord på 15 minuter spärrar e-postadressen i 15 minuter.

## Utvecklarkonto

Det finns ett enda konto för oss som utvecklar: det ser **användning och kostnader** men aldrig
planritningar, adresser eller bilder.

- Skapas bara med skriptet, aldrig i Användare, och bara ett får finnas (databasen stoppar ett
  andra): `node scripts/create-superadmin.mjs <e-post> "<namn>" --dev`. Lösenordet byts vid
  första inloggningen, som för alla andra.
- Superadmin ser inte kontot i listan och kan inte ändra eller ta bort det.
- Sidan **/dev** visar för innevarande månad vad som fakturerats, antal AI-omgörningar mot
  kvoten, en **uppskattad** AI-kostnad och marginalen, per mäklare och för de senaste sex
  månaderna, samt lagring. Kostnaden är antal omgörningar gånger `AI_COST_PER_GENERATION_SEK`
  (standard 4 kr); OpenAI:s egen faktura är det som gäller.
- Kontot kan inte använda mäklarnas sidor eller något annat i API:et.

## Fakturering

- Varje **Slutför** kostar `PLAN_PRICE_SEK` (standard 50 kr), även när en plan slutförs igen
  efter ändringar. Tomma planer och skanningar kostar lika mycket när de slutförs; själva
  AI-omritningen kostar inget extra.
- **Fakturering** visar dag, vecka eller månad i svensk tid. Superadmin ser alla mäklare och en
  summa per mäklare; en mäklare ser sina egna.
- Ändrat pris gäller nya slutföranden; redan registrerade behåller sitt pris.

## AI-kvot

`AI_MONTHLY_CAP` (standard 1000) är hela firmans AI-omritningar per kalendermånad. När taket
nås får mäklaren ett meddelande; tomma planritningar och skanningar fungerar som vanligt. Höj
värdet i Vercel och driftsätt om. Sätt också en utgiftsgräns hos OpenAI.

## Flera filer vid uppladdning

Många planritningar kan laddas upp på en gång under **Uppladdningar** eller genom att släppa flera
filer på konverteraren. De laddas upp tre åt gången (varje fil för sig, så ett fel stoppar inte
resten) och dyker upp i listan med uppladdningar. Konverteringen görs en planritning i taget.

## Lagring och integritet

- Uppladdade original raderas automatiskt efter 90 dagar. Planritningar gjorda av dem finns
  kvar; i Uppladdningar står att originalet raderats.
- Mäklare kan radera sina egna planritningar och uppladdningar. Raderingen tar bort filerna
  och all data om planen.
- En begäran om radering enligt GDPR: radera personens planritningar i adminpanelen och
  inaktivera eller ta bort kontot.

## Felsökning

- **Loggar**: Vercel → projektet → Logs. Fel från servern loggas utan personuppgifter.
- **"Du är utloggad"**: sessionen har gått ut (7 dagar), lösenordet har bytts eller kontot är
  inaktiverat.
- **"Månadens AI-kvot är slut"**: se AI-kvot.
- **"Det gick inte att rita om planritningen just nu"**: OpenAI svarade inte i tid eller gav
  fel. Försök igen; kvarstår felet, se OpenAI:s statussida och Vercel-loggarna.
- **"Bilden är för stor"**: bilder krymps i webbläsaren; kommer felet ändå, be om en mindre
  bild eller en skärmdump.
- **Rensningen**: Vercel → Settings → Cron Jobs visar senaste körningen.
