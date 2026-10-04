package com.tonyq.betteragentterminal

import java.io.ByteArrayOutputStream
import java.io.IOException
import java.util.zip.GZIPOutputStream
import okio.Buffer
import okio.ByteString
import okio.ByteString.Companion.toByteString
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class BatGzipFrameDecoderTest {
    private val magic = "BATGZIP1\u0000".toByteArray(Charsets.US_ASCII)

    private fun frame(text: String): ByteString {
        val output = ByteArrayOutputStream()
        output.write(magic)
        GZIPOutputStream(output).use { it.write(text.toByteArray(Charsets.UTF_8)) }
        return output.toByteArray().toByteString()
    }

    @Test fun smallFramesAndEmptyText() {
        for (text in listOf("", "{\"type\":\"pong\"}", "繁體中文／emoji 🎮")) {
            assertEquals(text, BatGzipFrameDecoder.decode(frame(text)))
        }
    }

    @Test fun unicodeAcrossChunkBoundariesInLargeHistory() {
        val text = "a".repeat(8191) + "🎮中" + "工作階段 🚀 café\n".repeat(20_000)
        assertEquals(text, BatGzipFrameDecoder.decode(frame(text)))
    }

    @Test fun segmentedOkHttpFrames() {
        val text = (0..40_000).joinToString("\n") { "entry $it ${it * 7919L}：載入" }
        val segmented = Buffer().write(frame(text)).readByteString()
        assertEquals(text, BatGzipFrameDecoder.decode(segmented))
    }

    @Test fun unsupportedEnvelope() {
        for (payload in listOf(ByteString.EMPTY, "BATGZIP1".toByteArray().toByteString(), frame("ok").substring(1))) {
            assertThrows(IllegalArgumentException::class.java) { BatGzipFrameDecoder.decode(payload) }
        }
    }

    @Test fun damagedAndTruncatedFramesNeverEmitPartialText() {
        for (text in listOf("small", "large history 中🎮".repeat(20_000))) {
            val payload = frame(text)
            val damaged = payload.toByteArray()
            damaged[damaged.size - 8] = (damaged[damaged.size - 8].toInt() xor 1).toByte()
            assertThrows(IOException::class.java) { BatGzipFrameDecoder.decode(damaged.toByteString()) }
            assertThrows(IOException::class.java) { BatGzipFrameDecoder.decode(payload.substring(0, payload.size - 5)) }
        }
    }

    @Test fun concatenatedGzipMembersRemainCompatible() {
        val text = "第一段🎮".repeat(15_000)
        val first = frame(text)
        val joined = Buffer().write(first).write(frame("第二段").substring(magic.size)).readByteString()
        assertEquals(text + "第二段", BatGzipFrameDecoder.decode(joined))
    }
}
