import { type CallToolResult, Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { MCP_URL, apiHeaders } from "./config";

export interface ToolInfo {
  name: string;
  resourceUri?: string;
  appOnly: boolean;
}

export interface ToolOutcome {
  structured: Record<string, unknown> | null;
  text: string;
  isError: boolean;
  /** The full result, for handing to an MCP App view. */
  raw?: CallToolResult;
}

/** One household's connection to the Overhearth MCP server (protocol 2025-11-25). */
export class McpConnection {
  private constructor(
    /** Exposed so an MCP App view can be bridged to the same server session. */
    readonly client: Client,
    readonly tools: Map<string, ToolInfo>,
  ) {}

  static async open(token: string): Promise<McpConnection> {
    const transport = new StreamableHTTPClientTransport(new URL(MCP_URL), {
      requestInit: { headers: { ...apiHeaders(), Authorization: `Bearer ${token}` } },
    });
    const client = new Client({ name: "overhearth-simulated-alexa", version: "0.1.0" }, { capabilities: {} });
    await client.connect(transport);
    const listed = await client.listTools();
    const tools = new Map<string, ToolInfo>();
    for (const tool of listed.tools) {
      const ui = (tool._meta?.ui ?? {}) as { resourceUri?: string; visibility?: string[] };
      tools.set(tool.name, {
        name: tool.name,
        resourceUri: ui.resourceUri,
        appOnly: Array.isArray(ui.visibility) && ui.visibility.length === 1 && ui.visibility[0] === "app",
      });
    }
    return new McpConnection(client, tools);
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<ToolOutcome> {
    const result = await this.client.callTool({ name, arguments: args });
    const content = Array.isArray(result.content) ? result.content : [];
    const text = content
      .map((block) => (block && typeof block === "object" && "text" in block ? String(block.text) : ""))
      .join(" ")
      .trim();
    return {
      structured: (result.structuredContent as Record<string, unknown> | undefined) ?? null,
      text,
      isError: Boolean(result.isError),
      raw: result as CallToolResult,
    };
  }

  async readResource(uri: string): Promise<string | null> {
    const result = await this.client.readResource({ uri });
    const first = result.contents[0];
    return first && "text" in first ? String(first.text) : null;
  }

  async close(): Promise<void> {
    await this.client.close();
  }
}
