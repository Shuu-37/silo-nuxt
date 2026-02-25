/**
 * Minimal parser for section type 0x05 (ParticleGenerator / EffectResource).
 *
 * Extracts only the data needed for static point light snapshots:
 * - Whether the generator is a point light (linkedDataType == 0x47)
 * - Whether it auto-runs on zone load
 * - Initial position, color, range, and attenuation parameters
 *
 * The full particle simulation system is NOT implemented; this provides
 * time-zero snapshots of point light values from the generator definition.
 *
 * Ported from xim/resource/ParticleGeneratorParser.kt (minimal subset).
 */

import { ByteReader } from './byteReader'
import { DatId, DatResource } from './datResource'
import type { SectionHeader } from './datParser'
import { ParserResult, type ResourceParser } from './datParser'

// ─── Data Types ──────────────────────────────────────────────────────────────

/** LinkedDataType.PointLight from Kotlin's ParticleGeneratorSettings.kt */
const LINKED_DATA_TYPE_POINT_LIGHT = 0x47

/** Initial parameters for a point light particle, from opcode 0x58. */
export interface PointLightInitParams {
  readonly range: number
  readonly theta: number
  readonly rangeMultiplier: number
  readonly thetaMultiplier: number
}

/** Initial color for a particle, from opcode 0x16. */
export interface ParticleColor {
  readonly r: number
  readonly g: number
  readonly b: number
  readonly a: number
}

/**
 * Static snapshot of a point light extracted from a particle generator.
 * Represents time-zero values without animation.
 */
export interface StaticPointLight {
  readonly position: { readonly x: number; readonly y: number; readonly z: number }
  readonly color: ParticleColor
  readonly range: number
  readonly attenuationQuad: number
}

/**
 * Minimal representation of a parsed particle generator effect.
 * Only populated with fields relevant to point light extraction.
 */
export class EffectResource extends DatResource {
  readonly id: DatId
  readonly isPointLight: boolean
  readonly autoRun: boolean
  readonly staticPointLight: StaticPointLight | null

  constructor(
    id: DatId,
    isPointLight: boolean,
    autoRun: boolean,
    staticPointLight: StaticPointLight | null,
  ) {
    super()
    this.id = id
    this.isPointLight = isPointLight
    this.autoRun = autoRun
    this.staticPointLight = staticPointLight
  }
}

// ─── Parser ──────────────────────────────────────────────────────────────────

export class EffectSection implements ResourceParser {
  private readonly header: SectionHeader

  constructor(header: SectionHeader) {
    this.header = header
  }

  getResource(byteReader: ByteReader): ParserResult {
    const datId = this.header.sectionId

    // Read autoRun flag at offset 0x79 from section start
    byteReader.offsetFrom(this.header, 0x79)
    const genFlags = byteReader.next8()
    const autoRun = (genFlags & 0x10) !== 0

    // Read section offsets from 0x80
    byteReader.offsetFrom(this.header, 0x80)
    byteReader.next32() // section1Offset (generator updaters) - skip
    const section2Offset = byteReader.next32() // particle initializers

    // Parse section 2 (particle initializers) to find point light data
    byteReader.offsetFrom(this.header, section2Offset)
    const initData = parseParticleInitializers(byteReader, this.header)

    const isPointLight = initData.linkedDataType === LINKED_DATA_TYPE_POINT_LIGHT

    let staticPointLight: StaticPointLight | null = null
    if (isPointLight && initData.pointLightParams) {
      const plp = initData.pointLightParams
      const finalRange = plp.range * plp.rangeMultiplier
      const finalAtten = (plp.theta * plp.thetaMultiplier) > 0
        ? 1.0 / (plp.theta * plp.thetaMultiplier)
        : 0

      // Color is doubled (matches Kotlin's color.withMultiplied(2f))
      const color = initData.color
      staticPointLight = {
        position: initData.basePosition,
        color: {
          r: Math.min(1, color.r * 2),
          g: Math.min(1, color.g * 2),
          b: Math.min(1, color.b * 2),
          a: Math.min(1, color.a * 2),
        },
        range: finalRange,
        attenuationQuad: finalAtten,
      }
    }

    const resource = new EffectResource(datId, isPointLight, autoRun, staticPointLight)
    return ParserResult.from(resource)
  }
}

