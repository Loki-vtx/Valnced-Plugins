import { ScrollView } from 'react-native'
import { lookupModule } from '@valenced/modules/finders'
import { withProps } from '@valenced/modules/finders/filters'
import type { PluginApi, PluginSettingsComponent } from '@valenced/plugins/types'

export const defaults = {
	targetUserId: '',
	imageUrl: '',
}

export type Settings = typeof defaults
type ApiOptions = { jsonStorage: Settings }

export const SettingsComponent: PluginSettingsComponent<ApiOptions> = ({ api }: { api: PluginApi<ApiOptions> }) => {
    
	const current = (api.jsonStorage.use() ?? {}) as Partial<Settings>

	const [ui] = lookupModule(withProps('TableRowGroup', 'TextInput', 'Stack')) ?? []
	if (!ui) return <ScrollView />
	const { TableRowGroup, TextInput, Stack } = ui

	const save = (patch: Partial<Settings>) => void api.jsonStorage.set(patch)

	return (
		<ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 10 }}>
			<Stack spacing={8}>
				<TableRowGroup title="User ID">
					<Stack spacing={4}>
						<TextInput
							placeholder="Enter Target User ID"
							value={current.targetUserId ?? ''}
							onChange={(v: string) => save({ targetUserId: v })}
							isClearable
							returnKeyType="done"
						/>
					</Stack>
				</TableRowGroup>
				<TableRowGroup title="Image URL">
					<Stack spacing={4}>
						<TextInput
							placeholder="Enter image URL"
							value={current.imageUrl ?? ''}
							onChange={(v: string) => save({ imageUrl: v })}
							isClearable
							returnKeyType="done"
						/>
					</Stack>
				</TableRowGroup>
			</Stack>
		</ScrollView>
	)
}