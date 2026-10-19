import RoomPlan
import SwiftUI

/// RoomPlan's own scanning view: live coaching ("move closer", "slow down") and the room
/// building up in 3D. Setting `stopRequested` ends the scan; RoomPlan then processes it and
/// `onFinish` receives the finished room.
struct RoomCaptureScreen: UIViewRepresentable {
    var stopRequested: Bool
    var onFinish: (Result<CapturedRoom, any Error>) -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator(onFinish: onFinish)
    }

    func makeUIView(context: Context) -> RoomCaptureView {
        let view = RoomCaptureView(frame: .zero)
        view.delegate = context.coordinator
        view.captureSession.run(configuration: RoomCaptureSession.Configuration())
        return view
    }

    func updateUIView(_ view: RoomCaptureView, context: Context) {
        context.coordinator.onFinish = onFinish
        if stopRequested, !context.coordinator.isStopped {
            context.coordinator.isStopped = true
            view.captureSession.stop()
        }
    }

    static func dismantleUIView(_ view: RoomCaptureView, coordinator: Coordinator) {
        if !coordinator.isStopped {
            view.captureSession.stop()
        }
    }

    // NSCoding (inherited by the delegate protocol) needs a stable Objective-C name for a nested class.
    @objc(SMRoomCaptureCoordinator)
    final class Coordinator: NSObject, @preconcurrency RoomCaptureViewDelegate {
        var onFinish: (Result<CapturedRoom, any Error>) -> Void
        var isStopped = false

        init(onFinish: @escaping (Result<CapturedRoom, any Error>) -> Void) {
            self.onFinish = onFinish
            super.init()
        }

        // The delegate protocol inherits NSCoding; this object is never archived.
        nonisolated required init?(coder: NSCoder) { nil }
        nonisolated func encode(with coder: NSCoder) {}

        func captureView(shouldPresent roomDataForProcessing: CapturedRoomData, error: (any Error)?) -> Bool {
            true
        }

        func captureView(didPresent processedResult: CapturedRoom, error: (any Error)?) {
            if let error {
                onFinish(.failure(error))
            } else {
                onFinish(.success(processedResult))
            }
        }
    }
}
