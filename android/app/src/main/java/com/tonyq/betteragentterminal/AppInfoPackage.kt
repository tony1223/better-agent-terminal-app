package com.tonyq.betteragentterminal

import com.facebook.react.BaseReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfo
import com.facebook.react.module.model.ReactModuleInfoProvider

class AppInfoPackage : BaseReactPackage() {
    override fun getModule(name: String, reactContext: ReactApplicationContext): NativeModule? =
        if (name == AppInfoModule.NAME) AppInfoModule(reactContext) else null

    override fun getReactModuleInfoProvider() = ReactModuleInfoProvider {
        mapOf(
            AppInfoModule.NAME to ReactModuleInfo(
                AppInfoModule.NAME,
                AppInfoModule::class.java.name,
                false,
                false,
                false,
                false,
            )
        )
    }
}
