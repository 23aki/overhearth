/**
 * The town as a block world in 3D (three.js): the same town, replays and API as the 2D view
 * (scene.ts), drawn as a little diorama. Names, speech bubbles, subtitles and the HUD are HTML
 * laid over the canvas, so text stays sharp at any zoom.
 *
 * Positions are kept in the 2D view's map pixels (16 per tile) so the choreography is the same;
 * one tile is one world unit.
 */
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { CSS2DObject, CSS2DRenderer } from "three/addons/renderers/CSS2DRenderer.js";
import { BODIES, pick } from "./art";
import { landmarkName } from "./landmarks";
import { type Layout, type Lot, type Point, TILE, buildLayout, lotOrder, seeded, walkPath } from "./layout";
import type { Activity, ReplayOptions, TownView } from "./scene";
import { type Growth, type Home, type TownEvent, type TownState, latestTick } from "./types";
import {
  LANDMARKS,
  ROOF_COLORS,
  V,
  Voxels,
  WALL_COLORS,
  bench,
  fountain,
  house,
  lamp,
  lanterns,
  makeMaterials,
  scaffold,
  site,
  tree,
} from "./voxel";

export interface VoxelOptions {
  /** "fixed": an angled diorama view (inside Alexa). "free": the viewer can turn and zoom a little. */
  camera?: "fixed" | "free";
}

const ACTIVE_MS = 90_000;
const WALK_SPEED = 52; // map px per second
const REPLAY_SPEED = 78;
const MARGIN = 5; // tiles of countryside around the town
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const center = (p: Point) => ({ x: p.x * TILE + TILE / 2, y: p.y * TILE + TILE / 2 });
const world = (x: number, y: number) => new THREE.Vector3(x / TILE, 0, y / TILE);

const TOPICS: Record<string, string> = {
  bakery: "cooking",
  playground: "kids",
  library: "reading & study",
  garden: "plants & moving",
  clinic: "health & care",
  cafe: "keeping in touch",
  bathhouse: "rest & sleep",
  stage: "music",
  market: "shopping & saving",
  workshop: "fixing & work",
  petpark: "pets",
};

const CSS = `
.ot-host { overflow: hidden; }
.ot-layer { position: absolute; inset: 0; pointer-events: none; }
.ot-name { font: 700 11px ui-monospace, Menlo, Consolas, monospace; color: #fff; text-shadow: 0 0 2px #1d2230, 0 0 3px #1d2230, 1px 1px 0 #1d2230; white-space: nowrap; transform: translateY(-4px); }
.ot-place { font: 700 11px ui-monospace, Menlo, Consolas, monospace; color: #fff; background: rgba(20,26,38,.62); padding: 1px 6px; border-radius: 4px; white-space: nowrap; }
.ot-bubble { max-width: 230px; background: #fff; color: #1d2230; border: 1.5px solid #1d2230; border-radius: 8px; padding: 5px 8px; font: 13px/1.3 system-ui, -apple-system, "Segoe UI", sans-serif; box-shadow: 0 2px 0 rgba(0,0,0,.25); position: relative; transform: translateY(-50%); }
.ot-bubble::after { content: ""; position: absolute; left: 50%; bottom: -7px; margin-left: -6px; border: 6px solid transparent; border-top-color: #fff; border-bottom: 0; }
.ot-bubble .gloss { display: block; margin-top: 3px; font-size: 11px; font-style: italic; color: #5b6474; }
.ot-bubble.emote { font-size: 16px; padding: 2px 8px; }
.ot-talk { background: #fff; border: 2px solid #34c6f4; border-radius: 10px; padding: 2px 8px; font: 700 12px ui-monospace, Menlo, Consolas, monospace; color: #1d2230; white-space: nowrap; animation: ot-bob 1.2s ease-in-out infinite; }
.ot-talk .icon { color: #ff6b8b; margin: 0 4px; }
.ot-talk .dots::after { content: "•"; animation: ot-dots 1.05s steps(3) infinite; }
@keyframes ot-dots { 0% { content: "•"; } 33% { content: "••"; } 66% { content: "•••"; } }
@keyframes ot-bob { 50% { transform: translateY(-3px); } }
.ot-fly { font-size: 20px; line-height: 1; filter: drop-shadow(0 1px 0 rgba(0,0,0,.4)); }
.ot-float { font: 800 16px ui-monospace, Menlo, Consolas, monospace; color: #ffd27f; text-shadow: 0 0 3px #4a2a10, 0 0 3px #4a2a10, 1px 1px 0 #4a2a10; white-space: nowrap; animation: ot-rise 1.9s ease-out forwards; }
.ot-float.big { font-size: 22px; }
@keyframes ot-rise { 0% { transform: translateY(0); opacity: 0; } 10% { opacity: 1; } 75% { opacity: 1; } 100% { transform: translateY(-34px); opacity: 0; } }
.ot-hud { position: absolute; left: 10px; top: 10px; background: rgba(20,26,38,.74); color: #fff; border-radius: 8px; padding: 8px 10px; font: 12px ui-monospace, Menlo, Consolas, monospace; pointer-events: none; min-width: 190px; }
.ot-hud .row { display: flex; justify-content: space-between; gap: 12px; align-items: baseline; }
.ot-hud .title { font-weight: 700; font-size: 14px; }
.ot-hud .small { color: #d7deea; font-size: 11px; }
.ot-hud .ot-bar { height: 7px; background: #2c3446; border-radius: 4px; margin: 6px 0 5px; overflow: hidden; }
.ot-hud .ot-bar > i { display: block; height: 100%; background: #ffb547; border-radius: 4px; }
.ot-hud.compact { transform: scale(.82); transform-origin: top left; }
`;

function injectCss(): void {
  if (document.getElementById("ot-css")) return;
  const style = document.createElement("style");
  style.id = "ot-css";
  style.textContent = CSS;
  document.head.appendChild(style);
}

