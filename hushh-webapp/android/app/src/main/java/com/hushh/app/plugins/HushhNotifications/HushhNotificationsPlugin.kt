package com.hushh.app.plugins.HushhNotifications

import android.util.Log
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.hushh.app.plugins.shared.BackendUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.util.concurrent.TimeUnit

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
@CapacitorPlugin(name = "HushhNotifications")
class HushhNotificationsPlugin : Plugin() {

    private val TAG = "HushhNotifications"

    private val httpClient = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .writeTimeout(30, TimeUnit.SECONDS)
        .build()

    private val defaultBackendUrl = "https://consent-protocol-1006304528804.us-central1.run.app"

    private fun normalizeBackendUrl(raw: String): String {
        return BackendUrl.normalize(raw)
    }

    private fun getBackendUrl(call: PluginCall? = null): String {
        val callUrl = call?.getString("backendUrl")
        if (!callUrl.isNullOrBlank()) return normalizeBackendUrl(callUrl)

        val pluginUrl = bridge.config.getString("plugins.HushhNotifications.backendUrl")
        if (!pluginUrl.isNullOrBlank()) return normalizeBackendUrl(pluginUrl)

        val envUrl = System.getenv("NEXT_PUBLIC_BACKEND_URL")
        if (!envUrl.isNullOrBlank()) return normalizeBackendUrl(envUrl)

        return normalizeBackendUrl(defaultBackendUrl)
    }

    @PluginMethod
    fun registerPushToken(call: PluginCall) {
        val userId = call.getString("userId")
        val token = call.getString("token")
        val platform = call.getString("platform")
        val idToken = call.getString("idToken")

        if (userId.isNullOrBlank() || token.isNullOrBlank() || platform.isNullOrBlank() || idToken.isNullOrBlank()) {
            call.reject("Missing required parameters: userId, token, platform, idToken")
            return
        }

        val backendUrl = getBackendUrl(call)
        val url = "$backendUrl/api/notifications/register"

        Thread {
            try {
                val bodyJson = JSONObject()
                    .put("user_id", userId)
                    .put("token", token)
                    .put("platform", platform)
                    .toString()

                val request = Request.Builder()
                    .url(url)
                    .post(bodyJson.toRequestBody("application/json".toMediaType()))
                    .addHeader("Content-Type", "application/json")
                    .addHeader("Authorization", "Bearer $idToken")
                    .build()

                val response = httpClient.newCall(request).execute()
                val responseBody = response.body?.string() ?: "{}"

                if (!response.isSuccessful) {
                    Log.w(TAG, "registerPushToken non-OK: ${response.code} body=$responseBody")
                    activity.runOnUiThread {
                        call.resolve(JSObject().put("success", false))
                    }
                    return@Thread
                }

                activity.runOnUiThread {
                    call.resolve(JSObject().put("success", true))
                }
            } catch (e: Exception) {
                Log.e(TAG, "registerPushToken error", e)
                activity.runOnUiThread {
                    call.reject("Network error: ${e.message}")
                }
            }
        }.start()
    }

    @PluginMethod
    fun unregisterPushToken(call: PluginCall) {
        val userId = call.getString("userId")
        val idToken = call.getString("idToken")
        val platform = call.getString("platform")

        if (userId.isNullOrBlank() || idToken.isNullOrBlank()) {
            call.reject("Missing required parameters: userId, idToken")
            return
        }

        val backendUrl = getBackendUrl(call)
        val url = "$backendUrl/api/notifications/unregister"

        Thread {
            try {
                val bodyObj = JSONObject().put("user_id", userId)
                if (!platform.isNullOrBlank()) bodyObj.put("platform", platform)

                val request = Request.Builder()
                    .url(url)
                    .delete(bodyObj.toString().toRequestBody("application/json".toMediaType()))
                    .addHeader("Content-Type", "application/json")
                    .addHeader("Authorization", "Bearer $idToken")
                    .build()

                val response = httpClient.newCall(request).execute()
                val responseBody = response.body?.string() ?: "{}"

                if (!response.isSuccessful) {
                    Log.w(TAG, "unregisterPushToken non-OK: ${response.code} body=$responseBody")
                    activity.runOnUiThread {
                        call.resolve(JSObject().put("success", false))
                    }
                    return@Thread
                }

                activity.runOnUiThread {
                    call.resolve(JSObject().put("success", true))
                }
            } catch (e: Exception) {
                Log.e(TAG, "unregisterPushToken error", e)
                activity.runOnUiThread {
                    call.reject("Network error: ${e.message}")
                }
            }
        }.start()
    }
}
