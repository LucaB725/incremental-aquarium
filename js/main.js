/**
 * main.js — Aquarium animation loop (Phase 0 / Step W5)
 *
 * Ports every runtime entity and the main loop from aquarium.py to JS.
 * No incremental game logic yet — this is the visual-parity milestone:
 * fish swim, bubbles rise, seaweed sways, day/night cycle runs.
 *
 * Class mapping from Python → JS:
 *   Fish        → Fish
 *   Bubble      → Bubble
 *   Seaweed     → Seaweed
 *   Scenery     → Scenery
 *   DayNight    → DayNight
 *   (DoubleBuffer) → CanvasRenderer  (in renderer.js)
 *
 * Entry point: init() is called at the bottom of this file.
 */

import { CanvasRenderer, buildStyles, DAY_WATER_FG, DAY_WATER_BG,
         NIGHT_WATER_FG, NIGHT_WATER_BG }   from './renderer.js';
import { SpriteLibrary }                     from './sprites.js';
import { ThemeManager, buildActiveConfig }   from './theme.js';

// ── Seaweed animation frames (mirrors SEAWEED_FRAMES) ────────────────────────

const SEAWEED_FRAMES = [
  ['/', '¦', '/', '¦'],
  ['|', '|', '|', '|'],
  ['\\', '¦', '\\', '¦'],
  ['|', '|', '|', '|'],
];
const SEAWEED_CYCLE = SEAWEED_FRAMES.length;

const BUBBLE_CHARS = ['.', 'o', 'O', '0', '*'];

// ── Default scenery layout (mirrors Scenery.LAYOUT) ───────────────────────────

const DEFAULT_LAYOUT = [
  { kind: 'seaweed', xFrac: 0.08 }, { kind: 'seaweed', xFrac: 0.18 },
  { kind: 'seaweed', xFrac: 0.32 }, { kind: 'seaweed', xFrac: 0.55 },
  { kind: 'seaweed', xFrac: 0.68 }, { kind: 'seaweed', xFrac: 0.82 },
  { kind: 'seaweed', xFrac: 0.91 },
  { kind: 'rock',  xFrac: 0.12 }, { kind: 'rock',  xFrac: 0.45 }, { kind: 'rock',  xFrac: 0.75 },
  { kind: 'coral', xFrac: 0.25 }, { kind: 'coral', xFrac: 0.60 }, { kind: 'coral', xFrac: 0.88 },
  { kind: 'chest', xFrac: 0.38 },
];

const ROCK_SPRITE   = ['▄▄▄▄', '████', '▀▀▀▀'];
const CORAL_SPRITES = [
  ['\\*/', '|/|', ' | '],
  [' /|\\', ' |||', '  |  '],
];
const CHEST_SPRITE  = ['╔══╗', '║()║', '╚══╝'];


// ══════════════════════════════════════════════════════════════════════════════
//  Fish
// ══════════════════════════════════════════════════════════════════════════════

class Fish {
  /**
   * @param {number} x
   * @param {number} y
   * @param {number} rows  — grid rows
   * @param {number} cols  — grid cols
   * @param {SpriteLibrary} lib
   * @param {object} cfg
   */
  constructor(x, y, rows, cols, lib, cfg) {
    const spr       = lib.randomSprite();
    this.rowsRight  = spr.rowsRight;
    this.rowsLeft   = spr.rowsLeft;
    this.colorIdx   = spr.colorIdx;
    this.direction  = Math.random() < 0.5 ? 1 : -1;
    this.spriteRows = this.direction === 1 ? this.rowsRight : this.rowsLeft;
    this.numRows    = this.rowsRight.length;
    // Width = widest row across both directions (including leading spaces)
    const allRows   = [...this.rowsRight, ...this.rowsLeft].filter(r => r.length > 0);
    this.length     = allRows.reduce((m, r) => Math.max(m, r.length), 1);
    this.x          = x;
    this.y          = y;
    this.speed      = cfg.fish_speed_min +
                      Math.random() * (cfg.fish_speed_max - cfg.fish_speed_min);
  }

