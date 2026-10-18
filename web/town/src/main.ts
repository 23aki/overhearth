/**
 * The Overhearth town view, an MCP App rendered by the host (Alexa+, or the simulated client)
 * in a sandboxed iframe. It asks the server for the town state through the host
 * (`tools/call get_town_state`) and can ask Alexa something on the person's behalf
 * (`ui/message`).
 */
import { App } from "@modelcontextprotocol/ext-apps";

interface Home {
  id: string;
  label: string;
  avatar: string;
  tier: string;
  region: string;
  glow: number;
}

interface TownEvent {
  id: string;
  tick: number;
  type: "encounter" | "exchange" | "thanks_flow" | "return" | "town";
  actors: string[];
  summary: string;
  detail: { lines?: { speaker: string; text: string }[]; from?: string[]; to?: string; count?: number };
}

interface TownState {
  viewer: string;
  homes: Home[];
  events: TownEvent[];
}

const SVG = "http://www.w3.org/2000/svg";
const W = 800;
const H = 520;
const CX = W / 2;
const CY = H / 2;

const map = document.getElementById("map") as unknown as SVGSVGElement;
const caption = document.getElementById("caption") as HTMLParagraphElement;
const log = document.getElementById("log") as HTMLOListElement;
const homeCard = document.getElementById("home-card") as HTMLElement;
const replayButton = document.getElementById("replay") as HTMLButtonElement;
const newsButton = document.getElementById("news") as HTMLButtonElement;
const status = document.getElementById("status") as HTMLSpanElement;
const expandButton = document.getElementById("expand") as HTMLButtonElement;

const app = new App({ name: "overhearth-town", version: "0.1.0" }, {});
let state: TownState | null = null;
const positions = new Map<string, { x: number; y: number }>();
let replayToken = 0;

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  return node;
}

function layout(homes: Home[], viewer: string): void {
  positions.clear();
  const ordered = [...homes].sort((a, b) => {
    const rank = (h: Home) => (h.id === viewer ? 0 : h.tier === "background" ? 2 : 1);
    return rank(a) - rank(b) || a.id.localeCompare(b.id);
  });
  const inner = ordered.slice(0, 12);
  const outer = ordered.slice(12);
  const ring = (list: Home[], rx: number, ry: number, offset: number) =>
    list.forEach((home, i) => {
      const angle = offset + (i / list.length) * Math.PI * 2;
      positions.set(home.id, { x: CX + rx * Math.cos(angle), y: CY + ry * Math.sin(angle) });
    });
  ring(inner, 190, 128, -Math.PI / 2);
  ring(outer, 345, 220, -Math.PI / 2 + 0.09);
}

function drawMap(s: TownState): void {
  layout(s.homes, s.viewer);
  const maxGlow = Math.max(1, ...s.homes.map((h) => h.glow));
  map.replaceChildren();

  const defs = svg("defs", {});
  const warm = svg("radialGradient", { id: "warm" });
  warm.append(svg("stop", { offset: "0%", "stop-color": "#ffcf7a", "stop-opacity": 0.95 }));
  warm.append(svg("stop", { offset: "100%", "stop-color": "#ff9d2e", "stop-opacity": 0 }));
  defs.append(warm);
  map.append(defs);

  map.append(svg("ellipse", { cx: CX, cy: CY, rx: 64, ry: 44, class: "square" }));
  const squareLabel = svg("text", { x: CX, y: CY + 4, class: "square-label", "text-anchor": "middle" });
  squareLabel.textContent = "Town square";
  map.append(squareLabel);

  map.append(svg("g", { id: "trails" }));

  for (const home of s.homes) {
    const p = positions.get(home.id)!;
    const g = svg("g", { class: `home tier-${home.tier}${home.id === s.viewer ? " viewer" : ""}`, tabindex: 0 });
    g.setAttribute("role", "button");
    g.setAttribute("aria-label", `${home.avatar}, ${home.label}, thanked ${home.glow} times`);
    const glowRadius = 14 + (home.glow / maxGlow) * 26;
    if (home.glow > 0) g.append(svg("circle", { cx: p.x, cy: p.y, r: glowRadius, fill: "url(#warm)", class: "glow" }));
    g.append(svg("circle", { cx: p.x, cy: p.y, r: 11, class: "house" }));
    const name = svg("text", { x: p.x, y: p.y + 25, "text-anchor": "middle", class: "name" });
    name.textContent = home.id === s.viewer ? `${home.avatar} (you)` : home.avatar;
    g.append(name);
    g.addEventListener("click", () => showHome(home));
    g.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") showHome(home);
    });
    map.append(g);
  }
}

function showHome(home: Home): void {
  const title = document.createElement("h3");
  title.textContent = home.avatar;
  const label = document.createElement("p");
  label.textContent = home.label;
  const glow = document.createElement("p");
  glow.className = "muted";
  glow.textContent = home.glow
    ? `Know-how from this home has been thanked ${home.glow} time${home.glow === 1 ? "" : "s"}.`
    : "Nothing from this home has been thanked yet.";
  homeCard.replaceChildren(title, label, glow);
  homeCard.hidden = false;
}

