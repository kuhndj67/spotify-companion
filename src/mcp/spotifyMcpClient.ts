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
import { parseNowPlaying, type NowPlaying } from './parseNowPlaying.js';

export class SpotifyMcpClient {
  #client: Client | null = null;
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
    return content
      .filter((block): block is { type: 'text'; text: string } => block?.type === 'text')
      .map((block) => block.text)
      .join('\n');
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

  async close(): Promise<void> {
    await this.#client?.close();
    this.#client = null;
  }
}
