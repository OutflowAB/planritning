import ARKit
import Observation

/// Watches the mesh ARKit builds in the session RoomPlan scans with (prototype). RoomPlan runs
/// the session itself and builds no mesh, so, as an experiment, once RoomPlan has started the
/// app takes RoomPlan's own settings, adds the labelled mesh and runs them again without
/// resetting tracking. Whether RoomPlan keeps scanning after that is what the experiment tests.
@MainActor @Observable
final class MeshCollector {
    /// Handed to RoomPlan, which runs it.
    let session = ARSession()

    private(set) var faces = 0
    private(set) var windowFaces = 0
    private(set) var classified = false
    private(set) var seconds = 0
    /// What happened when the mesh was turned on, for the screen and the summary.
    private(set) var experiment: String?
    private var polling: Task<Void, Never>?
    /// What the camera saw on the mesh, for the coloured 3D view.
    private let colors = MeshColors()
    private var ticks = 0

    func start() {
        polling?.cancel()
        polling = Task { [weak self] in
            while !Task.isCancelled {
                // Colours from the camera twice a second; the status line once a second.
                try? await Task.sleep(for: .milliseconds(500))
                self?.tick()
            }
        }
    }

    func stop() {
        polling?.cancel()
        polling = nil
    }

    /// A line for the scan screen, so the person scanning sees at once whether glass is picked up.
    var status: String {
        if faces == 0 {
            if seconds < 5 { return "Mesh: väntar…" }
            return "Mesh: ingen från LiDAR" + (experiment.map { " (\($0))" } ?? "")
        }
        let count = faces.formatted()
        return classified ? "Mesh: \(count) ytor · fönster: \(windowFaces.formatted())" : "Mesh: \(count) ytor (utan etiketter)"
    }

    private var meshAnchors: [ARMeshAnchor] {
        session.currentFrame?.anchors.compactMap { $0 as? ARMeshAnchor } ?? []
    }

    private func tick() {
        ticks += 1
        if let frame = session.currentFrame, experiment != nil {
            colors.add(frame: frame, anchors: meshAnchors)
        }
        if ticks.isMultiple(of: 2) { refresh() }
    }

    private func refresh() {
        seconds += 1
        // A moment after RoomPlan has started, so its own settings are in place.
        if seconds == 2, experiment == nil {
            enableMesh()
        }
        var total = 0
        var windows = 0
        var labelled = false
        for anchor in meshAnchors {
            let geometry = anchor.geometry
            total += geometry.faces.count
            guard let labels = geometry.classification else { continue }
            labelled = true
            for face in 0..<geometry.faces.count where Self.label(labels, face) == .window {
                windows += 1
            }
        }
        faces = total
        windowFaces = windows
        classified = labelled
    }

    private func enableMesh() {
        guard ARWorldTrackingConfiguration.supportsSceneReconstruction(.meshWithClassification) else {
            experiment = "mesh stöds inte"
            return
        }
        guard let configuration = session.configuration else {
            experiment = "ingen konfiguration än"
            return
        }
        guard let tracking = configuration as? ARWorldTrackingConfiguration else {
            experiment = "RoomPlan kör \(type(of: configuration))"
            return
        }
        // RoomPlan's own settings, plus the mesh; no reset, so tracking and RoomPlan's view go on.
        tracking.sceneReconstruction = .meshWithClassification
        // The depth image tells which mesh points are hidden from the camera, for the colours.
        if ARWorldTrackingConfiguration.supportsFrameSemantics(.sceneDepth) {
            tracking.frameSemantics.insert(.sceneDepth)
        }
        session.run(tracking)
        experiment = "mesh påslagen"
    }

    /// The mesh as it stands, for sending with the scan.
    func summary() -> MeshSummary {
        let anchors = meshAnchors
        var counts: [String: Int] = [:]
        var points: [[Double]] = []
        var labelled = false
        for anchor in anchors {
            let geometry = anchor.geometry
            let faces = geometry.faces
            guard let labels = geometry.classification else {
                counts["unlabelled", default: 0] += faces.count
                continue
            }
            labelled = true
            for face in 0..<faces.count {
                let label = Self.label(labels, face)
                counts[Self.name(label), default: 0] += 1
                guard label == .window else { continue }
                var sum = SIMD3<Float>(0, 0, 0)
                for corner in 0..<faces.indexCountPerPrimitive {
                    sum += Self.vertex(geometry.vertices, Self.index(faces, face: face, corner: corner))
                }
                let middle = sum / Float(faces.indexCountPerPrimitive)
                let world = anchor.transform * SIMD4<Float>(middle, 1)
                points.append([world.x, world.y, world.z].map { (Double($0) * 1000).rounded() / 1000 })
            }
        }
        return MeshSummary(
            meshAvailable: !anchors.isEmpty,
            classified: labelled,
            faceCounts: counts,
            windowPoints: MeshSummary.thinned(points),
            experiment: experiment
        )
    }

