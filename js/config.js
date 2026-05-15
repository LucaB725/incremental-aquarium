/**
 * config.js — In-browser configuration panel
 *
 * Rendered as a real DOM overlay (not on the canvas) so it works cleanly
 * with inputs, checkboxes, and color pickers without reimplementing form
 * widgets inside the cell grid.
 *
 * The panel is opened with configPanel.open(currentCfg) and emits an
 * onSave(overrides) callback with only the keys the user changed.
 *
 * Sections:
 *   Fish Library  — choose between fish_full.txt or a theme's fish.txt,
 *                   plus per-species toggles within the chosen library
 *   Performance   — fps, fish count limits
 *   Behaviour     — fish speed, bubble rates, day/night cycle
 *   Colors        — border, seaweed, bubble, rock, coral, sand, chest,
 *                   status bar (fg + bg)
 *
 * Settings are persisted to localStorage under 'aquarium_user_cfg'.
 * The special key '_fish_library' stores the URL of the chosen fish.txt.
 * The special key '_disabled_fish' stores a Set of sprite names to skip.
 */

import { SpriteLibrary } from './sprites.js';

// ── Fish library options ──────────────────────────────────────────────────────
export const FISH_LIBRARIES = [
  { label: 'Standard (fish.txt)',      url: 'data/fish.txt'      },
  { label: 'Full library (fish_full.txt)', url: 'data/fish_full.txt' },
];

// ── Color names (matches aquarium.cfg valid values) ───────────────────────────
const COLOR_OPTIONS = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white'];

// ── Config fields exposed to the user ────────────────────────────────────────
const FIELDS = [
  // Performance
  { key: 'fps',               label: 'Frame rate (fps)',       type: 'range', min: 1,    max: 60,  step: 1   },
  { key: 'fish_start',        label: 'Fish on start',          type: 'range', min: 1,    max: 30,  step: 1   },
  { key: 'fish_max',          label: 'Max fish',               type: 'range', min: 1,    max: 60,  step: 1   },
  // Behaviour
  { key: 'fish_speed_min',    label: 'Fish speed min',         type: 'range', min: 0.01, max: 1.0, step: 0.01 },
  { key: 'fish_speed_max',    label: 'Fish speed max',         type: 'range', min: 0.01, max: 1.0, step: 0.01 },
  { key: 'bubble_fish_chance',label: 'Bubble chance (fish)',   type: 'range', min: 0,    max: 0.1, step: 0.001 },
  { key: 'bubble_floor_chance',label:'Bubble chance (floor)',  type: 'range', min: 0,    max: 0.1, step: 0.001 },
  { key: 'bubble_max',        label: 'Max bubbles',            type: 'range', min: 0,    max: 200, step: 1   },
  { key: 'day_night_cycle',   label: 'Day/night cycle',        type: 'bool'  },
  { key: 'day_night_period',  label: 'Day/night period (sec)', type: 'range', min: 10,   max: 600, step: 10  },
  // Colors
  { key: 'color_border',      label: 'Border color',           type: 'color' },
  { key: 'color_seaweed',     label: 'Seaweed color',          type: 'color' },
  { key: 'color_bubble',      label: 'Bubble color',           type: 'color' },
  { key: 'color_rock',        label: 'Rock color',             type: 'color' },
  { key: 'color_coral',       label: 'Coral color',            type: 'color' },
  { key: 'color_sand',        label: 'Sand color',             type: 'color' },
  { key: 'color_chest',       label: 'Chest color',            type: 'color' },
  { key: 'color_status_fg',   label: 'Status bar text color',  type: 'color' },
  { key: 'color_status_bg',   label: 'Status bar background',  type: 'color' },
];

// Group labels for section headings
const SECTIONS = [
  { heading: 'Performance',  keys: ['fps', 'fish_start', 'fish_max'] },
  { heading: 'Behaviour',    keys: ['fish_speed_min', 'fish_speed_max',
                                     'bubble_fish_chance', 'bubble_floor_chance',
                                     'bubble_max', 'day_night_cycle', 'day_night_period'] },
  { heading: 'Colors',       keys: ['color_border', 'color_seaweed', 'color_bubble',
                                     'color_rock', 'color_coral', 'color_sand',
                                     'color_chest', 'color_status_fg', 'color_status_bg'] },
];


