import Foundation
import RoomPlan

/// The two files a finished scan is shared as.
struct ScanFiles {
    /// What the web app imports ("Importera skanning" in Planritningar).
    let plan: URL
    /// RoomPlan's own data, kept so the conversion can be checked against real scans.
    let roomPlan: URL
    /// What the LiDAR mesh labelled, windows above all (prototype); none when no mesh was read.
    let mesh: URL?
    /// The whole LiDAR mesh, compressed, for the 3D view in the web app; none without a mesh.
    let model: URL?
    let summary: String
    /// The scan itself, for the preview on the result screen.
    let scan: ScanPlan
    /// What the LiDAR mesh labelled (prototype), for the result screen.
    let meshSummary: MeshSummary?

    init(room: CapturedRoom, mesh meshSummary: MeshSummary? = nil, model modelData: Data? = nil, date: Date = .now) throws {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd-HHmm"
        let name = "skanning-\(formatter.string(from: date))"
        let folder = FileManager.default.temporaryDirectory

        let scan = ScanPlan(capturedRoom: room)
        plan = folder.appending(path: "\(name).json")
        try scan.jsonData().write(to: plan)

        roomPlan = folder.appending(path: "\(name)-roomplan.json")
        try JSONEncoder().encode(room).write(to: roomPlan)

        if let meshSummary {
            let meshFile = folder.appending(path: "\(name)-mesh.json")
            try meshSummary.jsonData().write(to: meshFile)
            mesh = meshFile
        } else {
            mesh = nil
        }

        if let modelData {
            let modelFile = folder.appending(path: "\(name)-3d.bin")
            try modelData.write(to: modelFile)
            model = modelFile
        } else {
            model = nil
        }

        summary = Self.summary(of: scan)
        self.scan = scan
        self.meshSummary = meshSummary
    }

    private static func summary(of scan: ScanPlan) -> String {
        let area = scan.rooms.compactMap(\.outline).map(polygonArea).reduce(0, +)
        var parts = [
            "\(scan.walls.count) väggar",
            "\(scan.doors.count) dörrar",
            "\(scan.windows.count) fönster",
            "\(scan.rooms.count) rum",
        ]
        if area > 0 {
            parts.append("ca \(area.formatted(.number.precision(.fractionLength(1)))) m²")
        }
        return parts.joined(separator: " · ")
    }
}
