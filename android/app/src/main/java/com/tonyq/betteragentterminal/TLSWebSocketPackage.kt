package com.tonyq.betteragentterminal

import com.facebook.react.BaseReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfo
import com.facebook.react.module.model.ReactModuleInfoProvider

class TLSWebSocketPackage : BaseReactPackage() {
    override fun getModule(name: String, reactContext: ReactApplicationContext): NativeModule? =
        if (name == TLSWebSocketModule.NAME) TLSWebSocketModule(reactContext) else null

    override fun getReactModuleInfoProvider() = ReactModuleInfoProvider {
        mapOf(
            TLSWebSocketModule.NAME to ReactModuleInfo(
                TLSWebSocketModule.NAME,
                TLSWebSocketModule::class.java.name,
                false,
                false,
                false,
                false,
            )
        )
    }
}
