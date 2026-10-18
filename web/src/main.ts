import { mountApp } from "./apphost";
import { type Message, type ToolEvent, runTurn } from "./assistant";
import { renderToolEvent, townPlaceholder } from "./cards";
import { DEMO_HOUSEHOLDS, DEV_TICK_URL, SHOW_DEV_TICK } from "./config";
import { McpConnection } from "./mcp";
import { canListen, listenOnce, speak, stopSpeaking } from "./voice";

type RingState = "idle" | "listening" | "thinking" | "speaking";

interface Home {
  token: string;
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

const homes = new Map<string, Home>(DEMO_HOUSEHOLDS.map((h) => [h.token, { token: h.token, mcp: null, history: [], lines: [] }]));
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

async function ensureConnected(home: Home): Promise<McpConnection> {
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
    await speak(speech);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Something went wrong.";
    addLine("alexa", message);
  } finally {
    setRing("idle");
    busy = false;
  }
}

function fillPicker(): void {
  for (const home of DEMO_HOUSEHOLDS) {
    const option = document.createElement("option");
    option.value = home.token;
    option.textContent = `${home.avatar} · ${home.label}`;
    picker.append(option);
  }
  picker.addEventListener("change", () => {
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
      const heard = await listenOnce();
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
  tick.hidden = false;
  tick.addEventListener("click", async () => {
    tick.disabled = true;
    tick.textContent = "Avatars are out in town…";
    try {
      const response = await fetch(DEV_TICK_URL, { method: "POST" });
      const result = (await response.json()) as { encounters?: number };
      tick.textContent = `Town time advanced (${result.encounters ?? 0} encounters)`;
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
