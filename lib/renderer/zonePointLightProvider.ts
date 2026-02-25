/**
 * Resolves point light data for zone objects and actors.
 *
 * Two sources of point lights:
 * 1. **DAT-sourced**: Static snapshots from zone effect resources, resolved via
 *    ZoneObject.pointLightIndices → ZoneResource.pointLightLinks → EffectResource.
 * 2. **Scene lights**: Manually placed point lights that affect all zone objects
 *    within range. Used for custom environments and testing.
 *
 * Ported from xim/poc/ZoneDrawer.kt (point light resolution) and
 * xim/poc/EffectManager.kt (EffectLighting class).
 */

import type { DirectoryResource } from '~/lib/resource/datResource'
import { EffectResource } from '~/lib/resource/effectSection'
import type { ZoneObject, ZoneResource } from '~/lib/resource/zoneResource'
import type { PointLightParams, Vector3Like } from './lights'
import { collectByTypeRecursive } from '~/lib/runtime/resourceTree'

/**
 * Provides point light data for zone objects and actors.
 * Initialize once per zone load with the zone's directory tree and zone resource.
 */
export class ZonePointLightProvider {
  /** DatId string → list of static point lights from matching effect resources */
  private readonly lightsByDatId = new Map<string, readonly PointLightParams[]>()
  /** pointLightLinks from the zone resource (index → DatId string) */
  private readonly pointLightLinks: readonly string[]
  /** Manually placed scene lights that affect all objects within range */
  private readonly sceneLights: PointLightParams[] = []

  constructor(zoneDirectory: DirectoryResource, zoneResource: ZoneResource) {
    this.pointLightLinks = zoneResource.pointLightLinks

    // Discover all auto-run point light effects in the zone directory tree.
    const effectResources = collectEffectResources(zoneDirectory)

    // Group static point lights by their DatId
    const lightMap = new Map<string, PointLightParams[]>()
    for (const effect of effectResources) {
      if (!effect.isPointLight || !effect.autoRun || !effect.staticPointLight) continue

      const pl = effect.staticPointLight
      const params: PointLightParams = {
        position: pl.position,
        color: pl.color,
        range: pl.range,
        attenuationQuad: pl.attenuationQuad,
      }

      const key = effect.id.id
      const existing = lightMap.get(key)
      if (existing) {
        existing.push(params)
      } else {
        lightMap.set(key, [params])
      }
    }

    for (const [key, value] of lightMap) {
      this.lightsByDatId.set(key, value)
    }

    const totalLights = Array.from(this.lightsByDatId.values()).reduce((s, v) => s + v.length, 0)
    if (totalLights > 0) {
      console.info(
        `[ZonePointLightProvider] Found ${totalLights} static point lights `
        + `across ${this.lightsByDatId.size} DatIds `
        + `(${this.pointLightLinks.length} link entries)`,
      )
    }
  }

  // ─── Scene Lights (manual placement) ─────────────────────────────────────

  /**
   * Add a manually placed point light to the scene.
   * Returns an index that can be used to update or remove it later.
   */
  addSceneLight(light: PointLightParams): number {
    this.sceneLights.push(light)
    return this.sceneLights.length - 1
  }

  /** Update an existing scene light by index. */
  updateSceneLight(index: number, light: PointLightParams): void {
    if (index >= 0 && index < this.sceneLights.length) {
      this.sceneLights[index] = light
    }
  }

  /** Remove a scene light by index (sets it to a no-op light). */
  removeSceneLight(index: number): void {
    if (index >= 0 && index < this.sceneLights.length) {
      this.sceneLights[index] = { position: { x: 0, y: 0, z: 0 }, color: { r: 0, g: 0, b: 0, a: 0 }, range: 0, attenuationQuad: 0 }
    }
  }

  /** Remove all scene lights. */
  clearSceneLights(): void {
    this.sceneLights.length = 0
  }

  /** Get the current list of scene lights (for UI display). */
  getSceneLights(): readonly PointLightParams[] {
    return this.sceneLights
  }

  // ─── Resolution ──────────────────────────────────────────────────────────

  /**
   * Resolve point lights for a zone object.
   * Merges DAT-sourced per-object lights with scene lights.
   * Scene lights are applied unconditionally — the shader handles per-vertex
   * distance falloff, so we don't filter by object origin (zone objects can
   * span far beyond their origin position).
   * Returns up to 4 (shader limit).
   */
  resolveForZoneObject(zoneObj: ZoneObject): readonly PointLightParams[] {
    const lights: PointLightParams[] = []

    // DAT-sourced lights from pointLightIndices
    for (const index of zoneObj.pointLightIndices) {
      if (index < 0 || index >= this.pointLightLinks.length) continue
      const datId = this.pointLightLinks[index]!
      const matched = this.lightsByDatId.get(datId)
      if (matched) {
        lights.push(...matched)
      }
    }

    // Scene lights: applied to all objects (shader does per-vertex range cutoff)
    for (const sl of this.sceneLights) {
      if (sl.range <= 0) continue
      lights.push(sl)
    }

    return lights.slice(0, 4)
  }

  /**
   * Resolve point lights for an actor at a given position.
   * Merges DAT-sourced collision lights with scene lights within range.
   */
  resolveForActorAt(position: Vector3Like, lightIndices?: readonly number[]): readonly PointLightParams[] {
    const lights: PointLightParams[] = []

    // DAT-sourced lights from collision surface indices
    if (lightIndices) {
      for (const index of lightIndices) {
        if (index < 0 || index >= this.pointLightLinks.length) continue
        const datId = this.pointLightLinks[index]!
        const matched = this.lightsByDatId.get(datId)
        if (matched) {
          lights.push(...matched)
        }
      }
    }

    // Scene lights: applied unconditionally (shader does per-vertex range cutoff)
    for (const sl of this.sceneLights) {
      if (sl.range <= 0) continue
      lights.push(sl)
    }

    return lights.slice(0, 4)
  }

  /** Whether any point lights exist (DAT-sourced or scene). */
  get hasPointLights(): boolean {
    return this.lightsByDatId.size > 0 || this.sceneLights.length > 0
  }
}

/**
 * Collect all EffectResource entries from the zone directory tree.
 * Mirrors Kotlin's Scene.registerEffects() which looks under "data"/"effe" and "data"/"mode".
 * Falls back to collecting from the entire tree to avoid missing any generators.
 */
function collectEffectResources(root: DirectoryResource): readonly EffectResource[] {
  return collectByTypeRecursive(root, EffectResource)
}
