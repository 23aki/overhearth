/**
 * The town as a small game world. Used by the watch page and by the MCP App inside Alexa.
 *
 * Avatars live by their homes and wander a little. A replay plays one town tick: avatars walk
 * out along the roads, meet halfway, say their lines in speech bubbles and hand things over;
 * then thanks travel home as hearts and the receiving home lights up. As the town grows,
 * landmarks go up on the lots kept for them; one built in the tick being replayed is revealed
 * at the end, with the camera on it.
 */
import { Application, Container, Graphics, Sprite, Text, TextStyle, type Texture } from "pixi.js";
import { type Art, BODIES, ROOFS, makeArt, pick } from "./art";
import { makeLandmarkArt, landmarkName } from "./landmarks";
import { type Layout, type Lot, type Point, TILE, buildLayout, lotOrder, seeded, walkPath } from "./layout";
import { type Growth, type Home, type TownEvent, type TownState, latestTick } from "./types";

export interface Activity {
  /** talk, thanks, ask, share, news, mail, town */
  kind: string;
  /** Seconds since the last exchange. */
  ago: number;
}

/** A home counts as talking for this long after its last exchange (matches the server). */
const ACTIVE_MS = 90_000;

export interface ReplayOptions {
  /** Which tick to play; the latest by default. */
  tick?: number;
  /** A home whose story is told in full and last. */
  focus?: string | null;
  /** Called with a one-line description of what is happening. */
  onCaption?: (text: string) => void;
}

export interface TownView {
  setState(state: TownState): void;
  replay(options?: ReplayOptions): Promise<void>;
  /** Follow one home's avatar with the camera, or null for the whole town. */
  follow(homeId: string | null): void;
  onSelect(callback: (home: Home) => void): void;
  /** 0 is day, 1 is deep night; null follows the viewer's clock. */
  setNight(level: number | null): void;
  /** Show a small English translation under lines in other languages. */
  setSubtitles(on: boolean): void;
  /**
   * Homes talking with their Alexa right now ({id: {kind, ago}}): their avatars go home, a bubble
   * shows over the house, and they come back out once the home has been quiet for a while.
   */
  setActivity(active: Record<string, Activity>): void;
  /**
   * Avatars arriving in town (3D only, for the demo film): light gathers around each house's
   * front door, and the avatar steps out of its own house. null brings everyone, one by one.
   */
  arrive?(homes: string[] | null, delayMs?: number): Promise<void>;
  destroy(): void;
}

const WALK_SPEED = 52; // px per second
/** Countryside drawn around the town, so wide screens never show an empty edge. */
const MARGIN_X = 28;
const MARGIN_Y = 12;
const REPLAY_SPEED = 78;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const center = (p: Point) => ({ x: p.x * TILE + TILE / 2, y: p.y * TILE + TILE - 3 });

const LABEL = new TextStyle({
  fontFamily: "ui-monospace, Menlo, Consolas, monospace",
  fontSize: 7,
  fontWeight: "700",
  fill: "#ffffff",
  stroke: { color: "#1d2230", width: 2 },
});
const BUBBLE = new TextStyle({
  fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif",
  fontSize: 7,
  fill: "#1d2230",
  wordWrap: true,
  wordWrapWidth: 110,
  breakWords: true, // Japanese, Chinese and Korean have no spaces to break at
  lineHeight: 9,
});
const GLOSS = new TextStyle({
  fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif",
  fontSize: 5.5,
  fontStyle: "italic",
  fill: "#5b6474",
  wordWrap: true,
  wordWrapWidth: 110,
  breakWords: true,
  lineHeight: 7,
});
const HUD_TEXT = new TextStyle({
  fontFamily: "ui-monospace, Menlo, Consolas, monospace",
  fontSize: 13,
  fontWeight: "700",
  fill: "#ffffff",
});
const HUD_SMALL = new TextStyle({
  fontFamily: "ui-monospace, Menlo, Consolas, monospace",
  fontSize: 10,
  fill: "#d7deea",
});
/** What each landmark's topic is called on the HUD ("the town's favorite"). */
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

const FLOAT = new TextStyle({
  fontFamily: "ui-monospace, Menlo, Consolas, monospace",
  fontSize: 9,
  fontWeight: "700",
  fill: "#ffd27f",
  stroke: { color: "#4a2a10", width: 2 },
});

/**
 * A speech bubble and its tail as one outline: a rounded box with a tail at the bottom middle,
 * so it can be filled and stroked in one go (no seam where the tail meets the box).
 */
function bubbleShape(g: Graphics, x: number, y: number, w: number, h: number, r: number, tail: number, tailH: number): Graphics {
  const bottom = y + h;
  return g
    .moveTo(x + r, y)
    .lineTo(x + w - r, y)
    .arcTo(x + w, y, x + w, y + r, r)
    .lineTo(x + w, bottom - r)
    .arcTo(x + w, bottom, x + w - r, bottom, r)
    .lineTo(tail, bottom)
    .lineTo(0, bottom + tailH)
    .lineTo(-tail, bottom)
    .lineTo(x + r, bottom)
    .arcTo(x, bottom, x, bottom - r, r)
    .lineTo(x, y + r)
    .arcTo(x, y, x + r, y, r)
    .closePath();
}

