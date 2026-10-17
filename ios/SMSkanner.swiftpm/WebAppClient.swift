import Foundation

// Sends a finished scan to the web app: logs in with the realtor's own account, then posts the
// scan, which appears under Skannare. Foundation only, so it can be checked on a Mac against a
// local server (see ../UploadCheck). Plain data and logic, so it is `nonisolated`: the app makes
// everything main-actor by default, and network code should not be.

nonisolated enum WebAppError: Error, LocalizedError, Equatable {
    case badAddress
    case notLoggedIn
    case mustChangePassword
    case server(String)
    case network(String)

    var errorDescription: String? {
        switch self {
        case .badAddress: "Skriv webbappens adress, till exempel https://planritning.example.se"
        case .notLoggedIn: "Du är utloggad. Skriv ditt lösenord och försök igen."
        case .mustChangePassword: "Byt ditt tillfälliga lösenord i webbappen först."
        case .server(let message), .network(let message): message
        }
    }
}

nonisolated struct UploadedPlan: Equatable {
    var id: Int
    var filePath: String
}

nonisolated struct WebAppClient {
    var baseURL: URL
    /// The login is a cookie, kept in the shared cookie store so it survives between sends.
    var session: URLSession = WebAppClient.makeSession()

    static func makeSession() -> URLSession {
        let configuration = URLSessionConfiguration.default
        configuration.httpCookieStorage = .shared
        configuration.httpShouldSetCookies = true
        configuration.timeoutIntervalForRequest = 60
        return URLSession(configuration: configuration)
    }

    /// What the user typed as an address: "planritning.se" is https, an address with its own
    /// scheme ("http://192.168.1.20:3000", for a server on the same network) is kept.
    static func address(from text: String) -> URL? {
        var trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        while trimmed.hasSuffix("/") { trimmed.removeLast() }
        if trimmed.isEmpty { return nil }
        if !trimmed.contains("://") { trimmed = "https://" + trimmed }
        guard let url = URL(string: trimmed),
              let scheme = url.scheme?.lowercased(), scheme == "http" || scheme == "https",
              let host = url.host, !host.isEmpty
        else { return nil }
        return url
    }

    /// Where the sent plan is found in the web app.
    var scansPage: URL { baseURL.appending(path: "skannare") }

    /// Sends the scan. With a password it logs in first; without one it relies on the login from
    /// an earlier send, and says `notLoggedIn` when that has run out.
    func send(scan: Data, email: String, password: String) async throws -> UploadedPlan {
        if !password.isEmpty {
            try await login(email: email, password: password)
        }
        return try await upload(scan: scan)
    }

    func login(email: String, password: String) async throws {
        let body = try JSONSerialization.data(withJSONObject: [
            "email": email.trimmingCharacters(in: .whitespacesAndNewlines),
            "password": password,
        ])
        let (data, status) = try await post("api/auth/login", body: body)
        guard status == 200 else {
            throw WebAppError.server(Self.message(in: data) ?? "Inloggningen misslyckades (\(status)).")
        }
        // A temporary password has to be replaced in the web app before anything else works.
        if Self.object(in: data)?["mustChangePassword"] as? Bool == true {
            throw WebAppError.mustChangePassword
        }
    }

    func upload(scan: Data) async throws -> UploadedPlan {
        // The scan file is already JSON, so it is wrapped rather than decoded and encoded again.
        var body = Data("{\"scan\":".utf8)
        body.append(scan)
        body.append(Data("}".utf8))

        let (data, status) = try await post("api/blank-floorplan", body: body)
        let reply = Self.object(in: data)
        switch status {
        case 200:
            guard let image = reply?["image"] as? [String: Any],
                  let id = image["id"] as? Int,
                  let path = image["file_path"] as? String
            else { throw WebAppError.server("Oväntat svar från webbappen.") }
            return UploadedPlan(id: id, filePath: path)
        case 401:
            throw WebAppError.notLoggedIn
        case 403 where reply?["code"] as? String == "password_change_required":
            throw WebAppError.mustChangePassword
        default:
            throw WebAppError.server(Self.message(in: data) ?? "Kunde inte skicka skanningen (\(status)).")
        }
    }

    private func post(_ path: String, body: Data) async throws -> (Data, Int) {
        var request = URLRequest(url: baseURL.appending(path: path))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = body
        do {
            let (data, response) = try await session.data(for: request)
            return (data, (response as? HTTPURLResponse)?.statusCode ?? 0)
        } catch {
            throw WebAppError.network("Kunde inte nå webbappen. Kontrollera adressen och nätverket.")
        }
    }

    private static func object(in data: Data) -> [String: Any]? {
        (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
    }

    private static func message(in data: Data) -> String? {
        object(in: data)?["message"] as? String
    }
}
