import { Dispatcher } from '@valenced/discord/common/flux'
import { Stores } from '@valenced/discord/flux'
import { MAX_CONCURRENT, TAG } from './constants'
import { convert } from './convert'
import type { Attachment, MessageStore } from './types'

/**
 * The conversion queue. VTF attachments without an image yet are queued here. At most MAX_CONCURRENT run at a time.
 * When one finishes, its message is sent through Discord again, so the handlers in index.ts swap the attachment.
 */

/** True between start and stop. */
let active = false

/** Attachments that are queued or being converted, mapped to the message that holds them. */
const pending = new Map<string, { channelId: string; messageId: string }>()

/** Attachments that failed. They are not tried again until Discord reloads. */
const failed = new Set<string>()

const queue: Array<{ id: string; url: string }> = []
let running = 0

/** Turns the queue on. The returned function turns it off and drops what was waiting. */
export function startQueue(): () => void {
	active = true
	return () => {
		active = false
		queue.length = 0
	}
}

/** Queues a conversion and starts it if a slot is free. */
export function schedule(attachment: Attachment, channelId: string, messageId: string): void {
	const { id } = attachment
	if (failed.has(id) || pending.has(id)) return
	pending.set(id, { channelId, messageId })
	queue.push({ id, url: attachment.url })
	pump()
}

function pump(): void {
	while (active && running < MAX_CONCURRENT && queue.length) {
		const job = queue.shift()!
		running++

		convert(job.id, job.url)
			.then(() => refreshMessage(job.id))
			.catch(error => {
				failed.add(job.id)
				console.warn(TAG, 'failed to convert', job.id, String(error))
			})
			.finally(() => {
				pending.delete(job.id)
				running--
				pump()
			})
	}
}

/** Sends the stored message through Discord again, so the attachment gets swapped for the PNG. */
function refreshMessage(attachmentId: string): void {
	const target = pending.get(attachmentId)
	if (!active || !target) return

	const messages = Stores.MessageStore as unknown as MessageStore | undefined
	const message = messages?.getMessage?.(target.channelId, target.messageId)
	if (!message?.attachments) return

	Dispatcher.dispatch({
		type: 'MESSAGE_UPDATE',
		message: {
			id: message.id,
			channel_id: message.channel_id,
			attachments: message.attachments,
		},
	} as never)
}