  /** Mirrors Fish.update(height, width) */
  update(rows, cols) {
    this.x += this.speed * this.direction;

    if (this.direction === 1 && this.x + this.length >= cols - 1) {
      this.direction  = -1;
      this.spriteRows = this.rowsLeft;
    } else if (this.direction === -1 && this.x <= 1) {
      this.direction  = 1;
      this.spriteRows = this.rowsRight;
    }

    if (Math.random() < 0.008) {
      this.y += Math.random() < 0.5 ? -1 : 1;
    }

    // Keep fully inside tank walls
    this.y = Math.max(1, Math.min(Math.max(1, rows - 2 - this.numRows), this.y));
  }

  get ix() { return Math.floor(this.x); }
  get iy() { return Math.floor(this.y); }
}


// ══════════════════════════════════════════════════════════════════════════════
//  Bubble
// ══════════════════════════════════════════════════════════════════════════════

class Bubble {
  static LIFESPAN = 28;

  constructor(x, y) {
    this.x      = x;
    this.y      = y;
    this.age    = 0;
    this.wobble = 0;
    this.rise   = 0.12 + Math.random() * 0.10;
  }

  /** Returns false when expired. Mirrors Bubble.update(). */
  update() {
    this.age++;
    this.y      -= this.rise;
    this.wobble += (Math.random() - 0.5) * 0.8;
    this.wobble  = Math.max(-1, Math.min(1, this.wobble));
    return this.age < Bubble.LIFESPAN;
  }

  get char() {
    const idx = Math.min(
      Math.floor(this.age * BUBBLE_CHARS.length / Bubble.LIFESPAN),
      BUBBLE_CHARS.length - 1
    );
    return BUBBLE_CHARS[idx];
  }

  get ix() { return Math.floor(this.x + this.wobble); }
  get iy() { return Math.floor(this.y); }
}


// ══════════════════════════════════════════════════════════════════════════════
//  Seaweed
// ══════════════════════════════════════════════════════════════════════════════

class Seaweed {
  constructor(x, floorY) {
    this.x      = x;
    this.floorY = floorY;
    this.height = 3 + Math.floor(Math.random() * 5); // 3–7
    this.phase  = Math.floor(Math.random() * SEAWEED_CYCLE);
    this.tick   = 0;
    this.speed  = [6, 8, 10][Math.floor(Math.random() * 3)];
  }

  update() {
    this.tick++;
    if (this.tick >= this.speed) {
      this.tick = 0;
      this.phase = (this.phase + 1) % SEAWEED_CYCLE;
    }
  }

  /** Yields {row, ch} pairs for each stalk segment. */
  *segments() {
    const frame = SEAWEED_FRAMES[this.phase];
    for (let i = 0; i < this.height; i++) {
      yield { row: this.floorY - i, ch: frame[i % frame.length] };
    }
  }
}


// ══════════════════════════════════════════════════════════════════════════════
//  Scenery
// ══════════════════════════════════════════════════════════════════════════════

class Scenery {
  constructor(rows, cols, layout = null) {
    this.seaweeds       = [];
    this.staticCells    = []; // [{row, col, ch, styleKey}]
    this._rows          = 0;
    this._cols          = 0;
    this._layoutOverride = layout;
    this._build(rows, cols);
  }

