@file:JvmName("Voice")

package dev.hazel.changeendpoint

import android.content.Context
import dalvik.system.BaseDexClassLoader
import dalvik.system.DexClassLoader
import io.github.revenge.plugins.PluginScope
import io.github.revenge.plugins.plugin
import io.github.revenge.xposed.api.registerNativeAsyncMethod
import io.github.revenge.xposed.api.registerNativeMethod
import java.io.File

const val PREFIX = "dev.hazel.change-endpoint.voice"

interface VoiceEngine {
    suspend fun offer(): String
    suspend fun addAudioReceiver(): String
    suspend fun answer(sdp: String)
    fun setMuted(muted: Boolean)
    fun setDeafened(deafened: Boolean)
    fun setOutputVolume(volume: Double)
    fun close()
}

private const val ENGINE_PACKAGE = "dev.hazel.changeendpoint.engine."

private class EngineLoader(jar: String, pluginLoader: ClassLoader, private val appLoader: ClassLoader) :
    DexClassLoader(jar, null, null, pluginLoader) {
    override fun loadClass(name: String, resolve: Boolean): Class<*> = synchronized(this) {
        findLoadedClass(name)
            ?: when {
                name.startsWith(ENGINE_PACKAGE) -> findClass(name)
                name.startsWith("org.webrtc.") -> appLoader.loadClass(name)
                else -> super.loadClass(name, resolve)
            }
    }
}

private fun PluginScope.pluginJar(): String {
    File(pluginDir, "plugin.jar").takeIf(File::isFile)?.let { return it.path }
    val pathList = BaseDexClassLoader::class.java.getDeclaredField("pathList").apply { isAccessible = true }.get(VoiceEngine::class.java.classLoader)
    return Regex("""zip file "([^"]+\.jar)"""").find(pathList.toString())?.groupValues?.get(1) ?: error("Couldn't find plugin.jar")
}

@Suppress("UNUSED")
val voicePlugin = plugin {
    start {
        var context: Context? = null
        var session: VoiceEngine? = null
        var outputVolume = 1.0
        withAppContext { context = it }

        val engineClass by lazy {
            EngineLoader(pluginJar(), VoiceEngine::class.java.classLoader!!, classLoader).loadClass("${ENGINE_PACKAGE}VoiceSession")
        }

        registerNativeAsyncMethod("$PREFIX.offer") {
            val ctx = context ?: error("No app context yet")
            session?.close()
            val created = engineClass.getConstructor(PluginScope::class.java, Context::class.java).newInstance(this, ctx) as VoiceEngine
            session = created
            created.setOutputVolume(outputVolume)
            created.offer()
        }
        registerNativeAsyncMethod("$PREFIX.addAudioReceiver") {
            session?.addAudioReceiver() ?: error("No voice session")
        }
        registerNativeAsyncMethod("$PREFIX.answer") { args ->
            session?.answer(args[0] as String) ?: error("No voice session")
            null
        }
        registerNativeMethod("$PREFIX.setMuted") { args ->
            session?.setMuted(args[0] as Boolean)
            null
        }
        registerNativeMethod("$PREFIX.setDeafened") { args ->
            session?.setDeafened(args[0] as Boolean)
            null
        }
        registerNativeMethod("$PREFIX.setOutputVolume") { args ->
            outputVolume = (args[0] as Number).toDouble() / 100
            session?.setOutputVolume(outputVolume)
            null
        }
        registerNativeMethod("$PREFIX.close") {
            session?.close()
            session = null
            null
        }
    }
}
