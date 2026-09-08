// A QR encoder, because the point of the compressor is a smaller QR code and
// a claim like that has to be measurable.
//
// It is also where the choice of alphabet pays off: a QR code has a mode for
// digits and capitals that spends 5.5 bits per character instead of 8, and
// squrl's links are written entirely inside it. The same URL uncompressed
// falls into byte mode, and pays 8 bits for every character of "https://".
//
// Model 2 symbols, versions 1 to 20, all four error correction levels. Almost
// nothing here is tabulated: the module layout is built, the codeword count is
// counted off the layout, and the only numbers taken from the standard are how
// many error correction codewords each version and level uses.

const ALNUM = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';
const ALNUM_INDEX = new Map([...ALNUM].map((c, i) => [c, i]));

export const LEVELS = { L: 0, M: 1, Q: 2, H: 3 };
const LEVEL_BITS = [0b01, 0b00, 0b11, 0b10];   // L, M, Q, H as written in the format info

/**
 * Error correction codewords per block, and how many blocks, for versions
 * 1..20 at levels L, M, Q, H.
 *
 * Everything else about a version -- total codewords, data codewords, how the
 * blocks are sized -- follows from these two numbers and the geometry, and is
 * derived below rather than copied. tools/qr-check.mjs verifies the lot
 * against a reference implementation.
 */
const BLOCKS = [
  /* v1  */ [[7, 1], [10, 1], [13, 1], [17, 1]],
  /* v2  */ [[10, 1], [16, 1], [22, 1], [28, 1]],
  /* v3  */ [[15, 1], [26, 1], [18, 2], [22, 2]],
  /* v4  */ [[20, 1], [18, 2], [26, 2], [16, 4]],
  /* v5  */ [[26, 1], [24, 2], [18, 4], [22, 4]],
  /* v6  */ [[18, 2], [16, 4], [24, 4], [28, 4]],
  /* v7  */ [[20, 2], [18, 4], [18, 6], [26, 5]],
  /* v8  */ [[24, 2], [22, 4], [22, 6], [26, 6]],
  /* v9  */ [[30, 2], [22, 5], [20, 8], [24, 8]],
  /* v10 */ [[18, 4], [26, 5], [24, 8], [28, 8]],
  /* v11 */ [[20, 4], [30, 5], [28, 8], [24, 11]],
  /* v12 */ [[24, 4], [22, 8], [26, 10], [28, 11]],
  /* v13 */ [[26, 4], [22, 9], [24, 12], [22, 16]],
  /* v14 */ [[30, 4], [24, 9], [20, 16], [24, 16]],
  /* v15 */ [[22, 6], [24, 10], [30, 12], [24, 18]],
  /* v16 */ [[24, 6], [28, 10], [24, 17], [30, 16]],
  /* v17 */ [[28, 6], [28, 11], [28, 16], [28, 19]],
  /* v18 */ [[30, 6], [26, 13], [28, 18], [28, 21]],
  /* v19 */ [[28, 7], [26, 14], [26, 21], [26, 25]],
  /* v20 */ [[28, 8], [26, 16], [30, 20], [28, 25]],
];

export const MAX_VERSION = BLOCKS.length;

const size = (version) => version * 4 + 17;

/**
 * Alignment pattern centres.
 *
 * The standard prints these as a table; they follow a rule up to version 32,
 * which is comfortably past where this encoder stops.
 */
function alignments(version) {
  if (version === 1) return [];
  const count = Math.floor(version / 7) + 2;
  const last = size(version) - 7;
  const step = Math.ceil((last - 6) / (count - 1) / 2) * 2;
  const out = [6];
  for (let i = count - 1; i > 0; i--) out.push(last - (count - 1 - i) * step);
  return out.sort((a, b) => a - b);
}

// --- the fixed patterns -----------------------------------------------------

/**
 * Lay out everything that is not data: finders, separators, timing, alignment,
 * and the reserved areas for format and version information.
 *
 * Returns the module grid (null where data goes) and a mask of which cells the
 * data may use -- counting those is how the codeword capacity is worked out.
 */
