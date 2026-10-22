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

type Screen = "clock" | "listen" | "recipe" | "heart" | "pal" | "glow";

interface Echo {
  group: THREE.Group;
  show(state: Screen, t: number): void;
}

/** An Echo Show on its little base, screen facing +z. Just a device: no face, no character. */
function echoShow(city = "Seattle", pal = "#7ec8e3"): Echo {
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
      const key = `${state}:${state === "listen" || state === "glow" || state === "pal" ? pulse : ""}`;
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
      } else if (state === "pal") {
        // The avatar shows up on the screen first, bobbing and waving, before it jumps out.
        const bob = Math.sin((pulse / 8) * Math.PI * 2) * 6;
        const x = W / 2 - 60;
        const y = 54 + bob;
        ctx.fillStyle = "#34c6f4";
        ctx.fillRect(x + 10, y - 14, 100, 8);
        ctx.fillStyle = pal;
        ctx.fillRect(x, y, 120, 100);
        ctx.fillStyle = "rgba(255,255,255,0.3)";
        ctx.fillRect(x + 8, y + 8, 16, 26);
        ctx.fillStyle = "#1d2230";
        const blink = pulse === 5;
        ctx.fillRect(x + 28, y + 36, 16, blink ? 4 : 18);
        ctx.fillRect(x + 76, y + 36, 16, blink ? 4 : 18);
        ctx.fillStyle = "#e8798b";
        ctx.fillRect(x + 14, y + 62, 14, 8);
        ctx.fillRect(x + 92, y + 62, 14, 8);
        ctx.fillStyle = pal;
        ctx.fillRect(x + 122, y + 20 + (pulse % 2 ? -18 : -8), 18, 40);
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
  for (let z = 0; z < s.d; z++)
    for (let y = -1; y <= 11; y++) {
      v.add(y === 0 ? "darkplanks" : "plaster", -1, y, z, s.wall);
      v.add(y === 0 ? "darkplanks" : "plaster", s.w, y, z, s.wall);
    }
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

type Key = [number, [number, number, number], [number, number, number]];

/** Camera keyframes: [time, position, look-at], eased between. */
function moveCamera(camera: THREE.Camera, keys: Key[], t: number): void {
  let i = 0;
  while (i < keys.length - 1 && t >= keys[i + 1][0]) i++;
  const [t0, p0, l0] = keys[i];
  const [t1, p1, l1] = keys[Math.min(i + 1, keys.length - 1)];
  const x = t1 > t0 ? ease(span(t, t0, t1)) : 0;
  camera.position.set(lerp(p0[0], p1[0], x), lerp(p0[1], p1[1], x), lerp(p0[2], p1[2], x));
  camera.lookAt(lerp(l0[0], l1[0], x), lerp(l0[1], l1[1], x), lerp(l0[2], l1[2], x));
}

/** The avatar's way out of a room: out of the screen, down to the floor, through the door. */
interface Exit {
  screen: THREE.Vector3;
  table: THREE.Vector3;
  floor: THREE.Vector3;
  doorFront: THREE.Vector3;
  doorIn: THREE.Vector3;
}

interface ExitTimes {
  pop: number;
  down: number;
  look: number;
  walk: number;
  enter: number;
  gone: number;
}

function exitPose(e: Exit, t: number, at: ExitTimes): { p: THREE.Vector3; s: number; face: number; visible: boolean } {
  const visible = t >= at.pop && t < at.gone;
  const toDoor = Math.atan2(e.doorFront.x - e.floor.x, e.doorFront.z - e.floor.z);
  let p = e.screen.clone();
  let s = PAL;
  let face = 0;
  if (t < at.down) {
    const k = span(t, at.pop, at.down);
    p = arc(e.screen, e.table, k, 0.3);
    s = PAL * clamp(k * 2.4, 0.05, 1);
  } else if (t < at.look) p = arc(e.table, e.floor, span(t, at.down, at.look), 0.45);
  else if (t < at.walk) {
    p = e.floor.clone();
    if (between(t, at.look + 200, at.look + 550)) p.y += Math.sin(Math.PI * span(t, at.look + 200, at.look + 550)) * 0.16;
    face = lerp(0, toDoor, span(t, at.walk - 400, at.walk));
  } else if (t < at.enter) {
    const k = span(t, at.walk, at.enter);
    p = e.floor.clone().lerp(e.doorFront, k);
    p.y += Math.abs(Math.sin(k * Math.PI * 6)) * 0.1;
    face = toDoor;
  } else {
    const k = span(t, at.enter, at.gone);
    p = e.doorFront.clone().lerp(e.doorIn, k);
    face = Math.PI;
    s = PAL * (1 - k * 0.85);
  }
  return { p, s, face, visible };
}

function bowlModel(): THREE.Group {
  const bowl = new THREE.Group();
  const cup = box(0.28, 0.1, 0.28, 0xf4f1e8);
  const egg = box(0.12, 0.04, 0.12, 0xf2c14e);
  egg.position.set(-0.05, 0.06, 0);
  const greens = box(0.1, 0.04, 0.1, 0x3f8a39);
  greens.position.set(0.07, 0.06, 0.04);
  bowl.add(cup, egg, greens);
  return bowl;
}

function sceneOne(materials: Materials, host: HTMLElement, W: number, H: number): { panels: Panel[]; length: number } {
  const base = makePanel({ x: 0, y: 0, w: W, h: H }, host);
  const { scene, camera } = base;
  lights(scene);
  const v = new Voxels();
  room(v, { wall: 0xf1e2c8, window: 0xf3a46b, floor: "planks", w: 26, d: 18, table: [10, 4], plant: true, counter: true, windowX: 1 });
  for (const m of v.build(materials)) scene.add(m);

  const palColor = pick(BODIES, "hh_seattle");
  const echoAt = new THREE.Vector3(3.0, 1.0, 1.3);
  const echo = echoShow("Seattle", palColor);
  echo.group.position.copy(echoAt);
  scene.add(echo.group);

  // Seen over the shoulder: the person faces the Echo Show, their back to us.
  const who = person({ skin: 0xf1c9a5, hair: 0x6b3e26, shirt: 0x3f6fb5, pants: 0x2f3a4f, long: true });
  const stand = new THREE.Vector3(1.7, 0, 2.7);
  const away = new THREE.Vector3(-1.4, 0, 3.4);
  const facing = Math.atan2(echoAt.x - stand.x, echoAt.z - stand.z);
  who.group.position.copy(stand);
  who.group.rotation.y = facing;
  scene.add(who.group);
  const bowl = bowlModel();
  bowl.position.set(0, 0.95, 0.42);
  who.group.add(bowl);

  const pal = creature(palColor);
  pal.group.scale.setScalar(PAL);
  scene.add(pal.group);
  const doorAt = new THREE.Vector3(5.3, 0, 0.08);
  const door = lightDoor();
  door.group.position.copy(doorAt);
  scene.add(door.group);
  const doorGlow = new THREE.PointLight(0x9ae6ff, 0, 4, 1.5);
  doorGlow.position.set(doorAt.x, 1.0, 0.6);
  scene.add(doorGlow);

  // Big, readable bubbles in the upper right, spoken toward the Echo Show.
  const ask = bubble("Alexa, what can I cook in ten minutes?", "bubble big");
  ask.position.set(3.25, 2.3, 1.9);
  scene.add(ask);
  const thanks = bubble("Thank you, Alexa!", "bubble big");
  thanks.position.set(3.25, 2.3, 1.9);
  scene.add(thanks);
  const heart = bubble("♥", "emote big");
  heart.position.set(1.9, 2.4, 2.5);
  scene.add(heart);
  const answer = bubble("Egg and spinach on rice! The most thanked quick dinner in town.", "bubble big alexa");
  answer.position.set(3.25, 2.3, 1.9);
  scene.add(answer);
  const hello = bubble("♪", "emote big");
  hello.position.set(0, 0.8, 0);
  pal.group.add(hello);

  const caption = document.getElementById("caption")!;
  const flash = document.getElementById("flash")!;
  const exit: Exit = {
    screen: echoAt.clone().add(new THREE.Vector3(0, 0.22, 0.14)),
    table: echoAt.clone().add(new THREE.Vector3(0, 0, 0.36)),
    floor: new THREE.Vector3(3.15, 0, 2.35),
    doorFront: doorAt.clone().add(new THREE.Vector3(0, 0, 0.55)),
    doorIn: doorAt.clone().add(new THREE.Vector3(0, 0, 0.02)),
  };
  const at: ExitTimes = { pop: 17000, down: 17700, look: 18400, walk: 19600, enter: 21400, gone: 22000 };
  const keys: Key[] = [
    [0, [0.55, 2.35, 5.7], [3.05, 1.45, 1.3]],
    [12400, [0.65, 2.3, 5.55], [3.05, 1.4, 1.3]],
    [14800, [2.6, 1.75, 3.6], [3.0, 1.2, 1.3]],
    [17600, [2.9, 2.05, 4.3], [3.05, 0.95, 1.7]],
    [18600, [3.0, 1.9, 4.6], [3.1, 0.5, 2.1]],
    [19300, [3.5, 2.0, 4.8], [4.0, 0.5, 1.4]],
    [21600, [5.3, 1.25, 2.3], [5.3, 0.9, 0.1]],
  ];

  return {
    length: 22700,
    panels: [
      {
        ...base,
        update(t) {
          moveCamera(camera, keys, t);
          const talking = between(t, 900, 4000) || between(t, 9400, 12000);
          who.mouth.scale.y = talking && Math.floor(t / 130) % 2 ? 2.4 : 1;
          who.head.rotation.x = talking ? Math.sin(t / 260) * 0.05 : 0;
          const holding = between(t, 8300, 12300);
          who.armL.rotation.x = holding ? -1.1 : Math.sin(t / 900) * 0.04;
          who.armR.rotation.x = holding ? -1.1 : 0;
          bowl.visible = holding;
          // After saying thanks, the person heads off to the left, out of the shot.
          const leave = span(t, 12600, 14600);
          who.group.visible = leave < 1;
          who.group.position.copy(stand).lerp(away, ease(leave));
          who.group.rotation.y = leave > 0 ? Math.atan2(away.x - stand.x, away.z - stand.z) : facing;
          who.group.position.y = leave > 0 && leave < 1 ? Math.abs(Math.sin(t / 120)) * 0.04 : 0;
          ask.visible = between(t, 900, 4000);
          answer.visible = between(t, 4200, 8000);
          thanks.visible = between(t, 9400, 12400);
          heart.visible = between(t, 10000, 12400);
          heart.position.y = 2.25 + span(t, 10000, 12400) * 0.35;
          caption.textContent = "Ten minutes later…";
          caption.classList.toggle("on", between(t, 8100, 9300));

          // On the screen first: the avatar shows up, waves, and then jumps out.
          const state: Screen =
            t < 900 ? "clock" : t < 4200 ? "listen" : t < 9400 ? "recipe" : t < 11000 ? "listen" : t < 14800 ? "heart" : t < 16600 ? "pal" : t < 17100 ? "glow" : "clock";
          echo.show(state, t);

          const pose = exitPose(exit, t, at);
          pal.group.visible = pose.visible;
          pal.group.position.copy(pose.p);
          pal.group.scale.setScalar(pose.s);
          pal.group.rotation.y = pose.face;
          hello.visible = between(t, at.look + 100, at.walk - 200);

          const open = span(t, 19000, 19600);
          const close = span(t, 21800, 22200);
          door.group.visible = t >= 19000;
          door.group.scale.setScalar(Math.max(0.001, 1.6 * ease(open)));
          (door.panel.material as THREE.MeshBasicMaterial).color.setHex(0xc9f3ff).lerp(new THREE.Color(0xffffff), close);
          doorGlow.intensity = 9 * ease(open) + 30 * close;
          flash.style.opacity = String(ease(span(t, 21700, 22400)));
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
    room(v, { wall: r.wall, window: r.window, floor: r.floor, w: 22, d: 14, table: [10, 4], plant: i % 2 === 1, counter: i % 2 === 0, windowX: 1 });
    for (const m of v.build(materials)) scene.add(m);
    const palColor = pick(BODIES, r.home);
    const echoAt = new THREE.Vector3(3.0, 1.0, 1.3);
    const echo = echoShow(r.city, palColor);
    echo.group.position.copy(echoAt);
    scene.add(echo.group);
    const who = person(r.look);
    const stand = new THREE.Vector3(1.6, 0, 2.8);
    who.group.position.copy(stand);
    who.group.rotation.y = Math.atan2(echoAt.x - stand.x, echoAt.z - stand.z);
    scene.add(who.group);
    const says = bubble(r.says, "bubble mid");
    says.position.set(3.2, 2.25, 1.9);
    scene.add(says);
    const pal = creature(palColor);
    pal.group.scale.setScalar(PAL);
    scene.add(pal.group);
    const doorAt = new THREE.Vector3(4.35, 0, 0.08);
    const door = lightDoor();
    door.group.position.copy(doorAt);
    scene.add(door.group);
    const label = document.createElement("div");
    label.className = "city";
    label.textContent = r.city;
    css.domElement.appendChild(label);
    const exit: Exit = {
      screen: echoAt.clone().add(new THREE.Vector3(0, 0.22, 0.14)),
      table: echoAt.clone().add(new THREE.Vector3(0, 0, 0.36)),
      floor: new THREE.Vector3(3.25, 0, 2.3),
      doorFront: doorAt.clone().add(new THREE.Vector3(0, 0, 0.5)),
      doorIn: doorAt.clone().add(new THREE.Vector3(0, 0, 0.02)),
    };
    const o = i * 280;
    const at: ExitTimes = { pop: o + 3700, down: o + 4200, look: o + 4700, walk: o + 5200, enter: o + 6200, gone: o + 6600 };
    return {
      ...base,
      update(t) {
        camera.fov = 44;
        camera.updateProjectionMatrix();
        camera.position.set(0.75 + span(t, 0, 7000) * 0.15, 2.35, 5.6);
        camera.lookAt(3.2, 1.2, 1.4);
        const talking = between(t, o + 300, o + 2200);
        who.mouth.scale.y = talking && Math.floor(t / 130) % 2 ? 2.4 : 1;
        const waving = between(t, o + 4700, o + 6200);
        who.armR.rotation.x = waving ? -2.6 : 0;
        who.armR.rotation.z = waving ? Math.sin(t / 140) * 0.35 : 0;
        says.visible = between(t, o + 300, o + 2600);
        echo.show(t < o + 300 ? "clock" : t < o + 1700 ? "listen" : t < o + 2600 ? "heart" : t < o + 3500 ? "pal" : t < o + 3800 ? "glow" : "clock", t);
        const pose = exitPose(exit, t, at);
        pal.group.visible = pose.visible;
        pal.group.position.copy(pose.p);
        pal.group.scale.setScalar(pose.s);
        pal.group.rotation.y = pose.face;
        const open = span(t, o + 4500, o + 5000);
        const close = span(t, o + 6500, o + 7000);
        door.group.visible = t >= o + 4500 && close < 1;
        door.group.scale.setScalar(Math.max(0.001, 1.5 * ease(open) * (1 - ease(close))));
      },
    };
  });
  return { panels, length: 7300 + (ROOMS.length - 1) * 280 };
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
