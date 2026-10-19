import { mountApp } from "./apphost";
import { type Message, type ToolEvent, runTurn } from "./assistant";
import { renderToolEvent, townPlaceholder } from "./cards";
import { DEMO_HOUSEHOLDS, DEV_DIARY_URL, DEV_TICK_URL, SHOW_DEV_TICK, apiHeaders } from "./config";
import { type LinkedHome, finishLinking, freshLinkedHome, linkedHome, startLinking } from "./link";
import { McpConnection } from "./mcp";
import { canListen, listenOnce, speak, stopSpeaking } from "./voice";

type RingState = "idle" | "listening" | "thinking" | "speaking";

interface Home {
  token: string;
  lang: string;
  /** Set for a home linked with OAuth; its access token is refreshed when it expires. */
  linked?: LinkedHome;
  mcp: McpConnection | null;
  history: Message[];
  lines: { who: "you" | "alexa"; text: string }[];
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const picker = $<HTMLSelectElement>("household");
const ring = $<HTMLDivElement>("ring");
const transcript = $<HTMLOListElement>("transcript");
const panel = $<HTMLElement>("panel");
const composer = $<HTMLFormElement>("composer");
const input = $<HTMLInputElement>("say");
const mic = $<HTMLButtonElement>("mic");
const tick = $<HTMLButtonElement>("tick");
const draw = $<HTMLButtonElement>("draw");

const homes = new Map<string, Home>(
  DEMO_HOUSEHOLDS.map((h) => [h.token, { token: h.token, lang: h.lang, mcp: null, history: [], lines: [] }]),
);
let current = homes.get(DEMO_HOUSEHOLDS[0].token)!;
let busy = false;
let teardownApp: (() => Promise<void>) | null = null;
const screen = document.querySelector<HTMLElement>(".device") ?? document.body;

function setRing(state: RingState): void {
  ring.dataset.state = state;
}

function drawTranscript(): void {
  const recent = current.lines.slice(-6);
  transcript.replaceChildren(
    ...recent.map(({ who, text }) => {
      const li = document.createElement("li");
      li.className = `line line-${who}`;
      li.textContent = text;
      return li;
    }),
  );
  transcript.scrollTop = transcript.scrollHeight;
}

function addLine(who: "you" | "alexa", text: string): void {
  current.lines.push({ who, text });
  drawTranscript();
}

const LINK_OPTION = "__link__";
const LINKED_KEY = "linked";

async function ensureConnected(home: Home): Promise<McpConnection> {
  if (home.linked) {
    const fresh = await freshLinkedHome(home.linked);
    if (fresh.token !== home.token) {
      home.linked = fresh;
      home.token = fresh.token;
      await home.mcp?.close().catch(() => undefined);
      home.mcp = null;
    }
  }
  if (!home.mcp) home.mcp = await McpConnection.open(home.token);
  return home.mcp;
}

/** Replace whatever is on screen, closing a running MCP App view first. */
function clearPanel(): void {
  const teardown = teardownApp;
  teardownApp = null;
  if (teardown) void teardown();
}

function onTool(event: ToolEvent): void {
  const mcp = current.mcp;
  const tool = mcp?.tools.get(event.call.name);
  clearPanel();
  if (mcp && tool?.resourceUri && !event.outcome.isError) {
    const frame = townPlaceholder(panel);
    const showing = mountApp(frame, mcp, tool.resourceUri, event, {
      onUserMessage: (text) => void handle(text),
      onDisplayMode: (mode) => screen.classList.toggle("fullscreen", mode === "fullscreen"),
    });
    showing.then(
      (teardown) => {
        if (frame.isConnected) teardownApp = teardown;
        else void teardown();
      },
      () => {
        if (frame.isConnected) renderToolEvent(panel, event);
      },
    );
    return;
  }
  renderToolEvent(panel, event);
}

async function handle(text: string): Promise<void> {
  const said = text.trim();
  if (!said || busy) return;
  busy = true;
  addLine("you", said);
  setRing("thinking");
  try {
    const mcp = await ensureConnected(current);
    const { speech } = await runTurn(current.token, mcp, current.history, said, onTool);
    addLine("alexa", speech);
    setRing("speaking");
    await speak(speech, current.lang);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Something went wrong.";
    addLine("alexa", message);
  } finally {
    setRing("idle");
    busy = false;
  }
}

function addOption(value: string, text: string, before?: HTMLOptionElement | null): HTMLOptionElement {
  const option = document.createElement("option");
  option.value = value;
  option.textContent = text;
  picker.insertBefore(option, before ?? null);
  return option;
}

function addLinkedHome(linked: LinkedHome): void {
  homes.set(LINKED_KEY, { token: linked.token, lang: linked.lang ?? "en", linked, mcp: null, history: [], lines: [] });
  picker.querySelector(`option[value="${LINKED_KEY}"]`)?.remove();
  addOption(LINKED_KEY, `${linked.avatar} · ${linked.label} (your home)`, picker.querySelector(`option[value="${LINK_OPTION}"]`));
}

function fillPicker(): void {
  for (const home of DEMO_HOUSEHOLDS) addOption(home.token, `${home.avatar} · ${home.label}`);
  addOption(LINK_OPTION, "Link your own home…");
  const saved = linkedHome();
  if (saved) addLinkedHome(saved);
  let previous = picker.value;
  picker.addEventListener("change", () => {
    if (picker.value === LINK_OPTION) {
      picker.value = previous;
      void startLinking();
      return;
    }
    previous = picker.value;
    stopSpeaking();
    clearPanel();
    current = homes.get(picker.value)!;
    drawTranscript();
    const hint = document.createElement("p");
    hint.className = "hint";
    hint.textContent = "Try “What happened in town while I was out?”";
    panel.replaceChildren(hint);
  });
}

composer.addEventListener("submit", (event) => {
  event.preventDefault();
  const text = input.value;
  input.value = "";
  void handle(text);
});

if (canListen()) {
  mic.addEventListener("click", async () => {
    if (busy) return;
    stopSpeaking();
    setRing("listening");
    try {
      const heard = await listenOnce(current.lang);
      setRing("idle");
      if (heard) await handle(heard);
    } catch {
      setRing("idle");
      addLine("alexa", "I couldn't hear that. You can type instead.");
    }
  });
} else {
  mic.disabled = true;
  mic.title = "Voice input is not available in this browser";
}

if (SHOW_DEV_TICK) {
  // Demo: the diary is normally drawn in the evening; this draws today's now (it takes a minute).
  draw.hidden = false;
  draw.addEventListener("click", async () => {
    draw.disabled = true;
    try {
      const response = await fetch(DEV_DIARY_URL, {
        method: "POST",
        headers: { ...apiHeaders(), Authorization: `Bearer ${current.token}` },
      });
      draw.textContent = response.ok ? "Drawing… ask for the diary in a minute" : "Could not start drawing";
    } catch {
      draw.textContent = "Could not start drawing";
    } finally {
      setTimeout(() => {
        draw.disabled = false;
        draw.textContent = "Draw diary";
      }, 8000);
    }
  });
}

if (SHOW_DEV_TICK) {
  tick.hidden = false;
  tick.addEventListener("click", async () => {
    tick.disabled = true;
    tick.textContent = "Avatars are out in town…";
    try {
      const response = await fetch(DEV_TICK_URL, {
        method: "POST",
        headers: { ...apiHeaders(), Authorization: `Bearer ${current.token}` },
      });
      const result = (await response.json()) as { encounters?: number; error?: string };
      tick.textContent = response.ok ? `Town time advanced (${result.encounters ?? 0} encounters)` : (result.error ?? "Could not advance time");
    } catch {
      tick.textContent = "Could not advance time";
    } finally {
      setTimeout(() => {
        tick.disabled = false;
        tick.textContent = "Advance town time";
      }, 2500);
    }
  });
}

fillPicker();
drawTranscript();
finishLinking().then(
  (linked) => {
    if (!linked) return;
    addLinkedHome(linked);
    picker.value = LINKED_KEY;
    picker.dispatchEvent(new Event("change"));
    addLine("alexa", `Your home is linked. ${linked.avatar} has moved into town.`);
  },
  (error: unknown) => addLine("alexa", error instanceof Error ? error.message : "Linking failed."),
);
