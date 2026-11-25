// Compresses RGBA pixels to DXT1 (BC1) blocks. Used for the small thumbnail that a VTF 7.2 file stores first.
// Alpha is dropped: DXT1 is colour only in this encoder.

import type { RgbaImage } from './types'

/** Packs 8-bit colour into RGB565. */
function pack565(r: number, g: number, b: number): number {
	return ((r >> 3) << 11) | ((g >> 2) << 5) | (b >> 3)
}

/** Expands an RGB565 value back to 8-bit colour, the way a DXT1 decoder does. */
function unpack565(v: number): [number, number, number] {
	const r5 = (v >> 11) & 31
	const g6 = (v >> 5) & 63
	const b5 = v & 31
	return [(r5 << 3) | (r5 >> 2), (g6 << 2) | (g6 >> 4), (b5 << 3) | (b5 >> 2)]
}

/**
 * Encodes an image whose sides are multiples of 4 as DXT1.
 * Each 4x4 block gets the two colours with the lowest and highest brightness as its endpoints.
 *
 * @throws If a side is not a multiple of 4.
 */
export function encodeDxt1(image: RgbaImage): Uint8Array {
	const { width, height, rgba } = image
	if (width % 4 !== 0 || height % 4 !== 0) throw new Error('DXT1 needs sides that are multiples of 4')

	const blocksX = width / 4
	const blocksY = height / 4
	const out = new Uint8Array(blocksX * blocksY * 8)
	const view = new DataView(out.buffer)
	const pr = new Uint8Array(16)
	const pg = new Uint8Array(16)
	const pb = new Uint8Array(16)
	const palR = new Float64Array(4)
	const palG = new Float64Array(4)
	const palB = new Float64Array(4)

	let o = 0
	for (let by = 0; by < blocksY; by++) {
		for (let bx = 0; bx < blocksX; bx++) {
			// Gather the 16 pixels of the block and find the brightest and darkest one.
			let minLuma = Infinity
			let maxLuma = -Infinity
			let lo = 0
			let hi = 0
			for (let i = 0; i < 16; i++) {
				const s = ((by * 4 + (i >> 2)) * width + bx * 4 + (i & 3)) * 4
				const r = rgba[s]!
				const g = rgba[s + 1]!
				const b = rgba[s + 2]!
				pr[i] = r
				pg[i] = g
				pb[i] = b
				const luma = 0.299 * r + 0.587 * g + 0.114 * b
				if (luma < minLuma) {
					minLuma = luma
					lo = i
				}
				if (luma > maxLuma) {
					maxLuma = luma
					hi = i
				}
			}

			let c0 = pack565(pr[hi]!, pg[hi]!, pb[hi]!)
			let c1 = pack565(pr[lo]!, pg[lo]!, pb[lo]!)
			let indices = 0

			if (c0 === c1) {
				// One colour: every pixel uses index 0, which is c0.
				indices = 0
			} else {
				// Four-colour mode needs c0 > c1.
				if (c0 < c1) [c0, c1] = [c1, c0]
				const [r0, g0, b0] = unpack565(c0)
				const [r1, g1, b1] = unpack565(c1)
				palR[0] = r0
				palG[0] = g0
				palB[0] = b0
				palR[1] = r1
				palG[1] = g1
				palB[1] = b1
				palR[2] = (2 * r0 + r1) / 3
				palG[2] = (2 * g0 + g1) / 3
				palB[2] = (2 * b0 + b1) / 3
				palR[3] = (r0 + 2 * r1) / 3
				palG[3] = (g0 + 2 * g1) / 3
				palB[3] = (b0 + 2 * b1) / 3

				for (let i = 0; i < 16; i++) {
					let best = 0
					let bestDist = Infinity
					for (let k = 0; k < 4; k++) {
						const dr = pr[i]! - palR[k]!
						const dg = pg[i]! - palG[k]!
						const db = pb[i]! - palB[k]!
						const dist = dr * dr + dg * dg + db * db
						if (dist < bestDist) {
							bestDist = dist
							best = k
						}
					}
					indices |= best << (2 * i)
				}
			}

			view.setUint16(o, c0, true)
			view.setUint16(o + 2, c1, true)
			view.setUint32(o + 4, indices >>> 0, true)
			o += 8
		}
	}
	return out
}
