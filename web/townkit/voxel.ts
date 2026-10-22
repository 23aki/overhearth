/**
 * The block world: pixel textures drawn in code, and builders that place blocks for houses,
 * trees, the fountain and every landmark. One tile of the town map is 4x4 blocks; a lot
 * (3x3 tiles) is 12x12 blocks, its front (+z) facing the road.
 */
import * as THREE from "three";
import { seeded } from "./layout";

/** One block, in tiles (world units). */
export const V = 0.25;

export type BlockKind =
  | "dirt"
  | "stone"
  | "cobble"
  | "bricks"
  | "planks"
  | "darkplanks"
  | "log"
  | "leaves"
  | "wool"
  | "plaster"
  | "sand"
  | "water"
  | "glow"
  | "window"
  | "flower";

/** Kinds whose color comes from each block (`color`), on a light texture. */
const TINTED = new Set<BlockKind>(["wool", "plaster", "glow", "window", "flower"]);

type Paint = (ctx: CanvasRenderingContext2D, s: number) => void;

function canvasTexture(w: number, h: number, paint: (ctx: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;
  paint(ctx);
  const t = new THREE.CanvasTexture(canvas);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestMipmapNearestFilter;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function px(ctx: CanvasRenderingContext2D, color: string, x: number, y: number, w = 1, h = 1): void {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
}

function noise(seed: string, base: string, specks: string[], count: number): Paint {
  return (ctx, s) => {
    px(ctx, base, 0, 0, s, s);
    const r = seeded(seed);
    for (let i = 0; i < count; i++) px(ctx, specks[Math.floor(r() * specks.length)], Math.floor(r() * s), Math.floor(r() * s));
  };
}

const PAINT: Record<string, Paint> = {
  grass: noise("grass", "#6aa84f", ["#78b85b", "#5d9a45", "#86c46a", "#558f3e"], 70),
  grassSide: (ctx, s) => {
    noise("dirt", "#8a6240", ["#7a5535", "#9b7250", "#6e4b2e"], 60)(ctx, s);
    const r = seeded("grassSide");
    for (let x = 0; x < s; x++) px(ctx, x % 3 ? "#6aa84f" : "#5d9a45", x, 0, 1, 3 + Math.floor(r() * 2));
  },
  dirt: noise("dirt", "#8a6240", ["#7a5535", "#9b7250", "#6e4b2e"], 60),
  road: noise("road", "#d7bd84", ["#c9ad72", "#e3cc96", "#bba065", "#cfb47b"], 80),
  plaza: (ctx, s) => {
    px(ctx, "#b9b3a6", 0, 0, s, s);
    noise("plaza", "#b9b3a6", ["#c6c0b3", "#aaa395"], 30)(ctx, s);
    ctx.fillStyle = "#958e80";
    ctx.fillRect(0, 0, s, 1);
    ctx.fillRect(0, s / 2, s, 1);
    ctx.fillRect(0, 0, 1, s / 2);
    ctx.fillRect(s / 2, s / 2, 1, s / 2);
  },
  stone: noise("stone", "#9a9a9a", ["#8a8a8a", "#a8a8a8", "#7d7d7d"], 60),
  cobble: (ctx, s) => {
    noise("cobble", "#8f8f8f", ["#7a7a7a", "#a5a5a5", "#6b6b6b"], 90)(ctx, s);
    const r = seeded("cobbleLines");
    for (let i = 0; i < 10; i++) px(ctx, "#5f5f5f", Math.floor(r() * s), Math.floor(r() * s), 3, 1);
  },
  bricks: (ctx, s) => {
    px(ctx, "#a85a43", 0, 0, s, s);
    for (let y = 0; y < s; y += 4) {
      px(ctx, "#c8bfb0", 0, y + 3, s, 1);
      for (let x = (y / 4) % 2 ? 0 : 4; x < s; x += 8) px(ctx, "#c8bfb0", x, y, 1, 3);
    }
    noise("bricks", "rgba(0,0,0,0)", ["#954c37", "#b8664d"], 25)(ctx, s);
  },
  planks: (ctx, s) => {
    noise("planks", "#b08a55", ["#a17d4b", "#bd9862", "#9a7645"], 40)(ctx, s);
    for (let y = 3; y < s; y += 4) px(ctx, "#7d5f36", 0, y, s, 1);
    for (let y = 0; y < s; y += 4) px(ctx, "#7d5f36", ((y * 5) % s) | 0, y, 1, 3);
  },
  darkplanks: (ctx, s) => {
    noise("darkplanks", "#5c3f26", ["#4f361f", "#6a4a2e"], 40)(ctx, s);
    for (let y = 3; y < s; y += 4) px(ctx, "#3d2915", 0, y, s, 1);
  },
  logSide: (ctx, s) => {
    px(ctx, "#6b4a2b", 0, 0, s, s);
    const r = seeded("log");
    for (let x = 0; x < s; x++) if (r() < 0.45) px(ctx, r() < 0.5 ? "#5a3d22" : "#7a5634", x, 0, 1, s);
  },
  logTop: (ctx, s) => {
    px(ctx, "#6b4a2b", 0, 0, s, s);
    px(ctx, "#b58e5a", 2, 2, s - 4, s - 4);
    px(ctx, "#9c7646", 5, 5, s - 10, s - 10);
  },
  leaves: (ctx, s) => {
    noise("leaves", "#3f8a39", ["#357a31", "#4d9c45", "#2c6a29", "#5aa850"], 120)(ctx, s);
  },
  wool: noise("wool", "#f2f2f2", ["#e2e2e2", "#ffffff", "#d8d8d8"], 70),
  plaster: noise("plaster", "#f4f1ea", ["#ebe6dc", "#faf8f3"], 30),
  sand: noise("sand", "#e6d39a", ["#d9c48a", "#efdfad", "#d2bd7f"], 70),
  water: (ctx, s) => {
    px(ctx, "#3d7fd1", 0, 0, s, s);
    const r = seeded("water");
    for (let i = 0; i < 14; i++) px(ctx, r() < 0.5 ? "#5b9be3" : "#7fb6ef", Math.floor(r() * s), Math.floor(r() * s), 3, 1);
  },
  glow: (ctx, s) => {
    px(ctx, "#ffffff", 0, 0, s, s);
    px(ctx, "#e8e8e8", 0, 0, s, 1);
    px(ctx, "#e8e8e8", 0, 0, 1, s);
  },
  window: (ctx, s) => {
    px(ctx, "#ffffff", 0, 0, s, s);
    px(ctx, "#bfbfbf", 0, 0, s, 1);
    px(ctx, "#bfbfbf", 0, 0, 1, s);
    px(ctx, "#bfbfbf", s / 2, 0, 1, s);
    px(ctx, "#bfbfbf", 0, s / 2, s, 1);
  },
};

function blockTexture(name: string): THREE.CanvasTexture {
  return canvasTexture(16, 16, (ctx) => PAINT[name](ctx, 16));
}

/** A tile-sized ground texture: 4x4 blocks of `name`, each block a little different. */
function tileTexture(name: string, rows = 4): THREE.CanvasTexture {
  return canvasTexture(64, rows * 16, (ctx) => {
    const one = document.createElement("canvas");
    one.width = one.height = 16;
    const c = one.getContext("2d")!;
    PAINT[name](c, 16);
    for (let y = 0; y < rows; y++)
      for (let x = 0; x < 4; x++) {
        ctx.save();
        ctx.translate(x * 16 + ((x + y) % 2 ? 16 : 0), y * 16);
        ctx.scale((x + y) % 2 ? -1 : 1, 1);
        ctx.drawImage(one, 0, 0);
        ctx.restore();
      }
  });
}

export interface Materials {
  blocks: Record<BlockKind, THREE.Material | THREE.Material[]>;
  ground: Record<"grass" | "road" | "plaza", THREE.Material[]>;
  island: THREE.Material[];
  water: THREE.CanvasTexture;
}

export function makeMaterials(): Materials {
  const lambert = (map: THREE.Texture, tinted = false) => new THREE.MeshLambertMaterial({ map, vertexColors: false, color: tinted ? 0xffffff : 0xffffff });
  const t = (n: string) => blockTexture(n);
  const water = t("water");
  water.wrapS = water.wrapT = THREE.RepeatWrapping;
  const logSide = lambert(t("logSide"));
  const logTop = lambert(t("logTop"));
  const blocks: Record<BlockKind, THREE.Material | THREE.Material[]> = {
    dirt: lambert(t("dirt")),
    stone: lambert(t("stone")),
    cobble: lambert(t("cobble")),
    bricks: lambert(t("bricks")),
    planks: lambert(t("planks")),
    darkplanks: lambert(t("darkplanks")),
    log: [logSide, logSide, logTop, logTop, logSide, logSide],
    leaves: lambert(t("leaves")),
    wool: lambert(t("wool"), true),
    plaster: lambert(t("plaster"), true),
    sand: lambert(t("sand")),
    water: new THREE.MeshLambertMaterial({ map: water, transparent: true, opacity: 0.85 }),
    glow: new THREE.MeshBasicMaterial({ map: t("glow") }),
    window: new THREE.MeshBasicMaterial({ map: t("window") }),
    flower: new THREE.MeshLambertMaterial({ color: 0xffffff }),
  };
  const grassTop = lambert(tileTexture("grass"));
  const grassSide = lambert(tileTexture("grassSide", 1));
  const dirt = lambert(tileTexture("dirt", 1));
  const side = (m: THREE.Material) => [m, m, grassTop, dirt, m, m];
  const road = lambert(tileTexture("road"));
  const plaza = lambert(tileTexture("plaza"));
  const ground = {
    grass: side(grassSide),
    road: [grassSide, grassSide, road, dirt, grassSide, grassSide],
    plaza: [grassSide, grassSide, plaza, dirt, grassSide, grassSide],
  };
  const islandTexture = t("dirt");
  islandTexture.wrapS = islandTexture.wrapT = THREE.RepeatWrapping;
  const island = [lambert(islandTexture)];
  return { blocks, ground, island, water };
}

/** Blocks collected by kind, then drawn as one instanced mesh per kind. */
export class Voxels {
  readonly items = new Map<BlockKind, { at: number[]; colors: number[] }>();

  /** One block at block coordinates (x, y, z); y = 0 is the first layer above the ground. */
  add(kind: BlockKind, x: number, y: number, z: number, color = 0xffffff): number {
    let item = this.items.get(kind);
    if (!item) this.items.set(kind, (item = { at: [], colors: [] }));
    item.at.push(x, y, z);
    item.colors.push(color);
    return item.colors.length - 1;
  }

  /** Every block in the inclusive box. */
  box(kind: BlockKind, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, color = 0xffffff): void {
    for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++)
      for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++)
        for (let z = Math.min(z0, z1); z <= Math.max(z0, z1); z++) this.add(kind, x, y, z, color);
  }

  build(materials: Materials, shadows = true): THREE.InstancedMesh[] {
    const geometry = new THREE.BoxGeometry(V, V, V);
    // Flowers are small: a blossom on the ground, not a whole block.
    const flower = new THREE.BoxGeometry(V * 0.35, V * 0.35, V * 0.35).translate(0, -V * 0.3, 0);
    const meshes: THREE.InstancedMesh[] = [];
    const m = new THREE.Matrix4();
    const c = new THREE.Color();
    for (const [kind, { at, colors }] of this.items) {
      const mesh = new THREE.InstancedMesh(kind === "flower" ? flower : geometry, materials.blocks[kind], colors.length);
      for (let i = 0; i < colors.length; i++) {
        // Blocks set into the ground (y < 0) sit a hair above it, so they don't flicker against it.
        const y = at[i * 3 + 1];
        m.makeTranslation((at[i * 3] + 0.5) * V, (y + 0.5) * V + (y < 0 ? 0.004 : 0), (at[i * 3 + 2] + 0.5) * V);
        mesh.setMatrixAt(i, m);
        mesh.setColorAt(i, c.setHex(TINTED.has(kind) ? colors[i] : 0xffffff));
      }
      mesh.castShadow = shadows && kind !== "water" && kind !== "window";
      mesh.receiveShadow = shadows;
      mesh.name = kind;
      meshes.push(mesh);
    }
    return meshes;
  }
}

