<template>
  <main class="browser-shell">
    <section class="browser-panel">
      <header class="browser-header">
        <p class="eyebrow">Silo Runtime</p>
        <h1>Browser</h1>
        <p>
          Browse and preview NPC models, monsters, objects, and zone
          environments from FFXI DAT files.
        </p>
      </header>

      <!-- Mode Toggle -->
      <div class="mode-toggle">
        <button
          class="mode-btn"
          :class="{ active: browseMode === 'models' }"
          @click="switchMode('models')"
        >
          Models
        </button>
        <button
          class="mode-btn"
          :class="{ active: browseMode === 'zones' }"
          @click="switchMode('zones')"
        >
          Zones
        </button>
      </div>

      <!-- ═══════════ MODEL MODE ═══════════ -->
      <template v-if="browseMode === 'models'">
        <!-- Browse Controls -->
        <details class="panel-section" open>
          <summary class="section-heading">Browse</summary>
          <div class="section-grid">
            <div>
              <label class="label" for="range-select">Range</label>
              <select
                id="range-select"
                v-model="selectedRange"
                :disabled="!isReady"
              >
                <option
                  v-for="range in rangeOptions"
                  :key="range.key"
                  :value="range.key"
                >
                  {{ range.label }} ({{ range.min }}-{{ range.max }})
                </option>
              </select>
            </div>

            <div>
              <label class="label" for="model-id-input">Model ID</label>
              <div class="id-input-row">
                <input
                  id="model-id-input"
                  v-model="modelIdInput"
                  type="text"
                  class="model-id-input"
                  placeholder="e.g. 0x5DC or 1500"
                  :disabled="!isReady"
                  @keydown.enter="goToModelId"
                />
                <button
                  class="go-btn"
                  :disabled="!isReady"
                  @click="goToModelId"
                >
                  Go
                </button>
              </div>
            </div>

            <div class="nav-row">
              <button :disabled="!canGoPrev" @click="prevModel">&lt; Prev</button>
              <span class="nav-label">
                {{ currentModelId !== null ? formatModelId(currentModelId) : '--' }}
              </span>
              <button :disabled="!canGoNext" @click="nextModel">Next &gt;</button>
            </div>
          </div>
        </details>

        <!-- Model Search -->
        <div class="panel-section-flat">
          <label class="label" for="model-search">Filter</label>
          <input
            id="model-search"
            v-model="modelSearch"
            type="text"
            class="model-id-input"
            placeholder="Filter by hex ID or path..."
            :disabled="!isReady"
          />
        </div>

        <!-- Type Classification -->
        <div class="panel-section-flat">
          <div class="classify-row">
            <div class="classify-filter">
              <label class="label" for="type-filter">Type</label>
              <select
                id="type-filter"
                v-model="selectedTypeFilter"
                :disabled="!isReady"
              >
                <option
                  v-for="opt in typeFilterOptions"
                  :key="opt.key"
                  :value="opt.key"
                >
                  {{ opt.label }}
                </option>
              </select>
            </div>
            <div class="classify-action">
              <label class="label">&nbsp;</label>
              <button
                v-if="!isClassifying"
                class="classify-btn"
                :disabled="!isReady || classifiedCount >= allModels.length"
                @click="startClassification"
              >
                {{ classifiedCount > 0 ? 'Resume' : 'Classify' }}
              </button>
              <button
                v-else
                class="classify-btn cancel"
                @click="cancelClassification"
              >
                Cancel
              </button>
            </div>
          </div>
          <div v-if="isClassifying || classifiedCount > 0" class="classify-progress">
            <div class="progress-bar">
              <div
                class="progress-fill"
                :style="{ width: `${Math.round((classifiedCount / allModels.length) * 100)}%` }"
              />
            </div>
            <span class="progress-label">
              {{ classifiedCount }} / {{ allModels.length }}
              <template v-if="isClassifying"> ({{ classifyPercent }}%)</template>
            </span>
          </div>
        </div>

        <!-- Model List -->
        <details class="panel-section" open>
          <summary class="section-heading">
            Models
            <span v-if="filteredModels.length > 0" class="count-badge">
              {{ filteredModels.length }}
            </span>
          </summary>
          <div class="section-grid">
            <div v-if="isScanning" class="info-placeholder">Scanning file table...</div>
            <div v-else-if="filteredModels.length === 0" class="info-placeholder">No models match filter.</div>
            <div v-else class="model-list" data-list="model-list">
              <div
                v-for="m in paginatedModels"
                :key="m.id"
                class="model-list-item"
                :class="{ active: m.id === currentModelId }"
                @click="loadModelById(m.id)"
              >
                <span class="model-id-row">
                  <span class="model-id">{{ formatModelId(m.id) }}</span>
                  <span
                    v-if="modelCategories.has(m.id)"
                    class="type-badge"
                    :class="`type-${modelCategories.get(m.id)}`"
                  >
                    {{ modelCategories.get(m.id) }}
                  </span>
                </span>
                <span class="model-path">{{ m.path }}</span>
              </div>
            </div>
            <div v-if="totalPages > 1" class="pagination">
              <button :disabled="currentPage <= 0" @click="currentPage--">&lt;</button>
              <span>{{ currentPage + 1 }} / {{ totalPages }}</span>
              <button :disabled="currentPage >= totalPages - 1" @click="currentPage++">></button>
            </div>
          </div>
        </details>

        <!-- Model Info -->
        <details class="panel-section" open>
          <summary class="section-heading">Model Info</summary>
          <div class="section-grid">
            <template v-if="modelViewer.modelInfo.value">
              <div class="info-row">
                <span class="info-key">ID</span>
                <code class="info-val">{{ currentModelId !== null ? formatModelId(currentModelId) : '--' }}</code>
              </div>
              <div class="info-row">
                <span class="info-key">Path</span>
                <code class="info-val">{{ currentModelPath ?? '--' }}</code>
              </div>
              <div class="info-row">
                <span class="info-key">Joints</span>
                <code class="info-val">{{ modelViewer.modelInfo.value.jointCount }}</code>
              </div>
              <div class="info-row">
                <span class="info-key">Meshes</span>
                <code class="info-val">{{ modelViewer.modelInfo.value.meshCount }}</code>
              </div>
              <div class="info-row">
                <span class="info-key">Scale</span>
                <code class="info-val">{{ modelViewer.modelInfo.value.scale.toFixed(2) }}</code>
              </div>
              <div v-if="currentModelId !== null && modelCategories.has(currentModelId)" class="info-row">
                <span class="info-key">Type</span>
                <code class="info-val">
                  <span
                    class="type-badge"
                    :class="`type-${modelCategories.get(currentModelId)}`"
                  >{{ modelCategories.get(currentModelId) }}</span>
                </code>
              </div>
            </template>
            <p v-else class="info-placeholder">Select a model to view its details.</p>
          </div>
        </details>

        <!-- Animations -->
        <details class="panel-section" open>
          <summary class="section-heading">
            Animations
            <span v-if="modelViewer.animations.value.length > 0" class="count-badge">
              {{ modelViewer.animations.value.length }}
            </span>
          </summary>
          <div class="section-grid">
            <div v-if="modelViewer.animations.value.length > 0" class="anim-grid">
              <button
                v-for="anim in modelViewer.animations.value"
                :key="anim"
                class="anim-btn"
                :class="{ active: anim === modelViewer.currentAnimation.value }"
                @click="modelViewer.playAnimation(anim)"
              >
                {{ anim }}
              </button>
            </div>
            <p v-else class="info-placeholder">No model loaded.</p>
          </div>
        </details>
      </template>

      <!-- ═══════════ ZONE MODE ═══════════ -->
      <template v-if="browseMode === 'zones'">
        <!-- Zone Browse -->
        <details class="panel-section" open>
          <summary class="section-heading">Browse</summary>
          <div class="section-grid">
            <div>
              <label class="label" for="zone-search">Filter</label>
              <input
                id="zone-search"
                v-model="zoneSearch"
                type="text"
                class="model-id-input"
                placeholder="Filter by name or ID..."
                :disabled="!isReady"
              />
            </div>
            <div class="nav-row">
              <button :disabled="!canGoPrevZone" @click="prevZone">&lt; Prev</button>
              <span class="nav-label">
                {{ currentZoneId !== null ? `${currentZoneId}` : '--' }}
              </span>
              <button :disabled="!canGoNextZone" @click="nextZone">Next &gt;</button>
            </div>
          </div>
        </details>

        <!-- Zone List -->
        <details class="panel-section" open>
          <summary class="section-heading">
            Zones
            <span v-if="filteredZones.length > 0" class="count-badge">
              {{ filteredZones.length }}
            </span>
          </summary>
          <div class="section-grid">
            <div v-if="!isReady" class="info-placeholder">Initializing...</div>
            <div v-else-if="filteredZones.length === 0" class="info-placeholder">No zones match filter.</div>
            <div v-else class="model-list" data-list="zone-list">
              <div
                v-for="zone in paginatedZones"
                :key="zone.id"
                class="model-list-item"
                :class="{ active: zone.id === currentZoneId }"
                @click="loadZoneById(zone.id)"
              >
                <span class="model-id">{{ zone.id }}</span>
                <span class="model-path">{{ zone.name }}</span>
              </div>
            </div>
            <div v-if="zoneTotalPages > 1" class="pagination">
              <button :disabled="zoneCurrentPage <= 0" @click="zoneCurrentPage--">&lt;</button>
              <span>{{ zoneCurrentPage + 1 }} / {{ zoneTotalPages }}</span>
              <button :disabled="zoneCurrentPage >= zoneTotalPages - 1" @click="zoneCurrentPage++">></button>
            </div>
          </div>
        </details>

        <!-- Zone Info -->
        <details class="panel-section" open>
          <summary class="section-heading">Zone Info</summary>
          <div class="section-grid">
            <template v-if="zoneViewer.zoneInfo.value">
              <div class="info-row">
                <span class="info-key">ID</span>
                <code class="info-val">{{ currentZoneId ?? '--' }}</code>
              </div>
              <div class="info-row">
                <span class="info-key">Name</span>
                <code class="info-val">{{ currentZoneName ?? '--' }}</code>
              </div>
              <div class="info-row">
                <span class="info-key">Path</span>
                <code class="info-val">{{ currentZonePath ?? '--' }}</code>
              </div>
              <div class="info-row">
                <span class="info-key">Objects</span>
                <code class="info-val">{{ zoneViewer.zoneInfo.value.objectCount }}</code>
              </div>
              <div class="info-row">
                <span class="info-key">Meshes</span>
                <code class="info-val">{{ zoneViewer.zoneInfo.value.meshCount }}</code>
              </div>
              <div class="info-row">
                <span class="info-key">Collision</span>
                <code class="info-val">{{ zoneViewer.zoneInfo.value.hasCollision ? 'Yes' : 'No' }}</code>
              </div>
              <div class="info-row">
                <span class="info-key">Env IDs</span>
                <code class="info-val">{{ zoneViewer.zoneInfo.value.environmentIds.join(', ') || 'None' }}</code>
              </div>
            </template>
            <p v-else class="info-placeholder">Select a zone to view its details.</p>
          </div>
        </details>

        <!-- Time of Day -->
        <details class="panel-section" open>
          <summary class="section-heading">Time of Day</summary>
          <div class="section-grid">
            <div class="time-control">
              <input
                type="range"
                class="time-slider"
                min="0"
                max="1439"
                step="1"
                :value="zoneViewer.timeOfDay.value"
                :disabled="!zoneViewer.zoneInfo.value"
                @input="onTimeSliderInput"
              />
              <span class="time-label">{{ formatTime(zoneViewer.timeOfDay.value) }}</span>
            </div>
            <div class="time-presets">
              <button
                v-for="preset in timePresets"
                :key="preset.minutes"
                class="anim-btn"
                :class="{ active: zoneViewer.timeOfDay.value === preset.minutes }"
                :disabled="!zoneViewer.zoneInfo.value"
                @click="zoneViewer.setTimeOfDay(preset.minutes)"
              >
                {{ preset.label }}
              </button>
            </div>
          </div>
        </details>
      </template>

      <!-- Status (shared) -->
      <div v-if="statusMessage" class="status-bar">
        <p v-if="activeError" class="error">{{ activeError }}</p>
        <p v-else-if="activeLoading" class="info-placeholder">Loading...</p>
        <p v-else-if="!isReady" class="info-placeholder">Initializing resource tables...</p>
      </div>
    </section>

    <section class="canvas-wrap">
      <canvas ref="canvasRef" />
      <div v-if="showCanvasPlaceholder" class="canvas-placeholder">
        <p>{{ canvasPlaceholderText }}</p>
      </div>
      <div v-if="activeLoading" class="canvas-placeholder">
        <div class="loading-spinner" />
        <p>Loading...</p>
      </div>
      <div class="canvas-overlay">
        <div class="orbit-readout">
          <span>Orbit {{ activeOrbitState.azimuth }}°</span>
          <span>Tilt {{ activeOrbitState.elevation }}°</span>
          <span>Zoom {{ activeOrbitState.distance }}</span>
        </div>
      </div>
    </section>
  </main>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { DatLoader } from '~/lib/loader/datLoader'
