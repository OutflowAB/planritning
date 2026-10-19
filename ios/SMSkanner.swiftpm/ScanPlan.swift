import Foundation

// The scan format the web app imports (`lib/floorplan/scan-import.ts`): a top-down plan in
// metres, x to the right and y downward. This file is plain Swift with no RoomPlan in it, so
// the geometry can be built and checked on a Mac (see ../ScanPlanCheck). It is plain data, so it
// is `nonisolated`: the app makes everything main-actor by default, and data should not be.

/// A point on the plan, encoded as `[x, y]` like the web format.
nonisolated struct PlanPoint: Codable, Equatable {
    var x: Double
    var y: Double

    init(x: Double, y: Double) {
        self.x = x
        self.y = y
    }

    init(from decoder: Decoder) throws {
        var container = try decoder.unkeyedContainer()
        x = try container.decode(Double.self)
        y = try container.decode(Double.self)
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.unkeyedContainer()
        try container.encode(x.roundedToMillimetre)
        try container.encode(y.roundedToMillimetre)
    }

    static func - (a: PlanPoint, b: PlanPoint) -> PlanPoint { PlanPoint(x: a.x - b.x, y: a.y - b.y) }
    static func + (a: PlanPoint, b: PlanPoint) -> PlanPoint { PlanPoint(x: a.x + b.x, y: a.y + b.y) }
    static func * (a: PlanPoint, k: Double) -> PlanPoint { PlanPoint(x: a.x * k, y: a.y * k) }
    func dot(_ other: PlanPoint) -> Double { x * other.x + y * other.y }
    var length: Double { (x * x + y * y).squareRoot() }
}

extension Double {
    /// Scans are good to about a centimetre; millimetres keep the file small and readable.
    nonisolated var roundedToMillimetre: Double { (self * 1000).rounded() / 1000 }
}

nonisolated struct ScanPlan: Codable, Equatable {
    var version = 1
    var walls: [Wall]
    var doors: [Opening]
    var windows: [Opening]
    var openings: [Opening]
    var rooms: [Room]
    var objects: [Object]
    /// The floor of the whole capture, seen from above. LiDAR sees a floor even where a wall is
    /// glass and was missed, so the web app uses it to put back walls along its edges.
    var floor: [PlanPoint]? = nil

    nonisolated struct Wall: Codable, Equatable {
        var start: PlanPoint
        var end: PlanPoint
        var thickness: Double?
    }

    /// `width` metres of wall, starting `offset` metres from the wall's start.
    nonisolated struct Opening: Codable, Equatable {
        var wall: Int
        var offset: Double
        var width: Double
    }

    nonisolated struct Room: Codable, Equatable {
        var name: String
        var center: PlanPoint
        var outline: [PlanPoint]?
    }

    nonisolated struct Object: Codable, Equatable {
        var category: String
        var center: PlanPoint
        var width: Double
        var depth: Double
        var rotation: Double
    }
}

// MARK: - Building a plan from what the scanner measured

/// A wall as the scanner reports it: its middle, the direction it runs, and its length.
nonisolated struct MeasuredWall {
    var center: PlanPoint
    var direction: PlanPoint
    var length: Double
    var thickness: Double?
}

/// A door, window or doorless opening: its middle, its width, and the direction it runs.
nonisolated struct MeasuredOpening {
    enum Kind { case door, window, opening }
    var kind: Kind
    var center: PlanPoint
    var width: Double
    /// Along the wall it is in. Lets an opening with no wall found around it (a glass front the
    /// scanner could not see) become a piece of wall of its own instead of being dropped.
    var direction: PlanPoint? = nil
}

extension ScanPlan {
    /// How far (metres) an opening's middle may be from a wall's line and still sit in it.
    /// Wider than any wall, narrower than any room.
    nonisolated static let openingTolerance = 0.35

    nonisolated init(
        walls measuredWalls: [MeasuredWall],
        openings measuredOpenings: [MeasuredOpening],
        rooms: [Room],
        objects: [Object],
        floor: [PlanPoint]? = nil
    ) {
        var walls = measuredWalls.compactMap { wall -> Wall? in
            let length = wall.direction.length
            guard length > 0, wall.length > 0.01 else { return nil }
            let unit = wall.direction * (1 / length)
            let half = unit * (wall.length / 2)
            return Wall(start: wall.center - half, end: wall.center + half, thickness: wall.thickness)
        }

        var doors: [Opening] = []
        var windows: [Opening] = []
        var openings: [Opening] = []
        for measured in measuredOpenings {
            var found = Self.place(measured, in: walls)
            // No wall within reach: the opening's own span is the wall, so it is kept.
            if found == nil, let wall = Self.wall(around: measured) {
                walls.append(wall)
                found = Self.place(measured, in: walls)
            }
            guard let placed = found else { continue }
            switch measured.kind {
            case .door: doors.append(placed)
            case .window: windows.append(placed)
            case .opening: openings.append(placed)
            }
        }

        self.init(walls: walls, doors: doors, windows: windows, openings: openings, rooms: rooms, objects: objects, floor: floor)
    }

    /// A piece of wall exactly as long as an opening that has none around it.
    nonisolated static func wall(around opening: MeasuredOpening) -> Wall? {
        guard let direction = opening.direction, direction.length > 0, opening.width > 0.05 else { return nil }
        let half = direction * (opening.width / 2 / direction.length)
        return Wall(start: opening.center - half, end: opening.center + half, thickness: nil)
    }

    /// The wall an opening sits in (the nearest one within tolerance) and where along it.
    nonisolated static func place(_ opening: MeasuredOpening, in walls: [Wall]) -> Opening? {
        var best: (index: Int, distance: Double, along: Double)?
        for (index, wall) in walls.enumerated() {
            let span = wall.end - wall.start
            let length = span.length
            let unit = span * (1 / length)
            let along = (opening.center - wall.start).dot(unit)
            // Distance from the opening's middle to the wall segment.
            let nearest = wall.start + unit * min(max(along, 0), length)
            let distance = (opening.center - nearest).length
            if distance <= openingTolerance, distance < (best?.distance ?? .infinity) {
                best = (index, distance, along)
            }
        }
        guard let best else { return nil }

        let wall = walls[best.index]
        let length = (wall.end - wall.start).length
        let width = min(opening.width, length)
        let offset = min(max(best.along - width / 2, 0), length - width)
        return Opening(wall: best.index, offset: offset.roundedToMillimetre, width: width.roundedToMillimetre)
    }

    /// The scan as the JSON file the web app imports.
    nonisolated func jsonData() throws -> Data {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        return try encoder.encode(self)
    }
}

/// Area of a simple polygon (shoelace formula), in square metres.
nonisolated func polygonArea(_ points: [PlanPoint]) -> Double {
    guard points.count >= 3 else { return 0 }
    var twice = 0.0
    for index in points.indices {
        let a = points[index]
        let b = points[(index + 1) % points.count]
        twice += a.x * b.y - b.x * a.y
    }
    return abs(twice) / 2
}