// ---- builders (block coordinates; a lot starts at (ox, oz) and is 12x12) ------------------

export const ROOF_COLORS = [0xc4553e, 0x3f6fb5, 0x5b8f3a, 0x8a4fa8, 0xd08a2c, 0x2f8f8a, 0xb5476e, 0x6d6a8f];
export const WALL_COLORS = [0xf4ead2, 0xf6efe6, 0xefe0c4, 0xe8eef2, 0xf3e3d3];

export interface HouseBlocks {
  /** Window block indices (in the "window" kind), to light them per house. */
  windows: number[];
}

/** A small house with a stepped gable roof, its door on the front (+z) facing the road. */
export function house(v: Voxels, ox: number, oz: number, roof: number, wall: number): HouseBlocks {
  const windows: number[] = [];
  v.box("cobble", ox + 1, 0, oz + 2, ox + 10, 0, oz + 9);
  for (let y = 1; y <= 4; y++) {
    for (let x = ox + 1; x <= ox + 10; x++)
      for (let z = oz + 2; z <= oz + 9; z++) {
        const edgeX = x === ox + 1 || x === ox + 10;
        const edgeZ = z === oz + 2 || z === oz + 9;
        if (!edgeX && !edgeZ) continue;
        const corner = edgeX && edgeZ;
        const door = z === oz + 9 && (x === ox + 5 || x === ox + 6) && y <= 3;
        const windowFront = (z === oz + 9 || z === oz + 2) && (x === ox + 2 || x === ox + 3 || x === ox + 8 || x === ox + 9) && (y === 2 || y === 3);
        const windowSide = edgeX && !corner && (z === oz + 5 || z === oz + 6) && (y === 2 || y === 3);
        if (corner) v.add("log", x, y, z);
        else if (door) v.add("darkplanks", x, y, z);
        else if (windowFront || windowSide) windows.push(v.add("window", x, y, z, 0x2a3348));
        else v.add("plaster", x, y, z, wall);
      }
  }
  // Roof: stepped like stairs from both sides to the ridge, with plaster gables.
  for (let k = 0; k <= 4; k++) {
    for (let x = ox; x <= ox + 11; x++) {
      v.add("wool", x, 5 + k, oz + 1 + k, roof);
      v.add("wool", x, 5 + k, oz + 10 - k, roof);
    }
    if (k <= 3) for (const x of [ox + 1, ox + 10]) for (let z = oz + 2 + k; z <= oz + 9 - k; z++) v.add("plaster", x, 5 + k, z, wall);
  }
  v.box("bricks", ox + 8, 8, oz + 4, ox + 8, 10, oz + 4);
  return { windows };
}

