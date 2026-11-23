import { lookupModule } from '@valenced/modules/finders'
import { withProps } from '@valenced/modules/finders/filters'
import { SEND_MAX_DIMENSION, TAG } from './constants'
import { imageToVtf } from './to-vtf'
import type { Attachment } from './types'

/** The part of Discord's REST client this file uses. */
interface RestApi {
	post(options: { url: string; body?: unknown }): Promise<{ body?: any }>
}

function rest(): RestApi {
	const api = lookupModule(withProps('get', 'post', 'del', 'patch'))[0] as RestApi | undefined
	if (!api) throw new Error('Discord HTTP client not found')
	return api
}

/**
 * Converts pictures to VTF and sends them in one message to a channel.
 *
 * Steps (the same ones Discord's app uses): ask for upload slots, PUT each file to its slot, then send the message
 * that names the uploaded files.
 *
 * @throws If a picture cannot be downloaded or converted, or Discord refuses a step.
 */
export async function sendAsVtf(channelId: string, sources: Attachment[]): Promise<void> {
	const api = rest()

	const files: Array<{ name: string; bytes: Uint8Array }> = []
	for (const source of sources) {
		const res = await fetch(source.url)
		if (!res.ok) throw new Error(`download failed (HTTP ${res.status})`)
		const bytes = imageToVtf(new Uint8Array(await res.arrayBuffer()), SEND_MAX_DIMENSION)
		files.push({ name: source.filename.replace(/\.[^.]+$/, '') + '.vtf', bytes })
	}

	// 1. Ask Discord for an upload slot per file.
	const slots = await api.post({
		url: `/channels/${channelId}/attachments`,
		body: {
			files: files.map((file, i) => ({
				filename: file.name,
				file_size: file.bytes.length,
				id: String(i),
			})),
		},
	})
	const list: any[] = slots.body?.attachments ?? []

	// 2. Upload each file to its slot.
	const attachments: Array<{ id: string; filename: string; uploaded_filename: string }> = []
	for (let i = 0; i < files.length; i++) {
		const slot = list.find(s => String(s.id) === String(i))
		if (!slot?.upload_url || !slot.upload_filename)
			throw new Error('Discord did not give an upload slot')

		const put = await fetch(slot.upload_url, {
			method: 'PUT',
			headers: { 'Content-Type': 'application/octet-stream' },
			body: files[i]!.bytes.buffer as ArrayBuffer,
		})
		if (!put.ok) throw new Error(`upload failed (HTTP ${put.status})`)

		attachments.push({
			id: String(i),
			filename: files[i]!.name,
			uploaded_filename: slot.upload_filename,
		})
	}

	// 3. Send the message with the uploaded files.
	await api.post({
		url: `/channels/${channelId}/messages`,
		body: {
			content: '',
			nonce: Date.now().toString(),
			tts: false,
			flags: 0,
			attachments,
		},
	})
	console.log(TAG, 'sent', attachments.length, 'VTF file(s)')
}
