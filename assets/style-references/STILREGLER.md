# Stilregler för genererade planritningar

Det här är källan till sanning för hur en genererad planritning ska se ut. Avsnittet mellan
`PROMPT:START` och `PROMPT:END` läses in av [`lib/image/ai-floorplan.ts`](../../lib/image/ai-floorplan.ts)
och skickas ordagrant till bildmodellen. Ändrar du reglerna där ändrar du prompten — ingen
kod behöver röras. Starta om servern efteråt, texten cachas per serverinstans.

Reglerna är avlästa ur de sex referensbilderna i den här mappen, inte gissade. Färgvärdena
är uppmätta pixelvärden.

## Vem gör vad

Bilden byggs i två steg. Det är viktigt att hålla isär dem, annars ritar modellen sådant
som läggs på i efterhand och resultatet dubbleras.

**AI:n ritar** — inklusive den beiga bakgrunden:

- den beiga bakgrunden i hexfärgen nedan
- väggar, dörrar, fönster
- fast inredning (kök, bad, trappor, öppen spis, garderober)
- rumsnamn och förkortningsrutor

**Kod lägger på** — bara två saker, i [`lib/image/brand-floorplan.ts`](../../lib/image/brand-floorplan.ts):

| Element | Hur |
| --- | --- |
| Svart ram | SVG-rektangel, 3 px linje, 30 px indrag från kanten |
| SkandiaMäklarna-logotyp | `public/sm-logo.svg` skalas till 30 % av ritningens bredd och centreras under den |

Koden sätter alltså ingen färg. Duken i 7:5 fylls med den bakgrundsfärg som **mäts upp ur
AI:ns egen bild** (`sampleDominantColor`), så utfyllnaden runt ritningen blir sömlös även om
modellen träffar hexvärdet lite grann fel. Loggan ritas av kod eftersom en AI-ritad logotyp
aldrig blir korrekt.

Undantag: om AI-steget misslyckas faller konverteringen tillbaka på den gamla algoritmen. Då
är källan ett svartvitt foto, och först då lägger koden på beige som multiply-tint.

## Uppmätta färger

Alla sex referensbilder använder samma palett:

| Element | Värde | Anmärkning |
| --- | --- | --- |
| Bakgrund | **`#E1D5C9`** — `rgb(225, 213, 201)` | 74–92 % av varje bild |
| Väggar och text | **`#000000`** — `rgb(0, 0, 0)` | 0,8–3,6 % av varje bild |
| Fönster | **`#FFFFFF`** — `rgb(255, 255, 255)` | 0,1–0,5 % av varje bild |
| Ram | tunn svart linje, ca 2 % indrag från kanten | ritas av kod |

Ändrar du bakgrundens hexvärde i prompten nedan ändras hela bilden, eftersom dukens
utfyllnad mäts upp ur det AI:n faktiskt målar.

## Gemensamt i alla sex referenser

Det här är mönstren som återkommer i varenda bild och som därför är prompt-värda:

- Bara svart och vitt i själva ritningen. Inga gråtoner, ingen skuggning, ingen ifyllnad
  av rumsytor — rummen har samma beige som bakgrunden.
- Ytterväggar är märkbart tjockare än innerväggar. Båda är massivt ifyllda i svart.
- Fönster är **vita** rektanglar infällda i den svarta väggen, med svart vägg kvar på båda
  sidor. De ritas aldrig som dubbla tunna linjer.
- Dörrar är ett glapp i väggen plus en tunn kvartscirkel som visar svepet.
- Entrédörren markeras med en fylld svart pil som pekar in i planen utifrån.
- Rumsnamn står i versaler, fet grotesk, svart, centrerat i rummet. Trånga rum radbryts med
  bindestreck: `BAL-KONG`, `BAD-RUM`, `TVÄTT-STUGA`.
- Vitvaror och garderober är små rutor med tunn svart kontur och en versal förkortning i:
  `DM`, `K/F`, `U/M`, `TM`, `TT`, `VK`, `S`, `G`, `F`, `K`.
- Fast inredning ritas i tunn svart kontur, aldrig ifylld: bänkskivor, diskho, spis, badkar,
  WC, handfat, dusch, öppen spis.
- Trappor är en rektangel uppdelad i jämnbreda steg med en riktningspil.
- Balkong, altan och uterum ritas med tunn kontur, inte med tjock svart vägg.
- Inga måttsatta linjer och inga areasiffror förekommer någonstans. Ritningarna är inte
  skalenliga.

