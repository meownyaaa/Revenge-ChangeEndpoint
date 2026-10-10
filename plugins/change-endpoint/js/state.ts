import { DISCORD, PRESETS, endpointsOf, instanceName, readConfigSync, resolveEndpoints, simplifyHost, storage } from './config'
import type { Config, Endpoints, Server } from './config'

export const state: { config: Config; endpoints: Endpoints | null } = {
	config: readConfigSync(),
	endpoints: null,
}

export const currentInstance = () => state.config.instance ?? DISCORD

export const servers = () => [...PRESETS, ...state.config.customs]

export const serverName = (id: string | null | undefined) => instanceName(id, state.config.customs)

export function loadState() {
	state.config = readConfigSync()
	state.endpoints = resolveEndpoints(state.config.instance, state.config.customs)
}

const listeners = new Set<() => void>()
export const onInstanceChange = (fn: () => void) => {
	listeners.add(fn)
	return () => listeners.delete(fn)
}

export function setInstance(instance: string) {
	const id = instance === DISCORD ? null : instance
	const endpoints = id ? resolveEndpoints(id, state.config.customs) : null
	if (id && !endpoints) return false

	state.config = { ...state.config, instance: id }
	state.endpoints = endpoints
	storage.set({ instance: id })
	for (const fn of listeners) fn()
	return true
}

export function linkAccount(userId: string, instance = currentInstance()) {
	if (state.config.accounts[userId] === instance) return
	state.config = { ...state.config, accounts: { ...state.config.accounts, [userId]: instance } }
	storage.set({ accounts: state.config.accounts })
}

const DISCORD_HOST = /(^|\.)(discord\.(com|gg|media)|discordapp\.(com|net))(:\d+)?$/

const endpointHosts = (e: Endpoints) => [simplifyHost(e.api), simplifyHost(e.gateway), e.cdnHost]

export function instanceOfUrl(url: string): string | null {
	const host = simplifyHost(url)
	if (!host) return null
	if (DISCORD_HOST.test(host)) return DISCORD
	if (state.endpoints && endpointHosts(state.endpoints).includes(host)) return currentInstance()

	for (const server of servers()) {
		const e = endpointsOf(server)
		if (e && endpointHosts(e).includes(host)) return server.id
	}
	return null
}

export const isCurrentInstanceUrl = (url: string) => state.endpoints != null && instanceOfUrl(url) === currentInstance()

export function saveCustoms(customs: Server[]) {
	state.config = { ...state.config, customs }
	return storage.set({ customs })
}
