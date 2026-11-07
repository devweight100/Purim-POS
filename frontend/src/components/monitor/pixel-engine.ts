/**
 * Tiny pixel-art renderer for the store monitor (no image assets: every sprite is drawn
 * from the small character maps below, at a logical resolution of 320x180).
 */

export const W = 320;
export const H = 180; // minimum height; grows with the number of counter rows
export const ROW_PITCH = 64;
export const WALL_H = 52;

export type Action = 'IDLE' | 'SCANNING' | 'PAYMENT' | 'VOID' | 'DRAWER' | 'CLAIM';
export type Status = 'ONLINE' | 'ACTIVE' | 'IDLE' | 'OFFLINE';

export interface SceneTerminal {
  id: string;
  status: Status;
  action: Action;
  alert: boolean;
  hasShift: boolean;
  itemCount: number;
  seed: number;
  /** today's sales of this terminal (shown on the counter while it is online) */
  sales: number;
}

export interface Slot {
  x: number; // counter top-left (logical px)
  y: number;
  w: number;
  h: number;
}

export interface FloatText {
  x: number;
  y: number;
  text: string;
  color: string;
  born: number;
}

export const PAL = {
  ink: '#1a1423',
  wallTop: '#3b2f52',
  wall: '#4a3b66',
  wallLine: '#5a4a7a',
  floorA: '#2b3a4a',
  floorB: '#314457',
  woodTop: '#c98a4b',
  woodFront: '#8d5a2b',
  woodDark: '#5e3a1c',
  metal: '#7b8794',
  metalDark: '#4b5563',
  screenOff: '#1f2933',
  green: '#4ade80',
  greenDark: '#15803d',
  cyan: '#38bdf8',
  yellow: '#facc15',
  orange: '#fb923c',
  red: '#ef4444',
  white: '#f8fafc',
  skin: ['#f2c9a0', '#e0ac7e', '#c68642', '#8d5524'],
  hair: ['#2d1b12', '#5a3825', '#1c1c1c', '#a0522d', '#6b4c9a'],
  shirt: ['#2563eb', '#16a34a', '#db2777', '#f59e0b', '#7c3aed', '#0d9488', '#dc2626'],
  box: ['#ef4444', '#f59e0b', '#22c55e', '#3b82f6', '#a855f7', '#ec4899', '#14b8a6', '#eab308'],
};

export function hashSeed(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function rng(seed: number) {
  let s = seed || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 10000) / 10000;
  };
}

function rect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, c: string) {
  ctx.fillStyle = c;
  ctx.fillRect(Math.round(x), Math.round(y), w, h);
}

function sprite(ctx: CanvasRenderingContext2D, rows: string[], x: number, y: number, colors: Record<string, string>) {
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    for (let c = 0; c < row.length; c++) {
      const col = colors[row[c]];
      if (col) rect(ctx, x + c, y + r, 1, 1, col);
    }
  }
}

// ---------------------------------------------------------------- pixel font (3x5)
const GLYPHS: Record<string, string> = {
  '0': '111101101101111', '1': '010110010010111', '2': '111001111100111', '3': '111001111001111',
  '4': '101101111001001', '5': '111100111001111', '6': '111100111101111', '7': '111001010010010',
  '8': '111101111101111', '9': '111101111001111', '+': '000010111010000', '-': '000000111000000',
  '.': '000000000000010', ',': '000000000010100', ':': '000010000010000', '/': '001001010100100',
  '%': '101001010100101', '!': '010010010000010', '?': '111001011000010', ' ': '000000000000000',
  '฿': '110101110101110', 'A': '010101111101101', 'B': '110101110101110', 'C': '011100100100011',
  'D': '110101101101110', 'E': '111100110100111', 'F': '111100110100100', 'G': '011100101101011',
  'H': '101101111101101', 'I': '111010010010111', 'K': '101101110101101', 'L': '100100100100111',
  'M': '101111111101101', 'N': '110101101101101', 'O': '010101101101010', 'P': '110101110100100',
  'R': '110101110101101', 'S': '011100010001110', 'T': '111010010010010', 'U': '101101101101111',
  'V': '101101101101010', 'W': '101101111111101', 'X': '101101010101101', 'Y': '101101010010010',
  'Z': '111001010100111',
};

export function textWidth(text: string) {
  return text.length * 4 - 1;
}

export function pixelText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, color: string, shadow = true) {
  const t = text.toUpperCase();
  for (let i = 0; i < t.length; i++) {
    const g = GLYPHS[t[i]] || GLYPHS['?'];
    for (let p = 0; p < 15; p++) {
      if (g[p] !== '1') continue;
      const px = x + i * 4 + (p % 3);
      const py = y + Math.floor(p / 3);
      if (shadow) rect(ctx, px + 1, py + 1, 1, 1, PAL.ink);
      rect(ctx, px, py, 1, 1, color);
    }
  }
}