// ─── Section 2 Parser (Particle Initializers) ────────────────────────────────

interface InitializerData {
  linkedDataType: number
  basePosition: { x: number; y: number; z: number }
  color: ParticleColor
  pointLightParams: PointLightInitParams | null
}

/**
 * Parse opcode-driven particle initializers (section 2).
 * We only extract the opcodes relevant to point light extraction.
 */
function parseParticleInitializers(byteReader: ByteReader, header: SectionHeader): InitializerData {
  const result: InitializerData = {
    linkedDataType: -1,
    basePosition: { x: 0, y: 0, z: 0 },
    color: { r: 1, g: 1, b: 1, a: 1 },
    pointLightParams: null,
  }

  const sectionEnd = header.sectionStartPosition + header.sectionSize

  // Parse opcodes until 0x00 (end) or we exceed the section bounds
  for (let safety = 0; safety < 256; safety++) {
    if (byteReader.position >= sectionEnd) break

    const opcode = byteReader.next8()
    if (opcode === 0x00) break

    const size = byteReader.next8()
    const dataStart = byteReader.position

    switch (opcode) {
      case 0x01: // StandardParticleSetup - contains linkedDataType and basePosition
        parseStandardSetup(byteReader, result)
        break

      case 0x16: // ColorSetup - initial RGBA color
        parseColorSetup(byteReader, result)
        break

      case 0x58: // PointLightParamsInitializer
        parsePointLightParams(byteReader, result)
        break
    }

    // Skip to next opcode (size is in 4-byte units, starting after the 2-byte header)
    byteReader.position = dataStart + (size * 4)
  }

  return result
}

/**
 * Opcode 0x01: StandardParticleSetup.
 * Extracts linkedDataType and basePosition.
 */
function parseStandardSetup(byteReader: ByteReader, data: InitializerData): void {
  // Skip billboard flags and render state (24 bytes to linkedDataId)
  const startPos = byteReader.position
  byteReader.position = startPos + 0x04 // skip billboard flags (2 bytes) + 2 bytes

  // Skip to linked data ID at offset +0x14 from opcode data start
  byteReader.position = startPos + 0x14
  byteReader.next32() // linkedDataId (DatId) - skip

  // basePosition at +0x18
  data.basePosition = byteReader.nextVector3f()

  // dynamicallyAllocatedSize (1 byte), then linkedDataType (1 byte)
  byteReader.position = startPos + 0x24
  byteReader.next8() // dynamically allocated size
  data.linkedDataType = byteReader.next8()
}

/**
 * Opcode 0x16: ColorSetup.
 * Reads initial RGBA color (4 bytes, each 0-255 normalized to 0-1).
 */
function parseColorSetup(byteReader: ByteReader, data: InitializerData): void {
  data.color = {
    r: byteReader.next8() / 255,
    g: byteReader.next8() / 255,
    b: byteReader.next8() / 255,
    a: byteReader.next8() / 255,
  }
}

/**
 * Opcode 0x58: PointLightParamsInitializer.
 * Reads range, theta, rangeMultiplier, thetaMultiplier.
 */
function parsePointLightParams(byteReader: ByteReader, data: InitializerData): void {
  const range = byteReader.nextFloat()
  const theta = byteReader.nextFloat()
  const rawRangeMultiplier = byteReader.nextFloat()
  const rawThetaMultiplier = byteReader.nextFloat()

  data.pointLightParams = {
    range,
    theta,
    rangeMultiplier: mapMultiplier(rawRangeMultiplier),
    thetaMultiplier: mapMultiplier(rawThetaMultiplier),
  }
}

/**
 * Transform raw multiplier value from the DAT file.
 * Matches Kotlin's PointLightParamsInitializer.mapMultiplier().
 */
function mapMultiplier(base: number): number {
  if (base >= 0) return Math.pow(2, base)
  if (base >= -1) return 1 + base
  return 0
}
