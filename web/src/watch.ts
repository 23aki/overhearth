/**
 * The watch page: the whole town, live, without going through Alexa. Pick a home to follow its
 * avatar. New town time is replayed as soon as it happens.
 */
import { createTown } from "../townkit/view";
import { type Home, type TownState, latestTick } from "../townkit/types";
import { BACKEND_URL, apiHeaders } from "./config";

const POLL_MS = 15_000;
/** Who is talking with Alexa changes by the second; this read is light. */
const ACTIVITY_MS = 3_000;
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const followSelect = $<HTMLSelectElement>("follow");
const unfollowButton = $<HTMLButtonElement>("unfollow");
const replayButton = $<HTMLButtonElement>("replay");
const nightButton = $<HTMLButtonElement>("night");
const subtitlesButton = $<HTMLButtonElement>("subtitles");
const status = $<HTMLSpanElement>("status");
const caption = $<HTMLParagraphElement>("caption");
const card = $<HTMLElement>("card");

const town = await createTown($("town"), { camera: "free" });
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

/** The home whose card is open, if any. */
let cardHome: Home | null = null;

function setFollow(id: string | null): void {
  followSelect.value = id ?? "";
  followSelect.dispatchEvent(new Event("change"));
}

function showCard(home: Home): void {
  cardHome = home;
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
  const who = home.tier === "background" ? "A simulated resident" : home.tier === "demo" ? "A demo home" : "A linked home";
  const speaks = home.language ? new Intl.DisplayNames(["en"], { type: "language" }).of(home.language) : null;
  kind.textContent = speaks ? `${who}. Speaks ${speaks}.` : `${who}.`;
  // One button that follows this home, or stops following it.
  const following = followSelect.value === home.id;
  const follow = document.createElement("button");
  follow.type = "button";
  follow.className = following ? "ghost" : "";
  follow.textContent = following ? "Stop following" : `Follow ${home.avatar}`;
  follow.addEventListener("click", () => setFollow(following ? null : home.id));
  const close = document.createElement("button");
  close.type = "button";
  close.className = "close";
  close.setAttribute("aria-label", "Close");
  close.textContent = "×";
  close.addEventListener("click", () => {
    card.hidden = true;
    cardHome = null;
  });
  card.replaceChildren(close, title, label, thanks, kind, follow);
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
  unfollowButton.hidden = !id;
  const home = state?.homes.find((h) => h.id === id);
  if (home) showCard(home);
  else if (cardHome && !card.hidden) showCard(cardHome); // the card stays, its button says Follow again
});
unfollowButton.addEventListener("click", () => setFollow(null));
document.addEventListener("keydown", (e) => {
  // Esc stops following, unless it is closing the diary.
  if (e.key === "Escape" && followSelect.value && !document.querySelector("dialog[open]")) setFollow(null);
});
replayButton.addEventListener("click", () => void play());

interface Diary {
  date: string;
  title: string;
  text: string;
  language: string;
  image_url: string | null;
}
const diaryButton = $<HTMLButtonElement>("diary");
const diaryDialog = $<HTMLDialogElement>("diary-dialog");
diaryButton.addEventListener("click", async () => {
  const response = await fetch(`${BACKEND_URL}/town/diary`, { headers: apiHeaders() }).catch(() => null);
  const diary = response?.ok ? ((await response.json()) as { diary: Diary | null }).diary : null;
  $<HTMLParagraphElement>("diary-date").textContent = diary?.date ?? "";
  $<HTMLHeadingElement>("diary-title").textContent = diary?.title ?? "No diary yet";
  $<HTMLParagraphElement>("diary-text").textContent = diary?.text ?? "The town writes its picture diary every evening.";
  const picture = $<HTMLImageElement>("diary-picture");
  picture.hidden = !diary?.image_url;
  if (diary?.image_url) picture.src = diary.image_url;
  diaryDialog.showModal();
});
let subtitles = true;
subtitlesButton.addEventListener("click", () => {
  subtitles = !subtitles;
  town.setSubtitles(subtitles);
  subtitlesButton.textContent = subtitles ? "Subtitles: on" : "Subtitles: off";
});
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
    unfollowButton.hidden = false;
  }
}
async function refreshActivity(): Promise<void> {
  try {
    const response = await fetch(`${BACKEND_URL}/town/activity`, { headers: apiHeaders() });
    if (response.ok) town.setActivity(((await response.json()) as { active: Record<string, { kind: string; ago: number }> }).active);
  } catch {
    // The next poll will try again.
  }
}

await refresh();
setInterval(() => void refresh(), POLL_MS);
setInterval(() => void refreshActivity(), ACTIVITY_MS);
