/** A file attached to a message. */
export interface Attachment {
	id: string
	filename: string
	url: string
	proxy_url?: string
	content_type?: string
	width?: number
	height?: number
	size?: number
	[field: string]: unknown
}

/** A message, as it arrives in Flux events and as it is kept in the message store. */
export interface DiscordMessage {
	id?: string
	channel_id?: string
	attachments?: Attachment[]
	/** Forwarded messages: the original message is inside a snapshot. */
	message_snapshots?: Array<{ message?: DiscordMessage } | undefined>
}

/** The part of Discord's MessageStore this plugin uses. */
export interface MessageStore {
	getMessage?(channelId: string, messageId: string): DiscordMessage | undefined
}

/** A VTF that was converted to a PNG on the phone. */
export interface ConvertedImage {
	/** file:// link of the PNG in the cache folder. */
	uri: string
	width: number
	height: number
	size: number
}