export function tree(v: Voxels, ox: number, oz: number, seed: string): void {
  const r = seeded(seed);
  const h = 3 + Math.floor(r() * 2);
  v.box("log", ox + 2, 0, oz + 2, ox + 2, h - 1, oz + 2);
  for (let x = -2; x <= 2; x++)
    for (let y = 0; y <= 2; y++)
      for (let z = -2; z <= 2; z++) {
        const corner = Math.abs(x) === 2 && Math.abs(z) === 2;
        if ((corner && (y !== 1 || r() < 0.7)) || (y === 2 && (Math.abs(x) === 2 || Math.abs(z) === 2) && r() < 0.5)) continue;
        v.add("leaves", ox + 2 + x, h + y, oz + 2 + z);
      }
  v.add("leaves", ox + 2, h + 3, oz + 2);
}

export function lamp(v: Voxels, ox: number, oz: number): number {
  v.box("darkplanks", ox + 2, 0, oz + 2, ox + 2, 4, oz + 2);
  return v.add("glow", ox + 2, 5, oz + 2, 0xffe2a0);
}

export function bench(v: Voxels, ox: number, oz: number): void {
  v.box("planks", ox + 1, 0, oz + 2, ox + 3, 0, oz + 2);
  v.box("darkplanks", ox + 1, 1, oz + 3, ox + 3, 1, oz + 3);
}

