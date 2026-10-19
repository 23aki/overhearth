/**
 * The places a town builds as it grows (see backend growth.py): one 48x48 sprite each, the
 * same size as a house, plus the lot waiting for one, the building site and the festival
 * lanterns that finish the town.
 */
import type { Texture } from "pixi.js";
import { type Paint, rect, speckle, texture } from "./art";

type Ctx = CanvasRenderingContext2D;

function shadow(ctx: Ctx): void {
  rect(ctx, "rgba(0,0,0,0.18)", 3, 44, 43, 4);
}

function gable(ctx: Ctx, color: string, top: number, eaves = 3): void {
  for (let i = 0; i < 16; i++) rect(ctx, color, eaves + i, top - i, 48 - 2 * eaves - i * 2, 1);
  rect(ctx, "rgba(0,0,0,0.18)", eaves, top - 1, 48 - 2 * eaves, 2);
}

function pane(ctx: Ctx, x: number, y: number, w = 6, h = 7): void {
  rect(ctx, "#5c3b22", x - 1, y - 1, w + 2, h + 2);
  rect(ctx, "#2a3348", x, y, w, h);
  rect(ctx, "rgba(255,255,255,0.25)", x, y, 2, 2);
}

/** A striped awning with a scalloped edge. */
function awning(ctx: Ctx, a: string, b: string, x: number, y: number, w: number, h: number, step = 4): void {
  for (let i = 0; i < w; i += step) {
    const color = (i / step) % 2 ? b : a;
    rect(ctx, color, x + i, y, Math.min(step, w - i), h);
    rect(ctx, color, x + i + 1, y + h, Math.max(1, Math.min(step, w - i) - 2), 1);
  }
}

/** Rows of characters as pixels: "." is clear, other letters look up `colors`. */
function picture(ctx: Ctx, rows: string[], colors: Record<string, string>, x: number, y: number): void {
  rows.forEach((row, dy) => [...row].forEach((c, dx) => c !== "." && rect(ctx, colors[c], x + dx, y + dy)));
}

