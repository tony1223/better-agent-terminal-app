package com.tonyq.betteragentterminal

import android.app.Activity
import android.content.Intent
import android.webkit.MimeTypeMap
import com.facebook.react.bridge.BaseActivityEventListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.io.File
import java.util.Base64

class FileExporterModule(private val context: ReactApplicationContext) :
    ReactContextBaseJavaModule(context) {

    companion object {
        const val NAME = "FileExporter"
        private const val CREATE_FILE_REQUEST = 4172
    }

    private var pendingBytes: ByteArray? = null
    private var pendingPromise: Promise? = null

    private val activityEventListener = object : BaseActivityEventListener() {
        override fun onActivityResult(activity: Activity, requestCode: Int, resultCode: Int, data: Intent?) {
            if (requestCode != CREATE_FILE_REQUEST) return

            val promise = pendingPromise ?: return
            val bytes = pendingBytes ?: return
            pendingPromise = null
            pendingBytes = null

            if (resultCode != Activity.RESULT_OK || data?.data == null) {
                promise.resolve(null)
                return
            }

            val uri = data.data!!
            try {
                context.contentResolver.openOutputStream(uri, "w")?.use { output ->
                    output.write(bytes)
                } ?: throw IllegalStateException("Unable to open the selected file")
                promise.resolve(uri.toString())
            } catch (error: Exception) {
                promise.reject("E_FILE_EXPORT_WRITE", error.message, error)
            }
        }
    }

    init {
        context.addActivityEventListener(activityEventListener)
    }

    override fun getName() = NAME

    @ReactMethod
    fun saveBase64(dataBase64: String, fileName: String, promise: Promise) {
        if (pendingPromise != null) {
            promise.reject("E_FILE_EXPORT_BUSY", "Another file export is already open")
            return
        }

        val bytes = try {
            Base64.getDecoder().decode(dataBase64)
        } catch (error: IllegalArgumentException) {
            promise.reject("E_FILE_EXPORT_DATA", "Invalid base64 file data", error)
            return
        }

        val activity = context.currentActivity
        if (activity == null) {
            promise.reject("E_FILE_EXPORT_ACTIVITY", "No activity is available to save the file")
            return
        }

        val safeName = File(fileName).name.ifBlank { "download" }
        val extension = safeName.substringAfterLast('.', "").lowercase()
        val mime = MimeTypeMap.getSingleton().getMimeTypeFromExtension(extension)
            ?: "application/octet-stream"
        val intent = Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = mime
            putExtra(Intent.EXTRA_TITLE, safeName)
        }

        pendingBytes = bytes
        pendingPromise = promise
        try {
            activity.startActivityForResult(intent, CREATE_FILE_REQUEST)
        } catch (error: Exception) {
            pendingBytes = null
            pendingPromise = null
            promise.reject("E_FILE_EXPORT_OPEN", error.message, error)
        }
    }
}
