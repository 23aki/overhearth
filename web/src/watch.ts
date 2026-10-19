/**
 * The watch page: the whole town, live, without going through Alexa. Pick a home to follow its
 * avatar. New town time is replayed as soon as it happens.
 */
import { createTownView } from "../townkit/scene";
import { type Home, type TownState, latestTick } from "../townkit/types";
import { BACKEND_URL, apiHeaders } from "./config";

const POLL_MS = 15_000;
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const followSelect = $<HTMLSelectElement>("follow");
const replayButton = $<HTMLButtonElement>("replay");
const nightButton = $<HTMLButtonElement>("night");
const status = $<HTMLSpanElement>("status");
const caption = $<HTMLParagraphElement>("caption");
const card = $<HTMLElement>("card");

const town = await createTownView($("town"));
let state: TownState | null = null;
let shownTick = -1;

async function fetchTown(): Promise<TownState | null> {
  try {
    const response = await fetch(`${BACKEND_URL}/town`, { headers: apiHeaders() });
    if (!response.ok) throw new Error(String(response.status));
    return (await response.json()) as TownState;
  } catch {
    status.textContent = "The town is not reachable right now.";
    return null;
  }
}

function fillFollow(homes: Home[]): void {
  const current = followSelect.value;
  const people = homes.filter((h) => h.tier !== "background");
  const residents = homes.filter((h) => h.tier === "background");
  followSelect.replaceChildren(new Option("The whole town", ""));
  for (const [title, group] of [["Homes you can talk to", people], ["Residents (simulated)", residents]] as const) {
    if (!group.length) continue;
    const optgroup = document.createElement("optgroup");
    optgroup.label = title;
    for (const h of [...group].sort((a, b) => a.avatar.localeCompare(b.avatar))) optgroup.append(new Option(`${h.avatar} · ${h.label}`, h.id));
    followSelect.append(optgroup);
  }
  followSelect.value = current;
}

function showCard(home: Home): void {
  const title = document.createElement("h2");
  title.textContent = home.avatar;
  const label = document.createElement("p");
  label.textContent = home.label;
  const thanks = document.createElement("p");
  thanks.className = "muted";
  thanks.textContent = home.glow
    ? `Know-how from this home has been thanked ${home.glow} time${home.glow === 1 ? "" : "s"}.`
    : "Nothing from this home has been thanked yet.";
  const kind = document.createElement("p");
  kind.className = "muted";
  kind.textContent = home.tier === "background" ? "A simulated resident." : home.tier === "demo" ? "A demo home." : "A linked home.";
  const follow = document.createElement("button");
  follow.type = "button";
  follow.textContent = `Follow ${home.avatar}`;
  follow.addEventListener("click", () => {
    followSelect.value = home.id;
    followSelect.dispatchEvent(new Event("change"));
  });
  card.replaceChildren(title, label, thanks, kind, follow);
  card.hidden = false;
}

/** Play the latest town time; starting again replaces a replay in progress. */
async function play(): Promise<void> {
  if (!state) return;
  await town.replay({ focus: followSelect.value || null, onCaption: (text) => (caption.textContent = text) });
}

async function refresh(): Promise<void> {
  const next = await fetchTown();
  if (!next) return;
  state = next;
  town.setState(next);
  fillFollow(next.homes);
  const tick = latestTick(next);
  const thanked = next.homes.reduce((sum, h) => sum + h.glow, 0);
  status.textContent = `${next.homes.length} homes · ${thanked} thanks · town time ${tick}`;
  if (tick !== shownTick) {
    shownTick = tick;
    void play();
  }
}

followSelect.addEventListener("change", () => {
  const id = followSelect.value || null;
  town.follow(id);
  const home = state?.homes.find((h) => h.id === id);
  if (home) showCard(home);
  else card.hidden = true;
});
replayButton.addEventListener("click", () => void play());
town.onSelect(showCard);

const modes: [string, number | null][] = [
  ["Clock", null],
  ["Day", 0],
  ["Night", 1],
];
let mode = 0;
nightButton.addEventListener("click", () => {
  mode = (mode + 1) % modes.length;
  nightButton.textContent = modes[mode][0];
  town.setNight(modes[mode][1]);
});

// watch.html?follow=<home id> opens the page following that home.
const initial = new URLSearchParams(location.search).get("follow");
if (initial) {
  const first = await fetchTown();
  if (first?.homes.some((h) => h.id === initial)) {
    fillFollow(first.homes);
    followSelect.value = initial;
    town.follow(initial);
  }
}
await refresh();
setInterval(() => void refresh(), POLL_MS);
