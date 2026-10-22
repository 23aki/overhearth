/**
 * Scenes made only for the demo video, in the same block world as the town.
 *
 *   film.html?scene=1  A person asks their Echo Show for dinner, says thank you, and the avatar
 *                      pops out of the screen and leaves through a door of light.
 *   film.html?scene=2  Six rooms, six languages: "thank you, Alexa", and an avatar leaps out of
 *                      each Echo Show.
 *
 * Everything moves on a fixed timeline (a pure function of time), so every take is the same.
 * window.filmTime is the scene clock in ms; window.filmDone turns true at the end.
 */
import * as THREE from "three";
import { CSS2DObject, CSS2DRenderer } from "three/addons/renderers/CSS2DRenderer.js";
import { BODIES, pick } from "../townkit/art";
import { creature, lightDoor } from "../townkit/scene3d";
import { type Materials, Voxels, makeMaterials } from "../townkit/voxel";

declare global {
  interface Window {
    filmTime: number;
    filmDone: boolean;
  }
}

const clamp = (x: number, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const span = (t: number, a: number, b: number) => clamp((t - a) / (b - a));
const ease = (x: number) => x * x * (3 - 2 * x);
const lerp = (a: number, b: number, x: number) => a + (b - a) * x;
const between = (t: number, a: number, b: number) => t >= a && t < b;
/** The avatar's size in a room: smaller than in town, next to a person. */
const PAL = 0.85;

// ---- people and devices ---------------------------------------------------------------

interface Look {
  skin: number;
  hair: number;
  shirt: number;
  pants: number;
  long?: boolean;
}

interface Person {
  group: THREE.Group;
  head: THREE.Group;
  armL: THREE.Group;
  armR: THREE.Group;
  mouth: THREE.Mesh;
}

function box(w: number, h: number, d: number, color: number, basic = false): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    basic ? new THREE.MeshBasicMaterial({ color }) : new THREE.MeshLambertMaterial({ color }),
  );
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/** A blocky person, about 1.9 tall, facing +z. Arms and head turn at their joints. */
function person(look: Look): Person {
  const group = new THREE.Group();
  for (const x of [-0.12, 0.12]) {
    const leg = box(0.21, 0.78, 0.24, look.pants);
    leg.position.set(x, 0.39, 0);
    group.add(leg);
    const shoe = box(0.23, 0.08, 0.3, 0x2b2b30);
    shoe.position.set(x, 0.04, 0.03);
    group.add(shoe);
  }
  const torso = box(0.5, 0.66, 0.27, look.shirt);
  torso.position.y = 1.11;
  group.add(torso);
  const arm = (side: number) => {
    const pivot = new THREE.Group();
    pivot.position.set(side * 0.34, 1.4, 0);
    const sleeve = box(0.17, 0.5, 0.2, look.shirt);
    sleeve.position.y = -0.24;
    const hand = box(0.16, 0.14, 0.19, look.skin);
    hand.position.y = -0.56;
    pivot.add(sleeve, hand);
    group.add(pivot);
    return pivot;
  };
  const armL = arm(-1);
  const armR = arm(1);
  const head = new THREE.Group();
  head.position.y = 1.45;
  const face = box(0.44, 0.44, 0.42, look.skin);
  face.position.y = 0.22;
  const hairTop = box(0.47, 0.12, 0.45, look.hair);
  hairTop.position.y = 0.47;
  const hairBack = box(0.47, look.long ? 0.5 : 0.3, 0.1, look.hair);
  hairBack.position.set(0, look.long ? 0.2 : 0.3, -0.18);
  head.add(face, hairTop, hairBack);
  if (look.long) {
    for (const x of [-0.22, 0.22]) {
      const side = box(0.06, 0.42, 0.3, look.hair);
      side.position.set(x, 0.24, -0.05);
      head.add(side);
    }
  }
  for (const x of [-0.1, 0.1]) {
    const eye = box(0.07, 0.07, 0.02, 0x1d2230, true);
    eye.position.set(x, 0.25, 0.215);
    head.add(eye);
  }
  const mouth = box(0.12, 0.03, 0.02, 0xa8434b, true);
  mouth.position.set(0, 0.11, 0.215);
  head.add(mouth);
  group.add(head);
  return { group, head, armL, armR, mouth };
}

