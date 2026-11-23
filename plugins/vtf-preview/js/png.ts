// Minimal PNG encoder (RGBA, 8 bits per channel) and base64 encoder.
// Uses "stored" deflate blocks, so no compression library is needed.
// The file is bigger than a real PNG, but it is simple and works everywhere.

const CRC_TABLE = (() => {
	const table = new Uint32Array(256)
	for (let n = 0; n < 256; n++) {
		let c = n
		for (let k = 0; k < 8; k++) {
			c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
		}
		table[n] = c >>> 0
	}
	return table
})()

function crc32(bytes: Uint8Array): number {
	let c = 0xffffffff
	for (let i = 0; i < bytes.length; i++) {
		c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8)
	}
	return (c ^ 0xffffffff) >>> 0
}

function adler32(bytes: Uint8Array): number {
	let a = 1
	let b = 0
	for (let i = 0; i < bytes.length; i++) {
		a = (a + bytes[i]) % 65521
		b = (b + a) % 65521
	}
	return (b * 65536 + a) >>> 0
}

function makeChunk(type: string, data: Uint8Array): Uint8Array {
	const out = new Uint8Array(12 + data.length)
	const view = new DataView(out.buffer)
	view.setUint32(0, data.length)
	for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i)
	out.set(data, 8)
	view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)))
	return out
}

export function encodePng(width: number, height: number, rgba: Uint8Array): Uint8Array {
	// Raw image data: each row starts with a filter byte (0 = none).
	const stride = width * 4
	const raw = new Uint8Array(height * (stride + 1))
	for (let y = 0; y < height; y++) {
		raw[y * (stride + 1)] = 0
		raw.set(rgba.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1)
	}

	// zlib stream made of stored (uncompressed) deflate blocks.
	const blocks = Math.max(1, Math.ceil(raw.length / 65535))
	const z = new Uint8Array(2 + raw.length + blocks * 5 + 4)
	let p = 0
	z[p++] = 0x78
	z[p++] = 0x01
	for (let i = 0; i < blocks; i++) {
		const start = i * 65535
		const len = Math.min(65535, raw.length - start)
		z[p++] = i === blocks - 1 ? 1 : 0
		z[p++] = len & 0xff
		z[p++] = len >> 8
		z[p++] = ~len & 0xff
		z[p++] = (~len >> 8) & 0xff
		z.set(raw.subarray(start, start + len), p)
		p += len
	}
	const adler = adler32(raw)
	z[p++] = (adler >>> 24) & 0xff
	z[p++] = (adler >>> 16) & 0xff
	z[p++] = (adler >>> 8) & 0xff
	z[p++] = adler & 0xff

	const ihdr = new Uint8Array(13)
	const ihdrView = new DataView(ihdr.buffer)
	ihdrView.setUint32(0, width)
	ihdrView.setUint32(4, height)
	ihdr[8] = 8 // bit depth
	ihdr[9] = 6 // colour type: RGBA
	ihdr[10] = 0 // compression
	ihdr[11] = 0 // filter
	ihdr[12] = 0 // interlace

	const chunks = [
		makeChunk('IHDR', ihdr),
		makeChunk('IDAT', z),
		makeChunk('IEND', new Uint8Array(0)),
	]
	const signature = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
	const total = signature.length + chunks.reduce((sum, c) => sum + c.length, 0)
	const png = new Uint8Array(total)
	png.set(signature, 0)
	let offset = signature.length
	for (const chunk of chunks) {
		png.set(chunk, offset)
		offset += chunk.length
	}
	return png
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

export function toBase64(bytes: Uint8Array): string {
	const parts: string[] = []
	for (let i = 0; i < bytes.length; i += 3) {
		const a = bytes[i]
		const b = i + 1 < bytes.length ? bytes[i + 1] : 0
		const c = i + 2 < bytes.length ? bytes[i + 2] : 0
		const n = (a << 16) | (b << 8) | c
		parts.push(B64[(n >> 18) & 63], B64[(n >> 12) & 63])
		parts.push(i + 1 < bytes.length ? B64[(n >> 6) & 63] : '=')
		parts.push(i + 2 < bytes.length ? B64[n & 63] : '=')
	}
	return parts.join('')
}