import { DatParser, InfoOnlySectionTypes } from '~/lib/resource/datParser'
import { MovementType, type DirectoryResource } from '~/lib/resource/datResource'
import { createResourceTableRuntime, type ResourceTableRuntime } from '~/lib/resource/table/runtime'
import { getNpcModelPath, NpcModelRanges } from '~/lib/resource/table/npcTable'
import { getZoneDatPath } from '~/lib/resource/table/zoneTables'
import { initZoneDecrypt } from '~/lib/resource/table/zoneDecrypt'
import { ZoneNameTable } from '~/lib/resource/table/zoneNameTable'
import { NpcModel } from '~/lib/runtime/npcModel'
import { useModelViewer } from '~/composables/useModelViewer'
import { useZoneViewer } from '~/composables/useZoneViewer'

const { public: { datBaseUrl, datAccessToken } } = useRuntimeConfig()
const datHeaders: HeadersInit | undefined = datAccessToken
  ? { Authorization: `Bearer ${datAccessToken}` }
  : undefined

// ─── Shared state ────────────────────────────────────────────────────────────

type BrowseMode = 'models' | 'zones'

const canvasRef = ref<HTMLCanvasElement | null>(null)
const isReady = ref(false)
const browseMode = ref<BrowseMode>('models')

let resourceTableRuntime: ResourceTableRuntime | null = null
let datLoader: DatLoader<DirectoryResource> | null = null
let zoneDatLoader: DatLoader<DirectoryResource> | null = null
let zoneNameTable: ZoneNameTable | null = null

