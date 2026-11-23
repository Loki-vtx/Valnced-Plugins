import { FileModule } from '@valenced/discord/native'
import { toBase64 } from './base64'
import { CACHE_DIR, MAX_DIMENSION } from './constants'
import { encodePng } from './png'
import { decodeVtf } from './vtf'
import type { ConvertedImage } from './types'

/** Converted images keyed by attachment id. Kept for this session. */
export const converted = new Map<string, ConvertedImage>()

/**
 * Downloads a VTF file, decodes it, writes it to Discord's cache folder as a PNG and remembers the result.
 *
 * @throws If the download fails or the file is not a VTF this plugin can read.
 */
export async function convert(id: string, url: string): Promise<ConvertedImage> {
	const res = await fetch(url)
	if (!res.ok) throw new Error(`download failed (HTTP ${res.status})`)

	const image = decodeVtf(await res.arrayBuffer(), MAX_DIMENSION)
	const png = encodePng(image.width, image.height, image.rgba)

	const written = await FileModule.writeFile(
		'cache',
		`${CACHE_DIR}/${id}.png`,
		toBase64(png),
		'base64',
	)

	const result: ConvertedImage = {
		uri: written.startsWith('file://') ? written : `file://${written}`,
		width: image.width,
		height: image.height,
		size: png.length,
	}
	converted.set(id, result)
	return result
}
