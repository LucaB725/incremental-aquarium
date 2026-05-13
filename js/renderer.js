/**
 * renderer.js — Canvas cell-grid renderer
 *
 * Direct JS equivalent of aquarium.py's DoubleBuffer + curses rendering layer.
 *
 * Concepts that map 1-to-1 from Python:
 *   DoubleBuffer.put()        → CanvasRenderer.put()
 *   DoubleBuffer.puts()       → CanvasRenderer.puts()
 *   DoubleBuffer.flush()      → CanvasRenderer.flush()
 *   DoubleBuffer.invalidate() → CanvasRenderer.invalidate()
 *   curses color_pair(CP_*)   → style objects { fg, bg } via STYLES
 *
 * Color pairs are plain objects instead of integer IDs. Pass them directly:
 *   renderer.put(row, col, '~', STYLES.BORDER);
 *   renderer.puts(row, col, '><>', STYLES.FISH[2], true);
 *
 * The canvas is sized to fill its container. Call renderer.resize() on
 * window resize events. The cell size is determined by the font — we measure
 * one character at init time and use that everywhere.
 */

// ── Color palette (mirrors _FISH_PALETTE + curses color names) ───────────────

// curses 0–1000 scale → CSS: DAY_FG (400,800,1000) → rgb(102,204,255)
// We express the day/night cycle in CSS directly; these are the base values.
export const DAY_WATER_FG  = '#66ccff';
export const DAY_WATER_BG  = '#003399';
export const NIGHT_WATER_FG = '#0033aa';
export const NIGHT_WATER_BG = '#000033';

// Named color map — mirrors _COLOR_NAMES in aquarium.py
const NAMED = {
  black:   '#111111',
  red:     '#ff4444',
  green:   '#44ff44',
  yellow:  '#ffff44',
  blue:    '#4444ff',
  magenta: '#ff44ff',
  cyan:    '#44ffff',
  white:   '#ffffff',
};

export function namedColor(name, fallback = '#ffffff') {
  return NAMED[name?.trim().toLowerCase()] ?? fallback;
}

// Fish palette (mirrors _FISH_PALETTE order: yellow white green cyan magenta red)
const FISH_FG = ['#ffff44', '#ffffff', '#44ff44', '#44ffff', '#ff44ff', '#ff4444'];

/**
 * Build the full STYLES object from a loaded config.
 * Call this once after config + theme are loaded, and again after theme switch.
 * The water colors start at DAY values; DayNight.update() mutates them at runtime.
 */
export function buildStyles(cfg) {
  const waterBg = DAY_WATER_BG;
  return {
    WATER:  { fg: DAY_WATER_FG,  bg: DAY_WATER_BG },
    BORDER: { fg: namedColor(cfg.color_border), bg: waterBg },
    BUBBLE: { fg: namedColor(cfg.color_bubble), bg: waterBg },
    SEAWEED:{ fg: namedColor(cfg.color_seaweed),bg: waterBg },
    ROCK:   { fg: namedColor(cfg.color_rock),   bg: waterBg },
    CORAL:  { fg: namedColor(cfg.color_coral),  bg: waterBg },
    SAND:   { fg: namedColor(cfg.color_sand),   bg: waterBg },
    CHEST:  { fg: namedColor(cfg.color_chest),  bg: waterBg },
    STATUS: {
      fg: namedColor(cfg.color_status_fg, '#111111'),
      bg: namedColor(cfg.color_status_bg, '#ffffff'),
    },
    // FISH[i] mirrors CP_FISH[i] — bg is always the water background
    FISH: FISH_FG.map(fg => ({ fg, bg: waterBg })),
  };
}


// ══════════════════════════════════════════════════════════════════════════════
//  CanvasRenderer
// ══════════════════════════════════════════════════════════════════════════════

const FONT_FAMILY = '"Courier New", "Lucida Console", monospace';
const FONT_SIZE_PX = 16;

// Sentinel — same idea as Python's _UNDRAWN object()
const UNDRAWN = Symbol('UNDRAWN');

export class CanvasRenderer {
  /**
   * @param {HTMLCanvasElement} canvas
   */
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx    = canvas.getContext('2d');

    // Measure cell dimensions using a throwaway draw
    this.ctx.font = `${FONT_SIZE_PX}px ${FONT_FAMILY}`;
    const metrics = this.ctx.measureText('M');
    this.cellW = Math.ceil(metrics.width);
    this.cellH = FONT_SIZE_PX + 4;  // +4px line-gap matches terminal feel

