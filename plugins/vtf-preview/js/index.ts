import { instead } from '@valenced/patcher'
import { React } from '@valenced/react'
import { decodeVtf } from './vtf'
import { encodePng, toBase64 } from './png'

const TAG = '[vtf-preview]'
// Largest side (in pixels) to show. Bigger images make a bigger data URI, so keep this moderate.
const MAX_DIMENSION = 512
// Module that builds the content of a chat message. Found by its path.
const RENDERER_PATH = 'modules/messages/native/renderer/createMessageContent.tsx'

interface VtfRef {
	filename: string
	url: string
}

interface Loaded {
	uri: string
	width: number
	height: number
}

// url -> decoded image. Shared by all message renders, so each file is only downloaded once.
const cache = new Map<string, Promise<Loaded>>()

function loadVtf(url: string): Promise<Loaded> {
	let entry = cache.get(url)
	if (!entry) {
		entry = (async () => {
			const res = await fetch(url)
			if (!res.ok) throw new Error(`download failed (HTTP ${res.status})`)
			const image = decodeVtf(await res.arrayBuffer(), MAX_DIMENSION)
			const png = encodePng(image.width, image.height, image.rgba)
			return {
				uri: `data:image/png;base64,${toBase64(png)}`,
				width: image.width,
				height: image.height,
			}
		})()
		cache.set(url, entry)
		// Do not keep failed downloads in the cache, so a later render can try again.
		entry.catch(() => cache.delete(url))
	}
	return entry
}

// Shows one VTF file. It has its own state, so the rest of the message is not affected.
function VtfImage({ url, filename }: { url: string; filename: string }) {
	const { Image, Text } = revenge.react.ReactNative
	const [state, setState] = React.useState<{ loaded?: Loaded; error?: string }>({})

	React.useEffect(() => {
		let alive = true
		loadVtf(url).then(
			loaded => {
				if (alive) setState({ loaded })
			},
			error => {
				console.log(TAG, 'could not show', filename, String(error?.message ?? error))
				if (alive) setState({ error: String(error?.message ?? error) })
			},
		)
		return () => {
			alive = false
		}
	}, [url])

	if (state.error) return React.createElement(Text, { style: { color: '#b5bac1' } }, `${filename}: ${state.error}`)
	if (!state.loaded) return React.createElement(Text, { style: { color: '#b5bac1' } }, `Loading ${filename}…`)

	const { loaded } = state
	return React.createElement(Image, {
		source: { uri: loaded.uri },
		resizeMode: 'contain',
		style: {
			width: '100%',
			aspectRatio: loaded.width / loaded.height,
			marginTop: 4,
			borderRadius: 4,
		},
	})
}

// Finds .vtf attachments anywhere in the arguments. Depth is limited, so the walk stays small.
function collectVtf(node: any, out: VtfRef[], depth: number, seen: Set<any>) {
	if (node === null || typeof node !== 'object' || depth > 4 || seen.has(node)) return
	seen.add(node)

	if (Array.isArray(node)) {
		for (const item of node) collectVtf(item, out, depth + 1, seen)
		return
	}

	const filename = node.filename ?? node.file_name
	const url = node.url ?? node.proxy_url
	if (typeof filename === 'string' && typeof url === 'string' && filename.toLowerCase().endsWith('.vtf')) {
		out.push({ filename, url })
		return
	}

	for (const key of Object.keys(node)) {
		if (key.startsWith('_')) continue // skip React internals like _owner
		collectVtf(node[key], out, depth + 1, seen)
	}
}

// Short description of a value's keys, for debugging. Shows names only, never big values.
function shape(node: any, depth = 0): string {
	if (node === null) return 'null'
	if (Array.isArray(node)) {
		if (depth > 3) return `[${node.length}]`
		return `[${node.slice(0, 3).map(n => shape(n, depth + 1)).join(', ')}]`
	}
	if (typeof node !== 'object') return typeof node
	if (depth > 3) return '{...}'
	const keys = Object.keys(node).filter(k => !k.startsWith('_')).slice(0, 15)
	return `{${keys.map(k => `${k}:${shape(node[k], depth + 1)}`).join(', ')}}`
}

let debugLogs = 0

function addVtfImages(result: any, args: any[]): any {
	const found: VtfRef[] = []
	collectVtf(args, found, 0, new Set())
	if (debugLogs < 3) {
		debugLogs++
		console.log(TAG, 'render args:', shape(args))
		console.log(TAG, 'vtf attachments found:', found.length)
	}
	if (found.length === 0) return result

	const images = found.map((ref, i) =>
		React.createElement(VtfImage, {
			key: `vtf-${i}-${ref.url}`,
			url: ref.url,
			filename: ref.filename,
		}),
	)
	return React.createElement(React.Fragment, null, result, ...images)
}

export default plugin({
	start({ cleanup }) {
		const unpatches: Array<() => void> = []
		let patched = false

		// The finder is a global of the Revenge runtime, not part of @revenge-mod/*.
		let stopSearch: (() => void) | undefined
		try {
			stopSearch = revenge.discord.utils.modules.finders.getModuleWithImportedPath(
				RENDERER_PATH,
				(ns: any) => {
					if (patched) return
					if (typeof ns?.default !== 'function') {
						console.log(TAG, 'renderer module has no default function')
						return
					}
					patched = true
					unpatches.push(
						instead(ns, 'default', (args: any[], original: any) => {
							const result = original(...args)
							try {
								return addVtfImages(result, args)
							} catch (error) {
								console.log(TAG, 'could not add images:', error)
								return result
							}
						}),
					)
					console.log(TAG, 'patched message renderer')
				},
			)
		} catch (error) {
			console.log(TAG, 'could not search for the renderer:', error)
		}

		cleanup(() => {
			stopSearch?.()
			for (const undo of unpatches) undo()
			cache.clear()
		})
	},
})
