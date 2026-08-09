import { apiFetch } from '@/lib/api'
import type { Item, ItemInput, ItemListResponse } from '@shared/items'

export interface ListParams {
  includeArchived?: boolean
  category?: string
  search?: string
}

export function fetchItems(params: ListParams = {}): Promise<ItemListResponse> {
  const query = new URLSearchParams()
  if (params.includeArchived) query.set('archived', 'true')
  if (params.category) query.set('category', params.category)
  if (params.search) query.set('search', params.search)
  const suffix = query.toString()
  return apiFetch<ItemListResponse>(`/api/items${suffix ? `?${suffix}` : ''}`)
}

export function createItem(input: ItemInput): Promise<Item> {
  return apiFetch<Item>('/api/items', { method: 'POST', body: JSON.stringify(input) })
}

export function updateItem(id: string, input: ItemInput): Promise<Item> {
  return apiFetch<Item>(`/api/items/${id}`, { method: 'PUT', body: JSON.stringify(input) })
}

export function archiveItem(id: string): Promise<Item> {
  return apiFetch<Item>(`/api/items/${id}/archive`, { method: 'POST' })
}

export function restoreItem(id: string): Promise<Item> {
  return apiFetch<Item>(`/api/items/${id}/restore`, { method: 'POST' })
}

/** One glyph per category — the only decoration on a row (product doc 02 §10). */
export const CATEGORY_EMOJI: Record<string, string> = {
  'Tops & Outerwear': '🧥',
  'Bottoms & Swimwear': '👖',
  Footwear: '👟',
  'Accessories & Undergarments': '🧦',
  Toiletries: '🧴',
  Electronics: '🔌',
  Medication: '💊',
  Documents: '📄',
  'Travel Gear': '🎒',
  Vision: '👓',
  Grooming: '🪒',
  'Medication Storage': '💊',
}

/**
 * The one-line subtitle under an item name.
 *
 * Doc 06 §3 rules out "multiple badges on every row", so this is a single quiet
 * line and it is omitted entirely when there is nothing worth saying.
 */
export function itemSubtitle(item: Item): string {
  const parts: string[] = []
  if (item.brand) parts.push(item.brand)
  if (item.color) parts.push(item.color)
  if (item.usageFrequency === 'frequent') parts.push('Frequently used')
  else if (item.usageFrequency === 'rare') parts.push('Rarely used')
  if (item.archivedAt) parts.push('Archived')
  return parts.join(' · ')
}
