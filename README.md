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
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
# Optional: override Python binary used by local converter
# FLOORPLAN_PYTHON=/absolute/path/to/python
# Optional performance toggles
# FLOORPLAN_ENABLE_UPSCALE=false
# FLOORPLAN_ENABLE_TEXT_REPLACEMENT=true
```

3. Starta utvecklingsservern:

```bash
npm run dev
```

Appen kor pa [http://localhost:3000](http://localhost:3000).

## Floorplanconvert

Konverteringsverktyget i `floorplanconvert` kors direkt lokalt av Next API-routes under `/api/floorplan/*`. Ingen separat Flask-server behovs.

Forutsattningar for lokal konvertering:

- Python 3.10+ installerat
- Python-dependencies i `floorplanconvert` installerade
- Valfritt: satt `FLOORPLAN_PYTHON` i `.env.local` om du vill peka pa en specifik Python-binar
- Prestanda: `FLOORPLAN_ENABLE_UPSCALE=false` ar snabbaste laget (default)
- Hogre kvalitet (langsammare): satt `FLOORPLAN_ENABLE_UPSCALE=true`

## Deploy

- Planerad doman: `skandiamaklarna.outflow.se`
- Satt `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `NEXT_PUBLIC_SUPABASE_URL` och `NEXT_PUBLIC_SUPABASE_ANON_KEY` som Vercel Environment Variables.
- Supabase ar forberett for framtida datahantering och anvands inte for autentisering.
