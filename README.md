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

### Planritningsbladet (A4 stående)

Resultatet är ett A4-blad i stående format (1:√2) med ram, rubriken `PLANLÖSNING`, logotyp
och - bara för Polycam-skanningar där riktningen är känd - en kompassros uppe till höger.
Allt utom själva ritningen ritas av kod i `lib/image/brand-floorplan.ts`, aldrig av AI:n.

**Typsnitt.** Kundens sajt använder det licensierade typsnittet Neutra, som vi inte får
leverera med koden. Rubriken och kompassbokstäverna använder i stället Questrial (SIL OFL,
`assets/fonts/Questrial-Regular.ttf`, licens i `assets/fonts/Questrial-OFL.txt`). Texten
omvandlas till SVG-konturer (`lib/image/sheet-font.ts`), så ingen systemfont behövs på servern.

Byta till Neutra när licensen finns:

1. Lägg Neutra-filen (`.ttf` eller `.otf`) i `assets/fonts/`. Checka inte in den om
   licensen förbjuder det - lägg den då på servern vid deploy.
2. Ändra `SHEET_FONT_FILE` i `lib/image/sheet-font.ts` till filnamnet.
3. Har filen ett riktigt fetstilsnitt: sätt `SHEET_FONT_EMBOLDEN_EM` till `0`.
   (Questrial finns bara i normalvikt, så fetstilen görs där med en kontur runt tecknen.)

`next.config.ts` bundlar hela `assets/fonts/` för sidorna som komponerar blad, så ingen mer
ändring behövs. Å, Ä och Ö måste finnas i den nya filen.

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

## Planritning fran Polycam-lank

Pa startsidan kan man i stallet for en bildfil klistra in en lank till en Polycam-skanning
(`https://poly.cam/capture/{id}`). `/api/convert-polycam` hamtar skanningens vaggdata
(`optimized_roomplan.json`, Apples RoomPlan-format), ritar upp en rak planritning i ratt
skala (svarta vaggar, gap for dorrar och oppningar, vita rutor for fonster, ingen text) och
skickar den genom samma AI-steg, ram, sparning och granskning som en uppladdad bild. Den
uppritade planen sparas som originalbild, sa jamforelsereglaget, "neka och rita om" och
radering fungerar som vanligt. En omritning hamtar inte fran Polycam igen.

Begransningar:

- Fungerar bara for skanningar gjorda med LiDAR i Polycams rums- eller planritningslage
  (Space/Floorplan). Andra skanningar saknar planritningsdata och ger ett tydligt fel.
- Skanningen maste vara delad som publik lank. Privata lankar ger felet "privat eller
  felaktig".
- Har skanningen flera vaningar fragar appen vilka som ska ritas innan nagot genereras
  (`POST /api/convert-polycam/inspect` laser bara filen). Varje vald vaning ar en egen
  konvertering och en egen generation; de granskas en i taget. Ej granskade vaningar finns
  bara i webblasarens minne och forsvinner vid omladdning.
- Rumsnamn, inredning och entrepil kommer inte fran skanningen och ritas inte; de laggs till
  i editorn. Saknar skanningen en vagg saknas den aven i planen.
- Polycam har inget publikt API. Hamtningen anvander samma odokumenterade adress som
  Polycams egen delningssida och kan sluta fungera utan forvarning; da far anvandaren ett
  felmeddelande och bilduppladdningen fungerar som vanligt. Servern hamtar aldrig den
  inklistrade texten, bara en adress den bygger sjalv fran skanningens id, och foljer bara
  en omdirigering till Polycams lagring. Skanningens GPS-position (`latLonAlt`) lases aldrig.

Bara planer som skapats fran en lank kan ritas om via `sourceImageId`; de kanns igen pa att
originalbilden ligger under `uploads/polycam-` i lagringen. Det kraver ingen kolumn eller
migration (planer fran innan andringen kan inte ritas om och far klistra in lanken igen).

Lanken sparas i kolumnen `uploaded_images.source_url` nar migrationen
`database/2026-10-14-uploaded-images-source-url.sql` ar kord. Innan dess fungerar allt som
vanligt, lanken sparas bara inte (en varning loggas).

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
- `/api/convert` och `/api/convert-polycam` har `maxDuration = 300`. Kontrollera att Vercel-planen tillater sa langa
  funktionsanrop, annars kapas langa genereringar.
- Supabase anvands for lagring och data, inte for autentisering; inloggning sker med de konfigurerade kontona ovan.