/** The fountain, centered on block (cx, cz). Returns the water blocks' kind count for animation. */
export function fountain(v: Voxels, cx: number, cz: number): void {
  for (let x = -4; x <= 3; x++)
    for (let z = -4; z <= 3; z++) {
      const edge = x === -4 || x === 3 || z === -4 || z === 3;
      if (edge) v.add("cobble", cx + x, 0, cz + z);
      else v.add("water", cx + x, 0, cz + z);
    }
  v.box("stone", cx - 1, 0, cz - 1, cx, 2, cz);
  v.box("cobble", cx - 2, 3, cz - 2, cx + 1, 3, cz + 1);
  v.box("water", cx - 1, 3, cz - 1, cx, 3, cz);
  v.box("water", cx - 1, 4, cz - 1, cx, 4, cz);
}

// ---- landmarks ------------------------------------------------------------------------

const RED = 0xd6453d;
const WHITE = 0xfbf3e6;

function walls(v: Voxels, ox: number, oz: number, x0: number, z0: number, x1: number, z1: number, h: number, kind: BlockKind, color: number, windows = true): void {
  for (let y = 1; y <= h; y++)
    for (let x = ox + x0; x <= ox + x1; x++)
      for (let z = oz + z0; z <= oz + z1; z++) {
        const edge = x === ox + x0 || x === ox + x1 || z === oz + z0 || z === oz + z1;
        if (!edge) continue;
        const win = windows && y >= 2 && y <= 3 && (x - ox) % 3 === 0 && z === oz + z1;
        if (win) v.add("window", x, y, z, 0x2a3348);
        else v.add(kind, x, y, z, color);
      }
  v.box("cobble", ox + x0, 0, oz + z0, ox + x1, 0, oz + z1);
}

function gable(v: Voxels, ox: number, oz: number, x0: number, x1: number, z0: number, z1: number, y0: number, color: number, wall: number): void {
  for (let k = 0; z0 + k <= z1 - k; k++) {
    for (let x = ox + x0; x <= ox + x1; x++) {
      v.add("wool", x, y0 + k, oz + z0 + k, color);
      if (z1 - k !== z0 + k) v.add("wool", x, y0 + k, oz + z1 - k, color);
    }
    for (const x of [ox + x0 + 1, ox + x1 - 1]) for (let z = oz + z0 + k + 1; z <= oz + z1 - k - 1; z++) v.add("plaster", x, y0 + k, z, wall);
  }
}

