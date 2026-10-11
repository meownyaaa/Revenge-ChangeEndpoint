import { Design } from '@revenge-mod/discord/design'
import { getModuleWithImportedPath, lookupModuleWithImportedPath } from '@revenge-mod/discord/utils/modules/finders'
import { lookupModule } from '@revenge-mod/modules/finders'
import { withProps } from '@revenge-mod/modules/finders/filters'
import { getModuleDependencies } from '@revenge-mod/modules/metro'
import { instead } from '@revenge-mod/patcher'
import { insteadJSX } from '@revenge-mod/react/jsx-runtime'
import { createElement as h, useState } from 'react'
import { Text, ToastAndroid } from 'react-native'
import { channelIconUrl, getChannelIcon, setChannelIcon } from './channelIcons'
import { state } from './state'
import type { FC, ReactElement } from 'react'

type Cleanup = (...fns: (() => any)[]) => void
type Channel = { id: string; name?: string }
type Http = { patch(options: { url: string; body: unknown }): Promise<{ body: any }>; get: unknown; post: unknown; put: unknown; del: unknown; V8APIError: unknown }

const toast = (message: string) => ToastAndroid.show(message, ToastAndroid.SHORT)

// IconUploader hands over either a data uri or an image object, the api wants a data uri
function toDataUri(image: any): string | null {
	if (typeof image === 'string') return image.startsWith('data:') ? image : null
	const base64 = image?.base64 ?? image?.data
	const mime = image?.mime ?? image?.type ?? 'image/png'
	if (typeof base64 === 'string') return base64.startsWith('data:') ? base64 : `data:${mime};base64,${base64}`
	return null
}

let IconUploader: FC<any> | undefined

const ICON_UPLOADER_PATH = 'components_native/common/IconUploader.tsx'

// IconUploader loads lazily (only the guild settings use it), so find it by its dependencies and load it
function loadIconUploader() {
	if (IconUploader) return IconUploader
	const [loaded] = lookupModuleWithImportedPath<{ default: FC<any> }>(ICON_UPLOADER_PATH)
	if (loaded?.default) return (IconUploader = loaded.default)

	const idOf = (...props: string[]) => lookupModule(withProps<Record<string, unknown>>(...(props as [string, ...string[]])))[1]
	const sizes = idOf('GuildIconSizes', 'ImageSizes')
	const avatars = idOf('DATA_IMAGE_PREFIX', 'DEFAULT_AVATARS')
	const pressables = idOf('PressableOpacity', 'PressableHighlight')
	if (sizes == null || avatars == null || pressables == null) return

	const candidates: [number, number][] = []
	for (let id = 0; id < 65536; id++) {
		const deps = getModuleDependencies(id)
		if (deps && deps.length <= 25 && deps.includes(sizes) && deps.includes(avatars) && deps.includes(pressables)) candidates.push([id, deps.length])
	}
	const require = (globalThis as { __r?: (id: number) => any }).__r
	for (const [id] of candidates.sort((x, y) => x[1] - y[1])) {
		require?.(id)
		// android strips the component name, but a loaded module reports its import path
		const [mod, modId] = lookupModuleWithImportedPath<{ default: FC<any> }>(ICON_UPLOADER_PATH)
		if (mod?.default && modId === id) return (IconUploader = mod.default)
	}
}

function ChannelIconSection({ channel }: { channel: Channel }) {
	const Uploader = loadIconUploader()
	const [icon, setIcon] = useState<string | null>(getChannelIcon(channel.id) ?? null)
	const [busy, setBusy] = useState(false)

	const save = async (value: string | null) => {
		setBusy(true)
		try {
			const http = lookupModule(withProps<Http>('get', 'post', 'put', 'patch', 'del', 'V8APIError'))[0]
			const { body } = await http!.patch({ url: `/channels/${channel.id}`, body: { icon: value } })
			const next = body?.icon ?? null
			setChannelIcon(channel.id, next)
			setIcon(next)
			toast(value ? 'Channel icon updated' : 'Channel icon removed')
		} catch (e) {
			console.warn('[ChangeEndpoint] channel icon update failed', e)
			toast("Couldn't update the channel icon")
		} finally {
			setBusy(false)
		}
	}

	const onUpload = (image: unknown) => {
		const uri = toDataUri(image)
		if (!uri) return toast("Couldn't read that image")
		save(uri)
	}

	return h(Design.TableRowGroup, {
		title: 'Channel Icon',
		children: h(
			Design.Stack,
			{ style: { padding: 12 }, spacing: 12 },
			Uploader &&
				h(Uploader, {
					type: 'guild',
					icon,
					name: channel.name ?? '',
					makeURL: (hash: string) => channelIconUrl(channel.id, hash),
					onUpload,
					disabled: busy,
				}),
			icon && h(Design.Button, { text: 'Remove icon', variant: 'destructive', size: 'sm', disabled: busy, onPress: () => save(null) }),
			h(Text, { style: { color: '#b5bac1' } }, 'Shown in the channel list in place of the default icon.'),
		),
	})
}

export function patchChannelIconEditor(cleanup: Cleanup) {
	let patched = false

	// the settings class isn't exported, it's patched from the first element the connected wrapper creates
	const patchClass = (Overview: any) => {
		if (patched || !Overview?.prototype?.renderChannelInfo) return
		patched = true
		cleanup(
			instead(Overview.prototype, 'renderChannelInfo', function (this: any, args, render) {
				const rendered = render.apply(this, args)
				const channel: Channel | undefined = this.props?.channel
				if (!state.endpoints || !channel?.id || !this.props?.canManageChannels) return rendered
				return [rendered, h(ChannelIconSection, { key: 'change-endpoint-channel-icon', channel })]
			}),
		)
	}

	cleanup(
		getModuleWithImportedPath<{ default: FC<object> }>('components_native/channel_settings/ChannelSettingsOverview.tsx', ({ default: Connected }) => {
			const Patched: FC<object> = props => {
				const element = Connected(props) as ReactElement | null
				patchClass(element?.type)
				return element as ReactElement
			}
			cleanup(insteadJSX(Connected, ([, props, key], jsx) => jsx(Patched, props, key)))
		}),
	)
}
