import { StringTable } from './stringTable'
import type { LoadableResource } from './loadableResource'

/** Zone name string table at ROM/165/84.DAT, XOR-masked with 0xFF. */
export class ZoneNameTable implements LoadableResource {
  private readonly stringTable: StringTable

  constructor(loadFile: (path: string) => Promise<Uint8Array>) {
    this.stringTable = new StringTable('ROM/165/84.DAT', loadFile, 0xFF)
  }

  async preload(): Promise<void> {
    return this.stringTable.preload()
  }

  isFullyLoaded(): boolean {
    return this.stringTable.isFullyLoaded()
  }

  /** Get the zone name for a given zone ID. */
  getZoneName(zoneId: number): string {
    return this.stringTable.first(zoneId)
  }

  /** Get all zone names (indexed by zone ID). */
  getAllZoneNames(): readonly string[] {
    return this.stringTable.getAllFirst()
  }
}