const PAINT: Record<string, Paint> = {
  bakery: (ctx) => {
    shadow(ctx);
    rect(ctx, "#f6e7cf", 5, 22, 38, 23);
    rect(ctx, "#e6d3b3", 5, 41, 38, 4);
    gable(ctx, "#a0522d", 22);
    rect(ctx, "#5c3b22", 15, 10, 18, 8);
    picture(ctx, ["..oooooo..", ".oyoyoyoo.", "oooooooooo", ".oooooooo."], { o: "#d9a35b", y: "#f3d79a" }, 19, 12);
    awning(ctx, "#d6453d", "#fbf3e6", 5, 24, 38, 4);
    rect(ctx, "#5c3b22", 8, 30, 16, 11);
    rect(ctx, "#2a3348", 9, 31, 14, 9);
    for (const x of [10, 15, 19]) rect(ctx, "#d9a35b", x, 37, 3, 2);
    rect(ctx, "#7a4f2c", 29, 31, 8, 14);
    rect(ctx, "#f2c14e", 35, 38);
  },
  library: (ctx) => {
    shadow(ctx);
    rect(ctx, "#ddd7ca", 4, 22, 40, 20);
    for (let i = 0; i < 10; i++) rect(ctx, "#b8b1a4", 4 + i * 2, 22 - i, 40 - i * 4, 1);
    rect(ctx, "#a39b8c", 3, 21, 42, 2);
    picture(ctx, ["rrbbgg", "rrbbgg", "rrbbgg"], { r: "#c4553e", b: "#3f6fb5", g: "#5b8f3a" }, 21, 15);
    for (const x of [7, 14, 31, 38]) {
      rect(ctx, "#f2eee5", x, 23, 3, 19);
      rect(ctx, "#c9c2b4", x + 2, 23, 1, 19);
    }
    rect(ctx, "#3d3550", 20, 28, 8, 14);
    rect(ctx, "#5a5070", 20, 28, 8, 1);
    rect(ctx, "#b8b1a4", 2, 42, 44, 2);
    rect(ctx, "#a39b8c", 1, 44, 46, 2);
  },
  garden: (ctx) => {
    rect(ctx, "#3f7d3a", 2, 8, 44, 38);
    rect(ctx, "#6fae5c", 5, 11, 38, 32);
    speckle(ctx, "gardengrass", ["#79b866", "#5f9e4f"], 60, 38, 32);
    const beds: [number, number, string][] = [
      [8, 14, "#e86f8a"],
      [8, 23, "#f2c14e"],
      [30, 14, "#c3a6f2"],
      [30, 23, "#f4f1e8"],
    ];
    for (const [x, y, c] of beds) {
      rect(ctx, "#7a4f2c", x, y, 10, 6);
      for (let i = 0; i < 5; i++) {
        rect(ctx, c, x + 1 + i * 2, y + 1 + (i % 2) * 2);
        rect(ctx, "#3f7d3a", x + 1 + i * 2, y + 2 + (i % 2) * 2);
      }
    }
    rect(ctx, "#d2b37a", 21, 11, 6, 32);
    rect(ctx, "#4f8fd6", 9, 32, 9, 6);
    rect(ctx, "#6aa8ea", 10, 33, 4, 2);
    rect(ctx, "#a06a3d", 19, 38, 2, 8);
    rect(ctx, "#a06a3d", 27, 38, 2, 8);
    rect(ctx, "#a06a3d", 19, 36, 10, 2);
    rect(ctx, "#e86f8a", 20, 35, 2, 1);
    rect(ctx, "#e86f8a", 25, 35, 2, 1);
    rect(ctx, "#2f6a2c", 32, 31, 9, 8);
    rect(ctx, "#4f9447", 33, 31, 5, 3);
  },
  clinic: (ctx) => {
    shadow(ctx);
    rect(ctx, "#f4f4f0", 5, 18, 38, 27);
    rect(ctx, "#dfe1e4", 5, 41, 38, 4);
    rect(ctx, "#5d8fd0", 3, 14, 42, 5);
    rect(ctx, "#3f6fb5", 3, 18, 42, 1);
    rect(ctx, "#ffffff", 19, 4, 10, 10);
    rect(ctx, "#d6453d", 22, 5, 4, 8);
    rect(ctx, "#d6453d", 20, 7, 8, 4);
    pane(ctx, 9, 24);
    pane(ctx, 33, 24);
    rect(ctx, "#9fd3f0", 19, 30, 10, 15);
    rect(ctx, "#5d8fd0", 23, 30, 2, 15);
    rect(ctx, "#5d8fd0", 19, 29, 10, 1);
  },
  playground: (ctx) => {
    rect(ctx, "#c4a46c", 2, 10, 44, 36);
    rect(ctx, "#e8d39a", 4, 12, 40, 32);
    speckle(ctx, "sand", ["#dcc08a", "#f1e2b4"], 50, 40, 32);
    rect(ctx, "#9aa3b5", 8, 16, 2, 18);
    rect(ctx, "#9aa3b5", 14, 16, 2, 18);
    for (let y = 18; y < 34; y += 4) rect(ctx, "#9aa3b5", 8, y, 8, 1);
    rect(ctx, "#3f6fb5", 7, 14, 10, 3);
    for (let i = 0; i < 14; i++) rect(ctx, "#e8504b", 16 + i, 16 + i, 3, 2);
    rect(ctx, "#3b5fa8", 31, 14, 2, 22);
    rect(ctx, "#3b5fa8", 42, 14, 2, 22);
    rect(ctx, "#3b5fa8", 31, 13, 13, 2);
    for (const x of [35, 39]) {
      rect(ctx, "#5c3b22", x, 15, 1, 12);
      rect(ctx, "#f2c14e", x - 1, 27, 3, 1);
    }
    rect(ctx, "#f28f8f", 22, 38, 4, 4);
    rect(ctx, "#ffffff", 23, 38);
  },
  cafe: (ctx) => {
    shadow(ctx);
    rect(ctx, "#f2e0c9", 11, 22, 33, 23);
    rect(ctx, "#e0cbae", 11, 41, 33, 4);
    for (let i = 0; i < 14; i++) rect(ctx, "#2f8f8a", 9 + i, 22 - i, 37 - i * 2, 1);
    rect(ctx, "rgba(0,0,0,0.18)", 9, 21, 37, 2);
    awning(ctx, "#2f8f8a", "#f4f1e8", 11, 24, 33, 4);
    rect(ctx, "#5c3b22", 21, 11, 13, 8);
    picture(ctx, [".ffff..", "fwwwwff", "fwwwwf.", ".ffff.."], { f: "#f4f1e8", w: "#7a4f2c" }, 24, 13);
    pane(ctx, 15, 31, 8, 7);
    rect(ctx, "#7a4f2c", 31, 31, 8, 14);
    rect(ctx, "#e86f8a", 0, 30, 10, 3);
    rect(ctx, "#f4f1e8", 2, 30, 2, 3);
    rect(ctx, "#f4f1e8", 6, 30, 2, 3);
    rect(ctx, "#5c3b22", 4, 33, 1, 8);
    rect(ctx, "#8a5a33", 1, 40, 8, 2);
    rect(ctx, "#5c3b22", 2, 42, 1, 3);
    rect(ctx, "#5c3b22", 7, 42, 1, 3);
  },
  bathhouse: (ctx) => {
    shadow(ctx);
    rect(ctx, "#9e978b", 37, 0, 5, 20);
    rect(ctx, "#b8b1a4", 36, 0, 7, 2);
    rect(ctx, "#efe3c8", 5, 24, 38, 21);
    for (const x of [5, 18, 29, 41]) rect(ctx, "#8a5a33", x, 24, 2, 21);
    for (let i = 0; i < 9; i++) rect(ctx, "#4a5266", 1 + i * 2, 24 - i, 46 - i * 4, 1);
    rect(ctx, "#4a5266", 0, 23, 2, 1);
    rect(ctx, "#4a5266", 46, 23, 2, 1);
    rect(ctx, "#5f6880", 2, 22, 44, 1);
    rect(ctx, "#3f6fb5", 18, 27, 13, 10);
    rect(ctx, "#2f5a99", 22, 27, 1, 10);
    rect(ctx, "#2f5a99", 26, 27, 1, 10);
    picture(ctx, ["w.w.w", "w.w.w", ".....", "wwwww", ".www."], { w: "#ffffff" }, 22, 29);
    rect(ctx, "#2a3348", 19, 37, 11, 8);
    pane(ctx, 8, 30, 7, 6);
    pane(ctx, 33, 30, 6, 6);
  },
  stage: (ctx) => {
    shadow(ctx);
    rect(ctx, "#5c3b22", 4, 6, 40, 4);
    rect(ctx, "#9c2f3f", 5, 10, 38, 24);
    rect(ctx, "#2a2238", 12, 14, 24, 20);
    for (let x = 5; x < 12; x += 3) rect(ctx, "#b8404f", x, 10, 1, 24);
    for (let x = 37; x < 43; x += 3) rect(ctx, "#b8404f", x, 10, 1, 24);
    for (let x = 7; x < 42; x += 5) rect(ctx, "#fbe7a1", x, 8, 2, 2);
    picture(ctx, ["..sss", "..s.s", "..s.s", "sss.s", "ss.ss", "...ss"], { s: "#f2c14e" }, 21, 19);
    rect(ctx, "#a06a3d", 2, 34, 44, 6);
    rect(ctx, "#c4844f", 2, 34, 44, 1);
    rect(ctx, "#7a4f2c", 2, 40, 44, 4);
    for (let x = 4; x < 46; x += 6) rect(ctx, "#5c3b22", x, 40, 1, 4);
  },
  market: (ctx) => {
    rect(ctx, "rgba(0,0,0,0.15)", 2, 42, 44, 4);
    const stalls: [number, string, string[]][] = [
      [2, "#d6453d", ["#e8504b", "#f2a33a"]],
      [17, "#f2c14e", ["#f2c14e", "#a6d96a"]],
      [32, "#5b8f3a", ["#7fb24a", "#c3a6f2"]],
    ];
    stalls.forEach(([x, color, fruit], i) => {
      const top = 18 + (i % 2) * 3;
      rect(ctx, "#7a4f2c", x + 1, top, 1, 24);
      rect(ctx, "#7a4f2c", x + 12, top, 1, 24);
      awning(ctx, color, "#fbf3e6", x, top, 14, 5, 2);
      rect(ctx, "#a06a3d", x, 33, 14, 5);
      rect(ctx, "#8a5a33", x, 37, 14, 1);
      for (let k = 0; k < 5; k++) rect(ctx, fruit[k % 2], x + 2 + k * 2, 31 + (k % 2), 2, 2);
    });
  },
  workshop: (ctx) => {
    shadow(ctx);
    rect(ctx, "#b5603f", 5, 22, 38, 23);
    for (let y = 25; y < 44; y += 3) rect(ctx, "#9b4e33", 5, y, 38, 1);
    gable(ctx, "#4a4f5c", 22);
    picture(ctx, ["..g.g..", ".ggggg.", "gggoggg", ".ggggg.", "..g.g.."], { g: "#c9ced8", o: "#4a4f5c" }, 20, 12);
    rect(ctx, "#7a4f2c", 15, 28, 18, 17);
    for (let x = 15; x < 33; x += 3) rect(ctx, "#5c3b22", x, 28, 1, 17);
    rect(ctx, "#5c3b22", 15, 27, 18, 1);
    rect(ctx, "#a06a3d", 37, 41, 9, 2);
    rect(ctx, "#d9a35b", 45, 41, 1, 2);
    rect(ctx, "#a06a3d", 38, 39, 7, 2);
    rect(ctx, "#d9a35b", 44, 39, 1, 2);
  },
  petpark: (ctx) => {
    rect(ctx, "#6fae5c", 3, 10, 42, 35);
    speckle(ctx, "petgrass", ["#79b866", "#5f9e4f"], 50, 42, 35);
    rect(ctx, "#e8e1d0", 3, 10, 42, 1);
    rect(ctx, "#e8e1d0", 3, 43, 17, 1);
    rect(ctx, "#e8e1d0", 28, 43, 17, 1);
    rect(ctx, "#e8e1d0", 3, 10, 1, 34);
    rect(ctx, "#e8e1d0", 44, 10, 1, 34);
    for (let x = 3; x <= 44; x += 4) {
      rect(ctx, "#d8cfb8", x, 9, 2, 3);
      if (x < 20 || x > 27) rect(ctx, "#d8cfb8", x, 42, 2, 3);
    }
    rect(ctx, "#d9a35b", 8, 22, 14, 11);
    for (let i = 0; i < 7; i++) rect(ctx, "#c4553e", 7 + i, 22 - i, 16 - i * 2, 1);
    rect(ctx, "#5c3b22", 12, 26, 6, 7);
    picture(ctx, ["w...w", "wwwww", "w...w"], { w: "#f4f1e8" }, 30, 30);
    rect(ctx, "#f2c14e", 34, 20, 3, 3);
    rect(ctx, "#2f6a2c", 27, 13, 10, 5);
  },
};

