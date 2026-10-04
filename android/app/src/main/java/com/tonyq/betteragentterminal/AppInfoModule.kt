package com.tonyq.betteragentterminal

import android.app.ActivityManager
import android.app.ApplicationExitInfo
import android.content.Context
import android.os.Build
import android.os.Debug
import android.os.PowerManager
import android.os.Process
import android.os.SystemClock
import android.system.Os
import android.system.OsConstants
import java.io.File
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

/**
 * The version of the binary that is actually installed.
 *
 * Not read from package.json: CI stamps versionName from the release tag and
 * versionCode from the run number, so package.json never sees either. This
 * reads what the running APK declares, which is the only answer that stays
 * true for a build nobody can reproduce locally.
 *
 * Constants rather than a method — a settings row should not have to await
 * anything to render.
 */
class AppInfoModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    companion object {
        const val NAME = "AppInfo"
    }

    override fun getName() = NAME

    private data class ThreadSample(val started: Long, val ticks: Long)
    private var previousThreads = emptyMap<Int, ThreadSample>()
    private var previousThreadSampleAt = 0L

    /** Bounded reads of our own process only; sampled on the existing diagnostic cadence. */
    private fun addProcessCounters(result: com.facebook.react.bridge.WritableMap) {
        val startedAt = SystemClock.elapsedRealtime()
        try {
            File("/proc/self/status").useLines { lines ->
                lines.firstOrNull { it.startsWith("VmRSS:") }
                    ?.substringAfter(':')?.trim()?.substringBefore(' ')?.toDoubleOrNull()
                    ?.let { result.putDouble("rssKb", it) }
            }
        } catch (_: Exception) { /* Optional on devices restricting procfs. */ }
        try {
            val hz = Os.sysconf(OsConstants._SC_CLK_TCK)
            if (hz <= 0) return
            val tasks = File("/proc/self/task").listFiles() ?: return
            val current = mutableMapOf<Int, ThreadSample>()
            data class CpuDelta(val tid: Int, val kind: String, val ms: Double)
            val deltas = mutableListOf<CpuDelta>()
            for (task in tasks.take(256)) {
                try {
                    val tid = task.name.toIntOrNull() ?: continue
                    val stat = File(task, "stat").readText()
                    // comm may contain spaces and parentheses; fields after the LAST
                    // ')' start at field 3. utime/stime=14/15, starttime=22.
                    val end = stat.lastIndexOf(')')
                    val name = stat.substring(stat.indexOf('(') + 1, end)
                    val fields = stat.substring(end + 1).trim().split(Regex("\\s+"))
                    val sample = ThreadSample(fields[19].toLong(), fields[11].toLong() + fields[12].toLong())
                    current[tid] = sample
                    val before = previousThreads[tid]
                    // A new/reused TID has no comparable sample. Do not count its
                    // entire lifetime as work done during the latest interval.
                    if (before == null || before.started != sample.started || sample.ticks < before.ticks) continue
                    val kind = when {
                        tid == Process.myPid() -> "main"
                        name.contains("js", ignoreCase = true) || name.contains("hermes", ignoreCase = true) -> "javascript"
                        name.contains("Render", ignoreCase = true) || name.contains("hwui", ignoreCase = true) -> "render"
                        name.contains("Heap", ignoreCase = true) || name.contains("GC") -> "gc"
                        else -> "other"
                    }
                    deltas.add(CpuDelta(tid, kind, (sample.ticks - before.ticks) * 1000.0 / hz))
                } catch (_: Exception) { /* Threads can exit during sampling. */ }
            }
            val top = Arguments.createArray()
            deltas.filter { it.ms > 0 }.sortedByDescending { it.ms }.take(8).forEach { delta ->
                top.pushMap(Arguments.createMap().apply {
                    putInt("tid", delta.tid)
                    putString("kind", delta.kind) // No raw thread names/content.
                    putDouble("cpuMs", delta.ms)
                })
            }
            result.putArray("threadCpuTop", top)
            result.putDouble("threadSampleWindowMs", if (previousThreadSampleAt == 0L) 0.0 else (startedAt - previousThreadSampleAt).toDouble())
            result.putInt("threadsSampled", current.size)
            result.putBoolean("threadsTruncated", tasks.size > 256)
            previousThreads = current
            previousThreadSampleAt = startedAt
        } catch (_: Exception) { /* Process totals remain available without per-thread data. */ }
        finally { result.putDouble("processCountersReadMs", (SystemClock.elapsedRealtime() - startedAt).toDouble()) }
    }

    /** On demand only. CPU is cumulative process time, not a battery percentage. */
    @ReactMethod
    fun getRuntimeDiagnostics(includeExitHistory: Boolean, promise: Promise) {
        try {
            val context = reactApplicationContext
            val runtime = Runtime.getRuntime()
            val power = context.getSystemService(Context.POWER_SERVICE) as PowerManager
            val result = Arguments.createMap().apply {
                putDouble("atMs", System.currentTimeMillis().toDouble())
                putInt("pid", Process.myPid())
                putDouble("elapsedRealtimeMs", SystemClock.elapsedRealtime().toDouble())
                putDouble("uptimeMs", SystemClock.uptimeMillis().toDouble())
                putDouble("cpuTimeMs", Process.getElapsedCpuTime().toDouble())
                putDouble("javaHeapUsedBytes", (runtime.totalMemory() - runtime.freeMemory()).toDouble())
                putDouble("javaHeapLimitBytes", runtime.maxMemory().toDouble())
                putDouble("nativeHeapBytes", Debug.getNativeHeapAllocatedSize().toDouble())
                putBoolean("interactive", power.isInteractive)
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) putInt("thermalStatus", power.currentThermalStatus)
            }
            addProcessCounters(result)
            if (includeExitHistory) {
                // PSS is more expensive than the heap counters; read only at startup/export.
                val memory = Debug.MemoryInfo()
                Debug.getMemoryInfo(memory)
                result.putInt("pssKb", memory.totalPss)
                val exits = Arguments.createArray()
                result.putBoolean("exitHistorySupported", Build.VERSION.SDK_INT >= Build.VERSION_CODES.R)
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                    val manager = context.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
                    // Only this app's last five processes; never other applications or trace contents.
                    for (exit in manager.getHistoricalProcessExitReasons(context.packageName, 0, 5)) {
                        exits.pushMap(Arguments.createMap().apply {
                            putDouble("atMs", exit.timestamp.toDouble())
                            putInt("pid", exit.pid)
                            putInt("reason", exit.reason)
                            putString("reasonLabel", when (exit.reason) {
                                ApplicationExitInfo.REASON_ANR -> "anr"
                                ApplicationExitInfo.REASON_LOW_MEMORY -> "low-memory"
                                ApplicationExitInfo.REASON_CRASH -> "crash"
                                ApplicationExitInfo.REASON_CRASH_NATIVE -> "native-crash"
                                ApplicationExitInfo.REASON_USER_REQUESTED -> "user-requested"
                                ApplicationExitInfo.REASON_USER_STOPPED -> "user-stopped"
                                ApplicationExitInfo.REASON_EXIT_SELF -> "exit-self"
                                else -> "other"
                            })
                            putInt("status", exit.status)
                            putInt("importance", exit.importance)
                            putDouble("pssKb", exit.pss.toDouble())
                            putDouble("rssKb", exit.rss.toDouble())
                        })
                    }
                }
                result.putArray("exits", exits)
            }
            promise.resolve(result)
        } catch (error: Exception) {
            promise.reject("RUNTIME_DIAGNOSTICS_FAILED", "Could not read process diagnostics", error)
        }
    }

    override fun getConstants(): Map<String, Any> {
        val context = reactApplicationContext
        val info = context.packageManager.getPackageInfo(context.packageName, 0)
        return mapOf(
            "version" to (info.versionName ?: ""),
            // longVersionCode below P is the same number widened; the
            // deprecated field is the only one that exists there.
            "build" to @Suppress("DEPRECATION") info.versionCode.toString(),
        )
    }
}
