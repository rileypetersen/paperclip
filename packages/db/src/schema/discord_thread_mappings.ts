import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { issues } from "./issues.js";

export const discordThreadMappings = pgTable("discord_thread_mappings", {
  threadId: text("thread_id").primaryKey(),
  issueId: text("issue_id").notNull().references(() => issues.id),
  channelMessageId: text("channel_message_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
