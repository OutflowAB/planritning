// swift-tools-version: 6.2

// An app package: open SMSkanner.swiftpm in Xcode and run it on a LiDAR iPhone. RoomPlan does
// not work in the simulator.

import AppleProductTypes
import PackageDescription

let package = Package(
    name: "SM Skanner",
    platforms: [.iOS("17.0")],
    products: [
        .iOSApplication(
            name: "SM Skanner",
            targets: ["AppModule"],
            bundleIdentifier: "se.planritning.skanner",
            teamIdentifier: "",
            displayVersion: "0.1",
            bundleVersion: "1",
            appIcon: .placeholder(icon: .leaf),
            accentColor: .presetColor(.brown),
            supportedDeviceFamilies: [.phone],
            supportedInterfaceOrientations: [.portrait],
            capabilities: [
                .camera(purposeString: "Kameran och LiDAR-sensorn används för att mäta upp rummen."),
            ],
            additionalInfoPlistContentFilePath: "Info.plist"
        ),
    ],
    targets: [
        .executableTarget(
            name: "AppModule",
            path: ".",
            swiftSettings: [.defaultIsolation(MainActor.self)]
        ),
    ]
)
