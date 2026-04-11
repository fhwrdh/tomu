# CLAUDE.md — Tomu

Film photography management app. Tracks gear, film inventory, rolls, frames, development, and scans.

## Quick Start

```bash
npm install                          # Install all workspace dependencies
npm run build:shared                 # Build shared types (required first)
npm run dev:server                   # Start API server (port 3456)
npm run dev:client                   # Start frontend (port 5173, proxies /api to server)
```

## Architecture

Monorepo with npm workspaces:

- `packages/shared` — TypeScript types, Zod schemas, constants. Build first.
- `packages/server` — Fastify API + Drizzle ORM + PostgreSQL
- `packages/client` — React 18 + Vite + Tailwind + shadcn/ui (PWA)
- `packages/mcp` — MCP tool server for Claude integration

### Key Principles

- **API-first**: Both the React UI and Claude (via MCP) are equal consumers of the API
- **Postel's Law**: Be liberal in what we accept. Fuzzy matching on names, flexible input formats, case-insensitive lookups
- **Offline-first**: Client uses IndexedDB + TanStack Query mutation queue (future)
- **Mobile-first**: Bottom nav, touch targets, PWA installable

## Database

PostgreSQL 16. Drizzle ORM for schema and migrations.

```bash
cd packages/server
npm run db:push                      # Push schema to database
npm run db:generate                  # Generate migration files
npm run db:migrate                   # Run migrations
npm run db:studio                    # Open Drizzle Studio
```

Connection string: `DATABASE_URL` env var (default: `postgres://tomu:tomu@localhost:5432/tomu`)

## MCP Server

Exposes Tomu tools to Claude sessions. Configured via environment:

- `TOMU_API_URL` — API base URL (default: `http://localhost:3456/api/v1`)
- `TOMU_API_TOKEN` — JWT token for auth

Tools: `tomu_inventory`, `tomu_add_inventory`, `tomu_gear`, `tomu_summary`

## Deployment

- **URL**: `film.fhwrdh.net` → DO droplet (157.230.156.132)
- **Backend**: Fastify managed by PM2, behind nginx reverse proxy
- **Frontend**: Static Vite build served by nginx
- **Files**: DO Spaces (S3-compatible) for images and scans

## Conventions

- All entity IDs are UUIDs (client-generated for offline support)
- API responses wrapped in `{ data: ... }`
- Shared types imported from `@tomu/shared`
- UI components in `packages/client/src/components/ui/` (shadcn/ui pattern)
- Feature components in `packages/client/src/components/{feature}/`
