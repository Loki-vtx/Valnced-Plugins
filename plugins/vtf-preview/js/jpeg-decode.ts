// Baseline JPEG decoder (Huffman, 8 bits per sample). Progressive JPEG is not supported.
// Phone cameras and most saved JPEGs are baseline.

import type { RgbaImage } from './types'

/** Position of each zigzag index inside the 8x8 block (in natural order). */
const ZIGZAG = new Uint8Array([
	0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5, 12, 19, 26, 33, 40, 48, 41, 34, 27, 20, 13, 6, 7, 14, 21, 28,
	35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51, 58, 59, 52, 45, 38, 31, 39, 46, 53, 60, 61, 54, 47, 55,
	62, 63,
])

/** COS[x * 8 + u] = C(u) / 2 * cos((2x + 1) u pi / 16), used by the inverse DCT. */
const COS = (() => {
	const t = new Float32Array(64)
	for (let x = 0; x < 8; x++)
		for (let u = 0; u < 8; u++) {
			const cu = u === 0 ? Math.SQRT1_2 : 1
			t[x * 8 + u] = (cu / 2) * Math.cos(((2 * x + 1) * u * Math.PI) / 16)
		}
	return t
})()

interface HuffTable {
	maxcode: Int32Array
	valptr: Int32Array
	mincode: Int32Array
	values: Uint8Array
}

function buildHuffTable(counts: Uint8Array, values: Uint8Array): HuffTable {
	const maxcode = new Int32Array(18)
	const valptr = new Int32Array(17)
	const mincode = new Int32Array(17)
	let code = 0
	let k = 0
	for (let l = 1; l <= 16; l++) {
		valptr[l] = k
		mincode[l] = code
		code += counts[l - 1]!
		k += counts[l - 1]!
		maxcode[l] = counts[l - 1] ? code - 1 : -1
		code <<= 1
	}
	maxcode[17] = 0x7fffffff
	return { maxcode, valptr, mincode, values }
}

/** Reads bits out of the entropy-coded part of the file. Handles 0xFF00 stuffing and restart markers. */
class Bits {
	private buf = 0
	private cnt = 0

	constructor(
		private readonly data: Uint8Array,
		public pos: number,
	) {}

	private nextByte(): number {
		if (this.pos >= this.data.length) return 0
		const b = this.data[this.pos]!
		if (b !== 0xff) {
			this.pos++
			return b
		}
		if (this.data[this.pos + 1] === 0) {
			this.pos += 2
			return 0xff
		}
		// A marker ends the data. Zeros are returned from here on, without moving past it.
		return 0
	}

	bit(): number {
		if (this.cnt === 0) {
			this.buf = this.nextByte()
			this.cnt = 8
		}
		this.cnt--
		return (this.buf >> this.cnt) & 1
	}

	bits(n: number): number {
		let v = 0
		for (let i = 0; i < n; i++) v = (v << 1) | this.bit()
		return v
	}

	/** Reads `n` bits and turns them into a signed value (JPEG's "EXTEND"). */
	receiveExtend(n: number): number {
		if (n === 0) return 0
		const v = this.bits(n)
		return v < 1 << (n - 1) ? v - (1 << n) + 1 : v
	}

	huff(t: HuffTable): number {
		let code = this.bit()
		let l = 1
		while (code > t.maxcode[l]!) {
			code = (code << 1) | this.bit()
			l++
			if (l > 16) throw new Error('JPEG: bad Huffman code')
		}
		return t.values[t.valptr[l]! + code - t.mincode[l]!]!
	}

	/** Skips to just after the next RSTn marker. */
	restart(): void {
		this.cnt = 0
		this.buf = 0
		while (
			this.pos + 1 < this.data.length &&
			!(this.data[this.pos] === 0xff && this.data[this.pos + 1]! >= 0xd0 && this.data[this.pos + 1]! <= 0xd7)
		)
			this.pos++
		this.pos += 2
	}
}

interface Component {
	id: number
	h: number
	v: number
	tq: number
	td: number
	ta: number
	pred: number
	stride: number
	plane: Uint8Array
}

/** Inverse DCT of one block, written into `out` at `offset`. */
function idct(coef: Float32Array, out: Uint8Array, offset: number, stride: number): void {
	const tmp = new Float32Array(64)
	for (let v = 0; v < 8; v++)
		for (let x = 0; x < 8; x++) {
			let s = 0
			for (let u = 0; u < 8; u++) s += COS[x * 8 + u]! * coef[v * 8 + u]!
			tmp[v * 8 + x] = s
		}
	for (let y = 0; y < 8; y++)
		for (let x = 0; x < 8; x++) {
			let s = 0
			for (let v = 0; v < 8; v++) s += COS[y * 8 + v]! * tmp[v * 8 + x]!
			const val = Math.round(s + 128)
			out[offset + y * stride + x] = val < 0 ? 0 : val > 255 ? 255 : val
		}
}

