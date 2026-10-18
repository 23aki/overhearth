/** Cards for tool results, drawn on the device screen. Data is always set as text, never HTML. */

import type { ToolEvent } from "./assistant";

type Data = Record<string, unknown>;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const KIND_LABEL: Record<string, string> = {
  thanks_return: "Thanks came back",
  answer: "Answer from town",
  tip: "Know-how",
  question: "Someone's wondering",
  trend: "Around town",
};

function card(title: string, ...children: Node[]): HTMLElement {
  const node = el("article", "card");
  node.append(el("h2", "card-title", title), ...children);
  return node;
}

function reportCard(data: Data): HTMLElement {
  const items = (data.items as Data[] | undefined) ?? [];
  const met = (data.met as string[] | undefined) ?? [];
  const list = el("ul", "items");
  for (const item of items) {
    const row = el("li", `item item-${String(item.kind)}`);
    row.append(el("span", "item-kind", KIND_LABEL[String(item.kind)] ?? String(item.kind)));
    row.append(el("span", "item-text", String(item.text)));
    list.append(row);
  }
  const intro = met.length ? el("p", "muted", `Ran into ${met.join(", ")}`) : el("p", "muted", "A quiet time in town.");
  return card("While you were away", intro, list);
}

function askCard(data: Data): HTMLElement {
  const answers = (data.answers as Data[] | undefined) ?? [];
  const list = el("ul", "items");
  for (const answer of answers) {
    const row = el("li", "item item-tip");
    const thanked = Number(answer.thanks_count ?? 0);
    row.append(el("span", "item-kind", thanked ? `Thanked ${thanked}×` : "New"));
    row.append(el("span", "item-text", String(answer.text)));
    row.append(el("span", "item-from", `from ${String(answer.origin_label)}`));
    list.append(row);
  }
  return card(answers.length ? "From the town" : "Nobody knows yet", list);
}

function shareCard(data: Data): HTMLElement {
  const pending = Boolean(data.needs_confirmation);
  return card(pending ? "Take this to town?" : "On its way to town", el("p", "quote", String(data.preview ?? "")));
}

function thanksCard(data: Data): HTMLElement {
  const to = typeof data.to === "string" ? data.to : null;
  if (!to) return card("Thanks noted", el("p", "muted", "Your Alexa heard you."));
  const node = card("Your thanks is on its way", el("p", "quote", `to ${to}`));
  node.classList.add("card-thanks");
  node.append(el("p", "muted", "Your Alexa will carry it there the next time it is out in town."));
  return node;
}

export function renderToolEvent(panel: HTMLElement, event: ToolEvent): void {
  const data = event.outcome.structured ?? {};
  if (event.outcome.isError) {
    panel.replaceChildren(card("Something went wrong", el("p", "muted", event.outcome.text)));
    return;
  }
  switch (event.call.name) {
    case "town_report":
      panel.replaceChildren(reportCard(data));
      break;
    case "ask_town":
      panel.replaceChildren(askCard(data));
      break;
    case "share_with_town":
      panel.replaceChildren(shareCard(data));
      break;
    case "record_thanks":
      panel.replaceChildren(thanksCard(data));
      break;
    default:
      break;
  }
}

export function townPlaceholder(panel: HTMLElement): HTMLElement {
  const frame = el("div", "app-frame");
  frame.append(el("p", "muted", "Opening the town…"));
  panel.replaceChildren(frame);
  return frame;
}
