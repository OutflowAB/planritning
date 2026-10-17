import SwiftUI

/// "Skicka till webbappen": the address, e-post and lösenord of the realtor's web account, and a
/// button that sends the finished scan there. The address and e-post are remembered; the
/// password is not, since the login itself is kept after the first send.
struct SendToWebAppView: View {
    let scanFile: URL

    @AppStorage("webAppAddress") private var address = ""
    @AppStorage("webAppEmail") private var email = ""
    @State private var password = ""
    @State private var status = Status.idle

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
        }
        .textFieldStyle(.roundedBorder)
    }

    private func send() async {
        guard let base = WebAppClient.address(from: address) else {
            status = .failed(WebAppError.badAddress.localizedDescription)
            return
        }
        status = .sending
        do {
            let scan = try Data(contentsOf: scanFile)
            let client = WebAppClient(baseURL: base)
            _ = try await client.send(scan: scan, email: email, password: password)
            password = ""
            status = .sent(client.scansPage)
        } catch {
            status = .failed(error.localizedDescription)
        }
    }
}
