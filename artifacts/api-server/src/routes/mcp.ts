import { Router, type IRouter } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import {
  createHouseholdMemory,
  listRecurringChores,
  markChoreDone,
  searchHouseholdMemories,
} from "../lib/household";

const router: IRouter = Router();

function createHouseholdMcpServer() {
  const server = new McpServer(
    {
      name: "household-memory",
      version: "1.0.0",
    },
    {
      instructions:
        "Shared household memory for locations, warranties, recurring chores, and family notes. Preserve attribution. Search before answering, cite who added a fact, and never invent a memory that is not returned by a tool.",
    },
  );

  server.registerTool(
    "search_household_memory",
    {
      title: "Search household memories",
      description:
        "Find saved household facts. Results include who first shared each fact and when it was last updated.",
      inputSchema: {
        query: z.string().min(1).max(200),
      },
    },
    async ({ query }) => {
      const results = await searchHouseholdMemories(query, 6);
      return {
        content: [
          {
            type: "text" as const,
            text: results.length
              ? JSON.stringify(results, null, 2)
              : "No matching household memories were found.",
          },
        ],
        structuredContent: { results },
      };
    },
  );

  server.registerTool(
    "remember_household_fact",
    {
      title: "Remember a household fact",
      description:
        "Save a location, warranty, chore, or note and record who shared it.",
      inputSchema: {
        title: z.string().min(1).max(160),
        details: z.string().min(1).max(2000),
        category: z.enum(["location", "warranty", "chore", "note"]),
        createdBy: z.string().min(1).max(80),
        location: z.string().max(200).optional(),
        dueDate: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional(),
        recurrence: z.string().max(120).optional(),
      },
    },
    async ({ title, details, category, createdBy, location, dueDate, recurrence }) => {
      const memory = await createHouseholdMemory({
        title,
        details,
        category,
        createdBy,
        location,
        dueDate,
        recurrence,
      });
      return {
        content: [
          {
            type: "text" as const,
            text: `Remembered “${memory.title}”, shared by ${memory.createdBy}.`,
          },
        ],
        structuredContent: { memory },
      };
    },
  );

  server.registerTool(
    "list_recurring_chores",
    {
      title: "List recurring chores",
      description:
        "Show active chores with their due dates, recurrence, and original attribution.",
      inputSchema: {},
    },
    async () => {
      const chores = await listRecurringChores();
      return {
        content: [
          {
            type: "text" as const,
            text: chores.length
              ? JSON.stringify(chores, null, 2)
              : "There are no active household chores.",
          },
        ],
        structuredContent: { chores },
      };
    },
  );

  server.registerTool(
    "mark_chore_done",
    {
      title: "Mark a chore complete",
      description:
        "Mark a saved chore as done and record which household member completed it.",
      inputSchema: {
        memoryId: z.string().uuid(),
        doneBy: z.string().min(1).max(80),
      },
    },
    async ({ memoryId, doneBy }) => {
      const memory = await markChoreDone(memoryId, doneBy);
      if (!memory) {
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: "No chore with that memory ID was found.",
            },
          ],
        };
      }
      return {
        content: [
          {
            type: "text" as const,
            text: `${memory.title} was marked complete by ${doneBy}.`,
          },
        ],
        structuredContent: { memory },
      };
    },
  );

  return server;
}

router.all("/mcp", async (req, res): Promise<void> => {
  const server = createHouseholdMcpServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    req.log.error({ err: error }, "MCP request failed");
    if (!res.headersSent) {
      res.status(500).json({ error: "MCP request failed" });
    }
  }
});

export default router;
