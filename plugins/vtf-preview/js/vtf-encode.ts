// Writes a VTF file (version 7.0) with one RGBA8888 image and no mipmaps.
// RGBA8888 is not compressed, so the file is large, but every Source tool can read it.

import type { RgbaImage } from './types'

/** Largest power of two that is not bigger than `n` (at least 1). */
function floorPow2(n: number): number {
	let p = 1
	while (p * 2 <= n) p *= 2
	return p
}

/** Resizes to power-of-two sides (nearest neighbour), as Source textures are usually made. */
export function toPowerOfTwo(image: RgbaImage, maxDimension: number): RgbaImage {
	const w = floorPow2(Math.min(image.width, maxDimension))
	const h = floorPow2(Math.min(image.height, maxDimension))
	if (w === image.width && h === image.height) return image

	const rgba = new Uint8Array(w * h * 4)
	for (let y = 0; y < h; y++) {
		const sy = Math.floor(((y + 0.5) * image.height) / h)
		for (let x = 0; x < w; x++) {
			const sx = Math.floor(((x + 0.5) * image.width) / w)
			const s = (sy * image.width + sx) * 4
			const d = (y * w + x) * 4
			rgba[d] = image.rgba[s]!
			rgba[d + 1] = image.rgba[s + 1]!
			rgba[d + 2] = image.rgba[s + 2]!
			rgba[d + 3] = image.rgba[s + 3]!
		}
	}
	return { width: w, height: h, rgba }
}

export function encodeVtf(image: RgbaImage): Uint8Array {
	const headerSize = 64
	const out = new Uint8Array(headerSize + image.rgba.length)
	const view = new DataView(out.buffer)

	out.set([0x56, 0x54, 0x46, 0x00], 0) // "VTF\0"
	view.setUint32(4, 7, true) // version 7.0
	view.setUint32(8, 0, true)
	view.setUint32(12, headerSize, true)
	view.setUint16(16, image.width, true)
	view.setUint16(18, image.height, true)
	view.setUint32(20, 0, true) // flags
	view.setUint16(24, 1, true) // frames
	view.setUint16(26, 0, true) // first frame
	view.setFloat32(48, 1, true) // bumpmap scale
	view.setInt32(52, 0, true) // high-res format: RGBA8888
	out[56] = 1 // mipmap count
	view.setInt32(57, -1, true) // low-res format: none
	out[61] = 0 // low-res width
	out[62] = 0 // low-res height

	out.set(image.rgba, headerSize)
	return out
}
