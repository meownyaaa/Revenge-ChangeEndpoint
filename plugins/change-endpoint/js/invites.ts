import { getModules } from '@revenge-mod/modules/finders'
import { withProps } from '@revenge-mod/modules/finders/filters'
import { instead } from '@revenge-mod/patcher'
import { state } from './state'

type Cleanup = (...fns: (() => any)[]) => void

// spacebar's invite hosts, Discord only knows its own INVITE_HOST
const INVITE_HOSTS = ['sbar.fyi', 'sbar.top', 'fermi.chat']
const INVITE_PATHS = ['/invite', '/i']

type ParsedURL = { host?: string | null; hostname?: string | null; pathname?: string | null } | null | undefined
let parse: (raw: string) => ParsedURL = () => null

const isInviteHost = (host?: string | null) => !!host && INVITE_HOSTS.some(h => host === h || host.endsWith(`.${h}`))

function remainingPath(url: ParsedURL) {
	if (!url || !isInviteHost(url.hostname ?? url.host)) return null
	const path = url.pathname ?? ''
	const prefix = INVITE_PATHS.find(p => path.startsWith(`${p}/`))
	return prefix ? path.slice(prefix.length) : null
}

function inviteFrom(raw: string) {
	const code = remainingPath(parse(raw))?.split('/')[1]
	return code ? { type: 'INVITE', code, url: raw } : undefined
}

const LINK = /https?:\/\/[^\s<>()]+/gi
const invitesIn = (text: string) => (text.match(LINK) ?? []).map(inviteFrom).filter(Boolean) as { code: string }[]

interface CodedLinks {
	parseURLSafely(raw: string): ParsedURL
	getPathsFromURL(raw: string): { url?: ParsedURL; inviteHostRemainingPath?: string | null } | null
	findCodedLink(raw: string): unknown
	containsCodedLink(text: string): boolean
	default(text: string): unknown
}

export function patchInvites(cleanup: Cleanup) {
	cleanup(
		// other modules call these through the exports, the module's own calls can't be reached
		getModules(withProps<CodedLinks>('findCodedLink', 'getPathsFromURL'), links => {
			parse = raw => links.parseURLSafely(raw)
			cleanup(
				instead(links, 'getPathsFromURL', function (args, original) {
					const result = original.apply(this, args)
					if (!state.endpoints || !result || result.inviteHostRemainingPath) return result
					const path = remainingPath(result.url)
					return path ? { ...result, inviteHostRemainingPath: path } : result
				}),
				instead(links, 'findCodedLink', function (args, original) {
					const found = original.apply(this, args)
					return found || !state.endpoints || typeof args[0] !== 'string' ? found : inviteFrom(args[0])
				}),
				instead(links, 'default', function (args, original) {
					const found = original.apply(this, args)
					if (!state.endpoints || typeof args[0] !== 'string' || !Array.isArray(found)) return found
					const extra = invitesIn(args[0]).filter(i => !found.some((f: { code?: string }) => f?.code === i.code))
					return extra.length ? [...found, ...extra] : found
				}),
			)
			// not every build has it
			if (typeof links.containsCodedLink === 'function')
				cleanup(
					instead(links, 'containsCodedLink', function (args, original) {
						const found = original.apply(this, args)
						return found || !state.endpoints || typeof args[0] !== 'string' ? found : invitesIn(args[0]).length > 0
					}),
				)
		}),
	)
}
