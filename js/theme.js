/**
 * theme.js — Theme pack loader and manager
 *
 * JS port of theme_loader.py: ThemePack + ThemeManager.
 *
 * Differences from Python:
 *   - Discovery is not automatic (no filesystem). Instead, the list of theme
 *     names is declared in KNOWN_THEMES below. Add a new entry here whenever
 *     you add a folder under data/themes/.
 *   - All file loading is async (fetch). Call ThemeManager.init() once and
 *     await it before touching the game loop.
 *   - ThemePack.load() fetches the four optional files in parallel.
 *
 * Usage:
 *   const mgr = new ThemeManager();
 *   await mgr.init();                 // discovers + loads all theme packs
 *   const pack = mgr.current();       // null → base config
 *   mgr.next();                       // advance
 *   mgr.select('coral_reef');
 *   mgr.currentLabel();               // 'Coral Reef' or 'default'
 */

// ── Declare known themes here — add names as you add data/themes/<name>/ ─────
// Order determines cycling order with t / T.
export const KNOWN_THEMES = ['coral_reef', 'goldfish_bowl', 'deep_sea', 'zen'];

const BASE = 'data/themes';

// Keys allowed from theme.cfg / colors.cfg (mirrors _ALL_KEYS in theme_loader.py)
const CFG_KEYS = new Set([
  'fps', 'fish_start', 'fish_max',
  'fish_speed_min', 'fish_speed_max',
  'bubble_fish_chance', 'bubble_floor_chance', 'bubble_max',
  'day_night_cycle', 'day_night_period',
]);
const COLOR_KEYS = new Set([
  'color_border', 'color_seaweed', 'color_bubble',
  'color_rock', 'color_coral', 'color_sand',
  'color_chest', 'color_status_fg', 'color_status_bg',
]);
const ALL_KEYS = new Set([...CFG_KEYS, ...COLOR_KEYS]);

// Config defaults for type coercion (mirrors Config.DEFAULTS)
const CFG_DEFAULTS = {
  fps: 24, fish_start: 5, fish_max: 30,
  fish_speed_min: 0.08, fish_speed_max: 0.22,
  bubble_fish_chance: 0.015, bubble_floor_chance: 0.008, bubble_max: 60,
  day_night_cycle: true, day_night_period: 120,
  color_border: 'white', color_seaweed: 'green', color_bubble: 'cyan',
  color_rock: 'white', color_coral: 'magenta', color_sand: 'yellow',
  color_chest: 'yellow', color_status_fg: 'black', color_status_bg: 'white',
};

// ── Shared fetch helper ───────────────────────────────────────────────────────

async function fetchText(url) {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    return await r.text();
  } catch {
    return null;
  }
}


// ══════════════════════════════════════════════════════════════════════════════
//  ThemePack
// ══════════════════════════════════════════════════════════════════════════════

export class ThemePack {
  /**
   * @param {string} name — folder name, e.g. 'coral_reef'
   */
  constructor(name) {
    this.name        = name;
    this.displayName = name.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    this.blurb       = '';
    this.overrides   = {};   // key → raw string value
    this.fishUrl     = null; // URL to this theme's fish.txt, or null
    this.layout      = null; // [{kind, xFrac}] or null
  }

  /**
   * Fetch and parse all four optional theme files in parallel.
   * Missing files are silently ignored.
   * @returns {Promise<ThemePack>} (this)
   */
  async load() {
    const base = `${BASE}/${this.name}`;
    const [desc, cfg, colors, scenery] = await Promise.all([
      fetchText(`${base}/description.txt`),
      fetchText(`${base}/theme.cfg`),
      fetchText(`${base}/colors.cfg`),
      fetchText(`${base}/scenery.txt`),
    ]);

    // Check if fish.txt exists by attempting a HEAD request
    const fishCheck = await fetch(`${base}/fish.txt`, { method: 'HEAD' }).catch(() => null);
    if (fishCheck?.ok) this.fishUrl = `${base}/fish.txt`;

    if (desc)    this._parseDescription(desc);
    if (cfg)     this._parseCfg(cfg);
    if (colors)  this._parseCfg(colors);
    if (scenery) this._parseScenery(scenery);

    return this;
  }

  // ── File parsers (mirror ThemePack._load_* methods) ──────────────────────────

  _parseDescription(text) {
    const lines = text.split('\n')
      .map(l => l.trim())
      .filter(l => l && !l.startsWith('#'));
    if (lines[0]) this.displayName = lines[0];
    if (lines[1]) this.blurb       = lines[1];
  }

  /**
   * Parse a key = value file, keeping only recognised keys.
   * Mirrors ThemePack._load_cfg().
   */
  _parseCfg(text) {
    for (const raw of text.split('\n')) {
      const line = raw.trim();
      if (!line || line.startsWith('#') || !line.includes('=')) continue;
      const eq  = line.indexOf('=');
      const key = line.slice(0, eq).trim().toLowerCase();
      const val = line.slice(eq + 1).trimEnd(); // keep leading space (stripped by applyTheme)
      if (ALL_KEYS.has(key)) this.overrides[key] = val.trim();
    }
  }

  /**
   * Parse scenery.txt into [{kind, xFrac}].
   * Mirrors ThemePack._load_scenery().
   */
  _parseScenery(text) {
    const KNOWN = new Set(['seaweed', 'rock', 'coral', 'chest']);
    const layout = [];
    for (const raw of text.split('\n')) {
      const line = raw.split('#')[0].trim(); // strip inline comments
      if (!line) continue;
      const parts = line.split(/\s+/);
      if (parts.length < 2) continue;
      const kind = parts[0].toLowerCase();
      if (!KNOWN.has(kind)) continue;
      const xFrac = parseFloat(parts[1]);
      if (isNaN(xFrac)) continue;
      layout.push({ kind, xFrac: Math.max(0.01, Math.min(0.99, xFrac)) });
    }
    if (layout.length > 0) this.layout = layout;
  }
}


