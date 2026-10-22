import { and, asc, desc, eq, gte, ilike, or } from "drizzle-orm";
import {
  db,
  householdActivityTable,
  householdMemoriesTable,
} from "@workspace/db";

export type MemoryCategory =
  | "location"
  | "warranty"
  | "chore"
  | "note";
export type MemoryStatus = "active" | "done";
export type ActivityAction = "created" | "updated" | "completed" | "deleted";

type MemoryRow = typeof householdMemoriesTable.$inferSelect;
type ActivityRow = typeof householdActivityTable.$inferSelect;

export type MemoryInput = {
  title: string;
  details: string;
  category: MemoryCategory;
  location?: string | null;
  dueDate?: string | Date | null;
  recurrence?: string | null;
  createdBy: string;
};

export type MemoryPatch = {
  title?: string;
  details?: string;
  category?: MemoryCategory;
  location?: string | null;
  dueDate?: string | Date | null;
  recurrence?: string | null;
  status?: MemoryStatus;
  actor?: string;
};

export function toMemoryRecord(row: MemoryRow) {
  return {
    ...row,
    dueDate: row.dueDate,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toActivityRecord(row: ActivityRow) {
  return { ...row, occurredAt: row.occurredAt.toISOString() };
}

function dateValue(value: string | Date | null | undefined) {
  if (value == null || value === "") return null;
  return value instanceof Date ? value.toISOString().slice(0, 10) : value;
}

async function writeActivity(
  executor: Pick<typeof db, "insert">,
  input: {
    memoryId: string;
    memoryTitle: string;
    action: ActivityAction;
    actor: string;
    summary: string;
  },
) {
  const [activity] = await executor
    .insert(householdActivityTable)
    .values(input)
    .returning();
  return activity;
}

export async function listHouseholdMemories(options: {
  q?: string;
  category?: MemoryCategory;
} = {}) {
  const conditions = [];
  const query = options.q?.trim();
  if (query) {
    const pattern = `%${query}%`;
    conditions.push(
      or(
        ilike(householdMemoriesTable.title, pattern),
        ilike(householdMemoriesTable.details, pattern),
        ilike(householdMemoriesTable.location, pattern),
        ilike(householdMemoriesTable.recurrence, pattern),
        ilike(householdMemoriesTable.createdBy, pattern),
      ),
    );
  }
  if (options.category) {
    conditions.push(eq(householdMemoriesTable.category, options.category));
  }

  const rows = await db
    .select()
    .from(householdMemoriesTable)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(householdMemoriesTable.updatedAt))
    .limit(100);

  return rows.map(toMemoryRecord);
}

export async function searchHouseholdMemories(query: string, limit = 6) {
  const rows = await db
    .select()
    .from(householdMemoriesTable)
    .orderBy(desc(householdMemoriesTable.updatedAt))
    .limit(300);

  const stopWords = new Set([
    "a", "an", "and", "are", "at", "can", "did", "do", "does", "for",
    "find", "from", "how", "i", "in", "is", "it", "look", "me", "my",
    "of", "on", "our", "please", "put", "the", "there", "this", "to",
    "we", "what", "where", "who", "with",
  ]);
  const tokens = (query.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter(
    (token) => token.length > 1 && !stopWords.has(token),
  );
  if (tokens.length === 0) return [];
  const choreIntent =
    /\b(chore|chores|doing|tasks?|needs? doing|this week|what needs)\b/i.test(
      query,
    );

  const ranked = rows
    .map((row) => {
      const title = row.title.toLowerCase();
      const details = row.details.toLowerCase();
      const location = row.location?.toLowerCase() ?? "";
      const recurrence = row.recurrence?.toLowerCase() ?? "";
      const category = row.category.toLowerCase();
      const haystack = `${title} ${details} ${location} ${recurrence} ${category}`;
      let score = 0;
      for (const token of tokens) {
        if (title.includes(token)) score += 5;
        if (location.includes(token)) score += 4;
        if (details.includes(token)) score += 2;
        if (recurrence.includes(token) || category.includes(token)) score += 1;
      }
      if (choreIntent && row.category === "chore") score += 3;
      if (query.trim().length > 2 && haystack.includes(query.toLowerCase().trim())) {
        score += 4;
      }
      return { row, score };
    })
    .filter((match) => match.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        b.row.updatedAt.getTime() - a.row.updatedAt.getTime(),
    )
    .slice(0, limit);

  return ranked.map(({ row }) => toMemoryRecord(row));
}

export async function createHouseholdMemory(input: MemoryInput) {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(householdMemoriesTable)
      .values({
        title: input.title.trim(),
        details: input.details.trim(),
        category: input.category,
        location: input.location?.trim() || null,
        dueDate: dateValue(input.dueDate),
        recurrence: input.recurrence?.trim() || null,
        createdBy: input.createdBy.trim(),
      })
      .returning();
    await writeActivity(tx, {
      memoryId: row.id,
      memoryTitle: row.title,
      action: "created",
      actor: input.createdBy.trim(),
      summary: `Added a ${row.category} memory`,
    });
    return toMemoryRecord(row);
  });
}

