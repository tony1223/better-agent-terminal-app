package com.tonyq.betteragentterminal

import com.facebook.react.BaseReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfo
import com.facebook.react.module.model.ReactModuleInfoProvider

class FileExporterPackage : BaseReactPackage() {
    override fun getModule(name: String, reactContext: ReactApplicationContext): NativeModule? =
        if (name == FileExporterModule.NAME) FileExporterModule(reactContext) else null

    override fun getReactModuleInfoProvider() = ReactModuleInfoProvider {
        mapOf(
            FileExporterModule.NAME to ReactModuleInfo(
                FileExporterModule.NAME,
                FileExporterModule::class.java.name,
                false,
                false,
                false,
                false,
            )
        )
    }
}
