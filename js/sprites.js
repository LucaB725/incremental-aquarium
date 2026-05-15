/**
 * sprites.js — fish.txt parser + sprite library
 *
 * Direct JS port of aquarium.py's SpriteLibrary class.
 * Supports both row-numbering conventions from the Python version:
 *
 *   Convention A (sequential from 1):
 *     right  = top row
 *     right1 = second row
 *     right2 = third row
 *
 *   Convention B (legacy 2-indexed):
 *     right  = top row
 *     right2 = second row
 *     right3 = third row
 *
 * Both produce the same [row0, row1, row2, ...] list internally.
 *
 * Usage:
 *   const lib = await SpriteLibrary.load('data/fish.txt');
 *   const sprite = lib.randomSprite();
 *   // sprite = { rowsRight: [...], rowsLeft: [...], colorIdx: 0..5 }
 */

// ── Color name → fish palette index (mirrors _COLOR_NAMES + CP_FISH) ─────────

const COLOR_KEYS = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white'];
const FISH_PALETTE_SIZE = 6; // CP_FISH has 6 slots

// ── Built-in fallback sprites (mirrors SpriteLibrary.BUILTIN) ────────────────

const BUILTIN = [
  { name: 'fish',        rowsRight: ['><>'],    rowsLeft: ['<><'],    colorIdx: 0 },
  { name: 'tropical',   rowsRight: ['><((°>'], rowsLeft: ['<°))><'], colorIdx: 3 },
];


// ══════════════════════════════════════════════════════════════════════════════
//  SpriteLibrary
// ══════════════════════════════════════════════════════════════════════════════

export class SpriteLibrary {
  constructor() {
    this.sprites = [];
  }

  /**
   * Fetch and parse a fish.txt file.
   * Returns a populated SpriteLibrary instance.
   * Falls back to BUILTIN sprites if the fetch fails or the file is empty.
   *
   * @param {string} url — path to fish.txt, e.g. 'data/fish.txt'
   * @returns {Promise<SpriteLibrary>}
   */
  static async load(url) {
    const lib = new SpriteLibrary();
    try {
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const text = await resp.text();
      lib._parse(text);
    } catch (err) {
      console.warn(`SpriteLibrary: could not load ${url}:`, err);
    }
    if (lib.sprites.length === 0) {
      lib.sprites = [...BUILTIN];
    }
    return lib;
  }

  // ── Parser (mirrors SpriteLibrary._load) ─────────────────────────────────────

  _parse(text) {
    const lines   = text.split('\n');
    let current   = {};

    for (let raw of lines) {
      // rstrip \r for Windows line endings
      const line     = raw.replace(/\r$/, '');
      const stripped = line.trim();

      if (!stripped || stripped.startsWith('#')) continue;

      // Section header [name]
      if (stripped.startsWith('[') && stripped.endsWith(']')) {
        if (current.right !== undefined && current.left !== undefined) {
          this._commit(current);
        }
        current = { _name: stripped.slice(1, -1) };
        continue;
      }

      if (!stripped.includes('=')) continue;

      const eqIdx  = stripped.indexOf('=');
      const key    = stripped.slice(0, eqIdx).trim().toLowerCase();
      const rawVal = stripped.slice(eqIdx + 1);

      // Strip exactly one leading separator space, preserve the rest verbatim
      // This mirrors: val = raw_val[1:] if raw_val.startswith(" ") else raw_val
      const val = rawVal.startsWith(' ') ? rawVal.slice(1) : rawVal;

      if (key === 'right' || (key.startsWith('right') && /^\d+$/.test(key.slice(5)))) {
        current[key] = val;
      } else if (key === 'left' || (key.startsWith('left') && /^\d+$/.test(key.slice(4)))) {
        current[key] = val;
      } else if (key === 'color') {
        const colorName = val.trim().toLowerCase();
        const idx = COLOR_KEYS.indexOf(colorName);
        if (idx !== -1) {
          current.colorIdx = idx % FISH_PALETTE_SIZE;
        }
      }
    }

    // Commit the last block (no trailing section header in the file)
    if (current.right !== undefined && current.left !== undefined) {
      this._commit(current);
    }
  }

  // ── _collectRows (mirrors SpriteLibrary._collect_rows) ───────────────────────

  /**
   * Collect all rows for a given prefix ('right' or 'left') from a parsed
   * block dict, into a contiguous ordered array [row0, row1, row2, ...].
   * Handles both numbering conventions — same logic as Python's _collect_rows.
   *
   * @param {object} d       — parsed block
   * @param {string} prefix  — 'right' or 'left'
   * @returns {string[]}
   */
  _collectRows(d, prefix) {
    const bare     = d[prefix];
    const numbered = [];

    for (const [k, v] of Object.entries(d)) {
      if (k === prefix) continue;
      const suffix = k.slice(prefix.length);
      if (/^\d+$/.test(suffix)) {
        numbered.push([parseInt(suffix, 10), v]);
      }
    }

    // Sort by numeric suffix, keep only values
    numbered.sort((a, b) => a[0] - b[0]);
    const sortedVals = numbered.map(([, v]) => v);

    if (bare !== undefined) return [bare, ...sortedVals];
    return sortedVals;
  }

  // ── _commit (mirrors SpriteLibrary._commit) ──────────────────────────────────

  _commit(d) {
    let rowsRight = this._collectRows(d, 'right');
    let rowsLeft  = this._collectRows(d, 'left');

    if (rowsRight.length === 0 || rowsLeft.length === 0) return;

    // Pad to equal height (mirrors Python's while loops)
    while (rowsRight.length < rowsLeft.length) rowsRight.push('');
    while (rowsLeft.length  < rowsRight.length) rowsLeft.push('');

    const colorIdx = d.colorIdx !== undefined
      ? d.colorIdx
      : Math.floor(Math.random() * FISH_PALETTE_SIZE);

    const name = (d._name && d._name.trim()) ? d._name.trim() : `fish_${this.sprites.length}`;
    this.sprites.push({ name, rowsRight, rowsLeft, colorIdx });
  }

  // ── Public API ───────────────────────────────────────────────────────────────

  /**
   * Return a random sprite. Mirrors SpriteLibrary.random_sprite().
   * @returns {{ rowsRight: string[], rowsLeft: string[], colorIdx: number }}
   */
  randomSprite() {
    return this.sprites[Math.floor(Math.random() * this.sprites.length)];
  }
}