export async function updateHouseholdMemory(id: string, patch: MemoryPatch) {
  return db.transaction(async (tx) => {
    const [before] = await tx
      .select()
      .from(householdMemoriesTable)
      .where(eq(householdMemoriesTable.id, id))
      .limit(1);
    if (!before) return null;

    const { actor, dueDate, ...changes } = patch;
    const update: Partial<typeof householdMemoriesTable.$inferInsert> = {
      ...changes,
      ...(dueDate !== undefined
        ? { dueDate: dateValue(dueDate) }
        : {}),
      updatedAt: new Date(),
    };
    const [row] = await tx
      .update(householdMemoriesTable)
      .set(update)
      .where(eq(householdMemoriesTable.id, id))
      .returning();
    const isCompleted = before.status !== "done" && row.status === "done";
    await writeActivity(tx, {
      memoryId: row.id,
      memoryTitle: row.title,
      action: isCompleted ? "completed" : "updated",
      actor: actor?.trim() || "Household member",
      summary: isCompleted
        ? "Marked this chore as complete"
        : "Updated this memory",
    });
    return toMemoryRecord(row);
  });
}

export async function deleteHouseholdMemory(id: string, actor: string) {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(householdMemoriesTable)
      .where(eq(householdMemoriesTable.id, id))
      .limit(1);
    if (!row) return null;

    await tx
      .delete(householdMemoriesTable)
      .where(eq(householdMemoriesTable.id, id));
    await writeActivity(tx, {
      memoryId: row.id,
      memoryTitle: row.title,
      action: "deleted",
      actor: actor.trim() || "Household member",
      summary: "Removed this memory from the household",
    });
    return row;
  });
}

export async function getHouseholdSummary() {
  const rows = await db
    .select()
    .from(householdMemoriesTable)
    .where(eq(householdMemoriesTable.status, "active"));
  const today = new Date().toISOString().slice(0, 10);
  const upcoming = rows
    .filter((row) => row.dueDate && row.dueDate >= today)
    .sort((a, b) => (a.dueDate ?? "").localeCompare(b.dueDate ?? ""))
    .slice(0, 5)
    .map(toMemoryRecord);
  const chores = rows
    .filter((row) => row.category === "chore")
    .sort((a, b) => (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999"));
  const nextChore = chores[0]
    ? `${chores[0].title}${chores[0].recurrence ? ` · ${chores[0].recurrence}` : ""}`
    : null;

  return {
    totalMemories: rows.length,
    locations: rows.filter((row) => row.category === "location").length,
    warranties: rows.filter((row) => row.category === "warranty").length,
    chores: chores.length,
    upcoming,
    nextChore,
  };
}

export async function listHouseholdActivity() {
  const rows = await db
    .select()
    .from(householdActivityTable)
    .orderBy(desc(householdActivityTable.occurredAt))
    .limit(20);
  return rows.map(toActivityRecord);
}

export async function listRecurringChores() {
  const rows = await db
    .select()
    .from(householdMemoriesTable)
    .where(
      and(
        eq(householdMemoriesTable.category, "chore"),
        eq(householdMemoriesTable.status, "active"),
      ),
    )
    .orderBy(asc(householdMemoriesTable.dueDate));
  return rows.map(toMemoryRecord);
}

export async function markChoreDone(id: string, actor: string) {
  const [row] = await db
    .select()
    .from(householdMemoriesTable)
    .where(eq(householdMemoriesTable.id, id))
    .limit(1);
  if (!row || row.category !== "chore") return null;
  return updateHouseholdMemory(id, { status: "done", actor });
}

export async function answerHouseholdQuestion(question: string) {
  const sources = await searchHouseholdMemories(question, 4);
  const answer = sources.length
    ? sources
        .slice(0, 3)
        .map((memory) => {
          const rememberedOn = new Date(memory.createdAt).toLocaleDateString(
            "en-US",
            { month: "short", day: "numeric" },
          );
          return `${memory.title}: ${memory.details}${memory.location ? ` (${memory.location})` : ""}. Added by ${memory.createdBy} on ${rememberedOn}.`;
        })
        .join("\n")
    : "I couldn't find that in your household memories yet. Add it to the board and I'll remember who shared it.";
  return { answer, sources, answeredAt: new Date().toISOString() };
}
