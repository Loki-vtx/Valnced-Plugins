import { decodeJpeg } from './jpeg-decode'
import { decodePng } from './png-decode'
import { encodeVtf, toPowerOfTwo } from './vtf-encode'
import type { RgbaImage } from './types'

/** Image types this converter accepts, by their first bytes. */
export function imageKind(bytes: Uint8Array): 'png' | 'jpeg' | null {
	if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'png'
	if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg'
	return null
}

/**
 * Turns a PNG or JPEG file into the bytes of a VTF file.
 * The image is shrunk to power-of-two sides, at most `maxDimension` on each side.
 *
 * @throws If the file is not a PNG or JPEG, or it uses a feature this converter does not support.
 */
export function imageToVtf(bytes: Uint8Array, maxDimension = 1024): Uint8Array {
	const kind = imageKind(bytes)
	if (!kind) throw new Error('Only PNG and JPEG files can be converted')

	const decoded: RgbaImage = kind === 'png' ? decodePng(bytes) : decodeJpeg(bytes)
	return encodeVtf(toPowerOfTwo(decoded, maxDimension))
}
