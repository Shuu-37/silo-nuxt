import { ref, reactive, type Ref } from 'vue'
import { DatId } from '~/lib/resource/datResource'
import type { LightingParams, FogParams } from '~/lib/renderer/lights'
import { ThreeRenderer } from '~/lib/renderer/threeRenderer'
import { Actor, ActorId, type ActorState } from '~/lib/runtime/actor'
import { NoOpActorController } from '~/lib/runtime/actorController'
import { ActorModel, type RuntimeActor } from '~/lib/runtime/actorModel'
import type { Model } from '~/lib/runtime/model'
import { RuntimeScene } from '~/lib/runtime/scene'
import { LoopParams, TransitionParams } from '~/lib/runtime/skeletonAnimator'
import { getXiCameraFrame } from '~/lib/runtime/basicPc'
import { useOrbitControls, type OrbitControlsHandle } from './useOrbitControls'

/**
 * Simple neutral lighting for the model browser preview.
 * Not zone-dependent -- just enough to see the model clearly.
 */
const previewLighting: LightingParams = {
  ambientColor: { r: 0.45, g: 0.45, b: 0.48, a: 1.0 },
  lights: [
    {
      direction: { x: 0.4, y: -0.7, z: 0.5 },
      color: { r: 0.55, g: 0.52, b: 0.48, a: 1.0 },
    },
    {
      direction: { x: -0.3, y: -0.4, z: -0.6 },
      color: { r: 0.18, g: 0.2, b: 0.25, a: 1.0 },
    },
  ],
}

const previewFog: FogParams = {
  start: 800,
  end: 2000,
  color: { r: 0.88, g: 0.91, b: 0.94, a: 1.0 },
}

export interface ModelViewerState {
  readonly isLoading: Ref<boolean>
  readonly error: Ref<string | null>
  readonly modelInfo: Ref<ModelInfo | null>
  readonly animations: Ref<string[]>
  readonly currentAnimation: Ref<string | null>
  readonly orbitState: {
    azimuth: number
    elevation: number
    distance: number
  }
}

export interface ModelInfo {
  readonly jointCount: number
  readonly meshCount: number
  readonly textureCount: number
  readonly scale: number
}

export interface ModelViewerHandle extends ModelViewerState {
  loadModel(model: Model): void
  playAnimation(animationId: string): void
  setAutoRotate(enabled: boolean): void
  dispose(): void
}

/**
 * Composable for rendering a single model in a Three.js canvas.
 * Manages the full lifecycle: ThreeRenderer, Actor, ActorModel,
 * RuntimeScene, orbit controls, and animation loop.
 */
