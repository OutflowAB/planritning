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
```

`ADMIN_EMAIL`/`ADMIN_PASSWORD` loggar in till vanliga panelen.
`SUPERADMIN_EMAIL`/`SUPERADMIN_PASSWORD` loggar in till adminpanelen (`/admin/dashboard`).

3. Starta utvecklingsservern:

```bash
npm run dev
```

Appen kor pa [http://localhost:3000](http://localhost:3000).

## Databasuppdatering (kravs for koppling mellan original och generering)

Kor SQL-filen `database/2026-04-23-generation-source-link.sql` i Supabase SQL Editor.
Den lagger till `source_upload_id` pa `uploaded_images` och en `ON DELETE CASCADE`-koppling,
sa genereringsrader tas bort nar originalbilden tas bort.

## Deploy

- Planerad doman: `skandiamaklarna.outflow.se`
- Satt `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `SUPERADMIN_EMAIL`, `SUPERADMIN_PASSWORD`, `NEXT_PUBLIC_SUPABASE_URL` och `NEXT_PUBLIC_SUPABASE_ANON_KEY` som Vercel Environment Variables.
- Supabase ar forberett for framtida datahantering och anvands inte for autentisering.