class Avatar {
  readonly sprite: Sprite;
  readonly label: Text;
  readonly home: Home;
  x: number;
  y: number;
  busy = false;
  /** In the house, talking with its person. */
  inside = false;
  private fade = 1;
  private generation = 0;
  private frames: Texture[];
  private route: { x: number; y: number }[] = [];
  private arrive: (() => void) | null = null;
  private clock = 0;
  speed = WALK_SPEED;

  constructor(home: Home, art: Art, readonly door: Point, layer: Container, labels: Container) {
    this.home = home;
    this.frames = art.avatar(pick(BODIES, home.id));
    this.sprite = new Sprite(this.frames[0]);
    this.sprite.anchor.set(0.5, 1);
    this.sprite.eventMode = "static";
    this.sprite.cursor = "pointer";
    const at = center(door);
    this.x = at.x;
    this.y = at.y - 2;
    layer.addChild(this.sprite);
    this.label = new Text({ text: home.avatar, style: LABEL, resolution: 4 });
    this.label.anchor.set(0.5, 1);
    labels.addChild(this.label);
    this.sync();
  }

  get idle(): boolean {
    return !this.busy && this.route.length === 0;
  }

  walk(path: Point[], speed = this.speed): Promise<void> {
    return this.walkTo(path.map(center), speed);
  }

  /** Walk through points in pixels. */
  walkTo(points: { x: number; y: number }[], speed = this.speed): Promise<void> {
    this.route = [...points];
    this.speed = speed;
    return new Promise((resolve) => {
      this.arrive = resolve;
      if (!this.route.length) this.finish();
    });
  }

  /** Back at the door at once, dropping any walk in progress. */
  goHome(): void {
    this.generation++;
    this.inside = false;
    this.fade = 1;
    this.route = [];
    const at = center(this.door);
    this.x = at.x;
    this.y = at.y - 2;
    this.busy = false;
    this.finish();
    this.sync();
  }

  /** Walk up to the door and go in: the person is talking with Alexa. */
  async goInside(): Promise<void> {
    if (this.inside || !this.idle) return;
    const generation = this.generation;
    this.busy = true;
    const front = center(this.door);
    await this.walkTo([{ x: front.x, y: front.y - 2 }, { x: front.x, y: this.door.y * TILE - 2 }], WALK_SPEED * 0.8);
    if (generation !== this.generation) return;
    this.inside = true;
    this.busy = false;
  }

  /** Step back out of the door once things have been quiet. */
  async comeOut(): Promise<void> {
    if (!this.inside || this.busy) return;
    const generation = this.generation;
    this.busy = true;
    this.inside = false;
    const front = center(this.door);
    await this.walkTo([{ x: front.x, y: front.y - 2 }], WALK_SPEED * 0.8);
    if (generation === this.generation) this.busy = false;
  }

  face(x: number): void {
    this.sprite.scale.x = x < this.x ? -1 : 1;
  }

  private finish(): void {
    const done = this.arrive;
    this.arrive = null;
    this.sprite.texture = this.frames[0];
    done?.();
  }

  update(ms: number): void {
    this.clock += ms;
    const target = this.route[0];
    if (target) {
      const dx = target.x - this.x;
      const dy = target.y - this.y;
      const step = (this.speed * ms) / 1000;
      const distance = Math.hypot(dx, dy);
      if (distance <= step) {
        this.x = target.x;
        this.y = target.y;
        this.route.shift();
        if (!this.route.length) this.finish();
      } else {
        this.x += (dx / distance) * step;
        this.y += (dy / distance) * step;
        if (Math.abs(dx) > 0.5) this.sprite.scale.x = dx < 0 ? -1 : 1;
      }
      this.sprite.texture = this.frames[1 + (Math.floor(this.clock / 140) % 2)];
    } else {
      this.sprite.texture = this.frames[Math.floor(this.clock / 700) % 6 === 0 ? 1 : 0];
    }
    // Fade into the house, or out of it.
    const goal = this.inside ? 0 : 1;
    this.fade += Math.sign(goal - this.fade) * Math.min(Math.abs(goal - this.fade), ms / 350);
    this.sprite.alpha = this.fade;
    this.label.alpha = this.fade;
    this.sync();
  }

  private sync(): void {
    this.sprite.position.set(Math.round(this.x), Math.round(this.y));
    this.sprite.zIndex = this.y;
    this.label.position.set(Math.round(this.x), Math.round(this.y) - 19);
  }
}

class Bubble {
  readonly node = new Container();

