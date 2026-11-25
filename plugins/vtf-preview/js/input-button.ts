// Adds a "Convert to VTF" button to the chat input bar, next to the gift button.
// The button is a copy of the gift button, so it keeps Discord's own look.
//
// The gift button is only in the tree when "show gift button" is on. If the gift button is hidden, no button is added.

import { Stores } from '@valenced/discord/flux'
import { getModules } from '@valenced/modules/finders'
import { createFilterGenerator } from '@valenced/modules/finders/filters'
import { after } from '@valenced/patcher'
import { cloneElement, isValidElement } from 'react'
import type { ReactElement, ReactNode } from 'react'
import { SEND_LABEL } from './constants'
import { notify } from './debug'
import { sendAsVtf } from './send'
import type { Attachment } from './types'

type Cleanup = (...fns: Array<() => unknown>) => unknown

const withChatInputRightActions = createFilterGenerator(
	([name], _, exports) => exports?.type?.length === 1 && exports.type.displayName === name,
	([name]) => `memoizedNamedExoticComponent(${name})`,
) as (name: string) => unknown

/** Whether a node is Discord's gift button, found by its label. */
function isGiftButton(node: unknown): node is ReactElement<Record<string, unknown>> {
	if (!isValidElement(node)) return false
	const props = node.props as Record<string, unknown>
	const label = [props.accessibilityLabel, props.label, props.testID].find(v => typeof v === 'string') as
		| string
		| undefined
	return !!label && /gift/i.test(label)
}

/**
 * Walks the tree and puts our button right after the gift button.
 * Returns null if the gift button is not in this part of the tree.
 */
function insertAfterGift(
	node: ReactElement<Record<string, unknown>>,
	makeButton: (gift: ReactElement<Record<string, unknown>>) => ReactElement,
	depth = 0,
): ReactElement | null {
	if (depth > 25) return null
	const children = node.props.children as ReactNode

	if (Array.isArray(children)) {
		const giftIndex = children.findIndex(isGiftButton)
		if (giftIndex !== -1) {
			const gift = children[giftIndex] as ReactElement<Record<string, unknown>>
			const next = [...children.slice(0, giftIndex + 1), makeButton(gift), ...children.slice(giftIndex + 1)]
			return cloneElement(node, { children: next } as never)
		}
		for (let i = 0; i < children.length; i++) {
			const child = children[i]
			if (!isValidElement(child)) continue
			const inner = insertAfterGift(child as ReactElement<Record<string, unknown>>, makeButton, depth + 1)
			if (inner) {
				const next = [...children]
				next[i] = inner
				return cloneElement(node, { children: next } as never)
			}
		}
		return null
	}

	if (isValidElement(children) && !isGiftButton(children)) {
		const inner = insertAfterGift(children as ReactElement<Record<string, unknown>>, makeButton, depth + 1)
		return inner ? cloneElement(node, { children: inner } as never) : null
	}
	return null
}

/**
 * The pictures waiting in the chat input, not yet sent.
 * Discord keeps them in its upload store. The store name is not confirmed yet, so this logs what it finds.
 */
function pendingImages(channelId: string): Attachment[] {
	const found = Object.entries(Stores as Record<string, unknown>)
		.filter(([name, store]) => /upload/i.test(name) && store && typeof store === 'object')
		.map(([name, store]) => `${name}: ${Object.keys(store as object).slice(0, 12).join(',')}`)
	notify(found.length ? `upload stores: ${found.join(' | ')}` : 'no upload store found')
	void channelId
	return []
}

async function convertPendingToVtf(): Promise<void> {
	const channelId = (Stores as unknown as { SelectedChannelStore?: { getChannelId?(): string } })
		.SelectedChannelStore?.getChannelId?.()
	if (!channelId) {
		notify('no channel selected')
		return
	}

	const images = pendingImages(channelId)
	if (images.length === 0) {
		notify('no pending picture found')
		return
	}

	try {
		await sendAsVtf(channelId, images)
	} catch (error) {
		notify(`convert failed: ${String((error as Error)?.message ?? error)}`)
	}
}

/** The 'no gift button' toast is shown once, because the chat input redraws often. */
let warnedNoGift = false

/** Patches the chat input so the gift button's row also gets the "Convert to VTF" button. */
export function installInputButton(cleanup: Cleanup): void {
	cleanup(
		getModules(withChatInputRightActions('ChatInputRightActions') as never, (ChatInputRightActions: any) => {
			cleanup(
				after(ChatInputRightActions, 'type', (tree: unknown) => {
					try {
						if (!isValidElement(tree)) return tree
						const withButton = insertAfterGift(
							tree as ReactElement<Record<string, unknown>>,
							gift =>
								cloneElement(gift, {
									key: 'vtf-viewer-convert',
									accessibilityLabel: SEND_LABEL,
									onPress: () => {
										convertPendingToVtf()
									},
								} as never),
						)
						if (!withButton && !warnedNoGift) {
							warnedNoGift = true
							notify('gift button not found, no VTF button')
						}
						return withButton ?? tree
					} catch (error) {
						notify(`input button failed: ${String(error)}`)
						return tree
					}
				}),
			)
		}),
	)
}
