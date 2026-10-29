import { Dispatcher } from '@valenced/discord/common/flux'
import { Stores } from '@valenced/discord/flux'
import { getModules } from '@valenced/modules/finders'
import { withProps } from '@valenced/modules/finders/filters'
import { instead } from '@valenced/patcher'
import { SettingsComponent, defaults } from './settings'
import type { Settings } from './settings'

const TAG = '[custom-avatars]'

type ApiOptions = { jsonStorage: Settings }

export default plugin<ApiOptions>({
	jsonStorage: {
		load: true,
		default: defaults,
	},
	SettingsComponent,
	start(api) {
		const { cleanup, jsonStorage } = api
		const reportError = (e: unknown) => api.plugin.reportError(e)
		const cfg = () => (jsonStorage.cache ?? defaults) as Settings
		const isTarget = (user: { id?: string } | undefined) => {
			const { targetUserId } = cfg()
			return !!targetUserId && user?.id === targetUserId
		}

		const patchAvatarModule = (mod: any) => {
			if (typeof mod.getUserAvatarSource === 'function')
				cleanup(
					instead(mod, 'getUserAvatarSource', (args: any[], orig: (...a: any[]) => any) => {
						const original = orig(...args)
						const { imageUrl } = cfg()
						if (!original || !imageUrl || !isTarget(args[0])) return original
						return { ...original, uri: imageUrl }
					}),
				)

			if (typeof mod.getUserAvatarURL === 'function')
				cleanup(
					instead(mod, 'getUserAvatarURL', (args: any[], orig: (...a: any[]) => any) => {
						const { imageUrl } = cfg()
						if (imageUrl && isTarget(args[0])) return imageUrl
						return orig(...args)
					}),
				)

			console.log(`${TAG} patches applied`)
		}

		cleanup(getModules(withProps('getUserAvatarURL'), patchAvatarModule))

		try {
			const { targetUserId } = cfg()
			const UserStore = Stores.UserStore as { getUser?(id: string): any } | undefined
			const user = targetUserId ? UserStore?.getUser?.(targetUserId) : undefined
			if (user) Dispatcher.dispatch({ type: 'USER_UPDATE', user })
		} catch (e) {
			reportError(e)
		}
	},
})