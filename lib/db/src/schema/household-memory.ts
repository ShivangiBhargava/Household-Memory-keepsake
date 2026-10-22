import {
  date,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const memoryCategoryEnum = pgEnum("household_memory_category", [
  "location",
  "warranty",
  "chore",
  "note",
]);

export const memoryStatusEnum = pgEnum("household_memory_status", [
  "active",
  "done",
]);

export const activityActionEnum = pgEnum("household_activity_action", [
  "created",
  "updated",
  "completed",
  "deleted",
]);

export const householdMemoriesTable = pgTable(
  "household_memories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    title: text("title").notNull(),
    details: text("details").notNull(),
    category: memoryCategoryEnum("category").notNull(),
    location: text("location"),
    dueDate: date("due_date", { mode: "string" }),
    recurrence: text("recurrence"),
    status: memoryStatusEnum("status").notNull().default("active"),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("household_memories_category_idx").on(table.category),
    index("household_memories_status_idx").on(table.status),
    index("household_memories_due_date_idx").on(table.dueDate),
  ],
);

export const householdActivityTable = pgTable(
  "household_activity",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    memoryId: uuid("memory_id").notNull(),
    memoryTitle: text("memory_title").notNull(),
    action: activityActionEnum("action").notNull(),
    actor: text("actor").notNull(),
    summary: text("summary").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("household_activity_occurred_at_idx").on(table.occurredAt)],
);

export const insertHouseholdMemorySchema = createInsertSchema(
  householdMemoriesTable,
).omit({
  id: true,
  status: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertHouseholdMemory = z.infer<
  typeof insertHouseholdMemorySchema
>;
export type HouseholdMemory = typeof householdMemoriesTable.$inferSelect;
export type HouseholdActivity = typeof householdActivityTable.$inferSelect;
