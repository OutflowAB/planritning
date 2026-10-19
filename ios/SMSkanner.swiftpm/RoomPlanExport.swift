import RoomPlan
import simd

// RoomPlan → the web app's scan format. RoomPlan works in 3D metres with y up; seen from above,
// world x stays x and world z becomes the plan's y (pointing down the page), which keeps the plan
// the right way round rather than mirrored.

extension ScanPlan {
    init(capturedRoom room: CapturedRoom) {
        let walls = room.walls.map { surface in
            MeasuredWall(
                center: surface.transform.planPosition,
                direction: surface.transform.planXAxis,
                length: Double(surface.dimensions.x),
                // RoomPlan usually reports walls as flat surfaces; the web app then uses 15 cm.
                thickness: surface.dimensions.z > 0.01 ? Double(surface.dimensions.z) : nil
            )
        }

        func measured(_ surfaces: [CapturedRoom.Surface], as kind: MeasuredOpening.Kind) -> [MeasuredOpening] {
            surfaces.map { MeasuredOpening(kind: kind, center: $0.transform.planPosition, width: Double($0.dimensions.x)) }
        }
        let openings = measured(room.doors, as: .door)
            + measured(room.windows, as: .window)
            + measured(room.openings, as: .opening)

        let objects = room.objects.map { object in
            Object(
                category: object.category.scanName,
                center: object.transform.planPosition,
                width: Double(object.dimensions.x),
                depth: Double(object.dimensions.z),
                rotation: object.transform.planXAxis.degrees
            )
        }

        self.init(walls: walls, openings: openings, rooms: Self.rooms(in: room), objects: objects)
    }

    /// Named rooms from RoomPlan's sections. RoomPlan measures one floor for the whole capture,
    /// so it is a room's outline (and gives it an area) only when the capture is a single room.
    private static func rooms(in room: CapturedRoom) -> [Room] {
        let outline: [PlanPoint]? = room.floors.first.flatMap { floor in
            let corners = floor.polygonCorners.map { corner in
                (floor.transform * SIMD4<Float>(corner, 1)).planPoint
            }
            return corners.count >= 3 ? corners : nil
        }

        guard !room.sections.isEmpty else {
            guard let outline else { return [] }
            let center = outline.reduce(PlanPoint(x: 0, y: 0), +) * (1 / Double(outline.count))
            return [Room(name: "Rum", center: center, outline: outline)]
        }

        return room.sections.map { section in
            Room(
                name: section.label.swedishName,
                center: SIMD4<Float>(section.center, 1).planPoint,
                outline: room.sections.count == 1 ? outline : nil
            )
        }
    }
}

private extension simd_float4x4 {
    var planPosition: PlanPoint { columns.3.planPoint }
    /// The direction the surface or object runs along (its local x axis), seen from above.
    var planXAxis: PlanPoint { columns.0.planPoint }
}

private extension SIMD4 where Scalar == Float {
    var planPoint: PlanPoint { PlanPoint(x: Double(x), y: Double(z)) }
}

private extension PlanPoint {
    /// Angle in degrees, measured the way the web app measures a wall's direction.
    var degrees: Double { atan2(y, x) * 180 / .pi }
}

private extension CapturedRoom.Object.Category {
    /// RoomPlan's own names; the web importer decides which of them the house style draws.
    var scanName: String {
        switch self {
        case .storage: "storage"
        case .refrigerator: "refrigerator"
        case .stove: "stove"
        case .bed: "bed"
        case .sink: "sink"
        case .washerDryer: "washerDryer"
        case .toilet: "toilet"
        case .bathtub: "bathtub"
        case .oven: "oven"
        case .dishwasher: "dishwasher"
        case .table: "table"
        case .sofa: "sofa"
        case .chair: "chair"
        case .fireplace: "fireplace"
        case .television: "television"
        case .stairs: "stairs"
        @unknown default: String(describing: self)
        }
    }
}

private extension CapturedRoom.Section.Label {
    var swedishName: String {
        switch self {
        case .bathroom: "Badrum"
        case .bedroom: "Sovrum"
        case .diningRoom: "Matplats"
        case .kitchen: "Kök"
        case .livingRoom: "Vardagsrum"
        case .unidentified: "Rum"
        @unknown default: "Rum"
        }
    }
}
