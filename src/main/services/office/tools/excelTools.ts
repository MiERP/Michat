import type { OfficeToolDefinition } from './wordTools'

export const ExcelToolNames = {
  GET_SELECTED_RANGE: 'excel_get_selected_range',
  WRITE_SELECTED_RANGE: 'excel_write_selected_range'
} as const

export const EXCEL_TOOLS: OfficeToolDefinition[] = [
  {
    name: ExcelToolNames.GET_SELECTED_RANGE,
    host: 'excel',
    label: 'Get selected range',
    description: 'Read the selected Excel range with address and values.',
    mode: 'read'
  },
  {
    name: ExcelToolNames.WRITE_SELECTED_RANGE,
    host: 'excel',
    label: 'Write selected range',
    description: 'Write tabular values to the selected range after user confirmation.',
    mode: 'write'
  }
]

export interface ExcelToolRequest {
  tool: string
  args?: Record<string, unknown>
}
