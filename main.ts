import {readFileSync, writeFileSync, mkdirSync, existsSync, statSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

// CRC-32 table (IEEE 802.3 polynomial 0xEDB88320)
const crcTable = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let j = 0; j < 8; j++) {
    c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
  }
  crcTable[i] = c;
}

function calculateCrc32(buf: Buffer): number {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc = crcTable[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const sourcePath = join(__dirname, 'entry.png');

if (!existsSync(sourcePath)) {
  throw new Error(`source file missing: ${sourcePath}`);
}

const stats = statSync(sourcePath);
if (stats.size === 0) {
  throw new Error(`file empty: ${sourcePath}`);
}

if (stats.size > 1048576) {
  throw new Error(`entry too large: size ${stats.size} bytes exceeds maximum of 1048576 bytes`);
}

const buffer = readFileSync(sourcePath);

if (buffer.length === 0) {
  throw new Error(`file empty: ${sourcePath}`);
}

if (buffer.length > 1048576) {
  throw new Error(`entry too large: size ${buffer.length} bytes exceeds maximum of 1048576 bytes`);
}

// Detect format from magic bytes
let format = '';
let width = 0;
let height = 0;

const isPng = buffer.length >= 8 &&
  buffer[0] === 0x89 &&
  buffer[1] === 0x50 &&
  buffer[2] === 0x4E &&
  buffer[3] === 0x47 &&
  buffer[4] === 0x0D &&
  buffer[5] === 0x0A &&
  buffer[6] === 0x1A &&
  buffer[7] === 0x0A;

const isJpeg = buffer.length >= 3 &&
  buffer[0] === 0xFF &&
  buffer[1] === 0xD8 &&
  buffer[2] === 0xFF;

if (isPng) {
  format = 'PNG';
  
  // Verify first chunk is IHDR and length is 13
  if (buffer.length < 33) {
    throw new Error('bad png: truncated before IHDR chunk');
  }
  const chunkLength = buffer.readUInt32BE(8);
  if (chunkLength !== 13) {
    throw new Error(`bad png: first chunk length is ${chunkLength}, expected 13`);
  }
  const chunkType = buffer.toString('ascii', 12, 16);
  if (chunkType !== 'IHDR') {
    throw new Error(`bad png: first chunk type is '${chunkType}', expected 'IHDR'`);
  }

  width = buffer.readUInt32BE(16);
  height = buffer.readUInt32BE(20);

  // Check whole file and verify chunk CRCs: final chunk must be IEND
  let offset = 8;
  let foundIend = false;
  while (offset < buffer.length) {
    if (offset + 12 > buffer.length) {
      throw new Error('truncated png: unexpected end of file while reading chunks');
    }
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);

    if (offset + 12 + length > buffer.length) {
      throw new Error(`truncated png: chunk ${type} exceeds file length`);
    }

    // Verify CRC: computed over chunk type bytes + chunk data bytes
    const typeAndData = buffer.subarray(offset + 4, offset + 8 + length);
    const expectedCrc = calculateCrc32(typeAndData);
    const actualCrc = buffer.readUInt32BE(offset + 8 + length);
    if (expectedCrc !== actualCrc) {
      throw new Error(`bad png: CRC mismatch in chunk ${type}`);
    }

    if (type === 'IEND') {
      foundIend = true;
      if (offset + 12 + length !== buffer.length) {
        throw new Error('bad png: extra data after IEND chunk');
      }
      break;
    }
    offset += 12 + length;
  }
  if (!foundIend) {
    throw new Error('truncated png: missing IEND chunk');
  }

} else if (isJpeg) {
  format = 'JPEG';

  // Walk marker segments from byte 2
  let offset = 2;
  let foundSof = false;
  let foundSos = false;

  while (offset < buffer.length) {
    if (buffer[offset] !== 0xFF) {
      throw new Error(`bad jpeg: expected marker 0xFF at offset ${offset}, found 0x${buffer[offset].toString(16)}`);
    }

    // Skip padding 0xFF bytes
    while (offset < buffer.length && buffer[offset] === 0xFF) {
      offset++;
    }

    if (offset >= buffer.length) {
      throw new Error('truncated jpeg: reached end of file while reading marker');
    }

    const marker = buffer[offset];
    offset++;

    // Markers without length
    // 0xD8 (SOI), 0xD9 (EOI), 0x01 (TEM), 0xD0-0xD7 (RST0-RST7)
    if (marker === 0xD8 || marker === 0xD9 || marker === 0x01 || (marker >= 0xD0 && marker <= 0xD7)) {
      if (marker === 0xD9) {
        break; // EOI
      }
      continue;
    }

    // Read segment length (includes length bytes themselves, 2 bytes big endian)
    if (offset + 2 > buffer.length) {
      throw new Error(`truncated jpeg: missing segment length for marker 0x${marker.toString(16)}`);
    }
    const segLength = buffer.readUInt16BE(offset);
    if (segLength < 2) {
      throw new Error(`bad jpeg: invalid segment length ${segLength} at offset ${offset}`);
    }

    // Check Start Of Frame (SOF0 - SOF15, excluding SOF4 (0xC4), SOF8 (0xC8), SOF12 (0xCC))
    // SOF range: 0xC0 to 0xCF
    if (marker >= 0xC0 && marker <= 0xCF && marker !== 0xC4 && marker !== 0xC8 && marker !== 0xCC) {
      if (offset + segLength > buffer.length) {
        throw new Error(`truncated jpeg: SOF segment exceeds file length`);
      }
      if (segLength < 7) {
        throw new Error(`bad jpeg: SOF segment length ${segLength} too short`);
      }
      height = buffer.readUInt16BE(offset + 3);
      width = buffer.readUInt16BE(offset + 5);
      foundSof = true;
    }

    if (marker === 0xDA) {
      // Start Of Scan (SOS)
      foundSos = true;
      break;
    }

    offset += segLength;
  }

  if (!foundSof) {
    throw new Error('bad jpeg: missing Start Of Frame (SOF) marker');
  }

  if (!foundSos) {
    throw new Error('bad jpeg: missing Start Of Scan (SOS) marker');
  }

  // Verify JPEG ends with EOI (FF D9)
  if (buffer.length < 2 || buffer[buffer.length - 2] !== 0xFF || buffer[buffer.length - 1] !== 0xD9) {
    throw new Error('truncated jpeg: file does not end with EOI marker (FF D9)');
  }

} else {
  const firstBytes = Array.from(buffer.subarray(0, Math.min(8, buffer.length)))
    .map(b => b.toString(16).padStart(2, '0'))
    .join(' ');
  throw new Error(`bad magic: unrecognized signature [${firstBytes}]`);
}

// Check dimensions
if (width === 0 || height === 0) {
  throw new Error(`dimensions exceed gate: width (${width}) or height (${height}) cannot be zero`);
}

if (width > 1024 || height > 1024) {
  throw new Error(`dimensions exceed gate: ${width}x${height} exceeds maximum of 1024x1024`);
}

const outputDir = process.env.MAKEFUN_OUTPUT_DIR || '/output';
mkdirSync(outputDir, { recursive: true });

const outputPath = join(outputDir, 'entry.png');
writeFileSync(outputPath, buffer);

// Read written file back and compare byte-for-byte
const writtenBuffer = readFileSync(outputPath);
if (writtenBuffer.length !== buffer.length) {
  throw new Error(`verification mismatch: written file length ${writtenBuffer.length} does not match source length ${buffer.length}`);
}

for (let i = 0; i < buffer.length; i++) {
  if (buffer[i] !== writtenBuffer[i]) {
    throw new Error(`verification mismatch: byte mismatch at index ${i}`);
  }
}

console.log(`${format}, ${width}x${height}, ${buffer.length} bytes, ${outputPath}`);
