import { ref, reactive, type Ref } from 'vue'
import type { DirectoryResource } from '~/lib/resource/datResource'
import { ZoneResource } from '~/lib/resource/zoneResource'
import { ThreeRenderer } from '~/lib/renderer/threeRenderer'
import { ZoneRenderer } from '~/lib/renderer/zoneRenderer'
import { EnvironmentManager } from '~/lib/renderer/environmentManager'
import { ZonePointLightProvider } from '~/lib/renderer/zonePointLightProvider'
import { SkyboxRenderer } from '~/lib/renderer/skyboxRenderer'
import { collectByTypeRecursive } from '~/lib/runtime/resourceTree'
import { useOrbitControls, type OrbitControlsHandle } from './useOrbitControls'

export interface ZoneViewerState {
  readonly isLoading: Ref<boolean>
  readonly error: Ref<string | null>
  readonly zoneInfo: Ref<ZoneInfo | null>
  readonly timeOfDay: Ref<number>
  readonly orbitState: {
    azimuth: number
    elevation: number
    distance: number
  }
}

export interface ZoneInfo {
  readonly objectCount: number
  readonly meshCount: number
  readonly environmentIds: readonly string[]
  readonly hasCollision: boolean
  readonly hasSkybox: boolean
}

export interface ZoneViewerHandle extends ZoneViewerState {
  loadZone(directory: DirectoryResource): void
  setTimeOfDay(minutes: number): void
  dispose(): void
}

/**
 * Composable for rendering a zone environment in a Three.js canvas.
 * Manages ZoneRenderer, EnvironmentManager, SkyboxRenderer, orbit controls,
 * and the render loop.
 */
export function useZoneViewer(canvas: Ref<HTMLCanvasElement | null>): ZoneViewerHandle {
  const isLoading = ref(false)
  const error = ref<string | null>(null)
  const zoneInfo = ref<ZoneInfo | null>(null)
  const timeOfDay = ref(480) // 8:00 AM default
  const orbitState = reactive({ azimuth: 0, elevation: 0, distance: 0 })

  let threeRenderer: ThreeRenderer | null = null
  let zoneRenderer: ZoneRenderer | null = null
  let envManager: EnvironmentManager | null = null
  let pointLightProvider: ZonePointLightProvider | null = null
  let skyboxRenderer: SkyboxRenderer | null = null
  let orbitControls: OrbitControlsHandle | null = null
  let frameHandle: number | null = null
  let previousFrameTime = 0

  function dispose(): void {
    if (frameHandle !== null) {
      cancelAnimationFrame(frameHandle)
      frameHandle = null
    }
    orbitControls?.dispose()
    orbitControls = null
    if (zoneRenderer && threeRenderer) {
      zoneRenderer.dispose(threeRenderer.scene)
    }
    zoneRenderer = null
    if (skyboxRenderer && threeRenderer) {
      skyboxRenderer.dispose(threeRenderer.scene)
    }
    skyboxRenderer = null
    envManager = null
    pointLightProvider = null
    threeRenderer?.dispose()
    threeRenderer = null
    zoneInfo.value = null
  }

  function loadZone(directory: DirectoryResource): void {
    error.value = null
    isLoading.value = true

    try {
      dispose()

      const canvasEl = canvas.value
      if (!canvasEl) {
        throw new Error('Canvas element not available')
      }

      // Extract zone resource
      const zoneResources = collectByTypeRecursive(directory, ZoneResource)
      const zoneResource = zoneResources[0] ?? null
      if (!zoneResource) {
        throw new Error('No ZoneResource found in DAT')
      }

      // Create Three.js renderer
      threeRenderer = new ThreeRenderer({ canvas: canvasEl })

      // Create and build zone renderer
      zoneRenderer = new ZoneRenderer()
      zoneRenderer.buildFromZoneData(threeRenderer.scene, {
        zoneResource,
        directory,
      })

      // Initialize environment manager
      envManager = new EnvironmentManager()
      envManager.init(directory)
      const envIds = envManager.getAvailableEnvIds()

      // Initialize point light provider
      pointLightProvider = new ZonePointLightProvider(directory, zoneResource)

      // Initialize skybox
      skyboxRenderer = new SkyboxRenderer()

      // Populate zone info
      zoneInfo.value = {
        objectCount: zoneRenderer.objectCount,
        meshCount: zoneRenderer.totalMeshCount,
        environmentIds: envIds,
        hasCollision: zoneResource.collisionMap !== null,
        hasSkybox: envIds.length > 0,
      }

      // Apply initial environment
      applyEnvironment()

      // Position camera at a reasonable overview point
      // Estimate from zone bounding based on object count / draw distance
      const env = envManager.resolve(timeOfDay.value)
      const viewDist = Math.min(env.drawDistance * 0.3, 200)

      threeRenderer.camera.position.set(0, -viewDist * 0.6, viewDist)
      threeRenderer.camera.lookAt(0, 0, 0)

      orbitControls = useOrbitControls({
        camera: threeRenderer.camera,
        domElement: canvasEl,
        target: { x: 0, y: 0, z: 0 },
        maxDistance: env.drawDistance,
        enablePan: true,
        panSpeed: 5.0,
      })

      // Start render loop
      previousFrameTime = performance.now()
      const tick = (time: number): void => {
        if (!threeRenderer || !zoneRenderer) { return }

        previousFrameTime = time

        // Update zone wind animation
        zoneRenderer.updateWind(time / 1000)

        // Update lighting per environment manager
        if (envManager) {
          zoneRenderer.applyLightingFromEnvManager(
            envManager,
            timeOfDay.value,
            pointLightProvider,
          )
          zoneRenderer.updateVisibility(
            threeRenderer.camera,
            envManager.resolve(timeOfDay.value).drawDistance,
          )
        }

        // Update orbit controls
        const state = orbitControls?.update()
        if (state) {
          orbitState.azimuth = state.azimuth
          orbitState.elevation = state.elevation
          orbitState.distance = state.distance
        }

        // Render scene (empty commands = zone-only rendering)
        threeRenderer.render([])
        frameHandle = requestAnimationFrame(tick)
      }

      frameHandle = requestAnimationFrame(tick)
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err)
    } finally {
      isLoading.value = false
    }
  }

  function applyEnvironment(): void {
    if (!envManager || !threeRenderer || !skyboxRenderer) { return }

    const env = envManager.resolve(timeOfDay.value)

    // Set clear color from environment
    threeRenderer.setClearColor(env.clearColor.r, env.clearColor.g, env.clearColor.b)

    // Build skybox
    skyboxRenderer.build(threeRenderer.scene, env.skyBox)
  }

  function setTimeOfDay(minutes: number): void {
    timeOfDay.value = Math.max(0, Math.min(1439, minutes))
    applyEnvironment()
  }

  return {
    isLoading,
    error,
    zoneInfo,
    timeOfDay,
    orbitState,
    loadZone,
    setTimeOfDay,
    dispose,
  }
}
