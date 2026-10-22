# Household Memory Keepsake

Household Memory Keepsake is a self-hosted MCP server for a shared, persistent family memory. It helps track where things are, warranty dates, chores, and a record of who said what and when across the household.

This repository contains:
- a TypeScript API server for memory storage and MCP endpoints
- a PostgreSQL + Drizzle data layer
- a React web app for the household memory UI
- generated API schema/client code used across the workspace

## Features

- persistent household memory records
- item location and ownership tracking
- warranty and replacement timing reminders
- chore tracking and family task history
- shared house notes with timestamps and attribution
- MCP-compatible API for AI assistants and tooling

## Tech stack

- Node.js 24
- TypeScript 5.9
- pnpm workspaces
- Express 5
- PostgreSQL + Drizzle ORM
- React + Vite + Tailwind CSS
- Zod validation

## Repository layout

- `artifacts/api-server/` — Express API server entry point and MCP routes
- `artifacts/household-memory/` — React front-end app
- `lib/db/` — database schema and Drizzle client setup
- `lib/api-spec/` — API contract definitions
- `lib/api-zod/` — generated Zod validation schemas
- `lib/api-client-react/` — generated React API client
- `scripts/` — utility scripts

## Prerequisites

Before you start, install:

- Node.js 24+
- pnpm
- PostgreSQL 14+ (or a compatible Postgres instance)

## Installation

Clone the repository and install dependencies:

```bash
git clone https://github.com/ShivangiBhargava/Household-Memory-keepsake.git
cd Household-Memory-keepsake
pnpm install
```

## Environment variables

Create a `.env` file in the project root and set the required values:

```bash
DATABASE_URL=postgresql://username:password@localhost:5432/household_memory
PORT=5000
```

These values are used by the server and database layer.

If you are using a local Postgres instance, make sure the database exists and the user has permissions to create tables.

## Database setup

Push the current schema to your database:

```bash
pnpm --filter @workspace/db run push
```

This uses Drizzle and the configured database URL from `DATABASE_URL`.

## Run the app

### 1) Start the API server

```bash
pnpm --filter @workspace/api-server run dev
```

This starts the Express server on the port defined by `PORT` (default usage in the repo is port 5000).

### 2) Start the frontend

Open a second terminal and run:

```bash
pnpm --filter @workspace/household-memory run dev
```

This starts the Vite app for the household memory UI.

If you need the UI exposed on a network address, the package script already runs Vite with `--host 0.0.0.0`.

## Build and typecheck

Run the full workspace checks:

```bash
pnpm run typecheck
```

Build the monorepo:

```bash
pnpm run build
```

## API and code generation

If the OpenAPI or generated types change, regenerate the client and schemas:

```bash
pnpm --filter @workspace/api-spec run codegen
```

## Production notes

For a deployed environment, set the same environment variables in your runtime environment and ensure your database is reachable from the app host.

## License

This project is licensed under the MIT License. See the `LICENSE` file in the repository root for details.

## Contributing

Contributions are welcome. Please open an issue or submit a pull request with a clear explanation of the change and any required migration or setup notes.
