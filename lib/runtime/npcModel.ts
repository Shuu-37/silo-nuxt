import {
  DatId,
  type DirectoryResource,
  type InfoDefinition,
  InfoResource,
  type SkeletonResource,
  SkeletonResource as SkeletonResourceClass,
} from '~/lib/resource/datResource'
import type { BlurConfig, Model } from './model'
import { collectByTypeRecursive, getNullableChildRecursivelyAs } from './resourceTree'

/**
 * Model implementation for NPC/monster DAT files.
 *
 * NPC DATs are self-contained: a single file has the skeleton,
 * meshes, textures, and animations. No equipment system, no
 * multi-DAT merging.
 *
 * Port of Kotlin NpcModel (xim/poc/Model.kt).
 */
export class NpcModel implements Model {
  private readonly root: DirectoryResource
  private cachedInfo: InfoDefinition | null | undefined = undefined

  constructor(root: DirectoryResource) {
    this.root = root
  }

  isReadyToDraw(): boolean {
    return true
  }

  getMeshResources(): readonly DirectoryResource[] {
    // NPC DATs often have a "mode" (model) sub-directory containing the meshes.
    // Fall back to root if not present.
    const modelDir = this.root.getNullableSubDirectory(new DatId('mode'))
    return modelDir !== null ? [modelDir] : [this.root]
  }

  getSkeletonResource(): SkeletonResource | null {
    const skeletons = collectByTypeRecursive(this.root, SkeletonResourceClass)
    return skeletons[0] ?? null
  }

  getAnimationDirectories(): readonly DirectoryResource[] {
    // Include root + all sub-directories recursively
    return [this.root, ...getSubDirectoriesRecursive(this.root)]
  }

  getMainBattleAnimationDirectory(): DirectoryResource | null {
    return this.root
  }

  getSubBattleAnimationDirectory(): DirectoryResource | null {
    return this.root
  }

  getEquipmentModelResource(): DirectoryResource | null {
    return this.root
  }

  getMovementInfo(): InfoDefinition | null {
    if (this.cachedInfo !== undefined) {
      return this.cachedInfo
    }
    const infoResource = getNullableChildRecursivelyAs(this.root, DatId.info, InfoResource)
    this.cachedInfo = infoResource?.infoDefinition ?? null
    return this.cachedInfo
  }

  getMainWeaponInfo(): InfoDefinition | null {
    return null
  }

  getSubWeaponInfo(): InfoDefinition | null {
    return null
  }

  getRangedWeaponInfo(): InfoDefinition | null {
    return null
  }

  getBlurConfig(): BlurConfig | null {
    // BlurResource is not yet ported -- return null for now
    return null
  }

  getScale(): number {
    const info = this.getMovementInfo()
    if (info?.scale != null && info.scale !== 0) {
      return info.scale / 100
    }
    return 1
  }
}

/**
 * Recursively collects all sub-directories from a DirectoryResource tree.
 * Equivalent to Kotlin's getSubDirectoriesRecursively().
 */
function getSubDirectoriesRecursive(root: DirectoryResource): DirectoryResource[] {
  const result: DirectoryResource[] = []
  const children = root.getSubDirectories()
  for (const child of children) {
    result.push(child)
    result.push(...getSubDirectoriesRecursive(child))
  }
  return result
}
