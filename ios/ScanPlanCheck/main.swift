import Foundation

// Checks the scan geometry without a phone or Xcode:
//   swiftc ios/SMSkanner.swiftpm/ScanPlan.swift ios/ScanPlanCheck/main.swift -o /tmp/scan-check && /tmp/scan-check

func check(_ condition: Bool, _ message: String, line: Int = #line) {
    if !condition {
        print("FAIL (line \(line)): \(message)")
        exit(1)
    }
}

func near(_ a: Double, _ b: Double) -> Bool { abs(a - b) < 0.001 }

// A 5 x 4 m room, measured the way RoomPlan reports walls: middle, direction, length.
let measuredWalls = [
    MeasuredWall(center: PlanPoint(x: 2.5, y: 0), direction: PlanPoint(x: 1, y: 0), length: 5, thickness: 0.2),
    MeasuredWall(center: PlanPoint(x: 5, y: 2), direction: PlanPoint(x: 0, y: 2), length: 4, thickness: nil),
    MeasuredWall(center: PlanPoint(x: 2.5, y: 4), direction: PlanPoint(x: -1, y: 0), length: 5, thickness: nil),
    MeasuredWall(center: PlanPoint(x: 0, y: 2), direction: PlanPoint(x: 0, y: -1), length: 4, thickness: nil),
]
let openings = [
    // A door 1.45 m along the top wall, 0.1 m off its line, as a real scan would be.
    MeasuredOpening(kind: .door, center: PlanPoint(x: 1.45, y: 0.1), width: 0.9),
    // A window in the middle of the right wall.
    MeasuredOpening(kind: .window, center: PlanPoint(x: 5.02, y: 2), width: 1.2),
    // A passage on the bottom wall, which runs right to left.
    MeasuredOpening(kind: .opening, center: PlanPoint(x: 4, y: 4), width: 1),
    // Something in the middle of the room is not in any wall and is dropped.
    MeasuredOpening(kind: .door, center: PlanPoint(x: 2.5, y: 2), width: 0.9),
    // Wider than its wall: clamped to the wall.
    MeasuredOpening(kind: .window, center: PlanPoint(x: 0, y: 2), width: 6),
]

let plan = ScanPlan(walls: measuredWalls, openings: openings, rooms: [], objects: [])

check(plan.walls.count == 4, "four walls")
check(plan.walls[0].start == PlanPoint(x: 0, y: 0) && plan.walls[0].end == PlanPoint(x: 5, y: 0), "top wall runs 0→5")
check(plan.walls[1].start == PlanPoint(x: 5, y: 0) && plan.walls[1].end == PlanPoint(x: 5, y: 4), "direction is normalised")
check(plan.walls[0].thickness == 0.2 && plan.walls[1].thickness == nil, "thickness passes through")

check(plan.doors.count == 1, "the door in the room's middle is dropped")
check(plan.doors[0].wall == 0 && near(plan.doors[0].offset, 1.0) && near(plan.doors[0].width, 0.9), "door at 1.0 m on the top wall")
check(plan.windows.count == 2, "two windows")
check(plan.windows[0].wall == 1 && near(plan.windows[0].offset, 1.4), "window centred on the right wall")
check(plan.windows[1].wall == 3 && near(plan.windows[1].offset, 0) && near(plan.windows[1].width, 4), "too-wide window clamped")
// The bottom wall starts at x = 5, so x = 4 is 1 m along it; a 1 m passage starts at 0.5 m.
check(plan.openings.count == 1 && plan.openings[0].wall == 2 && near(plan.openings[0].offset, 0.5), "passage measured from the wall's own start")

check(near(polygonArea([PlanPoint(x: 0, y: 0), PlanPoint(x: 5, y: 0), PlanPoint(x: 5, y: 4), PlanPoint(x: 0, y: 4)]), 20), "rectangle area")
check(near(polygonArea([PlanPoint(x: 0, y: 0), PlanPoint(x: 6, y: 0), PlanPoint(x: 6, y: 3), PlanPoint(x: 3, y: 3), PlanPoint(x: 3, y: 6), PlanPoint(x: 0, y: 6)]), 27), "L-shape area")

// The JSON has the shape the web app parses: version 1, points as [x, y] arrays.
let json = try JSONSerialization.jsonObject(with: try plan.jsonData()) as! [String: Any]
check(json["version"] as? Int == 1, "version 1")
let firstWall = (json["walls"] as! [[String: Any]])[0]
check((firstWall["start"] as? [Double]) == [0, 0] && (firstWall["end"] as? [Double]) == [5, 0], "points encode as [x, y]")
check((json["openings"] as? [Any])?.count == 1, "openings are exported")

print("ScanPlan geometry: all checks passed")
