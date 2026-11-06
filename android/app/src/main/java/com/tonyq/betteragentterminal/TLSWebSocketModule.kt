package com.tonyq.betteragentterminal

import com.facebook.react.bridge.*
import com.facebook.react.modules.core.DeviceEventManagerModule
import okhttp3.*
import okio.ByteString
import okio.ByteString.Companion.toByteString
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.net.InetSocketAddress
import java.net.Proxy
import android.os.SystemClock
import java.security.MessageDigest
import java.security.cert.X509Certificate
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicLong
import java.util.zip.GZIPOutputStream
import javax.net.ssl.*

class TLSWebSocketModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    companion object {
        const val NAME = "TLSWebSocket"
        private val BAT_GZIP_MAGIC = "BATGZIP1\u0000".toByteArray(Charsets.US_ASCII)
    }

    override fun getName() = NAME

    private var webSocket: WebSocket? = null
    private var client: OkHttpClient? = null
    private class TransportStats(val connectionId: String) {
        val sent = AtomicLong()
        val received = AtomicLong()
        val lastReceiveAt = AtomicLong(SystemClock.elapsedRealtime())
    }
    private var transportStats: TransportStats? = null

    private fun reportTransport(stats: TransportStats, socket: WebSocket?, phase: String) {
        emit("TLSWebSocket_onState", Arguments.createMap().apply {
            putString("connectionId", stats.connectionId)
            putString("state", "transport-$phase")
            putString("message", "queuedBytes=${socket?.queueSize() ?: 0} sent=${stats.sent.get()} received=${stats.received.get()} receiveSilentMs=${SystemClock.elapsedRealtime() - stats.lastReceiveAt.get()}")
        })
    }

    private fun sendFailed(stats: TransportStats, socket: WebSocket?, message: String) {
        reportTransport(stats, socket, "send-failed")
        emit("TLSWebSocket_onError", Arguments.createMap().apply {
            putString("connectionId", stats.connectionId)
            putString("message", message)
        })
    }

    @ReactMethod
    fun inspectTransport() {
        transportStats?.let { reportTransport(it, webSocket, "probe") }
    }

    private fun emit(eventName: String, params: WritableMap) {
        reactApplicationContext
            .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            .emit(eventName, params)
    }

    @ReactMethod
    fun connect(url: String, fingerprint: String?, connectionId: String?) {
        close(1000, "reconnect")

        val normalizedFP = fingerprint?.uppercase()?.replace(":", "")
        val currentConnectionId = connectionId ?: ""
        val stats = TransportStats(currentConnectionId)
        transportStats = stats
        val startedAt = SystemClock.elapsedRealtime()
        fun timing(phase: String) {
            emit("TLSWebSocket_onTiming", Arguments.createMap().apply {
                putString("connectionId", currentConnectionId)
                putString("phase", phase)
                putDouble("elapsedMs", (SystemClock.elapsedRealtime() - startedAt).toDouble())
            })
        }
        timing("native-start")

        val trustManager = object : X509TrustManager {
            override fun checkClientTrusted(chain: Array<X509Certificate>, authType: String) {}

            override fun checkServerTrusted(chain: Array<X509Certificate>, authType: String) {
                if (normalizedFP.isNullOrEmpty()) return

                val cert = chain[0]
                val sha256 = MessageDigest.getInstance("SHA-256").digest(cert.encoded)
                val actual = sha256.joinToString("") { "%02X".format(it) }

                if (actual != normalizedFP) {
                    val expectedColonated = normalizedFP.chunked(2).joinToString(":")
                    val actualColonated = actual.chunked(2).joinToString(":")
                    throw javax.net.ssl.SSLException(
                        "TLS fingerprint mismatch. Expected: $expectedColonated, Got: $actualColonated"
                    )
                }
            }

            override fun getAcceptedIssuers(): Array<X509Certificate> = arrayOf()
        }

        val sslContext = SSLContext.getInstance("TLS")
        sslContext.init(null, arrayOf<TrustManager>(trustManager), null)

        val hostnameVerifier = HostnameVerifier { _, _ -> true }

        client = OkHttpClient.Builder()
            .eventListener(object : okhttp3.EventListener() {
                override fun connectStart(call: Call, address: InetSocketAddress, proxy: Proxy) {
                    timing("tcp-start")
                }
                override fun secureConnectStart(call: Call) { timing("tls-start") }
                override fun secureConnectEnd(call: Call, handshake: Handshake?) { timing("tls-end") }
                override fun connectEnd(call: Call, address: InetSocketAddress, proxy: Proxy, protocol: Protocol?) {
                    timing("connect-end")
                }
                override fun connectFailed(call: Call, address: InetSocketAddress, proxy: Proxy, protocol: Protocol?, ioe: IOException) {
                    timing("connect-failed")
                }
                override fun responseHeadersStart(call: Call) { timing("upgrade-response-start") }
                override fun responseHeadersEnd(call: Call, response: Response) { timing("upgrade-response-end") }
            })
            .sslSocketFactory(sslContext.socketFactory, trustManager)
            .hostnameVerifier(hostnameVerifier)
            .pingInterval(0, TimeUnit.SECONDS)
            .readTimeout(0, TimeUnit.SECONDS)
            .connectTimeout(15, TimeUnit.SECONDS)
            .build()

        val request = Request.Builder().url(url).build()

        webSocket = client!!.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                timing("websocket-open")
                emit("TLSWebSocket_onOpen", Arguments.createMap().apply {
                    putString("connectionId", currentConnectionId)
                })
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                stats.received.incrementAndGet()
                stats.lastReceiveAt.set(SystemClock.elapsedRealtime())
                emit("TLSWebSocket_onMessage", Arguments.createMap().apply {
                    putString("connectionId", currentConnectionId)
                    putString("data", text)
                })
            }

            override fun onMessage(webSocket: WebSocket, bytes: ByteString) {
                stats.received.incrementAndGet()
                stats.lastReceiveAt.set(SystemClock.elapsedRealtime())
                try {
                    val text = BatGzipFrameDecoder.decode(bytes)
                    emit("TLSWebSocket_onMessage", Arguments.createMap().apply {
                        putString("connectionId", currentConnectionId)
                        putString("data", text)
                    })
                } catch (error: Exception) {
                    emit("TLSWebSocket_onError", Arguments.createMap().apply {
                        putString("connectionId", currentConnectionId)
                        putString("message", error.message ?: "Invalid binary WebSocket frame")
                    })
                }
            }

            override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
                webSocket.close(code, reason)
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                emit("TLSWebSocket_onClose", Arguments.createMap().apply {
                    putString("connectionId", currentConnectionId)
                    putInt("code", code)
                    putString("reason", reason)
                })
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                timing("websocket-failed")
                reportTransport(stats, webSocket, "failed")
                emit("TLSWebSocket_onError", Arguments.createMap().apply {
                    putString("connectionId", currentConnectionId)
                    putString("message", "${t.javaClass.simpleName}: ${t.message ?: "WebSocket failure"}")
                })
            }
        })
    }

    @ReactMethod
    fun send(message: String) {
        val stats = transportStats ?: return
        val socket = webSocket
        if (socket?.send(message) == true) stats.sent.incrementAndGet()
        else sendFailed(stats, socket, "WebSocket send rejected")
    }

    @ReactMethod
    fun sendGzip(message: String) {
        val stats = transportStats ?: return
        val socket = webSocket
        try {
            if (socket?.send(encodeBatGzipFrame(message)) == true) stats.sent.incrementAndGet()
            else sendFailed(stats, socket, "Gzip WebSocket send rejected")
        } catch (error: Exception) {
            sendFailed(stats, socket, error.message ?: "Gzip WebSocket send failed")
        }
    }

    @ReactMethod
    fun close(code: Int, reason: String?) {
        try {
            webSocket?.close(code, reason)
        } catch (_: Exception) {}
        webSocket = null
        transportStats = null
        client?.dispatcher?.executorService?.shutdown()
        client = null
    }

    @ReactMethod
    fun addListener(eventName: String) {}

    @ReactMethod
    fun removeListeners(count: Int) {}

    private fun encodeBatGzipFrame(message: String): ByteString {
        val compressed = ByteArrayOutputStream()
        GZIPOutputStream(compressed).use { gzip ->
            gzip.write(message.toByteArray(Charsets.UTF_8))
        }
        val payload = BAT_GZIP_MAGIC + compressed.toByteArray()
        return payload.toByteString()
    }

}
