import type { FileTableManager } from './fTable'

/**
 * NPC model ID range boundaries.
 * Each range maps to a different file table offset,
 * corresponding to different FFXI expansion eras.
 */
export const NpcModelRanges = {
  /** Base game through Treasures of Aht Urhgan (model IDs 0-1499) */
  base: { min: 0x000, max: 0x5DB, offset: 0x514, label: 'Base / CoP / ToAU' },
  /** Wings of the Goddess through Seekers of Adoulin+ (model IDs 1500-2999) */
  wotg: { min: 0x5DC, max: 0xBB7, offset: 0xC477, label: 'WotG / SoA+' },
  /** Trust (Alter Ego) models (model IDs 3000-3192) */
  trust: { min: 0xBB8, max: 0xC78, offset: 0x17A8B, label: 'Trusts' },
  /** Newest models -- speculated range (model IDs 3193+) */
  newest: { min: 0xC79, max: 0xFFF, offset: 0x180F2, label: 'Newest' },
} as const

/**
 * Converts an NPC model ID to a file table index.
 * The file table index can then be resolved to a ROM file path
 * via FileTableManager.getFilePath().
 *
 * Port of Kotlin NpcTable.getNpcModelIndex().
 */
export function getNpcModelIndex(modelId: number): number {
  if (modelId < 0x5DC) { return 0x514 + modelId }
  if (modelId < 0xBB8) { return 0xC477 + modelId }
  if (modelId < 0xC79) { return 0x17A8B + modelId }
  return 0x180F2 + modelId
}

/**
 * Resolves an NPC model ID to a DAT file path.
 * Returns null if the model does not exist in the file table.
 */
export function getNpcModelPath(
  modelId: number,
  fileTableManager: FileTableManager,
): string | null {
  const fileTableIndex = getNpcModelIndex(modelId)
  return fileTableManager.getFilePath(fileTableIndex)
}

/**
 * Ship model lookup. Ship "name IDs" (0x00 through 0x15) map
 * to file table index 0x791C + nameId.
 */
export function getShipModelIndex(nameId: number): number {
  return 0x791C + nameId
}

/** Additional animation file table indices for specific NPC models. */
export function getAdditionalAnimationIndex(modelId: number): number | null {
  if (modelId === 0x974) {
    return 0x113AF // Waypoints
  }
  return null
}
