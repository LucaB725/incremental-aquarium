/**
 * renderer.js — Canvas cell-grid renderer
 *
 * Equivalent of aquarium.py's DoubleBuffer + curses rendering layer.
 *
 * API mirrors Python:
 *   put(row, col, ch, style)              — write one character
 *   puts(row, col, text, style, transp)   — write a string
 *   flush()                               — draw everything to canvas
 *   invalidate()                          — no-op, kept for compatibility
 *
 * NO DIFF RENDERING. Every cell is redrawn every frame.
 * Diffing against a front buffer is unsafe when style objects are mutated
 * in-place by the day/night cycle — shared references make the comparison
 * always equal, causing streaks. For 80x24 (1920 cells) a full redraw costs
 * under 0.5ms per frame; the complexity is not worth it.
 */

// ── Color palette ─────────────────────────────────────────────────────────────

export const DAY_WATER_FG   = '#66ccff';
export const DAY_WATER_BG   = '#003399';
export const NIGHT_WATER_FG = '#0033aa';
export const NIGHT_WATER_BG = '#000033';

const NAMED = {
  black:   '#111111', red:     '#ff4444', green:   '#44ff44',
  yellow:  '#ffff44', blue:    '#4444ff', magenta: '#ff44ff',
  cyan:    '#44ffff', white:   '#ffffff',
};

export function namedColor(name, fallback = '#ffffff') {
  return NAMED[name?.trim().toLowerCase()] ?? fallback;
}

const FISH_FG = ['#ffff44', '#ffffff', '#44ff44', '#44ffff', '#ff44ff', '#ff4444'];

export function buildStyles(cfg) {
  const waterBg = DAY_WATER_BG;
  return {
    WATER:   { fg: DAY_WATER_FG,  bg: DAY_WATER_BG },
    BORDER:  { fg: namedColor(cfg.color_border),  bg: waterBg },
    BUBBLE:  { fg: namedColor(cfg.color_bubble),  bg: waterBg },
    SEAWEED: { fg: namedColor(cfg.color_seaweed), bg: waterBg },
    ROCK:    { fg: namedColor(cfg.color_rock),    bg: waterBg },
    CORAL:   { fg: namedColor(cfg.color_coral),   bg: waterBg },
    SAND:    { fg: namedColor(cfg.color_sand),    bg: waterBg },
    CHEST:   { fg: namedColor(cfg.color_chest),   bg: waterBg },
    STATUS:  { fg: namedColor(cfg.color_status_fg, '#111111'),
               bg: namedColor(cfg.color_status_bg, '#ffffff') },
    FISH: FISH_FG.map(fg => ({ fg, bg: waterBg })),
  };
}


// ══════════════════════════════════════════════════════════════════════════════
//  CanvasRenderer
// ══════════════════════════════════════════════════════════════════════════════

const FONT_FAMILY  = '"Courier New", "Lucida Console", monospace';
const FONT_SIZE_PX = 16;

export class CanvasRenderer {
  constructor(canvas) {
    this.canvas  = canvas;
    this.ctx     = canvas.getContext('2d');

    this.ctx.font = `${FONT_SIZE_PX}px ${FONT_FAMILY}`;
    this.cellW = Math.ceil(this.ctx.measureText('M').width);
    this.cellH = FONT_SIZE_PX + 4;

    this.cols    = 80;
    this.rows    = 24;
    // Current water background — updated by main.js each frame before drawing.
    // _clearGrid uses this so transparent fish cells always get the right color.
    this.waterFg = DAY_WATER_FG;
    this.waterBg = DAY_WATER_BG;
    this.back    = this._makeGrid();
  }

  // Each cell is its own independent object — no shared references
  _makeGrid() {
    return Array.from({ length: this.rows }, () =>
      Array.from({ length: this.cols }, () =>
        ({ ch: ' ', fg: DAY_WATER_FG, bg: DAY_WATER_BG })
      )
    );
  }

  // Reset every cell in-place after flush; no object allocation.
  // Uses this.waterFg/waterBg so transparent gaps in fish sprites always
  // show the correct water color including the day/night cycle shift.
  _clearGrid() {
    const fg = this.waterFg;
    const bg = this.waterBg;
    for (let r = 0; r < this.rows; r++)
      for (let c = 0; c < this.cols; c++) {
        const cell = this.back[r][c];
        cell.ch = ' ';
        cell.fg = fg;
        cell.bg = bg;
      }
  }

  resize() {
    this.canvas.width  = window.innerWidth;
    this.canvas.height = window.innerHeight;
    this.cols = Math.max(80, Math.floor(this.canvas.width  / this.cellW));
    this.rows = Math.max(24, Math.floor(this.canvas.height / this.cellH));
    this.back = this._makeGrid();
  }

  put(row, col, ch, style) {
    if (row >= 0 && row < this.rows && col >= 0 && col < this.cols) {
      const cell = this.back[row][col];
      cell.ch = ch;
      cell.fg = style.fg;
      cell.bg = style.bg;
    }
  }

  puts(row, col, text, style, transparent = false) {
    if (!transparent) {
      for (let i = 0; i < text.length; i++)
        this.put(row, col + i, text[i], style);
      return;
    }
    let leading = 0;
    while (leading < text.length && text[leading] === ' ') leading++;
    for (let i = 0; i < text.length; i++) {
      if (text[i] === ' ' && i >= leading) continue;
      this.put(row, col + i, text[i], style);
    }
  }

  // Kept for call-site compatibility; no longer needed without a front buffer
  invalidate() {}

  flush() {
    const ctx   = this.ctx;
    const cellW = this.cellW;
    const cellH = this.cellH;
    ctx.font         = `bold ${FONT_SIZE_PX}px ${FONT_FAMILY}`;
    ctx.textBaseline = 'top';

    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const { ch, fg, bg } = this.back[r][c];
        const px = c * cellW;
        const py = r * cellH;

        ctx.fillStyle = bg;
        ctx.fillRect(px, py, cellW, cellH);

        if (ch !== ' ') {
          ctx.fillStyle = fg;
          ctx.fillText(ch, px, py + 1);
        }
      }
    }

    this._clearGrid();
  }

  get h() { return this.rows; }
  get w() { return this.cols; }
}