function skeleton(version) {
  const n = size(version);
  const grid = Array.from({ length: n }, () => new Array(n).fill(null));
  const reserved = Array.from({ length: n }, () => new Array(n).fill(false));

  const put = (r, c, value) => {
    if (r < 0 || c < 0 || r >= n || c >= n) return;
    grid[r][c] = value;
    reserved[r][c] = true;
  };

  // Finder patterns and their separators, in three corners.
  for (const [top, left] of [[0, 0], [0, n - 7], [n - 7, 0]]) {
    for (let r = -1; r <= 7; r++) {
      for (let c = -1; c <= 7; c++) {
        const inside = r >= 0 && r <= 6 && c >= 0 && c <= 6;
        const ring = r === 0 || r === 6 || c === 0 || c === 6;
        const core = r >= 2 && r <= 4 && c >= 2 && c <= 4;
        put(top + r, left + c, inside && (ring || core) ? 1 : 0);
      }
    }
  }

  // Timing patterns: the alternating spine between the finders.
  for (let i = 8; i < n - 8; i++) {
    put(6, i, i % 2 === 0 ? 1 : 0);
    put(i, 6, i % 2 === 0 ? 1 : 0);
  }

  // Alignment patterns, everywhere except under a finder.
  const centres = alignments(version);
  for (const r of centres) {
    for (const c of centres) {
      const nearFinder =
        (r <= 8 && c <= 8) || (r <= 8 && c >= n - 9) || (r >= n - 9 && c <= 8);
      if (nearFinder) continue;
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          const edge = Math.max(Math.abs(dr), Math.abs(dc));
          put(r + dr, c + dc, edge === 1 ? 0 : 1);
        }
      }
    }
  }

  // The dark module, and the areas format information will fill.
  put(n - 8, 8, 1);
  for (let i = 0; i < 9; i++) {
    if (!reserved[8][i]) put(8, i, 0);
    if (!reserved[i][8]) put(i, 8, 0);
  }
  for (let i = 0; i < 8; i++) {
    if (!reserved[8][n - 1 - i]) put(8, n - 1 - i, 0);
    if (!reserved[n - 1 - i][8]) put(n - 1 - i, 8, 0);
  }

  // Version information, for symbols big enough to carry it.
  if (version >= 7) {
    for (let i = 0; i < 18; i++) {
      const r = Math.floor(i / 3);
      const c = i % 3;
      put(n - 11 + c, r, 0);
      put(r, n - 11 + c, 0);
    }
  }

  return { grid, reserved, n };
}

/** Data codewords a version and level can hold, counted off the layout. */
function capacity(version, level) {
  const { reserved, n } = skeleton(version);
  let free = 0;
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (!reserved[r][c]) free++;

  const total = Math.floor(free / 8);
  const [ec, blocks] = BLOCKS[version - 1][level];
  return { total, remainder: free % 8, data: total - ec * blocks, ec, blocks };
}

// --- Galois field and Reed-Solomon -----------------------------------------

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
{
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;          // the QR field polynomial
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
}

const mul = (a, b) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);

/** Generator polynomial for `degree` error correction codewords. */
function generator(degree) {
  let poly = [1];
  for (let i = 0; i < degree; i++) {
    const next = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];
      next[j + 1] ^= mul(poly[j], EXP[i]);
    }
    poly = next;
  }
  return poly;
}

function remainderOf(data, degree) {
  const gen = generator(degree);
  const out = new Uint8Array(degree);

  for (const byte of data) {
    const factor = byte ^ out[0];
    out.copyWithin(0, 1);
    out[degree - 1] = 0;
    for (let i = 0; i < degree; i++) out[i] ^= mul(gen[i + 1], factor);
  }
  return out;
}

// --- bit stream -------------------------------------------------------------

class Bits {
  constructor() { this.bits = []; }
  push(value, count) {
    for (let i = count - 1; i >= 0; i--) this.bits.push((value >> i) & 1);
  }
  get length() { return this.bits.length; }
}

const MODE = { numeric: 0b0001, alnum: 0b0010, byte: 0b0100 };

