import { VTF_FILE_PATTERN } from './constants'
import { converted } from './convert'
import type { Attachment } from './types'

/** Whether an attachment is a VTF file: a `.vtf` name and a download link. */
export function isVtfAttachment(attachment: unknown): attachment is Attachment {
	const candidate = attachment as Partial<Attachment> | null | undefined
	return (
		typeof candidate?.filename === 'string' &&
		VTF_FILE_PATTERN.test(candidate.filename) &&
		typeof candidate.url === 'string'
	)
}

/**
 * Turns a VTF attachment into the converted PNG, so Discord draws an image instead of a file.
 * Returns the attachment unchanged if it has not been converted yet.
 */
export function toImageAttachment(attachment: Attachment): Attachment {
	const image = converted.get(attachment.id)
	if (!image) return attachment

	return {
		...attachment,
		filename: attachment.filename.replace(VTF_FILE_PATTERN, '.png'),
		content_type: 'image/png',
		url: image.uri,
		proxy_url: image.uri,
		width: image.width,
		height: image.height,
		size: image.size,
	}
}

/** Whether an attachment is a picture this plugin can convert: a PNG or JPEG with a download link. */
export function isImageAttachment(attachment: unknown): attachment is Attachment {
	const candidate = attachment as Partial<Attachment> | null | undefined
	return (
		typeof candidate?.filename === 'string' &&
		/\.(png|jpe?g)$/i.test(candidate.filename) &&
		typeof candidate.url === 'string'
	)
}
