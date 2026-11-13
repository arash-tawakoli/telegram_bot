import SwiftUI
import UIKit

private struct CompleteResponse: Decodable {
    let status: String?
    let authenticated: Bool?
    let error: String?
}

@MainActor
final class CallbackModel: ObservableObject {
    enum Phase {
        case idle
        case sending
        case connected
        case failed(String)
    }

    @Published var phase: Phase = .idle

    private let endpoint = URL(string: "https://traumwohnung-housing-runtime.arash-ce5.workers.dev/edge/provider/facade")!

    func handle(url: URL) async {
        guard url.scheme?.lowercased() == "immobilienscout24.de",
              url.host == nil,
              url.path == "/loginCallback" else {
            phase = .failed("Ungültiger ImmoScout24-Rücksprung.")
            return
        }

        let components = URLComponents(url: url, resolvingAgainstBaseURL: false)
        let queryItems = components?.queryItems ?? []
        let fragmentItems = URLComponents(string: "https://local.invalid/?\(components?.fragment ?? "")")?.queryItems ?? []
        let values = Dictionary(uniqueKeysWithValues: (queryItems + fragmentItems).map { ($0.name, $0.value ?? "") })
        guard !values["state", default: ""].isEmpty,
              !values["code", default: ""].isEmpty || !values["error", default: ""].isEmpty else {
            phase = .failed("Der OAuth-Rücksprung ist unvollständig.")
            return
        }

        phase = .sending
        do {
            var request = URLRequest(url: endpoint)
            request.httpMethod = "POST"
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.cachePolicy = .reloadIgnoringLocalCacheData
            request.httpBody = try JSONSerialization.data(withJSONObject: [
                "action": "complete_web",
                "ticket": values["state"] ?? "",
                "callbackUrl": url.absoluteString,
            ])

            let (data, response) = try await URLSession.shared.data(for: request)
            guard let http = response as? HTTPURLResponse else {
                phase = .failed("Keine gültige Serverantwort erhalten.")
                return
            }
            let result = try? JSONDecoder().decode(CompleteResponse.self, from: data)
            if (200..<300).contains(http.statusCode), result?.authenticated == true || result?.status == "connected" {
                phase = .connected
            } else {
                let code = result?.error ?? "handoff_failed"
                phase = .failed("Verbindung fehlgeschlagen (\(code)). Starte den Login erneut in Telegram.")
            }
        } catch {
            phase = .failed("Der Rücksprung konnte nicht an den Bot übergeben werden.")
        }
    }

    func openTelegram() {
        guard let url = URL(string: "tg://resolve?domain=traumwohnunghamburgbot") else { return }
        UIApplication.shared.open(url)
    }
}

@main
struct TraumwohnungImmoScoutHandoffApp: App {
    @StateObject private var model = CallbackModel()

    var body: some Scene {
        WindowGroup {
            ContentView(model: model)
                .onOpenURL { url in
                    Task { await model.handle(url: url) }
                }
        }
    }
}

struct ContentView: View {
    @ObservedObject var model: CallbackModel

    var body: some View {
        VStack(spacing: 18) {
            Image(systemName: icon)
                .font(.system(size: 54, weight: .semibold))
            Text("ImmoScout24 verbinden")
                .font(.title2.bold())
            Text(message)
                .multilineTextAlignment(.center)
                .foregroundStyle(.secondary)

            if case .connected = model.phase {
                Button("Zurück zu Telegram") { model.openTelegram() }
                    .buttonStyle(.borderedProminent)
            }

            if case .sending = model.phase {
                ProgressView()
            }
        }
        .padding(28)
    }

    private var icon: String {
        switch model.phase {
        case .connected: return "checkmark.circle.fill"
        case .failed: return "exclamationmark.triangle.fill"
        case .sending: return "arrow.triangle.2.circlepath"
        case .idle: return "link.circle"
        }
    }

    private var message: String {
        switch model.phase {
        case .idle:
            return "Öffne den ImmoScout24-Login aus dem Telegram-Bot. Passwort und Zwei-Faktor-Bestätigung bleiben vollständig bei ImmoScout24."
        case .sending:
            return "Der einmalige OAuth-Rücksprung wird sicher an den Bot übergeben …"
        case .connected:
            return "ImmoScout24 ist verbunden. Der Bot hat ausschließlich die OAuth-Tokens verschlüsselt gespeichert."
        case .failed(let message):
            return message
        }
    }
}
