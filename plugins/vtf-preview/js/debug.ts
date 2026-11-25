// Shows plugin messages as Discord toasts, so they can be read on the phone without logcat.
import { ToastActionCreators } from '@valenced/discord/actions'
import { TAG } from './constants'

let counter = 0

/** Logs a message and shows it as a toast. Toasts are short, so long text is cut. */
export function notify(text: string): void {
	console.log(TAG, text)
	try {
		counter++
		ToastActionCreators.open({
			key: `vtf-viewer-${counter}`,
			content: `${TAG} ${text.slice(0, 200)}`,
		} as never)
	} catch (error) {
		console.warn(TAG, 'toast failed:', String((error as Error)?.message ?? error))
	}
}