/** The cheapest mode that can spell this string. */
export function modeFor(text) {
  if (/^[0-9]*$/.test(text)) return 'numeric';
  if ([...text].every((c) => ALNUM_INDEX.has(c))) return 'alnum';
  return 'byte';
}

function countBits(mode, version) {
  if (mode === 'numeric') return version <= 9 ? 10 : version <= 26 ? 12 : 14;
  if (mode === 'alnum') return version <= 9 ? 9 : version <= 26 ? 11 : 13;
  return version <= 9 ? 8 : 16;
}

function encodeData(text, mode, version) {
  const bits = new Bits();
  const bytes = new TextEncoder().encode(text);
  const count = mode === 'byte' ? bytes.length : text.length;

  bits.push(MODE[mode], 4);
  bits.push(count, countBits(mode, version));

  if (mode === 'numeric') {
    for (let i = 0; i < text.length; i += 3) {
      const group = text.slice(i, i + 3);
      bits.push(Number(group), group.length * 3 + 1);
    }
  } else if (mode === 'alnum') {
    for (let i = 0; i < text.length; i += 2) {
      const a = ALNUM_INDEX.get(text[i]);
      if (i + 1 < text.length) bits.push(a * 45 + ALNUM_INDEX.get(text[i + 1]), 11);
      else bits.push(a, 6);
    }
  } else {
    for (const byte of bytes) bits.push(byte, 8);
  }
  return bits;
}

// --- placement and masking --------------------------------------------------

/** Walk the data area: two columns at a time, upwards then downwards. */
function* placement(n, reserved) {
  let up = true;
  for (let right = n - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;                 // the timing column is skipped
    for (let step = 0; step < n; step++) {
      const row = up ? n - 1 - step : step;
      for (const col of [right, right - 1]) {
        if (!reserved[row][col]) yield [row, col];
      }
    }
    up = !up;
  }
}

