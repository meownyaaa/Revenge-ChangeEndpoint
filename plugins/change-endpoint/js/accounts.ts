import { Design } from '@revenge-mod/discord/design'
import { getStore, onFluxEventDispatched } from '@revenge-mod/discord/flux'
import { getModules } from '@revenge-mod/modules/finders'
import { withProps } from '@revenge-mod/modules/finders/filters'
import { instead } from '@revenge-mod/patcher'
import { beforeJSX, insteadJSX } from '@revenge-mod/react/jsx-runtime'
import { cloneElement, isValidElement } from 'react'
import { syncNativeHosts } from './hosts'
import { currentInstance, linkAccount, serverName, setInstance, state } from './state'

type Cleanup = (...fns: (() => any)[]) => void
type AnyElement = React.ReactElement<{ children?: unknown }>
type AccountRow = React.FC<{ user: { id: string; username: string } }>

// landing page rows render the username and discriminator as sibling texts, label the last one
function appendToName(node: React.ReactNode, username: string, suffix: string): React.ReactNode {
	if (!isValidElement(node)) return node
	const element = node as AnyElement
	const children = element.props.children as React.ReactNode
	const textOf = (c: React.ReactNode) => (isValidElement(c) ? (c as AnyElement).props.children : undefined)
	if (Array.isArray(children)) {
		let last = -1
		if (children.some(c => textOf(c) === username))
			for (let i = 0; i < children.length; i++) if (typeof textOf(children[i]) === 'string') last = i
		const next = children.map((c: React.ReactNode, i: number) => {
			if (i === last) return cloneElement(c as AnyElement, undefined, `${textOf(c)}${suffix}`)
			return last === -1 ? appendToName(c, username, suffix) : c
		})
		return cloneElement(element, undefined, ...next)
	}
	if (children === username) return cloneElement(element, undefined, `${username}${suffix}`)
	return isValidElement(children) ? cloneElement(element, undefined, appendToName(children, username, suffix)) : element
}

const linkedElsewhere = (userId: string) => {
	const linked = state.config.accounts[userId]
	return linked != null && linked !== currentInstance()
}

export function patchAccounts(cleanup: Cleanup) {
	cleanup(
		// account switcher rows all look alike across servers, show which server each one is on
		beforeJSX(Design.TableRadioRow, ([type, props, key]) => {
			const instance = typeof props.value === 'string' ? state.config.accounts[props.value] : undefined
			if (!instance) return [type, props, key]
			const name = serverName(instance)
			const subLabel = typeof props.subLabel === 'string' && props.subLabel ? `${name} · ${props.subLabel}` : name
			return [type, { ...props, subLabel }, key]
		}),
		getModules(withProps<{ default: AccountRow; AccountStatusIcon: unknown }>('AccountStatusIcon'), ({ default: Row }) => {
			const Patched: AccountRow = props => {
				const rendered = Row(props) as React.ReactNode
				const instance = state.config.accounts[props.user?.id]
				return (instance ? appendToName(rendered, props.user.username, ` · ${serverName(instance)}`) : rendered) as React.ReactElement
			}
			cleanup(insteadJSX(Row, ([, props, key], jsx) => jsx(Patched, props, key)))
		}),
		onFluxEventDispatched<{ user?: { id: string } }>('CONNECTION_OPEN', payload => {
			if (payload.user?.id) linkAccount(payload.user.id)
			return payload
		}),
		onFluxEventDispatched<{ userId?: string }>('MULTI_ACCOUNT_VALIDATE_TOKEN_FAILURE', payload =>
			payload.userId && linkedElsewhere(payload.userId)
				? { ...payload, type: 'MULTI_ACCOUNT_VALIDATE_TOKEN_SUCCESS' }
				: payload,
		),
		getStore<object>('MultiAccountStore', store => {
			cleanup(
				instead(Object.getPrototypeOf(store), 'getCanUseMultiAccountMobile', function (args, original) {
					return state.config.multiAccount || original.apply(this, args)
				}),
			)
		}),
		getModules(
			withProps<{ switchAccount(userId: string, ...rest: unknown[]): Promise<unknown>; validateMultiAccountTokens(): unknown }>('switchAccount', 'validateMultiAccountTokens'),
			actions => {
				cleanup(
					instead(actions, 'switchAccount', function (args, switchAccount) {
						const target = state.config.accounts[args[0]]
						if (target && target !== currentInstance()) {
							if (!setInstance(target)) return Promise.resolve()
							syncNativeHosts()
						}
						return switchAccount.apply(this, args)
					}),
				)
			},
		),
	)
}
