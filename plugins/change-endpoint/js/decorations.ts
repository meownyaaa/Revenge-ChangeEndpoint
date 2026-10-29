import { getModules } from '@revenge-mod/modules/finders'
import { withProps } from '@revenge-mod/modules/finders/filters'
import { instead } from '@revenge-mod/patcher'
import { state } from './state'

type Cleanup = (...fns: (() => any)[]) => void

// decorations come from Discord's collectibles shop by sku, without it they fall back to the server's own cdn
export function patchDecorations(cleanup: Cleanup) {
	cleanup(
		getModules(withProps<{ getCollectiblesItemAssetUrl(...args: unknown[]): string | null }>('getCollectiblesItemAssetUrl'), mod => {
			cleanup(
				instead(mod, 'getCollectiblesItemAssetUrl', function (args, original) {
					return state.endpoints ? null : original.apply(this, args)
				}),
			)
		}),
	)
}
