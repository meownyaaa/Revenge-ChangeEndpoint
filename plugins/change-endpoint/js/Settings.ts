import { Design } from '@revenge-mod/discord/design'
import { Stores } from '@revenge-mod/discord/flux'
import { BundleUpdaterManager } from '@revenge-mod/discord/native'
import { createElement as h, useState } from 'react'
import { Alert, ScrollView, Text } from 'react-native'
import { DISCORD, endpointsOf, resolveEndpoints, storage } from './config'
import { discover } from './discovery'
import { currentInstance, saveCustoms, serverName, servers, state } from './state'
import type { Server } from './config'

interface SavedAccount {
	id: string
	username: string
	discriminator?: string
}

const displayName = (a: SavedAccount) =>
	a.discriminator && a.discriminator !== '0' ? `${a.username}#${a.discriminator}` : a.username

const savedAccounts = () =>
	(Stores.MultiAccountStore as { getUsers?(): SavedAccount[] } | undefined)?.getUsers?.() ?? []

const isLoggedIn = () => !!(Stores.AuthenticationStore as { getToken?(): string | null } | undefined)?.getToken?.()

const apiLabel = (server: Server) => endpointsOf(server)?.api.replace(/^\/\//, '')

function ServerEditor({ server, onDone }: { server?: Server; onDone(saved?: Server): void }) {
	const [draft, setDraft] = useState<Server>(server ?? { id: `custom-${Date.now().toString(36)}`, name: '', host: '', api: '', gateway: '', cdn: '' })
	const [status, setStatus] = useState<string | null>(null)
	const [busy, setBusy] = useState(false)
	// remounts the inputs after detection, they only take defaultValue
	const [version, setVersion] = useState(0)

	const set = (key: keyof Server) => (value: string) => setDraft(d => ({ ...d, [key]: value }))

	const detect = async () => {
		setBusy(true)
		setStatus('Looking up the server...')
		try {
			const found = await discover(draft.host)
			setDraft(d => ({ ...d, host: found.host, api: found.api, gateway: found.gateway, cdn: found.cdn, name: d.name.trim() || found.name || '' }))
			setVersion(v => v + 1)
			setStatus("Found the server's endpoints.")
		} catch (e) {
			setStatus(`${(e as Error).message}. Fill in the endpoints yourself.`)
		} finally {
			setBusy(false)
		}
	}

	const save = () => {
		const next = { ...draft, name: draft.name.trim() || draft.host.trim(), host: draft.host.trim() }
		if (!next.host || !endpointsOf(next)) return setStatus('Enter at least the server address.')
		const customs = state.config.customs.some(s => s.id === next.id)
			? state.config.customs.map(s => (s.id === next.id ? next : s))
			: [...state.config.customs, next]
		saveCustoms(customs)
		onDone(next)
	}

	const remove = () => {
		if (!server) return
		if (server.id === currentInstance()) return setStatus('Switch to another server before deleting this one.')
		Alert.alert('Delete server', `Delete ${server.name}? Accounts linked to it stay saved but won't switch servers.`, [
			{ text: 'Cancel', style: 'cancel' },
			{
				text: 'Delete',
				style: 'destructive',
				onPress: () => {
					saveCustoms(state.config.customs.filter(s => s.id !== server.id))
					onDone()
				},
			},
		])
	}

	const field = (key: keyof Server, label: string, placeholder: string) =>
		h(Design.TextInput, {
			key: `${key}-${version}`,
			label,
			placeholder,
			defaultValue: draft[key],
			...{ autoCapitalize: 'none', autoCorrect: false },
			onChange: set(key),
		})

	return h(
		Design.Stack,
		{ spacing: 12 },
		field('host', 'Address', 'spacebar.example.com'),
		h(Design.Button, { text: busy ? 'Looking up...' : 'Detect endpoints', variant: 'secondary', disabled: busy || !draft.host.trim(), onPress: detect }),
		field('name', 'Name', draft.host || 'My server'),
		field('api', 'API endpoint (optional)', 'https://api.spacebar.example.com/api'),
		field('gateway', 'Gateway endpoint (optional)', 'wss://gateway.spacebar.example.com'),
		field('cdn', 'CDN host (optional)', 'cdn.spacebar.example.com'),
		status && h(Text, { style: { color: '#b5bac1' } }, status),
		h(Design.Button, { text: 'Save', disabled: busy, onPress: save }),
		server && h(Design.Button, { text: 'Delete server', variant: 'destructive', onPress: remove }),
		h(Design.Button, { text: 'Cancel', variant: 'secondary', onPress: () => onDone() }),
	)
}

export default function Settings() {
	const [instance, setInstance] = useState(currentInstance)
	const [multiAccount, setMultiAccount] = useState(state.config.multiAccount)
	const [editing, setEditing] = useState<Server | 'new' | null>(null)
	// editing the selected server's endpoints needs a restart too
	const [currentEdited, setCurrentEdited] = useState(false)

	const draftId = instance === DISCORD ? null : instance
	const endpoints = resolveEndpoints(draftId, state.config.customs)
	const changed = draftId !== state.config.instance || currentEdited
	const accounts = savedAccounts()

	const apply = () => {
		if (isLoggedIn()) {
			Alert.alert('Log out first', 'Log out before switching servers, so your login is never sent to the wrong server. Saved accounts are fine.')
			return
		}
		const unlinked = accounts.filter(a => !state.config.accounts[a.id])
		if (unlinked.length) {
			Alert.alert(
				'Unknown saved accounts',
				`Remove ${unlinked.map(displayName).join(', ')} from your saved accounts first. ChangeEndpoint doesn't know which server they belong to.`,
			)
			return
		}
		if (draftId && !endpoints) {
			Alert.alert('Missing server', 'Pick a server first.')
			return
		}
		storage.set({ instance: draftId }).then(() => BundleUpdaterManager.reload())
	}

	if (editing)
		return h(
			ScrollView,
			{ contentContainerStyle: { padding: 16, gap: 16 } },
			h(ServerEditor, {
				server: editing === 'new' ? undefined : editing,
				onDone: saved => {
					if (saved && saved.id === state.config.instance) setCurrentEdited(true)
					if (!saved && editing !== 'new' && !state.config.customs.some(s => s.id === editing.id) && instance === editing.id) setInstance(currentInstance())
					setEditing(null)
				},
			}),
		)

	return h(
		ScrollView,
		{ contentContainerStyle: { padding: 16, gap: 16 } },
		h(Design.TableRadioGroup, {
			title: 'Server',
			value: instance,
			onChange: (value: unknown) => setInstance(value as string),
			children: [
				h(Design.TableRadioRow, { key: DISCORD, label: 'Discord', subLabel: 'Official servers', value: DISCORD }),
				...servers().map(s => h(Design.TableRadioRow, { key: s.id, label: s.name, subLabel: apiLabel(s), value: s.id })),
			],
		}),
		h(Design.TableRowGroup, {
			title: 'Custom servers',
			children: [
				...state.config.customs.map(s => h(Design.TableRow, { key: s.id, label: s.name, subLabel: s.host, arrow: true, onPress: () => setEditing(s) })),
				h(Design.TableRow, { key: 'add', label: 'Add server', arrow: true, onPress: () => setEditing('new') }),
			],
		}),
		endpoints &&
			h(Design.TableRowGroup, {
				title: 'Endpoints',
				children: [
					h(Design.TableRow, { key: 'api', label: 'API', subLabel: endpoints.api }),
					h(Design.TableRow, { key: 'gateway', label: 'Gateway', subLabel: endpoints.gateway }),
					h(Design.TableRow, { key: 'cdn', label: 'CDN', subLabel: endpoints.cdnHost }),
				],
			}),
		h(Design.Button, { text: 'Apply and restart', disabled: !changed, onPress: apply }),
		h(Design.TableRowGroup, {
			title: 'Accounts',
			children: [
				h(Design.TableSwitchRow, {
					key: 'multi-account',
					label: 'Account switcher',
					subLabel: "Shows Discord's account switcher. Switching to an account from another server changes the server too.",
					value: multiAccount,
					onValueChange: (value: boolean) => {
						setMultiAccount(value)
						state.config = { ...state.config, multiAccount: value }
						storage.set({ multiAccount: value })
					},
				}),
				...accounts.map(a =>
					h(Design.TableRow, {
						key: a.id,
						label: displayName(a),
						subLabel: state.config.accounts[a.id] ? serverName(state.config.accounts[a.id]) : 'Unknown server',
					}),
				),
			],
		}),
	)
}
