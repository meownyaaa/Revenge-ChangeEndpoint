import { getStore } from '@revenge-mod/discord/flux'
import { instead } from '@revenge-mod/patcher'
import { discordEnv } from './env'
import { DISCORD } from './config'
import { instanceOfUrl, onInstanceChange, state } from './state'

interface GatewaySocket {
	_getGatewayUrl(): string
	compressionHandler: { getAlgorithm(): string }
	resumeUrl: string | null
	webSocket?: { url?: string } | null
	close?(): void
	connect(): void
	resetBackoff?(): void
}

type Cleanup = (...fns: (() => any)[]) => void

const currentGateway = () => state.endpoints?.gateway ?? String(discordEnv.GATEWAY_ENDPOINT ?? 'wss://gateway.discord.gg')

const swapOrigin = (url: string, origin: string) => url.replace(/^wss?:\/\/[^/?]+/, origin.replace(/\/+$/, ''))

export function patchGateway(cleanup: Cleanup) {
	cleanup(
		getStore<{ getSocket(): GatewaySocket }>('GatewayConnectionStore', store => {
			const socket = store.getSocket()

			cleanup(
				instead(Object.getPrototypeOf(socket), '_getGatewayUrl', function (args, getUrl) {
					const url = String(getUrl.apply(this, args))
					return state.endpoints || instanceOfUrl(url) !== DISCORD ? swapOrigin(url, currentGateway()) : url
				}),
				instead(Object.getPrototypeOf(socket.compressionHandler), 'getAlgorithm', function (args, getAlgorithm) {
					return state.endpoints ? '' : getAlgorithm.apply(this, args)
				}),
				onInstanceChange(() => {
					socket.resumeUrl = null
				}),
			)

			if (!state.endpoints) return
			socket.resumeUrl = null
			const url = socket.webSocket?.url
			if (url && (!url.startsWith(state.endpoints.gateway) || url.includes('compress='))) {
				socket.resetBackoff?.()
				socket.close?.()
				socket.connect()
			}
		}),
	)
}
