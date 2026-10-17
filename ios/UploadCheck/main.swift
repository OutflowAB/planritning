import Foundation

// Checks the app's web client against a LOCAL server, without a phone or Xcode:
//   WEBAPP_URL=http://localhost:3000 WEBAPP_EMAIL=… WEBAPP_PASSWORD=… \
//   swiftc -swift-version 6 -default-isolation MainActor ios/SMSkanner.swiftpm/WebAppClient.swift ios/UploadCheck/main.swift -o /tmp/upload-check && /tmp/upload-check
// It creates one plan on that server (under Skannare); delete it there afterwards.

func check(_ condition: Bool, _ message: String, line: Int = #line) {
    if !condition {
        print("FAIL (line \(line)): \(message)")
        exit(1)
    }
}

let env = ProcessInfo.processInfo.environment
guard let urlText = env["WEBAPP_URL"], let email = env["WEBAPP_EMAIL"], let password = env["WEBAPP_PASSWORD"] else {
    print("Set WEBAPP_URL, WEBAPP_EMAIL and WEBAPP_PASSWORD.")
    exit(2)
}
guard let base = WebAppClient.address(from: urlText), base.host == "localhost" || base.host == "127.0.0.1" else {
    print("Refusing to run against anything but a local server.")
    exit(2)
}

// Addresses as a person types them.
check(WebAppClient.address(from: "planritning.example.se")?.absoluteString == "https://planritning.example.se", "bare name is https")
check(WebAppClient.address(from: " http://192.168.1.20:3000/ ")?.absoluteString == "http://192.168.1.20:3000", "scheme kept, slash trimmed")
check(WebAppClient.address(from: "") == nil, "empty is no address")
check(WebAppClient.address(from: "ftp://x.se") == nil, "only http and https")

let scan = Data(#"""
{"version":1,"walls":[{"start":[0,0],"end":[5,0],"thickness":0.2},{"start":[5,0],"end":[5,4]},{"start":[5,4],"end":[0,4]},{"start":[0,4],"end":[0,0]}],
"doors":[{"wall":0,"offset":1,"width":0.9}],"windows":[{"wall":1,"offset":1.4,"width":1.2}],"openings":[],
"rooms":[{"name":"Rum","center":[2.5,2]}],"objects":[]}
"""#.utf8)

// No cookies at all: the server must say the user is logged out.
let loggedOut = WebAppClient(baseURL: base, session: URLSession(configuration: .ephemeral))
do {
    _ = try await loggedOut.upload(scan: scan)
    check(false, "an upload without a login must fail")
} catch {
    check((error as? WebAppError) == .notLoggedIn, "logged out gives notLoggedIn, got \(error)")
}

// A server that is not there.
let nowhere = WebAppClient(baseURL: URL(string: "http://localhost:9")!, session: URLSession(configuration: .ephemeral))
do {
    _ = try await nowhere.login(email: email, password: password)
    check(false, "login against nothing must fail")
} catch {
    if case .network = error as? WebAppError {} else { check(false, "unreachable gives a network error, got \(error)") }
}

// A wrong password gets the server's own message.
let client = WebAppClient(baseURL: base, session: URLSession(configuration: .ephemeral))
do {
    try await client.login(email: email, password: password + "x")
    check(false, "a wrong password must fail")
} catch {
    check((error as? WebAppError) == .server("Fel e-post eller lösenord."), "wrong password message, got \(error)")
}

// The real thing: log in and send.
let plan = try await client.send(scan: scan, email: email, password: password)
check(plan.id > 0 && plan.filePath.hasPrefix("generated/"), "a plan is created, got \(plan)")
print("created plan \(plan.id)")

// The login is a cookie: a second send needs no password.
let second = try await client.send(scan: scan, email: email, password: "")
check(second.id != plan.id, "second send makes its own plan")
print("created plan \(second.id)")

// A scan the server cannot use comes back with its reason.
do {
    _ = try await client.upload(scan: Data("{}".utf8))
    check(false, "an empty scan must be refused")
} catch {
    if case .server(let message) = error as? WebAppError { check(!message.isEmpty, "a reason is given") } else { check(false, "refusal is a server error, got \(error)") }
}

print("all checks passed")
