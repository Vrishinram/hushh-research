import Foundation
import Capacitor

/**
 * HushhNotificationsPlugin - Push token registration (Capacitor 8)
 *
 * Next.js source of truth:
 * - POST   /api/notifications/register
 * - DELETE /api/notifications/unregister
 *
 * Backend expects Firebase ID token in Authorization: Bearer <idToken>
 * Body:
 * - register: { user_id, token, platform }
 * - unregister: { user_id, platform? }
 */
@objc(HushhNotificationsPlugin)
public class HushhNotificationsPlugin: CAPPlugin, CAPBridgedPlugin {

    public let identifier = "HushhNotificationsPlugin"
    public let jsName = "HushhNotifications"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "registerPushToken", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "unregisterPushToken", returnType: CAPPluginReturnPromise)
    ]

    private let TAG = "HushhNotifications"

    private var defaultBackendUrl: String {
        return (bridge?.config.getPluginConfig(jsName).getString("backendUrl"))
            ?? "https://consent-protocol-1006304528804.us-central1.run.app"
    }

    private func getBackendUrl(_ call: CAPPluginCall) -> String {
        if let url = call.getString("backendUrl"), !url.isEmpty {
            return url
        }
        if let url = bridge?.config.getPluginConfig(jsName).getString("backendUrl"), !url.isEmpty {
            return url
        }
        return defaultBackendUrl
    }

    private lazy var urlSession: URLSession = {
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 30
        config.timeoutIntervalForResource = 30
        return URLSession(configuration: config)
    }()

    @objc func registerPushToken(_ call: CAPPluginCall) {
        guard let userId = call.getString("userId"),
              let token = call.getString("token"),
              let platform = call.getString("platform"),
              let idToken = call.getString("idToken") else {
            call.reject("Missing required parameters: userId, token, platform, idToken")
            return
        }

        let backendUrl = getBackendUrl(call)
        let urlStr = "\(backendUrl)/api/notifications/register"

        guard let url = URL(string: urlStr) else {
            call.reject("Invalid URL")
            return
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(idToken)", forHTTPHeaderField: "Authorization")

        let body: [String: Any] = [
            "user_id": userId,
            "token": token,
            "platform": platform
        ]
        request.httpBody = try? JSONSerialization.data(withJSONObject: body)

        urlSession.dataTask(with: request) { [weak self] data, response, error in
            guard let self = self else { return }

            if let error = error {
                print("❌ [\(self.TAG)] registerPushToken network error: \(error.localizedDescription)")
                call.reject("Network error: \(error.localizedDescription)")
                return
            }

            guard let http = response as? HTTPURLResponse else {
                call.reject("Invalid response")
                return
            }

            if !(200...299).contains(http.statusCode) {
                let bodyStr = data.flatMap { String(data: $0, encoding: .utf8) } ?? ""
                print("⚠️ [\(self.TAG)] registerPushToken non-OK: \(http.statusCode) body=\(bodyStr)")
                call.resolve(["success": false])
                return
            }

            call.resolve(["success": true])
        }.resume()
    }

    @objc func unregisterPushToken(_ call: CAPPluginCall) {
        guard let userId = call.getString("userId"),
              let idToken = call.getString("idToken") else {
            call.reject("Missing required parameters: userId, idToken")
            return
        }

        let platform = call.getString("platform")
        let backendUrl = getBackendUrl(call)
        let urlStr = "\(backendUrl)/api/notifications/unregister"

        guard let url = URL(string: urlStr) else {
            call.reject("Invalid URL")
            return
        }

        var request = URLRequest(url: url)
        request.httpMethod = "DELETE"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(idToken)", forHTTPHeaderField: "Authorization")

        var body: [String: Any] = ["user_id": userId]
        if let platform = platform, !platform.isEmpty {
            body["platform"] = platform
        }
        request.httpBody = try? JSONSerialization.data(withJSONObject: body)

        urlSession.dataTask(with: request) { [weak self] data, response, error in
            guard let self = self else { return }

            if let error = error {
                print("❌ [\(self.TAG)] unregisterPushToken network error: \(error.localizedDescription)")
                call.reject("Network error: \(error.localizedDescription)")
                return
            }

            guard let http = response as? HTTPURLResponse else {
                call.reject("Invalid response")
                return
            }

            if !(200...299).contains(http.statusCode) {
                let bodyStr = data.flatMap { String(data: $0, encoding: .utf8) } ?? ""
                print("⚠️ [\(self.TAG)] unregisterPushToken non-OK: \(http.statusCode) body=\(bodyStr)")
                call.resolve(["success": false])
                return
            }

            call.resolve(["success": true])
        }.resume()
    }
}