// ══════════════════════════════════════════════════════════════════════════════
//  ThemeManager
// ══════════════════════════════════════════════════════════════════════════════

export class ThemeManager {
  constructor() {
    this._packs = [];
    this._index = -1; // -1 = no theme / base config
  }

  /**
   * Load all known theme packs. Call once before the game loop starts.
   * Silently skips any theme whose files all 404 (theme folder missing).
   * @returns {Promise<void>}
   */
  async init() {
    const loaded = await Promise.all(
      KNOWN_THEMES.map(name => new ThemePack(name).load())
    );
    // Keep all packs — even empty ones are valid (just a label with no overrides)
    this._packs = loaded;
  }

  // ── Public API (mirrors ThemeManager in Python) ───────────────────────────────

  /** Active ThemePack, or null (base config). Mirrors .current(). */
  current() {
    if (this._index < 0 || this._packs.length === 0) return null;
    return this._packs[this._index];
  }

  /** Short string for the status bar. Mirrors .current_label(). */
  currentLabel() {
    return this.current()?.displayName ?? 'default';
  }

  /**
   * Advance to next theme and return it.
   * Cycles: default(-1) → packs[0] → packs[1] → ... → packs[n-1] → default(-1) → ...
   * Mirrors .next().
   */
  next() {
    if (this._packs.length === 0) return null;
    // Advance through 0..n-1, then wrap back to -1 (default)
    if (this._index >= this._packs.length - 1) {
      this._index = -1;
    } else {
      this._index++;
    }
    return this.current();
  }

  /**
   * Step backward through themes.
   * Cycles: default(-1) → packs[n-1] → ... → packs[0] → default(-1) → ...
   * Mirrors .prev().
   */
  prev() {
    if (this._packs.length === 0) return null;
    // Step back through 0..n-1, wrapping from -1 (default) to the last pack
    if (this._index === -1) {
      this._index = this._packs.length - 1;
    } else {
      this._index--;   // goes to -1 when at index 0, which is correct (default)
    }
    return this.current();
  }

  /** Jump directly to a theme by folder name. Returns null if not found. */
  select(name) {
    const i = this._packs.findIndex(p => p.name === name);
    if (i === -1) return null;
    this._index = i;
    return this.current();
  }

  /** Return to base config. */
  reset() { this._index = -1; }

  /** List of available theme names. */
  names() { return this._packs.map(p => p.name); }
}


// ══════════════════════════════════════════════════════════════════════════════
//  Config loader + applyTheme
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Load and parse aquarium.cfg (or a theme's theme.cfg/colors.cfg).
 * Returns a plain object with all keys from CFG_DEFAULTS, with correct types.
 * Mirrors aquarium.py's Config class.
 *
 * @param {string} url
 * @returns {Promise<object>}
 */
export async function loadConfig(url) {
  const cfg  = { ...CFG_DEFAULTS };
  const text = await fetchText(url);
  if (!text) return cfg;

  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const eq  = line.indexOf('=');
    const key = line.slice(0, eq).trim().toLowerCase();
    const val = line.slice(eq + 1).trim();
    if (!(key in cfg)) continue;
    const orig = CFG_DEFAULTS[key];
    try {
      if (typeof orig === 'boolean') {
        cfg[key] = ['true', '1', 'yes'].includes(val.toLowerCase());
      } else if (typeof orig === 'number' && Number.isInteger(orig)) {
        cfg[key] = parseInt(val, 10);
      } else if (typeof orig === 'number') {
        cfg[key] = parseFloat(val);
      } else {
        cfg[key] = val;
      }
    } catch { /* keep default */ }
  }
  return cfg;
}

/**
 * Merge a ThemePack's overrides onto an existing config object in-place.
 * Mirrors apply_theme() from theme_loader.py.
 *
 * @param {object}    cfg  — config object from loadConfig()
 * @param {ThemePack|null} pack
 */
export function applyTheme(cfg, pack) {
  if (!pack) return;
  for (const [key, val] of Object.entries(pack.overrides)) {
    if (!(key in cfg)) continue;
    const orig = CFG_DEFAULTS[key];
    if (orig === undefined) { cfg[key] = val; continue; }
    try {
      if (typeof orig === 'boolean') {
        cfg[key] = ['true', '1', 'yes'].includes(val.toLowerCase());
      } else if (typeof orig === 'number' && Number.isInteger(orig)) {
        cfg[key] = parseInt(val, 10);
      } else if (typeof orig === 'number') {
        cfg[key] = parseFloat(val);
      } else {
        cfg[key] = val;
      }
    } catch { /* keep existing */ }
  }
}

/**
 * Build the active config: load base aquarium.cfg, then apply current theme.
 * Returns { cfg, fishUrl, layout }.
 * Mirrors _build_active_config() in aquarium.py.
 *
 * @param {ThemeManager} themeMgr
 * @returns {Promise<{cfg: object, fishUrl: string, layout: Array|null}>}
 */
export async function buildActiveConfig(themeMgr) {
  const cfg  = await loadConfig('data/aquarium.cfg');
  const pack = themeMgr.current();
  applyTheme(cfg, pack);
  const fishUrl = pack?.fishUrl ?? 'data/fish.txt';
  const layout  = pack?.layout  ?? null;
  return { cfg, fishUrl, layout };
}
