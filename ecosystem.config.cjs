// pm2 process definitions for a Tomu deployment.
// Portable: paths resolve relative to this file, so it works wherever the repo
// is checked out. Secrets come from the sibling .env via node's --env-file.
//   pm2 startOrReload ecosystem.config.cjs --update-env
const path = require("node:path");
const root = __dirname;
const envFile = "--env-file=" + path.join(root, ".env");

module.exports = {
  apps: [
    {
      name: "tomu-api",
      script: path.join(root, "packages/server/dist/index.js"),
      cwd: root,
      node_args: envFile,
      max_memory_restart: "350M",
      autorestart: true,
      time: true,
    },
    {
      name: "tomu-mcp",
      script: path.join(root, "packages/mcp/dist/http.js"),
      cwd: root,
      node_args: envFile,
      max_memory_restart: "250M",
      autorestart: true,
      time: true,
    },
  ],
};
