import Foundation
import UIKit

@MainActor
final class CanaryModel: ObservableObject {
    @Published var loginURL: URL?
    @Published var title = "Admin-Canary bereit"
    @Published var status = "Starte den Test ueber den Telegram-Button."
    @Published var isConnected = false

    private let canaryEndpoint = URL(string: "https://dpmohkrwdlicexwcrqfy.supabase.co/functions/v1/kleinanzeigen-mobile-canary")!
    private let bridgeEndpoint = URL(string: "https://dpmohkrwdlicexwcrqfy.supabase.co/functions/v1/kleinanzeigen-callback-bridge")!
    private let callbackHost = "login.kleinanzeigen.de"
    private let callbackPath = "/android/com.ebay.kleinanzeigen/callback"

    func handleDeepLink(_ url: URL) {
        guard url.scheme == "traumwohnung-ka-canary", url.host == "start" else { return }
        guard let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
              let state = components.queryItems?.first(where: { $0.name == "state" })?.value,
              !state.isEmpty else {
            fail("Ungueltiger Canary-Link.")
            return
        }

        title = "Kleinanzeigen wird geoeffnet"
        status = "Der Admin-Test wird vorbereitet."
        isConnected = false
        loginURL = nil

        Task { await loadLoginURL(state: state) }
    }

    private func loadLoginURL(state: String) async {
        var components = URLComponents(url: canaryEndpoint, resolvingAgainstBaseURL: false)!
        components.queryItems = [
            URLQueryItem(name: "api", value: "login"),
            URLQueryItem(name: "state", value: state)
        ]
        guard let url = components.url else {
            fail("Canary-URL konnte nicht erstellt werden.")
            return
        }

        do {
            var request = URLRequest(url: url)
            request.cachePolicy = .reloadIgnoringLocalCacheData
            request.timeoutInterval = 20
            let (data, response) = try await URLSession.shared.data(for: request)
            guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
                throw CanaryError.invalidResponse
            }
            let payload = try JSONDecoder().decode(LoginResponse.self, from: data)
            guard payload.ok, let parsed = URL(string: payload.url) else {
                throw CanaryError.invalidResponse
            }
            loginURL = parsed
            title = "Kleinanzeigen Login"
            status = "Melde dich normal bei Kleinanzeigen an."
        } catch {
            fail("Der mobile Canary konnte den Login nicht laden.")
        }
    }

    func shouldIntercept(_ url: URL) -> Bool {
        guard url.scheme == "https",
              url.host == callbackHost,
              url.path == callbackPath else { return false }
        guard let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
              components.queryItems?.contains(where: { $0.name == "state" && !($0.value ?? "").isEmpty }) == true else {
            return false
        }
        let hasCode = components.queryItems?.contains(where: { $0.name == "code" && !($0.value ?? "").isEmpty }) == true
        let hasError = components.queryItems?.contains(where: { $0.name == "error" && !($0.value ?? "").isEmpty }) == true
        return hasCode || hasError
    }

    func relayCallback(_ callbackURL: URL) {
        loginURL = nil
        title = "Verbindung wird abgeschlossen"
        status = "Der Ruecksprung wird sicher an den bestehenden Token-Exchange uebergeben."

        Task {
            do {
                var request = URLRequest(url: bridgeEndpoint)
                request.httpMethod = "POST"
                request.timeoutInterval = 35
                request.setValue("application/json", forHTTPHeaderField: "Content-Type")
                request.cachePolicy = .reloadIgnoringLocalCacheData
                request.httpBody = try JSONEncoder().encode(BridgeRequest(callbackUrl: callbackURL.absoluteString))

                let (data, response) = try await URLSession.shared.data(for: request)
                guard let http = response as? HTTPURLResponse else { throw CanaryError.invalidResponse }
                let payload = try JSONDecoder().decode(BridgeResponse.self, from: data)
                guard http.statusCode == 200, payload.ok, payload.status == "connected" else {
                    throw CanaryError.bridge(payload.error ?? "bridge_failed")
                }

                isConnected = true
                title = "Kleinanzeigen verbunden"
                status = "Der Admin-Canary war erfolgreich. Telegram wird geoeffnet."
                try? await Task.sleep(for: .milliseconds(350))
                openTelegram()
            } catch {
                fail("Der automatische Ruecksprung ist fehlgeschlagen. Nutze in Telegram den bisherigen Share-Flow als Fallback.")
            }
        }
    }

    func openTelegram() {
        let candidates = [
            URL(string: "tg://resolve?domain=traumwohnunghamburgbot&start=ka_connected"),
            URL(string: "https://t.me/traumwohnunghamburgbot?start=ka_connected")
        ].compactMap { $0 }

        guard let first = candidates.first else { return }
        UIApplication.shared.open(first, options: [:]) { success in
            if !success, candidates.count > 1 {
                UIApplication.shared.open(candidates[1])
            }
        }
    }

    private func fail(_ message: String) {
        loginURL = nil
        isConnected = false
        title = "Canary nicht abgeschlossen"
        status = message
    }
}

private struct LoginResponse: Decodable {
    let ok: Bool
    let url: String
}

private struct BridgeRequest: Encodable {
    let callbackUrl: String
}

private struct BridgeResponse: Decodable {
    let ok: Bool
    let status: String?
    let error: String?
}

private enum CanaryError: Error {
    case invalidResponse
    case bridge(String)
}
