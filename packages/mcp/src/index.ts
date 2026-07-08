#!/usr/bin/env node

// Local entry point: Tomu MCP over stdio (Claude Code / Claude Desktop).

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";

const server = createServer();
await server.connect(new StdioServerTransport());