function door(v: Voxels, x: number, z: number, w = 2, h = 3): void {
  for (let dx = 0; dx < w; dx++) for (let y = 1; y <= h; y++) v.add("darkplanks", x + dx, y, z);
}

function awning(v: Voxels, x0: number, x1: number, y: number, z: number, a: number, b: number): void {
  for (let x = x0; x <= x1; x++) {
    v.add("wool", x, y, z, (x - x0) % 2 ? b : a);
    v.add("wool", x, y - 1, z + 1, (x - x0) % 2 ? b : a);
  }
}

function flowers(v: Voxels, x0: number, z0: number, x1: number, z1: number, seed: string): void {
  const r = seeded(seed);
  const colors = [0xe86f8a, 0xf2c14e, 0xc3a6f2, 0xf4f1e8, 0xf28f4e];
  for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) if (r() < 0.55) v.add("flower", x, 0, z, colors[Math.floor(r() * colors.length)]);
}

type Builder = (v: Voxels, ox: number, oz: number, bigger: boolean) => void;

export const LANDMARKS: Record<string, Builder> = {
  bakery: (v, ox, oz, bigger) => {
    walls(v, ox, oz, 1, 2, 10, 9, 4, "plaster", 0xf6e7cf);
    door(v, ox + 7, oz + 9);
    gable(v, ox, oz, 0, 11, 1, 10, 5, 0xa0522d, 0xf6e7cf);
    awning(v, ox + 1, ox + 10, 5, oz + 10, RED, WHITE);
    v.box("wool", ox + 2, 2, oz + 10, ox + 5, 2, oz + 10, 0xd9a35b); // bread in the window
    v.box("glow", ox + 4, 7, oz + 10, ox + 7, 7, oz + 10, 0xf3c46a); // the sign
    if (bigger) {
      v.box("bricks", ox + 2, 8, oz + 4, ox + 2, 11, oz + 4);
      v.box("planks", ox + 1, 0, oz + 11, ox + 3, 0, oz + 11);
      v.box("glow", ox + 5, 8, oz + 10, ox + 6, 8, oz + 10, 0xffd700);
    }
  },
  library: (v, ox, oz, bigger) => {
    walls(v, ox, oz, 1, 2, 10, 9, 5, "stone", 0xffffff, false);
    for (const x of [2, 4, 7, 9]) v.box("plaster", ox + x, 1, oz + 10, ox + x, 5, oz + 10, 0xf2eee5);
    door(v, ox + 5, oz + 9, 2, 4);
    v.box("stone", ox, 6, oz + 1, ox + 11, 6, oz + 10);
    for (let k = 0; k <= 3; k++) v.box("stone", ox + 1 + k, 7 + k, oz + 10, ox + 10 - k, 7 + k, oz + 10);
    const books = [0xc4553e, 0x3f6fb5, 0x5b8f3a, 0xf2c14e];
    books.forEach((c, i) => v.add("wool", ox + 4 + i, 8, oz + 11, c));
    v.box("stone", ox, 0, oz + 11, ox + 11, 0, oz + 11);
    if (bigger) {
      v.box("stone", ox + 5, 7, oz + 4, ox + 6, 12, oz + 5);
      v.box("glow", ox + 5, 11, oz + 6, ox + 6, 11, oz + 6, 0xf4f1e8);
      v.box("wool", ox + 5, 13, oz + 4, ox + 6, 13, oz + 5, 0x3f6fb5);
    }
  },
  garden: (v, ox, oz, bigger) => {
    for (let x = ox; x <= ox + 11; x++)
      for (let z = oz + 1; z <= oz + 11; z++) {
        const edge = x === ox || x === ox + 11 || z === oz + 1 || z === oz + 11;
        if (edge && !(z === oz + 11 && (x === ox + 5 || x === ox + 6))) v.box("leaves", x, 0, z, x, 1, z);
      }
    v.box("sand", ox + 5, 0, oz + 2, ox + 6, 0, oz + 10);
    flowers(v, ox + 1, oz + 2, ox + 4, oz + 6, "g1");
    flowers(v, ox + 7, oz + 2, ox + 10, oz + 6, "g2");
    v.box("water", ox + 1, 0, oz + 8, ox + 3, 0, oz + 10);
    v.box("planks", ox + 5, 2, oz + 11, ox + 6, 3, oz + 11);
    v.box("planks", ox + 4, 0, oz + 11, ox + 4, 3, oz + 11);
    v.box("planks", ox + 7, 0, oz + 11, ox + 7, 3, oz + 11);
    tree(v, ox + 6, oz + 6, "gardentree");
    if (bigger) {
      for (let x = ox + 1; x <= ox + 4; x++) for (let y = 0; y <= 3; y++) for (let z = oz + 2; z <= oz + 5; z++)
        if (x === ox + 1 || x === ox + 4 || z === oz + 2 || z === oz + 5 || y === 3) v.add("window", x, y, z, 0xcfeeff);
      flowers(v, ox + 8, oz + 8, ox + 10, oz + 10, "g3");
    }
  },
  clinic: (v, ox, oz, bigger) => {
    walls(v, ox, oz, 1, 2, 10, 9, 4, "plaster", 0xffffff);
    door(v, ox + 5, oz + 9);
    v.box("wool", ox, 5, oz + 1, ox + 11, 5, oz + 10, 0x5d8fd0);
    v.box("wool", ox + 4, 4, oz + 10, ox + 7, 4, oz + 10, 0xffffff);
    v.box("wool", ox + 5, 6, oz + 10, ox + 6, 9, oz + 10, RED);
    v.box("wool", ox + 4, 7, oz + 10, ox + 7, 8, oz + 10, RED);
    if (bigger) {
      walls(v, ox, oz + 0, 2, 3, 9, 8, 0, "plaster", 0xffffff);
      for (let y = 6; y <= 8; y++) for (let x = ox + 2; x <= ox + 9; x++) for (const z of [oz + 3, oz + 8]) v.add(x % 3 ? "plaster" : "window", x, y, z, x % 3 ? 0xffffff : 0x2a3348);
      v.box("wool", ox + 1, 9, oz + 2, ox + 10, 9, oz + 9, 0x5d8fd0);
      v.box("leaves", ox + 1, 0, oz + 10, ox + 2, 1, oz + 10);
      v.box("leaves", ox + 9, 0, oz + 10, ox + 10, 1, oz + 10);
    }
  },
  playground: (v, ox, oz, bigger) => {
    v.box("sand", ox, -1, oz + 1, ox + 11, -1, oz + 11);
    v.box("stone", ox + 1, 0, oz + 3, ox + 1, 4, oz + 3);
    v.box("stone", ox + 3, 0, oz + 3, ox + 3, 4, oz + 3);
    v.box("wool", ox + 1, 5, oz + 2, ox + 3, 5, oz + 4, 0x3f6fb5);
    for (let k = 0; k < 5; k++) v.add("wool", ox + 2, 4 - k, oz + 5 + k, RED);
    v.box("wool", ox + 7, 0, oz + 3, ox + 7, 4, oz + 3, 0x3b5fa8);
    v.box("wool", ox + 10, 0, oz + 3, ox + 10, 4, oz + 3, 0x3b5fa8);
    v.box("wool", ox + 7, 5, oz + 3, ox + 10, 5, oz + 3, 0x3b5fa8);
    v.add("wool", ox + 8, 1, oz + 3, 0xf2c14e);
    v.add("wool", ox + 9, 1, oz + 3, 0xf2c14e);
    v.add("wool", ox + 6, 0, oz + 9, 0xf28f8f);
    if (bigger) {
      v.box("stone", ox + 8, 0, oz + 8, ox + 8, 1, oz + 8);
      v.box("wool", ox + 7, 2, oz + 7, ox + 9, 2, oz + 9, 0xf2c14e);
      v.box("planks", ox + 1, 1, oz + 10, ox + 5, 1, oz + 10);
      v.add("stone", ox + 3, 0, oz + 10);
      for (let x = ox; x <= ox + 11; x++) v.add("wool", x, 6, oz + 1, [RED, 0xf2c14e, 0x3f6fb5, 0x5b8f3a][x % 4]);
    }
  },
  cafe: (v, ox, oz, bigger) => {
    walls(v, ox, oz, 3, 2, 10, 9, 4, "plaster", 0xf2e0c9);
    door(v, ox + 8, oz + 9);
    gable(v, ox, oz, 2, 11, 1, 10, 5, 0x2f8f8a, 0xf2e0c9);
    awning(v, ox + 3, ox + 10, 5, oz + 10, 0x2f8f8a, WHITE);
    v.box("darkplanks", ox + 5, 7, oz + 10, ox + 7, 7, oz + 10);
    // terrace: a table and an umbrella
    v.box("planks", ox, 1, oz + 9, ox + 1, 1, oz + 10);
    v.box("darkplanks", ox + 1, 0, oz + 9, ox + 1, 4, oz + 9);
    v.box("wool", ox, 5, oz + 8, ox + 2, 5, oz + 10, 0xe86f8a);
    if (bigger) {
      for (let x = ox + 3; x <= ox + 10; x += 2) v.add("glow", x, 6, oz + 11, 0xfbe7a1);
      v.box("darkplanks", ox + 1, 0, oz + 4, ox + 1, 4, oz + 4);
      v.box("wool", ox, 5, oz + 3, ox + 2, 5, oz + 5, 0x2f8f8a);
    }
  },
  bathhouse: (v, ox, oz, bigger) => {
    walls(v, ox, oz, 1, 2, 10, 9, 4, "plaster", 0xefe3c8);
    for (const x of [1, 5, 10]) v.box("log", ox + x, 1, oz + 9, ox + x, 4, oz + 9);
    v.box("wool", ox + 6, 1, oz + 10, ox + 8, 3, oz + 10, 0x3f6fb5);
    door(v, ox + 6, oz + 9, 3, 2);
    for (let k = 0; k <= 4; k++) v.box("wool", ox - 1 + k, 5 + k, oz + k, ox + 12 - k, 5 + k, oz + 11 - k, 0x4a5266);
    v.box("stone", ox + 9, 5, oz + 3, ox + 10, 13, oz + 4);
    if (bigger) {
      for (const [x, y, z] of [[9, 14, 3], [10, 15, 4], [9, 16, 4]]) v.add("wool", ox + x, y, oz + z, 0xf4f4f4);
      v.add("glow", ox + 2, 4, oz + 10, RED);
      v.add("glow", ox + 9, 4, oz + 10, RED);
    }
  },
  stage: (v, ox, oz, bigger) => {
    v.box("planks", ox, 0, oz + 3, ox + 11, 1, oz + 9);
    v.box("wool", ox + 1, 2, oz + 2, ox + 10, 7, oz + 2, 0x9c2f3f);
    v.box("wool", ox + 1, 2, oz + 3, ox + 1, 7, oz + 6, 0x9c2f3f);
    v.box("wool", ox + 10, 2, oz + 3, ox + 10, 7, oz + 6, 0x9c2f3f);
    v.box("darkplanks", ox, 8, oz + 1, ox + 11, 8, oz + 7);
    for (let x = ox + 1; x <= ox + 10; x += 2) v.add("glow", x, 7, oz + 7, 0xfbe7a1);
    v.box("glow", ox + 5, 4, oz + 3, ox + 6, 5, oz + 3, 0xf2c14e);
    if (bigger) {
      v.box("darkplanks", ox, 2, oz + 8, ox, 4, oz + 9);
      v.box("darkplanks", ox + 11, 2, oz + 8, ox + 11, 4, oz + 9);
      for (let x = ox; x <= ox + 11; x++) v.add("wool", x, 9, oz + 7, [RED, 0xf2c14e, 0x7ec8e3][x % 3]);
    }
  },
  market: (v, ox, oz, bigger) => {
    const stalls: [number, number, number[]][] = [
      [0, RED, [0xe8504b, 0xf2a33a]],
      [4, 0xf2c14e, [0xf2c14e, 0xa6d96a]],
      [8, 0x5b8f3a, [0x7fb24a, 0xc3a6f2]],
    ];
    for (const [x, color, fruit] of stalls) {
      v.box("log", ox + x, 0, oz + 4, ox + x, 4, oz + 4);
      v.box("log", ox + x + 3, 0, oz + 4, ox + x + 3, 4, oz + 4);
      v.box("log", ox + x, 0, oz + 8, ox + x, 4, oz + 8);
      v.box("log", ox + x + 3, 0, oz + 8, ox + x + 3, 4, oz + 8);
      for (let dx = 0; dx <= 3; dx++) for (let z = oz + 4; z <= oz + 8; z++) v.add("wool", ox + x + dx, 5, z, dx % 2 ? WHITE : color);
      v.box("planks", ox + x, 0, oz + 9, ox + x + 3, 1, oz + 9);
      for (let dx = 0; dx <= 3; dx++) v.add("wool", ox + x + dx, 2, oz + 9, fruit[dx % 2]);
    }
    if (bigger) {
      for (let x = ox; x <= ox + 11; x++) v.add("wool", x, 7, oz + 10, [RED, 0xf2c14e, 0x3f6fb5, 0x5b8f3a][x % 4]);
      v.box("planks", ox + 1, 0, oz + 11, ox + 2, 0, oz + 11);
      v.box("planks", ox + 9, 0, oz + 11, ox + 10, 0, oz + 11);
    }
  },
  workshop: (v, ox, oz, bigger) => {
    walls(v, ox, oz, 1, 2, 10, 9, 4, "bricks", 0xffffff, false);
    door(v, ox + 4, oz + 9, 4, 4);
    gable(v, ox, oz, 0, 11, 1, 10, 5, 0x4a4f5c, 0xc9bfae);
    v.box("stone", ox + 5, 7, oz + 10, ox + 6, 8, oz + 10);
    v.box("log", ox + 11, 0, oz + 10, ox + 11, 0, oz + 11);
    v.box("log", ox + 10, 0, oz + 11, ox + 10, 1, oz + 11);
    if (bigger) {
      v.box("glow", ox + 5, 7, oz + 11, ox + 6, 8, oz + 11, 0xf2c14e);
      v.box("stone", ox + 8, 8, oz + 4, ox + 8, 11, oz + 4);
      v.box("planks", ox, 0, oz + 10, ox + 2, 1, oz + 11);
    }
  },
  petpark: (v, ox, oz, bigger) => {
    for (let x = ox; x <= ox + 11; x++)
      for (let z = oz + 1; z <= oz + 11; z++) {
        const edge = x === ox || x === ox + 11 || z === oz + 1 || z === oz + 11;
        const gate = z === oz + 11 && x >= ox + 5 && x <= ox + 6;
        if (edge && !gate) v.add(((x + z) % 2 === 0 ? "planks" : "darkplanks") as BlockKind, x, 0, z);
      }
    v.box("planks", ox + 2, 0, oz + 3, ox + 5, 2, oz + 6);
    v.box("darkplanks", ox + 3, 0, oz + 6, ox + 4, 1, oz + 6);
    gable(v, ox, oz, 1, 6, 2, 7, 3, RED, 0xf4f1e8);
    v.box("wool", ox + 8, 0, oz + 8, ox + 9, 0, oz + 8, 0xf4f1e8);
    v.add("wool", ox + 9, 0, oz + 4, 0xf2c14e);
    if (bigger) {
      v.box("wool", ox + 7, 0, oz + 3, ox + 7, 1, oz + 6, 0x3f6fb5);
      v.box("wool", ox + 10, 0, oz + 3, ox + 10, 1, oz + 6, 0x3f6fb5);
      v.box("wool", ox + 7, 2, oz + 3, ox + 10, 2, oz + 6, 0x3f6fb5);
      v.box("wool", ox + 2, 1, oz + 9, ox + 4, 1, oz + 9, RED);
    }
  },
};