// ─── Viewer composables ──────────────────────────────────────────────────────

const modelViewer = useModelViewer(canvasRef)
const zoneViewer = useZoneViewer(canvasRef)

// ─── Active viewer computed helpers ──────────────────────────────────────────

const activeError = computed(() => {
  return browseMode.value === 'models'
    ? modelViewer.error.value
    : zoneViewer.error.value
})

const activeLoading = computed(() => {
  return browseMode.value === 'models'
    ? modelViewer.isLoading.value
    : zoneViewer.isLoading.value
})

const activeOrbitState = computed(() => {
  return browseMode.value === 'models'
    ? modelViewer.orbitState
    : zoneViewer.orbitState
})

const statusMessage = computed(() => {
  return activeError.value || activeLoading.value || !isReady.value
})

const showCanvasPlaceholder = computed(() => {
  if (activeLoading.value) { return false }
  if (browseMode.value === 'models') {
    return !modelViewer.modelInfo.value
  }
  return !zoneViewer.zoneInfo.value
})

const canvasPlaceholderText = computed(() => {
  return browseMode.value === 'models'
    ? 'Select a model from the list to preview it.'
    : 'Select a zone from the list to preview it.'
})

// ─── Mode switching ──────────────────────────────────────────────────────────

function switchMode(mode: BrowseMode): void {
  if (browseMode.value === mode) { return }

  // Dispose the outgoing viewer to free the canvas
  if (browseMode.value === 'models') {
    modelViewer.dispose()
  } else {
    zoneViewer.dispose()
  }

  browseMode.value = mode
}

// ═══════════════════════════════════════════════════════════════════════════════
// MODEL MODE
// ═══════════════════════════════════════════════════════════════════════════════

const isScanning = ref(false)
const currentModelId = ref<number | null>(null)
const currentModelPath = ref<string | null>(null)
const modelIdInput = ref('')
const modelSearch = ref('')
const selectedRange = ref<string>('all')
const currentPage = ref(0)
const selectedTypeFilter = ref<string>('all')

const PAGE_SIZE = 50

type ModelCategory = 'prop' | 'npc' | 'flying' | 'unknown'

interface ModelEntry {
  readonly id: number
  readonly path: string
}

// ─── Model Classification ────────────────────────────────────────────────────