  _build(rows, cols) {
    this._rows = rows;
    this._cols = cols;
    const innerW = Math.max(1, cols - 2);
    const floorY = rows - 2;
    this.floorY  = floorY;
    this.staticCells = [];
    this.seaweeds    = [];

    // Sand strip
    for (let c = 1; c < cols - 1; c++) {
      this.staticCells.push({ row: floorY, col: c, ch: '~', styleKey: 'SAND' });
    }

    const activeLayout = this._layoutOverride ?? DEFAULT_LAYOUT;

    for (const { kind, xFrac } of activeLayout) {
      const x = Math.max(1, Math.min(cols - 6, 1 + Math.floor(xFrac * (innerW - 1))));

      if (kind === 'seaweed') {
        this.seaweeds.push(new Seaweed(x, floorY - 1));

      } else if (kind === 'rock') {
        for (let ri = 0; ri < ROCK_SPRITE.length; ri++) {
          const row = floorY - ri;
          if (row < 1) continue;
          for (let ci = 0; ci < ROCK_SPRITE[ri].length; ci++) {
            this.staticCells.push({ row, col: x + ci, ch: ROCK_SPRITE[ri][ci], styleKey: 'ROCK' });
          }
        }

      } else if (kind === 'coral') {
        const sprite = CORAL_SPRITES[Math.floor(Math.random() * CORAL_SPRITES.length)];
        for (let ri = 0; ri < sprite.length; ri++) {
          const row = floorY - ri;
          if (row < 1) continue;
          for (let ci = 0; ci < sprite[ri].length; ci++) {
            if (sprite[ri][ci] === ' ') continue;
            this.staticCells.push({ row, col: x + ci, ch: sprite[ri][ci], styleKey: 'CORAL' });
          }
        }

      } else if (kind === 'chest') {
        for (let ri = 0; ri < CHEST_SPRITE.length; ri++) {
          const row = floorY - ri;
          if (row < 1) continue;
          for (let ci = 0; ci < CHEST_SPRITE[ri].length; ci++) {
            this.staticCells.push({ row, col: x + ci, ch: CHEST_SPRITE[ri][ci], styleKey: 'CHEST' });
          }
        }
      }
    }
  }

  rebuildIfResized(rows, cols) {
    if (rows !== this._rows || cols !== this._cols) this._build(rows, cols);
  }

  setLayout(layout) {
    this._layoutOverride = layout;
    this._build(this._rows, this._cols);
  }

  update() {
    for (const sw of this.seaweeds) sw.update();
  }

  drawStatic(renderer, styles) {
    for (const { row, col, ch, styleKey } of this.staticCells) {
      renderer.put(row, col, ch, styles[styleKey]);
    }
  }

  drawSeaweed(renderer, styles) {
    const style = styles.SEAWEED;
    for (const sw of this.seaweeds) {
      for (const { row, ch } of sw.segments()) {
        if (row >= 1 && row < renderer.h - 1) {
          renderer.put(row, sw.x, ch, style);
        }
      }
    }
  }
}


// ══════════════════════════════════════════════════════════════════════════════
//  DayNight
// ══════════════════════════════════════════════════════════════════════════════

// curses 0–1000 scale → 0–255: divide by ~3.92
// DAY_FG (400,800,1000) → rgb(102,204,255)   DAY_BG (0,200,600) → rgb(0,51,153)
// NIGHT_FG (0,100,300)  → rgb(0,26,77)       NIGHT_BG (0,50,150) → rgb(0,13,38)

function cursesToRgb(r, g, b) {
  return `rgb(${Math.round(r/3.92)},${Math.round(g/3.92)},${Math.round(b/3.92)})`;
}

const DAY_FG_RGB   = [400, 800, 1000];
const DAY_BG_RGB   = [0,   200,  600];
const NIGHT_FG_RGB = [0,   100,  300];
const NIGHT_BG_RGB = [0,    50,  150];

