import { ActionSheetActionCreators } from '@valenced/discord/actions'
import { Stores } from '@valenced/discord/flux'
import { lookupModule } from '@valenced/modules/finders'
import { withProps } from '@valenced/modules/finders/filters'
import { after } from '@valenced/patcher'
import { cloneElement, createElement } from 'react'
import type { ReactElement } from 'react'
import { isImageAttachment } from './attachments'
import { MENU_COPY_LABELS, SEND_LABEL, TAG, TARGET_MAX_AGE_MS } from './constants'
import { sendAsVtf } from './send'
import type { Attachment, MessageStore } from './types'

type Cleanup = (...fns: Array<() => unknown>) => unknown

/** The message the menu on screen is for, as last noticed. */
let target: { channelId: string; messageId: string; at: number } | null = null

type Row = ReactElement<Record<string, unknown>>

/** Notes which message a piece of the menu is about, from its props. */
function noteTarget(props: Record<string, unknown>): void {
	if (typeof props.messageId === 'string' && typeof props.channelId === 'string') {
		target = { channelId: props.channelId, messageId: props.messageId, at: Date.now() }
		return
	}
	const message = props.message as { id?: unknown; channel_id?: unknown } | undefined
	if (!message || typeof message.id !== 'string') return
	const channelId = [message.channel_id, props.channelId].find(id => typeof id === 'string') as string | undefined
	if (channelId) target = { channelId, messageId: message.id, at: Date.now() }
}

function isRow(value: unknown): value is Row {
	const props = (value as { props?: Record<string, unknown> } | null | undefined)?.props
	return !!props && typeof props.label === 'string'
}

/** The picture attachments of a message in the store, if any. */
function imagesOf(channelId: string, messageId: string): Attachment[] {
	const messages = Stores.MessageStore as unknown as MessageStore | undefined
	const message = messages?.getMessage?.(channelId, messageId)
	return (message?.attachments ?? []).filter(isImageAttachment)
}

/** Adds "Send as VTF" to the box of the message menu that holds the copy rows, for a message with pictures. */
function decorateRows(group: ReactElement<Record<string, unknown>>): ReactElement {
	const children = group.props.children
	const kept = Array.isArray(children) ? children.flat() : [children]
	const rows = kept.filter(isRow)
	if (rows.length < 2 || rows.some(row => row.props.label === SEND_LABEL)) return group

	const template = rows.find(row => MENU_COPY_LABELS.includes(row.props.label as string))
	if (!template) return group
	if (!target || Date.now() - target.at > TARGET_MAX_AGE_MS) return group

	const current = { ...target }
	if (imagesOf(current.channelId, current.messageId).length === 0) return group

	let lastPress = 0
	// The new row copies the copy row it sits beside, so it keeps Discord's own look and icon.
	const row = createElement(template.type as never, {
		...template.props,
		key: 'vtf-viewer-send',
		label: SEND_LABEL,
		subLabel: undefined,
		onPress: () => {
			// One tap can reach more than one handler, so only the first one counts.
			if (Date.now() - lastPress < 1500) return
			lastPress = Date.now()
			try {
				ActionSheetActionCreators.hideAllActionSheets()
			} catch {
				// No sheet was open.
			}
			const images = imagesOf(current.channelId, current.messageId)
			sendAsVtf(current.channelId, images).catch(error =>
				console.warn(TAG, 'send as VTF failed:', String(error?.message ?? error)),
			)
		},
	})
	return cloneElement(group, {} as never, [...kept, row] as never)
}

function onNewElement(drawn: unknown): unknown {
	try {
		const element = drawn as ReactElement<Record<string, unknown>> | null | undefined
		const props = element?.props
		if (!element || !props) return drawn
		noteTarget(props)
		if (props.children && typeof props.children === 'object') return decorateRows(element)
		return drawn
	} catch {
		return drawn
	}
}

/** Patches the JSX runtime so every element Discord creates passes through `onNewElement`. */
export function installSendMenu(cleanup: Cleanup): void {
	const runtime =
		(lookupModule(withProps('jsx', 'jsxs'))[0] as Record<string, unknown> | undefined) ||
		(valenced.react.ReactJSXRuntime as unknown as Record<string, unknown>)
	for (const name of ['jsx', 'jsxs']) {
		if (runtime && typeof runtime[name] === 'function')
			cleanup(after(runtime as Record<string, (...args: unknown[]) => unknown>, name, onNewElement as never))
	}
	cleanup(() => {
		target = null
	})
}