  constructor(
    text: string,
    private readonly avatar: Avatar,
    layer: Container,
    gloss?: string | null,
  ) {
    const label = new Text({ text, style: BUBBLE, resolution: 4 });
    const sub = gloss ? new Text({ text: gloss, style: GLOSS, resolution: 4 }) : null;
    const w = Math.ceil(Math.max(label.width, sub?.width ?? 0)) + 8;
    const h = Math.ceil(label.height + (sub ? sub.height + 2 : 0)) + 6;
    const box = bubbleShape(new Graphics(), -w / 2, -h - 5, w, h, 3, 3, 4)
      .fill({ color: 0xffffff })
      .stroke({ color: 0x1d2230, width: 1, join: "round" });
    label.position.set(-w / 2 + 4, -h - 2);
    this.node.addChild(box, label);
    if (sub) {
      sub.position.set(-w / 2 + 4, -h - 2 + label.height + 2);
      this.node.addChild(sub);
    }
    layer.addChild(this.node);
    this.update();
  }

  update(): void {
    this.node.position.set(Math.round(this.avatar.x), Math.round(this.avatar.y) - 21);
  }

  destroy(): void {
    this.node.destroy({ children: true });
  }
}

interface HouseView {
  home: Home;
  lot: Lot;
  house: Sprite;
  windows: Sprite;
  aura: Sprite;
  /** Window light without the talking pulse. */
  baseWindows: number;
  talk: TalkBubble;
  talking: boolean;
}

const TALK_TEXT = new TextStyle({
  fontFamily: "ui-monospace, Menlo, Consolas, monospace",
  fontSize: 7,
  fontWeight: "700",
  fill: "#1d2230",
});

/** "Kiri ♥ •••" over a house whose person is talking with Alexa. */
class TalkBubble {
  readonly node = new Container();
  private readonly box = new Graphics();
  private readonly name: Text;
  private readonly dots: Text;
  private readonly icon = new Sprite();
  private kind = "";

  constructor(
    private readonly art: Art,
    avatar: string,
    private readonly x: number,
    private readonly y: number,
    layer: Container,
  ) {
    this.name = new Text({ text: avatar, style: TALK_TEXT, resolution: 4 });
    this.dots = new Text({ text: "•••", style: TALK_TEXT, resolution: 4 });
    this.icon.anchor.set(0, 0.5);
    this.node.addChild(this.box, this.name, this.icon, this.dots);
    this.node.visible = false;
    layer.addChild(this.node);
  }

  show(kind: string, clock: number): void {
    if (kind !== this.kind) {
      this.kind = kind;
      const icons: Record<string, Texture> = {
        thanks: this.art.heart,
        ask: this.art.bulb,
        share: this.art.bulb,
        mail: this.art.envelope,
      };
      const icon = icons[kind];
      this.icon.texture = icon ?? this.art.heart;
      this.icon.visible = Boolean(icon);
      this.layout();
    }
    this.dots.text = "•••".slice(0, 1 + (Math.floor(clock / 350) % 3)).padEnd(3, " ");
    this.node.visible = true;
    this.node.position.set(this.x, Math.round(this.y + Math.sin(clock / 380) * 1.5));
  }

  hide(): void {
    this.node.visible = false;
  }

  private layout(): void {
    const iconWidth = this.icon.visible ? this.icon.width + 3 : 0;
    const w = this.name.width + 4 + iconWidth + this.dots.width + 8;
    const h = 13;
    this.box
      .clear();
    bubbleShape(this.box, -w / 2, -h - 4, w, h, 4, 3, 4)
      .fill({ color: 0xffffff })
      .stroke({ color: 0x34c6f4, width: 1, join: "round" });
    let x = -w / 2 + 4;
    this.name.position.set(x, -h - 2);
    x += this.name.width + 4;
    this.icon.position.set(x, -h / 2 - 4);
    x += iconWidth;
    this.dots.position.set(x, -h - 2);
  }
}

