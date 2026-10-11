import { getStore } from '@revenge-mod/discord/flux'
import { getModules } from '@revenge-mod/modules/finders'
import { withProps } from '@revenge-mod/modules/finders/filters'
import { instead } from '@revenge-mod/patcher'
import { state } from './state'

type Cleanup = (...fns: (() => any)[]) => void

const USE_EXTERNAL_STICKERS = 1n << 37n

// permissions spacebar doesn't enforce, which Discord's client would still block
const IGNORED: unknown[] = [USE_EXTERNAL_STICKERS]

const disrespected = (permission: unknown) => !!state.endpoints && state.config.disrespectPermissions !== false && IGNORED.includes(permission)

export function patchPermissions(cleanup: Cleanup) {
	cleanup(
		getModules(withProps<{ can(context: { permission?: unknown }): boolean; canEveryoneRole: unknown; computePermissions: unknown }>('can', 'canEveryoneRole', 'computePermissions'), utils => {
			cleanup(
				instead(utils, 'can', function (args, can) {
					return disrespected(args[0]?.permission) || can.apply(this, args)
				}),
			)
		}),
		getStore<object>('PermissionStore', store => {
			const proto = Object.getPrototypeOf(store)
			cleanup(
				instead(proto, 'can', function (args: unknown[], can) {
					return disrespected(args[0]) || can.apply(this, args)
				}),
				instead(proto, 'canWithPartialContext', function (args: unknown[], can) {
					return disrespected(args[0]) || can.apply(this, args)
				}),
			)
		}),
	)
}
