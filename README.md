# SM-Planritning

Intern panel for att ladda upp och bearbeta planritningar - grunden for en skanner som gor
planritningar fran LiDAR-skanningar. Se [ROADMAP.md](ROADMAP.md) for planen.

## Kom igang

1. Installera beroenden:

```bash
npm install
```

2. Skapa `.env.local` (git ignorerar den) fran `.env.example`. Alla variabler beskrivs dar.
   `AUTH_SECRET` signerar sessionskakan; satt en egen slumpstrang (`openssl rand -hex 32`).

Varje maklare har ett eget konto (Supabase Auth). Superadmin skapar konton under
**Anvandare** med ett tillfalligt losenord som byts vid forsta inloggningen. Den forsta
superadmin skapas med skriptet:

```bash
NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/create-superadmin.mjs <epost> "<namn>"
```

En maklare ser bara sina egna planritningar. Superadmin ser och raderar allas, men redigerar
och slutfor inga. Webblasaren talar aldrig direkt med Supabase: allt gar via `/api/*`, som
kontrollerar sessionen och agaren och anvander service-role-nyckeln pa servern.

3. Starta utvecklingsservern mot det hostade projektet:

```bash
npm run dev
```

Appen kor pa [http://localhost:3000](http://localhost:3000).

## Lokal Supabase i Docker (for test)

Testa mot en lokal Supabase i stallet for det hostade projektet. Kraver Docker och
Supabase CLI.

```bash
supabase start
npm run dev:local
```

- `supabase start` skapar tabellerna fran `supabase/migrations/` och bucketen `planritningar`.
- Portarna ar 563xx (API `56321`, databas `56322`, Studio [http://127.0.0.1:56323](http://127.0.0.1:56323))
  sa att projektet kan kora samtidigt som andra lokala Supabase-projekt.
- `npm run dev:local` laser `.env.docker.local` (git ignorerar den) fore `.env.local`. Den ska
  innehalla `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:56321` och `SUPABASE_SERVICE_ROLE_KEY`
  ("Secret" fran `supabase status`). Skapa en lokal superadmin med skriptet ovan.

- Ovriga variabler (t.ex. `OPENAI_API_KEY`) tas fran `.env.local`. Bildgenerering kostar
  aven lokalt.
- Next.js tillater bara en dev-server per mapp: kor `dev` eller `dev:local`, inte bada.
- `supabase db reset` tommer den lokala databasen och bygger om den.

## Bildgenerering

`/api/convert` ritar om uppladdade planritningar med OpenAI:s bild-API
(`POST /v1/images/edits`) och komponerar sedan resultatet pa den beiga canvasen med
logotyp och ram via `sharp`. Bilderna i `assets/style-references/` skickas med som
stilreferenser - se `assets/style-references/README.md`.

Miljovariabler:

| Variabel | Standard | Beskrivning |
| --- | --- | --- |
| `OPENAI_API_KEY` | - | Kravs for AI-motorn. Saknas den korrs den gamla algoritmen. |
| `OPENAI_IMAGE_MODEL` | `gpt-image-2` | Aven `gpt-image-1.5`, `gpt-image-1`, `gpt-image-1-mini`. |
| `OPENAI_IMAGE_QUALITY` | `medium` | `low`, `medium`, `high` eller `auto`. Styr kostnad och kvalitet. |
| `IMAGE_ENGINE` | `ai` nar nyckel finns | Satt till `algorithm` for att tvinga fram den gamla sharp-pipen. |
| `STYLE_DEVIATION_THRESHOLD` | `0.25` | Hur mycket resultatet far avvika fran stilreferenserna innan det ritas om en gang. |
| `OPENAI_IMAGE_RETRY_MODEL` | `gpt-image-1.5` | Modellen som ritar om nar forsta forsoket avviker fran stilen. |
| `STYLE_REVIEW_ENABLED`, `STYLE_REVIEW_MODEL`, `STYLE_REVIEW_TRIGGER` | se koden | Visuell granskning mot stilreferenserna. |
| `AI_MONTHLY_CAP` | `1000` | Hela firmans AI-omritningar per manad. Nar taket nas stoppas AI med ett meddelande. |

Efter varje generering matas resultatet mot stilreferenserna av
`lib/image/style-conformance.ts`: bakgrundsfarg, palett, kantutjamning och blackyta. Avviker
den mer an troskeln ritas bilden om en gang, med de uppmatta avvikelserna som instruktion.
Den battre av de tva behalls. En omkorning dubblar bade tiden och kostnaden for den bilden.

Route:n svarar med en handelsestrom (`text/event-stream`) sa att frontend kan visa
AI:ns delbilder medan genereringen pagar. Misslyckas AI-steget far maklaren ett felmeddelande;
ingen sampre algoritmbild sparas som planritning.

## Databas

Schemat finns i `supabase/migrations/`. Lokalt kors det automatiskt av `supabase start`.
For ett nytt hostat projekt: kor varje fil i `supabase/migrations/` en gang, i namnordning, i
Supabase SQL Editor (eller `supabase link` + `supabase db push`) och skapa en privat bucket
som heter `planritningar`. Kommer det en ny fil: kor bara den.

Andra aldrig en migration som redan ar kord - lagg till en ny tidsstamplad fil i
`supabase/migrations/`. Filerna i `database/` ar historik fran `planritning` och ingar
redan i init-migrationen.

## Fakturering och lagring

- Varje **Slutfor** debiteras `PLAN_PRICE_SEK` (standard 50 kr), aven nar en plan slutfors igen.
  Raderna i `billing_events` andras aldrig. Perioder raknas i svensk tid.
- Uppladdade original raderas efter 90 dagar av ett dagligt jobb (`/api/cron/purge-uploads`,
  skyddat av `CRON_SECRET`). Fardiga planritningar sparas tills de raderas.

## Deploy

Se [docs/drift.md](docs/drift.md) for checklistan fore lansering och den dagliga driften.

- Vercel Pro (konverteringen behover upp till 300 s). `vercel.json` schemalagger rensningen.
- Satt alla variabler fran `.env.example` som Vercel Environment Variables.
- Kor migrationerna i `supabase/migrations/` pa det hostade projektet, i namnordning.
