/**
 * Pixel art drawn in code: no image files, nothing third-party. Each sprite is painted on a
 * small canvas and turned into a texture that is scaled up with nearest-neighbour sampling.
 */
import { Texture } from "pixi.js";
import { seeded } from "./layout";

type Paint = (ctx: CanvasRenderingContext2D) => void;

function texture(w: number, h: number, paint: Paint): Texture {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;
  paint(ctx);
  const t = Texture.from(canvas);
  t.source.scaleMode = "nearest";
  return t;
}

function rect(ctx: CanvasRenderingContext2D, color: string, x: number, y: number, w = 1, h = 1): void {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
}

function speckle(ctx: CanvasRenderingContext2D, seed: string, colors: string[], count: number, w = 16, h = 16): void {
  const rand = seeded(seed);
  for (let i = 0; i < count; i++) rect(ctx, colors[Math.floor(rand() * colors.length)], Math.floor(rand() * w), Math.floor(rand() * h));
}

export const ROOFS = ["#c4553e", "#3f6fb5", "#5b8f3a", "#8a4fa8", "#d08a2c", "#2f8f8a", "#b5476e", "#6d6a8f"];
export const BODIES = ["#f2c14e", "#7ec8e3", "#f28f8f", "#a6d96a", "#c3a6f2", "#f5a76c", "#7fd1b9", "#e8e1d0", "#9db4ff"];

export function pick<T>(list: T[], id: string): T {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return list[h % list.length];
}

export interface Art {
  grass: Texture[];
  road: Texture;
  plaza: Texture;
  tree: Texture;
  flowers: Texture;
  lamp: Texture;
  lampLight: Texture;
  bench: Texture;
  fountain: Texture[];
  house: (roof: string) => Texture;
  windows: Texture;
  avatar: (body: string) => Texture[];
  heart: Texture;
  bulb: Texture;
  question: Texture;
  envelope: Texture;
  glow: Texture;
}

