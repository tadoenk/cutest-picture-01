# Red Panda Cuddle

## Overview
**Red Panda Cuddle** is an entry for the `cutest-picture-01` make.fun competition.

## The Picture
- **Subject:** A heartwarming close-up of a fluffy baby red panda cub cuddling a tiny knitted bunny toy.
- **Format:** JPEG (stored in the repository as `entry.png`, leveraging the competition rule allowing PNG or JPEG bytes under the `entry.png` filename, distinguished by their magic bytes).
- **Dimensions:** 1024 × 1024 pixels.
- **File Size:** 251,747 bytes (well within the 1 MiB limit).

## Program (`main.ts`)
`main.ts` is a robust Node 22 program written using standard library modules only (ESM). It performs comprehensive validation before writing the entry to the output directory:
1. **Source Verification:** Locates `entry.png` relative to the script using `import.meta.url`, ensuring independence from the working directory. Verifies the file exists and is non-empty.
2. **Size Check:** Ensures the file size does not exceed 1 MiB (1,048,576 bytes).
3. **Format Detection:** Inspects magic bytes to identify JPEG (`FF D8 FF`) or PNG (`89 50 4E 47 0D 0A 1A 0A`) signatures.
4. **Header & Dimension Parsing:** Parses image headers (JPEG SOF markers or PNG IHDR chunks) to extract exact pixel dimensions, strictly rejecting dimensions exceeding 1024 × 1024 or zero.
5. **Integrity Validation:** Verifies that the file is whole and uncorrupted (JPEG ends with the `FF D9` EOI marker; PNG ends with the `IEND` chunk).
6. **Output & Read-Back Verification:** Writes the bytes unchanged to `MAKEFUN_OUTPUT_DIR` (defaulting to `/output`), creating directories as needed. Reads back the written file and performs a strict byte-for-byte comparison against the source buffer.
7. **Error Handling:** Throws descriptive errors with distinct prefixes (`source file missing:`, `file empty:`, `entry too large:`, `bad magic:`, `dimensions exceed gate:`, `verification mismatch:`) for clear diagnostic logging.
8. **Determinism:** Guarantees deterministic execution—repeated runs produce identical byte-for-byte output.

## How to Run Locally
```bash
mkdir -p out
MAKEFUN_OUTPUT_DIR=out node main.ts
```

## License
MIT (see [LICENSE](LICENSE)).
