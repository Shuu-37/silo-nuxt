/**
 * Zone mesh renderer.
 *
 * Manages Three.js objects for zone meshes (terrain, buildings, etc.)
 * as a Group added to the ThreeRenderer's scene.
 */

import {
  DoubleSide,
  Group,
  LessDepth,
  Mesh,
  ShaderMaterial,
  Vector3,
  Vector4,
  type Camera,
  type Scene,
  type Side,
} from 'three'

import { buildGeometryForZoneMesh } from './zoneMeshGeometry'
import { getOrCreateTexture, defaultGrayTexture } from './textureFactory'
import { zoneVertexShader, zoneFragmentShader } from './shaders/zoneShader'
import { POINT_LIGHT_COUNT, DIFFUSE_LIGHT_COUNT } from './shaders/shaderConstants'
import { DirectoryResource } from '~/lib/resource/datResource'
import type { ZoneMeshResource, ZoneResource, ZoneObject } from '~/lib/resource/zoneResource'
import type { FogParams, LightingParams, PointLightParams } from './lights'
import type { EnvironmentManager } from './environmentManager'
import type { ZonePointLightProvider } from './zonePointLightProvider'

export interface ZoneSceneData {
  readonly zoneResource: ZoneResource
  readonly directory: DirectoryResource
}

export class ZoneRenderer {
  private readonly root = new Group()
  private meshCount = 0
  private readonly meshGroups: Group[] = []

  get objectCount(): number {
    return this.meshGroups.length
  }

  get totalMeshCount(): number {
    return this.meshCount
  }

  /**
   * Build zone meshes and add them to the scene.
   * Each zone object is a Group with positioned/rotated/scaled meshes.
   */
   buildFromZoneData(scene: Scene, data: ZoneSceneData): void {
    this.dispose(scene)

    const { zoneResource, directory } = data
    let texturesResolved = 0
    let texturesMissing = 0
    let emptyNameSkipped = 0
    let meshesSkipped = 0
    const missingTextureNames = new Set<string>()

    // Diagnostic: dump available texture and mesh counts
    logDirectoryInventory(directory)

    for (const zoneObj of zoneResource.zoneObjects) {
      const meshResource = resolveZoneMesh(zoneObj.objectId, directory)
      if (!meshResource) {
        meshesSkipped++
        continue
      }

      const objGroup = new Group()
      objGroup.name = zoneObj.objectId
      objGroup.userData.environmentLink = zoneObj.environmentLink ?? null
      objGroup.userData.zoneObject = zoneObj

      // Apply zone object transform: translate * rotateZYX * scale
      objGroup.position.set(zoneObj.position.x, zoneObj.position.y, zoneObj.position.z)
      applyZYXRotation(objGroup, zoneObj.rotation)
      objGroup.scale.set(zoneObj.scale.x, zoneObj.scale.y, zoneObj.scale.z)

      // Detect mirrored objects for winding flip
      const isMirrored = zoneObj.scale.x * zoneObj.scale.y * zoneObj.scale.z < 0

      for (const buffer of meshResource.buffers) {
        const textureResource = buffer.textureLink?.getOrPut() ?? null

        if (textureResource) {
          texturesResolved++
        } else {
          const cleanName = buffer.textureName.replace(/\0/g, '').trim()
          if (cleanName.length === 0) {
            // Empty texture name — includes water surfaces and other untextured geometry.
            // Render with gray fallback (matching Kotlin's getTextureOrDefault behavior).
            emptyNameSkipped++
          } else {
            texturesMissing++
            missingTextureNames.add(cleanName)
          }
        }

        const geometry = buildGeometryForZoneMesh(buffer)
        const diffuseTexture = textureResource ? getOrCreateTexture(textureResource) : defaultGrayTexture()

        // Determine face culling side
        const side = determineSide(buffer.renderState, isMirrored)

        const material = new ShaderMaterial({
          uniforms: {
            positionBlendWeight: { value: 0.0 },
            diffuseTexture: { value: diffuseTexture },
            discardThreshold: { value: buffer.renderState.discardThreshold ?? 0.0 },
            blendEnabled: { value: buffer.renderState.blendEnabled ? 1.0 : 0.0 },
            colorMask: { value: new Vector4(1, 1, 1, 1) },
            ambientLightColor: { value: new Vector4(0.6, 0.6, 0.6, 1) },
            ...buildDiffuseLightUniforms(),
            ...buildPointLightUniforms(),
            'uFog.fogNearDist': { value: 99999.0 },
            'uFog.fogFarDist': { value: 99999.0 },
            'uFog.fogColor': { value: new Vector4(0, 0, 0, 0) },
          },
          vertexShader: zoneVertexShader,
          fragmentShader: zoneFragmentShader,
          transparent: buffer.renderState.blendEnabled,
          depthWrite: !buffer.renderState.blendEnabled,
          depthFunc: LessDepth,
          side,
        })

        // Apply polygon offset for z-bias (prevents z-fighting on blended surfaces)
        const zBias = buffer.renderState.zBias ?? 0
        if (zBias > 0) {
          material.polygonOffset = true
          material.polygonOffsetFactor = -zBias
          material.polygonOffsetUnits = 1
        }

        const mesh = new Mesh(geometry, material)
        mesh.frustumCulled = false
        if (buffer.vertexBlendEnabled) {
          mesh.userData.windAnimated = true
        }
        objGroup.add(mesh)
        this.meshCount++
      }

      if (objGroup.children.length > 0) {
        this.root.add(objGroup)
        this.meshGroups.push(objGroup)
      }
    }

    scene.add(this.root)

    if (meshesSkipped > 0) {
      console.warn(`[ZoneRenderer] ${meshesSkipped} zone objects had no mesh resource`)
    }
    console.info(`[ZoneRenderer] Textures: ${texturesResolved} resolved, ${texturesMissing} missing (named)`)

    if (missingTextureNames.size > 0) {
      const available = directory.getAllTextureNames()
      console.warn(`[ZoneRenderer] Missing textures (${missingTextureNames.size} unique names):`, Array.from(missingTextureNames))
      console.info(`[ZoneRenderer] Available zone textures (${available.length}):`, available)
    }
    if (emptyNameSkipped > 0) {
      console.info(`[ZoneRenderer] ${emptyNameSkipped} empty-name mesh buffers rendered with gray fallback (water, etc.)`)
    }
  }

