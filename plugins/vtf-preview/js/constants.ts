/** Prefix for this plugin's console messages. */
export const TAG = '[vtf-viewer]'

/** File names this plugin treats as VTF textures, in any letter case. */
export const VTF_FILE_PATTERN = /\.vtf$/i

/** Folder inside Discord's cache directory where the converted images are written. */
export const CACHE_DIR = 'vtf-viewer'

/** Largest side (in pixels) of the converted image. */
export const MAX_DIMENSION = 1024

/** Most conversions running at the same time. */
export const MAX_CONCURRENT = 2

/** Flux events that carry one message in `payload.message`. */
export const SINGLE_MESSAGE_EVENTS = ['MESSAGE_CREATE', 'MESSAGE_UPDATE'] as const

/** Flux events that carry a list of messages in `payload.messages`. */
export const MESSAGE_LIST_EVENTS = [
	'LOAD_MESSAGES_SUCCESS',
	'LOAD_MESSAGES_AROUND_SUCCESS',
	'LOAD_PINNED_MESSAGES_SUCCESS',
	'LOAD_RECENT_MENTIONS_SUCCESS',
] as const

/** Largest side of a picture sent as VTF. Smaller keeps the upload under Discord's size limit. */
export const SEND_MAX_DIMENSION = 512

/** Accessibility label of the input bar button that converts the pending pictures to VTF. */
export const SEND_LABEL = 'Convert to VTF'

/** How long after the menu is drawn its message can still be used, in milliseconds. */
export const TARGET_MAX_AGE_MS = 5000