type Screen = "clock" | "listen" | "recipe" | "heart" | "glow";

interface Echo {
  group: THREE.Group;
  show(state: Screen, t: number): void;
}

/** An Echo Show on its little base, screen facing +z. Just a device: no face, no character. */
function echoShow(city = "Seattle"): Echo {
  const group = new THREE.Group();
  const body = box(0.66, 0.42, 0.26, 0x2b2d31);
  body.position.set(0, 0.21, -0.02);
  const base = box(0.66, 0.08, 0.36, 0x3a3d43);
  base.position.set(0, 0.04, -0.06);
  group.add(body, base);
  const canvas = document.createElement("canvas");
  canvas.width = 352;
  canvas.height = 208;
  const ctx = canvas.getContext("2d")!;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.58, 0.34), new THREE.MeshBasicMaterial({ map: texture }));
  screen.position.set(0, 0.22, 0.112);
  group.add(screen);
  let last = "";
  return {
    group,
    show(state, t) {
      const pulse = Math.floor(t / 120) % 8;
      const key = `${state}:${state === "listen" || state === "glow" ? pulse : ""}`;
      if (key === last) return;
      last = key;
      const W = canvas.width;
      const H = canvas.height;
      const g = ctx.createLinearGradient(0, 0, W, H);
      g.addColorStop(0, "#14243d");
      g.addColorStop(1, "#0b1424");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
      ctx.textAlign = "left";
      if (state === "clock") {
        ctx.fillStyle = "#ffffff";
        ctx.font = "600 64px system-ui, sans-serif";
        ctx.fillText("7:12", 24, 96);
        ctx.font = "22px system-ui, sans-serif";
        ctx.fillStyle = "#9fb4d6";
        ctx.fillText(`${city} · Rain 52°`, 26, 132);
      } else if (state === "listen") {
        ctx.fillStyle = "#cfe8ff";
        ctx.font = "24px system-ui, sans-serif";
        ctx.fillText("Listening…", 26, 90);
        const w = 140 + pulse * 18;
        ctx.fillStyle = "#34c6f4";
        ctx.fillRect((W - w) / 2, H - 22, w, 10);
      } else if (state === "recipe") {
        ctx.fillStyle = "#1f3354";
        ctx.fillRect(14, 14, W - 28, H - 28);
        ctx.fillStyle = "#ffffff";
        ctx.font = "600 28px system-ui, sans-serif";
        ctx.fillText("Egg & spinach rice", 28, 56);
        ctx.font = "19px system-ui, sans-serif";
        ctx.fillStyle = "#ffd27f";
        ctx.fillText("10 min · thanked 12× in town", 28, 88);
        ctx.fillStyle = "#9fb4d6";
        ctx.fillText("from a retired cook in Osaka", 28, 116);
        ctx.fillStyle = "#f4f1e8";
        ctx.fillRect(250, 132, 70, 30);
        ctx.fillStyle = "#f2c14e";
        ctx.fillRect(262, 124, 22, 12);
        ctx.fillStyle = "#3f8a39";
        ctx.fillRect(286, 124, 22, 12);
      } else if (state === "heart") {
        ctx.fillStyle = "#ff6b8b";
        ctx.font = "100px system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("♥", W / 2, 128);
        ctx.font = "22px system-ui, sans-serif";
        ctx.fillStyle = "#ffd6e0";
        ctx.fillText("You're welcome!", W / 2, 176);
      } else {
        const r = ctx.createRadialGradient(W / 2, H / 2, 10, W / 2, H / 2, 140 + pulse * 6);
        r.addColorStop(0, "#ffffff");
        r.addColorStop(0.5, "#9ae6ff");
        r.addColorStop(1, "#34c6f4");
        ctx.fillStyle = r;
        ctx.fillRect(0, 0, W, H);
      }
      texture.needsUpdate = true;
    },
  };
}

// ---- rooms ----------------------------------------------------------------------------

