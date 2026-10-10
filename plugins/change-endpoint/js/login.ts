import { Design } from '@revenge-mod/discord/design'
import { Stores } from '@revenge-mod/discord/flux'
import { getModuleWithImportedPath, lookupModuleWithImportedPath } from '@revenge-mod/discord/utils/modules/finders'
import { lookupModule } from '@revenge-mod/modules/finders'
import { withProps } from '@revenge-mod/modules/finders/filters'
import { getModuleDependencies } from '@revenge-mod/modules/metro'
import { insteadJSX } from '@revenge-mod/react/jsx-runtime'
import { cloneElement, createElement as h, isValidElement, useEffect, useReducer } from 'react'
import { Alert } from 'react-native'
import { DISCORD } from './config'
import { syncNativeHosts } from './hosts'
import { tokenInstance } from './network'
import { currentInstance, onInstanceChange, serverName, servers, setInstance, state } from './state'
import type { FC, ReactElement } from 'react'

type Cleanup = (...fns: (() => any)[]) => void
type AnyElement = ReactElement<{ children?: unknown }>

const currentToken = () => (Stores.AuthenticationStore as { getToken?(): string | null } | undefined)?.getToken?.()

function pickServer() {
	const sheets = lookupModule(withProps<{ showSimpleActionSheet(sheet: object): void }>('showSimpleActionSheet'))[0]
	if (!sheets) return

	const choose = (id: string) => {
		if (id === currentInstance()) return
		setInstance(id)
		syncNativeHosts()
	}

	sheets.showSimpleActionSheet({
		key: 'ChangeEndpointServerPicker',
		header: { title: 'Log in to' },
		options: [DISCORD, ...servers().map(s => s.id)].map(id => ({
			label: id === currentInstance() ? `${serverName(id)} (current)` : serverName(id),
			onPress: () => choose(id),
		})),
	})
}

type Opener = { default(): void }

// the opener loads lazily (only after Manage was pressed), so find it by its dependencies instead
function findOpener(): Opener | undefined {
	const [loaded] = lookupModuleWithImportedPath<Opener>('modules/multi_account/native/openManageAccountsModal.tsx')
	if (loaded) return loaded

	const constants = lookupModule(withProps('SWITCH_ACCOUNTS_MODAL_KEY', 'MULTI_ACCOUNT_LOGIN_MODAL_KEY'))[1]
	const importer = lookupModule(withProps('unstable_importMaybeSync', 'prefetch'))[1]
	if (constants == null || importer == null) return

	const require = (globalThis as { __r?: (id: number) => any }).__r
	for (let id = 0; require && id < 65536; id++) {
		const deps = getModuleDependencies(id)
		if (!deps || deps.length > 8 || !deps.includes(constants) || !deps.includes(importer)) continue
		const exports = require(id)
		if (exports?.default?.name === 'openManageAccountsModal') return exports
	}
}

function openAccountSwitcher() {
	const opener = findOpener()
	if (opener) opener.default()
	else Alert.alert('Account switcher not found', "Couldn't find Discord's account switcher.")
}

function AccountsButton() {
	return h(Design.Button, {
		variant: 'secondary',
		size: 'md',
		text: 'Switch account',
		onPress: openAccountSwitcher,
	})
}

function ServerButton() {
	const [, rerender] = useReducer((n: number) => n + 1, 0)
	useEffect(() => onInstanceChange(rerender) as () => void, [])

	useEffect(() => {
		const token = currentToken()
		const owner = tokenInstance(token)
		return () => {
			if (!token || currentToken() !== token || !owner || owner === currentInstance()) return
			setInstance(owner)
			syncNativeHosts()
		}
	}, [])

	return h(Design.Button, {
		variant: 'secondary',
		size: 'md',
		text: `Server: ${serverName(currentInstance())}`,
		onPress: pickServer,
	})
}

function addServerButton(rendered: unknown) {
	if (!isValidElement(rendered)) return rendered
	const root = rendered as AnyElement
	const body = root.props.children
	if (!isValidElement(body)) return rendered

	const content = (body as AnyElement).props.children
	return cloneElement(
		root,
		undefined,
		cloneElement(body as AnyElement, undefined, ...(Array.isArray(content) ? content : [content]), h(ServerButton, { key: 'change-endpoint-server' }), h(AccountsButton, { key: 'change-endpoint-accounts' })),
	)
}

export function patchLogin(cleanup: Cleanup) {
	cleanup(
		getModuleWithImportedPath<{ default: FC<object> }>('modules/auth/native/components/Login.tsx', ({ default: Login }) => {
			const Patched: FC<object> = props => addServerButton(Login(props)) as ReactElement
			cleanup(insteadJSX(Login, ([, props, key], jsx) => jsx(Patched, props, key)))
		}),
	)
}