export async function createTownView(host: HTMLElement): Promise<TownView> {
  const app = new Application();
  await app.init({
    background: "#4f8a42",
    antialias: false,
    roundPixels: true,
    preference: "webgl",
    resolution: Math.min(window.devicePixelRatio || 1, 2),
    autoDensity: true,
    width: host.clientWidth || 640,
    height: host.clientHeight || 400,
  });
  app.canvas.style.display = "block";
  app.canvas.style.width = "100%";
  app.canvas.style.height = "100%";
  app.canvas.style.imageRendering = "pixelated";
  host.appendChild(app.canvas);

  const art = makeArt();
  const places = makeLandmarkArt();
  const world = new Container();
  const hud = new Container();
  app.stage.addChild(world, hud);
  const ground = new Container();
  const objects = new Container();
  const night = new Graphics();
  const lights = new Container();
  const effects = new Container();
  const labels = new Container();
  const bubbles = new Container();
  objects.sortableChildren = true;
  world.addChild(ground, objects, night, lights, effects, labels, bubbles);

  let layout: Layout | null = null;
  let homesKey = "";
  let state: TownState = { homes: [], events: [] };
  const houses = new Map<string, HouseView>();
  const avatars = new Map<string, Avatar>();
  const liveBubbles = new Set<Bubble>();
  const fountain = new Sprite(art.fountain[0]);
  let followed: string | null = null;
  let selectCallback: ((home: Home) => void) | null = null;
  let nightOverride: number | null = null;
  const activity = new Map<string, { kind: string; until: number }>();
  let subtitles = true;
  let nightLevel = 0;
  let replayToken = 0;
  let clock = 0;
  let strollTimer = 2000;
  const camera = { x: 0, y: 0, zoom: 1 };
  const lamps: Sprite[] = [];
  /** Landmark sprites on their lots, their name labels and the lanterns: redrawn as the town grows. */
  let placeNodes: Container[] = [];
  const siteSprites = new Map<string, Sprite>();
  /** Landmarks built in the latest tick, shown as building sites until the replay reveals them. */
  const pending = new Set<string>();
  const revealed = new Set<string>();
  let growthKey = "";
  /** Where the camera looks for a moment (a landmark being revealed). */
  let spotlight: { x: number; y: number; until: number } | null = null;

  function fitZoom(): number {
    if (!layout) return 1;
    const zw = app.screen.width / (layout.width * TILE);
    const zh = app.screen.height / (layout.height * TILE);
    return Math.max(0.5, Math.min(zw, zh));
  }

  function build(): void {
    const ids = lotOrder(state.homes, state.viewer);
    layout = buildLayout(ids);
    for (const layer of [ground, objects, lights, effects, labels, bubbles]) layer.removeChildren().forEach((c) => c.destroy());
    houses.clear();
    avatars.clear();
    lamps.length = 0;
    liveBubbles.clear();

    const rand = seeded("ground");
    for (let y = -MARGIN_Y; y < layout.height + MARGIN_Y; y++) {
      for (let x = -MARGIN_X; x < layout.width + MARGIN_X; x++) {
        const inside = x >= 0 && y >= 0 && x < layout.width && y < layout.height;
        const kind = inside ? layout.ground[y][x] : "grass";
        if (!inside && rand() < 0.16) {
          const tree = new Sprite(art.tree);
          tree.anchor.set(0.5, 1);
          tree.position.set(x * TILE + TILE / 2, y * TILE + TILE);
          tree.zIndex = tree.y;
          objects.addChild(tree);
        }
        const t = kind === "road" ? art.road : kind === "plaza" ? art.plaza : art.grass[Math.floor(rand() * 3)];
        const tile = new Sprite(t);
        tile.position.set(x * TILE, y * TILE);
        ground.addChild(tile);
      }
    }
    fountain.anchor.set(0.5, 1);
    fountain.position.set(layout.fountain.x * TILE + TILE / 2, layout.fountain.y * TILE + TILE + 8);
    fountain.zIndex = fountain.y;
    objects.addChild(fountain);

    for (const d of layout.decor) {
      const t = d.kind === "tree" ? art.tree : d.kind === "flowers" ? art.flowers : d.kind === "lamp" ? art.lamp : art.bench;
      const s = new Sprite(t);
      s.anchor.set(0.5, 1);
      s.position.set(d.x * TILE + TILE / 2, d.y * TILE + TILE);
      s.zIndex = d.kind === "flowers" ? -1 : s.y;
      (d.kind === "flowers" ? ground : objects).addChild(s);
      if (d.kind === "lamp") {
        const light = new Sprite(art.lampLight);
        light.anchor.set(0.5);
        light.position.set(s.x, s.y - 18);
        light.blendMode = "add";
        lights.addChild(light);
        lamps.push(light);
      }
    }

    for (const home of state.homes) {
      const lot = layout.lots.get(home.id);
      if (!lot) continue;
      const house = new Sprite(art.house(pick(ROOFS, home.id)));
      house.position.set(lot.x * TILE, lot.y * TILE);
      house.zIndex = (lot.y + 3) * TILE;
      house.eventMode = "static";
      house.cursor = "pointer";
      house.on("pointertap", () => selectCallback?.(home));
      objects.addChild(house);
      const aura = new Sprite(art.glow);
      aura.anchor.set(0.5);
      aura.position.set(lot.x * TILE + 24, lot.y * TILE + 30);
      aura.scale.set(2.6);
      aura.tint = 0xffb547;
      aura.blendMode = "add";
      lights.addChild(aura);
      const windows = new Sprite(art.windows);
      windows.position.set(lot.x * TILE, lot.y * TILE);
      windows.tint = 0xffd27a;
      windows.blendMode = "add";
      lights.addChild(windows);
      const talk = new TalkBubble(art, home.avatar, lot.x * TILE + 24, lot.y * TILE + 2, bubbles);
      houses.set(home.id, { home, lot, house, windows, aura, baseWindows: windows.alpha, talk, talking: false });

      const avatar = new Avatar(home, art, lot.front, objects, labels);
      avatar.sprite.on("pointertap", () => selectCallback?.(home));
      avatars.set(home.id, avatar);
    }
    growthKey = "";
    drawPlaces();
    updateLights();
    const zoom = fitZoom();
    camera.zoom = zoom;
    camera.x = (layout.width * TILE) / 2;
    camera.y = (layout.height * TILE) / 2;
  }

  function updateLights(): void {
    const max = Math.max(1, ...state.homes.map((h) => h.glow));
    for (const view of houses.values()) {
      const share = view.home.glow / max;
      view.windows.alpha = Math.min(1, 0.15 + nightLevel * 0.45 + share * 0.55);
      view.baseWindows = view.windows.alpha;
      view.aura.alpha = share * (0.25 + nightLevel * 0.35);
    }
    for (const lamp of lamps) lamp.alpha = nightLevel * 0.9;
    for (const node of placeNodes) if (node.label === "lantern-glow") node.alpha = 0.2 + nightLevel * 0.8;
    if (layout) {
      night
        .clear()
        .rect(-MARGIN_X * TILE, -MARGIN_Y * TILE, (layout.width + 2 * MARGIN_X) * TILE, (layout.height + 2 * MARGIN_Y) * TILE)
        .fill({ color: 0x0b1330, alpha: nightLevel * 0.55 });
    }
  }

  function clockNight(): number {
    const now = new Date();
    const h = now.getHours() + now.getMinutes() / 60;
    if (h >= 7 && h < 17) return 0;
    if (h >= 17 && h < 19.5) return (h - 17) / 2.5;
    if (h >= 5 && h < 7) return 1 - (h - 5) / 2;
    return 1;
  }

  /** Landmarks on lots (in build order) and the festival lanterns, if the town has them. */
  function builtPlaces(growth: Growth | null | undefined): { onLots: string[]; lanterns: boolean; bigger: Set<string> } {
    const kinds = (growth?.landmarks ?? []).map((l) => l.kind);
    const bigger = new Set((growth?.upgrades ?? []).map((l) => l.kind).filter((k) => !pending.has(`${k}+`)));
    return { onLots: kinds.filter((k) => k !== "lanterns"), lanterns: kinds.includes("lanterns"), bigger };
  }

  function drawPlaces(): void {
    if (!layout) return;
    const { onLots, lanterns, bigger } = builtPlaces(state.growth);
    const key = `${onLots.join(",")}|${lanterns}|${[...bigger].join(",")}|${[...pending].join(",")}`;
    if (key === growthKey) return;
    growthKey = key;
    for (const node of placeNodes) node.destroy({ children: true });
    placeNodes = [];
    siteSprites.clear();
    layout.sites.forEach((lot, i) => {
      const kind = onLots[i];
      const waiting = kind === undefined || pending.has(kind);
      const sprite = new Sprite(
        kind && !waiting
          ? places.landmark(kind, bigger.has(kind))
          : kind || i === onLots.length
            ? places.scaffold
            : places.site,
      );
      sprite.position.set(lot.x * TILE, lot.y * TILE);
      sprite.zIndex = (lot.y + 3) * TILE;
      objects.addChild(sprite);
      placeNodes.push(sprite);
      if (kind) siteSprites.set(kind, sprite);
      if (kind && !waiting) {
        const name = bigger.has(kind) ? `${landmarkName(kind)} ★` : landmarkName(kind);
        const label = new Text({ text: name, style: LABEL, resolution: 4 });
        label.anchor.set(0.5, 0);
        label.position.set(lot.x * TILE + 24, lot.y * TILE + 46);
        labels.addChild(label);
        placeNodes.push(label);
      }
    });
    if (lanterns && !pending.has("lanterns")) {
      const { plaza } = layout;
      const width = (plaza.w - 1) * TILE;
      for (const y of [plaza.y * TILE - 2, (plaza.y + plaza.h - 1) * TILE + 2]) {
        const string = new Sprite(places.lanterns(width));
        string.position.set(plaza.x * TILE + TILE / 2, y);
        string.zIndex = y + 18;
        objects.addChild(string);
        const glow = new Sprite(places.lanterns(width));
        glow.position.copyFrom(string.position);
        glow.blendMode = "add";
        glow.label = "lantern-glow";
        lights.addChild(glow);
        placeNodes.push(string, glow);
      }
    }
    updateLights();
  }

  /** Level, progress to the next landmark and the town's favorite topic, over the map. */
  function drawHud(): void {
    hud.removeChildren().forEach((c) => c.destroy());
    const growth = state.growth;
    if (!growth) return;
    const count = growth.landmarks.length;
    const grown = growth.upgrades?.length ?? 0;
    const title = new Text({ text: `Town Lv ${growth.level}`, style: HUD_TEXT, resolution: 2 });
    const builtText = count === 1 ? "1 place" : `${count} places`;
    const favorite = growth.leading && TOPICS[growth.leading] ? ` · loves ${TOPICS[growth.leading]}` : "";
    const grownText = grown ? ` · ${grown} grown bigger` : "";
    const sub = new Text({ text: `${builtText} built with thanks${grownText}${favorite}`, style: HUD_SMALL, resolution: 2 });
    const barWidth = Math.max(150, sub.width);
    const share =
      growth.next_xp === null ? 1 : (growth.xp - growth.level_xp) / Math.max(1, growth.next_xp - growth.level_xp);
    const toGo = growth.next_xp === null ? "complete" : `${growth.next_xp - growth.xp} to next`;
    const next = new Text({ text: toGo, style: HUD_SMALL, resolution: 2 });
    const panel = new Graphics()
      .roundRect(0, 0, barWidth + 16, 56, 6)
      .fill({ color: 0x141a26, alpha: 0.72 })
      .roundRect(8, 26, barWidth, 7, 3)
      .fill({ color: 0x2c3446 })
      .roundRect(8, 26, Math.max(4, barWidth * Math.min(1, share)), 7, 3)
      .fill({ color: 0xffb547 });
    title.position.set(8, 6);
    next.position.set(barWidth + 8 - next.width, 9);
    sub.position.set(8, 38);
    hud.addChild(panel, title, next, sub);
    hud.position.set(8, 8);
    hud.scale.set(app.screen.width < 720 ? 0.8 : 1);
  }

  function sparkles(x: number, y: number): void {
    const start = clock;
    const bits = Array.from({ length: 14 }, (_, i) => {
      const s = new Sprite(places.sparkle);
      s.anchor.set(0.5);
      s.tint = [0xffffff, 0xffe08a, 0xffb5c8][i % 3];
      effects.addChild(s);
      return { s, angle: (i / 14) * Math.PI * 2, speed: 24 + (i % 4) * 8 };
    });
    const step = () => {
      const t = (clock - start) / 1000;
      for (const b of bits) {
        b.s.position.set(x + Math.cos(b.angle) * b.speed * t, y + Math.sin(b.angle) * b.speed * t - 20 * t + 26 * t * t);
        b.s.alpha = Math.max(0, 1 - t / 1.4);
        b.s.rotation = t * 3;
      }
      if (t > 1.4) {
        app.ticker.remove(step);
        bits.forEach((b) => b.s.destroy());
      }
    };
    app.ticker.add(step);
  }

  /** A landmark the town just built: the camera goes to it, it appears with a little party. */
  async function reveal(event: TownEvent, token: number, onCaption?: (t: string) => void): Promise<void> {
    const kind = event.detail.landmark;
    if (!kind || !layout) return;
    const sprite = siteSprites.get(kind);
    const { plaza } = layout;
    const at = sprite
      ? { x: sprite.x + 24, y: sprite.y + 24 }
      : { x: (plaza.x + plaza.w / 2) * TILE, y: (plaza.y + plaza.h / 2) * TILE };
    spotlight = { x: at.x, y: at.y, until: clock + 5200 };
    onCaption?.(event.summary);
    await sleep(1100);
    if (token !== replayToken) return;
    const key = event.detail.upgrade ? `${kind}+` : kind;
    pending.delete(key);
    revealed.add(key);
    drawPlaces();
    sparkles(at.x, at.y - 6);
    burst(at.x, at.y - 10, `${event.detail.upgrade ? "BIGGER!" : "NEW!"} ${landmarkName(kind)}`);
    await sleep(3600);
  }

  function door(homeId: string): Point | null {
    return layout?.lots.get(homeId)?.front ?? null;
  }

  async function stroll(avatar: Avatar): Promise<void> {
    if (!layout) return;
    const from = door(avatar.home.id);
    if (!from) return;
    const rand = Math.random;
    const token = replayToken;
    const tx = Math.max(1, Math.min(layout.width - 2, from.x + Math.round((rand() - 0.5) * 12)));
    const target = { x: tx, y: from.y };
    if (layout.ground[target.y][target.x] === "grass") return;
    avatar.busy = true;
    const path = walkPath(layout, from, target);
    await avatar.walk(path, WALK_SPEED * 0.7);
    if (token !== replayToken) return;
    await sleep(800 + rand() * 1600);
    if (token !== replayToken) return;
    await avatar.walk([...path].reverse(), WALK_SPEED * 0.7);
    if (token === replayToken) avatar.busy = false;
  }

  const clip = (text: string) => (text.length > 90 ? `${text.slice(0, 87)}…` : text);

  function bubble(avatar: Avatar, text: string, ms: number, gloss?: string | null): Promise<void> {
    const b = new Bubble(clip(text), avatar, bubbles, subtitles && gloss ? clip(gloss) : null);
    liveBubbles.add(b);
    return sleep(ms).then(() => {
      liveBubbles.delete(b);
      b.destroy();
    });
  }

  function fly(texture: Texture, from: { x: number; y: number }, to: { x: number; y: number }, ms: number, height = 30): Promise<void> {
    const s = new Sprite(texture);
    s.anchor.set(0.5);
    effects.addChild(s);
    const trail: Sprite[] = [];
    const start = clock;
    return new Promise((resolve) => {
      const step = () => {
        const t = Math.min(1, (clock - start) / ms);
        const e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
        s.x = from.x + (to.x - from.x) * e;
        s.y = from.y + (to.y - from.y) * e - Math.sin(Math.PI * e) * height;
        if (texture === art.heart && Math.floor(clock / 40) !== Math.floor((clock - app.ticker.deltaMS) / 40)) {
          const p = new Sprite(art.glow);
          p.anchor.set(0.5);
          p.scale.set(0.35);
          p.tint = 0xff8fa8;
          p.blendMode = "add";
          p.position.set(s.x, s.y);
          effects.addChild(p);
          trail.push(p);
        }
        for (const p of trail) p.alpha -= app.ticker.deltaMS / 600;
        if (t >= 1) {
          app.ticker.remove(step);
          s.destroy();
          trail.forEach((p) => p.destroy());
          resolve();
        }
      };
      app.ticker.add(step);
    });
  }

  function burst(x: number, y: number, text: string): void {
    const start = clock;
    const rings = [0, 180].map(() => new Graphics());
    rings.forEach((r) => effects.addChild(r));
    const float = new Text({ text, style: FLOAT, resolution: 4 });
    float.anchor.set(0.5, 1);
    effects.addChild(float);
    const step = () => {
      const t = clock - start;
      rings.forEach((ring, i) => {
        const local = Math.max(0, t - i * 180) / 1100;
        ring.clear();
        if (local > 0 && local < 1) ring.circle(x, y, 6 + local * 30).stroke({ color: 0xffcf7a, width: 2 * (1 - local) + 0.5, alpha: 1 - local });
      });
      float.position.set(x, y - 18 - Math.min(1, t / 1400) * 14);
      float.alpha = t < 1100 ? 1 : Math.max(0, 1 - (t - 1100) / 500);
      if (t > 1700) {
        app.ticker.remove(step);
        rings.forEach((r) => r.destroy());
        float.destroy();
      }
    };
    app.ticker.add(step);
  }

  function houseTop(homeId: string): { x: number; y: number } | null {
    const lot = layout?.lots.get(homeId);
    return lot ? { x: lot.x * TILE + 24, y: lot.y * TILE + 14 } : null;
  }

  /**
   * How much of an encounter's talk is shown: "full" for the story being followed, "line" for
   * a first line, "emote" for a short sound, so that many meetings at once stay readable.
   */
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
    // Meet somewhere around the middle, not all on the same spot.
    const spread = seeded(event.id)();
    const mid = Math.max(1, Math.min(path.length - 1, Math.floor(path.length * (0.35 + spread * 0.3))));
    const toA = path.slice(0, mid);
    const toB = path.slice(mid).reverse();
    const speed = featured ? WALK_SPEED * 1.1 : REPLAY_SPEED;
    await Promise.all([a.walk(toA, speed), b.walk(toB, speed)]);
    if (token !== replayToken) return;
    a.face(b.x);
    b.face(a.x);
    if (featured) onCaption?.(event.summary);
    const lines = event.detail.lines ?? [];
    if (talk === "emote") {
      const pickEmote = seeded(`${event.id}:emote`);
      await bubble(a, EMOTES[Math.floor(pickEmote() * EMOTES.length)], 900);
      await bubble(b, EMOTES[Math.floor(pickEmote() * EMOTES.length)], 900);
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
      const icon = item.kind === "thanks" ? art.heart : item.kind === "question" ? art.question : art.bulb;
      await fly(icon, { x: giver.x, y: giver.y - 16 }, { x: taker.x, y: taker.y - 16 }, 650, 12);
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
    const senders = (event.detail.from ?? []).map(houseTop).filter((p): p is { x: number; y: number } => p !== null);
    await Promise.all(senders.map((from, i) => sleep(i * 250).then(() => fly(art.heart, from, target, featured ? 2200 : 1500, 60))));
    burst(target.x, target.y + 6, `+${event.detail.count ?? senders.length} thanks`);
    const view = houses.get(to);
    if (view) {
      const before = view.windows.alpha;
      view.windows.alpha = 1;
      view.aura.alpha = Math.max(view.aura.alpha, 0.9);
      await sleep(featured ? 2400 : 1200);
      view.windows.alpha = before;
      updateLights();
    }
  }

  const view: TownView = {
    setState(next) {
      const key = next.homes.map((h) => h.id).sort().join(",") + `|${next.viewer ?? ""}`;
      state = next;
      const latest = latestTick(next);
      for (const e of next.events) {
        const kind = e.detail.landmark;
        const key = e.detail.upgrade ? `${kind}+` : kind;
        if (e.type === "town" && e.tick === latest && key && !revealed.has(key)) pending.add(key);
      }
      if (key !== homesKey) {
        homesKey = key;
        build();
        if (next.active) view.setActivity(next.active);
      } else {
        if (next.active) view.setActivity(next.active);
        for (const home of next.homes) {
          const h = houses.get(home.id);
          if (h) h.home = home;
        }
        updateLights();
        drawPlaces();
      }
      drawHud();
    },

    async replay(options = {}) {
      // A new replay replaces the one in progress: everyone goes home and starts over.
      const token = ++replayToken;
      for (const avatar of avatars.values()) avatar.goHome();
      for (const b of liveBubbles) b.destroy();
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
      // Everyone heads out at once; the focus home's meeting is told in full.
      // With a story to follow, the others only make small sounds; watching the whole town,
      // a few of them say their first line.
      const walks = others.map((e, i) =>
        sleep(i * 220).then(() => encounter(e, !focus && i < 3 ? "line" : "emote", token)),
      );
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

    setActivity(active) {
      activity.clear();
      for (const [id, a] of Object.entries(active)) {
        activity.set(id, { kind: a.kind, until: clock + Math.max(0, ACTIVE_MS - a.ago * 1000) });
      }
    },

    destroy() {
      replayToken++;
      resizeObserver.disconnect();
      app.destroy(true, { children: true });
    },
  };

  const resizeObserver = new ResizeObserver(() => {
    const w = host.clientWidth;
    const h = host.clientHeight;
    if (w > 0 && h > 0) app.renderer.resize(w, h);
  });
  resizeObserver.observe(host);

  nightLevel = clockNight();
  app.ticker.add((ticker) => {
    const ms = Math.min(ticker.deltaMS, 100);
    clock += ms;
    for (const avatar of avatars.values()) avatar.update(ms);
    for (const b of liveBubbles) b.update();
    fountain.texture = art.fountain[Math.floor(clock / 400) % 2];
    // Homes talking with their Alexa: the avatar goes in, a bubble shows, the windows pulse.
    for (const [id, view] of houses) {
      const avatar = avatars.get(id);
      const talking = activity.get(id);
      const on = talking !== undefined && talking.until > clock;
      if (avatar) {
        if (on && !avatar.inside && avatar.idle) void avatar.goInside();
        else if (!on && avatar.inside && !avatar.busy) void avatar.comeOut();
      }
      if (on && avatar?.inside) {
        view.talking = true;
        view.talk.show(talking.kind, clock);
        view.windows.alpha = Math.min(1, view.baseWindows + 0.25 + Math.sin(clock / 300) * 0.2);
      } else if (view.talking) {
        view.talking = false;
        view.talk.hide();
        view.windows.alpha = view.baseWindows;
      }
    }
    // Ambient life: now and then an idle avatar takes a short walk along its road.
    strollTimer -= ms;
    if (strollTimer <= 0 && avatars.size) {
      strollTimer = 1500 + Math.random() * 2500;
      const idle = [...avatars.values()].filter((a) => !a.busy && !a.inside);
      const pickOne = idle[Math.floor(Math.random() * idle.length)];
      if (pickOne && idle.length > avatars.size / 2) void stroll(pickOne);
    }
    if (nightOverride === null && Math.floor(clock / 60000) !== Math.floor((clock - ms) / 60000)) {
      nightLevel = clockNight();
      updateLights();
    }
    // Camera: the whole town, or close behind one avatar.
    if (layout) {
      const fit = fitZoom();
      const followedAvatar = followed ? avatars.get(followed) : undefined;
      const spot = spotlight && spotlight.until > clock ? spotlight : null;
      const target = spot ?? (followedAvatar ? { x: followedAvatar.x, y: followedAvatar.y - 20 } : undefined);
      const goalZoom = target ? Math.max(fit, Math.min(3, fit * (spot ? 2.2 : 2.6))) : fit;
      const goalX = target ? target.x : (layout.width * TILE) / 2;
      const goalY = target ? target.y : (layout.height * TILE) / 2;
      const k = Math.min(1, ms / 350);
      camera.zoom += (goalZoom - camera.zoom) * k;
      camera.x += (goalX - camera.x) * k;
      camera.y += (goalY - camera.y) * k;
      // Keep the map on screen.
      const halfW = app.screen.width / 2 / camera.zoom;
      const halfH = app.screen.height / 2 / camera.zoom;
      const maxX = layout.width * TILE - halfW;
      const maxY = layout.height * TILE - halfH;
      const cx = halfW > (layout.width * TILE) / 2 ? (layout.width * TILE) / 2 : Math.min(maxX, Math.max(halfW, camera.x));
      const cy = halfH > (layout.height * TILE) / 2 ? (layout.height * TILE) / 2 : Math.min(maxY, Math.max(halfH, camera.y));
      world.scale.set(camera.zoom);
      world.position.set(Math.round(app.screen.width / 2 - cx * camera.zoom), Math.round(app.screen.height / 2 - cy * camera.zoom));
    }
  });

  return view;
}
