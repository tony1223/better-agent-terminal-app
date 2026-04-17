package com.batmobile

import com.facebook.react.bridge.*
import com.facebook.react.modules.core.DeviceEventManagerModule
import okhttp3.*
import java.security.MessageDigest
import java.security.cert.X509Certificate
import java.util.concurrent.TimeUnit
import javax.net.ssl.*

class TLSWebSocketModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName() = "TLSWebSocket"

    private var webSocket: WebSocket? = null
    private var client: OkHttpClient? = null

    private fun emit(eventName: String, params: WritableMap) {
        reactApplicationContext
            .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            .emit(eventName, params)
    }

    @ReactMethod
    fun connect(url: String, fingerprint: String?) {
        close(1000, "reconnect")

        val normalizedFP = fingerprint?.uppercase()?.replace(":", "")

        val trustManager = object : X509TrustManager {
            override fun checkClientTrusted(chain: Array<X509Certificate>, authType: String) {}

            override fun checkServerTrusted(chain: Array<X509Certificate>, authType: String) {
                if (normalizedFP.isNullOrEmpty()) return

                val cert = chain[0]
                val sha256 = MessageDigest.getInstance("SHA-256").digest(cert.encoded)
                val actual = sha256.joinToString("") { "%02X".format(it) }

                if (actual != normalizedFP) {
                    val colonated = actual.chunked(2).joinToString(":")
                    throw javax.net.ssl.SSLException(
                        "TLS fingerprint mismatch. Expected: $normalizedFP, Got: $colonated"
                    )
                }
            }

            override fun getAcceptedIssuers(): Array<X509Certificate> = arrayOf()
        }

        val sslContext = SSLContext.getInstance("TLS")
        sslContext.init(null, arrayOf<TrustManager>(trustManager), null)

        val hostnameVerifier = HostnameVerifier { _, _ -> true }

        client = OkHttpClient.Builder()
            .sslSocketFactory(sslContext.socketFactory, trustManager)
            .hostnameVerifier(hostnameVerifier)
            .pingInterval(0, TimeUnit.SECONDS)
            .readTimeout(0, TimeUnit.SECONDS)
            .connectTimeout(15, TimeUnit.SECONDS)
            .build()

        val request = Request.Builder().url(url).build()

        webSocket = client!!.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                emit("TLSWebSocket_onOpen", Arguments.createMap())
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                emit("TLSWebSocket_onMessage", Arguments.createMap().apply {
                    putString("data", text)
                })
            }

            override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
                webSocket.close(code, reason)
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                emit("TLSWebSocket_onClose", Arguments.createMap().apply {
                    putInt("code", code)
                    putString("reason", reason)
                })
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                emit("TLSWebSocket_onError", Arguments.createMap().apply {
                    putString("message", t.message ?: "WebSocket failure")
                })
            }
        })
    }

    @ReactMethod
    fun send(message: String) {
        webSocket?.send(message)
    }

    @ReactMethod
    fun close(code: Int, reason: String?) {
        try {
            webSocket?.close(code, reason)
        } catch (_: Exception) {}
        webSocket = null
        client?.dispatcher?.executorService?.shutdown()
        client = null
    }

    @ReactMethod
    fun addListener(eventName: String) {}

    @ReactMethod
    fun removeListeners(count: Int) {}
}
