/**
 * The town map: rows of houses facing horizontal roads, a few vertical roads, and a plaza with
 * a fountain in the middle. Everything is derived from the list of homes, so the same town
 * looks the same everywhere.
 */

export const TILE = 16;

export type Ground = "grass" | "road" | "plaza";

export interface Point {
  x: number;
  y: number;
}

export interface Lot {
  /** Top-left tile of the 3x3 house. */
  x: number;
  y: number;
  /** The road tile in front of the door, where the avatar comes out. */
  front: Point;
}

export interface Decor {
  kind: "tree" | "flowers" | "lamp" | "bench";
  x: number;
  y: number;
}

export interface Layout {
  width: number;
  height: number;
  ground: Ground[][];
  lots: Map<string, Lot>;
  plaza: { x: number; y: number; w: number; h: number };
  fountain: Point;
  decor: Decor[];
}

const LOT_STEP = 4; // 3 tiles of house + 1 tile of gap
const ROW_STEP = 6; // 3 tiles of house, the road, 2 tiles of garden
const COLUMNS = 10;
const WIDTH = 2 + COLUMNS * LOT_STEP + 2;

/** A small deterministic random generator, so decorations don't move between reloads. */
export function seeded(seed: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return () => {
    h += 0x6d2b79f5;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Homes in the order they get lots: the viewer and the people's homes nearest the plaza. */
export function lotOrder(homes: { id: string; tier: string }[], viewer?: string): string[] {
  const rank = (h: { id: string; tier: string }) => (h.id === viewer ? 0 : h.tier === "background" ? 2 : 1);
  return [...homes].sort((a, b) => rank(a) - rank(b) || a.id.localeCompare(b.id)).map((h) => h.id);
}

export function buildLayout(homeIds: string[]): Layout {
  const rows = Math.max(3, Math.ceil((homeIds.length + 4) / COLUMNS) + 1);
  const width = WIDTH;
  const height = 4 + rows * ROW_STEP;
  const ground: Ground[][] = Array.from({ length: height }, () => Array<Ground>(width).fill("grass"));
  const roadRows = Array.from({ length: rows }, (_, i) => 4 + i * ROW_STEP);
  const centerColumn = 2 + (COLUMNS / 2) * LOT_STEP - 1;
  const roadColumns = [1, centerColumn, width - 2];

  for (const y of roadRows) for (let x = 1; x < width - 1; x++) ground[y][x] = "road";
  for (const x of roadColumns) for (let y = roadRows[0]; y <= roadRows[rows - 1]; y++) ground[y][x] = "road";

  // The plaza sits between the middle two roads, around the center column.
  const mid = Math.floor((rows - 1) / 2);
  const plaza = { x: centerColumn - 5, y: roadRows[mid] + 1, w: 11, h: ROW_STEP - 1 };
  for (let y = plaza.y; y < plaza.y + plaza.h; y++) for (let x = plaza.x; x < plaza.x + plaza.w; x++) ground[y][x] = "plaza";
  const fountain = { x: centerColumn, y: plaza.y + Math.floor(plaza.h / 2) };

  // Lots: above every road, every LOT_STEP tiles, skipping the center column and the plaza.
  const candidates: Lot[] = [];
  for (const roadY of roadRows) {
    for (let i = 0; i < COLUMNS; i++) {
      const x = 2 + i * LOT_STEP + (i >= COLUMNS / 2 ? 1 : 0);
      const lot = { x, y: roadY - 3, front: { x: x + 1, y: roadY } };
      if (lot.y < 1) continue;
      const overlapsPlaza = lot.y < plaza.y + plaza.h && lot.y + 3 > plaza.y && lot.x < plaza.x + plaza.w && lot.x + 3 > plaza.x;
      if (!overlapsPlaza) candidates.push(lot);
    }
  }
  const center = { x: fountain.x, y: fountain.y };
  candidates.sort(
    (a, b) => Math.hypot(a.x + 1 - center.x, a.y + 1 - center.y) - Math.hypot(b.x + 1 - center.x, b.y + 1 - center.y),
  );
  const lots = new Map<string, Lot>();
  homeIds.forEach((id, i) => {
    if (candidates[i]) lots.set(id, candidates[i]);
  });

  // Decoration on free grass: trees in the gardens, flowers, lamps along the roads.
  const used = new Set<string>();
  for (const lot of lots.values()) for (let dy = 0; dy < 3; dy++) for (let dx = 0; dx < 3; dx++) used.add(`${lot.x + dx},${lot.y + dy}`);
  const rand = seeded(`decor:${homeIds.length}`);
  const decor: Decor[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (ground[y][x] !== "grass" || used.has(`${x},${y}`)) continue;
      const r = rand();
      if (r < 0.1) decor.push({ kind: "tree", x, y });
      else if (r < 0.17) decor.push({ kind: "flowers", x, y });
    }
  }
  for (const y of roadRows) for (let x = 3; x < width - 3; x += 8) if (ground[y - 1]?.[x] === "grass" && !used.has(`${x},${y - 1}`)) decor.push({ kind: "lamp", x, y: y - 1 });
  decor.push({ kind: "bench", x: plaza.x + 1, y: plaza.y + 1 }, { kind: "bench", x: plaza.x + plaza.w - 2, y: plaza.y + 1 });
  return { width, height, ground, lots, plaza, fountain, decor };
}

/** Shortest walk over roads and the plaza (breadth-first; the map is small). */
export function walkPath(layout: Layout, from: Point, to: Point): Point[] {
  const key = (p: Point) => p.y * layout.width + p.x;
  const walkable = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < layout.width && y < layout.height && layout.ground[y][x] !== "grass";
  const previous = new Map<number, number>([[key(from), -1]]);
  const queue: Point[] = [from];
  while (queue.length) {
    const p = queue.shift()!;
    if (p.x === to.x && p.y === to.y) break;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const n = { x: p.x + dx, y: p.y + dy };
      if (!walkable(n.x, n.y) || previous.has(key(n))) continue;
      previous.set(key(n), key(p));
      queue.push(n);
    }
  }
  if (!previous.has(key(to))) return [from, to];
  const path: Point[] = [];
  for (let k = key(to); k !== -1; k = previous.get(k)!) path.push({ x: k % layout.width, y: Math.floor(k / layout.width) });
  return path.reverse();
}