  /**
   * Apply uniform environment lighting to all zone meshes.
   */
  applyLighting(lighting: LightingParams, fog: FogParams): void {
    this.root.traverse((child) => {
      if (!(child instanceof Mesh)) return
      const material = child.material
      if (!(material instanceof ShaderMaterial)) return
      applyLightingToMaterial(material.uniforms, lighting, fog)
    })
  }

  /**
   * Apply per-object environment lighting using the EnvironmentManager.
   * Each zone object group may have a different environmentLink (e.g., indoor vs outdoor).
   * Optionally applies per-object point lights if a provider is given.
   */
  applyLightingFromEnvManager(
    envManager: EnvironmentManager,
    timeMinutes: number,
    pointLightProvider?: ZonePointLightProvider | null,
  ): void {
    for (const group of this.meshGroups) {
      const envLink = group.userData.environmentLink as string | null
      const { lighting, fog } = envManager.resolveTerrainForObject(envLink, timeMinutes)

      const zoneObj = group.userData.zoneObject as ZoneObject | undefined
      const pointLights = (pointLightProvider && zoneObj)
        ? pointLightProvider.resolveForZoneObject(zoneObj)
        : []

      group.traverse((child) => {
        if (!(child instanceof Mesh)) return
        const material = child.material
        if (!(material instanceof ShaderMaterial)) return
        applyLightingToMaterial(material.uniforms, lighting, fog)
        applyPointLightsToMaterial(material.uniforms, pointLights)
      })
    }
  }

  /**
   * Update wind-animated foliage (vertex blend weight oscillation).
   * Call each frame with the elapsed time in seconds.
   */
  updateWind(timeSeconds: number): void {
    // Oscillate 0→1 over 2-second cycles, matching Kotlin WindFactor
    const windFactor = (Math.sin(timeSeconds * Math.PI) + 1) / 2

    this.root.traverse((child) => {
      if (!(child instanceof Mesh)) return
      if (!child.userData.windAnimated) return
      const material = child.material
      if (!(material instanceof ShaderMaterial)) return
      material.uniforms.positionBlendWeight.value = windFactor
    })
  }

