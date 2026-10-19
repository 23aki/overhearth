/**
 * The picture diary, an MCP App shown by Alexa+ (or the simulated client) when the person asks
 * to see today's diary. It shows the tool result, and can switch between this home's diary and
 * the town's through the host (`tools/call get_diary`).
 */
import { App } from "@modelcontextprotocol/ext-apps";

interface DiaryResult {
  available: boolean;
  scope: "home" | "town";
  avatar?: string | null;
  date?: string | null;
  title?: string | null;
  text?: string | null;
  language?: string | null;
  image_url?: string | null;
  speech?: string;
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const tabs = { home: $<HTMLButtonElement>("tab-home"), town: $<HTMLButtonElement>("tab-town") };
const page = $<HTMLElement>("page");
const dateEl = $<HTMLSpanElement>("date");
const titleEl = $<HTMLHeadingElement>("title");
const frame = $<HTMLElement>("frame");
const picture = $<HTMLImageElement>("picture");
const textEl = $<HTMLParagraphElement>("text");
const empty = $<HTMLParagraphElement>("empty");

const app = new App({ name: "overhearth-diary", version: "0.1.0" }, {});

function show(diary: DiaryResult): void {
  for (const [scope, tab] of Object.entries(tabs)) tab.setAttribute("aria-selected", String(scope === diary.scope));
  if (diary.avatar) tabs.home.textContent = `${diary.avatar}'s diary`;
  page.lang = diary.language ?? "en";
  if (!diary.available) {
    dateEl.textContent = "";
    titleEl.textContent = "";
    textEl.textContent = "";
    frame.hidden = true;
    empty.hidden = false;
    empty.textContent =
      diary.scope === "town" ? "The town hasn't written today's diary yet. It writes one every evening." : (diary.speech ?? "");
    return;
  }
  empty.hidden = true;
  dateEl.textContent = diary.date ? new Date(`${diary.date}T12:00:00`).toLocaleDateString(diary.language ?? "en", { dateStyle: "long" }) : "";
  titleEl.textContent = diary.title ?? "";
  textEl.textContent = diary.text ?? "";
  if (diary.image_url) {
    picture.src = diary.image_url;
    frame.hidden = false;
  } else {
    frame.hidden = true;
  }
}

async function load(scope: "home" | "town"): Promise<void> {
  const result = await app.callServerTool({ name: "get_diary", arguments: { scope } });
  const diary = result.structuredContent as unknown as DiaryResult | undefined;
  if (diary) show(diary);
}

tabs.home.addEventListener("click", () => void load("home"));
tabs.town.addEventListener("click", () => void load("town"));

let shown = false;
app.ontoolresult = (result) => {
  const diary = result.structuredContent as unknown as DiaryResult | undefined;
  if (diary) {
    shown = true;
    show(diary);
  }
};

await app.connect();
if (!shown) await load("home");