const modelCategories = ref<Map<number, ModelCategory>>(new Map())
const isClassifying = ref(false)
const classifyProgress = ref(0)
const classifyTotal = ref(0)
let classifyAbort: AbortController | null = null
let classifyLoader: DatLoader<DirectoryResource> | null = null

const CLASSIFY_STORAGE_PREFIX = 'silo-model-types-'

function categoryFromMovementType(mt: MovementType): ModelCategory {
  switch (mt) {
    case MovementType.Walking:
    case MovementType.Sliding:
    case MovementType.Large:
      return 'npc'
    case MovementType.Flying:
      return 'flying'
    case MovementType.Unset:
      return 'prop'
    default:
      return 'unknown'
  }
}

function loadCachedCategories(rangeKey: string): Map<number, ModelCategory> {
  try {
    const raw = localStorage.getItem(CLASSIFY_STORAGE_PREFIX + rangeKey)
    if (!raw) { return new Map() }
    const entries: [number, ModelCategory][] = JSON.parse(raw)
    return new Map(entries)
  } catch {
    return new Map()
  }
}

function saveCachedCategories(rangeKey: string, map: Map<number, ModelCategory>): void {
  try {
    const entries = Array.from(map.entries())
    localStorage.setItem(CLASSIFY_STORAGE_PREFIX + rangeKey, JSON.stringify(entries))
  } catch { /* localStorage may be full or unavailable */ }
}

function classifyModel(root: DirectoryResource): ModelCategory {
  const model = new NpcModel(root)
  const info = model.getMovementInfo()
  if (!info) { return 'unknown' }
  return categoryFromMovementType(info.movementType)
}

async function startClassification(): Promise<void> {
  if (!resourceTableRuntime || isClassifying.value) { return }

  // Create a dedicated lightweight loader if needed
  if (!classifyLoader) {
    classifyLoader = new DatLoader<DirectoryResource>({
      baseUrl: datBaseUrl,
      headers: datHeaders,
      concurrency: 8,
      parseDat: (name, bytes) => DatParser.parse(name, bytes, { onlySectionTypes: InfoOnlySectionTypes }),
    })
  }

  const rangeKey = selectedRange.value
  const entries = allModels.value
  const existing = modelCategories.value

  // Only classify entries we haven't classified yet
  const toClassify = entries.filter(e => !existing.has(e.id))
  if (toClassify.length === 0) { return }

  isClassifying.value = true
  classifyProgress.value = 0
  classifyTotal.value = toClassify.length

  classifyAbort = new AbortController()
  const signal = classifyAbort.signal

  const BATCH_SIZE = 12
  for (let i = 0; i < toClassify.length; i += BATCH_SIZE) {
    if (signal.aborted) { break }

    const batch = toClassify.slice(i, i + BATCH_SIZE)
    const results = await Promise.allSettled(
      batch.map(async (entry) => {
        if (signal.aborted) { throw new Error('aborted') }
        const root = await classifyLoader!.load(entry.path)
        return { id: entry.id, category: classifyModel(root) }
      }),
    )

    for (const result of results) {
      if (result.status === 'fulfilled') {
        existing.set(result.value.id, result.value.category)
      } else {
        // Failed to load — mark as unknown
        const entry = batch[results.indexOf(result)]
        if (entry) { existing.set(entry.id, 'unknown') }
      }
    }

    classifyProgress.value = Math.min(i + BATCH_SIZE, toClassify.length)

    // Trigger reactivity by replacing the map reference
    modelCategories.value = new Map(existing)
  }

  saveCachedCategories(rangeKey, existing)
  isClassifying.value = false
  classifyAbort = null
}

function cancelClassification(): void {
  classifyAbort?.abort()
  isClassifying.value = false
  classifyAbort = null
}

const classifyPercent = computed(() => {
  if (classifyTotal.value === 0) { return 0 }
  return Math.round((classifyProgress.value / classifyTotal.value) * 100)
})

const classifiedCount = computed(() => {
  return allModels.value.filter(m => modelCategories.value.has(m.id)).length
})

const typeFilterOptions = [
  { key: 'all', label: 'All' },
  { key: 'prop', label: 'Props / Objects' },
  { key: 'npc', label: 'NPCs / Monsters' },
  { key: 'flying', label: 'Flying' },
  { key: 'unknown', label: 'Unclassified' },
]

const rangeOptions = [
  { key: 'all', label: 'All', min: NpcModelRanges.base.min, max: NpcModelRanges.newest.max },
  { key: 'base', label: 'Base / CoP / ToAU', min: NpcModelRanges.base.min, max: NpcModelRanges.base.max },
  { key: 'wotg', label: 'WotG / SoA+', min: NpcModelRanges.wotg.min, max: NpcModelRanges.wotg.max },
  { key: 'trust', label: 'Trusts', min: NpcModelRanges.trust.min, max: NpcModelRanges.trust.max },
  { key: 'newest', label: 'Newest', min: NpcModelRanges.newest.min, max: NpcModelRanges.newest.max },
]

const activeRange = computed(() => {
  const opt = rangeOptions.find(r => r.key === selectedRange.value)
  return opt ?? rangeOptions[0]!
})

const allModels = ref<ModelEntry[]>([])

function scanRange(): void {
  if (!resourceTableRuntime) { return }
  isScanning.value = true

  // Cancel any in-flight classification from the previous range
  cancelClassification()

  const range = activeRange.value
  const entries: ModelEntry[] = []
  const ftm = resourceTableRuntime.fileTableManager

  for (let id = range.min; id <= range.max; id += 1) {
    const path = getNpcModelPath(id, ftm)
    if (path !== null) {
      entries.push({ id, path })
    }
  }

  allModels.value = entries
  currentPage.value = 0
  selectedTypeFilter.value = 'all'
  isScanning.value = false

  // Load cached classification data for this range
  modelCategories.value = loadCachedCategories(selectedRange.value)
}

