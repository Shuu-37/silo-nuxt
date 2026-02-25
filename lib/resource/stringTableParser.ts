import { ByteReader } from './byteReader'

/**
 * A block of related strings (e.g., a single item/zone entry with multiple
 * localized variants or sub-entries).
 */
export interface StringTableBlock {
  readonly entries: readonly StringTableEntry[]
}

export interface StringTableEntry {
  readonly flag: number
  readonly string: string
}

/**
 * Parses the FFXI `d_msg` string table format.
 *
 * Binary layout:
 *   0x00  zero-terminated "d_msg" header
 *   0x10  unk0 (u32), fileSize (u32)
 *   0x18  tableOffset (u32), tableSize (u32)
 *   0x20  stringBlockSize (u32), stringSectionSize (u32), numStrings (u32)
 *   0x2C  unk1 (u32)
 *
 * If bitMask is non-zero, everything from tableOffset onward is XOR-decrypted.
 * If tableSize > 0, strings are addressed via an offset table.
 * Otherwise, strings are at fixed-size blocks of stringBlockSize.
 *
 * Port of Kotlin StringTableParser.
 */
export function parseStringTable(
  byteReader: ByteReader,
  bitMask: number = 0,
): readonly StringTableBlock[] {
  const start = byteReader.position

  const header = byteReader.nextZeroTerminatedString()
  if (header !== 'd_msg') {
    throw new Error(`Unexpected string table header: "${header}"`)
  }

  byteReader.position = start + 0x10
  const _unk0 = byteReader.next32()
  const fileSize = byteReader.next32()

  const tableOffset = byteReader.next32()
  const tableSize = byteReader.next32()

  const stringBlockSize = byteReader.next32()
  const _stringSectionSize = byteReader.next32()
  const numStrings = byteReader.next32()

  const _unk1 = byteReader.next32()

  // XOR-decrypt from tableOffset to end of file
  if (bitMask !== 0) {
    byteReader.position = start + tableOffset
    const decryptLength = fileSize - tableOffset
    for (let i = 0; i < decryptLength; i += 1) {
      byteReader.xorNext8(bitMask)
    }
  }

  byteReader.position = start + tableOffset
  if (tableSize === 0) {
    return parseStringsWithoutTable(byteReader, numStrings, stringBlockSize, start + tableOffset)
  }
  return parseStringsWithTable(byteReader, numStrings)
}

function parseStringsWithTable(
  byteReader: ByteReader,
  numStrings: number,
): readonly StringTableBlock[] {
  const offsets: number[] = []
  for (let i = 0; i < numStrings; i += 1) {
    offsets.push(byteReader.next32())
    byteReader.next32() // unk per entry
  }

  const stringStart = byteReader.position
  const blocks: StringTableBlock[] = []

  for (let i = 0; i < numStrings; i += 1) {
    byteReader.position = stringStart + (offsets[i] ?? 0)
    blocks.push(parseStringBlock(byteReader))
  }

  return blocks
}

function parseStringsWithoutTable(
  byteReader: ByteReader,
  numStrings: number,
  stringBlockSize: number,
  startPosition: number,
): readonly StringTableBlock[] {
  const blocks: StringTableBlock[] = []

  for (let i = 0; i < numStrings; i += 1) {
    byteReader.position = startPosition + stringBlockSize * i
    blocks.push(parseStringBlock(byteReader))
  }

  return blocks
}

function parseStringBlock(byteReader: ByteReader): StringTableBlock {
  const start = byteReader.position
  const stringsInBlock = byteReader.next32()
  const entries: StringTableEntry[] = []

  const offsets: number[] = []
  for (let i = 0; i < stringsInBlock; i += 1) {
    offsets.push(byteReader.next32())
    byteReader.next32() // unk flag per string
  }

  for (let i = 0; i < stringsInBlock; i += 1) {
    byteReader.position = start + (offsets[i] ?? 0)

    const marker = byteReader.next32()
    let string = ''

    if (marker === 1) {
      byteReader.position += 0x18
      string = byteReader.nextZeroTerminatedString()
    }

    entries.push({ flag: marker, string })
  }

  return { entries }
}

/** Get the first string from a block, or empty string if missing. */
export function firstString(block: StringTableBlock | undefined): string {
  return block?.entries[0]?.string ?? ''
}