  /**
   * Cull zone objects beyond the environment draw distance.
   * Objects that are too far from the camera are hidden to save rendering cost.
   */
  updateVisibility(camera: Camera, drawDistance: number): void {
    const cameraPos = camera.position
    for (const group of this.meshGroups) {
      const dx = group.position.x - cameraPos.x
      const dy = group.position.y - cameraPos.y
      const dz = group.position.z - cameraPos.z
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz)
      group.visible = dist <= drawDistance
    }
  }

  dispose(scene: Scene): void {
    this.root.traverse((child) => {
      if (child instanceof Mesh) {
        child.geometry.dispose()
        if (child.material instanceof ShaderMaterial) {
          child.material.dispose()
        }
      }
    })

    scene.remove(this.root)
    this.root.clear()
    this.meshGroups.length = 0
    this.meshCount = 0
  }
}

/**
 * Log the directory tree's texture and mesh inventory for diagnostics.
 */
function logDirectoryInventory(directory: DirectoryResource): void {
  const texCount = directory.textureCount
  const meshCount = directory.zoneMeshCount
  const subDirs = directory.getSubDirectories()

  let subTextures = 0
  let subMeshes = 0
  for (const sub of subDirs) {
    subTextures += sub.textureCount
    subMeshes += sub.zoneMeshCount
  }

  const globalCount = DirectoryResource.globalTextureCount
  const sample = DirectoryResource.getGlobalTextureNameSample(3)

  console.info(
    `[ZoneRenderer] Directory inventory: root(tex=${texCount}, mesh=${meshCount}), `
    + `${subDirs.length} subdirs(tex=${subTextures}, mesh=${subMeshes}), `
    + `global=${globalCount} sample=[${sample.join(', ')}]`,
  )
}

/**
 * Resolve a zone mesh resource by name from the directory tree.
 * Searches root directory, then immediate children, then recursively deeper.
 */
function resolveZoneMesh(name: string, directory: DirectoryResource): ZoneMeshResource | null {
  // Try exact name first
  const exact = findZoneMeshByName(name, directory)
  if (exact) return exact

  // LOD fallback: if name ends with _h/_m/_l, try other LOD variants
  if (hasLodSuffix(name)) {
    const baseId = name.slice(0, -2)
    // Prefer high > med > low
    for (const suffix of ['_h', '_m', '_l']) {
      const variant = findZoneMeshByName(baseId + suffix, directory)
      if (variant) return variant
    }
  }

  return null
}

const LOD_SUFFIXES = ['_h', '_m', '_l']

function hasLodSuffix(name: string): boolean {
  return LOD_SUFFIXES.some(s => name.endsWith(s))
}

function findZoneMeshByName(name: string, directory: DirectoryResource): ZoneMeshResource | null {
  const entry = directory.getZoneMeshByName(name)
  if (entry) return entry as unknown as ZoneMeshResource

  for (const subDir of directory.getSubDirectories()) {
    const found = findZoneMeshByName(name, subDir)
    if (found) return found
  }

  return null
}

/**
 * Apply ZYX Euler rotation (matching FFXI's convention).
 */
function applyZYXRotation(group: Group, rotation: { x: number, y: number, z: number }): void {
  // Three.js default Euler order is 'XYZ', FFXI uses ZYX
  group.rotation.set(rotation.x, rotation.y, rotation.z, 'ZYX')
}

/**
 * Determine the Three.js face culling side for a zone mesh buffer.
 *
 * Always use DoubleSide to render both faces. FFXI zone meshes have
 * inconsistent winding across objects, and the viewer doesn't need
 * the minor GPU savings from backface culling.
 */
function determineSide(_renderState: import('~/lib/resource/datResource').MeshRenderState, _isMirrored: boolean): Side {
  return DoubleSide
}

// ─── Lighting Application ────────────────────────────────────────────────────