// ---------------------------------------------------------------- sprites
const CASHIER = [
  '...hhhh...',
  '..hhhhhh..',
  '.hhssssh..',
  '..sesses..',
  '..ssssss..',
  '...smms...',
  '..cccccc..',
  '.cccLLccc.',
  '.scccccs..',
  '.sccccccs.',
];
const CASHIER_BLINK = [...CASHIER];
CASHIER_BLINK[3] = '..ssssss..';

const CUSTOMER_BACK = [
  '..hhhh..',
  '.hhhhhh.',
  '.hhhhhh.',
  '.hhhhhh.',
  '..ssss..',
  '.cccccc.',
  'cccccccc',
  'sccccccs',
  'sccccccs',
  '.cccccc.',
  '.pp..pp.',
  '.pp..pp.',
  '.kk..kk.',
];

const COIN = ['.yy.', 'yYyy', 'yYyy', '.yy.'];

export function layoutSlots(n: number): { slots: Slot[]; height: number; gap: number } {
  if (n <= 0) return { slots: [], height: H, gap: W };
  const rows = Math.ceil(n / 5);
  const perRow = Math.ceil(n / rows);
  const w = 44;
  const h = 20;
  const height = Math.max(H, WALL_H + 36 + rows * ROW_PITCH - 6);
  const firstY = rows === 1 ? Math.round(WALL_H + (height - WALL_H) / 2 - 8) : WALL_H + 34;
  const gap = (W - 40) / perRow;
  const slots: Slot[] = [];
  for (let i = 0; i < n; i++) {
    const r = Math.floor(i / perRow);
    const inRow = Math.min(perRow, n - r * perRow);
    const c = i - r * perRow;
    const rowGap = (W - 40) / inRow;
    const x = 20 + rowGap * c + (rowGap - w) / 2;
    slots.push({ x: Math.round(x), y: firstY + r * ROW_PITCH, w, h });
  }
  return { slots, height, gap };
}

function drawRoom(ctx: CanvasRenderingContext2D, t: number, dbOnline: boolean, height: number) {
  // floor
  for (let y = WALL_H; y < height; y += 10) {
    for (let x = 0; x < W; x += 10) {
      rect(ctx, x, y, 10, 10, ((x + y) / 10) % 2 === 0 ? PAL.floorA : PAL.floorB);
    }
  }
  // wall
  rect(ctx, 0, 0, W, WALL_H, PAL.wall);
  rect(ctx, 0, 0, W, 6, PAL.wallTop);
  for (let x = 0; x < W; x += 16) rect(ctx, x, 6, 1, WALL_H - 6, PAL.wallLine);
  rect(ctx, 0, WALL_H - 3, W, 3, PAL.woodDark);

  // shelves with product boxes
  const r = rng(42);
  for (const sx of [44, 112, 180]) {
    for (const sy of [12, 28]) {
      rect(ctx, sx, sy + 10, 56, 2, PAL.woodFront);
      let x = sx + 1;
      while (x < sx + 54) {
        const bw = 3 + Math.floor(r() * 5);
        const bh = 4 + Math.floor(r() * 6);
        if (x + bw > sx + 55) break;
        rect(ctx, x, sy + 10 - bh, bw, bh, PAL.box[Math.floor(r() * PAL.box.length)]);
        rect(ctx, x, sy + 10 - bh, bw, 1, 'rgba(255,255,255,0.35)');
        x += bw + 1;
      }
    }
  }

  // server rack (the main machine) - LEDs blink while the database answers
  const rx = 8;
  const ry = 8;
  rect(ctx, rx, ry, 22, 40, PAL.ink);
  rect(ctx, rx + 1, ry + 1, 20, 38, PAL.metalDark);
  for (let i = 0; i < 5; i++) {
    const uy = ry + 3 + i * 7;
    rect(ctx, rx + 3, uy, 16, 5, PAL.ink);
    const on = dbOnline ? (Math.floor(t / (180 + i * 70)) + i) % 3 !== 0 : Math.floor(t / 400) % 2 === 0;
    rect(ctx, rx + 5, uy + 2, 2, 1, dbOnline ? (on ? PAL.green : PAL.greenDark) : on ? PAL.red : PAL.ink);
    rect(ctx, rx + 9, uy + 2, 2, 1, on && dbOnline ? PAL.cyan : PAL.ink);
    rect(ctx, rx + 13, uy + 2, 4, 1, PAL.metal);
  }

  // door + plant
  rect(ctx, 270, 10, 30, 42, PAL.woodDark);
  rect(ctx, 272, 12, 26, 40, PAL.woodFront);
  rect(ctx, 274, 14, 22, 16, '#8ecae6');
  rect(ctx, 274, 14, 22, 1, PAL.white);
  rect(ctx, 293, 34, 2, 2, PAL.yellow);
  rect(ctx, 252, 40, 10, 10, PAL.woodFront);
  sprite(ctx, ['..g..g..', '.ggg.gg.', 'gggggggg', '.gGggGg.', '..gggg..'], 249, 33, { g: '#22c55e', G: '#15803d' });
  pixelText(ctx, 'DB', 15, 1, PAL.green, false);
}