export function useModelViewer(canvas: Ref<HTMLCanvasElement | null>): ModelViewerHandle {
  const isLoading = ref(false)
  const error = ref<string | null>(null)
  const modelInfo = ref<ModelInfo | null>(null)
  const animations = ref<string[]>([])
  const currentAnimation = ref<string | null>(null)
  const orbitState = reactive({ azimuth: 0, elevation: 0, distance: 0 })

  let renderer: ThreeRenderer | null = null
  let runtimeScene: RuntimeScene | null = null
  let actor: Actor | null = null
  let actorModel: ActorModel | null = null
  let orbitControls: OrbitControlsHandle | null = null
  let frameHandle: number | null = null
  let previousFrameTime = 0
  let currentModel: Model | null = null

  function dispose(): void {
    if (frameHandle !== null) {
      cancelAnimationFrame(frameHandle)
      frameHandle = null
    }
    orbitControls?.dispose()
    orbitControls = null
    renderer?.dispose()
    renderer = null
    runtimeScene = null
    actor = null
    actorModel = null
    currentModel = null
    modelInfo.value = null
    animations.value = []
    currentAnimation.value = null
  }

  function loadModel(model: Model): void {
    error.value = null
    isLoading.value = true

    try {
      // Dispose previous model scene
      dispose()

      const canvasEl = canvas.value
      if (!canvasEl) {
        throw new Error('Canvas element not available')
      }

      currentModel = model

      // Create actor
      const actorState: ActorState = {
        id: new ActorId(1),
        position: { x: 0, y: 0, z: 0 },
        velocity: { x: 0, y: 0, z: 0 },
        rotation: 0,
        visible: true,
        movementSpeed: 0,
      }

      const runtimeActor: RuntimeActor = {
        isDisplayEngagedOrEngaging: () => false,
        getMount: () => null,
      }

      actor = new Actor(actorState, new NoOpActorController(), () => null)
      actorModel = new ActorModel(runtimeActor, model)
      actor.actorModel = actorModel

      // Collect model info
      const meshResources = actorModel.getMeshResources()
      const skeleton = actorModel.getSkeleton()
      modelInfo.value = {
        jointCount: skeleton?.joints.length ?? 0,
        meshCount: meshResources.reduce(
          (sum, r) => sum + r.meshes.length, 0,
        ),
        textureCount: 0, // Textures are resolved lazily during render
        scale: model.getScale(),
      }

      // Collect available animations
      const animDirs = model.getAnimationDirectories()
      const animIds: string[] = []
      for (const dir of animDirs) {
        for (const subDir of dir.getSubDirectories()) {
          const id = subDir.id.id
          if (!animIds.includes(id)) {
            animIds.push(id)
          }
        }
      }
      animations.value = animIds.sort()

      // Start idle animation
      const idleAnim = findBestAnimation(animIds, 'idl')
      if (idleAnim) {
        actorModel.setSkeletonAnimation(
          new DatId(idleAnim),
          animDirs,
          LoopParams.lowPriorityLoop(),
          new TransitionParams(0, 0),
        )
        currentAnimation.value = idleAnim
      }

      actor.update(0)

      // Create runtime scene
      runtimeScene = new RuntimeScene({
        resolveActorLighting: () => ({
          lightingParams: previewLighting,
          fogParams: previewFog,
          pointLights: [],
        }),
      })

      // Create renderer
      renderer = new ThreeRenderer({ canvas: canvasEl })
      renderer.setClearColor(0.227, 0.227, 0.227) // #3a3a3a — neutral grey

      // Frame camera to model
      const skeletonHeight = skeleton?.resource.size.y ?? 1.75
      const npcScale = model.getScale()
      const effectiveHeight = skeletonHeight * npcScale
      const frame = getXiCameraFrame(effectiveHeight)

      renderer.camera.position.set(frame.position.x, frame.position.y, frame.position.z)
      const target = { x: frame.target.x, y: frame.target.y, z: frame.target.z }
      renderer.camera.lookAt(target.x, target.y, target.z)

      orbitControls = useOrbitControls({
        camera: renderer.camera,
        domElement: canvasEl,
        target,
        maxDistance: 500,
        enablePan: true,
        panSpeed: 2.0,
      })
      orbitControls.setAutoRotate(true)

      // Start render loop
      previousFrameTime = performance.now()
      const tick = (time: number): void => {
        if (!renderer || !runtimeScene || !actor) { return }

        const elapsedMs = Math.max(0, time - previousFrameTime)
        previousFrameTime = time
        const elapsedFrames = elapsedMs / (1000 / 60)

        actor.update(elapsedFrames)

        const commands = runtimeScene.buildDrawCommands([actor], {
          cameraPosition: {
            x: renderer.camera.position.x,
            y: renderer.camera.position.y,
            z: renderer.camera.position.z,
          },
          maxDistance: 2000,
          maxVisible: 1,
        })

        const state = orbitControls?.update()
        if (state) {
          orbitState.azimuth = state.azimuth
          orbitState.elevation = state.elevation
          orbitState.distance = state.distance
        }

        renderer.render(commands)
        frameHandle = requestAnimationFrame(tick)
      }

      frameHandle = requestAnimationFrame(tick)
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err)
    } finally {
      isLoading.value = false
    }
  }

  function playAnimation(animId: string): void {
    if (!actorModel || !currentModel) { return }
    actorModel.setSkeletonAnimation(
      new DatId(animId),
      currentModel.getAnimationDirectories(),
      LoopParams.lowPriorityLoop(),
      new TransitionParams(7.5, 0),
    )
    currentAnimation.value = animId
  }

  function setAutoRotate(enabled: boolean): void {
    orbitControls?.setAutoRotate(enabled)
  }

  return {
    isLoading,
    error,
    modelInfo,
    animations,
    currentAnimation,
    orbitState,
    loadModel,
    playAnimation,
    setAutoRotate,
    dispose,
  }
}

/**
 * Find the best matching animation from a list by prefix.
 * Prefers exact prefix matches (e.g., "idl0" for prefix "idl").
 */
function findBestAnimation(ids: string[], prefix: string): string | null {
  const matches = ids.filter(id => id.startsWith(prefix))
  return matches[0] ?? null
}