interface RoomStyle {
  wall: number;
  window: number;
  floor: "planks" | "darkplanks";
  /** Blocks wide and deep. */
  w: number;
  d: number;
  /** The side table for the Echo Show, in blocks. */
  table: [number, number];
  plant?: boolean;
  counter?: boolean;
  /** Where the window (and the counter under it) starts, in blocks. */
  windowX?: number;
}

/** A room cut open toward the camera: floor, back and left walls, a window, a table. */
function room(v: Voxels, s: RoomStyle): void {
  v.box(s.floor, 0, -1, 0, s.w - 1, -1, s.d - 1);
  const wx = s.windowX ?? s.w - 9;
  for (let x = -1; x < s.w; x++)
    for (let y = -1; y <= 11; y++) {
      const win = x >= wx && x <= wx + 4 && y >= 4 && y <= 8;
      if (win) v.add("window", x, y, -1, s.window);
      else v.add(y === 0 ? "darkplanks" : "plaster", x, y, -1, s.wall);
    }
  for (let z = 0; z < s.d; z++) for (let y = -1; y <= 11; y++) v.add(y === 0 ? "darkplanks" : "plaster", -1, y, z, s.wall);
  const [tx, tz] = s.table;
  v.box("planks", tx, 3, tz, tx + 3, 3, tz + 2);
  for (const [x, z] of [[tx, tz], [tx + 3, tz], [tx, tz + 2], [tx + 3, tz + 2]]) v.box("darkplanks", x, 0, z, x, 2, z);
  if (s.counter) {
    v.box("planks", wx - 1, 0, 0, wx + 5, 2, 1);
    v.box("stone", wx - 1, 3, 0, wx + 5, 3, 1);
    v.box("wool", wx + 3, 4, 0, wx + 3, 4, 0, 0xd6453d);
    v.box("plaster", wx + 1, 4, 0, wx + 1, 5, 0, 0xf4f1e8);
  }
  if (s.plant) {
    v.add("bricks", 0, 0, 0);
    v.box("leaves", 0, 1, 0, 1, 2, 1);
  }
  v.add("glow", Math.floor(s.w / 2), 10, Math.floor(s.d / 2), 0xffe2a0);
}

interface Panel {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  css: CSS2DRenderer;
  rect: { x: number; y: number; w: number; h: number };
  update(t: number): void;
}

function lights(scene: THREE.Scene, warm = true): void {
  scene.add(new THREE.HemisphereLight(warm ? 0xfff0dc : 0xe8f2ff, 0x6a4a30, 1.5));
  const key = new THREE.DirectionalLight(0xffe2c0, 1.6);
  key.position.set(3, 7, 6);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  Object.assign(key.shadow.camera, { left: -6, right: 6, top: 6, bottom: -6 });
  key.shadow.bias = -0.0008;
  scene.add(key);
  const lamp = new THREE.PointLight(0xffd59a, 6, 8, 1.5);
  lamp.position.set(2.5, 2.6, 2);
  scene.add(lamp);
}

function bubble(text: string, className = "bubble"): CSS2DObject {
  const div = document.createElement("div");
  div.className = className;
  div.textContent = text;
  const object = new CSS2DObject(div);
  object.center.set(0.5, 1);
  object.visible = false;
  return object;
}

function placeCamera(camera: THREE.Camera, target: THREE.Vector3, distance: number, az: number, polar: number): void {
  camera.position.set(
    target.x + distance * Math.sin(polar) * Math.sin(az),
    target.y + distance * Math.cos(polar),
    target.z + distance * Math.sin(polar) * Math.cos(az),
  );
  camera.lookAt(target);
}

/** Position along an arc from a to b, `height` at the top. */
function arc(a: THREE.Vector3, b: THREE.Vector3, x: number, height: number): THREE.Vector3 {
  const p = a.clone().lerp(b, x);
  p.y += Math.sin(Math.PI * x) * height;
  return p;
}