function label(className: string, text = ""): CSS2DObject {
  const div = document.createElement("div");
  div.className = className;
  div.textContent = text;
  const object = new CSS2DObject(div);
  object.center.set(0.5, 1);
  return object;
}

function glowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext("2d")!;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(canvas);
}

/** An avatar: a little block creature with Echo's light ring on top. */
class Avatar {
  readonly group = new THREE.Group();
  readonly body: THREE.Mesh;
  readonly name: CSS2DObject;
  readonly home: Home;
  x: number;
  y: number;
  busy = false;
  inside = false;
  speed = WALK_SPEED;
  private generation = 0;
  private fade = 1;
  private route: { x: number; y: number }[] = [];
  private arrive: (() => void) | null = null;
  private feet: THREE.Mesh[] = [];
  private step = 0;

  constructor(home: Home, readonly door: Point, parent: THREE.Object3D) {
    this.home = home;
    const color = new THREE.Color(pick(BODIES, home.id));
    const mat = (c: THREE.ColorRepresentation) => new THREE.MeshLambertMaterial({ color: c });
    this.body = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.3, 0.32), mat(color));
    this.body.position.y = 0.21;
    this.body.castShadow = true;
    this.body.userData.homeId = home.id;
    const eye = new THREE.BoxGeometry(0.06, 0.07, 0.02);
    const dark = new THREE.MeshBasicMaterial({ color: 0x1d2230 });
    for (const dx of [-0.08, 0.08]) {
      const e = new THREE.Mesh(eye, dark);
      e.position.set(dx, 0.04, 0.165);
      this.body.add(e);
      const shine = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.025, 0.01), new THREE.MeshBasicMaterial({ color: 0xffffff }));
      shine.position.set(dx - 0.015, 0.06, 0.177);
      this.body.add(shine);
      const cheek = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.03, 0.01), new THREE.MeshBasicMaterial({ color: 0xe8798b }));
      cheek.position.set(dx * 1.7, -0.03, 0.165);
      this.body.add(cheek);
    }
    // Echo's light ring: four bars around the top.
    const ring = new THREE.MeshBasicMaterial({ color: 0x34c6f4 });
    for (const [w, d, x, z] of [[0.3, 0.04, 0, 0.12], [0.3, 0.04, 0, -0.12], [0.04, 0.2, 0.13, 0], [0.04, 0.2, -0.13, 0]]) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(w, 0.035, d), ring);
      bar.position.set(x, 0.17, z);
      this.body.add(bar);
    }
    const foot = new THREE.BoxGeometry(0.1, 0.06, 0.12);
    for (const dx of [-0.09, 0.09]) {
      const f = new THREE.Mesh(foot, mat(0x3a3346));
      f.position.set(dx, 0.03, 0.02);
      f.castShadow = true;
      this.feet.push(f);
      this.group.add(f);
    }
    this.group.add(this.body);
    this.name = label("ot-name", home.avatar);
    this.name.position.set(0, 0.62, 0);
    this.group.add(this.name);
    const at = this.homeSpot();
    this.x = at.x;
    this.y = at.y;
    parent.add(this.group);
    this.sync();
  }

  get idle(): boolean {
    return !this.busy && this.route.length === 0;
  }

  /** Walk along road tiles; a walk that ends at the home's road tile steps up to the door. */
  walk(path: Point[], speed = this.speed): Promise<void> {
    const points = path.map(center);
    const last = path.at(-1);
    if (last && last.x === this.door.x && last.y === this.door.y) points.push(this.homeSpot());
    return this.walkTo(points, speed);
  }

  walkTo(points: { x: number; y: number }[], speed = this.speed): Promise<void> {
    this.route = [...points];
    this.speed = speed;
    return new Promise((resolve) => {
      this.arrive = resolve;
      if (!this.route.length) this.finish();
    });
  }

  goHome(): void {
    this.generation++;
    this.inside = false;
    this.fade = 1;
    this.route = [];
    const at = this.homeSpot();
    this.x = at.x;
    this.y = at.y;
    this.group.rotation.y = 0;
    this.busy = false;
    this.finish();
    this.sync();
  }

  /** Where the avatar waits at home: a step up from the road, right in front of its door. */
  homeSpot(): { x: number; y: number } {
    return { x: this.door.x * TILE + TILE / 2, y: this.door.y * TILE - 4 };
  }

  /** In the doorway, where it fades out going in. */
  private doorway(): { x: number; y: number } {
    return { x: this.door.x * TILE + TILE / 2, y: this.door.y * TILE - 9 };
  }

  async goInside(): Promise<void> {
    if (this.inside || !this.idle) return;
    const generation = this.generation;
    this.busy = true;
    await this.walkTo([this.homeSpot(), this.doorway()], WALK_SPEED * 0.8);
    if (generation !== this.generation) return;
    this.inside = true;
    this.busy = false;
  }

  async comeOut(): Promise<void> {
    if (!this.inside || this.busy) return;
    const generation = this.generation;
    this.busy = true;
    this.inside = false;
    await this.walkTo([this.homeSpot()], WALK_SPEED * 0.8);
    if (generation === this.generation) this.busy = false;
  }

  face(x: number, y: number): void {
    this.group.rotation.y = Math.atan2(x - this.x, y - this.y);
  }

  private finish(): void {
    const done = this.arrive;
    this.arrive = null;
    done?.();
  }

  update(ms: number): void {
    const target = this.route[0];
    let moving = false;
    if (target) {
      const dx = target.x - this.x;
      const dy = target.y - this.y;
      const stepLength = (this.speed * ms) / 1000;
      const distance = Math.hypot(dx, dy);
      if (distance > 0.01) this.group.rotation.y = Math.atan2(dx, dy);
      if (distance <= stepLength) {
        this.x = target.x;
        this.y = target.y;
        this.route.shift();
        if (!this.route.length) this.finish();
      } else {
        this.x += (dx / distance) * stepLength;
        this.y += (dy / distance) * stepLength;
        moving = true;
      }
    }
    // Waiting at the door, it turns to face the road (and the viewer).
    const home = this.homeSpot();
    if (!moving && !this.inside && Math.hypot(this.x - home.x, this.y - home.y) < 1) {
      const turn = Math.atan2(Math.sin(-this.group.rotation.y), Math.cos(-this.group.rotation.y));
      this.group.rotation.y += turn * Math.min(1, ms / 160);
    }
    this.step += moving ? ms : 0;
    const hop = moving ? Math.abs(Math.sin(this.step / 110)) * 0.05 : 0;
    this.body.position.y = 0.21 + hop;
    this.feet[0].position.z = moving ? 0.02 + Math.sin(this.step / 110) * 0.05 : 0.02;
    this.feet[1].position.z = moving ? 0.02 - Math.sin(this.step / 110) * 0.05 : 0.02;
    const goal = this.inside ? 0 : 1;
    this.fade += (goal - this.fade) * Math.min(1, ms / 200);
    this.sync();
  }

  sync(): void {
    const p = world(this.x, this.y);
    this.group.position.set(p.x, 0, p.z);
    this.group.scale.setScalar(Math.max(0.001, this.fade) * 1.35);
    this.group.visible = this.fade > 0.05;
    this.name.visible = this.group.visible;
  }
}