function drawLog(events: TownEvent[]): void {
  const items = [...events].reverse().filter((e) => e.type !== "exchange" || e.summary.includes("tip"));
  log.replaceChildren(
    ...items.slice(0, 40).map((event) => {
      const li = document.createElement("li");
      li.className = `log-${event.type}`;
      const summary = document.createElement("span");
      summary.textContent = event.summary;
      li.append(summary);
      const lines = event.detail.lines ?? [];
      if (lines.length) {
        const details = document.createElement("details");
        const more = document.createElement("summary");
        more.textContent = "Overheard";
        details.append(more);
        for (const line of lines) {
          const p = document.createElement("p");
          const who = document.createElement("strong");
          who.textContent = `${line.speaker}: `;
          p.append(who, document.createTextNode(line.text));
          details.append(p);
        }
        li.append(details);
      }
      return li;
    }),
  );
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function trail(from: string, to: string, kind: "encounter" | "thanks"): SVGElement | null {
  const a = positions.get(from);
  const b = positions.get(to);
  const layer = map.querySelector("#trails");
  if (!a || !b || !layer) return null;
  const bend = kind === "thanks" ? 0.25 : 0.12;
  const mx = (a.x + b.x) / 2 + (CY - (a.y + b.y) / 2) * bend;
  const my = (a.y + b.y) / 2 + ((a.x + b.x) / 2 - CX) * bend;
  const d = `M${a.x},${a.y} Q${mx},${my} ${b.x},${b.y}`;
  const path = svg("path", { d, pathLength: 1, class: `trail trail-${kind}` });
  layer.append(path);
  if (kind === "thanks") {
    const spark = svg("circle", { r: 7, class: "spark" });
    const motion = svg("animateMotion", { dur: "1.4s", fill: "freeze", path: d });
    spark.append(motion);
    layer.append(spark);
    (motion as unknown as SVGAnimationElement).beginElement?.();
    setTimeout(() => arrive(to), 1400);
  }
  return path;
}

/** A warm ring that opens over a home when thanks reach it. */
function arrive(id: string): void {
  const p = positions.get(id);
  const layer = map.querySelector("#trails");
  if (!p || !layer) return;
  for (const delay of [0, 0.35]) {
    const ring = svg("circle", { cx: p.x, cy: p.y, r: 10, class: "arrival" });
    ring.style.animationDelay = `${delay}s`;
    layer.append(ring);
  }
}

async function replay(): Promise<void> {
  if (!state) return;
  const token = ++replayToken;
  map.querySelector("#trails")?.replaceChildren();
  const lastTick = Math.max(0, ...state.events.map((e) => e.tick));
  const recent = state.events.filter((e) => e.tick === lastTick && (e.type === "encounter" || e.type === "thanks_flow"));
  // Build up to the viewer's own story: a glimpse of the town, then the viewer's encounters,
  // then thanks travelling home, with thanks to the viewer last.
  const viewer = state.viewer;
  const mine = (e: TownEvent) => e.actors.includes(viewer);
  const others = recent.filter((e) => e.type === "encounter" && !mine(e)).slice(0, 8);
  const own = recent.filter((e) => e.type === "encounter" && mine(e));
  const flows = recent
    .filter((e) => e.type === "thanks_flow")
    .sort((a, b) => Number(a.detail.to === viewer) - Number(b.detail.to === viewer))
    .slice(-4);
  for (const event of [...others, ...own, ...flows]) {
    if (token !== replayToken) return;
    if (event.type === "encounter" && event.actors.length === 2) {
      trail(event.actors[0], event.actors[1], "encounter");
      caption.textContent = event.summary;
      await wait(event.actors.includes(state.viewer) ? 2200 : 700);
    } else if (event.type === "thanks_flow" && event.detail.to) {
      for (const from of event.detail.from ?? []) trail(from, event.detail.to, "thanks");
      caption.textContent = event.summary;
      await wait(event.detail.to === viewer ? 3600 : 1800);
    }
  }
  if (token !== replayToken) return;
  const last = flows.find((e) => e.detail.to === viewer) ?? own[0];
  caption.textContent = last?.summary ?? (recent.length ? "" : "A quiet time in town.");
}

let loading: Promise<void> | null = null;

/** Fetch and draw the town; overlapping calls (connect plus a tool result) share one fetch. */
function loadState(): Promise<void> {
  loading ??= fetchState().finally(() => {
    loading = null;
  });
  return loading;
}

async function fetchState(): Promise<void> {
  status.textContent = "Looking around town…";
  const result = await app.callServerTool({ name: "get_town_state", arguments: {} });
  state = (result.structuredContent as unknown as TownState | undefined) ?? null;
  if (!state) {
    status.textContent = "The town is not reachable right now.";
    return;
  }
  const thanked = state.homes.reduce((sum, h) => sum + h.glow, 0);
  status.textContent = `${state.homes.length} homes · ${thanked} thanks for shared know-how`;
  drawMap(state);
  drawLog(state.events);
  void replay();
}

replayButton.addEventListener("click", () => void replay());
newsButton.addEventListener("click", async () => {
  newsButton.disabled = true;
  try {
    await app.sendMessage({ role: "user", content: [{ type: "text", text: "What happened in town while I was away?" }] });
  } finally {
    newsButton.disabled = false;
  }
});

function showDisplayMode(): void {
  const context = app.getHostContext();
  const modes = context?.availableDisplayModes ?? [];
  expandButton.hidden = !modes.includes("fullscreen");
  expandButton.textContent = context?.displayMode === "fullscreen" ? "Exit full screen" : "Full screen";
}

expandButton.addEventListener("click", async () => {
  const mode = app.getHostContext()?.displayMode === "fullscreen" ? "inline" : "fullscreen";
  await app.requestDisplayMode({ mode });
});

app.ontoolresult = () => void loadState();
app.onhostcontextchanged = () => showDisplayMode();

await app.connect();
showDisplayMode();
await loadState();
