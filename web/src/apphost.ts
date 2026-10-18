import { AppBridge, PostMessageTransport } from "@modelcontextprotocol/ext-apps/app-bridge";
import type { ToolEvent } from "./assistant";
import type { McpConnection } from "./mcp";

export interface AppHostOptions {
  /** The View asked Alexa something on the person's behalf (`ui/message`). */
  onUserMessage: (text: string) => void;
  /** The View asked to go fullscreen or back inline. */
  onDisplayMode: (mode: "inline" | "fullscreen") => void;
}

/**
 * Plays the Alexa+ host part of MCP Apps: fetch the tool's `ui://` resource, render it in a
 * sandboxed iframe, and bridge it to the MCP server through the household's own connection.
 * Returns a teardown function to call before the panel is replaced.
 */
export async function mountApp(
  container: HTMLElement,
  mcp: McpConnection,
  resourceUri: string,
  event: ToolEvent,
  options: AppHostOptions,
): Promise<() => Promise<void>> {
  const html = await mcp.readResource(resourceUri);
  if (!html) throw new Error(`The view ${resourceUri} is not available.`);

  const iframe = document.createElement("iframe");
  iframe.title = "Overhearth town";
  iframe.setAttribute("sandbox", "allow-scripts");
  container.replaceChildren(iframe);

  const bridge = new AppBridge(
    mcp.client,
    { name: "overhearth-simulated-alexa", version: "0.1.0" },
    { serverTools: {}, openLinks: {} },
    { hostContext: { theme: "dark", displayMode: "inline", availableDisplayModes: ["inline", "fullscreen"] } },
  );
  bridge.oninitialized = () => {
    void bridge.sendToolInput({ arguments: event.call.arguments });
    if (event.outcome.raw) void bridge.sendToolResult(event.outcome.raw);
  };
  bridge.onmessage = async ({ content }) => {
    const text = content
      .map((block) => (block.type === "text" ? block.text : ""))
      .join(" ")
      .trim();
    if (!text) return { isError: true };
    options.onUserMessage(text);
    return {};
  };
  bridge.onrequestdisplaymode = async ({ mode }) => {
    const next = mode === "fullscreen" ? "fullscreen" : "inline";
    options.onDisplayMode(next);
    void bridge.setHostContext({ displayMode: next });
    return { mode: next };
  };

  // The transport must listen before the View's script runs and sends ui/initialize.
  const loaded = new Promise<void>((resolve) => iframe.addEventListener("load", () => resolve(), { once: true }));
  iframe.srcdoc = html;
  await bridge.connect(new PostMessageTransport(iframe.contentWindow!, iframe.contentWindow!));
  // connect() forwards every tool call; narrow it to what a view should use: tools only views
  // can see, and the tool that opened it. Anything that acts for the person stays with Alexa.
  bridge.oncalltool = async (params) => {
    const tool = mcp.tools.get(params.name);
    if (!tool || !(tool.appOnly || tool.resourceUri === resourceUri)) {
      throw new Error(`The town view may not call ${params.name}.`);
    }
    return (await mcp.client.callTool(params)) as Awaited<ReturnType<NonNullable<typeof bridge.oncalltool>>>;
  };
  await loaded;

  return async () => {
    options.onDisplayMode("inline");
    try {
      await bridge.teardownResource({});
    } catch {
      // The View may already be gone.
    }
    await bridge.close();
  };
}