export function makeArt(): Art {
  const grass = [0, 1, 2].map((v) =>
    texture(16, 16, (ctx) => {
      rect(ctx, "#5f9e4f", 0, 0, 16, 16);
      speckle(ctx, `grass${v}`, ["#6fae5c", "#548f45", "#79b866"], 26);
      if (v === 2) {
        rect(ctx, "#8cc76f", 4, 6);
        rect(ctx, "#8cc76f", 5, 5);
        rect(ctx, "#8cc76f", 11, 11);
      }
    }),
  );
  const road = texture(16, 16, (ctx) => {
    rect(ctx, "#d2b37a", 0, 0, 16, 16);
    speckle(ctx, "road", ["#c4a46c", "#dcc08a", "#b8975f"], 22);
  });
  const plaza = texture(16, 16, (ctx) => {
    rect(ctx, "#c9c2b4", 0, 0, 16, 16);
    rect(ctx, "#ada594", 0, 0, 16, 1);
    rect(ctx, "#ada594", 0, 8, 16, 1);
    rect(ctx, "#ada594", 0, 0, 1, 8);
    rect(ctx, "#ada594", 8, 8, 1, 8);
    speckle(ctx, "plaza", ["#d6d0c3", "#bdb5a6"], 10);
  });
  const tree = texture(16, 24, (ctx) => {
    rect(ctx, "rgba(0,0,0,0.18)", 3, 21, 10, 2);
    rect(ctx, "#7a4f2c", 7, 15, 2, 7);
    const canopy: [number, number, number, number][] = [
      [4, 2, 8, 2],
      [2, 4, 12, 7],
      [3, 11, 10, 3],
      [5, 14, 6, 1],
    ];
    for (const [x, y, w, h] of canopy) rect(ctx, "#3f7d3a", x, y, w, h);
    rect(ctx, "#4f9447", 4, 4, 6, 4);
    rect(ctx, "#62a956", 5, 4, 3, 2);
    rect(ctx, "#2f6a2c", 9, 10, 4, 3);
  });
  const flowers = texture(16, 16, (ctx) => {
    const spots: [number, number, string][] = [
      [3, 4, "#f4f1e8"],
      [10, 3, "#f2c14e"],
      [6, 10, "#e86f8a"],
      [12, 11, "#f4f1e8"],
      [2, 13, "#c3a6f2"],
    ];
    for (const [x, y, c] of spots) {
      rect(ctx, "#3f7d3a", x, y + 1);
      rect(ctx, c, x - 1, y);
      rect(ctx, c, x + 1, y);
      rect(ctx, c, x, y - 1);
      rect(ctx, "#f2c14e", x, y);
    }
  });
  const lamp = texture(8, 22, (ctx) => {
    rect(ctx, "#3b3f4a", 3, 6, 2, 15);
    rect(ctx, "#2b2f38", 2, 20, 4, 2);
    rect(ctx, "#3b3f4a", 1, 1, 6, 1);
    rect(ctx, "#fbe7a1", 2, 2, 4, 4);
    rect(ctx, "#3b3f4a", 1, 6, 6, 1);
  });
  const lampLight = texture(32, 32, (ctx) => {
    const g = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
    g.addColorStop(0, "rgba(255,226,150,0.85)");
    g.addColorStop(1, "rgba(255,226,150,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 32, 32);
  });
  const bench = texture(16, 12, (ctx) => {
    rect(ctx, "#8a5a33", 1, 3, 14, 2);
    rect(ctx, "#a06a3d", 1, 6, 14, 2);
    rect(ctx, "#5c3b22", 2, 8, 2, 4);
    rect(ctx, "#5c3b22", 12, 8, 2, 4);
  });
  const fountain = [0, 1].map((frame) =>
    texture(48, 40, (ctx) => {
      rect(ctx, "rgba(0,0,0,0.15)", 4, 34, 40, 4);
      rect(ctx, "#9e978b", 4, 14, 40, 22);
      rect(ctx, "#b8b1a4", 6, 12, 36, 4);
      rect(ctx, "#4f8fd6", 8, 16, 32, 16);
      rect(ctx, "#6aa8ea", 10, 18, 28, 4);
      rect(ctx, "#9e978b", 21, 8, 6, 16);
      rect(ctx, "#b8b1a4", 19, 6, 10, 3);
      const drops = frame === 0 ? [[22, 1], [26, 3], [18, 4], [30, 2]] : [[24, 0], [20, 2], [28, 1], [32, 4]];
      for (const [x, y] of drops) rect(ctx, "#bfe3ff", x, y, 2, 2);
      speckle(ctx, `water${frame}`, ["#8cc4f5", "#3f7fc4"], 18, 32, 14);
    }),
  );
  const houses = new Map<string, Texture>();
  const house = (roof: string) => {
    const cached = houses.get(roof);
    if (cached) return cached;
    const t = texture(48, 48, (ctx) => {
      rect(ctx, "rgba(0,0,0,0.18)", 4, 44, 42, 4);
      // walls
      rect(ctx, "#efe3c8", 5, 22, 38, 23);
      rect(ctx, "#dccfb0", 5, 41, 38, 4);
      for (let x = 7; x < 43; x += 6) rect(ctx, "#e4d6b6", x, 24, 1, 17);
      // roof
      for (let i = 0; i < 16; i++) rect(ctx, roof, 3 + i, 22 - i, 42 - i * 2, 1);
      rect(ctx, "rgba(0,0,0,0.18)", 3, 21, 42, 2);
      speckle(ctx, `roof${roof}`, ["rgba(255,255,255,0.12)", "rgba(0,0,0,0.12)"], 40, 40, 14);
      rect(ctx, "#7a4f2c", 33, 6, 4, 9); // chimney
      // door and windows (window panes are dark; light is a separate layer)
      rect(ctx, "#7a4f2c", 20, 31, 8, 14);
      rect(ctx, "#5c3b22", 20, 31, 8, 1);
      rect(ctx, "#f2c14e", 26, 38);
      for (const x of [9, 33]) {
        rect(ctx, "#5c3b22", x - 1, 27, 8, 9);
        rect(ctx, "#2a3348", x, 28, 6, 7);
        rect(ctx, "#5c3b22", x + 3, 28, 1, 7);
        rect(ctx, "#5c3b22", x, 31, 6, 1);
      }
    });
    houses.set(roof, t);
    return t;
  };
  const windows = texture(48, 48, (ctx) => {
    for (const x of [9, 33]) {
      rect(ctx, "#ffffff", x, 28, 3, 3);
      rect(ctx, "#ffffff", x + 4, 28, 2, 3);
      rect(ctx, "#ffffff", x, 32, 3, 3);
      rect(ctx, "#ffffff", x + 4, 32, 2, 3);
    }
  });
  const avatars = new Map<string, Texture[]>();
  const avatar = (body: string) => {
    const cached = avatars.get(body);
    if (cached) return cached;
    // Alexa's avatars are small round creatures with Echo's light ring on top.
    const frames = [0, 1, 2].map((frame) =>
      texture(14, 18, (ctx) => {
        rect(ctx, "rgba(0,0,0,0.2)", 3, 16, 8, 2);
        const lift = frame === 0 ? 0 : 1;
        rect(ctx, "#34c6f4", 4, 0 + lift, 6, 1);
        rect(ctx, "#34c6f4", 3, 1 + lift, 1, 1);
        rect(ctx, "#34c6f4", 10, 1 + lift, 1, 1);
        rect(ctx, "#9ae6ff", 5, 0 + lift, 2, 1);
        rect(ctx, body, 3, 3 + lift, 8, 1);
        rect(ctx, body, 2, 4 + lift, 10, 8);
        rect(ctx, body, 3, 12 + lift, 8, 1);
        rect(ctx, "rgba(255,255,255,0.35)", 3, 4 + lift, 2, 3);
        rect(ctx, "rgba(0,0,0,0.12)", 2, 10 + lift, 10, 2);
        rect(ctx, "#1d2230", 4, 7 + lift, 2, 2);
        rect(ctx, "#1d2230", 8, 7 + lift, 2, 2);
        rect(ctx, "#ffffff", 4, 7 + lift);
        rect(ctx, "#ffffff", 8, 7 + lift);
        rect(ctx, "#e8798b", 3, 9 + lift);
        rect(ctx, "#e8798b", 10, 9 + lift);
        // feet
        const left = frame === 1 ? 1 : 0;
        const right = frame === 2 ? 1 : 0;
        rect(ctx, "#3a3346", 4, 13 + lift - left, 2, 2);
        rect(ctx, "#3a3346", 8, 13 + lift - right, 2, 2);
      }),
    );
    avatars.set(body, frames);
    return frames;
  };
  const heart = texture(9, 8, (ctx) => {
    const rows = ["011000110", "111101111", "111111111", "111111111", "011111110", "001111100", "000111000", "000010000"];
    rows.forEach((row, y) => [...row].forEach((c, x) => c === "1" && rect(ctx, "#ff6b8b", x, y)));
    rect(ctx, "#ffd0da", 2, 1);
  });
  const bulb = texture(7, 9, (ctx) => {
    rect(ctx, "#f9e27a", 1, 0, 5, 1);
    rect(ctx, "#f9e27a", 0, 1, 7, 4);
    rect(ctx, "#f9e27a", 1, 5, 5, 1);
    rect(ctx, "#fff6c9", 1, 1, 2, 2);
    rect(ctx, "#9aa3b5", 2, 6, 3, 2);
    rect(ctx, "#6b7385", 2, 8, 3, 1);
  });
  const question = texture(7, 9, (ctx) => {
    const rows = ["0111110", "1100011", "0000011", "0000110", "0001100", "0001100", "0000000", "0001100", "0001100"];
    rows.forEach((row, y) => [...row].forEach((c, x) => c === "1" && rect(ctx, "#9db4ff", x, y)));
  });
  const envelope = texture(9, 7, (ctx) => {
    rect(ctx, "#f4f1e8", 0, 0, 9, 7);
    rect(ctx, "#b9b2a3", 0, 0, 9, 1);
    rect(ctx, "#b9b2a3", 0, 6, 9, 1);
    rect(ctx, "#b9b2a3", 0, 0, 1, 7);
    rect(ctx, "#b9b2a3", 8, 0, 1, 7);
    for (let i = 0; i < 4; i++) {
      rect(ctx, "#b9b2a3", 1 + i, 1 + i);
      rect(ctx, "#b9b2a3", 7 - i, 1 + i);
    }
    rect(ctx, "#e8798b", 4, 4);
  });
  const glow = texture(32, 32, (ctx) => {
    const g = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 32, 32);
  });
  return {
    grass,
    road,
    plaza,
    tree,
    flowers,
    lamp,
    lampLight,
    bench,
    fountain,
    house,
    windows,
    avatar,
    heart,
    bulb,
    question,
    envelope,
    glow,
  };
}
