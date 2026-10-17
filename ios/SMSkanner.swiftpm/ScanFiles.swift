import Foundation
import RoomPlan

/// The two files a finished scan is shared as.
struct ScanFiles {
    /// What the web app imports ("Importera skanning" in Planritningar).
    let plan: URL
    /// RoomPlan's own data, kept so the conversion can be checked against real scans.
    let roomPlan: URL
    let summary: String

    init(room: CapturedRoom, date: Date = .now) throws {
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

        summary = Self.summary(of: scan)
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
