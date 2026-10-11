import { lookupModule } from '@revenge-mod/modules/finders'
import { withProps } from '@revenge-mod/modules/finders/filters'
import { instead } from '@revenge-mod/patcher'
import { withoutSpoofedFeatures } from './boosts'
import { watchGatewaySocket } from './channelIcons'
import { instanceOfUrl, isCurrentInstanceUrl, state } from './state'

type Payload = { op: number; d?: Record<string, any> }

const ACTIVITY_KEYS = [
	'name', 'type', 'url', 'timestamps', 'application_id', 'details', 'state', 'emoji', 'party',
	'assets', 'secrets', 'instance', 'flags', 'id', 'sync_id', 'metadata', 'session_id', 'platform', 'buttons',
]

const trimPresence = (p: Record<string, any>, keepActivities: boolean) => ({
	status: p.status,
	since: p.since ?? 0,
	afk: !!p.afk,
	activities: keepActivities
		? (p.activities ?? []).map((a: Record<string, any>) => {
				const out: Record<string, any> = {}
				for (const k of ACTIVITY_KEYS) if (k in a) out[k] = a[k]
				if (typeof out.flags === 'number') out.flags = String(out.flags)
				if (out.emoji) out.emoji = { name: out.emoji.name, id: out.emoji.id, animated: out.emoji.animated }
				return out
			})
		: [],
})

const MOBILE_ONLY_PROPERTIES = ['device_vendor_id', 'design_id', 'client_version', 'client_app_state', 'is_fast_connect', 'gateway_connect_reasons', 'installation_id']

function cleanGatewayPayload(payload: Payload) {
	const d = payload.d
	if (!d) return payload

	if (payload.op === 2) {
		delete d.qos_token
		delete d.client_state
		if (d.properties) for (const key of MOBILE_ONLY_PROPERTIES) delete d.properties[key]
		if (d.presence) d.presence = trimPresence(d.presence, false)
		// spacebar only broadcasts coming online when the identify says offline
		if (state.endpoints && d.presence && d.presence.status !== 'invisible') d.presence.status = 'offline'
	} else if (payload.op === 3) payload.d = trimPresence(d, true)
	else if (payload.op === 4) delete d.preferred_regions

	return payload
}

let tokenManager: { getToken(userId?: string): string | null } | undefined

export function tokenInstance(token: string | null | undefined) {
	if (!token) return null
	tokenManager ??= lookupModule(withProps<NonNullable<typeof tokenManager>>('getToken', 'setToken', 'encryptAndStoreTokens'))[0]
	for (const [userId, instance] of Object.entries(state.config.accounts))
		if (tokenManager?.getToken(userId) === token) return instance
	return null
}

export function isTokenAllowed(token: string | null | undefined, url: string) {
	const target = instanceOfUrl(url)
	const owner = target && tokenInstance(token)
	return !target || !owner || target === owner
}

const MESSAGE_SEND = /^(POST|PATCH) .*\/channels\/\d+\/messages(\/\d+)?$/
const GUILD_EDIT = /^PATCH .*\/guilds\/(\d+)$/

function cleanGuildEdit(guildId: string, body: string) {
	const json = JSON.parse(body)
	if (Array.isArray(json.features)) {
		const features = withoutSpoofedFeatures(guildId, json.features)
		if (features) json.features = features
		else delete json.features
	}
	// mobile sends "" for no channel and spacebar fails on both "" and null, so unset channels are left out
	for (const key of Object.keys(json)) if (key.endsWith('_channel_id') && (json[key] === '' || json[key] === null)) delete json[key]
	return JSON.stringify(json)
}
const requests = new WeakMap<XMLHttpRequest, { tag: string; url: string }>()

export function patchNetwork(onBlocked: (where: string) => void) {
	const unpatches = [
		instead(WebSocket.prototype, 'send', function (args, send) {
			const ws = this as WebSocket
			const [data] = args
			if (typeof data !== 'string' || !/"op":[2346][,}]/.test(data)) return send.apply(ws, args)

			const payload: Payload = JSON.parse(data)
			if ((payload.op === 2 || payload.op === 6) && !isTokenAllowed(payload.d?.token, ws.url)) {
				onBlocked(`gateway op ${payload.op}`)
				ws.close(1000)
				return
			}
			if (!isCurrentInstanceUrl(ws.url)) return send.apply(ws, args)
			// identify goes out before READY, so this catches the whole session
			if (payload.op === 2) watchGatewaySocket(ws)
			return send.call(ws, JSON.stringify(cleanGatewayPayload(payload)))
		}),
		instead(XMLHttpRequest.prototype, 'open', function (args, open) {
			const url = String(args[1])
			requests.set(this as XMLHttpRequest, { tag: `${args[0]} ${url.split('?')[0]}`, url })
			return open.apply(this, args)
		}),
		instead(XMLHttpRequest.prototype, 'setRequestHeader', function (args, setHeader) {
			const req = requests.get(this as XMLHttpRequest)
			if (req && String(args[0]).toLowerCase() === 'authorization' && !isTokenAllowed(args[1], req.url)) {
				onBlocked(req.tag)
				return
			}
			return setHeader.apply(this, args)
		}),
		instead(XMLHttpRequest.prototype, 'send', function (args, send) {
			const xhr = this as XMLHttpRequest
			const req = requests.get(xhr)
			const [body] = args
			const guildId = req && typeof body === 'string' && isCurrentInstanceUrl(req.url) ? req.tag.match(GUILD_EDIT)?.[1] : undefined
			if (guildId) return send.call(xhr, cleanGuildEdit(guildId, body))
			if (req && typeof body === 'string' && MESSAGE_SEND.test(req.tag) && isCurrentInstanceUrl(req.url) && /signal_strength|mobile_network_type/.test(body)) {
				const json = JSON.parse(body)
				delete json.signal_strength
				delete json.mobile_network_type
				return send.call(xhr, JSON.stringify(json))
			}
			return send.apply(xhr, args)
		}),
	]
	return () => {
		for (const unpatch of unpatches) unpatch()
	}
}
