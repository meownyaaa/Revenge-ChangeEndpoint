import { onAnyFluxEventDispatched } from '@revenge-mod/discord/flux'
import { state } from './state'

type Cleanup = (...fns: (() => any)[]) => void

// spacebar's src is always mp4 (grey as an image) and its url is the klipy page, which doesn't embed
function fixGif(item: any) {
	if (!item || typeof item.gif_src !== 'string') return
	item.src = item.gif_src
	item.url = item.gif_src
}

export function patchGifs(cleanup: Cleanup) {
	cleanup(
		onAnyFluxEventDispatched(payload => {
			if (!state.endpoints) return payload
			try {
				const p = payload as any
				if (p.type === 'GIF_PICKER_QUERY_SUCCESS' && Array.isArray(p.items)) for (const item of p.items) fixGif(item)
				else if (p.type === 'GIF_PICKER_TRENDING_FETCH_SUCCESS') fixGif(p.trendingGIFPreview)
			} catch (e) {
				console.warn('[ChangeEndpoint] gif fix failed', e)
			}
			return payload
		}),
	)
}