const MASKS = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (_r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

/** The standard's four penalty rules, which pick the mask that scans best. */
function penalty(grid) {
  const n = grid.length;
  let score = 0;

  const runScore = (run) => (run >= 5 ? 3 + (run - 5) : 0);

  for (let i = 0; i < n; i++) {
    for (const horizontal of [true, false]) {
      let run = 1;
      for (let j = 1; j < n; j++) {
        const cur = horizontal ? grid[i][j] : grid[j][i];
        const prev = horizontal ? grid[i][j - 1] : grid[j - 1][i];
        if (cur === prev) run++;
        else { score += runScore(run); run = 1; }
      }
      score += runScore(run);
    }
  }

  for (let r = 0; r < n - 1; r++) {
    for (let c = 0; c < n - 1; c++) {
      const v = grid[r][c];
      if (v === grid[r][c + 1] && v === grid[r + 1][c] && v === grid[r + 1][c + 1]) score += 3;
    }
  }

  // The finder-like sequence, in both directions, with quiet space either side.
  const PATTERN = [1, 0, 1, 1, 1, 0, 1];
  const matches = (line, at) => {
    for (let i = 0; i < 7; i++) if (line[at + i] !== PATTERN[i]) return false;
    const before = line.slice(Math.max(0, at - 4), at);
    const after = line.slice(at + 7, at + 11);
    const clear = (part) => part.length >= 4 && part.every((v) => v === 0);
    return clear(before) || clear(after);
  };

  for (let i = 0; i < n; i++) {
    const row = grid[i];
    const col = grid.map((line) => line[i]);
    for (let j = 0; j + 7 <= n; j++) {
      if (matches(row, j)) score += 40;
      if (matches(col, j)) score += 40;
    }
  }

  let dark = 0;
  for (const row of grid) for (const cell of row) dark += cell;
  const percent = (dark * 100) / (n * n);
  score += Math.floor(Math.abs(percent - 50) / 5) * 10;

  return score;
}

function formatBits(level, mask) {
  const data = (LEVEL_BITS[level] << 3) | mask;
  let value = data << 10;
  for (let i = 14; i >= 10; i--) {
    if ((value >> i) & 1) value ^= 0b10100110111 << (i - 10);
  }
  return ((data << 10) | value) ^ 0b101010000010010;
}

/**
 * Version information: six bits of version number and twelve of BCH(18,6),
 * over the degree-12 generator the standard specifies. Unlike the format bits,
 * these are not masked.
 */
function versionBits(version) {
  let value = version << 12;
  for (let i = 17; i >= 12; i--) {
    if ((value >> i) & 1) value ^= 0b1111100100101 << (i - 12);
  }
  return (version << 12) | (value & 0xfff);
}

// --- the encoder ------------------------------------------------------------

/**
 * Build a QR symbol.
 *
 * @param {string} text
 * @param {object} [options]
 * @param {'L'|'M'|'Q'|'H'} [options.level='L']
 * @param {number} [options.version]   force a version instead of the smallest
 * @param {number} [options.mask]      force a mask instead of the best scoring
 * @returns {{matrix: number[][], version: number, level: string, mode: string,
 *            size: number, mask: number}}
 */
export function encode(text, { level = 'L', version = null, mask = null } = {}) {
  const levelIndex = LEVELS[level];
  if (levelIndex === undefined) throw new Error(`unknown error correction level: ${level}`);

  const mode = modeFor(text);
  const byteLength = new TextEncoder().encode(text).length;

  let chosen = version;
  if (chosen === null) {
    for (let v = 1; v <= MAX_VERSION; v++) {
      const bits = 4 + countBits(mode, v) +
        (mode === 'numeric' ? Math.ceil((text.length * 10) / 3)
          : mode === 'alnum' ? Math.ceil((text.length * 11) / 2)
          : byteLength * 8);
      if (bits <= capacity(v, levelIndex).data * 8) { chosen = v; break; }
    }
    if (chosen === null) throw new Error(`${text.length} characters is more than version ${MAX_VERSION} holds at level ${level}`);
  }

  const { data: dataCodewords, ec, blocks, remainder } = capacity(chosen, levelIndex);
  const stream = encodeData(text, mode, chosen);
  if (stream.length > dataCodewords * 8) {
    throw new Error(`data does not fit version ${chosen} at level ${level}`);
  }

  // Terminator, then padding to a whole codeword, then the standard filler.
  const bits = stream.bits;
  for (let i = 0; i < 4 && bits.length < dataCodewords * 8; i++) bits.push(0);
  while (bits.length % 8) bits.push(0);

  const codewords = [];
  for (let i = 0; i < bits.length; i += 8) {
    codewords.push(bits.slice(i, i + 8).reduce((acc, bit) => (acc << 1) | bit, 0));
  }
  for (let i = 0; codewords.length < dataCodewords; i++) codewords.push(i % 2 ? 0x11 : 0xec);

  // Blocks: the shorter ones first, which is the split the standard describes
  // as two groups.
  const short = Math.floor(dataCodewords / blocks);
  const longCount = dataCodewords % blocks;
  const dataBlocks = [];
  const ecBlocks = [];
  let at = 0;
  for (let b = 0; b < blocks; b++) {
    const length = short + (b >= blocks - longCount ? 1 : 0);
    const block = codewords.slice(at, at + length);
    at += length;
    dataBlocks.push(block);
    ecBlocks.push(remainderOf(block, ec));
  }

  // Interleave, so a scratch across the symbol damages every block a little
  // rather than one block fatally.
  const payload = [];
  for (let i = 0; i < short + 1; i++) {
    for (const block of dataBlocks) if (i < block.length) payload.push(block[i]);
  }
  for (let i = 0; i < ec; i++) for (const block of ecBlocks) payload.push(block[i]);

  const { grid, reserved, n } = skeleton(chosen);

  const cells = placement(n, reserved);
  let bitIndex = 0;
  for (const [r, c] of cells) {
    const byte = payload[bitIndex >> 3];
    grid[r][c] = bitIndex < payload.length * 8 ? (byte >> (7 - (bitIndex % 8))) & 1 : 0;
    bitIndex++;
  }
  void remainder;   // the leftover modules are already zero-filled above

  // Mask selection: apply each candidate to a copy and keep the best score.
  let bestMask = mask;
  let best = null;
  for (let candidate = 0; candidate < 8; candidate++) {
    if (mask !== null && candidate !== mask) continue;
    const masked = grid.map((row) => row.slice());
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (!reserved[r][c] && MASKS[candidate](r, c)) masked[r][c] ^= 1;
      }
    }
    writeFormat(masked, n, levelIndex, candidate);
    if (chosen >= 7) writeVersion(masked, n, chosen);

    const score = penalty(masked);
    if (best === null || score < best.score) best = { score, matrix: masked };
    if (best.matrix === masked) bestMask = candidate;
  }

  return {
    matrix: best.matrix,
    version: chosen,
    level,
    mode,
    mask: bestMask,
    penalty: best.score,
    size: n,
  };
}

