// Decodes a Source Engine VTF file (version 7.x) into RGBA pixels.
// Only frame 0 and face 0 are decoded. Only the mip level needed for maxDimension is decoded.

export interface VtfImage {
	width: number
	height: number
	rgba: Uint8Array
}

const FORMAT_RGBA8888 = 0
const FORMAT_ABGR8888 = 1
const FORMAT_RGB888 = 2
const FORMAT_BGR888 = 3
const FORMAT_I8 = 5
const FORMAT_IA88 = 6
const FORMAT_A8 = 8
const FORMAT_ARGB8888 = 11
const FORMAT_BGRA8888 = 12
const FORMAT_DXT1 = 13
const FORMAT_DXT3 = 14
const FORMAT_DXT5 = 15
const FORMAT_BGRX8888 = 16
const FORMAT_DXT1_ONEBITALPHA = 20

const FLAG_ENVMAP = 0x4000

function isBlockFormat(format: number): boolean {
	return (
		format === FORMAT_DXT1 ||
		format === FORMAT_DXT1_ONEBITALPHA ||
		format === FORMAT_DXT3 ||
		format === FORMAT_DXT5
	)
}

function blockBytes(format: number): number {
	return format === FORMAT_DXT1 || format === FORMAT_DXT1_ONEBITALPHA ? 8 : 16
}

function bytesPerPixel(format: number): number {
	switch (format) {
		case FORMAT_RGBA8888:
		case FORMAT_ABGR8888:
		case FORMAT_ARGB8888:
		case FORMAT_BGRA8888:
		case FORMAT_BGRX8888:
			return 4
		case FORMAT_RGB888:
		case FORMAT_BGR888:
			return 3
		case FORMAT_IA88:
			return 2
		case FORMAT_I8:
		case FORMAT_A8:
			return 1
		default:
			throw new Error(`Unsupported VTF format ${format}`)
	}
}

// Size in bytes of one image of this format and size.
function imageBytes(format: number, w: number, h: number): number {
	if (isBlockFormat(format)) {
		return Math.max(1, Math.ceil(w / 4)) * Math.max(1, Math.ceil(h / 4)) * blockBytes(format)
	}
	return w * h * bytesPerPixel(format)
}

export function decodeVtf(buffer: ArrayBuffer, maxDimension: number): VtfImage {
	const bytes = new Uint8Array(buffer)
	const view = new DataView(buffer)

	if (bytes[0] !== 0x56 || bytes[1] !== 0x54 || bytes[2] !== 0x46 || bytes[3] !== 0) {
		throw new Error('Not a VTF file (bad signature)')
	}

	const major = view.getUint32(4, true)
	if (major !== 7) throw new Error(`Unsupported VTF version ${major}`)

	const headerSize = view.getUint32(12, true)
	const width = view.getUint16(16, true)
	const height = view.getUint16(18, true)
	const flags = view.getUint32(20, true)
	const frames = Math.max(1, view.getUint16(24, true))
	const highFormat = view.getInt32(52, true)
	const mipCount = Math.max(1, bytes[56])
	const lowFormat = view.getInt32(57, true)
	const lowWidth = bytes[61]
	const lowHeight = bytes[62]
	const faces = flags & FLAG_ENVMAP ? 6 : 1

	// Pick the largest mip level that fits maxDimension. Level 0 is the full size.
	let level = 0
	while (level < mipCount - 1 && Math.max(width >> level, height >> level, 1) > maxDimension) {
		level++
	}
	const outW = Math.max(1, width >> level)
	const outH = Math.max(1, height >> level)

	// Data starts after the header, with the small thumbnail image first (if it exists).
	let offset = headerSize
	if (lowFormat !== -1 && lowWidth > 0 && lowHeight > 0) {
		offset += imageBytes(lowFormat, lowWidth, lowHeight)
	}

	// Mip levels are stored smallest first, so skip every level smaller than the one we want.
	for (let m = mipCount - 1; m > level; m--) {
		offset += imageBytes(highFormat, Math.max(1, width >> m), Math.max(1, height >> m)) * frames * faces
	}

	const size = imageBytes(highFormat, outW, outH)
	if (offset + size > bytes.length) throw new Error('VTF data is shorter than its header says')

	const rgba = new Uint8Array(outW * outH * 4)
	if (isBlockFormat(highFormat)) {
		decodeDxt(bytes, offset, highFormat, outW, outH, rgba)
	} else {
		decodeUncompressed(bytes, offset, highFormat, outW, outH, rgba)
	}

	return { width: outW, height: outH, rgba }
}

