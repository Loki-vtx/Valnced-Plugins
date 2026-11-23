import { onFluxEventDispatched } from '@valenced/discord/flux'
import { MESSAGE_LIST_EVENTS, SINGLE_MESSAGE_EVENTS, TAG } from './constants'
import { patchMessage } from './patch'
import { startQueue } from './queue'
import { installSendMenu } from './menu-vtf'
import type { DiscordMessage } from './types'

/**
 * VTF Viewer.
 *
 * Every chat message passes through Flux events on its way into the app. This plugin rewrites the .vtf attachments in
 * those events: each one is decoded on the phone and replaced by a PNG, so Discord draws the picture in the chat.
 */
export default plugin({
	start({ cleanup }) {
		cleanup(startQueue())

		try {
			installSendMenu(cleanup)
		} catch (error) {
			console.warn(TAG, 'send menu patch failed:', String(error))
		}

		for (const type of SINGLE_MESSAGE_EVENTS) {
			cleanup(
				onFluxEventDispatched<{ message?: DiscordMessage }>(type, payload => {
					try {
						patchMessage(payload.message)
					} catch (error) {
						console.warn(TAG, type, 'patch failed:', String(error))
					}
					return payload
				}),
			)
		}

		for (const type of MESSAGE_LIST_EVENTS) {
			cleanup(
				onFluxEventDispatched<{ messages?: DiscordMessage[]; channelId?: string }>(type, payload => {
					try {
						if (Array.isArray(payload.messages)) {
							for (const message of payload.messages) patchMessage(message, payload.channelId)
						}
					} catch (error) {
						console.warn(TAG, type, 'patch failed:', String(error))
					}
					return payload
				}),
			)
		}
	},
})