/**
 * Write the fifteen format bits, twice.
 *
 * Most significant bit first, and the two copies are split differently: the
 * one by the top-left finder runs along row 8 and then up column 8, while the
 * other puts seven bits up the left column and eight along the top row --
 * because the module at (n-8, 8) is not a format bit at all. It is the "dark
 * module", which is always set, and writing a format bit over it is the
 * classic way to produce a QR code that looks right and scans as nothing.
 */
function writeFormat(grid, n, level, mask) {
  const bits = formatBits(level, mask);
  const at = (k) => (bits >> (14 - k)) & 1;

  const first = [
    [8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8],
    [7, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8],
  ];
  first.forEach(([r, c], k) => { grid[r][c] = at(k); });

  for (let k = 0; k < 7; k++) grid[n - 1 - k][8] = at(k);
  for (let k = 7; k < 15; k++) grid[8][n - 15 + k] = at(k);

  grid[n - 8][8] = 1;
}

function writeVersion(grid, n, version) {
  const bits = versionBits(version);
  for (let i = 0; i < 18; i++) {
    const bit = (bits >> i) & 1;
    const r = Math.floor(i / 3);
    const c = i % 3;
    grid[n - 11 + c][r] = bit;
    grid[r][n - 11 + c] = bit;
  }
}

// --- output -----------------------------------------------------------------

/** Total dark and light modules, the honest measure of "how big is this QR". */
export const moduleCount = (symbol) => symbol.size * symbol.size;

/** Render as SVG. */
export function toSvg(symbol, { scale = 8, quiet = 4, dark = '#000', light = '#fff' } = {}) {
  const n = symbol.size;
  const span = (n + quiet * 2) * scale;

  let path = '';
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (symbol.matrix[r][c]) {
        path += `M${(c + quiet) * scale} ${(r + quiet) * scale}h${scale}v${scale}h-${scale}z`;
      }
    }
  }

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${span}" height="${span}" ` +
    `viewBox="0 0 ${span} ${span}" shape-rendering="crispEdges" role="img" ` +
    `aria-label="QR code, version ${symbol.version}, ${n} by ${n} modules">` +
    `<rect width="${span}" height="${span}" fill="${light}"/>` +
    `<path fill="${dark}" d="${path}"/></svg>`
  );
}

/**
 * Render for a terminal, two module rows per line of text.
 *
 * Half blocks keep the aspect ratio square, which matters: a QR stretched to
 * twice its height is a QR that phones refuse to read.
 */
export function toText(symbol, { quiet = 2, invert = false } = {}) {
  const n = symbol.size;
  const at = (r, c) => {
    if (r < 0 || c < 0 || r >= n || c >= n) return 0;
    return symbol.matrix[r][c];
  };

  const lines = [];
  for (let r = -quiet; r < n + quiet; r += 2) {
    let line = '';
    for (let c = -quiet; c < n + quiet; c++) {
      const top = at(r, c) ^ (invert ? 1 : 0);
      const bottom = at(r + 1, c) ^ (invert ? 1 : 0);
      line += top && bottom ? '█' : top ? '▀' : bottom ? '▄' : ' ';
    }
    lines.push(line);
  }
  return lines.join('\n');
}

export { capacity, alignments, BLOCKS };
