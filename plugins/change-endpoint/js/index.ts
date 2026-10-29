import { Stores } from '@revenge-mod/discord/flux'
import { patchAccounts } from './accounts'
import { installGlobalEnv } from './env'
import { patchLogin } from './login'
import { patchGateway } from './gateway'
import { patchGifs } from './gifs'
import { syncNativeHosts } from './hosts'
import { patchEmojiRows, patchReactions, patchStickers } from './media'
import { loadInstanceLimits, patchBoosts } from './boosts'
import { patchChannelIconEditor } from './channelIconEditor'
import { patchChannelIcons } from './channelIcons'
import { patchDecorations } from './decorations'
import { patchMessageMembers } from './members'
import { patchNetwork } from './network'
import { patchInvites } from './invites'
import { patchPermissions } from './permissions'
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
		patchGifs(cleanup)
		patchAccounts(cleanup)
		patchLogin(cleanup)
		patchVoice(cleanup)
		patchRoleColors(cleanup)
		patchDecorations(cleanup)
		patchPermissions(cleanup)
		patchInvites(cleanup)
		patchMessageMembers(cleanup)
		patchChannelIcons(cleanup)
		patchBoosts(cleanup)
		patchChannelIconEditor(cleanup)
	},

	start({ cleanup }) {
		// persists a migrated single custom server as a list entry
		saveCustoms(state.config.customs)
		syncNativeHosts()
		loadInstanceLimits()
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
