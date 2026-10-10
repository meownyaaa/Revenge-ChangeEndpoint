import { Stores } from '@revenge-mod/discord/flux'
import { patchAccounts } from './accounts'
import { installGlobalEnv } from './env'
import { patchLogin } from './login'
import { patchGateway } from './gateway'
import { syncNativeHosts } from './hosts'
import { patchEmojiRows, patchReactions, patchStickers } from './media'
import { patchNetwork } from './network'
import { patchRoleColors } from './roles'
import Settings from './Settings'
import { patchVoice } from './voice'
import { linkAccount, loadState, saveCustoms, state } from './state'

export default plugin({
	preInit({ plugin }) {
		if (plugin.startedLate) plugin.requireReload()
		loadState()
		installGlobalEnv()
	},

	init({ cleanup }) {
		cleanup(patchNetwork(where => console.warn(`[ChangeEndpoint] Blocked a request carrying another server's token: ${where}`)))
		patchGateway(cleanup)
		patchReactions(cleanup)
		patchAccounts(cleanup)
		patchLogin(cleanup)
		patchVoice(cleanup)
		patchRoleColors(cleanup)
	},

	start({ cleanup }) {
		// persists a migrated single custom server as a list entry
		saveCustoms(state.config.customs)
		syncNativeHosts()
		patchStickers(cleanup)
		patchEmojiRows(cleanup)

		const user = (Stores.UserStore as { getCurrentUser?(): { id: string } | undefined } | undefined)?.getCurrentUser?.()
		if (user) linkAccount(user.id)
	},

	stop({ plugin }) {
		plugin.requireReload()
	},

	SettingsComponent: Settings,
})
