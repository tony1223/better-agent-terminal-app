package com.tonyq.betteragentterminal

import java.io.ByteArrayOutputStream
import java.io.IOException
import java.io.InputStream
import java.util.zip.GZIPInputStream
import okio.ByteString

/** Decode directly from OkHttp's immutable frame, without copying compressed bytes. */
internal object BatGzipFrameDecoder {
    private val magic = "BATGZIP1\u0000".toByteArray(Charsets.US_ASCII)
    private const val CHUNK_SIZE = 8192
    private const val SMALL_TEXT_BYTES = 64 * 1024

    fun decode(payload: ByteString): String {
        if (!payload.rangeEquals(0, magic, 0, magic.size)) {
            throw IllegalArgumentException("BAT gzip frame has unsupported envelope")
        }

        fun input() = GZIPInputStream(FrameInputStream(payload, magic.size), CHUNK_SIZE)

        // Most events are small and need one pass. For a large history frame,
        // count inflated bytes first instead of growing a full byte/char
        // buffer repeatedly. The second pass writes into one exact-size array.
        // Never trust the gzip trailer's ISIZE as an allocation size.
        val chunk = ByteArray(CHUNK_SIZE)
        var small: ByteArrayOutputStream? = ByteArrayOutputStream()
        var count = 0
        input().use { input ->
            while (true) {
                val read = input.read(chunk)
                if (read < 0) break
                if (count > Int.MAX_VALUE - read) throw IOException("BAT gzip text is too large")
                count += read
                if (count <= SMALL_TEXT_BYTES) small?.write(chunk, 0, read)
                else small = null
            }
        }
        small?.let { return it.toString(Charsets.UTF_8.name()) }

        val text = ByteArray(count)
        input().use { input ->
            var offset = 0
            while (offset < count) {
                val read = input.read(text, offset, count - offset)
                if (read < 0) throw IOException("BAT gzip text ended unexpectedly")
                offset += read
            }
            // Read through EOF to validate the trailer/CRC before emitting.
            if (input.read() != -1) throw IOException("BAT gzip text length changed")
        }
        // React Native needs a String, so UTF-8 conversion still allocates its
        // result. No copied compressed frame or growing output buffer remains.
        return String(text, Charsets.UTF_8)
    }

    private class FrameInputStream(private val bytes: ByteString, offset: Int) : InputStream() {
        private var position = offset

        override fun read(): Int =
            if (position < bytes.size) bytes[position++].toInt() and 0xff else -1

        override fun read(target: ByteArray, offset: Int, length: Int): Int {
            if (offset < 0 || length < 0 || offset > target.size - length) throw IndexOutOfBoundsException()
            if (length == 0) return 0
            val count = minOf(length, bytes.size - position)
            if (count == 0) return -1
            bytes.copyInto(position, target, offset, count)
            position += count
            return count
        }

        override fun available(): Int = bytes.size - position
    }
}
