# SM-Planritning

Intern adminpanel for att ladda upp och bearbeta gamla planritningar.

## Kom igang

1. Skapa en lokal miljofil:

```bash
cp .env.example .env.local
```

2. Fyll i inloggningsuppgifter i `.env.local`:

```env
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=change-me
SUPERADMIN_EMAIL=owner@example.com
SUPERADMIN_PASSWORD=change-me-too
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
OPENAI_API_KEY=
AUTH_SECRET=
```

`AUTH_SECRET` signerar sessionskuben. Utelamnas den harleds nyckeln ur service-role-nyckeln,
vilket fungerar men binder sessionerna till den. Satt en egen slumpstrang i produktion.

Webblasaren talar aldrig direkt med Supabase. All lasning, uppladdning och bildhamtning gar
via `/api/*`, som kontrollerar sessionen och anvander service-role-nyckeln pa servern.
Anon-nyckeln behover darfor inga rattigheter alls - se `database/2026-09-09-lock-down-anon.sql`.

`ADMIN_EMAIL`/`ADMIN_PASSWORD` loggar in till vanliga panelen.
`SUPERADMIN_EMAIL`/`SUPERADMIN_PASSWORD` loggar in till adminpanelen (`/admin/dashboard`).

3. Starta utvecklingsservern:

```bash
npm run dev
```

Appen kor pa [http://localhost:3000](http://localhost:3000).

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

Efter varje generering matas resultatet mot stilreferenserna av
`lib/image/style-conformance.ts`: bakgrundsfarg, palett, kantutjamning och blackyta. Avviker
den mer an troskeln ritas bilden om en gang, med de uppmatta avvikelserna som instruktion.
Den battre av de tva behalls. En omkorning dubblar bade tiden och kostnaden for den bilden.

Route:n svarar med en handelsestrom (`text/event-stream`) sa att frontend kan visa
AI:ns delbilder medan genereringen pagar. Misslyckas AI-steget slutfors konverteringen
med den gamla algoritmen i stallet for att fela.

## Databasuppdatering (kravs for koppling mellan original och generering)

Kor SQL-filen `database/2026-04-23-generation-source-link.sql` i Supabase SQL Editor.
Den lagger till `source_upload_id` pa `uploaded_images` och en `ON DELETE CASCADE`-koppling,
sa genereringsrader tas bort nar originalbilden tas bort.

## Deploy

- Planerad doman: `skandiamaklarna.outflow.se`
- Satt `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `SUPERADMIN_EMAIL`, `SUPERADMIN_PASSWORD`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `OPENAI_API_KEY` och `AUTH_SECRET` som Vercel Environment Variables.
- Sessionskuben ar signerad sedan 2026-09-09. Vid forsta deploy av den versionen loggas alla
  befintliga sessioner ut en gang - det ar avsett.
- Nar den versionen ar deployad: kor `database/2026-09-09-lock-down-anon.sql` i Supabase SQL
  Editor sa att den publika anon-nyckeln inte langre kan lasa eller skriva nagot.
- `/api/convert` har `maxDuration = 300`. Kontrollera att Vercel-planen tillater sa langa
  funktionsanrop, annars kapas langa genereringar.
- Supabase anvands for lagring och data, inte for autentisering; inloggning sker med de konfigurerade kontona ovan.
