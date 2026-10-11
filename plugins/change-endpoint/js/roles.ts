import { getStore } from '@revenge-mod/discord/flux'
import { getModules } from '@revenge-mod/modules/finders'
import { withProps } from '@revenge-mod/modules/finders/filters'
import { instead } from '@revenge-mod/patcher'
import { state } from './state'

type Cleanup = (...fns: (() => any)[]) => void
type Role = { id: string; colorString?: string | null; colorStrings?: unknown }
type Member = { colorString?: string | null; colorStrings?: unknown; colorRoleId?: string }

let roles: { getRole(guildId: string, roleId: string): Role | undefined } | undefined

// spacebar allows a color on @everyone, Discord only takes colors from assigned roles
function withEveryoneColor<T>(member: T, guildId: unknown): T {
	const m = member as Member | null | undefined
	if (!state.endpoints || !m || typeof m !== 'object' || m.colorString != null || m.colorRoleId != null || typeof guildId !== 'string') return member
	let everyone: Role | undefined
	try {
		everyone = roles?.getRole(guildId, guildId)
	} catch {
		return member
	}
	if (!everyone?.colorString) return member
	// filled in place so the member keeps its identity for store subscribers
	m.colorString = everyone.colorString
	m.colorStrings = everyone.colorStrings ?? null
	m.colorRoleId = everyone.id
	return member
}

type RoleIconData = { customIconSrc?: string; unicodeEmoji?: unknown } | null | undefined

export function patchRoleColors(cleanup: Cleanup) {
	cleanup(
		// Discord hides activities it can't verify, which is every activity on a custom server
		getStore<{ getUnfilteredActivities(...args: unknown[]): unknown }>('PresenceStore', store => {
			cleanup(
				instead(Object.getPrototypeOf(store), 'getActivities', function (args, original) {
					return state.endpoints ? (this as typeof store).getUnfilteredActivities(...args) : original.apply(this, args)
				}),
			)
		}),
		// spacebar sends icon "" on emoji roles, Discord then builds a broken image url and skips the emoji
		getModules(withProps<{ getRoleIconData(role: { icon?: string | null }, size: number): RoleIconData; canGuildUseRoleIcons: unknown }>('getRoleIconData', 'canGuildUseRoleIcons'), mod => {
			cleanup(
				instead(mod, 'getRoleIconData', function (args, original) {
					const data = original.apply(this, args)
					if (!state.endpoints || !data?.customIconSrc || args[0]?.icon) return data
					const { customIconSrc: _, ...rest } = data
					return rest
				}),
			)
		}),
		getStore<typeof roles & object>('GuildRoleStore', store => (roles = store)),
		getStore<object>('GuildMemberStore', store => {
			const proto = Object.getPrototypeOf(store)
			cleanup(
				instead(proto, 'getMember', function (args, original) {
					return withEveryoneColor(original.apply(this, args), args[0])
				}),
				instead(proto, 'getTrueMember', function (args, original) {
					return withEveryoneColor(original.apply(this, args), args[0])
				}),
				instead(proto, 'getMembers', function (args, original) {
					const members = original.apply(this, args)
					if (Array.isArray(members)) for (const m of members) withEveryoneColor(m, args[0])
					return members
				}),
			)
		}),
	)
}
