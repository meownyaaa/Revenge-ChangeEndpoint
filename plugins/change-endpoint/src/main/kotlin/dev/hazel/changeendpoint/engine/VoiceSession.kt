package dev.hazel.changeendpoint.engine

import android.content.Context
import dev.hazel.changeendpoint.PREFIX
import dev.hazel.changeendpoint.VoiceEngine
import android.media.AudioDeviceInfo
import android.media.AudioManager
import io.github.revenge.plugins.PluginScope
import io.github.revenge.xposed.api.callJSMethod
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withTimeoutOrNull
import org.webrtc.AudioTrack
import org.webrtc.ContextUtils
import org.webrtc.DataChannel
import org.webrtc.IceCandidate
import org.webrtc.MediaConstraints
import org.webrtc.MediaStream
import org.webrtc.MediaStreamTrack
import org.webrtc.PeerConnection
import org.webrtc.PeerConnectionFactory
import org.webrtc.RtpReceiver
import org.webrtc.RtpTransceiver
import org.webrtc.SdpObserver
import org.webrtc.SessionDescription
import org.webrtc.audio.JavaAudioDeviceModule
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

class VoiceSession(private val scope: PluginScope, context: Context) : VoiceEngine {
    companion object {
        private var initialized = false
    }

    private val events = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    init {
        if (!initialized) {
            ContextUtils.initialize(context.applicationContext)
            Class.forName("org.webrtc.NativeLibrary", true, PeerConnectionFactory::class.java.classLoader)
                .getDeclaredField("libraryLoaded")
                .apply { isAccessible = true }
                .setBoolean(null, true)
            initialized = true
        }
    }

    private val audioManager = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
    private val adm = JavaAudioDeviceModule.builder(context)
        .setUseHardwareAcousticEchoCanceler(true)
        .setUseHardwareNoiseSuppressor(true)
        .createAudioDeviceModule()
    private val factory = PeerConnectionFactory.builder().setAudioDeviceModule(adm).createPeerConnectionFactory()
    private val audioSource = factory.createAudioSource(MediaConstraints())
    private val audioTrack: AudioTrack = factory.createAudioTrack("audio", audioSource)
    private var gathered = kotlinx.coroutines.CompletableDeferred<Unit>()
    private var outputVolume = 1.0

    val pc: PeerConnection = factory.createPeerConnection(
        PeerConnection.RTCConfiguration(emptyList()).apply {
            sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN
            bundlePolicy = PeerConnection.BundlePolicy.MAXBUNDLE
            rtcpMuxPolicy = PeerConnection.RtcpMuxPolicy.REQUIRE
        },
        object : PeerConnection.Observer {
            override fun onSignalingChange(state: PeerConnection.SignalingState) {}
            override fun onIceConnectionChange(state: PeerConnection.IceConnectionState) = emit("ice", state.name)
            override fun onConnectionChange(state: PeerConnection.PeerConnectionState) = emit("connection", state.name)
            override fun onIceConnectionReceivingChange(receiving: Boolean) {}
            override fun onIceGatheringChange(state: PeerConnection.IceGatheringState) {
                if (state == PeerConnection.IceGatheringState.COMPLETE) gathered.complete(Unit)
            }
            override fun onIceCandidate(candidate: IceCandidate) {}
            override fun onIceCandidatesRemoved(candidates: Array<out IceCandidate>) {}
            override fun onAddStream(stream: MediaStream) {}
            override fun onRemoveStream(stream: MediaStream) {}
            override fun onDataChannel(channel: DataChannel) {}
            override fun onRenegotiationNeeded() {}
            override fun onAddTrack(receiver: RtpReceiver, streams: Array<out MediaStream>) {
                (receiver.track() as? AudioTrack)?.setVolume(outputVolume)
                emit("track", receiver.track()?.kind() ?: "")
            }
        },
    ) ?: error("Couldn't create a PeerConnection")

    init {
        pc.addTransceiver(audioTrack, RtpTransceiver.RtpTransceiverInit(RtpTransceiver.RtpTransceiverDirection.SEND_RECV))
        audioManager.mode = AudioManager.MODE_IN_COMMUNICATION
        val headset = audioManager.getDevices(AudioManager.GET_DEVICES_OUTPUTS).any {
            it.type in setOf(
                AudioDeviceInfo.TYPE_WIRED_HEADSET,
                AudioDeviceInfo.TYPE_WIRED_HEADPHONES,
                AudioDeviceInfo.TYPE_BLUETOOTH_A2DP,
                AudioDeviceInfo.TYPE_BLUETOOTH_SCO,
                AudioDeviceInfo.TYPE_USB_HEADSET,
                AudioDeviceInfo.TYPE_BLE_HEADSET,
            )
        }
        @Suppress("DEPRECATION")
        audioManager.isSpeakerphoneOn = !headset
    }

    private fun emit(type: String, value: String) {
        scope.log.i("voice $type: $value")
        events.launch { runCatching { scope.callJSMethod("$PREFIX.event", listOf(type, value)) } }
    }

    override suspend fun offer(): String {
        val offer = suspendCancellableCoroutine<SessionDescription> { cont ->
            pc.createOffer(sdpObserver(onCreate = { cont.resume(it) }, onError = { cont.resumeWithException(IllegalStateException(it)) }), MediaConstraints())
        }
        setDescription { pc.setLocalDescription(it, offer) }
        withTimeoutOrNull(3000) { gathered.await() }
        return pc.localDescription.description
    }

    override suspend fun addAudioReceiver(): String {
        pc.addTransceiver(MediaStreamTrack.MediaType.MEDIA_TYPE_AUDIO, RtpTransceiver.RtpTransceiverInit(RtpTransceiver.RtpTransceiverDirection.RECV_ONLY))
        return offer()
    }

    override suspend fun answer(sdp: String) = setDescription { pc.setRemoteDescription(it, SessionDescription(SessionDescription.Type.ANSWER, sdp)) }

    override fun setMuted(muted: Boolean) {
        audioTrack.setEnabled(!muted)
    }

    override fun setDeafened(deafened: Boolean) {
        pc.setAudioPlayout(!deafened)
    }

    override fun setOutputVolume(volume: Double) {
        outputVolume = volume
        pc.receivers.forEach { (it.track() as? AudioTrack)?.setVolume(volume) }
    }

    override fun close() {
        pc.dispose()
        audioTrack.dispose()
        audioSource.dispose()
        factory.dispose()
        adm.release()
        @Suppress("DEPRECATION")
        audioManager.isSpeakerphoneOn = false
        audioManager.mode = AudioManager.MODE_NORMAL
    }

    private suspend fun setDescription(apply: (SdpObserver) -> Unit) = suspendCancellableCoroutine { cont ->
        apply(sdpObserver(onSet = { cont.resume(Unit) }, onError = { cont.resumeWithException(IllegalStateException(it)) }))
    }

    private fun sdpObserver(
        onCreate: (SessionDescription) -> Unit = {},
        onSet: () -> Unit = {},
        onError: (String) -> Unit,
    ) = object : SdpObserver {
        override fun onCreateSuccess(description: SessionDescription) = onCreate(description)
        override fun onSetSuccess() = onSet()
        override fun onCreateFailure(error: String) = onError(error)
        override fun onSetFailure(error: String) = onError(error)
    }
}