    // Grid dimensions — set properly by resize()
    this.cols = 80;
    this.rows = 24;

    // Back and front buffers: rows × cols of { ch, style } or UNDRAWN
    this._blank  = { ch: ' ', style: { fg: DAY_WATER_FG, bg: DAY_WATER_BG } };
    this.back    = this._makeGrid(this._blank);
    this.front   = this._makeGrid(UNDRAWN);
  }

  // ── Grid helpers ────────────────────────────────────────────────────────────

  _makeGrid(fill) {
    return Array.from({ length: this.rows }, () => Array(this.cols).fill(fill));
  }

  _blankGrid() {
    const blank = this._blank;
    for (let r = 0; r < this.rows; r++)
      for (let c = 0; c < this.cols; c++)
        this.back[r][c] = blank;
  }

  // ── Public API (mirrors DoubleBuffer) ────────────────────────────────────────

  /**
   * Fit the canvas to the window and recalculate grid dimensions.
   * Call on window 'resize' and once at startup.
   */
  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.canvas.width  = w;
    this.canvas.height = h;
    this.cols = Math.max(80, Math.floor(w / this.cellW));
    this.rows = Math.max(24, Math.floor(h / this.cellH));
    this.back  = this._makeGrid(this._blank);
    this.front = this._makeGrid(UNDRAWN);
  }

  /**
   * Write a single character into the back buffer.
   * Mirrors DoubleBuffer.put(y, x, ch, attr).
   * @param {number} row
   * @param {number} col
   * @param {string} ch   — single character
   * @param {object} style — { fg, bg } CSS color strings
   */
  put(row, col, ch, style) {
    if (row >= 0 && row < this.rows && col >= 0 && col < this.cols)
      this.back[row][col] = { ch, style };
  }

  /**
   * Write a string into the back buffer.
   * Mirrors DoubleBuffer.puts(y, x, text, attr, transparent).
   *
   * transparent=true (fish sprites):
   *   Leading spaces are positional — written with the current style.
   *   Interior/trailing spaces are skipped so the water background shows through.
   *
   * @param {number}  row
   * @param {number}  col
   * @param {string}  text
   * @param {object}  style
   * @param {boolean} [transparent=false]
   */
  puts(row, col, text, style, transparent = false) {
    if (!transparent) {
      for (let i = 0; i < text.length; i++)
        this.put(row, col + i, text[i], style);
      return;
    }
    // Find end of leading spaces
    let leading = 0;
    while (leading < text.length && text[leading] === ' ') leading++;

    for (let i = 0; i < text.length; i++) {
      if (text[i] === ' ' && i >= leading) continue; // interior/trailing → skip
      this.put(row, col + i, text[i], style);
    }
  }

  /**
   * Reset the front buffer so the next flush redraws every cell.
   * Call alongside any full clear (theme switch, resize).
   * Mirrors DoubleBuffer.invalidate().
   */
  invalidate() {
    for (let r = 0; r < this.rows; r++)
      for (let c = 0; c < this.cols; c++)
        this.front[r][c] = UNDRAWN;
  }

  /**
   * Diff back vs front, draw only changed cells to the canvas.
   * Mirrors DoubleBuffer.flush(stdscr).
   */
  flush() {
    const ctx    = this.ctx;
    const cellW  = this.cellW;
    const cellH  = this.cellH;
    ctx.font     = `bold ${FONT_SIZE_PX}px ${FONT_FAMILY}`;
    ctx.textBaseline = 'top';

    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const cell = this.back[r][c];
        const prev = this.front[r][c];

        // Skip unchanged cells (diff rendering — same as Python)
        if (prev !== UNDRAWN &&
            prev.ch === cell.ch &&
            prev.style === cell.style) continue;

        const px = c * cellW;
        const py = r * cellH;

        // Background
        ctx.fillStyle = cell.style.bg;
        ctx.fillRect(px, py, cellW, cellH);

        // Character
        if (cell.ch !== ' ') {
          ctx.fillStyle = cell.style.fg;
          ctx.fillText(cell.ch, px, py + 1);
        }

        this.front[r][c] = cell;
      }
    }

    // Reset back buffer to blank water for next frame
    this._blankGrid();
  }

  // ── Convenience getters (mirror buf.h / buf.w) ───────────────────────────────

  get h() { return this.rows; }
  get w() { return this.cols; }
}
