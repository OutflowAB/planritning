import RoomPlan
import SwiftUI

struct ContentView: View {
    private enum Phase {
        case start
        case scanning
        case finished(ScanFiles)
        case failed(String)
    }

    @State private var phase = Phase.start
    @State private var stopRequested = false

    var body: some View {
        switch phase {
        case .start:
            StartView(isSupported: RoomCaptureSession.isSupported, onStart: startScan)

        case .scanning:
            ZStack(alignment: .bottom) {
                RoomCaptureScreen(stopRequested: stopRequested, onFinish: finish)
                    .ignoresSafeArea()
                Button(stopRequested ? "Bearbetar…" : "Klar") {
                    stopRequested = true
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
                .disabled(stopRequested)
                .padding(.bottom, 32)
            }

        case .finished(let files):
            ResultView(files: files, onNewScan: startScan)

        case .failed(let message):
            MessageView(title: "Skanningen misslyckades", message: message, action: "Försök igen", onAction: startScan)
        }
    }

    private func startScan() {
        stopRequested = false
        phase = .scanning
    }

    private func finish(_ result: Result<CapturedRoom, any Error>) {
        do {
            phase = .finished(try ScanFiles(room: result.get()))
        } catch {
            phase = .failed(error.localizedDescription)
        }
    }
}

private struct StartView: View {
    let isSupported: Bool
    let onStart: () -> Void

    var body: some View {
        if isSupported {
            VStack(spacing: 24) {
                Spacer()
                Text("SM Skanner")
                    .font(.largeTitle.bold())
                Text("Gå långsamt runt i rummet och rikta kameran mot väggar, dörrar och fönster. Tryck Klar när hela rummet är inringat.")
                    .multilineTextAlignment(.center)
                    .foregroundStyle(.secondary)
                Spacer()
                Button("Starta skanning", action: onStart)
                    .buttonStyle(.borderedProminent)
                    .controlSize(.large)
            }
            .padding(32)
        } else {
            MessageView(
                title: "LiDAR saknas",
                message: "Skanningen kräver en iPhone Pro eller iPad Pro med LiDAR-sensor.",
                action: nil,
                onAction: {}
            )
        }
    }
}

private struct ResultView: View {
    let files: ScanFiles
    let onNewScan: () -> Void

    var body: some View {
        ScrollView {
            VStack(spacing: 24) {
                Image(systemName: "checkmark.circle")
                    .font(.system(size: 56))
                    .foregroundStyle(.tint)
                    .padding(.top, 24)
                Text("Skanningen är klar")
                    .font(.title2.bold())
                Text(files.summary)
                    .foregroundStyle(.secondary)
                SendToWebAppView(scanFile: files.plan)
                Text("Eller dela filerna med AirDrop och välj Importera skanning under Skannare. Importera filen som inte slutar på \"-roomplan\".")
                    .font(.footnote)
                    .multilineTextAlignment(.center)
                    .foregroundStyle(.secondary)
                ShareLink(items: [files.plan, files.roomPlan]) {
                    Label("Dela som fil", systemImage: "square.and.arrow.up")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
                .controlSize(.large)
                Button("Ny skanning", action: onNewScan)
            }
            .padding(32)
        }
        .scrollDismissesKeyboard(.interactively)
    }
}

private struct MessageView: View {
    let title: String
    let message: String
    let action: String?
    let onAction: () -> Void

    var body: some View {
        VStack(spacing: 16) {
            Text(title)
                .font(.title2.bold())
            Text(message)
                .multilineTextAlignment(.center)
                .foregroundStyle(.secondary)
            if let action {
                Button(action, action: onAction)
                    .buttonStyle(.borderedProminent)
            }
        }
        .padding(32)
    }
}
