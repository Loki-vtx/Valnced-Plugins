// Raw DEFLATE decoder (RFC 1951). PNG files use it inside their zlib stream.

const LEN_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258]
const LEN_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0]
const DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577]
const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13]
const CL_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15]

interface Huff {
	counts: Uint16Array
	symbols: Uint16Array
}

class BitReader {
	pos = 0
	private buf = 0
	private cnt = 0

	constructor(private readonly data: Uint8Array) {}

	/** Reads `n` bits, least significant bit first. */
	bits(n: number): number {
		while (this.cnt < n) {
			if (this.pos >= this.data.length) throw new Error('inflate: unexpected end of data')
			this.buf |= this.data[this.pos++]! << this.cnt
			this.cnt += 8
		}
		const v = this.buf & ((1 << n) - 1)
		this.buf >>>= n
		this.cnt -= n
		return v
	}

	/** Drops the bits left in the current byte (used before a stored block). */
	alignByte(): void {
		this.buf = 0
		this.cnt = 0
	}
}

function buildHuff(lengths: ArrayLike<number>): Huff {
	const counts = new Uint16Array(16)
	for (let i = 0; i < lengths.length; i++) counts[lengths[i]!]!++
	const offs = new Uint16Array(16)
	for (let len = 1; len < 15; len++) offs[len + 1] = offs[len]! + counts[len]!
	const symbols = new Uint16Array(lengths.length)
	for (let i = 0; i < lengths.length; i++) {
		const len = lengths[i]!
		if (len) symbols[offs[len]!++] = i
	}
	return { counts, symbols }
}

function decodeSym(br: BitReader, h: Huff): number {
	let code = 0
	let first = 0
	let index = 0
	for (let len = 1; len < 16; len++) {
		code |= br.bits(1)
		const count = h.counts[len]!
		if (code - count < first) return h.symbols[index + (code - first)]!
		index += count
		first += count
		first <<= 1
		code <<= 1
	}
	throw new Error('inflate: bad Huffman code')
}

let fixed: { lit: Huff; dist: Huff } | undefined
function fixedTables() {
	if (!fixed) {
		const lit = new Uint8Array(288)
		lit.fill(8, 0, 144)
		lit.fill(9, 144, 256)
		lit.fill(7, 256, 280)
		lit.fill(8, 280, 288)
		fixed = { lit: buildHuff(lit), dist: buildHuff(new Uint8Array(30).fill(5)) }
	}
	return fixed
}

function dynamicTables(br: BitReader): { lit: Huff; dist: Huff } {
	const hlit = br.bits(5) + 257
	const hdist = br.bits(5) + 1
	const hclen = br.bits(4) + 4
	const clLens = new Uint8Array(19)
	for (let i = 0; i < hclen; i++) clLens[CL_ORDER[i]!] = br.bits(3)
	const clHuff = buildHuff(clLens)

	const lens = new Uint8Array(hlit + hdist)
	let i = 0
	while (i < hlit + hdist) {
		const sym = decodeSym(br, clHuff)
		if (sym < 16) {
			lens[i++] = sym
		} else if (sym === 16) {
			const prev = lens[i - 1] ?? 0
			for (let r = 3 + br.bits(2); r > 0; r--) lens[i++] = prev
		} else if (sym === 17) {
			for (let r = 3 + br.bits(3); r > 0; r--) lens[i++] = 0
		} else {
			for (let r = 11 + br.bits(7); r > 0; r--) lens[i++] = 0
		}
	}
	return { lit: buildHuff(lens.subarray(0, hlit)), dist: buildHuff(lens.subarray(hlit)) }
}

/** Decompresses raw DEFLATE data. `sizeHint` is the expected output size (it only saves re-allocations). */
export function inflate(data: Uint8Array, sizeHint = 1 << 16): Uint8Array {
	const br = new BitReader(data)
	let out = new Uint8Array(Math.max(1024, sizeHint))
	let n = 0
	const ensure = (extra: number) => {
		if (n + extra <= out.length) return
		let size = out.length * 2
		while (size < n + extra) size *= 2
		const grown = new Uint8Array(size)
		grown.set(out.subarray(0, n))
		out = grown
	}

	let last: number
	do {
		last = br.bits(1)
		const type = br.bits(2)

		if (type === 0) {
			br.alignByte()
			const p = br.pos
			const len = data[p]! | (data[p + 1]! << 8)
			br.pos = p + 4
			ensure(len)
			out.set(data.subarray(br.pos, br.pos + len), n)
			n += len
			br.pos += len
			continue
		}

		let lit: Huff
		let dist: Huff
		if (type === 1) {
			const f = fixedTables()
			lit = f.lit
			dist = f.dist
		} else if (type === 2) {
			const d = dynamicTables(br)
			lit = d.lit
			dist = d.dist
		} else {
			throw new Error('inflate: invalid block type')
		}

		for (;;) {
			const sym = decodeSym(br, lit)
			if (sym < 256) {
				ensure(1)
				out[n++] = sym
			} else if (sym === 256) {
				break
			} else {
				const li = sym - 257
				const len = LEN_BASE[li]! + br.bits(LEN_EXTRA[li]!)
				const ds = decodeSym(br, dist)
				const d = DIST_BASE[ds]! + br.bits(DIST_EXTRA[ds]!)
				ensure(len)
				for (let i = 0; i < len; i++) {
					out[n] = out[n - d]!
					n++
				}
			}
		}
	} while (!last)

	return out.subarray(0, n)
}
