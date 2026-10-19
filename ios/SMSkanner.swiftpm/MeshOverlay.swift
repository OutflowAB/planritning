import ARKit
import SceneKit
import SwiftUI

/// The LiDAR mesh drawn as a white net over the scan view, so the person scanning sees what the
/// phone has covered (experiment). RoomPlan's view draws the camera and its own outlines and
/// cannot be extended, so this is a see-through SceneKit layer above it: it reads the same
/// session, draws the mesh anchors as wireframe, and follows the camera frame by frame.
struct MeshOverlay: UIViewRepresentable {
    let session: ARSession

    func makeCoordinator() -> Coordinator { Coordinator(session: session) }

    func makeUIView(context: Context) -> SCNView {
        let view = SCNView(frame: .zero)
        view.backgroundColor = .clear
        view.isOpaque = false
        view.scene = context.coordinator.scene
        view.pointOfView = context.coordinator.cameraNode
        view.delegate = context.coordinator
        view.isPlaying = true
        view.preferredFramesPerSecond = 30
        view.antialiasingMode = .none
        view.isUserInteractionEnabled = false
        context.coordinator.view = view
        context.coordinator.start()
        return view
    }

    func updateUIView(_ view: SCNView, context: Context) {}

    static func dismantleUIView(_ view: SCNView, coordinator: Coordinator) {
        coordinator.stop()
    }

    final class Coordinator: NSObject, SCNSceneRendererDelegate {
        // Read by the render thread too; ARSession is safe to read from there.
        nonisolated(unsafe) let session: ARSession
        let scene = SCNScene()
        // Moved only by the render thread once the view runs.
        nonisolated(unsafe) let cameraNode = SCNNode()
        weak var view: SCNView?
        private var nodes: [UUID: SCNNode] = [:]
        private var timer: Timer?
        // Written on the main thread, read by the render thread: a stale value costs one frame.
        nonisolated(unsafe) private var orientation = UIInterfaceOrientation.portrait
        nonisolated(unsafe) private var viewport = CGSize(width: 390, height: 844)

        init(session: ARSession) {
            self.session = session
            cameraNode.camera = SCNCamera()
            scene.rootNode.addChildNode(cameraNode)
            super.init()
        }

        func start() {
            timer = Timer.scheduledTimer(withTimeInterval: 0.5, repeats: true) { [weak self] _ in
                MainActor.assumeIsolated { self?.refresh() }
            }
        }

        func stop() {
            timer?.invalidate()
            timer = nil
        }

        /// The mesh as it stands: new anchors added, changed ones redrawn, gone ones removed.
        private func refresh() {
            if let view {
                viewport = view.bounds.size
                orientation = view.window?.windowScene?.effectiveGeometry.interfaceOrientation ?? .portrait
            }
            let anchors = session.currentFrame?.anchors.compactMap { $0 as? ARMeshAnchor } ?? []
            let current = Set(anchors.map(\.identifier))
            for (id, node) in nodes where !current.contains(id) {
                node.removeFromParentNode()
                nodes[id] = nil
            }
            for anchor in anchors {
                let node = nodes[anchor.identifier] ?? {
                    let created = SCNNode()
                    scene.rootNode.addChildNode(created)
                    nodes[anchor.identifier] = created
                    return created
                }()
                node.simdWorldTransform = anchor.transform
                node.geometry = Self.net(of: anchor.geometry)
            }
        }

        /// A copy of the anchor's triangles, drawn as lines (ARKit changes its buffers in place).
        private static func net(of geometry: ARMeshGeometry) -> SCNGeometry {
            let vertices = geometry.vertices
            let positions = SCNGeometrySource(
                data: Data(bytes: vertices.buffer.contents() + vertices.offset, count: vertices.stride * vertices.count),
                semantic: .vertex,
                vectorCount: vertices.count,
                usesFloatComponents: true,
                componentsPerVector: 3,
                bytesPerComponent: MemoryLayout<Float>.size,
                dataOffset: 0,
                dataStride: vertices.stride
            )
            let faces = geometry.faces
            let triangles = SCNGeometryElement(
                data: Data(bytes: faces.buffer.contents(), count: faces.count * faces.indexCountPerPrimitive * faces.bytesPerIndex),
                primitiveType: .triangles,
                primitiveCount: faces.count,
                bytesPerIndex: faces.bytesPerIndex
            )
            let net = SCNGeometry(sources: [positions], elements: [triangles])
            let material = SCNMaterial()
            material.lightingModel = .constant
            material.diffuse.contents = UIColor.white.withAlphaComponent(0.55)
            material.fillMode = .lines
            material.isDoubleSided = true
            material.writesToDepthBuffer = false
            net.materials = [material]
            return net
        }

        // Every frame: the real camera's position and lens, so the net stays on the walls.
        nonisolated func renderer(_ renderer: any SCNSceneRenderer, updateAtTime time: TimeInterval) {
            guard let frame = session.currentFrame else { return }
            let camera = frame.camera
            cameraNode.simdWorldTransform = camera.viewMatrix(for: orientation).inverse
            cameraNode.camera?.projectionTransform = SCNMatrix4(
                camera.projectionMatrix(for: orientation, viewportSize: viewport, zNear: 0.05, zFar: 30)
            )
        }
    }
}
