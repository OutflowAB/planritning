import Foundation

// Checks the app's web client against a LOCAL server, without a phone or Xcode:
//   WEBAPP_URL=http://localhost:3000 WEBAPP_EMAIL=… WEBAPP_PASSWORD=… \
//   swiftc -swift-version 6 -default-isolation MainActor ios/SMSkanner.swiftpm/WebAppClient.swift ios/UploadCheck/main.swift -o /tmp/upload-check && /tmp/upload-check
// It creates three plans on that server (under Skannare); delete them there afterwards.

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

// A glass front: three walls found, the floor outline says there is a fourth. RoomPlan's own
// data goes along.
let glassScan = Data(#"""
{"version":1,"walls":[{"start":[0,0],"end":[6,0]},{"start":[6,4],"end":[0,4]},{"start":[0,4],"end":[0,0]}],
"doors":[],"windows":[],"openings":[],"rooms":[{"name":"Rum","center":[3,2]}],"objects":[],
"floor":[[0,0],[6,0],[6,4],[0,4]]}
"""#.utf8)
let glassPlan = try await client.send(
    scan: glassScan,
    roomPlan: Data(#"{"walls":[],"note":"upload-check"}"#.utf8),
    mesh: Data(#"{"version":1,"meshAvailable":true,"classified":true,"faceCounts":{"window":3},"windowPoints":[[6,1.2,2]]}"#.utf8),
    email: email,
    password: ""
)
print("created plan \(glassPlan.id) (glass front, with raw data and mesh summary)")

// The whole mesh for the 3D view, made up: a 6 × 4 × 2.5 m box (y up, as ARKit has it) with
// window along the glass front (x = 6) and a door, compressed as the app does it.
func meshModel() throws -> Data {
    var positions: [Float] = []
    var indices: [UInt32] = []
    var labels: [UInt8] = []
    func quad(_ a: SIMD3<Float>, _ b: SIMD3<Float>, _ c: SIMD3<Float>, _ d: SIMD3<Float>, _ label: UInt8) {
        let first = UInt32(positions.count / 3)
        for corner in [a, b, c, d] { positions += [corner.x, corner.y, corner.z] }
        indices += [first, first + 1, first + 2, first, first + 2, first + 3]
        labels += [label, label]
    }
    let h: Float = 2.5
    quad([0, 0, 0], [6, 0, 0], [6, 0, 4], [0, 0, 4], 2) // floor
    quad([0, h, 0], [6, h, 0], [6, h, 4], [0, h, 4], 3) // ceiling
    quad([0, 0, 0], [6, 0, 0], [6, h, 0], [0, h, 0], 1)
    quad([0, 0, 4], [6, 0, 4], [6, h, 4], [0, h, 4], 1)
    quad([0, 0, 0], [0, 0, 4], [0, h, 4], [0, h, 0], 1)
    quad([0.01, 0, 1], [0.01, 0, 1.9], [0.01, 2.1, 1.9], [0.01, 2.1, 1], 7) // door, just inside the wall
    for z in stride(from: Float(0), to: 4, by: 0.1) { // the glass front, finely cut as a real mesh is
        quad([6, 0, z], [6, 0, z + 0.1], [6, 0.8, z + 0.1], [6, 0.8, z], 1)
        quad([6, 0.8, z], [6, 0.8, z + 0.1], [6, h, z + 0.1], [6, h, z], 6)
    }
    var data = Data("SMM2".utf8)
    for count in [UInt32(positions.count / 3), UInt32(labels.count)] {
        withUnsafeBytes(of: count.littleEndian) { data.append(contentsOf: $0) }
    }
    positions.withUnsafeBytes { data.append(contentsOf: $0) }
    indices.withUnsafeBytes { data.append(contentsOf: $0) }
    data.append(contentsOf: labels)
    // A colour per point: warm walls, a wooden floor, blue sky through the glass.
    for index in 0..<positions.count / 3 {
        let (x, y) = (positions[index * 3], positions[index * 3 + 1])
        let colour: [UInt8] = x == 6 && y > 0.8 ? [150, 200, 240] : y == 0 ? [170, 120, 80] : [230, 220, 200]
        data.append(contentsOf: colour)
    }
    return try (data as NSData).compressed(using: .zlib) as Data
}

// Small pieces, so it goes in several.
let model = try meshModel()
try await client.uploadModel(model, planId: glassPlan.id, partBytes: 1000)
var linksURL = base.appending(path: "api/scan-mesh")
linksURL.append(queryItems: [URLQueryItem(name: "imageId", value: String(glassPlan.id))])
let (linksData, linksResponse) = try await client.session.data(from: linksURL)
let pieceCount = (try? JSONSerialization.jsonObject(with: linksData) as? [String: Any])?["parts"] as? Int
check((linksResponse as? HTTPURLResponse)?.statusCode == 200, "the mesh can be fetched")
check(pieceCount == (model.count + 999) / 1000, "every piece is there, got \(pieceCount ?? 0)")
// A mesh for a plan that is not the user's is refused.
do {
    try await client.uploadModel(model, planId: 999_999_999)
    check(false, "a mesh for a plan that is not the user's must be refused")
} catch {
    check(error is WebAppError, "refused with a reason, got \(error)")
}
print("sent the 3D mesh of plan \(glassPlan.id) in \(pieceCount ?? 0) pieces")

// A scan the server cannot use comes back with its reason.
do {
    _ = try await client.upload(scan: Data("{}".utf8))
    check(false, "an empty scan must be refused")
} catch {
    if case .server(let message) = error as? WebAppError { check(!message.isEmpty, "a reason is given") } else { check(false, "refusal is a server error, got \(error)") }
}

print("all checks passed")
