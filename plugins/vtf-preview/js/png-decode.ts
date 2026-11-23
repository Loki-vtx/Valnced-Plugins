import { inflate } from './inflate'
import type { RgbaImage } from './types'

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10]
/** Channels per pixel for each PNG colour type. */
const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }

function u32(d: Uint8Array, i: number): number {
	return ((d[i]! << 24) | (d[i + 1]! << 16) | (d[i + 2]! << 8) | d[i + 3]!) >>> 0
}

function paeth(a: number, b: number, c: number): number {
	const p = a + b - c
	const pa = Math.abs(p - a)
	const pb = Math.abs(p - b)
	const pc = Math.abs(p - c)
	return pa <= pb && pa <= pc ? a : pb <= pc ? b : c
}

/** Decodes a PNG (8 or 16 bits per channel, not interlaced) to RGBA. */
export function decodePng(d: Uint8Array): RgbaImage {
	for (let i = 0; i < 8; i++) if (d[i] !== SIGNATURE[i]) throw new Error('Not a PNG file')

	let width = 0
	let height = 0
	let depth = 8
	let colorType = 0
	let interlace = 0
	let palette: Uint8Array | undefined
	let paletteAlpha: Uint8Array | undefined
	const idat: Uint8Array[] = []
	let idatLength = 0

	let pos = 8
	while (pos + 8 <= d.length) {
		const len = u32(d, pos)
		const type = String.fromCharCode(d[pos + 4]!, d[pos + 5]!, d[pos + 6]!, d[pos + 7]!)
		const data = d.subarray(pos + 8, pos + 8 + len)
		pos += 12 + len
		if (type === 'IHDR') {
			width = u32(data, 0)
			height = u32(data, 4)
			depth = data[8]!
			colorType = data[9]!
			interlace = data[12]!
		} else if (type === 'PLTE') {
			palette = data
		} else if (type === 'tRNS') {
			paletteAlpha = data
		} else if (type === 'IDAT') {
			idat.push(data)
			idatLength += data.length
		} else if (type === 'IEND') {
			break
		}
	}

	if (interlace) throw new Error('Interlaced PNG is not supported')
	if (depth !== 8 && depth !== 16) throw new Error(`PNG bit depth ${depth} is not supported`)
	const channels = CHANNELS[colorType]
	if (!channels) throw new Error(`PNG colour type ${colorType} is not supported`)
	if (colorType === 3 && !palette) throw new Error('PNG palette is missing')

	const bytesPerSample = depth / 8
	const bpp = channels * bytesPerSample // bytes per pixel, used by the filters
	const stride = width * bpp

	const zlib = new Uint8Array(idatLength)
	let o = 0
	for (const part of idat) {
		zlib.set(part, o)
		o += part.length
	}
	// The first two bytes are the zlib header.
	const raw = inflate(zlib.subarray(2), (stride + 1) * height)

	// Undo the per-row filters.
	const pixels = new Uint8Array(stride * height)
	for (let y = 0; y < height; y++) {
		const filter = raw[y * (stride + 1)]!
		const src = y * (stride + 1) + 1
		const dst = y * stride
		for (let x = 0; x < stride; x++) {
			const v = raw[src + x]!
			const a = x >= bpp ? pixels[dst + x - bpp]! : 0
			const b = y > 0 ? pixels[dst - stride + x]! : 0
			const c = x >= bpp && y > 0 ? pixels[dst - stride + x - bpp]! : 0
			let out: number
			switch (filter) {
				case 0:
					out = v
					break
				case 1:
					out = v + a
					break
				case 2:
					out = v + b
					break
				case 3:
					out = v + ((a + b) >> 1)
					break
				case 4:
					out = v + paeth(a, b, c)
					break
				default:
					throw new Error(`PNG filter ${filter} is not valid`)
			}
			pixels[dst + x] = out & 0xff
		}
	}

	// Convert to RGBA. 16-bit samples keep their high byte.
	const count = width * height
	const rgba = new Uint8Array(count * 4)
	const sample = (p: number, k: number) => pixels[p + k * bytesPerSample]!
	for (let i = 0; i < count; i++) {
		const p = i * bpp
		let r: number
		let g: number
		let b: number
		let alpha = 255
		switch (colorType) {
			case 0:
				r = g = b = sample(p, 0)
				break
			case 2:
				r = sample(p, 0)
				g = sample(p, 1)
				b = sample(p, 2)
				break
			case 3: {
				const index = sample(p, 0)
				r = palette![index * 3] ?? 0
				g = palette![index * 3 + 1] ?? 0
				b = palette![index * 3 + 2] ?? 0
				alpha = paletteAlpha?.[index] ?? 255
				break
			}
			case 4:
				r = g = b = sample(p, 0)
				alpha = sample(p, 1)
				break
			default:
				r = sample(p, 0)
				g = sample(p, 1)
				b = sample(p, 2)
				alpha = sample(p, 3)
		}
		rgba[i * 4] = r
		rgba[i * 4 + 1] = g
		rgba[i * 4 + 2] = b
		rgba[i * 4 + 3] = alpha
	}

	return { width, height, rgba }
}
