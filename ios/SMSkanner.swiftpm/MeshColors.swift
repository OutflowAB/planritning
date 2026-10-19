import ARKit
import CoreVideo
import Foundation

/// The colours the camera sees on the mesh while scanning, for the coloured 3D view in the web
/// app. ARKit reshapes the mesh as it learns more, so colours are kept in 4 cm cells in space and
/// looked up per point when the mesh is exported, not stored on the mesh itself. Where several
/// frames saw a cell, the closest view wins (it has the most detail). Points behind something
/// (checked against the LiDAR depth image, when there is one) and far-off points are skipped.
/// Only the colours of the mesh points leave the phone, never the camera images.
nonisolated final class MeshColors: @unchecked Sendable {
    private struct Key: Hashable { var x: Int32, y: Int32, z: Int32 }
    private struct Sample { var r: UInt8, g: UInt8, b: UInt8; var distance: Float }

    private static let cell: Float = 0.04
    private static let farthest: Float = 5
    // A point this much farther than the depth image says is hidden behind something.
    private static let hiddenBy: Float = 0.12
    /// Grey for points no frame saw.
    static let unseen: (UInt8, UInt8, UInt8) = (170, 170, 170)

    private let lock = NSLock()
    private var samples: [Key: Sample] = [:]
    private var busy = false

    private static func key(_ point: SIMD3<Float>) -> Key {
        Key(x: Int32((point.x / cell).rounded(.down)), y: Int32((point.y / cell).rounded(.down)), z: Int32((point.z / cell).rounded(.down)))
    }

    /// The colour of a world point, grey if it was never seen.
    func color(at point: SIMD3<Float>) -> (UInt8, UInt8, UInt8) {
        lock.withLock {
            guard let sample = samples[Self.key(point)] else { return Self.unseen }
            return (sample.r, sample.g, sample.b)
        }
    }

    /// Takes the colours of one camera frame onto the mesh points it sees. Skipped while the
    /// previous frame is still being worked on, so scanning never waits for it.
    func add(frame: ARFrame, anchors: [ARMeshAnchor]) {
        let start = lock.withLock { () -> Bool in
            if busy || anchors.isEmpty { return false }
            busy = true
            return true
        }
        guard start else { return }

        Task.detached(priority: .utility) { [self] in
            merge(Self.sample(frame: frame, anchors: anchors))
        }
    }

    private func merge(_ found: [Key: Sample]) {
        lock.withLock {
            for (key, sample) in found where samples[key].map({ sample.distance < $0.distance }) ?? true {
                samples[key] = sample
            }
            busy = false
        }
    }

    private static func sample(frame: ARFrame, anchors: [ARMeshAnchor]) -> [Key: Sample] {
        let image = frame.capturedImage
        CVPixelBufferLockBaseAddress(image, .readOnly)
        defer { CVPixelBufferUnlockBaseAddress(image, .readOnly) }
        guard CVPixelBufferGetPlaneCount(image) == 2,
              let luma = CVPixelBufferGetBaseAddressOfPlane(image, 0),
              let chroma = CVPixelBufferGetBaseAddressOfPlane(image, 1)
        else { return [:] }
        let width = CVPixelBufferGetWidthOfPlane(image, 0)
        let height = CVPixelBufferGetHeightOfPlane(image, 0)
        let lumaStride = CVPixelBufferGetBytesPerRowOfPlane(image, 0)
        let chromaStride = CVPixelBufferGetBytesPerRowOfPlane(image, 1)

        let depthMap = frame.sceneDepth?.depthMap
        if let depthMap { CVPixelBufferLockBaseAddress(depthMap, .readOnly) }
        defer { if let depthMap { CVPixelBufferUnlockBaseAddress(depthMap, .readOnly) } }
        let depthWidth = depthMap.map { CVPixelBufferGetWidth($0) } ?? 0
        let depthHeight = depthMap.map { CVPixelBufferGetHeight($0) } ?? 0
        let depthBase = depthMap.flatMap { CVPixelBufferGetBaseAddress($0) }
        let depthStride = depthMap.map { CVPixelBufferGetBytesPerRow($0) } ?? 0

        // The captured image is the sensor's, landscape; the intrinsics are for that image.
        let intrinsics = frame.camera.intrinsics
        let (fx, fy, cx, cy) = (intrinsics[0][0], intrinsics[1][1], intrinsics[2][0], intrinsics[2][1])
        let view = frame.camera.transform.inverse

        var found: [Key: Sample] = [:]
        for anchor in anchors {
            let toCamera = view * anchor.transform
            let vertices = anchor.geometry.vertices
            for index in 0..<vertices.count {
                let local = MeshCollector.vertex(vertices, index)
                let seen = toCamera * SIMD4<Float>(local, 1)
                // The camera looks down its own -z.
                let distance = -seen.z
                guard distance > 0.1, distance < farthest else { continue }
                let u = fx * seen.x / distance + cx
                let v = cy - fy * seen.y / distance
                guard u >= 0, v >= 0, u < Float(width), v < Float(height) else { continue }

                if let depthBase, depthWidth > 0 {
                    let du = min(depthWidth - 1, Int(u / Float(width) * Float(depthWidth)))
                    let dv = min(depthHeight - 1, Int(v / Float(height) * Float(depthHeight)))
                    let depth = depthBase.advanced(by: dv * depthStride).assumingMemoryBound(to: Float32.self)[du]
                    if depth > 0, distance > depth + hiddenBy { continue }
                }

                let (px, py) = (Int(u), Int(v))
                let y = Float(luma.advanced(by: py * lumaStride + px).assumingMemoryBound(to: UInt8.self).pointee)
                let chromaPair = chroma.advanced(by: (py / 2) * chromaStride + (px / 2) * 2).assumingMemoryBound(to: UInt8.self)
                let (cb, cr) = (Float(chromaPair[0]) - 128, Float(chromaPair[1]) - 128)
                // Video-range YCbCr to RGB.
                let scaled = 1.164 * (y - 16)
                let rgb = (
                    clamp(scaled + 1.596 * cr),
                    clamp(scaled - 0.392 * cb - 0.813 * cr),
                    clamp(scaled + 2.017 * cb)
                )

                let world = anchor.transform * SIMD4<Float>(local, 1)
                let cellKey = key(SIMD3(world.x, world.y, world.z))
                if found[cellKey].map({ distance < $0.distance }) ?? true {
                    found[cellKey] = Sample(r: rgb.0, g: rgb.1, b: rgb.2, distance: distance)
                }
            }
        }
        return found
    }

    private static func clamp(_ value: Float) -> UInt8 {
        UInt8(max(0, min(255, value)))
    }
}