/** A lot waiting for a landmark: dug earth, string and a sign. */
export function site(v: Voxels, ox: number, oz: number): void {
  v.box("dirt", ox + 1, -1, oz + 2, ox + 10, -1, oz + 10);
  for (const [x, z] of [[1, 2], [10, 2], [1, 10], [10, 10]]) v.box("darkplanks", ox + x, 0, oz + z, ox + x, 1, oz + z);
  v.box("darkplanks", ox + 6, 0, oz + 9, ox + 6, 2, oz + 9);
  v.box("planks", ox + 4, 3, oz + 9, ox + 8, 4, oz + 9);
}

/** The next landmark being built: scaffolding over a foundation. */
export function scaffold(v: Voxels, ox: number, oz: number): void {
  v.box("cobble", ox + 1, 0, oz + 2, ox + 10, 0, oz + 9);
  for (const [x, z] of [[1, 2], [10, 2], [1, 9], [10, 9], [5, 9], [5, 2]]) v.box("log", ox + x, 1, oz + z, ox + x, 7, oz + z);
  for (const y of [4, 7]) {
    v.box("planks", ox + 1, y, oz + 2, ox + 10, y, oz + 2);
    v.box("planks", ox + 1, y, oz + 9, ox + 10, y, oz + 9);
    v.box("planks", ox + 1, y, oz + 2, ox + 1, y, oz + 9);
    v.box("planks", ox + 10, y, oz + 2, ox + 10, y, oz + 9);
  }
  for (let x = ox; x <= ox + 11; x++) v.add("wool", x, 0, oz + 11, x % 2 ? 0x1d2230 : 0xf2c14e);
}

/** Festival lanterns on posts around the plaza (block rect x0..x1, z0..z1). Returns the lantern block indices. */
export function lanterns(v: Voxels, x0: number, z0: number, x1: number, z1: number): number[] {
  const glow: number[] = [];
  const colors = [0xe8504b, 0xfff1d6, 0xf2a33a];
  for (const [x, z] of [[x0, z0], [x1, z0], [x0, z1], [x1, z1]]) v.box("darkplanks", x, 0, z, x, 7, z);
  let i = 0;
  for (let x = x0; x <= x1; x += 2) for (const z of [z0, z1]) glow.push(v.add("glow", x, 7 - (x % 4 === 0 ? 1 : 0), z, colors[i++ % 3]));
  for (let z = z0 + 2; z < z1; z += 2) for (const x of [x0, x1]) glow.push(v.add("glow", x, 6, z, colors[i++ % 3]));
  return glow;
}
