/**
 * MCP client wrapper around marcelmarais/spotify-mcp-server.
 *
 * The server speaks stdio only, so we spawn it as a child process and hold the connection
 * open for the lifetime of the app. If it dies (bad token, crash) the next call reconnects
 * rather than leaving the app permanently broken.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { config } from '../config.js';
import { isMcpErrorText } from '../configuration/mcpErrorText.js';
import { parseNowPlaying, type NowPlaying } from './parseNowPlaying.js';
import { waitForProcessExit } from './processExit.js';

/**
 * A tool that answered with an error **as text** (FR-71, BR-58.1).
 *
 * ⚠️ The server's process is fine — it reached Spotify and was refused — so this does NOT drop the connection,
 * unlike a transport failure. What it must never become is data: read as a now-playing block, a failed refresh
 * was a snapshot with every field null, shown as PAUSED and *"Spotify: ok"* (F5, confirmed live by P-U7-3).
 */
export class McpToolError extends Error {
  readonly tool: string;
  readonly toolText: string;

  constructor(tool: string, toolText: string) {
    super(`MCP tool "${tool}" reported an error: ${toolText}`);
    this.name = 'McpToolError';
    this.tool = tool;
    this.toolText = toolText;
  }
}

export class SpotifyMcpClient {
  #client: Client | null = null;
  /** The live client's transport — its `pid` is how `close()` knows the child is really gone (P-49). */
  #transport: StdioClientTransport | null = null;
  /** In-flight connection, so concurrent callers share one handshake instead of racing. */
  #connecting: Promise<Client> | null = null;

  async #connect(): Promise<Client> {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [config.mcpServerEntrypoint],
      cwd: config.mcpServerCwd,
      // The MCP server writes diagnostics to stderr; surface them in our logs.
      stderr: 'inherit',
    });

    const client = new Client(
      { name: 'spotify-now-playing', version: '0.1.0' },
      { capabilities: {} },
    );

    await client.connect(transport);

    // A dead transport must invalidate the cached client, or every later call hangs.
    transport.onclose = () => {
      if (this.#client === client) this.#client = null;
    };

    this.#client = client;
    this.#transport = transport;
    return client;
  }

  async #getClient(): Promise<Client> {
    if (this.#client) return this.#client;
    this.#connecting ??= this.#connect().finally(() => {
      this.#connecting = null;
    });
    return this.#connecting;
  }

  /** Calls a tool and returns the concatenated text content blocks. */
  async #callToolText(name: string, args: Record<string, unknown> = {}): Promise<string> {
    const client = await this.#getClient();

    let result;
    try {
      result = await client.callTool({ name, arguments: args });
    } catch (error) {
      // Drop the connection so the next attempt gets a fresh process.
      this.#client = null;
      throw error;
    }

    if (result.isError) {
      throw new Error(`MCP tool "${name}" returned an error: ${JSON.stringify(result.content)}`);
    }

    const content = Array.isArray(result.content) ? result.content : [];
    const text = content
      .filter((block): block is { type: 'text'; text: string } => block?.type === 'text')
      .map((block) => block.text)
      .join('\n');

    // FR-71: the server reports failures as ordinary text, without `isError`. Treat it exactly like `isError`.
    if (isMcpErrorText(text)) throw new McpToolError(name, text);
    return text;
  }

  /** Returns the current track, or null when nothing is playing. */
  async getNowPlaying(): Promise<NowPlaying | null> {
    const text = await this.#callToolText('getNowPlaying');
    return parseNowPlaying(text);
  }

  /** Lists the tools the server exposes. Used by /api/health to prove the link works. */
  async listToolNames(): Promise<string[]> {
    const client = await this.#getClient();
    const { tools } = await client.listTools();
    return tools.map((tool) => tool.name);
  }

  /**
   * Close the connection and resolve only when the child process has EXITED (P-49, probe P-U7-2: ~2 s after the
   * SDK's close returns). Rejects if it is still running after the bound — the caller must then NOT write the
   * credentials file, because the old server could still be inside a refresh that would overwrite it.
   */
  async close(): Promise<void> {
    if (this.#connecting) await this.#connecting.catch(() => undefined);
    const client = this.#client;
    const pid = this.#transport?.pid ?? null;
    this.#client = null;
    this.#transport = null;
    await client?.close();
    if (pid !== null) await waitForProcessExit(pid);
  }
}
