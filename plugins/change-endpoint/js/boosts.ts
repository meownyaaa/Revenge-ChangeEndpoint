import { getStore, onAnyFluxEventDispatched } from '@revenge-mod/discord/flux'
import { getModules, lookupModule } from '@revenge-mod/modules/finders'
import { withProps } from '@revenge-mod/modules/finders/filters'
import { instead } from '@revenge-mod/patcher'
import { onInstanceChange, state } from './state'

type Cleanup = (...fns: (() => any)[]) => void

const BOOST_TIER_THRESHOLDS = [2, 7, 14]
const BOOST_FEATURES = [
	'ANIMATED_ICON', 'ANIMATED_BANNER', 'BANNER', 'INVITE_SPLASH', 'VANITY_URL',
	'MORE_EMOJI', 'MORE_STICKERS', 'MORE_SOUNDBOARD', 'ROLE_ICONS', 'ROLE_SUBSCRIPTIONS_ENABLED',
]

const limits = { maxEmojis: 2000, maxStickers: 500 }

async function loadLimits() {
	if (!state.endpoints) return
	try {
		const http = lookupModule(withProps<{ get(options: { url: string }): Promise<{ body: any }>; post: unknown; put: unknown; patch: unknown; del: unknown; V8APIError: unknown }>('get', 'post', 'put', 'patch', 'del', 'V8APIError'))[0]
		const { body } = await http!.get({ url: '/policies/instance/limits' })
		limits.maxEmojis = body?.guild?.maxEmojis ?? limits.maxEmojis
		limits.maxStickers = body?.guild?.maxStickers ?? limits.maxStickers
	} catch (e) {
		console.warn("[ChangeEndpoint] couldn't load instance limits, using Spacebar's defaults", e)
	}
}

function boostPerks() {
	const count = Math.max(0, Math.floor(state.config.boostCount))
	const tier = BOOST_TIER_THRESHOLDS.filter(t => count >= t).length
	return { count, tier, features: tier === BOOST_TIER_THRESHOLDS.length ? BOOST_FEATURES : [] }
}

// the server's own features, spoofed ones sent back in a guild edit are refused (45007)
const realFeatures = new Map<string, string[]>()

export function withoutSpoofedFeatures(guildId: string, features: string[]) {
	const real = realFeatures.get(guildId)
	if (!real) return null
	const spoofed = new Set(boostPerks().features.filter(f => !real.includes(f)))
	return features.filter(f => !spoofed.has(f))
}

// raw gateway guilds keep their fields under properties
function boostRawGuild(guild: any) {
	if (!guild || typeof guild !== 'object') return
	const { count, tier, features } = boostPerks()
	const properties = guild.properties ?? guild
	const id = guild.id ?? properties.id
	if (id && Array.isArray(properties.features)) realFeatures.set(id, [...properties.features])
	properties.premium_tier = tier
	properties.features = Array.from(new Set([...(properties.features ?? []), ...features]))
	guild.premium_subscription_count = count
}

let guildStore: { getGuilds(): Record<string, any>; emitChange(): void } | undefined

// guilds already in the store (the startup cache) never pass through the interceptor
function boostLoadedGuilds() {
	if (!state.endpoints || !guildStore) return
	const { count, tier, features } = boostPerks()
	for (const guild of Object.values(guildStore.getGuilds())) {
		guild.premiumTier = tier
		guild.premiumSubscriberCount = count
		for (const feature of features) guild.features?.add?.(feature)
	}
	guildStore.emitChange()
}

export function patchBoosts(cleanup: Cleanup) {
	cleanup(
		getStore<NonNullable<typeof guildStore>>('GuildStore', store => {
			guildStore = store
			boostLoadedGuilds()
		}),
		onAnyFluxEventDispatched(payload => {
			if (!state.endpoints) return payload
			try {
				const p = payload as any
				if (p.type === 'GUILD_CREATE' || p.type === 'GUILD_UPDATE') boostRawGuild(p.guild)
				else if (p.type === 'CONNECTION_OPEN' || p.type === 'READY') p.guilds?.forEach(boostRawGuild)
				else if (p.type === 'CACHE_LOADED') setTimeout(boostLoadedGuilds, 0)
			} catch (e) {
				console.warn('[ChangeEndpoint] boost spoof failed', e)
			}
			return payload
		}),
		onInstanceChange(() => void loadLimits()),
		// the server's own limits instead of the slot counts Discord hardcodes per boost tier
		getModules(
			withProps<{
				getMaxEmojiSlots(guild: any): number
				getTotalStickerCountForTier(tier: number, guild?: any): number
				getIncrementalStickerCountForTier(tier: number): number
			}>('getMaxEmojiSlots', 'getTotalStickerCountForTier'),
			slots => {
				const incremental = slots.getIncrementalStickerCountForTier
				cleanup(
					instead(slots, 'getMaxEmojiSlots', function (args, original) {
						return state.endpoints && args[0]?.features?.has?.('MORE_EMOJI') ? limits.maxEmojis : original.apply(this, args)
					}),
					instead(slots, 'getTotalStickerCountForTier', function (args, original) {
						return state.endpoints && args[0] === 3 ? limits.maxStickers : original.apply(this, args)
					}),
					// the sticker settings list slots per level, level 3 gets what's left of the server's max
					instead(slots, 'getIncrementalStickerCountForTier', function (args, original) {
						return state.endpoints && args[0] === 3
							? Math.max(0, limits.maxStickers - incremental(0) - incremental(1) - incremental(2))
							: original.apply(this, args)
					}),
				)
			},
		),
	)
}

export const loadInstanceLimits = loadLimits
