// Writes a VTF 7.2 file: an 80-byte header, a DXT1 thumbnail, then RGBA8888 mip levels, smallest first.
// The main image is uncompressed, so the file is large, but it needs no compression code.

import { encodeDxt1 } from './dxt-encode'
import type { RgbaImage } from './types'

const HEADER_SIZE = 80
const FORMAT_RGBA8888 = 0
const FORMAT_DXT1 = 13
/** The thumbnail's largest side, in pixels. VTF 7.2 allows at most 16. */
const THUMB_MAX = 16
/** DXT needs sides that are multiples of 4, so no side goes below this. */
const MIN_SIDE = 4

/** Largest power of two that is not bigger than `n` (at least 1). */
function floorPow2(n: number): number {
	let p = 1
	while (p * 2 <= n) p *= 2
	return p
}

/** Resizes to power-of-two sides (nearest neighbour), as Source textures are usually made. */
export function toPowerOfTwo(image: RgbaImage, maxDimension: number): RgbaImage {
	const w = Math.max(MIN_SIDE, floorPow2(Math.min(image.width, maxDimension)))
	const h = Math.max(MIN_SIDE, floorPow2(Math.min(image.height, maxDimension)))
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

/**
 * Shrinks an image to `w` by `h` by averaging blocks of pixels.
 * Both ratios must be whole numbers, which holds for power-of-two sides.
 */
function boxResize(image: RgbaImage, w: number, h: number): RgbaImage {
	if (w === image.width && h === image.height) return image
	const bx = image.width / w
	const by = image.height / h
	const area = bx * by
	const rgba = new Uint8Array(w * h * 4)
	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			let r = 0
			let g = 0
			let b = 0
			let a = 0
			for (let sy = 0; sy < by; sy++) {
				for (let sx = 0; sx < bx; sx++) {
					const s = ((y * by + sy) * image.width + (x * bx + sx)) * 4
					r += image.rgba[s]!
					g += image.rgba[s + 1]!
					b += image.rgba[s + 2]!
					a += image.rgba[s + 3]!
				}
			}
			const d = (y * w + x) * 4
			rgba[d] = Math.round(r / area)
			rgba[d + 1] = Math.round(g / area)
			rgba[d + 2] = Math.round(b / area)
			rgba[d + 3] = Math.round(a / area)
		}
	}
	return { width: w, height: h, rgba }
}

/** The thumbnail: the largest side is 16 pixels (or the image itself if it is smaller), the aspect is kept. */
function thumbnailOf(image: RgbaImage): RgbaImage {
	const maxSide = Math.max(image.width, image.height)
	if (maxSide <= THUMB_MAX) return image
	const w = Math.max(MIN_SIDE, Math.floor((image.width * THUMB_MAX) / maxSide))
	const h = Math.max(MIN_SIDE, Math.floor((image.height * THUMB_MAX) / maxSide))
	return boxResize(image, w, h)
}

/** Average colour of an image as 0 to 1 values, which VTF stores as reflectivity. */
function averageColour(image: RgbaImage): [number, number, number] {
	let r = 0
	let g = 0
	let b = 0
	const n = image.width * image.height
	for (let i = 0; i < n; i++) {
		r += image.rgba[i * 4]!
		g += image.rgba[i * 4 + 1]!
		b += image.rgba[i * 4 + 2]!
	}
	return [r / n / 255, g / n / 255, b / n / 255]
}

/**
 * Encodes an image whose sides are powers of two (at least 4) as a VTF 7.2 file.
 * The file holds the full mip chain down to 1 by 1, and the mips are stored smallest first.
 */
export function encodeVtf(image: RgbaImage): Uint8Array {
	const { width, height } = image
	const mipCount = Math.floor(Math.log2(Math.max(width, height))) + 1

	// levels[m] is the image at mip m. Each level is a box-filtered half of the one before.
	const levels: RgbaImage[] = [image]
	for (let m = 1; m < mipCount; m++) {
		const prev = levels[m - 1]!
		levels.push(boxResize(prev, Math.max(1, prev.width >> 1), Math.max(1, prev.height >> 1)))
	}

	const thumb = thumbnailOf(image)
	const thumbData = encodeDxt1(thumb)
	let mipBytes = 0
	for (const level of levels) mipBytes += level.rgba.length

	const out = new Uint8Array(HEADER_SIZE + thumbData.length + mipBytes)
	const view = new DataView(out.buffer)

	out.set([0x56, 0x54, 0x46, 0x00], 0) // "VTF\0"
	view.setUint32(4, 7, true) // major version 7
	view.setUint32(8, 2, true) // minor version 2 (7.2)
	view.setUint32(12, HEADER_SIZE, true)
	view.setUint16(16, width, true)
	view.setUint16(18, height, true)
	view.setUint32(20, 0, true) // flags: none
	view.setUint16(24, 1, true) // frames
	view.setUint16(26, 0, true) // first frame
	const [rr, rg, rb] = averageColour(image)
	view.setFloat32(32, rr, true) // reflectivity
	view.setFloat32(36, rg, true)
	view.setFloat32(40, rb, true)
	view.setFloat32(48, 1, true) // bumpmap scale
	view.setInt32(52, FORMAT_RGBA8888, true) // high-res format
	out[56] = mipCount
	view.setInt32(57, FORMAT_DXT1, true) // low-res (thumbnail) format
	out[61] = thumb.width
	out[62] = thumb.height
	view.setUint16(63, 1, true) // depth: a 2D texture

	let offset = HEADER_SIZE
	out.set(thumbData, offset)
	offset += thumbData.length
	for (let m = mipCount - 1; m >= 0; m--) {
		const level = levels[m]!
		out.set(level.rgba, offset)
		offset += level.rgba.length
	}
	return out
}