const NAMES: Record<string, string> = {
  bakery: "Bakery",
  library: "Library",
  garden: "Garden",
  clinic: "Clinic",
  playground: "Playground",
  cafe: "Café",
  bathhouse: "Bathhouse",
  stage: "Music stage",
  market: "Market",
  workshop: "Workshop",
  petpark: "Dog park",
  lanterns: "Festival lanterns",
};

export function landmarkName(kind: string): string {
  return NAMES[kind] ?? kind;
}

export interface LandmarkArt {
  landmark: (kind: string) => Texture;
  /** A lot kept for a landmark. */
  site: Texture;
  /** The landmark being built next (or about to be revealed). */
  scaffold: Texture;
  /** A string of festival lanterns `width` pixels wide. */
  lanterns: (width: number) => Texture;
  sparkle: Texture;
}

export function makeLandmarkArt(): LandmarkArt {
  const cache = new Map<string, Texture>();
  const landmark = (kind: string) => {
    let t = cache.get(kind);
    if (!t) {
      t = texture(48, 48, PAINT[kind] ?? PAINT.garden);
      cache.set(kind, t);
    }
    return t;
  };
  const site = texture(48, 48, (ctx) => {
    rect(ctx, "#b8975f", 6, 18, 36, 24);
    speckle(ctx, "site", ["#a8874f", "#c4a46c"], 40, 36, 24);
    for (const [x, y] of [[6, 18], [41, 18], [6, 41], [41, 41]]) rect(ctx, "#7a4f2c", x, y - 3, 2, 5);
    rect(ctx, "#f4f1e8", 7, 17, 35, 1);
    rect(ctx, "#f4f1e8", 7, 40, 35, 1);
    rect(ctx, "#7a4f2c", 23, 27, 2, 11);
    rect(ctx, "#e6d3b3", 16, 19, 16, 9);
    rect(ctx, "#a06a3d", 16, 27, 16, 1);
    picture(ctx, [".ss.", "s..s", "...s", "..s.", "....", "..s."], { s: "#7a4f2c" }, 22, 20);
  });
  const scaffold = texture(48, 48, (ctx) => {
    rect(ctx, "#b8975f", 4, 20, 40, 24);
    speckle(ctx, "scaffold", ["#a8874f", "#c4a46c"], 40, 40, 24);
    rect(ctx, "#cfc6b0", 10, 30, 28, 12);
    for (let x = 8; x <= 38; x += 10) rect(ctx, "#a06a3d", x, 10, 2, 32);
    for (let y = 12; y <= 34; y += 11) rect(ctx, "#a06a3d", 8, y, 32, 2);
    for (let i = 0; i < 10; i++) rect(ctx, "#8a5a33", 10 + i, 14 + i);
    rect(ctx, "#5c3b22", 8, 9, 32, 1);
    for (let x = 4; x < 44; x += 4) rect(ctx, x % 8 ? "#1d2230" : "#f2c14e", x, 42, 4, 3);
  });
  const strings = new Map<number, Texture>();
  const lanterns = (width: number) => {
    let t = strings.get(width);
    if (!t) {
      const sag = (x: number) => Math.round(2 + Math.sin((Math.PI * x) / width) * 5);
      t = texture(width, 18, (ctx) => {
        for (let x = 0; x < width; x++) rect(ctx, "#3b3246", x, sag(x));
        const colors = ["#e8504b", "#f4f1e8", "#f2a33a"];
        for (let x = 6, i = 0; x < width - 4; x += 12, i++) {
          const y = sag(x);
          rect(ctx, "#3b3246", x + 1, y + 1, 2, 1);
          rect(ctx, colors[i % 3], x, y + 2, 4, 6);
          rect(ctx, "rgba(255,255,255,0.4)", x, y + 3, 1, 3);
          rect(ctx, "#3b3246", x + 1, y + 8, 2, 1);
        }
      });
      strings.set(width, t);
    }
    return t;
  };
  const sparkle = texture(7, 7, (ctx) =>
    picture(ctx, ["...w...", "...w...", "..www..", "wwwywww", "..www..", "...w...", "...w..."], { w: "#ffffff", y: "#fff2a8" }, 0, 0),
  );
  return { landmark, site, scaffold, lanterns, sparkle };
}
