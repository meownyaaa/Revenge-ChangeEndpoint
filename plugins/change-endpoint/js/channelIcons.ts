import { getModules } from '@revenge-mod/modules/finders'
import { withProps } from '@revenge-mod/modules/finders/filters'
import { instead } from '@revenge-mod/patcher'
import { createElement as h } from 'react'
import { Image } from 'react-native'
import { storage } from './config'
import { currentInstance, state } from './state'
import type { FC } from 'react'

type Cleanup = (...fns: (() => any)[]) => void

const SIZES: Record<string, number> = { xxs: 12, xs: 16, sm: 20, md: 24, lg: 32, refreshSmall16: 16 }

// channel id -> icon for the current server, Discord's channel records drop the icon field
const icons = () => (state.config.channelIcons[currentInstance()] ??= {})

let saveTimer: ReturnType<typeof setTimeout> | undefined
function save() {
	clearTimeout(saveTimer)
	saveTimer = setTimeout(() => storage.set({ channelIcons: state.config.channelIcons }), 2000)
}

export const getChannelIcon = (channelId: string): string | undefined => icons()[channelId]

export function setChannelIcon(channelId: string, icon: string | null) {
	if (icon) icons()[channelId] = icon
	else delete icons()[channelId]
	save()
}

function take(channel: any) {
	if (!channel?.id || !('icon' in channel)) return false
	if (channel.icon) icons()[channel.id] = channel.icon
	else delete icons()[channel.id]
	return true
}

const ICON_EVENTS = /"t":"(READY|GUILD_CREATE|CHANNEL_CREATE|CHANNEL_UPDATE)"/

function collect(data: unknown) {
	if (typeof data !== 'string' || !data.includes('"icon"')) return
	const event = data.match(ICON_EVENTS)?.[1]
	if (!event) return
	const { d } = JSON.parse(data)
	let changed = false
	if (event === 'READY') for (const g of d.guilds ?? []) for (const c of g.channels ?? []) changed = take(c) || changed
	else if (event === 'GUILD_CREATE') for (const c of d.channels ?? []) changed = take(c) || changed
	else changed = take(d)
	if (changed) save()
}

const watched = new WeakSet<WebSocket>()

// channels become records before any flux action, so the raw gateway messages are the only place with icons
export function watchGatewaySocket(ws: WebSocket) {
	if (watched.has(ws)) return
	watched.add(ws)
	ws.addEventListener('message', e => {
		try {
			collect(e.data)
		} catch (err) {
			console.warn('[ChangeEndpoint] channel icon collect failed', err)
		}
	})
}

// icons can point at another folder (../<guild id>/<hash>), which image loaders don't normalize
function resolvePath(path: string) {
	const out: string[] = []
	for (const segment of path.split('/')) {
		if (segment === '..') out.pop()
		else if (segment && segment !== '.') out.push(segment)
	}
	return out.join('/')
}

type IconProps = { size?: string; style?: object }
const components = new Map<string, FC<IconProps>>()

export const channelIconUrl = (channelId: string, icon: string) =>
	`https://${state.endpoints!.cdnHost}/${resolvePath(`channel-icons/${channelId}/${icon}.png`)}`

function iconComponent(channelId: string, icon: string) {
	const key = `${channelId}/${icon}`
	let Icon = components.get(key)
	if (!Icon) {
		const uri = channelIconUrl(channelId, icon)
		Icon = ({ size, style }) => {
			const px = SIZES[size ?? ''] ?? 20
			return h(Image, { source: { uri }, style: [style, { width: px, height: px, borderRadius: 4 }], resizeMode: 'contain' })
		}
		components.set(key, Icon)
	}
	return Icon
}

export function patchChannelIcons(cleanup: Cleanup) {
	cleanup(
		getModules(withProps<Record<string, (...args: any[]) => unknown>>('getChannelIconComponent', 'getSimpleChannelIconComponent'), mod => {
			// forEach, hermes shares a for...of binding between closures
			;['getChannelIconComponent', 'getChannelIconComponentWithGuild', 'getSimpleChannelIconComponent'].forEach(name => {
				if (typeof mod[name] !== 'function') return
				cleanup(
					instead(mod, name, function (args, original) {
						const channel = args[0] as { id?: string } | undefined
						const icon = state.endpoints && channel?.id ? icons()[channel.id] : undefined
						return icon ? iconComponent(channel!.id!, icon) : original.apply(this, args)
					}),
				)
			})
		}),
	)
}
