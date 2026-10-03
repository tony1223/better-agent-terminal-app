package com.tonyq.betteragentterminal

import android.app.ActivityManager
import android.app.ApplicationExitInfo
import android.content.Context
import android.os.Build
import android.os.Debug
import android.os.PowerManager
import android.os.Process
import android.os.SystemClock
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
