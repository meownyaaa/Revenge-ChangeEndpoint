import { NativeModules } from 'react-native'
import { storage, withScheme } from './config'
import { state } from './state'

const setHosts = (api: string, cdn: string) =>
	(NativeModules.Hosts as { setHosts(api: string, cdn: string): void } | undefined)?.setHosts(api, cdn)

export function syncNativeHosts() {
	if (state.endpoints) {
		setHosts(withScheme(state.endpoints.api), `https://${state.endpoints.cdnHost}`)
		if (!state.config.hostsOverridden) {
			state.config = { ...state.config, hostsOverridden: true }
			storage.set({ hostsOverridden: true })
		}
	} else if (state.config.hostsOverridden) {
		setHosts('https://discord.com/api', 'https://cdn.discordapp.com')
		state.config = { ...state.config, hostsOverridden: false }
		storage.set({ hostsOverridden: false })
	}
}
