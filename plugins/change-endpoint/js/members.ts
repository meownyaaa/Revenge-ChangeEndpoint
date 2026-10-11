import { getStore, onAnyFluxEventDispatched } from '@revenge-mod/discord/flux'
import { state } from './state'

type Cleanup = (...fns: (() => any)[]) => void
type PartialMember = { user?: { id?: string }; userId?: string; user_id?: string; guildId?: string; guild_id?: string; roles?: string[] }

let members: { getMember(guildId: string, userId: string): { roles?: string[] } | null | undefined } | undefined

// spacebar puts the raw member row on MESSAGE_CREATE with roles never loaded, Discord would replace the real roles with it
function fixMember(member: PartialMember, guildId: string | undefined, authorId?: string) {
	const userId = member.user?.id ?? member.userId ?? member.user_id ?? authorId
	guildId = member.guild_id ?? member.guildId ?? guildId
	if (!userId || !guildId) return false
	const known = members?.getMember(guildId, userId)
	if (!known) return false
	member.roles = [...(known.roles ?? [])]
	return true
}

export function patchMessageMembers(cleanup: Cleanup) {
	cleanup(
		getStore<NonNullable<typeof members>>('GuildMemberStore', store => (members = store)),
		onAnyFluxEventDispatched(payload => {
			if (!state.endpoints) return payload
			try {
				const p = payload as any
				if (p.type === 'MESSAGE_CREATE' || p.type === 'MESSAGE_UPDATE') {
					const message = p.message
					// unknown members are left out so the real one arrives later instead
					if (message?.member && !fixMember(message.member, message.guild_id ?? p.guildId, message.author?.id)) delete message.member
				} else if (p.type === 'LOCAL_MESSAGES_LOADED' && Array.isArray(p.members)) {
					p.members = p.members.filter((m: PartialMember) => fixMember(m, p.guildId))
				}
			} catch (e) {
				console.warn('[ChangeEndpoint] message member fix failed', e)
			}
			return payload
		}),
	)
}