interface HouseView {
  home: Home;
  lot: Lot;
  windows: number[];
  level: number;
  aura: THREE.Sprite;
  talk: CSS2DObject;
  talkKind: string;
  talking: boolean;
}

export async function createVoxelTownView(host: HTMLElement, options: VoxelOptions = {}): Promise<TownView> {
  injectCss();
  host.classList.add("ot-host");
  if (getComputedStyle(host).position === "static") host.style.position = "relative";
  const free = options.camera === "free";
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(host.clientWidth || 640, host.clientHeight || 400);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.domElement.style.display = "block";
  renderer.domElement.style.width = "100%";
  renderer.domElement.style.height = "100%";
  host.appendChild(renderer.domElement);
  const overlay = new CSS2DRenderer();
  overlay.setSize(host.clientWidth || 640, host.clientHeight || 400);
  overlay.domElement.className = "ot-layer";
  host.appendChild(overlay.domElement);
  const hud = document.createElement("div");
  hud.className = "ot-hud";
  hud.hidden = true;
  host.appendChild(hud);

  const scene = new THREE.Scene();
  const sky = { day: new THREE.Color(0x9fd4f5), night: new THREE.Color(0x0d1530) };
  scene.background = sky.day.clone();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 600);
  const hemi = new THREE.HemisphereLight(0xdff1ff, 0x5a7a3a, 1.3);
  const sun = new THREE.DirectionalLight(0xfff1d8, 2.2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.02;
  scene.add(hemi, sun, sun.target);
  const controls = free ? new OrbitControls(camera, renderer.domElement) : null;
  if (controls) {
    controls.enableDamping = true;
    controls.minPolarAngle = 0.35;
    controls.maxPolarAngle = 1.05;
    controls.screenSpacePanning = false;
  }

  const materials = makeMaterials();
  const glowMap = glowTexture();
  let layout: Layout | null = null;
  let homesKey = "";
  let state: TownState = { homes: [], events: [] };
  let townGroup = new THREE.Group();
  let placesGroup = new THREE.Group();
  const actors = new THREE.Group();
  const effects = new THREE.Group();
  scene.add(townGroup, placesGroup, actors, effects);
  const houses = new Map<string, HouseView>();
  const avatars = new Map<string, Avatar>();
  const lampGlows: THREE.Sprite[] = [];
  const hitBoxes: THREE.Mesh[] = [];
  let windowMesh: THREE.InstancedMesh | null = null;
  let placeWindows: THREE.InstancedMesh | null = null;
  const liveBubbles = new Set<CSS2DObject>();
  const siteCenters = new Map<string, THREE.Vector3>();
  const pending = new Set<string>();
  const revealed = new Set<string>();
  let growthKey = "";
  let followed: string | null = null;
  let selectCallback: ((home: Home) => void) | null = null;
  let nightOverride: number | null = null;
  const activity = new Map<string, { kind: string; until: number }>();
  let subtitles = true;
  let nightLevel = 0;
  let replayToken = 0;
  let clock = 0;
  let strollTimer = 2000;
  let spotlight: { at: THREE.Vector3; until: number } | null = null;
  let recenterUntil = 0;
  const view3 = { target: new THREE.Vector3(), distance: 40, az: 0.62, polar: 0.92 };
  const animations = new Set<(ms: number) => boolean>();

  function townCenter(): THREE.Vector3 {
    return layout ? new THREE.Vector3(layout.width / 2, 0, layout.height / 2) : new THREE.Vector3();
  }

  function fitDistance(): number {
    if (!layout) return 40;
    const aspect = camera.aspect;
    const t = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const byWidth = (layout.width * 0.58) / (t * aspect);
    const byHeight = (layout.height * 0.62) / t;
    return Math.max(byWidth, byHeight);
  }

  function addVoxels(v: Voxels, parent: THREE.Object3D): THREE.InstancedMesh[] {
    const meshes = v.build(materials);
    for (const m of meshes) parent.add(m);
    return meshes;
  }

  function build(): void {
    const ids = lotOrder(state.homes, state.viewer);
    layout = buildLayout(ids);
    scene.remove(townGroup, placesGroup);
    disposeGroup(townGroup);
    disposeGroup(placesGroup);
    townGroup = new THREE.Group();
    placesGroup = new THREE.Group();
    scene.add(townGroup, placesGroup);
    for (const a of avatars.values()) {
      actors.remove(a.group);
      a.name.element.remove();
    }
    for (const b of liveBubbles) b.element.remove();
    liveBubbles.clear();
    houses.clear();
    avatars.clear();
    lampGlows.length = 0;
    hitBoxes.length = 0;
    growthKey = "";

    // Ground: one block-textured slab per tile, on a floating island of earth.
    const tiles: Record<"grass" | "road" | "plaza", { x: number; z: number }[]> = { grass: [], road: [], plaza: [] };
    const rand = seeded("ground3d");
    const v = new Voxels();
    for (let y = -MARGIN; y < layout.height + MARGIN; y++)
      for (let x = -MARGIN; x < layout.width + MARGIN; x++) {
        const inside = x >= 0 && y >= 0 && x < layout.width && y < layout.height;
        const kind = inside ? layout.ground[y][x] : "grass";
        tiles[kind].push({ x, z: y });
        if (!inside && rand() < 0.22) tree(v, x * 4, y * 4, `edge${x},${y}`);
      }
    const slab = new THREE.BoxGeometry(1, V, 1);
    const m = new THREE.Matrix4();
    for (const kind of ["grass", "road", "plaza"] as const) {
      const mesh = new THREE.InstancedMesh(slab, materials.ground[kind], tiles[kind].length);
      tiles[kind].forEach((t, i) => mesh.setMatrixAt(i, m.makeTranslation(t.x + 0.5, -V / 2, t.z + 0.5)));
      mesh.receiveShadow = true;
      townGroup.add(mesh);
    }
    const w = layout.width + 2 * MARGIN;
    const h = layout.height + 2 * MARGIN;
    const earth = new THREE.Mesh(new THREE.BoxGeometry(w, 2, h), materials.island[0].clone());
    const map = ((earth.material as THREE.MeshLambertMaterial).map as THREE.Texture).clone();
    map.repeat.set(w * 2, 4);
    map.needsUpdate = true;
    (earth.material as THREE.MeshLambertMaterial).map = map;
    earth.position.set(layout.width / 2, -V - 1, layout.height / 2);
    townGroup.add(earth);

    fountain(v, layout.fountain.x * 4 + 2, layout.fountain.y * 4 + 2);
    for (const d of layout.decor) {
      if (d.kind === "tree") tree(v, d.x * 4, d.y * 4, `t${d.x},${d.y}`);
      else if (d.kind === "bench") bench(v, d.x * 4, d.y * 4);
      else if (d.kind === "lamp") {
        lamp(v, d.x * 4, d.y * 4);
        const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowMap, color: 0xffd98a, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
        glow.position.set(d.x + 0.625, 5.5 * V, d.y + 0.625);
        glow.scale.setScalar(1.6);
        townGroup.add(glow);
        lampGlows.push(glow);
      } else if (d.kind === "flowers") {
        const r = seeded(`f${d.x},${d.y}`);
        const colors = [0xe86f8a, 0xf2c14e, 0xc3a6f2, 0xf4f1e8];
        for (let i = 0; i < 5; i++) v.add("flower", d.x * 4 + Math.floor(r() * 4), 0, d.y * 4 + Math.floor(r() * 4), colors[Math.floor(r() * 4)]);
      }
    }

    for (const home of state.homes) {
      const lot = layout.lots.get(home.id);
      if (!lot) continue;
      const blocks = house(v, lot.x * 4, lot.y * 4, pick(ROOF_COLORS, home.id), pick(WALL_COLORS, `${home.id}w`));
      const aura = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowMap, color: 0xffb547, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0 }));
      aura.position.set(lot.x + 1.5, 1, lot.y + 2.4);
      aura.scale.setScalar(4);
      townGroup.add(aura);
      const talk = label("ot-talk");
      talk.position.set(lot.x + 1.5, 3.4, lot.y + 1.5);
      talk.visible = false;
      townGroup.add(talk);
      const hit = new THREE.Mesh(new THREE.BoxGeometry(3, 2.6, 2.2), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
      hit.position.set(lot.x + 1.5, 1.3, lot.y + 1.5);
      hit.userData.homeId = home.id;
      townGroup.add(hit);
      hitBoxes.push(hit);
      houses.set(home.id, { home, lot, windows: blocks.windows, level: 0, aura, talk, talkKind: "", talking: false });
      const avatar = new Avatar(home, lot.front, actors);
      avatars.set(home.id, avatar);
    }
    const meshes = addVoxels(v, townGroup);
    windowMesh = meshes.find((mesh) => mesh.name === "window") ?? null;

    // The sun's shadow covers the island.
    const span = Math.max(w, h) * 0.75;
    Object.assign(sun.shadow.camera, { left: -span, right: span, top: span, bottom: -span, near: 1, far: 300 });
    sun.shadow.camera.updateProjectionMatrix();
    sun.position.set(layout.width / 2 - 30, 60, layout.height / 2 + 40);
    sun.target.position.copy(townCenter());

    view3.target.copy(townCenter());
    view3.distance = fitDistance();
    if (controls) {
      controls.target.copy(view3.target);
      placeCamera(view3.target, view3.distance, view3.az, view3.polar);
      controls.minDistance = 5;
      controls.maxDistance = view3.distance * 1.5;
    }
    drawPlaces();
    updateLights();
  }

  function disposeGroup(group: THREE.Group): void {
    group.traverse((o) => {
      if (o instanceof CSS2DObject) o.element.remove();
      if (o instanceof THREE.Mesh || o instanceof THREE.InstancedMesh) o.geometry.dispose();
    });
  }

  function placeCamera(target: THREE.Vector3, distance: number, az: number, polar: number): void {
    camera.position.set(
      target.x + distance * Math.sin(polar) * Math.sin(az),
      target.y + distance * Math.cos(polar),
      target.z + distance * Math.sin(polar) * Math.cos(az),
    );
    camera.lookAt(target);
  }

  function builtPlaces(growth: Growth | null | undefined): { onLots: string[]; lanterns: boolean; bigger: Set<string> } {
    const kinds = (growth?.landmarks ?? []).map((l) => l.kind);
    const bigger = new Set((growth?.upgrades ?? []).map((l) => l.kind).filter((k) => !pending.has(`${k}+`)));
    return { onLots: kinds.filter((k) => k !== "lanterns"), lanterns: kinds.includes("lanterns"), bigger };
  }

  function drawPlaces(): void {
    if (!layout) return;
    const { onLots, lanterns: hasLanterns, bigger } = builtPlaces(state.growth);
    const key = `${onLots.join(",")}|${hasLanterns}|${[...bigger].join(",")}|${[...pending].join(",")}`;
    if (key === growthKey) return;
    growthKey = key;
    scene.remove(placesGroup);
    disposeGroup(placesGroup);
    placesGroup = new THREE.Group();
    scene.add(placesGroup);
    siteCenters.clear();
    const v = new Voxels();
    layout.sites.forEach((lot, i) => {
      const kind = onLots[i];
      const waiting = kind === undefined || pending.has(kind);
      const ox = lot.x * 4;
      const oz = lot.y * 4;
      if (kind && !waiting) LANDMARKS[kind]?.(v, ox, oz, bigger.has(kind));
      else if (kind || i === onLots.length) scaffold(v, ox, oz);
      else site(v, ox, oz);
      const middle = new THREE.Vector3(lot.x + 1.5, 0.8, lot.y + 1.5);
      if (kind) siteCenters.set(kind, middle);
      if (kind && !waiting) {
        const name = label("ot-place", bigger.has(kind) ? `${landmarkName(kind)} ★` : landmarkName(kind));
        name.center.set(0.5, 0);
        name.position.set(lot.x + 1.5, 0.05, lot.y + 3.05);
        placesGroup.add(name);
      }
    });
    if (hasLanterns && !pending.has("lanterns")) {
      const { plaza } = layout;
      lanterns(v, plaza.x * 4, plaza.y * 4, (plaza.x + plaza.w) * 4 - 1, (plaza.y + plaza.h) * 4 - 1);
    }
    const meshes = addVoxels(v, placesGroup);
    placeWindows = meshes.find((mesh) => mesh.name === "window") ?? null;
    updateLights();
  }

  function drawHud(): void {
    const growth = state.growth;
    hud.hidden = !growth;
    if (!growth) return;
    const count = growth.landmarks.length;
    const grown = growth.upgrades?.length ?? 0;
    const share = growth.next_xp === null ? 1 : (growth.xp - growth.level_xp) / Math.max(1, growth.next_xp - growth.level_xp);
    const toGo = growth.next_xp === null ? "complete" : `${growth.next_xp - growth.xp} to next`;
    const favorite = growth.leading && TOPICS[growth.leading] ? ` · loves ${TOPICS[growth.leading]}` : "";
    const grownText = grown ? ` · ${grown} grown bigger` : "";
    hud.innerHTML = "";
    const row = document.createElement("div");
    row.className = "row";
    const title = document.createElement("span");
    title.className = "title";
    title.textContent = `Town Lv ${growth.level}`;
    const next = document.createElement("span");
    next.className = "small";
    next.textContent = toGo;
    row.append(title, next);
    const bar = document.createElement("div");
    bar.className = "ot-bar";
    const fill = document.createElement("i");
    fill.style.width = `${Math.max(3, Math.min(100, share * 100))}%`;
    bar.append(fill);
    const sub = document.createElement("div");
    sub.className = "small";
    sub.textContent = `${count === 1 ? "1 place" : `${count} places`} built with thanks${grownText}${favorite}`;
    hud.append(row, bar, sub);
    hud.classList.toggle("compact", host.clientWidth < 720);
  }

  const DARK = new THREE.Color(0x2a3348);
  const WARM = new THREE.Color(0xffd27a);
  const tmp = new THREE.Color();

  function setWindows(view: HouseView, level: number): void {
    if (!windowMesh) return;
    tmp.copy(DARK).lerp(WARM, level);
    for (const i of view.windows) windowMesh.setColorAt(i, tmp);
    if (windowMesh.instanceColor) windowMesh.instanceColor.needsUpdate = true;
  }

  function updateLights(): void {
    const max = Math.max(1, ...state.homes.map((h) => h.glow));
    for (const view of houses.values()) {
      const share = view.home.glow / max;
      view.level = Math.min(1, 0.08 + nightLevel * 0.5 + share * 0.5);
      setWindows(view, view.level);
      (view.aura.material as THREE.SpriteMaterial).opacity = share * (0.12 + nightLevel * 0.4);
    }
    if (placeWindows) {
      tmp.copy(DARK).lerp(WARM, nightLevel * 0.8);
      for (let i = 0; i < placeWindows.count; i++) placeWindows.setColorAt(i, tmp);
      if (placeWindows.instanceColor) placeWindows.instanceColor.needsUpdate = true;
    }
    for (const g of lampGlows) (g.material as THREE.SpriteMaterial).opacity = nightLevel * 0.85;
    (scene.background as THREE.Color).copy(sky.day).lerp(sky.night, nightLevel);
    hemi.intensity = 1.3 - nightLevel * 0.95;
    hemi.color.setHex(0xdff1ff).lerp(new THREE.Color(0x6a7fc4), nightLevel);
    sun.intensity = 2.2 - nightLevel * 1.85;
    sun.color.setHex(0xfff1d8).lerp(new THREE.Color(0x9fb4ff), nightLevel);
  }

  function clockNight(): number {
    const now = new Date();
    const h = now.getHours() + now.getMinutes() / 60;
    if (h >= 7 && h < 17) return 0;
    if (h >= 17 && h < 19.5) return (h - 17) / 2.5;
    if (h >= 5 && h < 7) return 1 - (h - 5) / 2;
    return 1;
  }

  function door(homeId: string): Point | null {
    return layout?.lots.get(homeId)?.front ?? null;
  }

  async function stroll(avatar: Avatar): Promise<void> {
    if (!layout) return;
    const from = door(avatar.home.id);
    if (!from) return;
    const token = replayToken;
    const tx = Math.max(1, Math.min(layout.width - 2, from.x + Math.round((Math.random() - 0.5) * 12)));
    const target = { x: tx, y: from.y };
    if (layout.ground[target.y][target.x] === "grass") return;
    avatar.busy = true;
    const path = walkPath(layout, from, target);
    await avatar.walk(path, WALK_SPEED * 0.7);
    if (token !== replayToken) return;
    await sleep(800 + Math.random() * 1600);
    if (token !== replayToken) return;
    await avatar.walk([...path].reverse(), WALK_SPEED * 0.7);
    if (token === replayToken) avatar.busy = false;
  }

  const clip = (text: string) => (text.length > 110 ? `${text.slice(0, 107)}…` : text);

  function bubble(avatar: Avatar, text: string, ms: number, gloss?: string | null, emote = false): Promise<void> {
    const object = label(emote ? "ot-bubble emote" : "ot-bubble", clip(text));
    if (subtitles && gloss) {
      const sub = document.createElement("span");
      sub.className = "gloss";
      sub.textContent = clip(gloss);
      object.element.append(sub);
    }
    object.position.set(0, 0.75, 0);
    avatar.group.add(object);
    liveBubbles.add(object);
    return sleep(ms).then(() => {
      liveBubbles.delete(object);
      avatar.group.remove(object);
      object.element.remove();
    });
  }

  function animate(step: (ms: number) => boolean): void {
    animations.add(step);
  }

  /** Something flying in an arc from one point to another (a heart, a bulb, a question). */
  function fly(symbol: string, color: string, from: THREE.Vector3, to: THREE.Vector3, ms: number, height = 1.2): Promise<void> {
    const object = label("ot-fly", symbol);
    object.center.set(0.5, 0.5);
    object.element.style.color = color;
    effects.add(object);
    let t = 0;
    return new Promise((resolve) => {
      animate((dt) => {
        t = Math.min(1, t + dt / ms);
        const e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
        object.position.lerpVectors(from, to, e);
        object.position.y += Math.sin(Math.PI * e) * height;
        if (t >= 1) {
          effects.remove(object);
          object.element.remove();
          resolve();
          return false;
        }
        return true;
      });
    });
  }

  function floatText(at: THREE.Vector3, text: string, big = false): void {
    const object = label(big ? "ot-float big" : "ot-float", text);
    object.position.copy(at);
    effects.add(object);
    setTimeout(() => {
      effects.remove(object);
      object.element.remove();
    }, 2000);
  }

  function sparkles(at: THREE.Vector3): void {
    const geometry = new THREE.BoxGeometry(0.09, 0.09, 0.09);
    const colors = [0xffffff, 0xffe08a, 0xffb5c8, 0x9ae6ff];
    const bits = Array.from({ length: 26 }, (_, i) => {
      const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: colors[i % 4], transparent: true }));
      mesh.position.copy(at);
      effects.add(mesh);
      const a = (i / 26) * Math.PI * 2;
      return { mesh, v: new THREE.Vector3(Math.cos(a) * (1.2 + (i % 3) * 0.5), 2.6 + (i % 4) * 0.6, Math.sin(a) * (1.2 + (i % 3) * 0.5)) };
    });
    let t = 0;
    animate((dt) => {
      t += dt / 1000;
      for (const b of bits) {
        b.mesh.position.set(at.x + b.v.x * t, at.y + b.v.y * t - 3.5 * t * t, at.z + b.v.z * t);
        b.mesh.rotation.set(t * 4, t * 3, 0);
        (b.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 1 - t / 1.5);
      }
      if (t > 1.5) {
        for (const b of bits) effects.remove(b.mesh);
        geometry.dispose();
        return false;
      }
      return true;
    });
  }

  function houseTop(homeId: string): THREE.Vector3 | null {
    const lot = layout?.lots.get(homeId);
    return lot ? new THREE.Vector3(lot.x + 1.5, 2.6, lot.y + 1.6) : null;
  }

  type Talk = "full" | "line" | "emote";
  const EMOTES = ["…", "♪", "!", "?!", "♪♪"];

  async function encounter(event: TownEvent, talk: Talk, token: number, onCaption?: (t: string) => void): Promise<void> {
    const featured = talk === "full";
    if (!layout || event.actors.length !== 2) return;
    const [a, b] = event.actors.map((id) => avatars.get(id));
    const da = door(event.actors[0]);
    const db = door(event.actors[1]);
    if (!a || !b || !da || !db) return;
    a.busy = b.busy = true;
    const path = walkPath(layout, da, db);
    const spread = seeded(event.id)();
    const mid = Math.max(1, Math.min(path.length - 1, Math.floor(path.length * (0.35 + spread * 0.3))));
    const toA = path.slice(0, mid);
    const toB = path.slice(mid).reverse();
    const speed = featured ? WALK_SPEED * 1.1 : REPLAY_SPEED;
    await Promise.all([a.walk(toA, speed), b.walk(toB, speed)]);
    if (token !== replayToken) return;
    a.face(b.x, b.y);
    b.face(a.x, a.y);
    if (featured) onCaption?.(event.summary);
    const lines = event.detail.lines ?? [];
    if (talk === "emote") {
      const pickEmote = seeded(`${event.id}:emote`);
      await bubble(a, EMOTES[Math.floor(pickEmote() * EMOTES.length)], 900, null, true);
      await bubble(b, EMOTES[Math.floor(pickEmote() * EMOTES.length)], 900, null, true);
    } else {
      for (const line of featured ? lines : lines.slice(0, 1)) {
        if (token !== replayToken) return;
        const speaker = line.speaker === a.home.avatar ? a : line.speaker === b.home.avatar ? b : a;
        const reading = line.text.length + (subtitles && line.gloss ? line.gloss.length / 2 : 0);
        await bubble(speaker, line.text, featured ? Math.min(5200, 1400 + reading * 32) : 1800, line.gloss);
      }
    }
    for (const item of (event.detail.items ?? []).slice(0, 4)) {
      if (token !== replayToken) return;
      const giver = item.from === a.home.id ? a : b;
      const taker = giver === a ? b : a;
      const [symbol, color] = item.kind === "thanks" ? ["♥", "#ff6b8b"] : item.kind === "question" ? ["?", "#9db4ff"] : ["✦", "#f9e27a"];
      const from = world(giver.x, giver.y).setY(0.7);
      const to = world(taker.x, taker.y).setY(0.7);
      await fly(symbol, color, from, to, 650, 0.5);
    }
    if (token !== replayToken) return;
    await Promise.all([a.walk([...toA].reverse(), speed), b.walk([...toB].reverse(), speed)]);
    if (token === replayToken) a.busy = b.busy = false;
  }

  async function thanksFlow(event: TownEvent, featured: boolean, onCaption?: (t: string) => void): Promise<void> {
    const to = event.detail.to;
    if (!to) return;
    const target = houseTop(to);
    if (!target) return;
    onCaption?.(event.summary);
    const senders = (event.detail.from ?? []).map(houseTop).filter((p): p is THREE.Vector3 => p !== null);
    await Promise.all(senders.map((from, i) => sleep(i * 250).then(() => fly("♥", "#ff6b8b", from, target, featured ? 2200 : 1500, 3))));
    floatText(target.clone().setY(3.1), `+${event.detail.count ?? senders.length} thanks`);
    const view = houses.get(to);
    if (view) {
      setWindows(view, 1);
      (view.aura.material as THREE.SpriteMaterial).opacity = 0.9;
      await sleep(featured ? 2400 : 1200);
      updateLights();
    }
  }

  async function reveal(event: TownEvent, token: number, onCaption?: (t: string) => void): Promise<void> {
    const kind = event.detail.landmark;
    if (!kind || !layout) return;
    const { plaza } = layout;
    const at = siteCenters.get(kind)?.clone() ?? new THREE.Vector3(plaza.x + plaza.w / 2, 0.8, plaza.y + plaza.h / 2);
    spotlight = { at, until: clock + 5600 };
    onCaption?.(event.summary);
    await sleep(1300);
    if (token !== replayToken) return;
    const key = event.detail.upgrade ? `${kind}+` : kind;
    pending.delete(key);
    revealed.add(key);
    drawPlaces();
    sparkles(at.clone().setY(1.2));
    floatText(at.clone().setY(3.2), `${event.detail.upgrade ? "BIGGER!" : "NEW!"} ${landmarkName(kind)}`, true);
    await sleep(3800);
  }

  const view: TownView = {
    setState(next) {
      const key = next.homes.map((h) => h.id).sort().join(",") + `|${next.viewer ?? ""}`;
      state = next;
      const latest = latestTick(next);
      for (const e of next.events) {
        const kind = e.detail.landmark;
        const k = e.detail.upgrade ? `${kind}+` : kind;
        if (e.type === "town" && e.tick === latest && k && !revealed.has(k)) pending.add(k);
      }
      if (key !== homesKey) {
        homesKey = key;
        build();
      } else {
        for (const home of next.homes) {
          const h = houses.get(home.id);
          if (h) h.home = home;
        }
        updateLights();
        drawPlaces();
      }
      if (next.active) view.setActivity(next.active);
      drawHud();
    },

    async replay(options: ReplayOptions = {}) {
      const token = ++replayToken;
      for (const avatar of avatars.values()) avatar.goHome();
      for (const b of liveBubbles) {
        b.parent?.remove(b);
        b.element.remove();
      }
      liveBubbles.clear();
      const tick = options.tick ?? Math.max(0, ...state.events.map((e) => e.tick));
      const events = state.events.filter((e) => e.tick === tick);
      const focus = options.focus ?? null;
      const mine = (e: TownEvent) => focus !== null && e.actors.includes(focus);
      const encounters = events.filter((e) => e.type === "encounter");
      const featured = encounters.filter(mine);
      const others = encounters.filter((e) => !mine(e));
      const flows = events
        .filter((e) => e.type === "thanks_flow")
        .sort((a, b) => Number(a.detail.to === focus) - Number(b.detail.to === focus));
      const built = events.filter((e) => e.type === "town");
      if (!encounters.length && !flows.length && !built.length) {
        options.onCaption?.("A quiet time in town.");
        return;
      }
      options.onCaption?.(`Town time ${tick}: ${encounters.length} avatars' meetings.`);
      const walks = others.map((e, i) => sleep(i * 220).then(() => encounter(e, !focus && i < 3 ? "line" : "emote", token)));
      const story = (async () => {
        for (const e of featured) await encounter(e, "full", token, options.onCaption);
      })();
      await Promise.all([...walks, story]);
      for (const e of flows) {
        if (token !== replayToken) return;
        await thanksFlow(e, e.detail.to === focus, options.onCaption);
      }
      for (const e of built) {
        if (token !== replayToken) return;
        await reveal(e, token, options.onCaption);
      }
      if (token === replayToken) {
        const last = built.at(-1) ?? flows.find((e) => e.detail.to === focus) ?? featured[0];
        options.onCaption?.(last?.summary ?? `${encounters.length} meetings, ${flows.length} thanks returned.`);
      }
    },

    follow(homeId) {
      followed = homeId;
      if (!homeId) recenterUntil = clock + 1500;
    },

    onSelect(callback) {
      selectCallback = callback;
    },

    setNight(level) {
      nightOverride = level;
      nightLevel = level ?? clockNight();
      updateLights();
    },

    setSubtitles(on) {
      subtitles = on;
    },

    setActivity(active: Record<string, Activity>) {
      activity.clear();
      for (const [id, a] of Object.entries(active)) activity.set(id, { kind: a.kind, until: clock + Math.max(0, ACTIVE_MS - a.ago * 1000) });
    },

    destroy() {
      replayToken++;
      resizeObserver.disconnect();
      renderer.setAnimationLoop(null);
      controls?.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      overlay.domElement.remove();
      hud.remove();
    },
  };

  // Picking: a tap (not a drag) on a house or an avatar selects that home.
  const raycaster = new THREE.Raycaster();
  let down: { x: number; y: number } | null = null;
  renderer.domElement.addEventListener("pointerdown", (e) => (down = { x: e.clientX, y: e.clientY }));
  renderer.domElement.addEventListener("pointerup", (e) => {
    if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5 || !selectCallback) return;
    const rect = renderer.domElement.getBoundingClientRect();
    const pointer = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    const bodies = [...avatars.values()].filter((a) => a.group.visible).map((a) => a.body);
    const hit = raycaster.intersectObjects([...bodies, ...hitBoxes], false)[0];
    const id = hit?.object.userData.homeId as string | undefined;
    const home = id ? state.homes.find((h) => h.id === id) : undefined;
    if (home) selectCallback(home);
  });

  function resize(): void {
    const w = host.clientWidth || 640;
    const h = host.clientHeight || 400;
    renderer.setSize(w, h, false);
    overlay.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    hud.classList.toggle("compact", w < 720);
  }
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(host);
  resize();

  nightLevel = clockNight();
  let last = performance.now();
  renderer.setAnimationLoop((now) => {
    const ms = Math.min(now - last, 100);
    last = now;
    clock += ms;
    for (const avatar of avatars.values()) avatar.update(ms);
    for (const step of [...animations]) if (!step(ms)) animations.delete(step);
    materials.water.offset.x = (clock / 9000) % 1;
    materials.water.offset.y = (clock / 13000) % 1;

    for (const [id, h] of houses) {
      const avatar = avatars.get(id);
      const talking = activity.get(id);
      const on = talking !== undefined && talking.until > clock;
      if (avatar) {
        if (on && !avatar.inside && avatar.idle) void avatar.goInside();
        else if (!on && avatar.inside && !avatar.busy) void avatar.comeOut();
      }
      if (on && avatar?.inside) {
        if (!h.talking || h.talkKind !== talking.kind) {
          const icon = { thanks: "♥", ask: "💡", share: "💡", mail: "✉" }[talking.kind] ?? "";
          h.talk.element.innerHTML = "";
          const name = document.createElement("span");
          name.textContent = h.home.avatar;
          const i = document.createElement("span");
          i.className = "icon";
          i.textContent = icon;
          const dots = document.createElement("span");
          dots.className = "dots";
          h.talk.element.append(name, i, dots);
          h.talkKind = talking.kind;
        }
        h.talking = true;
        h.talk.visible = true;
        setWindows(h, Math.min(1, h.level + 0.3 + Math.sin(clock / 300) * 0.2));
      } else if (h.talking) {
        h.talking = false;
        h.talk.visible = false;
        setWindows(h, h.level);
      }
    }

    strollTimer -= ms;
    if (strollTimer <= 0 && avatars.size) {
      strollTimer = 1500 + Math.random() * 2500;
      const idle = [...avatars.values()].filter((a) => !a.busy && !a.inside);
      const one = idle[Math.floor(Math.random() * idle.length)];
      if (one && idle.length > avatars.size / 2) void stroll(one);
    }
    if (nightOverride === null && Math.floor(clock / 60000) !== Math.floor((clock - ms) / 60000)) {
      nightLevel = clockNight();
      updateLights();
    }

    // Camera: the diorama, or closer on a followed avatar or a landmark being revealed.
    if (layout) {
      const fit = fitDistance();
      const target = followed ? avatars.get(followed) : undefined;
      const spot = spotlight && spotlight.until > clock ? spotlight : null;
      let goal: THREE.Vector3 | null = null;
      let goalDistance = fit;
      if (spot) {
        goal = spot.at;
        goalDistance = Math.min(fit, 16);
      } else if (target) {
        goal = world(target.x, target.y).setY(0.4);
        goalDistance = Math.min(fit, 13);
      } else if (!controls || clock < recenterUntil) {
        goal = townCenter();
        goalDistance = fit;
      }
      const k = Math.min(1, ms / 380);
      if (controls) {
        if (goal) {
          // Move the camera with its target, so the view keeps its angle while it travels.
          const before = controls.target.clone();
          controls.target.lerp(goal, k);
          camera.position.add(controls.target.clone().sub(before));
          const offset = camera.position.clone().sub(controls.target);
          const d = offset.length();
          offset.setLength(d + (goalDistance - d) * k);
          camera.position.copy(controls.target).add(offset);
        }
        controls.maxDistance = fit * 1.5;
        controls.update();
      } else {
        view3.target.lerp(goal ?? townCenter(), k);
        view3.distance += (goalDistance - view3.distance) * k;
        placeCamera(view3.target, view3.distance, view3.az, view3.polar);
      }
      // Names of background homes only show up close, so the whole town stays readable.
      const far = camera.position.distanceTo(controls ? controls.target : view3.target) > 22;
      for (const a of avatars.values()) a.name.visible = a.group.visible && (!far || a.home.tier !== "background" || a.home.id === followed);
    }
    renderer.render(scene, camera);
    overlay.render(scene, camera);
  });

  return view;
}

export function webglAvailable(): boolean {
  try {
    const canvas = document.createElement("canvas");
    return Boolean(canvas.getContext("webgl2"));
  } catch {
    return false;
  }
}
