package com.hushh.app.plugins.shared

/**
 * BackendUrl
 *
 * Shared backend URL normalization for Android emulator:
 * - host loopback (localhost/127.0.0.1) must be rewritten to 10.0.2.2
 */
object BackendUrl {
    fun normalize(raw: String): String {
        return when {
            raw.contains("localhost") -> raw.replace("localhost", "10.0.2.2")
            raw.contains("127.0.0.1") -> raw.replace("127.0.0.1", "10.0.2.2")
            else -> raw
        }
    }
}