function applyLightingToMaterial(u: UniformMap, lighting: LightingParams, fog: FogParams): void {
  const ac = lighting.ambientColor
  setVec4(u, 'ambientLightColor', ac.r, ac.g, ac.b, ac.a)

  for (let i = 0; i < DIFFUSE_LIGHT_COUNT; i++) {
    const light = lighting.lights[i]
    if (light) {
      setVec3(u, `diffuseLights[${i}].diffuseLightDir`, light.direction.x, light.direction.y, light.direction.z)
      setVec4(u, `diffuseLights[${i}].diffuseLightColor`, light.color.r, light.color.g, light.color.b, light.color.a)
    }
  }

  setFloat(u, 'uFog.fogNearDist', clampFog(fog.start))
  setFloat(u, 'uFog.fogFarDist', clampFog(fog.end))
  setVec4(u, 'uFog.fogColor', fog.color.r, fog.color.g, fog.color.b, fog.color.a)
}

/**
 * Apply per-object point light uniforms.
 * Matches Kotlin's GLDrawer.drawXim() lines 156-158:
 * unused slots get zeroed (no-op) values.
 */
function applyPointLightsToMaterial(u: UniformMap, pointLights: readonly PointLightParams[]): void {
  for (let i = 0; i < POINT_LIGHT_COUNT; i++) {
    const pl = pointLights[i]
    if (pl) {
      setVec3(u, `pointLights[${i}].position`, pl.position.x, pl.position.y, pl.position.z)
      setVec4(u, `pointLights[${i}].color`, pl.color.r, pl.color.g, pl.color.b, pl.color.a)
      setFloat(u, `pointLights[${i}].range`, pl.range)
      setVec3(u, `pointLights[${i}].attenuation`, 0, 0, pl.attenuationQuad)
    } else {
      setVec3(u, `pointLights[${i}].position`, 0, 0, 0)
      setVec4(u, `pointLights[${i}].color`, 0, 0, 0, 0)
      setFloat(u, `pointLights[${i}].range`, 0)
      setVec3(u, `pointLights[${i}].attenuation`, 1, 0, 0)
    }
  }
}

// ─── Uniform Helpers ─────────────────────────────────────────────────────────

type UniformMap = Record<string, { value: unknown }>

function setFloat(u: UniformMap, name: string, value: number): void {
  if (u[name]) u[name].value = value
}

function setVec3(u: UniformMap, name: string, x: number, y: number, z: number): void {
  const entry = u[name]
  if (!entry) return
  const current = entry.value
  if (current instanceof Vector3) {
    current.set(x, y, z)
  } else {
    entry.value = new Vector3(x, y, z)
  }
}

function setVec4(u: UniformMap, name: string, x: number, y: number, z: number, w: number): void {
  const entry = u[name]
  if (!entry) return
  const current = entry.value
  if (current instanceof Vector4) {
    current.set(x, y, z, w)
  } else {
    entry.value = new Vector4(x, y, z, w)
  }
}

function clampFog(value: number): number {
  return Number.isFinite(value) ? value : 99999.0
}

function buildDiffuseLightUniforms(): Record<string, { value: unknown }> {
  const uniforms: Record<string, { value: unknown }> = {}
  for (let i = 0; i < DIFFUSE_LIGHT_COUNT; i++) {
    uniforms[`diffuseLights[${i}].diffuseLightDir`] = { value: new Vector3(0, 1, 0) }
    uniforms[`diffuseLights[${i}].diffuseLightColor`] = { value: new Vector4(0.3, 0.3, 0.3, 1) }
  }
  return uniforms
}

function buildPointLightUniforms(): Record<string, { value: unknown }> {
  const uniforms: Record<string, { value: unknown }> = {}
  for (let i = 0; i < POINT_LIGHT_COUNT; i++) {
    uniforms[`pointLights[${i}].position`] = { value: new Vector3(0, 0, 0) }
    uniforms[`pointLights[${i}].color`] = { value: new Vector4(0, 0, 0, 0) }
    uniforms[`pointLights[${i}].range`] = { value: 0 }
    uniforms[`pointLights[${i}].attenuation`] = { value: new Vector3(1, 0, 0) }
  }
  return uniforms
}
