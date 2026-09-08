// A binary range coder, and the adaptive bit models that feed it.
//
// Everything squrl writes -- a flag, a dictionary index, a character -- is
// spelled as a sequence of binary decisions, and each decision is priced by a
// model that says how likely the 1 was. A decision the model expected costs a
// fraction of a bit; a surprising one costs several. That is the whole trick:
// "https" is not stored, it is *predicted*, and the correction costs 0.07 bits.
//
// The coder is the carryless kind (two bounds, renormalise when their top
// bytes agree), which avoids the carry propagation that makes textbook
// arithmetic coders subtly wrong.

const TOP = 0x1000000;          // 2^24 -- one byte below the 32-bit bounds
const LIMIT = 0x100000000;      // 2^32

// Probabilities are 12-bit: 1..4095 as P(bit = 1) * 4096.
export const ONE = 4096;
const RATE = 5;                 // adaptation speed, in halvings

/**
 * Adaptive probability table.
 *
 * Each slot is one context: "the third bit of a host index", "a path
 * character after a dot". Slots start at whatever the trained prior says and
 * keep moving while a URL is coded, so repetition inside one URL is cheap too.
 */
export class Models {
  constructor(prior) {
    this.p = prior ? Uint16Array.from(prior) : null;
    this.size = prior ? prior.length : 0;
  }

  static uniform(size) {
    const m = new Models(null);
    m.p = new Uint16Array(size).fill(ONE / 2);
    m.size = size;
    return m;
  }

  clone() {
    const m = new Models(null);
    m.p = Uint16Array.from(this.p);
    m.size = this.size;
    return m;
  }

  get(i) { return this.p[i]; }

  update(i, bit) {
    const p = this.p[i];
    // Move a fixed fraction of the way towards the observed outcome, and never
    // reach 0 or 1: a model that is certain cannot be corrected.
    const next = bit ? p + ((ONE - p) >> RATE) : p - (p >> RATE);
    this.p[i] = next < 1 ? 1 : next > ONE - 1 ? ONE - 1 : next;
  }
}

/** Encoder. Writes bits; hands back bytes. */
export class Encoder {
  constructor(models) {
    this.m = models;
    this.low = 0;
    this.high = 0xFFFFFFFF;
    this.bytes = [];

    // Bit accounting: the exact cost of every decision, in bits. The running
    // total is what lets the encoder try a piece three ways and keep the
    // cheapest; the per-field breakdown is what `squrl explain` prints.
    this.total = 0;
    this.cost = new Map();
    this.field = null;
  }

  open(field) { this.field = field; }

  charge(bits) {
    this.total += bits;
    if (this.field === null) return;
    this.cost.set(this.field, (this.cost.get(this.field) ?? 0) + bits);
  }

  bit(slot, bit) {
    const p = this.m.get(slot);
    // Split the interval in proportion to the model's belief. Plain arithmetic,
    // not bit shifts: these values exceed what JavaScript's bitwise operators
    // can represent, and silently truncating them is how a coder desynchronises.
    const mid = this.low + Math.floor(((this.high - this.low) * p) / ONE);

    if (bit) this.high = mid;
    else this.low = mid + 1;

    this.charge(-Math.log2((bit ? p : ONE - p) / ONE));
    this.m.update(slot, bit);

    while (Math.floor(this.low / TOP) === Math.floor(this.high / TOP)) {
      this.bytes.push(Math.floor(this.low / TOP));
      this.low = (this.low % TOP) * 256;
      this.high = (this.high % TOP) * 256 + 255;
    }
  }

  /**
   * Close the stream with as few bytes as the interval allows.
   *
   * Any value inside [low, high] decodes the same, so pick the one with the
   * most trailing zero bytes and write only what comes before them -- the
   * decoder treats everything past the end as zero. Textbook flushes write
   * four bytes; on a twelve-byte payload that would be a third of the file.
   */
  finish() {
    for (let keep = 0; keep <= 4; keep++) {
      const step = LIMIT / 256 ** keep;
      const candidate = Math.ceil(this.low / step) * step;
      if (candidate <= this.high) {
        for (let i = 0; i < keep; i++) {
          this.bytes.push(Math.floor(candidate / 256 ** (3 - i)) % 256);
        }
        return Uint8Array.from(this.bytes);
      }
    }
    /* c8 ignore next */
    throw new Error('unreachable: [low, high] always contains a multiple of 1');
  }
}

/** Decoder. Reads the same decisions back, in the same order. */
export class Decoder {
  constructor(models, bytes) {
    this.m = models;
    this.data = bytes;
    this.at = 0;
    this.low = 0;
    this.high = 0xFFFFFFFF;
    this.x = 0;
    for (let i = 0; i < 4; i++) this.x = this.x * 256 + this.next();
  }

  next() {
    // Past the end of the payload the stream is zeroes, which is what lets the
    // encoder stop writing early.
    return this.at < this.data.length ? this.data[this.at++] : 0;
  }

  bit(slot) {
    const p = this.m.get(slot);
    const mid = this.low + Math.floor(((this.high - this.low) * p) / ONE);
    const bit = this.x <= mid ? 1 : 0;

    if (bit) this.high = mid;
    else this.low = mid + 1;

    this.m.update(slot, bit);

    while (Math.floor(this.low / TOP) === Math.floor(this.high / TOP)) {
      this.low = (this.low % TOP) * 256;
      this.high = (this.high % TOP) * 256 + 255;
      this.x = (this.x % TOP) * 256 + this.next();
    }
    return bit;
  }
}

// --- symbol helpers ---------------------------------------------------------
//
// Both sides call these in lockstep; the encoder writes what the decoder is
// about to ask for. They are written as one function per shape so the two
// implementations cannot drift.

/**
 * A value of `bits` bits, MSB first, over a binary tree of contexts.
 *
 * Each node of the tree is its own model, so "the second bit given the first
 * was 1" is predicted separately -- which is what makes a skewed dictionary
 * (rank 0 far more likely than rank 200) cheap to index.
 */
export function putTree(enc, base, bits, value) {
  let ctx = 1;
  for (let i = bits - 1; i >= 0; i--) {
    const bit = (value >> i) & 1;
    enc.bit(base + ctx, bit);
    ctx = ctx * 2 + bit;
  }
}

export function getTree(dec, base, bits) {
  let ctx = 1;
  for (let i = bits - 1; i >= 0; i--) ctx = ctx * 2 + dec.bit(base + ctx);
  return ctx - (1 << bits);
}

/** Slots a bit tree of this width needs. */
export const treeSize = (bits) => 1 << bits;

// Numbers of unknown size: the bit length first (as a small tree), then the
// bits below the leading one. Small numbers stay small, and a 19-digit video
// id still fits in eight bytes instead of nineteen.
export const UINT_SLOTS = 64 + 54;

export function putUint(enc, base, value) {
  let bits = 0;
  while (value >= 2 ** bits) bits++;      // 0 -> 0, 1 -> 1, 255 -> 8
  putTree(enc, base, 6, bits);
  for (let i = bits - 2; i >= 0; i--) {
    enc.bit(base + 64 + i, Math.floor(value / 2 ** i) % 2);
  }
}

export function getUint(dec, base) {
  const bits = getTree(dec, base, 6);
  if (bits === 0) return 0;
  let value = 1;
  for (let i = bits - 2; i >= 0; i--) value = value * 2 + dec.bit(base + 64 + i);
  return value;
}
