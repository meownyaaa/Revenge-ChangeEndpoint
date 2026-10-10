import { getJsonStorage, pluginStoragePathFor } from '@revenge-mod/json-storage'
import { existsSync, readFileSync } from '@revenge-mod/modules/native/fs'

export const PLUGIN_ID = 'dev.hazel.change-endpoint'
export const DISCORD = 'discord'

export interface Server {
	id: string
	name: string
	host: string
	api?: string
	cdn?: string
	gateway?: string
}

export const PRESETS: Server[] = [
	{ id: 'spacebar', name: 'Spacebar', host: 'rory.server.spacebar.chat' },
	{ id: 'harmony', name: 'Harmony', host: 'harmony.melodychat.org' },
	{
		id: 'itchat',
		name: 'ITChat',
		host: 'muc.it-voip.4siwi.net:8097',
		api: 'https://muc.it-voip.4siwi.net:8097/api',
		cdn: 'https://share.it-voip.4siwi.net:8099',
		gateway: 'wss://proxy.it-voip.4siwi.net:8098',
	},
]

export interface Config {
	instance: string | null
	customs: Server[]
	multiAccount: boolean
	hostsOverridden: boolean
	accounts: Record<string, string>
}

const DEFAULT_CONFIG: Config = {
	instance: null,
	customs: [],
	multiAccount: true,
	hostsOverridden: false,
	accounts: {},
}

export const storage = getJsonStorage<Config>(pluginStoragePathFor(PLUGIN_ID), {
	default: DEFAULT_CONFIG,
})

export function readConfigSync(): Config {
	const path = pluginStoragePathFor(PLUGIN_ID)
	try {
		if (!existsSync(path)) return DEFAULT_CONFIG
		const saved = JSON.parse(readFileSync(path))
		const customs: Server[] = Array.isArray(saved.customs) ? saved.customs : []
		// older versions had one custom server, it keeps the id 'custom' so the selection and linked accounts still match
		if (saved.custom?.host && !customs.some(s => s.id === 'custom'))
			customs.unshift({ id: 'custom', name: simplifyHost(saved.custom.host), ...saved.custom })
		const { custom: _, ...rest } = saved
		return { ...DEFAULT_CONFIG, ...rest, customs, accounts: { ...saved.accounts } }
	} catch {
		return DEFAULT_CONFIG
	}
}

export interface Endpoints {
	api: string
	gateway: string
	cdnHost: string
	media: string
}

export const simplifyHost = (host: string) =>
	host
		.trim()
		.replace(/^(\w+:)?\/\//, '')
		.replace(/\/.*$/, '')
		.replace(/\?.*$/, '')

export function endpointsOf(server: Server): Endpoints | null {
	const host = simplifyHost(server.host)
	// Discord prefixes API_ENDPOINT with https:, so it must be scheme-relative
	const api = server.api?.trim().replace(/^https:(?=\/\/)/, '') || (host && `//api.${host}/api`)
	const gateway = server.gateway?.trim() || (host && `wss://gateway.${host}`)
	const cdnHost = simplifyHost(server.cdn ?? '') || (host && `cdn.${host}`)
	if (!api || !gateway || !cdnHost) return null

	return { api, gateway, cdnHost, media: `//${cdnHost}` }
}

export const findServer = (id: string | null | undefined, customs: Server[]) => [...PRESETS, ...customs].find(s => s.id === id)

export function resolveEndpoints(instance: string | null, customs: Server[]): Endpoints | null {
	const server = findServer(instance, customs)
	return server ? endpointsOf(server) : null
}

export const instanceName = (id: string | null | undefined, customs: Server[]) =>
	id === DISCORD || id == null ? 'Discord' : (findServer(id, customs)?.name ?? id)

export const withScheme = (url: string) => (url.startsWith('//') ? `https:${url}` : url)
