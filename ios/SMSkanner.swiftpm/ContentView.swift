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
    @State private var mesh = MeshCollector()

    var body: some View {
        switch phase {
        case .start:
            StartView(isSupported: RoomCaptureSession.isSupported, onStart: startScan)

        case .scanning:
            ZStack(alignment: .bottom) {
                RoomCaptureScreen(session: mesh.session, stopRequested: stopRequested, onFinish: finish)
                    .ignoresSafeArea()
                // The mesh as a white net over RoomPlan's view (experiment).
                MeshOverlay(session: mesh.session)
                    .ignoresSafeArea()
                    .allowsHitTesting(false)
                // Prototype: whether the LiDAR mesh is there and sees windows, live.
                Text(mesh.status)
                    .font(.caption.monospacedDigit())
                    .padding(.horizontal, 10)
                    .padding(.vertical, 6)
                    .background(.ultraThinMaterial, in: Capsule())
                    .frame(maxHeight: .infinity, alignment: .top)
                    .padding(.top, 8)
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
        mesh.stop()
        mesh = MeshCollector()
        mesh.start()
        phase = .scanning
    }

    private func finish(_ result: Result<CapturedRoom, any Error>) {
        do {
            let summary = mesh.summary()
            // The 3D view is a help only; a scan without it still goes on.
            let model = try? mesh.model()
            mesh.stop()
            phase = .finished(try ScanFiles(room: result.get(), mesh: summary, model: model))
        } catch {
            mesh.stop()
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
                Text("Skanningen är klar")
                    .font(.title2.bold())
                    .padding(.top, 8)
                PlanPreview(scan: files.scan)
                    .frame(height: 320)
                    .frame(maxWidth: .infinity)
                    .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 12))
                Text(files.summary)
                    .foregroundStyle(.secondary)
                if let mesh = files.meshSummary {
                    Text(meshLine(mesh))
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                }
                Text("Saknas något? Gör en ny skanning innan du skickar.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                SendToWebAppView(scanFile: files.plan, roomPlanFile: files.roomPlan, meshFile: files.mesh, modelFile: files.model)
                Text("Eller dela filerna med AirDrop och välj Importera skanning under Skannare. Importera filen som inte slutar på \"-roomplan\".")
                    .font(.footnote)
                    .multilineTextAlignment(.center)
                    .foregroundStyle(.secondary)
                ShareLink(items: [files.plan, files.roomPlan] + [files.model, files.mesh].compactMap { $0 }) {
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

    /// What the LiDAR mesh found (prototype), in one line.
    private func meshLine(_ mesh: MeshSummary) -> String {
        guard mesh.meshAvailable else { return "Mesh: ingen" + (mesh.experiment.map { " (\($0))" } ?? "") }
        let total = mesh.faceCounts.values.reduce(0, +)
        let windows = mesh.faceCounts["window"] ?? 0
        return mesh.classified
            ? "Mesh: \(total.formatted()) ytor, varav \(windows.formatted()) fönster"
            : "Mesh: \(total.formatted()) ytor (utan etiketter)"
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