function decodeUncompressed(bytes: Uint8Array, offset: number, format: number, w: number, h: number, out: Uint8Array) {
	const bpp = bytesPerPixel(format)
	for (let i = 0; i < w * h; i++) {
		const s = offset + i * bpp
		const d = i * 4
		switch (format) {
			case FORMAT_RGBA8888:
				out[d] = bytes[s]
				out[d + 1] = bytes[s + 1]
				out[d + 2] = bytes[s + 2]
				out[d + 3] = bytes[s + 3]
				break
			case FORMAT_ABGR8888:
				out[d] = bytes[s + 3]
				out[d + 1] = bytes[s + 2]
				out[d + 2] = bytes[s + 1]
				out[d + 3] = bytes[s]
				break
			case FORMAT_ARGB8888:
				out[d] = bytes[s + 1]
				out[d + 1] = bytes[s + 2]
				out[d + 2] = bytes[s + 3]
				out[d + 3] = bytes[s]
				break
			case FORMAT_BGRA8888:
				out[d] = bytes[s + 2]
				out[d + 1] = bytes[s + 1]
				out[d + 2] = bytes[s]
				out[d + 3] = bytes[s + 3]
				break
			case FORMAT_BGRX8888:
				out[d] = bytes[s + 2]
				out[d + 1] = bytes[s + 1]
				out[d + 2] = bytes[s]
				out[d + 3] = 255
				break
			case FORMAT_RGB888:
				out[d] = bytes[s]
				out[d + 1] = bytes[s + 1]
				out[d + 2] = bytes[s + 2]
				out[d + 3] = 255
				break
			case FORMAT_BGR888:
				out[d] = bytes[s + 2]
				out[d + 1] = bytes[s + 1]
				out[d + 2] = bytes[s]
				out[d + 3] = 255
				break
			case FORMAT_I8:
				out[d] = bytes[s]
				out[d + 1] = bytes[s]
				out[d + 2] = bytes[s]
				out[d + 3] = 255
				break
			case FORMAT_IA88:
				out[d] = bytes[s]
				out[d + 1] = bytes[s]
				out[d + 2] = bytes[s]
				out[d + 3] = bytes[s + 1]
				break
			case FORMAT_A8:
				out[d] = 255
				out[d + 1] = 255
				out[d + 2] = 255
				out[d + 3] = bytes[s]
				break
		}
	}
}

function rgb565ToRgb(v: number): [number, number, number] {
	return [
		Math.round((((v >> 11) & 31) * 255) / 31),
		Math.round((((v >> 5) & 63) * 255) / 63),
		Math.round(((v & 31) * 255) / 31),
	]
}

function decodeDxt(bytes: Uint8Array, offset: number, format: number, w: number, h: number, out: Uint8Array) {
	const blocksW = Math.max(1, Math.ceil(w / 4))
	const blocksH = Math.max(1, Math.ceil(h / 4))
	const bb = blockBytes(format)
	const hasExplicitAlpha = format === FORMAT_DXT3 || format === FORMAT_DXT5

	for (let by = 0; by < blocksH; by++) {
		for (let bx = 0; bx < blocksW; bx++) {
			const p = offset + (by * blocksW + bx) * bb
			const c = hasExplicitAlpha ? p + 8 : p // colour part of the block

			// Two RGB565 endpoint colours and two palettes of colours.
			const c0 = bytes[c] | (bytes[c + 1] << 8)
			const c1 = bytes[c + 2] | (bytes[c + 3] << 8)
			const [r0, g0, b0] = rgb565ToRgb(c0)
			const [r1, g1, b1] = rgb565ToRgb(c1)
			const palette: number[][] = [
				[r0, g0, b0, 255],
				[r1, g1, b1, 255],
			]
			if (c0 > c1) {
				palette.push([
					Math.round((2 * r0 + r1) / 3),
					Math.round((2 * g0 + g1) / 3),
					Math.round((2 * b0 + b1) / 3),
					255,
				])
				palette.push([
					Math.round((r0 + 2 * r1) / 3),
					Math.round((g0 + 2 * g1) / 3),
					Math.round((b0 + 2 * b1) / 3),
					255,
				])
			} else {
				palette.push([Math.round((r0 + r1) / 2), Math.round((g0 + g1) / 2), Math.round((b0 + b1) / 2), 255])
				palette.push([0, 0, 0, 0]) // colour index 3 is transparent in DXT1
			}

			// Alpha for DXT5 uses 8 values and 3 bits per pixel.
			let alphaTable: number[] | null = null
			let alphaBits = 0
			if (format === FORMAT_DXT5) {
				const a0 = bytes[p]
				const a1 = bytes[p + 1]
				alphaTable = [a0, a1]
				if (a0 > a1) {
					// 6 values in between: (6a0+1a1)/7 ... (1a0+6a1)/7
					for (let k = 1; k <= 6; k++) {
						alphaTable.push(Math.round(((7 - k) * a0 + k * a1) / 7))
					}
				} else {
					// 4 values in between: (4a0+1a1)/5 ... (1a0+4a1)/5, then 0 and 255
					for (let k = 1; k <= 4; k++) {
						alphaTable.push(Math.round(((5 - k) * a0 + k * a1) / 5))
					}
					alphaTable.push(0, 255)
				}
				for (let k = 0; k < 6; k++) alphaBits += bytes[p + 2 + k] * 2 ** (8 * k)
			}

			const colorBits = bytes[c + 4] | (bytes[c + 5] << 8) | (bytes[c + 6] << 16) | (bytes[c + 7] << 24)

			for (let i = 0; i < 16; i++) {
				const x = bx * 4 + (i & 3)
				const y = by * 4 + (i >> 2)
				if (x >= w || y >= h) continue

				const colorIndex = (colorBits >>> (i * 2)) & 3
				const col = palette[colorIndex]

				let alpha = col[3]
				if (format === FORMAT_DXT3) {
					const byte = bytes[p + (i >> 1)]
					alpha = ((i & 1 ? byte >> 4 : byte & 15) * 17)
				} else if (format === FORMAT_DXT5 && alphaTable) {
					const alphaIndex = Math.floor(alphaBits / 2 ** (3 * i)) % 8
					alpha = alphaTable[alphaIndex]
				}

				const d = (y * w + x) * 4
				out[d] = col[0]
				out[d + 1] = col[1]
				out[d + 2] = col[2]
				out[d + 3] = alpha
			}
		}
	}
}
