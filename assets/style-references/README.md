# Stilreferenser

Bilderna i den här mappen skickas med till bildmodellen som **stilreferenser** varje gång en
planritning genereras i `/api/convert`. Modellen ska härma deras ritstil — linjetjocklek,
symboler, typsnitt och detaljnivå — men aldrig deras planlösning.

Reglerna som styr resultatet står i [STILREGLER.md](STILREGLER.md). Avsnittet mellan
`PROMPT:START` och `PROMPT:END` i den filen skickas ordagrant till modellen, så du ändrar
prompten genom att redigera den filen — ingen kod behöver röras.

## Regler för bilderna här

- Lägg **3–6 handplockade** bilder här. Fler kostar pengar utan att förbättra resultatet
  nämnvärt (max 15 används).
- Tillåtna format: `.png`, `.jpg`, `.jpeg`, `.webp`. Max 50 MB per fil.
- Använd färdiga, godkända planritningar som visar exakt den stil ni vill ha.
- Filerna läses i bokstavsordning, så namnge dem `01-…`, `02-…` om ordningen spelar roll.

## Så behandlas de innan de skickas

Bilderna skickas inte i original. `lib/image/ai-floorplan.ts` skalar ned dem till max
1024 px längsta sida och tröskar dem till rent svartvitt. Det gör två saker: den beiga
bakgrunden försvinner så referenserna visar samma svart-på-vitt-linjeritning som modellen
ska producera, och kostnaden hålls nere — varje referensbild debiteras som high fidelity-input.
Sex referenser blir cirka 96 KB totalt efter behandlingen.

## Att tänka på

- Bilderna läses in en gång per serverinstans. Efter att du lagt till eller bytt bild
  måste dev-servern startas om (eller en ny deploy göras) innan ändringen slår igenom.
  Detsamma gäller ändringar i `STILREGLER.md`.
- Mappen ligger utanför `public/`, så bilderna exponeras aldrig publikt. De inkluderas i
  Vercel-bygget via `outputFileTracingIncludes` i `next.config.ts`.
- Utan bilder här fungerar genereringen fortfarande — då styrs stilen enbart av reglerna
  i `STILREGLER.md`.
