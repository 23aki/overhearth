import { ASSISTANT_URL, apiHeaders } from "./config";
import type { McpConnection, ToolOutcome } from "./mcp";

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export type Message =
  | { role: "user"; text: string }
  | { role: "assistant"; text?: string; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; name: string; content: unknown; is_error: boolean };

export interface ToolEvent {
  call: ToolCall;
  outcome: ToolOutcome;
}

export interface TurnOutput {
  speech: string;
  toolEvents: ToolEvent[];
}

const MAX_STEPS = 4;

async function postTurn(token: string, messages: Message[]): Promise<{ speech?: string; tool_calls: ToolCall[] }> {
  const response = await fetch(ASSISTANT_URL, {
    method: "POST",
    headers: { ...apiHeaders(), "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ messages }),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Assistant error ${response.status}`);
  }
  return response.json();
}

/**
 * One spoken request, playing the Alexa+ part: ask the model what to do, run any tool
 * calls against the MCP server from the browser, and repeat until there is something to say.
 */
export async function runTurn(
  token: string,
  mcp: McpConnection,
  history: Message[],
  userText: string,
  onTool?: (event: ToolEvent) => void,
): Promise<TurnOutput> {
  history.push({ role: "user", text: userText });
  const toolEvents: ToolEvent[] = [];
  for (let step = 0; step < MAX_STEPS; step++) {
    const reply = await postTurn(token, history);
    if (!reply.tool_calls.length) {
      const speech = reply.speech ?? "";
      history.push({ role: "assistant", text: speech });
      return { speech, toolEvents };
    }
    history.push({ role: "assistant", tool_calls: reply.tool_calls });
    for (const call of reply.tool_calls) {
      // Every tool call needs a result in the history, even when the call itself failed.
      const outcome = await mcp.callTool(call.name, call.arguments).catch(
        (error: unknown): ToolOutcome => ({
          structured: null,
          text: error instanceof Error ? error.message : "The tool did not answer.",
          isError: true,
        }),
      );
      const event = { call, outcome };
      toolEvents.push(event);
      onTool?.(event);
      history.push({
        role: "tool",
        tool_call_id: call.id,
        name: call.name,
        content: outcome.structured ?? outcome.text,
        is_error: outcome.isError,
      });
    }
  }
  const speech = "Sorry, I got a bit lost there.";
  history.push({ role: "assistant", text: speech });
  return { speech, toolEvents };
}
