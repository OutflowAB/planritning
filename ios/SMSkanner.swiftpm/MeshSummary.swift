import Foundation

// What ARKit's LiDAR mesh held when a scan finished (prototype). RoomPlan finds only rectangular
// windows; the mesh labels surfaces (wall, floor, window, door…) whatever their shape, so it may
// see glass RoomPlan misses. This records what it saw, to find out on real scans. Plain data with
// no ARKit in it, so it can be checked on a Mac (see ../ScanPlanCheck).

nonisolated struct MeshSummary: Codable, Equatable {
    var version = 1
    /// Whether ARKit built any mesh while RoomPlan scanned.
    var meshAvailable: Bool
    /// Whether the mesh came with labels.
    var classified: Bool
    /// Triangles per label ("wall", "window", "unlabelled"…).
    var faceCounts: [String: Int]
    /// The middle of each triangle labelled window, as [x, height, z] in metres, in the same
    /// world coordinates as RoomPlan's own data.
    var windowPoints: [[Double]]
    /// What happened when the app tried to turn the labelled mesh on in RoomPlan's session.
    var experiment: String? = nil

    static let maxWindowPoints = 20_000

    /// At most `limit` points, taken evenly, so a large mesh still fits in an upload.
    static func thinned(_ points: [[Double]], to limit: Int = maxWindowPoints) -> [[Double]] {
        guard points.count > limit, limit > 0 else { return points }
        let step = Double(points.count) / Double(limit)
        return (0..<limit).map { points[Int(Double($0) * step)] }
    }

    func jsonData() throws -> Data {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        return try encoder.encode(self)
    }
}
