// ── Server ──
//
// createServer() builds a fully tool-registered McpServer. Entry points pick the
// transport: index.ts (stdio, local) and http.ts (streamable HTTP, remote). Tool
// bodies live in ./tools, one module per area.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { register as registerDev } from "./tools/dev.js";
import { register as registerField } from "./tools/field.js";
import { register as registerGear } from "./tools/gear.js";
import { register as registerInventory } from "./tools/inventory.js";
import { register as registerShooting } from "./tools/shooting.js";
import { register as registerSummary } from "./tools/summary.js";

export function createServer(): McpServer {
  const server = new McpServer({
    name: "tomu",
    version: "0.1.0",
  });

  registerInventory(server);
  registerGear(server);
  registerSummary(server);
  registerShooting(server);
  registerField(server);
  registerDev(server);

  return server;
}
