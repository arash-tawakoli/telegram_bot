import SwiftUI

struct ContentView: View {
    @EnvironmentObject var model: CanaryModel

    var body: some View {
        NavigationStack {
            Group {
                if let loginURL = model.loginURL {
                    LoginWebView(loginURL: loginURL, model: model)
                        .ignoresSafeArea(edges: .bottom)
                } else {
                    VStack(spacing: 16) {
                        Image(systemName: model.isConnected ? "checkmark.circle.fill" : "link.circle")
                            .font(.system(size: 54))
                        Text(model.title)
                            .font(.title2.bold())
                        Text(model.status)
                            .multilineTextAlignment(.center)
                            .foregroundStyle(.secondary)
                        if model.isConnected {
                            Button("Zurueck zu Telegram") {
                                model.openTelegram()
                            }
                            .buttonStyle(.borderedProminent)
                        }
                    }
                    .padding(24)
                }
            }
            .navigationTitle("Kleinanzeigen Canary")
            .navigationBarTitleDisplayMode(.inline)
        }
    }
}
