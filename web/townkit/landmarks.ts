/**
 * The places a town builds as it grows (see backend growth.py): one 48x48 sprite each, the
 * same size as a house, and a bigger second stage once the town makes it grow; plus the lot
 * waiting for one, the building site and the festival lanterns.
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

/** What each landmark adds when the town makes it bigger, painted over the first stage. */
const BIGGER: Record<string, Paint> = {
  bakery: (ctx) => {
    rect(ctx, "#7a4f2c", 35, 4, 4, 9); // chimney with warm smoke
    for (const [x, y] of [[36, 1], [38, 0], [34, 0]]) rect(ctx, "rgba(240,240,240,0.85)", x, y, 2, 2);
    rect(ctx, "#f2c14e", 23, 8, 2, 2); // gold star on the sign
    rect(ctx, "#f2c14e", 22, 9, 4, 1);
    rect(ctx, "#5b8f3a", 8, 41, 16, 2); // flower box
    for (let x = 9; x < 24; x += 3) rect(ctx, x % 2 ? "#e86f8a" : "#f4f1e8", x, 40);
    rect(ctx, "#8a5a33", 38, 40, 9, 2); // bench with a bread basket
    rect(ctx, "#5c3b22", 39, 42, 1, 3);
    rect(ctx, "#5c3b22", 45, 42, 1, 3);
    rect(ctx, "#d9a35b", 41, 38, 4, 2);
  },
  library: (ctx) => {
    rect(ctx, "#cfc8ba", 19, 0, 10, 13); // clock tower
    rect(ctx, "#a39b8c", 18, 0, 12, 1);
    rect(ctx, "#f4f1e8", 21, 3, 6, 6);
    rect(ctx, "#3d3550", 23, 4, 1, 3);
    rect(ctx, "#3d3550", 24, 6, 2, 1);
    for (const x of [10, 35]) {
      rect(ctx, "#c4553e", x, 24, 3, 9); // banners
      rect(ctx, "#f2c14e", x + 1, 26);
    }
    rect(ctx, "#8a5a33", 40, 38, 7, 4); // book cart
    picture(ctx, ["rbgr", "rbgy"], { r: "#c4553e", b: "#3f6fb5", g: "#5b8f3a", y: "#f2c14e" }, 41, 36);
    rect(ctx, "#3b3f4a", 41, 42, 1, 1);
    rect(ctx, "#3b3f4a", 45, 42, 1, 1);
  },
  garden: (ctx) => {
    rect(ctx, "#e9f6ff", 30, 12, 13, 15); // greenhouse
    rect(ctx, "#9fd3f0", 31, 15, 11, 11);
    for (const x of [30, 34, 38, 42]) rect(ctx, "#f4f4f0", x, 12, 1, 15);
    rect(ctx, "#f4f4f0", 30, 15, 13, 1);
    for (let i = 0; i < 4; i++) rect(ctx, "#f4f4f0", 32 + i * 2, 11 - i, 9 - i * 4 > 0 ? 9 - i * 4 : 1, 1);
    rect(ctx, "#5b8f3a", 32, 22, 2, 3);
    rect(ctx, "#5b8f3a", 37, 21, 2, 4);
    rect(ctx, "#e86f8a", 37, 20);
    for (let x = 4; x < 45; x += 3) rect(ctx, ["#e86f8a", "#f2c14e", "#c3a6f2"][x % 3], x, 8); // hedge in bloom
    rect(ctx, "#bfe3ff", 12, 30, 2, 2); // fountain in the pond
    rect(ctx, "#9e978b", 12, 32, 2, 3);
  },
  clinic: (ctx) => {
    rect(ctx, "#f4f4f0", 5, 5, 38, 10); // second floor
    rect(ctx, "#5d8fd0", 3, 2, 42, 4);
    rect(ctx, "#3f6fb5", 3, 5, 42, 1);
    for (const x of [8, 32]) {
      rect(ctx, "#5c3b22", x - 1, 7, 8, 6);
      rect(ctx, "#9fd3f0", x, 8, 6, 4);
    }
    rect(ctx, "#ffffff", 19, 6, 10, 9);
    rect(ctx, "#d6453d", 22, 7, 4, 7);
    rect(ctx, "#d6453d", 20, 9, 8, 3);
    rect(ctx, "#5b8f3a", 14, 40, 4, 5); // planters by the door
    rect(ctx, "#5b8f3a", 30, 40, 4, 5);
    rect(ctx, "#a6d96a", 15, 39, 2, 2);
    rect(ctx, "#a6d96a", 31, 39, 2, 2);
  },
  playground: (ctx) => {
    for (let x = 4; x < 44; x += 4) {
      rect(ctx, ["#e8504b", "#f2c14e", "#3f6fb5", "#5b8f3a"][(x / 4) % 4], x, 11, 3, 2); // bunting
      rect(ctx, ["#e8504b", "#f2c14e", "#3f6fb5", "#5b8f3a"][(x / 4) % 4], x + 1, 13);
    }
    rect(ctx, "#9aa3b5", 7, 38, 12, 2); // merry-go-round
    rect(ctx, "#e8504b", 8, 36, 4, 2);
    rect(ctx, "#f2c14e", 12, 36, 4, 2);
    rect(ctx, "#3f6fb5", 15, 36, 3, 2);
    rect(ctx, "#9aa3b5", 12, 33, 1, 3);
    rect(ctx, "#8a5a33", 30, 40, 13, 2); // seesaw
    rect(ctx, "#5c3b22", 36, 42, 1, 2);
    rect(ctx, "#e8504b", 30, 39, 2, 1);
    rect(ctx, "#3f6fb5", 41, 39, 2, 1);
  },
  cafe: (ctx) => {
    for (let x = 10; x < 44; x += 2) rect(ctx, "#3b3246", x, 22 + (x % 4 === 0 ? 1 : 0)); // string lights
    for (let x = 11; x < 44; x += 5) rect(ctx, "#fbe7a1", x, 23, 1, 2);
    rect(ctx, "#2a2238", 40, 35, 6, 8); // chalkboard
    rect(ctx, "#8a5a33", 39, 34, 8, 1);
    rect(ctx, "#f4f1e8", 41, 37, 4, 1);
    rect(ctx, "#f4f1e8", 41, 39, 3, 1);
    rect(ctx, "#5b8f3a", 12, 41, 3, 4); // pots
    rect(ctx, "#e86f8a", 12, 40, 3, 1);
    rect(ctx, "#2f8f8a", 0, 37, 10, 2); // a second umbrella
    rect(ctx, "#f4f1e8", 4, 37, 2, 2);
  },
  bathhouse: (ctx) => {
    for (const [x, y] of [[33, 3], [31, 1], [34, 0], [30, 5]]) rect(ctx, "rgba(240,240,240,0.85)", x, y, 3, 2); // steam
    for (const x of [7, 39]) {
      rect(ctx, "#3b3246", x + 1, 24, 1, 2); // red lanterns under the eaves
      rect(ctx, "#d6453d", x, 26, 3, 4);
      rect(ctx, "#f2c14e", x, 28, 3, 1);
    }
    rect(ctx, "#d6453d", 18, 27, 6, 10); // red and blue noren
    rect(ctx, "#ffffff", 20, 30, 2, 2);
    rect(ctx, "#8a5a33", 32, 41, 11, 2); // bench
    rect(ctx, "#5c3b22", 33, 43, 1, 2);
    rect(ctx, "#5c3b22", 41, 43, 1, 2);
  },
  stage: (ctx) => {
    for (const x of [0, 44]) {
      rect(ctx, "#1d2230", x, 22, 4, 12); // speakers
      rect(ctx, "#5b6474", x + 1, 24, 2, 2);
      rect(ctx, "#5b6474", x + 1, 28, 2, 3);
    }
    for (let x = 6; x < 43; x += 6) {
      rect(ctx, ["#e8504b", "#f2c14e", "#7ec8e3"][(x / 6) % 3], x, 1, 3, 3); // flags
      rect(ctx, "#5c3b22", x + 1, 4, 1, 2);
    }
    rect(ctx, "rgba(255,240,170,0.35)", 14, 14, 6, 20); // spotlights
    rect(ctx, "rgba(255,240,170,0.35)", 28, 14, 6, 20);
  },
  market: (ctx) => {
    for (let x = 1; x < 47; x += 2) rect(ctx, "#3b3246", x, 10 + Math.round(Math.sin(x / 7.5) * 2)); // bunting
    for (let x = 3; x < 46; x += 5) {
      const y = 11 + Math.round(Math.sin(x / 7.5) * 2);
      rect(ctx, ["#e8504b", "#f2c14e", "#3f6fb5", "#5b8f3a"][x % 4], x, y, 3, 2);
      rect(ctx, ["#e8504b", "#f2c14e", "#3f6fb5", "#5b8f3a"][x % 4], x + 1, y + 2);
    }
    for (const x of [4, 20, 36]) {
      rect(ctx, "#a06a3d", x, 40, 6, 4); // crates
      rect(ctx, "#8a5a33", x, 41, 6, 1);
      rect(ctx, ["#e8504b", "#a6d96a", "#f2a33a"][(x / 16) | 0], x + 1, 39, 4, 1);
    }
  },
  workshop: (ctx) => {
    rect(ctx, "#f2c14e", 21, 13, 5, 3); // the gear turns gold
    rect(ctx, "#f2c14e", 23, 12, 1, 5);
    rect(ctx, "#3b3f4a", 35, 3, 4, 9); // chimney with smoke
    for (const [x, y] of [[36, 0], [38, 1], [34, 1]]) rect(ctx, "rgba(220,220,220,0.85)", x, y, 2, 2);
    rect(ctx, "#9fd3f0", 8, 12, 6, 3); // skylight
    rect(ctx, "#a06a3d", 0, 38, 12, 4); // cart
    rect(ctx, "#5c3b22", 0, 38, 12, 1);
    rect(ctx, "#3b3f4a", 2, 42, 3, 3);
    rect(ctx, "#3b3f4a", 8, 42, 3, 3);
    rect(ctx, "#d9a35b", 2, 36, 8, 2);
  },
  petpark: (ctx) => {
    for (const x of [28, 38]) {
      rect(ctx, "#f4f1e8", x, 34, 1, 6); // hurdles
      rect(ctx, "#f4f1e8", x + 5, 34, 1, 6);
      rect(ctx, "#e8504b", x, 35, 6, 1);
    }
    rect(ctx, "#3f6fb5", 8, 37, 12, 4); // tunnel
    rect(ctx, "#2f5a99", 8, 37, 2, 4);
    rect(ctx, "#1d2230", 18, 38, 2, 2);
    rect(ctx, "#4f8fd6", 37, 14, 6, 4); // water bowl pond
    rect(ctx, "#d9a35b", 25, 24, 8, 6); // a second dog house
    for (let i = 0; i < 4; i++) rect(ctx, "#3f6fb5", 24 + i, 24 - i, 10 - i * 2, 1);
    rect(ctx, "#5c3b22", 27, 26, 4, 4);
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
  /** A landmark at its first stage, or its bigger second stage. */
  landmark: (kind: string, bigger?: boolean) => Texture;
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
  const landmark = (kind: string, bigger = false) => {
    const key = `${kind}${bigger ? "+" : ""}`;
    let t = cache.get(key);
    if (!t) {
      const paint = PAINT[kind] ?? PAINT.garden;
      t = texture(48, 48, (ctx) => {
        paint(ctx);
        if (bigger) BIGGER[kind]?.(ctx);
      });
      cache.set(key, t);
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