const textFilteredModels = computed(() => {
  const q = modelSearch.value.trim().toLowerCase()
  if (!q) { return allModels.value }

  // Allow searching by hex ID (e.g. "5dc"), decimal ID, or path fragment
  return allModels.value.filter(m => {
    const hexId = m.id.toString(16).toLowerCase()
    const decId = m.id.toString(10)
    if (hexId.includes(q) || decId.includes(q)) { return true }
    return m.path.toLowerCase().includes(q)
  })
})

const filteredModels = computed(() => {
  const typeKey = selectedTypeFilter.value
  if (typeKey === 'all') { return textFilteredModels.value }

  const cats = modelCategories.value
  if (typeKey === 'unknown') {
    return textFilteredModels.value.filter(m => !cats.has(m.id))
  }
  return textFilteredModels.value.filter(m => cats.get(m.id) === typeKey)
})

// Reset page when search or type filter changes
watch([modelSearch, selectedTypeFilter], () => {
  currentPage.value = 0
})

const totalPages = computed(() => Math.ceil(filteredModels.value.length / PAGE_SIZE))
const paginatedModels = computed(() => {
  const start = currentPage.value * PAGE_SIZE
  return filteredModels.value.slice(start, start + PAGE_SIZE)
})

const currentIndexInFiltered = computed(() => {
  if (currentModelId.value === null) { return -1 }
  return filteredModels.value.findIndex(m => m.id === currentModelId.value)
})

const canGoPrev = computed(() => isReady.value && currentIndexInFiltered.value > 0)
const canGoNext = computed(() => isReady.value && currentIndexInFiltered.value < filteredModels.value.length - 1)

function prevModel(): void {
  const idx = currentIndexInFiltered.value
  if (idx > 0) {
    loadModelById(filteredModels.value[idx - 1]!.id)
  }
}

function nextModel(): void {
  const idx = currentIndexInFiltered.value
  if (idx < filteredModels.value.length - 1) {
    loadModelById(filteredModels.value[idx + 1]!.id)
  }
}

function goToModelId(): void {
  const input = modelIdInput.value.trim()
  if (!input) { return }

  let id: number
  if (input.startsWith('0x') || input.startsWith('0X')) {
    id = parseInt(input, 16)
  } else {
    id = parseInt(input, 10)
  }

  if (isNaN(id) || id < 0) { return }
  loadModelById(id)
}

function formatModelId(id: number): string {
  return `0x${id.toString(16).toUpperCase().padStart(3, '0')} (${id})`
}

