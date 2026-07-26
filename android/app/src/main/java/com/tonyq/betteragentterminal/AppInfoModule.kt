package com.tonyq.betteragentterminal

import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule

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
