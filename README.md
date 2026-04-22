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
```

3. Starta utvecklingsservern:

```bash
npm run dev
```

Appen kor pa [http://localhost:3000](http://localhost:3000).

## Deploy

- Planerad doman: `skandiamaklarna.outflow.se`
- Satt `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `NEXT_PUBLIC_SUPABASE_URL` och `NEXT_PUBLIC_SUPABASE_ANON_KEY` som Vercel Environment Variables.
- Supabase ar forberett for framtida datahantering och anvands inte for autentisering.
