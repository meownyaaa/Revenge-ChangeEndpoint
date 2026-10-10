import { state } from './state'
import type { Endpoints } from './config'

type Env = Record<string, unknown>

const KEYS: Record<string, (e: Endpoints) => string> = {
	API_ENDPOINT: e => e.api,
	GATEWAY_ENDPOINT: e => e.gateway,
	GATEWAY_ALT_ENDPOINT: e => e.gateway,
	CDN_HOST: e => e.cdnHost,
	MEDIA_PROXY_ENDPOINT: e => e.media,
	ASSET_ENDPOINT: e => e.media,
}

export const discordEnv: Env = {}

function pin(env: Env) {
	for (const key in KEYS) {
		if (key in env && !(key in discordEnv)) discordEnv[key] = env[key]
		Object.defineProperty(env, key, {
			configurable: true,
			enumerable: true,
			get: () => (state.endpoints ? KEYS[key](state.endpoints) : discordEnv[key]),
			set(value) {
				discordEnv[key] = value
			},
		})
	}
	return env
}

export function installGlobalEnv() {
	const g = globalThis as { GLOBAL_ENV?: Env }
	if (g.GLOBAL_ENV) {
		pin(g.GLOBAL_ENV)
		return
	}

	let env: Env | undefined
	Object.defineProperty(globalThis, 'GLOBAL_ENV', {
		configurable: true,
		enumerable: true,
		get: () => env,
		set(value: Env) {
			env = value && typeof value === 'object' ? pin(value) : value
		},
	})
}