function lerpRgb(a, b, t) {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

class DayNight {
  constructor(cfg) {
    this.enabled = cfg.day_night_cycle;
    this.period  = Math.max(10, cfg.day_night_period) * 1000; // ms
    this._start  = performance.now();
  }

  phase() {
    if (!this.enabled) return 0;
    const elapsed = (performance.now() - this._start) % this.period;
    return (1 - Math.cos(2 * Math.PI * elapsed / this.period)) / 2;
  }

  /** Return { fg, bg } CSS strings for the current phase. */
  waterColors() {
    const t  = this.phase();
    const fg = lerpRgb(DAY_FG_RGB, NIGHT_FG_RGB, t);
    const bg = lerpRgb(DAY_BG_RGB, NIGHT_BG_RGB, t);
    return {
      fg: cursesToRgb(...fg),
      bg: cursesToRgb(...bg),
    };
  }

  isNight() { return this.phase() > 0.5; }
}


// ══════════════════════════════════════════════════════════════════════════════
//  Draw helpers (mirror draw_* functions in aquarium.py)
// ══════════════════════════════════════════════════════════════════════════════

function drawBackground(renderer, waterStyle) {
  for (let r = 1; r < renderer.h - 1; r++)
    for (let c = 1; c < renderer.w - 1; c++)
      renderer.put(r, c, ' ', waterStyle);
}

function drawBorder(renderer, styles) {
  const style = styles.BORDER;
  const h = renderer.h, w = renderer.w;
  for (let c = 0; c < w; c++) {
    renderer.put(0,     c, '~', style);
    renderer.put(h - 1, c, '_', style);
  }
  for (let r = 1; r < h - 1; r++) {
    renderer.put(r, 0,     '|', style);
    renderer.put(r, w - 1, '|', style);
  }
}

function drawFish(renderer, fish, styles) {
  const style = styles.FISH[fish.colorIdx];
  for (let i = 0; i < fish.spriteRows.length; i++) {
    const row = fish.spriteRows[i];
    if (row) renderer.puts(fish.iy + i, fish.ix, row, style, true);
  }
}

function drawBubble(renderer, bubble, styles) {
  renderer.put(bubble.iy, bubble.ix, bubble.char, styles.BUBBLE);
}

function drawStatus(renderer, state, styles) {
  const { fishList, paused, dayNight, themeLabel } = state;
  const phase = dayNight.isNight() ? 'night' : 'day';
  let msg = `  fish:${fishList.length}  |  +/- add/remove  |  p pause  |  t theme:${themeLabel}  |  r reload  |  q quit  |  ${phase}`;
  if (paused) msg = '  PAUSED  ' + msg;
  renderer.puts(renderer.h - 1, 0, msg.slice(0, renderer.w), styles.STATUS);
}


// ══════════════════════════════════════════════════════════════════════════════
//  Spawn helpers
// ══════════════════════════════════════════════════════════════════════════════

function spawnFish(rows, cols, lib, cfg) {
  const x = 1 + Math.floor(Math.random() * Math.max(1, cols - 14));
  const y = 1 + Math.floor(Math.random() * Math.max(1, rows - 5));
  return new Fish(x, y, rows, cols, lib, cfg);
}

function maybeSpawnBubbles(fishList, bubbles, rows, cols, floorY, cfg) {
  for (const fish of fishList) {
    if (Math.random() < cfg.bubble_fish_chance) {
      const bx = Math.max(1, Math.min(cols - 2, fish.ix + Math.floor(Math.random() * Math.max(1, fish.length))));
      const by = Math.max(1, fish.iy - 1);
      bubbles.push(new Bubble(bx, by));
    }
  }
  if (Math.random() < cfg.bubble_floor_chance) {
    bubbles.push(new Bubble(1 + Math.floor(Math.random() * (cols - 2)), floorY - 1));
  }
}


// ══════════════════════════════════════════════════════════════════════════════
//  Main loop
// ══════════════════════════════════════════════════════════════════════════════

async function init() {
  const canvas   = document.getElementById('tank');
  const renderer = new CanvasRenderer(canvas);
  renderer.resize();

  // ── Load theme manager + base config ──────────────────────────────────────
  const themeMgr = new ThemeManager();
  await themeMgr.init();

  // Support ?theme=coral_reef in the URL (mirrors --theme CLI arg)
  const urlTheme = new URLSearchParams(window.location.search).get('theme')
                || window.location.hash.slice(1);
  if (urlTheme) themeMgr.select(urlTheme);

  let { cfg, fishUrl, layout } = await buildActiveConfig(themeMgr);
  let lib     = await SpriteLibrary.load(fishUrl);
  let styles  = buildStyles(cfg);
  let dayNight = new DayNight(cfg);
  let scenery  = new Scenery(renderer.h, renderer.w, layout);

  let fishList = Array.from({ length: cfg.fish_start },
    () => spawnFish(renderer.h, renderer.w, lib, cfg));
  let bubbles  = [];
  let paused   = false;

  const frameMs = () => 1000 / Math.max(1, Math.min(60, cfg.fps));

  // ── Reload helper — mirrors _build_active_config ──────────────────────────
  async function reload() {
    ({ cfg, fishUrl, layout } = await buildActiveConfig(themeMgr));
    lib      = await SpriteLibrary.load(fishUrl);
    styles   = buildStyles(cfg);
    dayNight = new DayNight(cfg);
    scenery.setLayout(layout);
  }

  async function switchTheme(direction) {
    direction === 1 ? themeMgr.next() : themeMgr.prev();
    await reload();
    fishList = fishList.map(() => spawnFish(renderer.h, renderer.w, lib, cfg));
    bubbles  = [];
    renderer.invalidate();
  }

  // ── Keyboard input (mirrors main() key handling) ──────────────────────────
  window.addEventListener('keydown', async (e) => {
    switch (e.key) {
      case 'p': case 'P':
        paused = !paused;
        break;
      case '+': case '=':
        if (fishList.length < cfg.fish_max)
          fishList.push(spawnFish(renderer.h, renderer.w, lib, cfg));
        break;
      case '-':
        if (fishList.length > 0) fishList.pop();
        break;
      case 'r': case 'R':
        await reload();
        break;
      case 't':
        await switchTheme(1);
        break;
      case 'T':
        await switchTheme(-1);
        break;
    }
  });

  // ── Window resize ─────────────────────────────────────────────────────────
  window.addEventListener('resize', () => {
    renderer.resize();
    scenery.rebuildIfResized(renderer.h, renderer.w);
    renderer.invalidate();
  });

  // ── Animation loop (replaces time.sleep + while True) ────────────────────
  let lastFrame = performance.now();

  function frame(now) {
    const elapsed = now - lastFrame;
    const target  = frameMs();

    if (elapsed >= target) {
      lastFrame = now - (elapsed % target); // keep phase accurate

      const rows   = renderer.h;
      const cols   = renderer.w;
      const floorY = rows - 2;

      // Update
      if (!paused) {
        for (const fish of fishList) fish.update(rows, cols);
        scenery.update();
        maybeSpawnBubbles(fishList, bubbles, rows, cols, floorY, cfg);
        bubbles = bubbles.filter(b => b.update());
        if (bubbles.length > cfg.bubble_max)
          bubbles = bubbles.slice(-cfg.bubble_max);
      }

      // Update water colors from day/night cycle
      const wc = dayNight.waterColors();
      styles.WATER.fg = wc.fg;
      styles.WATER.bg = wc.bg;
      // Also update fish + scenery bg so they blend with water
      for (const s of styles.FISH) s.bg = wc.bg;
      for (const key of ['BORDER','BUBBLE','SEAWEED','ROCK','CORAL','SAND','CHEST'])
        styles[key].bg = wc.bg;

      // Render
      drawBackground(renderer, styles.WATER);
      scenery.drawStatic(renderer, styles);
      scenery.drawSeaweed(renderer, styles);
      for (const b of bubbles) {
        if (b.iy >= 1 && b.iy < rows - 1 && b.ix >= 1 && b.ix < cols - 1)
          drawBubble(renderer, b, styles);
      }
      for (const fish of fishList) drawFish(renderer, fish, styles);
      drawBorder(renderer, styles);
      drawStatus(renderer, {
        fishList, paused, dayNight, themeLabel: themeMgr.currentLabel()
      }, styles);

      renderer.flush();
    }

    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
}

init();
