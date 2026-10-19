/**
 * The Overhearth town view, an MCP App rendered by the host (Alexa+, or the simulated client)
 * in a sandboxed iframe. It asks the server for the town state through the host
 * (`tools/call get_town_state`) and can ask Alexa something on the person's behalf
 * (`ui/message`). The town itself is the same pixel-art world as the watch page.
 */
import { App } from "@modelcontextprotocol/ext-apps";
import { createTownView } from "../../townkit/scene";
import type { Home, TownEvent, TownState } from "../../townkit/types";

const caption = document.getElementById("caption") as HTMLParagraphElement;
const log = document.getElementById("log") as HTMLOListElement;
const homeCard = document.getElementById("home-card") as HTMLElement;
const replayButton = document.getElementById("replay") as HTMLButtonElement;
const overviewButton = document.getElementById("overview") as HTMLButtonElement;
const newsButton = document.getElementById("news") as HTMLButtonElement;
const status = document.getElementById("status") as HTMLSpanElement;
const expandButton = document.getElementById("expand") as HTMLButtonElement;

const app = new App({ name: "overhearth-town", version: "0.2.0" }, {});
const town = await createTownView(document.getElementById("map") as HTMLElement);
let state: TownState | null = null;
let following = true;

function showHome(home: Home): void {
  const title = document.createElement("h3");
  title.textContent = home.id === state?.viewer ? `${home.avatar} (your Alexa)` : home.avatar;
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

function setFollowing(on: boolean): void {
  following = on;
  town.follow(on ? (state?.viewer ?? null) : null);
  overviewButton.textContent = on ? "Whole town" : "Follow my Alexa";
}

function replay(): Promise<void> {
  return town.replay({ focus: state?.viewer ?? null, onCaption: (text) => (caption.textContent = text) });
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
  const next = (result.structuredContent as unknown as TownState | undefined) ?? null;
  if (!next) {
    status.textContent = "The town is not reachable right now.";
    return;
  }
  const first = state === null;
  state = next;
  const thanked = next.homes.reduce((sum, h) => sum + h.glow, 0);
  status.textContent = `${next.homes.length} homes · ${thanked} thanks for shared know-how`;
  town.setState(next);
  drawLog(next.events);
  if (first) setFollowing(true);
  void replay();
}

town.onSelect(showHome);
replayButton.addEventListener("click", () => void replay());
overviewButton.addEventListener("click", () => setFollowing(!following));
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
