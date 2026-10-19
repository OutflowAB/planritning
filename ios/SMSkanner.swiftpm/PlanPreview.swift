import SwiftUI

/// The scan drawn from above, to check before sending: walls in black, windows in blue, doors in
/// green, passages left open, and the room names. It is the plan the web app will draw, without
/// the house style.
struct PlanPreview: View {
    let scan: ScanPlan

    var body: some View {
        Canvas { context, size in
            let points = scan.walls.flatMap { [$0.start, $0.end] }
            guard let minX = points.map(\.x).min(), let maxX = points.map(\.x).max(),
                  let minY = points.map(\.y).min(), let maxY = points.map(\.y).max()
            else { return }
            let scale = 0.9 * min(size.width / max(maxX - minX, 0.5), size.height / max(maxY - minY, 0.5))
            let offsetX = (size.width - (maxX - minX) * scale) / 2
            let offsetY = (size.height - (maxY - minY) * scale) / 2
            func place(_ point: PlanPoint) -> CGPoint {
                CGPoint(x: offsetX + (point.x - minX) * scale, y: offsetY + (point.y - minY) * scale)
            }
            func line(_ from: PlanPoint, _ to: PlanPoint, _ colour: Color, width: Double) {
                var path = Path()
                path.move(to: place(from))
                path.addLine(to: place(to))
                context.stroke(path, with: .color(colour), lineWidth: width)
            }

            let wallWidth = max(3, 0.15 * scale)
            for wall in scan.walls {
                line(wall.start, wall.end, .primary, width: max(3, (wall.thickness ?? 0.15) * scale))
            }

            // Openings are drawn over their wall, from `offset` along it for `width`.
            func span(_ opening: ScanPlan.Opening) -> (PlanPoint, PlanPoint)? {
                guard scan.walls.indices.contains(opening.wall) else { return nil }
                let wall = scan.walls[opening.wall]
                let length = (wall.end - wall.start).length
                guard length > 0 else { return nil }
                let unit = (wall.end - wall.start) * (1 / length)
                return (wall.start + unit * opening.offset, wall.start + unit * (opening.offset + opening.width))
            }
            for opening in scan.openings {
                if let (a, b) = span(opening) { line(a, b, Color(.systemBackground), width: wallWidth + 2) }
            }
            for window in scan.windows {
                if let (a, b) = span(window) { line(a, b, .blue, width: wallWidth * 0.7) }
            }
            for door in scan.doors {
                if let (a, b) = span(door) {
                    line(a, b, Color(.systemBackground), width: wallWidth + 2)
                    line(a, b, .green, width: 2)
                }
            }

            for room in scan.rooms {
                context.draw(Text(room.name.uppercased()).font(.caption2.bold()).foregroundStyle(.secondary), at: place(room.center))
            }
        }
        .accessibilityLabel("Ritning av skanningen")
    }
}