export function decodeJpeg(data: Uint8Array): RgbaImage {
	if (data[0] !== 0xff || data[1] !== 0xd8) throw new Error('Not a JPEG file')

	const qt: Uint16Array[] = []
	const dcTables: HuffTable[] = []
	const acTables: HuffTable[] = []
	let width = 0
	let height = 0
	let comps: Component[] = []
	let hmax = 1
	let vmax = 1
	let restartInterval = 0

	let pos = 2
	while (pos < data.length) {
		if (data[pos] !== 0xff) {
			pos++
			continue
		}
		const marker = data[pos + 1]!
		pos += 2
		if (marker === 0xff) {
			pos--
			continue
		}
		if (marker === 0xd9) break
		if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue

		const len = (data[pos]! << 8) | data[pos + 1]!
		const seg = pos + 2
		const end = pos + len
		let next = end

		switch (marker) {
			case 0xdb: {
				// DQT: quantisation tables
				let p = seg
				while (p < end) {
					const precision = data[p]! >> 4
					const id = data[p]! & 15
					p++
					const table = new Uint16Array(64)
					for (let i = 0; i < 64; i++) {
						if (precision) {
							table[ZIGZAG[i]!] = (data[p]! << 8) | data[p + 1]!
							p += 2
						} else {
							table[ZIGZAG[i]!] = data[p]!
							p++
						}
					}
					qt[id] = table
				}
				break
			}
			case 0xc4: {
				// DHT: Huffman tables
				let p = seg
				while (p < end) {
					const cls = data[p]! >> 4
					const id = data[p]! & 15
					p++
					const counts = data.subarray(p, p + 16)
					p += 16
					let total = 0
					for (let i = 0; i < 16; i++) total += counts[i]!
					const values = data.slice(p, p + total)
					p += total
					const table = buildHuffTable(counts, values)
					if (cls === 0) dcTables[id] = table
					else acTables[id] = table
				}
				break
			}
			case 0xc0:
			case 0xc1: {
				// SOF0 / SOF1: baseline and extended Huffman frames
				if (data[seg] !== 8) throw new Error('JPEG: only 8-bit samples are supported')
				height = (data[seg + 1]! << 8) | data[seg + 2]!
				width = (data[seg + 3]! << 8) | data[seg + 4]!
				const count = data[seg + 5]!
				comps = []
				for (let i = 0; i < count; i++) {
					const p = seg + 6 + i * 3
					comps.push({
						id: data[p]!,
						h: data[p + 1]! >> 4,
						v: data[p + 1]! & 15,
						tq: data[p + 2]!,
						td: 0,
						ta: 0,
						pred: 0,
						stride: 0,
						plane: new Uint8Array(0),
					})
				}
				hmax = Math.max(...comps.map(c => c.h))
				vmax = Math.max(...comps.map(c => c.v))
				const mcusX = Math.ceil(width / (8 * hmax))
				const mcusY = Math.ceil(height / (8 * vmax))
				for (const c of comps) {
					c.stride = mcusX * c.h * 8
					c.plane = new Uint8Array(c.stride * mcusY * c.v * 8)
				}
				break
			}
			case 0xc2:
			case 0xc3:
			case 0xc5:
			case 0xc6:
			case 0xc7:
			case 0xc9:
			case 0xca:
			case 0xcb:
			case 0xcd:
			case 0xce:
			case 0xcf:
				throw new Error('JPEG: progressive or lossless JPEG is not supported')
			case 0xdd:
				// DRI: restart interval
				restartInterval = (data[seg]! << 8) | data[seg + 1]!
				break
			case 0xda: {
				// SOS: start of the scan. The entropy-coded data follows the header.
				const ns = data[seg]!
				const scan: Component[] = []
				for (let i = 0; i < ns; i++) {
					const id = data[seg + 1 + i * 2]!
					const tables = data[seg + 2 + i * 2]!
					const c = comps.find(x => x.id === id)
					if (!c) throw new Error('JPEG: scan refers to an unknown component')
					c.td = tables >> 4
					c.ta = tables & 15
					scan.push(c)
				}
				next = decodeScan(data, end, scan)
				break
			}
			default:
				break
		}
		pos = next
	}

	function decodeScan(bytes: Uint8Array, start: number, scan: Component[]): number {
		const bits = new Bits(bytes, start)
		for (const c of scan) c.pred = 0

		const block = new Float32Array(64)
		const decodeBlock = (c: Component, bx: number, by: number) => {
			const dc = dcTables[c.td]
			const ac = acTables[c.ta]
			const table = qt[c.tq]
			if (!dc || !ac || !table) throw new Error('JPEG: missing table')

			block.fill(0)
			const t = bits.huff(dc)
			c.pred += bits.receiveExtend(t)
			block[0] = c.pred * table[0]!

			for (let k = 1; k < 64; ) {
				const rs = bits.huff(ac)
				const s = rs & 15
				const r = rs >> 4
				if (s === 0) {
					if (r === 15) {
						k += 16
						continue
					}
					break
				}
				k += r
				if (k > 63) break
				const z = ZIGZAG[k]!
				block[z] = bits.receiveExtend(s) * table[z]!
				k++
			}
			idct(block, c.plane, by * 8 * c.stride + bx * 8, c.stride)
		}

		const mcusX = Math.ceil(width / (8 * hmax))
		const mcusY = Math.ceil(height / (8 * vmax))
		let units = 0
		const beforeUnit = () => {
			if (restartInterval && units > 0 && units % restartInterval === 0) {
				bits.restart()
				for (const c of scan) c.pred = 0
			}
			units++
		}

		if (scan.length === 1) {
			// Single-component scan: blocks cover only the component's own size.
			const c = scan[0]!
			const compW = Math.ceil(Math.ceil((width * c.h) / hmax) / 8)
			const compH = Math.ceil(Math.ceil((height * c.v) / vmax) / 8)
			for (let by = 0; by < compH; by++)
				for (let bx = 0; bx < compW; bx++) {
					beforeUnit()
					decodeBlock(c, bx, by)
				}
		} else {
			for (let my = 0; my < mcusY; my++)
				for (let mx = 0; mx < mcusX; mx++) {
					beforeUnit()
					for (const c of scan)
						for (let v = 0; v < c.v; v++)
							for (let h = 0; h < c.h; h++) decodeBlock(c, mx * c.h + h, my * c.v + v)
				}
		}
		return bits.pos
	}

	// Colour conversion. Subsampled components are upsampled with bilinear interpolation,
	// which is close to what libjpeg does.
	const out = new Uint8Array(width * height * 4)
	const sample = (c: Component, x: number, y: number) => {
		const maxX = Math.ceil((width * c.h) / hmax) - 1
		const maxY = Math.ceil((height * c.v) / vmax) - 1
		const sx = Math.max(0, Math.min(maxX, ((x + 0.5) * c.h) / hmax - 0.5))
		const sy = Math.max(0, Math.min(maxY, ((y + 0.5) * c.v) / vmax - 0.5))
		const x0 = Math.floor(sx)
		const y0 = Math.floor(sy)
		const x1 = Math.min(x0 + 1, maxX)
		const y1 = Math.min(y0 + 1, maxY)
		const fx = sx - x0
		const fy = sy - y0
		const p = (px: number, py: number) => c.plane[py * c.stride + px]!
		return (
			p(x0, y0) * (1 - fx) * (1 - fy) +
			p(x1, y0) * fx * (1 - fy) +
			p(x0, y1) * (1 - fx) * fy +
			p(x1, y1) * fx * fy
		)
	}

	for (let y = 0; y < height; y++)
		for (let x = 0; x < width; x++) {
			const o = (y * width + x) * 4
			if (comps.length === 1) {
				const g = sample(comps[0]!, x, y)
				out[o] = out[o + 1] = out[o + 2] = g
			} else {
				const Y = sample(comps[0]!, x, y)
				const cb = sample(comps[1]!, x, y) - 128
				const cr = sample(comps[2]!, x, y) - 128
				const r = Math.round(Y + 1.402 * cr)
				const g = Math.round(Y - 0.344136 * cb - 0.714136 * cr)
				const b = Math.round(Y + 1.772 * cb)
				out[o] = r < 0 ? 0 : r > 255 ? 255 : r
				out[o + 1] = g < 0 ? 0 : g > 255 ? 255 : g
				out[o + 2] = b < 0 ? 0 : b > 255 ? 255 : b
			}
			out[o + 3] = 255
		}

	if (!width || !height || !comps.length) throw new Error('JPEG: no picture found')
	return { width, height, rgba: out }
}