async function loadModelById(modelId: number): Promise<void> {
  if (!resourceTableRuntime || !datLoader) { return }

  const entry = allModels.value.find(m => m.id === modelId)
  const path = entry?.path ?? getNpcModelPath(modelId, resourceTableRuntime.fileTableManager)
  if (!path) {
    modelViewer.error.value = `No DAT found for model ID ${formatModelId(modelId)}`
    return
  }

  currentModelId.value = modelId
  currentModelPath.value = path
  modelIdInput.value = `0x${modelId.toString(16).toUpperCase()}`

  // Ensure the active item is on the visible page
  const idx = filteredModels.value.findIndex(m => m.id === modelId)
  if (idx >= 0) {
    currentPage.value = Math.floor(idx / PAGE_SIZE)
  }

  // Auto-scroll to active item after DOM update
  await nextTick()
  scrollToActiveItem('model-list')

  try {
    modelViewer.isLoading.value = true
    modelViewer.error.value = null

    const root = await datLoader.load(path)
    const model = new NpcModel(root)
    modelViewer.loadModel(model)

    // Classify on view if not already classified
    if (!modelCategories.value.has(modelId)) {
      const category = classifyModel(root)
      const updated = new Map(modelCategories.value)
      updated.set(modelId, category)
      modelCategories.value = updated
      saveCachedCategories(selectedRange.value, updated)
    }
  } catch (err) {
    modelViewer.error.value = `Failed to load ${path}: ${err instanceof Error ? err.message : String(err)}`
    modelViewer.isLoading.value = false
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// ZONE MODE
// ═══════════════════════════════════════════════════════════════════════════════

const zoneSearch = ref('')
const currentZoneId = ref<number | null>(null)
const currentZoneName = ref<string | null>(null)
const currentZonePath = ref<string | null>(null)
const zoneCurrentPage = ref(0)

const ZONE_PAGE_SIZE = 80

interface ZoneEntry {
  readonly id: number
  readonly name: string
}

const allZones = ref<ZoneEntry[]>([])

function buildZoneList(): void {
  if (!zoneNameTable || !resourceTableRuntime) { return }

  const names = zoneNameTable.getAllZoneNames()
  const ftm = resourceTableRuntime.fileTableManager
  const entries: ZoneEntry[] = []

  for (let i = 0; i < names.length; i++) {
    const name = names[i]
    if (!name || name.trim() === '' || name === 'none') { continue }
    // Only include zones that have a valid DAT path
    const path = getZoneDatPath(i, ftm)
    if (path) {
      entries.push({ id: i, name: name.trim() })
    }
  }

  allZones.value = entries
}

const filteredZones = computed(() => {
  const q = zoneSearch.value.trim().toLowerCase()
  if (!q) { return allZones.value }

  // Allow searching by numeric ID or name
  const numericId = parseInt(q, 10)

  return allZones.value.filter(zone => {
    if (!isNaN(numericId) && zone.id === numericId) { return true }
    return zone.name.toLowerCase().includes(q)
  })
})

const zoneTotalPages = computed(() => Math.ceil(filteredZones.value.length / ZONE_PAGE_SIZE))
const paginatedZones = computed(() => {
  const start = zoneCurrentPage.value * ZONE_PAGE_SIZE
  return filteredZones.value.slice(start, start + ZONE_PAGE_SIZE)
})

// Reset page when search changes
watch(zoneSearch, () => {
  zoneCurrentPage.value = 0
})

// Zone navigation
const currentZoneIndexInFiltered = computed(() => {
  if (currentZoneId.value === null) { return -1 }
  return filteredZones.value.findIndex(z => z.id === currentZoneId.value)
})

const canGoPrevZone = computed(() => isReady.value && currentZoneIndexInFiltered.value > 0)
const canGoNextZone = computed(() => isReady.value && currentZoneIndexInFiltered.value < filteredZones.value.length - 1)

function prevZone(): void {
  const idx = currentZoneIndexInFiltered.value
  if (idx > 0) {
    loadZoneById(filteredZones.value[idx - 1]!.id)
  }
}

function nextZone(): void {
  const idx = currentZoneIndexInFiltered.value
  if (idx < filteredZones.value.length - 1) {
    loadZoneById(filteredZones.value[idx + 1]!.id)
  }
}

const timePresets = [
  { label: 'Dawn', minutes: 360 },
  { label: 'Morning', minutes: 480 },
  { label: 'Noon', minutes: 720 },
  { label: 'Dusk', minutes: 1080 },
  { label: 'Night', minutes: 1320 },
]

function formatTime(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`
}

function onTimeSliderInput(event: Event): void {
  const target = event.target as HTMLInputElement
  zoneViewer.setTimeOfDay(parseInt(target.value, 10))
}

async function loadZoneById(zoneId: number): Promise<void> {
  if (!resourceTableRuntime || !zoneDatLoader || !zoneNameTable) { return }

  const path = getZoneDatPath(zoneId, resourceTableRuntime.fileTableManager)
  if (!path) {
    zoneViewer.error.value = `No DAT found for zone ID ${zoneId}`
    return
  }

  currentZoneId.value = zoneId
  currentZoneName.value = zoneNameTable.getZoneName(zoneId)
  currentZonePath.value = path

  // Ensure the active item is on the visible page
  const zoneIdx = filteredZones.value.findIndex(z => z.id === zoneId)
  if (zoneIdx >= 0) {
    zoneCurrentPage.value = Math.floor(zoneIdx / ZONE_PAGE_SIZE)
  }

  // Auto-scroll to active item after DOM update
  await nextTick()
  scrollToActiveItem('zone-list')

  try {
    zoneViewer.isLoading.value = true
    zoneViewer.error.value = null

    const directory = await zoneDatLoader.load(path)
    zoneViewer.loadZone(directory)
  } catch (err) {
    zoneViewer.error.value = `Failed to load zone ${zoneId}: ${err instanceof Error ? err.message : String(err)}`
    zoneViewer.isLoading.value = false
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SHARED HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

/** Scroll the active list item into view within its scrollable container. */
function scrollToActiveItem(listId: string): void {
  const container = document.querySelector(`[data-list="${listId}"]`)
  if (!container) { return }
  const active = container.querySelector('.model-list-item.active')
  if (active) {
    active.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// KEYBOARD + LIFECYCLE
// ═══════════════════════════════════════════════════════════════════════════════

function onKeyDown(event: KeyboardEvent): void {
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) {
    return
  }

  switch (event.key) {
    case 'ArrowLeft':
      event.preventDefault()
      browseMode.value === 'models' ? prevModel() : prevZone()
      break
    case 'ArrowRight':
      event.preventDefault()
      browseMode.value === 'models' ? nextModel() : nextZone()
      break
  }
}

watch(selectedRange, () => {
  scanRange()
})

onMounted(async () => {
  window.addEventListener('keydown', onKeyDown)

  try {
    resourceTableRuntime = createResourceTableRuntime({
      baseUrl: datBaseUrl,
      headers: datHeaders,
      fileTableCount: 1,
    })
    await resourceTableRuntime.preloadAll()

    datLoader = new DatLoader<DirectoryResource>({
      baseUrl: datBaseUrl,
      headers: datHeaders,
      parseDat: (resourceName, bytes) => DatParser.parse(resourceName, bytes),
    })

    // Zone DATs need zoneResource flag and decryption keys from MainDll
    initZoneDecrypt(resourceTableRuntime.mainDll)
    zoneDatLoader = new DatLoader<DirectoryResource>({
      baseUrl: datBaseUrl,
      headers: datHeaders,
      parseDat: (resourceName, bytes) => DatParser.parse(resourceName, bytes, { zoneResource: true }),
    })

    // Load zone names
    zoneNameTable = new ZoneNameTable(
      (path: string) => resourceTableRuntime!.bytesLoader.load(path),
    )
    await zoneNameTable.preload()

    isReady.value = true
    scanRange()
    buildZoneList()
  } catch (err) {
    const msg = `Failed to initialize: ${err instanceof Error ? err.message : String(err)}`
    modelViewer.error.value = msg
    zoneViewer.error.value = msg
  }
})

onUnmounted(() => {
  window.removeEventListener('keydown', onKeyDown)
  modelViewer.dispose()
  zoneViewer.dispose()
})
</script>

<style scoped>
.browser-shell {
  min-height: calc(100vh - 44px);
  padding: clamp(1rem, 2vw, 2rem);
  display: grid;
  gap: 1rem;
  grid-template-columns: minmax(260px, 360px) 1fr;
  background:
    radial-gradient(circle at 10% 10%, rgba(239, 228, 199, 0.7), transparent 60%),
    radial-gradient(circle at 90% 25%, rgba(183, 208, 214, 0.65), transparent 50%),
    linear-gradient(180deg, #fffdf8, #f0f5f7);
  font-family: 'Spectral', 'Georgia', serif;
}

.browser-panel {
  border: 1px solid #d7ddd3;
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.82);
  backdrop-filter: blur(4px);
  padding: 1rem;
  display: grid;
  gap: 0.75rem;
  align-content: start;
  max-height: calc(100vh - 44px);
  overflow-y: auto;
}

.browser-header h1 {
  margin: 0;
  font-size: 1.65rem;
  letter-spacing: 0.03em;
  color: #223132;
}

.browser-header p {
  margin: 0.35rem 0 0;
  color: #334446;
  line-height: 1.35;
}

.eyebrow {
  margin: 0;
  text-transform: uppercase;
  letter-spacing: 0.09em;
  font-size: 0.75rem;
  color: #587171;
}

/* Mode Toggle */
.mode-toggle {
  display: flex;
  gap: 0;
  border: 1px solid #8aa4a6;
  border-radius: 10px;
  overflow: hidden;
}

.mode-btn {
  flex: 1;
  border: none;
  background: rgba(252, 255, 255, 0.92);
  color: #3a5556;
  font-family: inherit;
  font-size: 0.88rem;
  font-weight: 500;
  padding: 0.5rem 0.75rem;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}

.mode-btn + .mode-btn {
  border-left: 1px solid #8aa4a6;
}

.mode-btn.active {
  background: linear-gradient(180deg, #e2eef0, #c8dce0);
  color: #1a2e2f;
  font-weight: 600;
}

.mode-btn:hover:not(.active) {
  background: rgba(94, 154, 164, 0.08);
}

/* Panel Sections */
.panel-section-flat {
  border-top: 1px solid #d7ddd3;
  padding-top: 0.75rem;
}

.panel-section {
  border-top: 1px solid #d7ddd3;
  padding-top: 0.75rem;
}

.section-heading {
  margin: 0 0 0.5rem;
  font-size: 0.85rem;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: #587171;
  font-weight: 600;
  cursor: pointer;
  list-style: none;
  display: flex;
  align-items: center;
  gap: 0.4rem;
  user-select: none;
}

.section-heading::-webkit-details-marker {
  display: none;
}

.section-heading::before {
  content: '';
  display: inline-block;
  width: 0.45em;
  height: 0.45em;
  border-right: 2px solid #7a9595;
  border-bottom: 2px solid #7a9595;
  transform: rotate(-45deg);
  transition: transform 0.15s ease;
  flex-shrink: 0;
}

details[open] > .section-heading::before {
  transform: rotate(45deg);
}

.panel-section:not([open]) .section-heading {
  margin-bottom: 0;
}

.count-badge {
  font-family: 'IBM Plex Mono', 'Consolas', monospace;
  font-size: 0.7rem;
  background: rgba(94, 154, 164, 0.15);
  color: #4a8490;
  padding: 0.1rem 0.4rem;
  border-radius: 6px;
  font-weight: 500;
}

.section-grid {
  display: grid;
  gap: 0.6rem;
}

.label {
  display: block;
  font-size: 0.75rem;
  color: #5b6d6f;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  margin-bottom: 0.2rem;
}

select {
  width: 100%;
  border: 1px solid #8aa4a6;
  border-radius: 10px;
  padding: 0.45rem 0.55rem;
  background: rgba(252, 255, 255, 0.92);
  color: #233537;
  font-family: inherit;
  font-size: 0.95rem;
}

.id-input-row {
  display: flex;
  gap: 0.4rem;
}

.model-id-input {
  flex: 1;
  border: 1px solid #8aa4a6;
  border-radius: 10px;
  padding: 0.45rem 0.55rem;
  background: rgba(252, 255, 255, 0.92);
  color: #233537;
  font-family: 'IBM Plex Mono', 'Consolas', monospace;
  font-size: 0.9rem;
  box-sizing: border-box;
}

.go-btn {
  border: 1px solid #416465;
  border-radius: 10px;
  background: linear-gradient(180deg, #f5fbfc, #dfeced);
  color: #1f3132;
  font-family: inherit;
  font-size: 0.85rem;
  padding: 0.45rem 0.8rem;
  cursor: pointer;
}

.nav-row {
  display: flex;
  align-items: center;
  gap: 0.4rem;
}

.nav-row button {
  border: 1px solid #416465;
  border-radius: 8px;
  background: linear-gradient(180deg, #f5fbfc, #dfeced);
  color: #1f3132;
  font-family: inherit;
  font-size: 0.82rem;
  padding: 0.35rem 0.6rem;
  cursor: pointer;
  flex-shrink: 0;
}

.nav-row button:disabled {
  opacity: 0.4;
  cursor: default;
}

.nav-label {
  flex: 1;
  text-align: center;
  font-family: 'IBM Plex Mono', 'Consolas', monospace;
  font-size: 0.82rem;
  color: #334446;
}

/* Classification Controls */
.classify-row {
  display: flex;
  gap: 0.5rem;
  align-items: flex-end;
}

.classify-filter {
  flex: 1;
}

.classify-action {
  flex-shrink: 0;
}

.classify-btn {
  border: 1px solid #416465;
  border-radius: 10px;
  background: linear-gradient(180deg, #f5fbfc, #dfeced);
  color: #1f3132;
  font-family: inherit;
  font-size: 0.82rem;
  padding: 0.45rem 0.7rem;
  cursor: pointer;
  white-space: nowrap;
}

.classify-btn:disabled {
  opacity: 0.4;
  cursor: default;
}

.classify-btn.cancel {
  background: linear-gradient(180deg, #fdf5f5, #f0dede);
  border-color: #8a5555;
  color: #6b2a2a;
}

.classify-progress {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-top: 0.35rem;
}

.progress-bar {
  flex: 1;
  height: 6px;
  background: rgba(94, 154, 164, 0.15);
  border-radius: 3px;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background: linear-gradient(90deg, #5e9aa4, #7ab8c2);
  border-radius: 3px;
  transition: width 0.2s ease;
}

.progress-label {
  font-family: 'IBM Plex Mono', 'Consolas', monospace;
  font-size: 0.7rem;
  color: #587171;
  white-space: nowrap;
}

/* Type Badges */
.type-badge {
  font-family: 'IBM Plex Mono', 'Consolas', monospace;
  font-size: 0.62rem;
  padding: 0.05rem 0.35rem;
  border-radius: 4px;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.type-prop {
  background: rgba(168, 137, 88, 0.18);
  color: #7a6330;
}

.type-npc {
  background: rgba(94, 154, 164, 0.18);
  color: #3a6b75;
}

.type-flying {
  background: rgba(142, 120, 180, 0.18);
  color: #5c4a80;
}

.type-unknown {
  background: rgba(150, 150, 150, 0.15);
  color: #777;
}

.model-id-row {
  display: flex;
  align-items: center;
  gap: 0.35rem;
}

/* Model / Zone List */
.model-list {
  max-height: 280px;
  overflow-y: auto;
  border: 1px solid #d7ddd3;
  border-radius: 8px;
}

.model-list-item {
  display: flex;
  flex-direction: column;
  padding: 0.35rem 0.5rem;
  border-bottom: 1px solid #eef2f0;
  cursor: pointer;
  transition: background 0.1s;
}

.model-list-item:last-child {
  border-bottom: none;
}

.model-list-item:hover {
  background: rgba(94, 154, 164, 0.08);
}

.model-list-item.active {
  background: rgba(94, 154, 164, 0.18);
  border-left: 3px solid #5e9aa4;
}

.model-id {
  font-family: 'IBM Plex Mono', 'Consolas', monospace;
  font-size: 0.82rem;
  color: #223132;
  font-weight: 600;
}

.model-path {
  font-family: 'IBM Plex Mono', 'Consolas', monospace;
  font-size: 0.7rem;
  color: #8a9e9f;
}

.pagination {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
}

.pagination button {
  border: 1px solid #8aa4a6;
  border-radius: 6px;
  background: rgba(252, 255, 255, 0.92);
  color: #233537;
  font-size: 0.8rem;
  padding: 0.2rem 0.5rem;
  cursor: pointer;
}

.pagination button:disabled {
  opacity: 0.4;
  cursor: default;
}

.pagination span {
  font-family: 'IBM Plex Mono', 'Consolas', monospace;
  font-size: 0.78rem;
  color: #587171;
}

/* Info rows */
.info-row {
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
}

.info-key {
  font-size: 0.75rem;
  color: #5b6d6f;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  min-width: 3.5rem;
  flex-shrink: 0;
}

.info-val {
  font-family: 'IBM Plex Mono', 'Consolas', monospace;
  font-size: 0.82rem;
  color: #293739;
  word-break: break-all;
}

.info-placeholder {
  margin: 0;
  color: #8a9e9f;
  font-size: 0.88rem;
  font-style: italic;
}

/* Animation Grid + Time Presets */
.anim-grid,
.time-presets {
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem;
}

.anim-btn {
  border: 1px solid #8aa4a6;
  border-radius: 6px;
  background: rgba(252, 255, 255, 0.92);
  color: #233537;
  font-family: 'IBM Plex Mono', 'Consolas', monospace;
  font-size: 0.75rem;
  padding: 0.25rem 0.45rem;
  cursor: pointer;
  transition: background 0.1s, border-color 0.1s;
}

.anim-btn:hover {
  background: rgba(94, 154, 164, 0.12);
}

.anim-btn.active {
  background: rgba(94, 154, 164, 0.25);
  border-color: #5e9aa4;
  font-weight: 600;
}

.anim-btn:disabled {
  opacity: 0.4;
  cursor: default;
}

/* Time Control */
.time-control {
  display: flex;
  align-items: center;
  gap: 0.6rem;
}

.time-slider {
  flex: 1;
  accent-color: #5e9aa4;
}

.time-label {
  font-family: 'IBM Plex Mono', 'Consolas', monospace;
  font-size: 0.85rem;
  color: #293739;
  min-width: 3.2rem;
  text-align: right;
}

/* Status Bar */
.status-bar {
  border-top: 1px solid #d7ddd3;
  padding-top: 0.5rem;
}

.error {
  margin: 0;
  color: #992d2d;
  font-size: 0.85rem;
}

/* Canvas Area */
.canvas-wrap {
  position: relative;
  width: 1024px;
  height: 768px;
  border: 1px solid #c6d4d5;
  border-radius: 14px;
  overflow: hidden;
  background: #3a3a3a;
}

.canvas-placeholder {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  color: #587171;
  font-size: 1rem;
  pointer-events: none;
}

.canvas-overlay {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  padding: 0.5rem 0.75rem;
  pointer-events: none;
}

.orbit-readout {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  width: 180px;
  font-family: 'IBM Plex Mono', 'Consolas', monospace;
  font-size: 0.72rem;
  color: rgba(255, 255, 255, 0.85);
  letter-spacing: 0.04em;
  background: rgba(0, 0, 0, 0.16);
  padding: 0.35rem 0.5rem;
  border-radius: 6px;
}

canvas {
  width: 1024px;
  height: 768px;
  display: block;
}

/* Loading Spinner */
.loading-spinner {
  width: 32px;
  height: 32px;
  border: 3px solid rgba(94, 154, 164, 0.2);
  border-top-color: #5e9aa4;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

@media (max-width: 960px) {
  .browser-shell {
    grid-template-columns: 1fr;
  }
}
</style>
