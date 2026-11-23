import { isVtfAttachment, toImageAttachment } from './attachments'
import { converted } from './convert'
import { schedule } from './queue'
import type { DiscordMessage } from './types'

/**
 * Rewrites the VTF attachments of a message, in place, as the message passes through Discord.
 * - A VTF that is already converted is replaced by its PNG.
 * - One that is not yet is queued. When it is done, the message is sent again and swapped then.
 * - In forwarded messages (snapshots) only finished conversions are swapped.
 */
export function patchMessage(message: DiscordMessage | undefined, channelId?: string): void {
	if (!message) return

	const channel = message.channel_id ?? channelId
	const { attachments } = message

	if (Array.isArray(attachments) && attachments.some(isVtfAttachment)) {
		message.attachments = attachments.map(attachment => {
			if (!isVtfAttachment(attachment)) return attachment
			if (converted.has(attachment.id)) return toImageAttachment(attachment)
			if (channel && message.id) schedule(attachment, channel, message.id)
			return attachment
		})
	}

	if (Array.isArray(message.message_snapshots)) {
		for (const snapshot of message.message_snapshots) {
			const inner = snapshot?.message
			if (!inner || !Array.isArray(inner.attachments)) continue
			inner.attachments = inner.attachments.map(attachment =>
				isVtfAttachment(attachment) ? toImageAttachment(attachment) : attachment,
			)
		}
	}
}