    /// The whole mesh as one file, for looking at the scan in 3D in the web app (the format is
    /// described in lib/scan-mesh-format.ts): every face in world coordinates with its label, and
    /// each point's colour from the camera, raw-deflate compressed. Nil when there is no mesh.
    func model() throws -> Data? {
        let anchors = meshAnchors
        guard !anchors.isEmpty else { return nil }
        var positions: [Float] = []
        var indices: [UInt32] = []
        var labels: [UInt8] = []
        var rgb: [UInt8] = []
        let faceTotal = anchors.reduce(0) { $0 + $1.geometry.faces.count }
        positions.reserveCapacity(anchors.reduce(0) { $0 + $1.geometry.vertices.count } * 3)
        indices.reserveCapacity(faceTotal * 3)
        labels.reserveCapacity(faceTotal)

        for anchor in anchors {
            let geometry = anchor.geometry
            let first = UInt32(positions.count / 3)
            for index in 0..<geometry.vertices.count {
                let world = anchor.transform * SIMD4<Float>(Self.vertex(geometry.vertices, index), 1)
                positions += [world.x, world.y, world.z]
                let (r, g, b) = colors.color(at: SIMD3(world.x, world.y, world.z))
                rgb += [r, g, b]
            }
            let faces = geometry.faces
            // ARKit's mesh is triangles.
            for face in 0..<faces.count {
                for corner in 0..<3 {
                    indices.append(first + UInt32(Self.index(faces, face: face, corner: corner)))
                }
                labels.append(geometry.classification.map { UInt8(Self.label($0, face).rawValue) } ?? 0)
            }
        }

        // Little-endian, as the phone itself is.
        var data = Data("SMM2".utf8)
        for count in [UInt32(positions.count / 3), UInt32(labels.count)] {
            withUnsafeBytes(of: count.littleEndian) { data.append(contentsOf: $0) }
        }
        positions.withUnsafeBytes { data.append(contentsOf: $0) }
        indices.withUnsafeBytes { data.append(contentsOf: $0) }
        data.append(contentsOf: labels)
        data.append(contentsOf: rgb)
        // Apple's zlib here is raw deflate, which the browser inflates as "deflate-raw".
        return try (data as NSData).compressed(using: .zlib) as Data
    }

    // MARK: Reading ARKit's buffers

    nonisolated static func label(_ source: ARGeometrySource, _ face: Int) -> ARMeshClassification {
        let pointer = source.buffer.contents().advanced(by: source.offset + source.stride * face)
        return ARMeshClassification(rawValue: Int(pointer.assumingMemoryBound(to: UInt8.self).pointee)) ?? .none
    }

    nonisolated static func index(_ faces: ARGeometryElement, face: Int, corner: Int) -> Int {
        let pointer = faces.buffer.contents().advanced(by: (face * faces.indexCountPerPrimitive + corner) * faces.bytesPerIndex)
        return faces.bytesPerIndex == 2
            ? Int(pointer.assumingMemoryBound(to: UInt16.self).pointee)
            : Int(pointer.assumingMemoryBound(to: UInt32.self).pointee)
    }

    nonisolated static func vertex(_ source: ARGeometrySource, _ index: Int) -> SIMD3<Float> {
        // Three packed floats, not a 16-byte SIMD3.
        let pointer = source.buffer.contents().advanced(by: source.offset + source.stride * index)
        let (x, y, z) = pointer.assumingMemoryBound(to: (Float, Float, Float).self).pointee
        return SIMD3(x, y, z)
    }

    private static func name(_ label: ARMeshClassification) -> String {
        switch label {
        case .none: "none"
        case .wall: "wall"
        case .floor: "floor"
        case .ceiling: "ceiling"
        case .table: "table"
        case .seat: "seat"
        case .window: "window"
        case .door: "door"
        @unknown default: "other"
        }
    }
}