// ══════════════════════════════════════════════════════════════════════════════
//  ConfigPanel
// ══════════════════════════════════════════════════════════════════════════════

export class ConfigPanel {
  /**
   * @param {{ onSave: function }} opts
   */
  constructor({ onSave }) {
    this._onSave    = onSave;
    this._overlay   = null;
    this._cfg       = {};      // snapshot of cfg when panel was opened
    this._inputs    = {};      // key → DOM input element
    this._sprites   = [];      // [{name, rowsRight, rowsLeft}] from current library
    this._fishToggles = {};    // name → checkbox element
    this._currentLibUrl = FISH_LIBRARIES[0].url;
    this._injectStyles();
  }

  // ── Public API ───────────────────────────────────────────────────────────────

  /**
   * Open the config panel with a snapshot of the current config.
   * @param {object} cfg — current live config object
   */
  open(cfg) {
    if (this._overlay) return; // already open
    this._cfg = { ...cfg };
    this._build();
  }

  close() {
    if (!this._overlay) return;
    document.body.removeChild(this._overlay);
    this._overlay = null;
  }

  // ── DOM construction ─────────────────────────────────────────────────────────

  async _build() {
    const overlay = document.createElement('div');
    overlay.id    = 'cfg-overlay';
    this._overlay = overlay;

    const panel = document.createElement('div');
    panel.id    = 'cfg-panel';

    // Header
    const header = document.createElement('div');
    header.id    = 'cfg-header';
    header.innerHTML = '<span>⚙ Aquarium Config</span>';
    const closeBtn = document.createElement('button');
    closeBtn.textContent = '✕';
    closeBtn.className   = 'cfg-close';
    closeBtn.onclick     = () => this.close();
    header.appendChild(closeBtn);
    panel.appendChild(header);

    // Tabs
    const tabBar  = document.createElement('div');
    tabBar.id     = 'cfg-tabs';
    const tabBody = document.createElement('div');
    tabBody.id    = 'cfg-tab-body';

    const tabs = ['Fish', 'Settings', 'Colors'];
    const panes = [];
    tabs.forEach((label, i) => {
      const btn  = document.createElement('button');
      btn.className   = 'cfg-tab';
      btn.textContent = label;
      btn.onclick     = () => this._switchTab(i, tabBtns, panes);
      tabBar.appendChild(btn);

      const pane = document.createElement('div');
      pane.className = 'cfg-pane';
      pane.style.display = i === 0 ? 'block' : 'none';
      tabBody.appendChild(pane);
      panes.push(pane);
    });
    const tabBtns = [...tabBar.querySelectorAll('.cfg-tab')];
    tabBtns[0].classList.add('active');

    panel.appendChild(tabBar);
    panel.appendChild(tabBody);

    // ── Tab 0: Fish ────────────────────────────────────────────────────────────
    await this._buildFishTab(panes[0]);

    // ── Tab 1: Settings (Performance + Behaviour) ──────────────────────────────
    this._buildSettingsTab(panes[1]);

    // ── Tab 2: Colors ──────────────────────────────────────────────────────────
    this._buildColorsTab(panes[2]);

    // Footer
    const footer = document.createElement('div');
    footer.id    = 'cfg-footer';

    const resetBtn = document.createElement('button');
    resetBtn.textContent = 'Reset to defaults';
    resetBtn.className   = 'cfg-btn-secondary';
    resetBtn.onclick     = () => this._reset();

    const saveBtn = document.createElement('button');
    saveBtn.textContent = 'Save & apply';
    saveBtn.className   = 'cfg-btn-primary';
    saveBtn.onclick     = () => this._save();

    footer.appendChild(resetBtn);
    footer.appendChild(saveBtn);
    panel.appendChild(footer);

    overlay.appendChild(panel);

    // Click outside to close
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) this.close();
    });

    document.body.appendChild(overlay);
  }

  _switchTab(idx, btns, panes) {
    btns.forEach((b, i)  => b.classList.toggle('active', i === idx));
    panes.forEach((p, i) => p.style.display = i === idx ? 'block' : 'none');
  }

  // ── Fish tab ─────────────────────────────────────────────────────────────────

  async _buildFishTab(pane) {
    // Library selector
    const libRow = document.createElement('div');
    libRow.className = 'cfg-row';
    const libLabel = document.createElement('label');
    libLabel.textContent = 'Fish library';
    const libSel = document.createElement('select');
    libSel.className = 'cfg-select';

    // Load saved library preference
    try {
      const saved = JSON.parse(localStorage.getItem('aquarium_user_cfg') || '{}');
      if (saved._fish_library) this._currentLibUrl = saved._fish_library;
    } catch { /* ignore */ }

    FISH_LIBRARIES.forEach(({ label, url }) => {
      const opt = document.createElement('option');
      opt.value       = url;
      opt.textContent = label;
      opt.selected    = url === this._currentLibUrl;
      libSel.appendChild(opt);
    });

    libRow.appendChild(libLabel);
    libRow.appendChild(libSel);
    pane.appendChild(libRow);

    // Fish toggle list (populated after library loads)
    const toggleSection = document.createElement('div');
    toggleSection.id = 'cfg-fish-toggles';
    pane.appendChild(toggleSection);

    const note = document.createElement('p');
    note.className   = 'cfg-note';
    note.textContent = 'Uncheck fish to remove them from the tank. Changes take effect on Save.';
    pane.appendChild(note);

    // Load initial library
    await this._loadFishToggles(toggleSection, this._currentLibUrl);

    libSel.onchange = async () => {
      this._currentLibUrl = libSel.value;
      await this._loadFishToggles(toggleSection, this._currentLibUrl);
    };
  }

  async _loadFishToggles(container, url) {
    container.innerHTML = '<p class="cfg-note">Loading sprites…</p>';
    const lib = await SpriteLibrary.load(url);
    this._sprites = lib.sprites;
    this._fishToggles = {};

    // Load currently disabled fish from localStorage
    let disabled = new Set();
    try {
      const saved = JSON.parse(localStorage.getItem('aquarium_user_cfg') || '{}');
      disabled = new Set(saved._disabled_fish || []);
    } catch { /* ignore */ }

    container.innerHTML = '';

    // "All / None" row
    const allRow = document.createElement('div');
    allRow.className = 'cfg-fish-allrow';
    ['All', 'None'].forEach(label => {
      const btn = document.createElement('button');
      btn.textContent = label;
      btn.className   = 'cfg-btn-secondary cfg-btn-small';
      btn.onclick     = () => {
        const val = label === 'All';
        Object.values(this._fishToggles).forEach(cb => cb.checked = val);
      };
      allRow.appendChild(btn);
    });
    container.appendChild(allRow);

    // One row per sprite — show the sprite's name from the fish.txt block header
    lib.sprites.forEach((spr, idx) => {
      const name = spr.name ?? `fish_${idx}`;

      const row = document.createElement('div');
      row.className = 'cfg-fish-row';

      const cb = document.createElement('input');
      cb.type    = 'checkbox';
      cb.id      = `cfg-fish-${idx}`;
      cb.checked = !disabled.has(name);
      this._fishToggles[name] = cb;

      const lbl = document.createElement('label');
      lbl.htmlFor     = cb.id;
      lbl.className   = 'cfg-fish-label';

      const nameSpan = document.createElement('span');
      nameSpan.className   = 'cfg-fish-name';
      nameSpan.textContent = name.replace(/_/g, ' ');

      lbl.appendChild(nameSpan);
      row.appendChild(cb);
      row.appendChild(lbl);
      container.appendChild(row);
    });
  }

  // ── Settings tab (Performance + Behaviour) ────────────────────────────────────

  _buildSettingsTab(pane) {
    const fieldMap = Object.fromEntries(FIELDS.map(f => [f.key, f]));
    ['Performance', 'Behaviour'].forEach(heading => {
      const sec  = SECTIONS.find(s => s.heading === heading);
      const h3   = document.createElement('h3');
      h3.className   = 'cfg-heading';
      h3.textContent = heading;
      pane.appendChild(h3);

      sec.keys.forEach(key => {
        const field = fieldMap[key];
        if (!field) return;
        const row = this._makeFieldRow(field);
        pane.appendChild(row);
      });
    });
  }

  // ── Colors tab ───────────────────────────────────────────────────────────────

  _buildColorsTab(pane) {
    const fieldMap = Object.fromEntries(FIELDS.map(f => [f.key, f]));
    const sec  = SECTIONS.find(s => s.heading === 'Colors');
    sec.keys.forEach(key => {
      const field = fieldMap[key];
      if (!field) return;
      const row = this._makeFieldRow(field);
      pane.appendChild(row);
    });
  }

  // ── Field row builder ────────────────────────────────────────────────────────

  _makeFieldRow(field) {
    const row = document.createElement('div');
    row.className = 'cfg-row';

    const label = document.createElement('label');
    label.textContent = field.label;
    label.htmlFor     = `cfg-${field.key}`;
    row.appendChild(label);

    const currentVal = this._cfg[field.key];
    let input;

    if (field.type === 'bool') {
      input = document.createElement('input');
      input.type    = 'checkbox';
      input.id      = `cfg-${field.key}`;
      input.checked = !!currentVal;

    } else if (field.type === 'range') {
      const wrap    = document.createElement('div');
      wrap.className = 'cfg-range-wrap';

      input = document.createElement('input');
      input.type  = 'range';
      input.id    = `cfg-${field.key}`;
      input.min   = field.min;
      input.max   = field.max;
      input.step  = field.step;
      input.value = currentVal ?? field.min;

      const readout = document.createElement('span');
      readout.className   = 'cfg-range-val';
      readout.textContent = input.value;
      input.oninput = () => { readout.textContent = input.value; };

      wrap.appendChild(input);
      wrap.appendChild(readout);
      row.appendChild(label);
      row.appendChild(wrap);
      this._inputs[field.key] = input;
      return row; // already appended label

    } else if (field.type === 'color') {
      input = document.createElement('select');
      input.id        = `cfg-${field.key}`;
      input.className = 'cfg-select';
      COLOR_OPTIONS.forEach(c => {
        const opt       = document.createElement('option');
        opt.value       = c;
        opt.textContent = c;
        opt.selected    = c === currentVal;
        input.appendChild(opt);
      });
    }

    row.appendChild(input);
    this._inputs[field.key] = input;
    return row;
  }

  // ── Save / Reset ──────────────────────────────────────────────────────────────

  _save() {
    const overrides = {};

    // Gather standard field values
    for (const field of FIELDS) {
      const input = this._inputs[field.key];
      if (!input) continue;
      if (field.type === 'bool') {
        overrides[field.key] = input.checked;
      } else if (field.type === 'range') {
        const v = parseFloat(input.value);
        overrides[field.key] = Number.isInteger(field.step) && field.step >= 1
          ? Math.round(v) : v;
      } else {
        overrides[field.key] = input.value;
      }
    }

    // Fish library
    overrides._fish_library = this._currentLibUrl;

    // Disabled fish
    const disabled = Object.entries(this._fishToggles)
      .filter(([, cb]) => !cb.checked)
      .map(([name]) => name);
    overrides._disabled_fish = disabled;

    // onSave owns localStorage — pass overrides up and let it persist + reload
    this._onSave(overrides);
    this.close();
  }

  _reset() {
    localStorage.removeItem('aquarium_user_cfg');
    this._onSave({});
    this.close();
  }

  // ── Injected CSS ─────────────────────────────────────────────────────────────

  _injectStyles() {
    if (document.getElementById('cfg-styles')) return;
    const style = document.createElement('style');
    style.id    = 'cfg-styles';
    style.textContent = `
      #cfg-overlay {
        position: fixed; inset: 0;
        background: rgba(0,0,40,0.82);
        display: flex; align-items: center; justify-content: center;
        z-index: 1000;
        font-family: "Courier New", monospace;
      }
      #cfg-panel {
        background: #001133;
        border: 2px solid #44aaff;
        color: #cceeff;
        width: min(680px, 96vw);
        max-height: 86vh;
        display: flex; flex-direction: column;
        border-radius: 4px;
        box-shadow: 0 0 40px rgba(0,100,255,0.4);
      }
      #cfg-header {
        display: flex; justify-content: space-between; align-items: center;
        padding: 10px 16px;
        border-bottom: 1px solid #224488;
        font-size: 1.1em; font-weight: bold; color: #88ddff;
      }
      .cfg-close {
        background: none; border: 1px solid #44aaff; color: #44aaff;
        cursor: pointer; padding: 2px 8px; font-family: inherit;
        border-radius: 2px;
      }
      .cfg-close:hover { background: #44aaff22; }
      #cfg-tabs {
        display: flex; border-bottom: 1px solid #224488;
      }
      .cfg-tab {
        flex: 1; padding: 8px; background: none; border: none;
        color: #88aacc; cursor: pointer; font-family: inherit; font-size: 0.95em;
        border-bottom: 2px solid transparent;
      }
      .cfg-tab.active { color: #44ddff; border-bottom-color: #44ddff; }
      .cfg-tab:hover  { background: #ffffff0a; }
      #cfg-tab-body {
        flex: 1; overflow-y: auto; padding: 12px 16px;
      }
      .cfg-pane { display: none; }
      .cfg-heading {
        color: #44aaff; font-size: 0.85em; letter-spacing: 0.08em;
        text-transform: uppercase; margin: 14px 0 6px; border-bottom: 1px solid #1a3366;
        padding-bottom: 3px;
      }
      .cfg-row {
        display: flex; align-items: center; justify-content: space-between;
        padding: 5px 0; gap: 12px;
      }
      .cfg-row label { flex: 1; font-size: 0.9em; color: #aaccee; }
      .cfg-range-wrap {
        display: flex; align-items: center; gap: 8px; flex: 1.2;
      }
      .cfg-range-wrap input[type=range] { flex: 1; accent-color: #44aaff; }
      .cfg-range-val {
        min-width: 40px; text-align: right; font-size: 0.85em; color: #88ccff;
      }
      .cfg-select {
        background: #002255; color: #cceeff; border: 1px solid #336699;
        padding: 3px 6px; font-family: inherit; border-radius: 2px;
        min-width: 110px;
      }
      input[type=checkbox] { accent-color: #44aaff; width: 16px; height: 16px; }
      #cfg-fish-toggles {
        max-height: 320px; overflow-y: auto;
        border: 1px solid #1a3366; padding: 6px 8px; margin-top: 8px;
      }
      .cfg-fish-allrow {
        display: flex; gap: 8px; margin-bottom: 8px;
      }
      .cfg-fish-row {
        display: flex; align-items: center; gap: 8px;
        padding: 3px 0; border-bottom: 1px solid #0a1f44;
      }
      .cfg-fish-label {
        display: flex; align-items: center; gap: 10px;
        cursor: pointer; flex: 1;
      }
      .cfg-fish-name {
        color: #88ddff; font-size: 0.9em;
        text-transform: capitalize;
      }
      .cfg-note { font-size: 0.8em; color: #667799; margin: 8px 0 0; }
      #cfg-footer {
        display: flex; justify-content: flex-end; gap: 10px;
        padding: 10px 16px; border-top: 1px solid #224488;
      }
      .cfg-btn-primary {
        background: #1144aa; color: #cceeff; border: 1px solid #44aaff;
        padding: 6px 18px; cursor: pointer; font-family: inherit;
        border-radius: 2px;
      }
      .cfg-btn-primary:hover { background: #1a55cc; }
      .cfg-btn-secondary {
        background: none; color: #6699cc; border: 1px solid #336699;
        padding: 6px 14px; cursor: pointer; font-family: inherit;
        border-radius: 2px;
      }
      .cfg-btn-secondary:hover { background: #ffffff0a; }
      .cfg-btn-small { padding: 3px 10px; font-size: 0.85em; }
    `;
    document.head.appendChild(style);
  }
}