function screenColor(term: SceneTerminal, t: number) {
  if (term.status === 'OFFLINE') return PAL.screenOff;
  if (term.alert || term.action === 'VOID') return Math.floor(t / 250) % 2 ? PAL.red : '#7f1d1d';
  switch (term.action) {
    case 'SCANNING':
      return PAL.cyan;
    case 'PAYMENT':
      return PAL.yellow;
    case 'DRAWER':
      return PAL.orange;
    case 'CLAIM':
      return '#c084fc';
    default:
      return term.status === 'IDLE' ? PAL.greenDark : PAL.green;
  }
}

function drawCounter(ctx: CanvasRenderingContext2D, s: Slot, term: SceneTerminal, t: number, selected: boolean) {
  const offline = term.status === 'OFFLINE';
  const seed = term.seed;
  const skin = PAL.skin[seed % PAL.skin.length];
  const hair = PAL.hair[(seed >>> 3) % PAL.hair.length];
  const shirt = PAL.shirt[(seed >>> 6) % PAL.shirt.length];
  const bob = term.status === 'IDLE' ? 0 : Math.floor((t + (seed % 900)) / 600) % 2;

  // shadow
  rect(ctx, s.x + 2, s.y + s.h, s.w, 2, 'rgba(0,0,0,0.35)');

  // cashier behind the counter (only when someone is logged in on that terminal)
  if (!offline) {
    const blink = Math.floor((t + seed) / 180) % 18 === 0;
    sprite(ctx, blink ? CASHIER_BLINK : CASHIER, s.x + 26, s.y - 10 + bob, {
      h: hair,
      s: skin,
      e: PAL.ink,
      m: '#b45309',
      c: shirt,
      L: PAL.white,
    });
  } else if (term.hasShift) {
    // shift open but the machine is not reporting: empty chair + warning
    rect(ctx, s.x + 28, s.y - 6, 7, 6, PAL.metalDark);
  }

  // counter body
  rect(ctx, s.x, s.y, s.w, 4, PAL.woodTop);
  rect(ctx, s.x, s.y + 4, s.w, s.h - 4, PAL.woodFront);
  rect(ctx, s.x, s.y + s.h - 2, s.w, 2, PAL.woodDark);
  for (let x = s.x + 4; x < s.x + s.w - 2; x += 8) rect(ctx, x, s.y + 5, 1, offline ? s.h - 8 : 5, PAL.woodDark);

  // monitor
  const mx = s.x + 6;
  const my = s.y - 10;
  rect(ctx, mx, my, 14, 10, PAL.ink);
  const sc = screenColor(term, t);
  rect(ctx, mx + 1, my + 1, 12, 7, sc);
  if (!offline) {
    // scrolling scan lines on the screen
    const ln = Math.floor(t / 120) % 7;
    rect(ctx, mx + 2, my + 1 + ln, 10, 1, 'rgba(255,255,255,0.35)');
  }
  rect(ctx, mx + 6, my + 10, 2, 1, PAL.metalDark);

  // cash drawer slides out on DRAWER / PAYMENT
  const drawerOpen = !offline && (term.action === 'DRAWER' || term.action === 'PAYMENT');
  rect(ctx, s.x + 24, s.y + 5, 14, 5, drawerOpen ? PAL.metal : PAL.metalDark);
  rect(ctx, s.x + 24, s.y + 5, 14, 1, drawerOpen ? PAL.white : PAL.metal);
  if (drawerOpen) {
    rect(ctx, s.x + 26, s.y + 7, 3, 2, '#22c55e');
    rect(ctx, s.x + 30, s.y + 7, 3, 2, '#3b82f6');
    rect(ctx, s.x + 34, s.y + 7, 2, 2, PAL.yellow);
  }

  // today's sales on a display plate across the counter front (online machines only)
  if (!offline) {
    const amount = Math.round(term.sales || 0);
    let label = '฿' + amount.toLocaleString('en-US');
    if (textWidth(label) > s.w - 6) label = '฿' + (amount / 1000).toFixed(amount >= 100000 ? 0 : 1) + 'K';
    rect(ctx, s.x + 2, s.y + 11, s.w - 4, 7, PAL.ink);
    pixelText(ctx, label, Math.round(s.x + s.w / 2 - textWidth(label) / 2), s.y + 12, PAL.yellow, false);
  }

  // customer in front while there is a cart / payment
  if (!offline && (term.action === 'SCANNING' || term.action === 'PAYMENT' || term.action === 'CLAIM' || term.action === 'VOID')) {
    const cs = (Math.imul(seed, 7) + 13) >>> 0;
    const step = Math.floor(t / 400) % 2;
    sprite(ctx, CUSTOMER_BACK, s.x + 16, s.y + s.h - 4 + step, {
      h: PAL.hair[cs % PAL.hair.length],
      s: PAL.skin[(cs >>> 2) % PAL.skin.length],
      c: PAL.shirt[(cs >>> 4) % PAL.shirt.length],
      p: '#334155',
      k: PAL.ink,
    });
    // basket with item count
    if (term.itemCount > 0) {
      rect(ctx, s.x + 26, s.y + s.h + 4 + step, 7, 5, PAL.metal);
      rect(ctx, s.x + 27, s.y + s.h + 3 + step, 2, 2, PAL.box[(seed >>> 2) % PAL.box.length]);
      rect(ctx, s.x + 30, s.y + s.h + 3 + step, 2, 2, PAL.box[(seed >>> 5) % PAL.box.length]);
    }
  }

  // scanner laser
  if (!offline && term.action === 'SCANNING' && Math.floor(t / 90) % 3 !== 0) {
    rect(ctx, s.x + 2, s.y + 1, 3, 2, PAL.red);
    rect(ctx, s.x + 5, s.y + 2, 6, 1, 'rgba(239,68,68,0.7)');
  }

  // coins hopping during payment
  if (!offline && term.action === 'PAYMENT') {
    const ph = (t % 900) / 900;
    const cx = s.x + 18 + ph * 10;
    const cy = s.y - 2 - Math.sin(ph * Math.PI) * 10;
    sprite(ctx, COIN, cx, cy, { y: PAL.yellow, Y: '#fde68a' });
  }

  // status icon above head
  const iconX = s.x + 30;
  const iconY = s.y - 22 + bob;
  if (!offline && (term.alert || term.action === 'VOID')) {
    if (Math.floor(t / 300) % 2 === 0) {
      rect(ctx, iconX - 1, iconY - 1, 5, 9, PAL.ink);
      rect(ctx, iconX, iconY, 3, 5, PAL.red);
      rect(ctx, iconX, iconY + 6, 3, 1, PAL.red);
    }
  } else if (term.status === 'IDLE') {
    pixelText(ctx, '...', iconX - 3, iconY + 4, PAL.metal);
  }

  // selection frame (pixel corners)
  if (selected) {
    const c = Math.floor(t / 250) % 2 ? PAL.yellow : PAL.white;
    const x0 = s.x - 3;
    const y0 = s.y - 26;
    const x1 = s.x + s.w + 2;
    const y1 = s.y + s.h + 18;
    for (const [x, y, dx, dy] of [
      [x0, y0, 1, 1],
      [x1, y0, -1, 1],
      [x0, y1, 1, -1],
      [x1, y1, -1, -1],
    ]) {
      rect(ctx, Math.min(x, x + dx * 4), y, 5, 1, c);
      rect(ctx, x, Math.min(y, y + dy * 4), 1, 5, c);
    }
  }
}

export function drawScene(
  ctx: CanvasRenderingContext2D,
  t: number,
  terms: SceneTerminal[],
  slots: Slot[],
  floats: FloatText[],
  opts: { dbOnline: boolean; selectedId?: string | null; height: number },
) {
  ctx.imageSmoothingEnabled = false;
  drawRoom(ctx, t, opts.dbOnline, opts.height);
  terms.forEach((term, i) => {
    const s = slots[i];
    if (s) drawCounter(ctx, s, term, t, opts.selectedId === term.id);
  });
  // floating texts (+฿ sales, events)
  for (const f of floats) {
    const age = (t - f.born) / 1000;
    if (age > 2.5) continue;
    const y = f.y - age * 10;
    pixelText(ctx, f.text, Math.round(f.x - textWidth(f.text) / 2), Math.round(y), f.color);
  }
}
