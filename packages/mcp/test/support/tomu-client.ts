import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterAll, beforeAll } from "vitest";
import { createServer } from "../../src/server.js";

type Args = Record<string, unknown>;

export interface TomuClient {
  /** Call a tool and return its text. Throws if the tool reported an error. */
  call(name: string, args?: Args): Promise<string>;
  /** Call a tool that is expected to error, and return the error text. */
  callFailing(name: string, args?: Args): Promise<string>;
  listTools(): ReturnType<Client["listTools"]>;
}

// callTool's declared result also covers a legacy { toolResult } shape the
// server never sends, so read content defensively.
function textOf(result: object): string {
  const parts = ((result as { content?: unknown }).content ?? []) as Array<{ type: string; text?: string }>;
  return parts.filter((p) => p.type === "text").map((p) => p.text ?? "").join("\n");
}

/**
 * The real Tomu MCP server with a real MCP client attached in memory, shared by
 * the tests in a file. Tools are called by name and go through the same argument
 * validation a model's calls do — only the HTTP API underneath is fake.
 */
export function useTomu(): TomuClient {
  let client: Client;

  beforeAll(async () => {
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: "tomu-tests", version: "0.0.0" });
    await Promise.all([createServer().connect(serverSide), client.connect(clientSide)]);
  });

  afterAll(async () => {
    await client.close();
  });

  return {
    async call(name, args = {}) {
      const result = await client.callTool({ name, arguments: args });
      const text = textOf(result);
      if (result.isError) throw new Error(`${name} reported an error: ${text}`);
      return text;
    },
    async callFailing(name, args = {}) {
      try {
        const result = await client.callTool({ name, arguments: args });
        if (!result.isError) throw new Error(`${name} was expected to fail, but returned: ${textOf(result)}`);
        return textOf(result);
      } catch (err) {
        const message = (err as Error).message;
        if (message.startsWith(`${name} was expected to fail`)) throw err;
        return message;
      }
    },
    listTools: () => client.listTools(),
  };
}
