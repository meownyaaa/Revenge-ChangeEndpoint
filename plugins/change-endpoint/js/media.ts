import { onAnyFluxEventDispatched } from '@revenge-mod/discord/flux'
import { getModules } from '@revenge-mod/modules/finders'
import { withProps } from '@revenge-mod/modules/finders/filters'
import { after } from '@revenge-mod/patcher'
import { state } from './state'

type Cleanup = (...fns: (() => any)[]) => void

export function patchStickers(cleanup: Cleanup) {
	const fix = (url: string) => {
		const endpoints = state.endpoints
		return endpoints && typeof url === 'string'
			? url
					.replace(/^https:\/\/media\.discordapp\.net/, `https:${endpoints.media}`)
					.replace(/^https:\/\/cdn\.discordapp\.com/, `https://${endpoints.cdnHost}`)
			: url
	}

	cleanup(
		getModules(withProps<Record<string, (...args: any[]) => string>>('getStickerAssetUrl'), mod => {
			for (const key of ['getStickerAssetUrl', 'getStickerPackBannerAssetUrl'])
				if (typeof mod[key] === 'function') cleanup(after(mod, key, fix))
		}),
	)
}

export function patchEmojiRows(cleanup: Cleanup) {
	const visit = (node: any, depth: number, cdnHost: string) => {
		if (!node || typeof node !== 'object' || depth > 14) return
		if (node.type === 'customEmoji' && node.id)
			node.src = node.frozenSrc = `https://${cdnHost}/emojis/${node.id}.png`
		for (const key in node) if (node[key] && typeof node[key] === 'object') visit(node[key], depth + 1, cdnHost)
	}

	cleanup(
		getModules(withProps<{ generateMessageRowData(...args: any[]): unknown }>('generateMessageRowData'), mod => {
			cleanup(
				after(mod, 'generateMessageRowData', row => {
					if (state.endpoints) visit(row, 0, state.endpoints.cdnHost)
					return row
				}),
			)
		}),
	)
}

const SNOWFLAKE = /^\d{17,20}$/

function fixEmoji(emoji: any) {
	if (emoji && !emoji.id && SNOWFLAKE.test(emoji.name ?? '')) {
		emoji.id = emoji.name
		emoji.animated ??= true
	}
}

function fixReaction(reaction: any) {
	if (!reaction) return
	fixEmoji(reaction.emoji)
	reaction.me ??= false
	reaction.me_burst ??= false
	reaction.burst_count ??= 0
	reaction.count_details ??= { normal: reaction.count ?? 0, burst: 0 }
	reaction.burst_colors ??= []
}

// replies and forwards carry their own copy of the original message
function fixMessage(message: any, depth = 0) {
	if (!message || depth > 2) return
	for (const reaction of message.reactions ?? []) fixReaction(reaction)
	fixMessage(message.referenced_message, depth + 1)
	for (const snapshot of message.message_snapshots ?? []) fixMessage(snapshot?.message, depth + 1)
}

export function patchReactions(cleanup: Cleanup) {
	cleanup(
		onAnyFluxEventDispatched(payload => {
			if (!state.endpoints) return payload
			// runs inside every dispatch, a throw here fails the dispatch (CACHE_LOADED then clears the whole cache)
			try {
				const p = payload as any
				fixEmoji(p.reaction?.emoji ?? p.emoji)
				// CACHE_LOADED keys messages by channel
				const messages = Array.isArray(p.messages) ? p.messages : p.messages && typeof p.messages === 'object' ? Object.values(p.messages) : p.message ? [p.message] : []
				for (const message of messages.flat()) fixMessage(message)
			} catch (e) {
				console.warn('[ChangeEndpoint] reaction fix failed', e)
			}
			return payload
		}),
	)
}
