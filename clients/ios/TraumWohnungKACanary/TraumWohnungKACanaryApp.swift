import SwiftUI

@main
struct TraumWohnungKACanaryApp: App {
    @StateObject private var model = CanaryModel()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(model)
                .onOpenURL { url in
                    model.handleDeepLink(url)
                }
        }
    }
}
