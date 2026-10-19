# SM Skanner (iOS)

Minimal RoomPlan-app: skanna ett rum med en LiDAR-iPhone och skicka det direkt till webbappen
(under **Skannare**), eller dela det som en fil med AirDrop och importera det under
**Skannare → Importera skanning**.

## Första gången

1. Installera **Xcode** från App Store och öppna det en gång (låt det installera iOS-stödet).
2. **Xcode → Settings → Accounts**: lägg till ditt Apple-ID. Ett gratis konto räcker.
3. På iPhonen: **Inställningar → Integritet och säkerhet → Utvecklarläge** → på (telefonen startar om).
4. Anslut iPhonen med kabel och lås upp den.
5. I Xcode: **File → Open…** och välj mappen `ios/SMSkanner.swiftpm`.
6. Välj appen **SM Skanner** i projektlistan → **Signing & Capabilities** → välj ditt team
   ("Personal Team").
7. Välj din iPhone som mål högst upp och tryck **Run** (⌘R).
8. Första gången vägrar iPhonen öppna appen: **Inställningar → Allmänt → VPN och enhetshantering**
   → lita på ditt utvecklarkonto. Kör igen.

Med ett gratis Apple-ID slutar appen fungera efter 7 dagar — kör den från Xcode igen.
RoomPlan fungerar inte i simulatorn.

## Skanna och skicka

1. **Starta skanning**, gå långsamt runt rummet och rikta kameran mot väggar, dörrar och fönster.
2. Tryck **Klar**. Appen visar vad den hittade (väggar, dörrar, fönster, rum, yta).
3. **Skicka till webbappen**: fyll i webbappens adress, din e-post och ditt lösenord (samma som på
   webben) och tryck på knappen. Planen hamnar under **Skannare** i webbappen (adressen att fylla i
   står också där). Adress och e-post kommer ihåg; lösenordet behövs bara första gången
   (inloggningen sparas i en vecka), eller när den löpt ut.
   - Adressen utan `http://` tolkas som `https://`.
4. Alternativ: **Dela som fil** → AirDrop till datorn. Filerna som skickas:
   - `skanning-….json` — importera den i webbappen, tillsammans med `skanning-…-3d.bin`
     (markera båda i filväljaren) så får planen 3D-skanningen, i verkliga färger.
   - `skanning-…-roomplan.json` — RoomPlans egna rådata, för att kontrollera konverteringen mot
     riktiga skanningar.

### Testa mot en server på ditt eget nätverk

Webbappen körs lokalt med `npm run dev` och nås från telefonen på samma Wi-Fi:

1. Ta reda på datorns adress (Systeminställningar → Wi-Fi → Detaljer, t.ex. `192.168.1.20`).
2. I appen: adress `http://192.168.1.20:3000`, och samma e-post och lösenord som i webbappen.
3. Första gången frågar iPhonen om appen får nå enheter på lokala nätverket: tillåt.
4. Blockerar datorns brandvägg anslutningen: tillåt inkommande för Node.
5. Vill du öppna webbappen i telefonens Safari (`http://192.168.1.20:3000`) fungerar det när
   utvecklingsservern startats om efter att `allowedDevOrigins` lades till i `next.config.ts`.
   Universitetets Wi-Fi (eduroam) släpper oftast inte igenom trafik mellan enheter; använd då
   telefonens internetdelning.

Skanningar lagras först när `database/2026-10-19-lidar-scans.sql` har körts i databasen.

`Info.plist` släpper igenom `http` till lokala adresser; den driftsatta webbappen är `https` och
behöver inget.

### Kontrollera uppladdningen utan telefon

Klienten (`WebAppClient.swift`) kan provas på en Mac mot en LOKAL server:

```bash
WEBAPP_URL=http://localhost:3000 WEBAPP_EMAIL=… WEBAPP_PASSWORD=… \
swiftc -swift-version 6 -default-isolation MainActor ios/SMSkanner.swiftpm/WebAppClient.swift ios/UploadCheck/main.swift -o /tmp/upload-check && /tmp/upload-check
```

Den loggar in, skickar en liten skanning och provar felfallen (fel lösenord, ingen inloggning,
servern nåbar ej, ogiltig skanning). Tre planer skapas under Skannare (en med glasvägg och RoomPlan-data); ta bort dem efteråt.

## Hur det fungerar

- `RoomPlanExport.swift` gör om RoomPlans 3D-data till webbappens format: sett ovanifrån blir
  världens x planets x och världens z planets y (nedåt), i meter. Dörrar, fönster och öppningar
  knyts till närmaste vägg (inom 35 cm). Rumsnamn kommer från RoomPlans rumsindelning (iOS 17+);
  golvytan blir rummets yta bara när skanningen är ett enda rum.
- `ScanPlan.swift` är formatet och geometrin, utan RoomPlan, så den kan kontrolleras på en Mac
  utan Xcode:

```bash
swiftc -swift-version 6 ios/SMSkanner.swiftpm/ScanPlan.swift ios/SMSkanner.swiftpm/MeshSummary.swift ios/ScanPlanCheck/main.swift -o /tmp/scan-check && /tmp/scan-check
```

Formatet beskrivs i `lib/floorplan/scan-import.ts`.
