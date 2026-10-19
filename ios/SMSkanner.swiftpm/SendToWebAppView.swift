import SwiftUI

/// "Skicka till webbappen": the address, e-post and lösenord of the realtor's web account, and a
/// button that sends the finished scan there. The address and e-post are remembered; the
/// password is not, since the login itself is kept after the first send.
struct SendToWebAppView: View {
    let scanFile: URL
    /// RoomPlan's own data, sent along so a scan that came out wrong can be looked into.
    var roomPlanFile: URL? = nil
    /// What the LiDAR mesh labelled (prototype).
    var meshFile: URL? = nil
    /// The whole mesh, for the 3D view.
    var modelFile: URL? = nil

    @AppStorage("webAppAddress") private var address = ""
    @AppStorage("webAppEmail") private var email = ""
    @State private var password = ""
    /// Set after a send works, so the next scan needs no login form; cleared when the login runs out.
    @AppStorage("webAppSignedIn") private var signedIn = false
    @State private var changingAccount = false
    @State private var status = Status.idle
    /// Set when the plan went but its 3D view did not.
    @State private var modelProblem: String?

    private enum Status: Equatable {
        case idle
        case sending
        case sent(URL)
        case failed(String)
    }

    var body: some View {
        VStack(spacing: 12) {
            if case .sent(let page) = status {
                Label("Skickad till webbappen", systemImage: "checkmark.circle.fill")
                    .font(.headline)
                    .foregroundStyle(.green)
                Link("Öppna Skannare i webbappen", destination: page)
                if let modelProblem {
                    Text(modelProblem)
                        .font(.footnote)
                        .foregroundStyle(.orange)
                        .multilineTextAlignment(.center)
                }
            } else if signedIn && !changingAccount {
                Text("Skickas till \(address) som \(email)")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                if case .failed(let message) = status {
                    Text(message)
                        .font(.footnote)
                        .foregroundStyle(.red)
                        .multilineTextAlignment(.center)
                }
                sendButton
                Button("Byt konto eller adress") { changingAccount = true }
                    .font(.footnote)
            } else {
                TextField("Webbappens adress", text: $address)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .keyboardType(.URL)
                TextField("E-post", text: $email)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .keyboardType(.emailAddress)
                SecureField("Lösenord", text: $password)
                if case .failed(let message) = status {
                    Text(message)
                        .font(.footnote)
                        .foregroundStyle(.red)
                        .multilineTextAlignment(.center)
                }
                sendButton
            }
        }
        .textFieldStyle(.roundedBorder)
    }

    private var sendButton: some View {
        Button {
            Task { await send() }
        } label: {
            Label(status == .sending ? "Skickar…" : "Skicka till webbappen", systemImage: "icloud.and.arrow.up")
                .frame(maxWidth: .infinity)
        }
        .buttonStyle(.borderedProminent)
        .controlSize(.large)
        .disabled(status == .sending || address.isEmpty || email.isEmpty)
    }

    private func send() async {
        guard let base = WebAppClient.address(from: address) else {
            status = .failed(WebAppError.badAddress.localizedDescription)
            return
        }
        status = .sending
        do {
            let scan = try Data(contentsOf: scanFile)
            let roomPlan = roomPlanFile.flatMap { try? Data(contentsOf: $0) }
            let meshData = meshFile.flatMap { try? Data(contentsOf: $0) }
            let client = WebAppClient(baseURL: base)
            let plan = try await client.send(scan: scan, roomPlan: roomPlan, mesh: meshData, email: email, password: password)
            modelProblem = nil
            if let model = modelFile.flatMap({ try? Data(contentsOf: $0) }) {
                do {
                    try await client.uploadModel(model, planId: plan.id)
                } catch {
                    modelProblem = "Planen skickades, men inte 3D-skanningen: \(error.localizedDescription)"
                }
            }
            password = ""
            signedIn = true
            changingAccount = false
            status = .sent(client.scansPage)
        } catch {
            // A login that has run out brings the form back.
            if (error as? WebAppError) == .notLoggedIn || (error as? WebAppError) == .mustChangePassword {
                signedIn = false
            }
            status = .failed(error.localizedDescription)
        }
    }
}
