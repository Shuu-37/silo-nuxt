import { ByteReader } from '../byteReader'
import { parseStringTable, firstString, type StringTableBlock } from '../stringTableParser'
import type { LoadableResource } from './loadableResource'

/**
 * A lazily-loaded string table backed by a FFXI d_msg DAT file.
 * Wraps the StringTableParser with async loading and caching.
 */
export class StringTable implements LoadableResource {
  private readonly resourcePath: string
  private readonly bitMask: number
  private readonly loadFile: (path: string) => Promise<Uint8Array>

  private blocks: readonly StringTableBlock[] | null = null
  private preloaded = false
  private loadPromise: Promise<void> | null = null

  constructor(
    resourcePath: string,
    loadFile: (path: string) => Promise<Uint8Array>,
    bitMask: number = 0,
  ) {
    this.resourcePath = resourcePath
    this.loadFile = loadFile
    this.bitMask = bitMask
  }

  async preload(): Promise<void> {
    if (this.blocks !== null) { return }
    if (this.loadPromise !== null) { return this.loadPromise }

    this.preloaded = true
    this.loadPromise = this.doLoad()
    return this.loadPromise
  }

  isFullyLoaded(): boolean {
    return this.blocks !== null
  }

  /** Get all string blocks. */
  getAll(): readonly StringTableBlock[] {
    return this.blocks ?? []
  }

  /** Get the first string from each block. */
  getAllFirst(): readonly string[] {
    return this.getAll().map(block => firstString(block))
  }

  /** Get the first string for a given ID. */
  first(id: number): string {
    return firstString(this.blocks?.[id])
  }

  /** Get a block by index. */
  get(id: number): StringTableBlock | undefined {
    return this.blocks?.[id]
  }

  private async doLoad(): Promise<void> {
    const bytes = await this.loadFile(this.resourcePath)
    const byteReader = new ByteReader(bytes)
    this.blocks = parseStringTable(byteReader, this.bitMask)
  }
}