function makePanel(rect: Panel["rect"], host: HTMLElement): Omit<Panel, "update"> {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x15121a);
  const camera = new THREE.PerspectiveCamera(32, rect.w / rect.h, 0.05, 100);
  const css = new CSS2DRenderer();
  css.setSize(rect.w, rect.h);
  css.domElement.className = "panel-css";
  Object.assign(css.domElement.style, { left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.w}px`, height: `${rect.h}px` });
  host.appendChild(css.domElement);
  return { scene, camera, css, rect };
}

// ---- scene 1 ----------------------------------------------------------------------------

function sceneOne(materials: Materials, host: HTMLElement, W: number, H: number): { panels: Panel[]; length: number } {
  const base = makePanel({ x: 0, y: 0, w: W, h: H }, host);
  const { scene, camera } = base;
  lights(scene);
  const v = new Voxels();
  room(v, { wall: 0xf1e2c8, window: 0xf3a46b, floor: "planks", w: 26, d: 16, table: [11, 6], plant: true, counter: true, windowX: 2 });
  for (const m of v.build(materials)) scene.add(m);

  const echoAt = new THREE.Vector3(3.25, 1.0, 1.95);
  const echoTurn = -0.8;
  const echo = echoShow();
  echo.group.position.copy(echoAt);
  echo.group.rotation.y = echoTurn;
  scene.add(echo.group);
  const forward = new THREE.Vector3(Math.sin(echoTurn), 0, Math.cos(echoTurn));

  const who = person({ skin: 0xf1c9a5, hair: 0x6b3e26, shirt: 0x3f6fb5, pants: 0x2f3a4f, long: true });
  who.group.position.set(1.75, 0, 1.95);
  who.group.rotation.y = 1.2;
  scene.add(who.group);
  const bowl = new THREE.Group();
  const cup = box(0.28, 0.1, 0.28, 0xf4f1e8);
  const egg = box(0.12, 0.04, 0.12, 0xf2c14e);
  egg.position.set(-0.05, 0.06, 0);
  const greens = box(0.1, 0.04, 0.1, 0x3f8a39);
  greens.position.set(0.07, 0.06, 0.04);
  bowl.add(cup, egg, greens);
  bowl.position.set(0, 0.95, 0.42);
  who.group.add(bowl);

  const pal = creature(pick(BODIES, "hh_seattle"));
  pal.group.scale.setScalar(PAL);
  scene.add(pal.group);
  const door = lightDoor();
  door.group.position.set(4.8, 0, 0.08);
  scene.add(door.group);
  const doorGlow = new THREE.PointLight(0x9ae6ff, 0, 4, 1.5);
  doorGlow.position.set(4.8, 1.0, 0.6);
  scene.add(doorGlow);

  const ask = bubble("Alexa, what can I cook in ten minutes?");
  ask.position.set(0, 2.15, 0);
  who.group.add(ask);
  const thanks = bubble("Thank you, Alexa! That was perfect.");
  thanks.position.set(0, 2.15, 0);
  who.group.add(thanks);
  const heart = bubble("♥", "emote");
  heart.position.set(0.35, 2.05, 0);
  who.group.add(heart);
  const answer = bubble("Egg and spinach on rice! It's the most thanked quick dinner in town.", "bubble alexa");
  answer.position.set(0, 0.62, 0);
  echo.group.add(answer);
  const hello = bubble("♪", "emote");
  hello.position.set(0, 0.75, 0);
  pal.group.add(hello);

  const caption = document.getElementById("caption")!;
  const flash = document.getElementById("flash")!;

  const S = echoAt.clone().addScaledVector(forward, 0.16).setY(1.22);
  const C1 = echoAt.clone().addScaledVector(forward, 0.45).setY(1.0);
  const F = echoAt.clone().addScaledVector(forward, 1.05).setY(0);
  const DF = new THREE.Vector3(4.8, 0, 0.62);
  const DI = new THREE.Vector3(4.8, 0, 0.1);

  const keys: [number, [number, number, number], number, number, number][] = [
    [0, [2.4, 1.05, 1.7], 6.4, 0.22, 1.24],
    [11500, [2.4, 1.05, 1.7], 6.0, 0.22, 1.24],
    [13300, [3.0, 1.1, 2.0], 3.4, 0.1, 1.22],
    [15600, [2.6, 0.6, 2.2], 4.4, 0.18, 1.2],
    [17300, [3.6, 0.8, 1.5], 5.0, 0.2, 1.22],
    [19600, [4.8, 0.95, 0.35], 2.4, 0.08, 1.38],
  ];

  return {
    length: 20800,
    panels: [
      {
        ...base,
        update(t) {
          // camera
          let i = 0;
          while (i < keys.length - 1 && t >= keys[i + 1][0]) i++;
          const [t0, a, d0, az0, p0] = keys[i];
          const [t1, b, d1, az1, p1] = keys[Math.min(i + 1, keys.length - 1)];
          const x = t1 > t0 ? ease(span(t, t0, t1)) : 0;
          const target = new THREE.Vector3(lerp(a[0], b[0], x), lerp(a[1], b[1], x), lerp(a[2], b[2], x));
          placeCamera(camera, target, lerp(d0, d1, x), lerp(az0, az1, x), lerp(p0, p1, x));

          // the person
          const talking = between(t, 1500, 4600) || between(t, 10200, 13200);
          who.mouth.scale.y = talking && Math.floor(t / 130) % 2 ? 2.4 : 1;
          who.head.rotation.x = talking ? Math.sin(t / 260) * 0.05 : 0;
          const holding = between(t, 9100, 12600);
          who.armL.rotation.x = holding ? -1.1 : Math.sin(t / 900) * 0.04;
          who.armR.rotation.x = holding ? -1.1 : 0;
          bowl.visible = holding;
          const waving = between(t, 15400, 17200);
          if (waving) {
            who.armR.rotation.x = -2.6;
            who.armR.rotation.z = Math.sin(t / 140) * 0.35;
          } else who.armR.rotation.z = 0;
          who.head.rotation.y = t > 14000 ? lerp(0, 0.5, span(t, 14000, 15000)) : 0;
          ask.visible = between(t, 1500, 4600);
          thanks.visible = between(t, 10200, 13300);
          heart.visible = between(t, 11000, 13300);
          heart.position.y = 2.05 + span(t, 11000, 13300) * 0.4;

          // the Echo Show
          const state: Screen =
            t < 1500 ? "clock" : t < 4800 ? "listen" : t < 10200 ? "recipe" : t < 12100 ? "listen" : t < 13700 ? "heart" : t < 14500 ? "glow" : "clock";
          echo.show(state, t);
          answer.visible = between(t, 4800, 8900);
          caption.textContent = "Ten minutes later…";
          caption.classList.toggle("on", between(t, 8800, 10100));

          // the avatar
          pal.group.visible = t >= 13800 && t < 19900;
          let p = S.clone();
          let s = PAL;
          let face = echoTurn;
          let hop = 0;
          if (t < 14600) {
            const k = span(t, 13800, 14600);
            p = arc(S, C1, k, 0.35);
            s = PAL * clamp(k * 2.2, 0.05, 1);
          } else if (t < 15400) p = arc(C1, F, span(t, 14600, 15400), 0.45);
          else if (t < 17200) {
            p = F.clone();
            face = lerp(echoTurn, 0, span(t, 15400, 15800));
            hop = between(t, 15700, 16050) ? Math.sin(Math.PI * span(t, 15700, 16050)) * 0.18 : 0;
          } else if (t < 19200) {
            const k = span(t, 17200, 19200);
            p = F.clone().lerp(DF, k);
            face = Math.atan2(DF.x - F.x, DF.z - F.z);
            hop = Math.abs(Math.sin(k * Math.PI * 7)) * 0.1;
          } else {
            const k = span(t, 19200, 19900);
            p = DF.clone().lerp(DI, k);
            face = Math.PI;
            s = PAL * (1 - k * 0.8);
          }
          pal.group.position.copy(p).add(new THREE.Vector3(0, hop, 0));
          pal.group.scale.setScalar(s);
          pal.group.rotation.y = face;
          hello.visible = between(t, 15500, 16900);

          // the door of light
          const open = span(t, 16500, 17100);
          const close = span(t, 19700, 20100);
          door.group.visible = t >= 16500;
          door.group.scale.setScalar(Math.max(0.001, 1.6 * ease(open)));
          (door.panel.material as THREE.MeshBasicMaterial).color.setHex(0xc9f3ff).lerp(new THREE.Color(0xffffff), close);
          doorGlow.intensity = 9 * ease(open) + 30 * close;
          flash.style.opacity = String(ease(span(t, 19500, 20300)));
        },
      },
    ],
  };
}

// ---- scene 2 ----------------------------------------------------------------------------

const ROOMS: { city: string; says: string; look: Look; wall: number; window: number; floor: "planks" | "darkplanks"; home: string }[] = [
  { city: "Tokyo", says: "ありがとう、アレクサ！", look: { skin: 0xf3d2b5, hair: 0x1b1b1b, shirt: 0xe8eef2, pants: 0x2f3a4f }, wall: 0xe9e4d8, window: 0x9fd4f5, floor: "planks", home: "hh_tokyo" },
  { city: "Mexico City", says: "¡Gracias, Alexa!", look: { skin: 0xc68642, hair: 0x2b1b12, shirt: 0xd6453d, pants: 0x3a3346, long: true }, wall: 0xf6d6a8, window: 0xf3a46b, floor: "darkplanks", home: "hh_mexico" },
  { city: "Paris", says: "Merci, Alexa !", look: { skin: 0xf1c9a5, hair: 0xd9b26a, shirt: 0x2f8f8a, pants: 0x2b2d31, long: true }, wall: 0xdfe6ef, window: 0xc3a6f2, floor: "planks", home: "hh_paris" },
  { city: "Seoul", says: "고마워, 알렉사!", look: { skin: 0xf3d2b5, hair: 0x2b1b12, shirt: 0xf2c14e, pants: 0x3f6fb5 }, wall: 0xf4ead2, window: 0x7fb6ef, floor: "darkplanks", home: "hh_seoul" },
  { city: "São Paulo", says: "Obrigada, Alexa!", look: { skin: 0x8d5a3b, hair: 0x1b1b1b, shirt: 0x5b8f3a, pants: 0x2f3a4f, long: true }, wall: 0xf2e0c9, window: 0xf28f4e, floor: "planks", home: "hh_saopaulo" },
  { city: "Berlin", says: "Danke, Alexa!", look: { skin: 0xf1c9a5, hair: 0xb5651d, shirt: 0x8a4fa8, pants: 0x2b2d31 }, wall: 0xe8eef2, window: 0x9fb4ff, floor: "darkplanks", home: "hh_berlin" },
];

function sceneTwo(materials: Materials, host: HTMLElement, W: number, H: number): { panels: Panel[]; length: number } {
  const cols = 3;
  const gap = 6;
  const pw = Math.floor((W - gap * (cols - 1)) / cols);
  const ph = Math.floor((H - gap) / 2);
  const panels = ROOMS.map((r, i): Panel => {
    const rect = { x: (i % cols) * (pw + gap), y: Math.floor(i / cols) * (ph + gap), w: pw, h: ph };
    const base = makePanel(rect, host);
    const { scene, camera, css } = base;
    lights(scene, i % 2 === 0);
    const v = new Voxels();
    room(v, { wall: r.wall, window: r.window, floor: r.floor, w: 20, d: 12, table: [10, 5], plant: i % 2 === 1, counter: i % 2 === 0 });
    for (const m of v.build(materials)) scene.add(m);
    const echoAt = new THREE.Vector3(2.95, 1.0, 1.65);
    const turn = -0.8;
    const echo = echoShow(r.city);
    echo.group.position.copy(echoAt);
    echo.group.rotation.y = turn;
    scene.add(echo.group);
    const forward = new THREE.Vector3(Math.sin(turn), 0, Math.cos(turn));
    const who = person(r.look);
    who.group.position.set(1.55, 0, 1.7);
    who.group.rotation.y = 1.2;
    scene.add(who.group);
    const says = bubble(r.says, "bubble small");
    says.position.set(0, 2.15, 0);
    who.group.add(says);
    const heart = bubble("♥", "emote");
    heart.position.set(0.35, 2.0, 0);
    who.group.add(heart);
    const pal = creature(pick(BODIES, r.home));
    pal.group.scale.setScalar(PAL);
    scene.add(pal.group);
    const trailGeometry = new THREE.BoxGeometry(0.07, 0.07, 0.07);
    const trail = Array.from({ length: 12 }, (_, k) => {
      const m = new THREE.Mesh(trailGeometry, new THREE.MeshBasicMaterial({ color: [0xffffff, 0x9ae6ff, 0xffe08a][k % 3], transparent: true }));
      scene.add(m);
      return m;
    });
    const label = document.createElement("div");
    label.className = "city";
    label.textContent = r.city;
    css.domElement.appendChild(label);
    const S = echoAt.clone().addScaledVector(forward, 0.16).setY(1.22);
    const C1 = echoAt.clone().addScaledVector(forward, 0.5).setY(1.0);
    const o = i * 320;
    const where = (t: number): THREE.Vector3 => {
      if (t < o + 2500) return S.clone();
      if (t < o + 3100) return arc(S, C1, span(t, o + 2500, o + 3100), 0.3);
      const k = span(t, o + 3100, o + 4700);
      return C1.clone().add(new THREE.Vector3(Math.sin(k * 6) * 0.25 * k, k * k * 6, -k * 0.6));
    };
    return {
      ...base,
      update(t) {
        placeCamera(camera, new THREE.Vector3(2.25, 1.25, 1.5), 5.4 - span(t, 0, 5000) * 0.4, 0.22, 1.2);
        const talking = between(t, o + 300, o + 2400);
        who.mouth.scale.y = talking && Math.floor(t / 130) % 2 ? 2.4 : 1;
        says.visible = between(t, o + 300, o + 2700);
        heart.visible = between(t, o + 900, o + 2700);
        heart.position.y = 2.0 + span(t, o + 900, o + 2700) * 0.35;
        who.armR.rotation.x = between(t, o + 3100, o + 4800) ? -2.6 : 0;
        who.armR.rotation.z = between(t, o + 3100, o + 4800) ? Math.sin(t / 140) * 0.35 : 0;
        echo.show(t < o + 300 ? "clock" : t < o + 1800 ? "listen" : t < o + 2400 ? "heart" : t < o + 3000 ? "glow" : "clock", t);
        const visible = t >= o + 2500 && t < o + 4700;
        pal.group.visible = visible;
        const p = where(t);
        pal.group.position.copy(p);
        pal.group.scale.setScalar(PAL * clamp(span(t, o + 2500, o + 2800) * 1.2 + 0.05, 0.05, 1));
        pal.group.rotation.y = t < o + 3100 ? turn : turn + span(t, o + 3100, o + 4700) * 9;
        trail.forEach((m, k) => {
          const at = t - (k + 1) * 70;
          m.visible = visible && at > o + 3100;
          m.position.copy(where(at)).add(new THREE.Vector3(0, 0.2, 0));
          (m.material as THREE.MeshBasicMaterial).opacity = 1 - k / trail.length;
        });
      },
    };
  });
  return { panels, length: 5200 + ROOMS.length * 320 };
}

// ---- run --------------------------------------------------------------------------------

const which = new URLSearchParams(location.search).get("scene") ?? "1";
const host = document.getElementById("stage")!;
const W = window.innerWidth;
const H = window.innerHeight;
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(W, H);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.setScissorTest(true);
host.appendChild(renderer.domElement);
const materials = makeMaterials();
const film = which === "2" ? sceneTwo(materials, host, W, H) : sceneOne(materials, host, W, H);
window.filmTime = 0;
window.filmDone = false;
// A short hold before the timeline starts, so a recording opens on a still frame.
const HOLD = 800;
const start = performance.now() + HOLD;
renderer.setAnimationLoop((now) => {
  const t = Math.max(0, now - start);
  window.filmTime = t;
  for (const p of film.panels) {
    p.update(Math.min(t, film.length));
    const { x, y, w, h } = p.rect;
    renderer.setViewport(x, H - y - h, w, h);
    renderer.setScissor(x, H - y - h, w, h);
    renderer.render(p.scene, p.camera);
    p.css.render(p.scene, p.camera);
  }
  if (t >= film.length) window.filmDone = true;
});