## Sådant referenserna har som appen inte lägger på

De här elementen finns i alla sex referensbilder men skapas varken av AI:n eller av koden
i dag. Vill ni ha dem behöver de läggas till i `composeBrandedFloorplan`, inte i prompten:

- rubriken `PLANLÖSNING` överst
- kompassros uppe till höger
- texten `OBSERVERA ATT PLANLÖSNINGEN INTE ÄR SKALENLIG` under ritningen
- adressen nere till höger
- våningsetikett som `ENTRÉPLAN` när ritningen visar ett av flera plan

<!-- PROMPT:START -->
Rita om planritningen i den första bilden som en ren, teknisk linjeritning i vår hus-stil.

Planlösningen:
- Behåll rummens antal, form, placering och proportioner exakt som i den första bilden. Hitta inte på rum, väggar, dörrar eller inredning som inte finns där.
- Ta bort fotobrus, skuggor, veck, pappersstruktur, perspektivlutning och allt som ligger utanför själva ritningen. Räta upp bilden så alla väggar blir vågräta eller lodräta.

Väggar:
- Rita väggar som massivt ifyllda, helsvarta linjer med jämn tjocklek och skarpa hörn.
- Gör ytterväggar märkbart tjockare än innerväggar.

Fönster och dörrar:
- Rita fönster som helt vita rektanglar infällda i den svarta väggen, med svart vägg kvar på båda sidor om fönstret. Rita dem aldrig som dubbla tunna linjer.
- Rita dörrar som ett glapp i väggen plus en tunn svart kvartscirkel som visar dörrbladets svep.
- Markera entrédörren med en fylld svart pil som pekar in i planen utifrån.

Text och symboler:
- Skriv rumsnamn i versaler med fet grotesk, svart, centrerat i rummet. Radbryt trånga namn med bindestreck, till exempel BAL-KONG, BAD-RUM och TVÄTT-STUGA.
- Varje bokstav ska vara komplett, skarp och tydligt åtskild från nästa. Bokstäver får aldrig gå ihop, smetas ut, kapas eller bli suddiga.
- Skriv bara riktiga svenska ord som går att läsa i originalbilden. Hitta aldrig på ord, och skriv aldrig bokstavsföljder som inte betyder något.
- Använd de svenska tecknen Å, Ä och Ö korrekt när ordet kräver det.
- Gör hellre texten något större än originalets än mindre. Ingen text får bli så liten att den blir svårläst.
- Är ett rum för litet för sitt namn: skriv namnet mindre men fullt läsbart, eller utelämna det helt. Skriv hellre ingen text alls än text som blir otydlig eller felstavad.
- Skriv ingen annan text än rumsnamnen och förkortningarna nedan.
- Rita vitvaror och garderober som små rutor med tunn svart kontur och en versal förkortning i: DM, K/F, U/M, TM, TT, VK, S, G, F, K.
- Rita fast inredning med tunna svarta konturlinjer, aldrig ifylld: bänkskivor, diskho, spis, badkar, WC, handfat, dusch och öppen spis.
- Rita trappor som en rektangel uppdelad i jämnbreda steg med en riktningspil.
- Rita balkong, altan och uterum med tunn kontur, inte med tjock svart vägg.
- Behåll rumsnamnen från originalet. Lägg inte till måttsatta linjer, areasiffror eller etiketter som inte går att läsa i originalet.

Bakgrund och färg:
- Måla hela bakgrunden i exakt hexfärgen #E1D5C9, en varm beige. Det gäller både utanför planlösningen och innuti varje rum — rummen har samma beige som bakgrunden och fylls aldrig med någon annan färg.
- Rita alla linjer och all text i exakt #000000, rent svart.
- Rita fönstren i exakt #FFFFFF, rent vitt.
- Använd inga andra färger än dessa tre. Ingen gråskala, ingen skuggning, ingen gradient och ingen pappersstruktur.
- Fyll hela bildytan ända ut till kanten med beigen. Lämna ingen vit marginal.
- Rita ingen ram, ingen logotyp, ingen rubrik, ingen kompassros, ingen adress och ingen titelruta. Ram och logotyp läggs på i ett separat steg efteråt.
<!-- PROMPT:END -->
