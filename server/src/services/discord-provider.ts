import {
  Client,
  GatewayIntentBits,
  type TextChannel,
  type ThreadChannel,
  type Message,
  EmbedBuilder,
  Options,
} from "discord.js";
import type { Db } from "@paperclipai/db";
import { discordThreadMappings, issues, issueComments, agents } from "@paperclipai/db";
import { and, desc, eq, isNotNull } from "drizzle-orm";
import type { BoardNotificationPayload, BoardNotificationKind, NotificationDeliveryProvider } from "./notifications.js";
import { logger } from "../middleware/logger.js";

export interface DiscordProviderConfig {
  botToken: string;
  channelId: string;
  userMappings: Array<{ discordUserId: string; paperclipUserId: string }>;
}

export interface DiscordProviderDeps {
  db: Db;
  onInboundComment: (issueId: string, body: string, userId: string) => Promise<void>;
}

const NOTIFICATION_COLORS: Record<BoardNotificationKind, number> = {
  board_assigned: 0x5865f2,
  board_blocked: 0xed4245,
  board_stalled: 0xfee75c,
  board_question: 0x57f287,
  issue_created: 0x5865f2,
  issue_status_changed: 0xf0b232,
  issue_comment: 0x99aab5,
};

function buildMentionPrefix(userMappings: Array<{ discordUserId: string }>): string {
  return userMappings.map((m) => `<@${m.discordUserId}>`).join(" ");
}

function buildThreadName(identifier: string, title: string): string {
  const name = `[${identifier}] ${title}`;
  return name.length > 100 ? name.slice(0, 97) + "..." : name;
}

export class DiscordNotificationProvider implements NotificationDeliveryProvider {
  provider = "discord" as const;
  private client: Client | null = null;
  private config: DiscordProviderConfig;
  private deps: DiscordProviderDeps;
  private _started = false;

  constructor(config: DiscordProviderConfig, deps: DiscordProviderDeps) {
    this.config = config;
    this.deps = deps;
  }

  get isConnected(): boolean {
    return this._started;
  }

  async start(): Promise<void> {
    if (this._started) return;

    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
      ],
      makeCache: Options.cacheWithLimits({
        MessageManager: 0,
        GuildMemberManager: 0,
        PresenceManager: 0,
      }),
    });

    this.client.on("messageCreate", (message) => this.handleInboundMessage(message));

    this.client.on("error", (err) => {
      logger.error({ err }, "discord gateway error");
    });

    await this.client.login(this.config.botToken);
    this._started = true;
    logger.info("discord notification provider connected");
  }

  async stop(): Promise<void> {
    if (this.client) {
      this.client.destroy();
      this.client = null;
      this._started = false;
      logger.info("discord notification provider disconnected");
    }
  }

  updateConfig(config: DiscordProviderConfig): void {
    this.config = config;
  }

  async deliver(notification: BoardNotificationPayload): Promise<
    | { ok: true; metadata?: Record<string, string> }
    | { ok: false; error: string }
  > {
    if (!this.client) {
      return { ok: false, error: "Discord client not connected" };
    }

    try {
      const channel = await this.client.channels.fetch(this.config.channelId);
      if (!channel || !("send" in channel)) {
        return { ok: false, error: `Channel ${this.config.channelId} not found or not a text channel` };
      }
      const textChannel = channel as TextChannel;
      const mentionPrefix = buildMentionPrefix(this.config.userMappings);

      // Check for existing thread for this issue
      const existing = await this.deps.db
        .select()
        .from(discordThreadMappings)
        .where(eq(discordThreadMappings.issueId, notification.issue.id))
        .limit(1)
        .then((rows) => rows[0] ?? null);

      if (existing) {
        // Post follow-up in existing thread
        const thread = await this.client.channels.fetch(existing.threadId) as ThreadChannel | null;
        if (thread && "send" in thread) {
          const embed = this.buildEmbed(notification);
          await thread.send({ content: mentionPrefix, embeds: [embed] });
          return { ok: true, metadata: { threadId: existing.threadId, channelMessageId: existing.channelMessageId } };
        }
        // Thread gone — fall through to create new one
      }

      // Create new thread
      const embed = this.buildEmbed(notification);
      const message = await textChannel.send({ content: mentionPrefix, embeds: [embed] });
      const threadName = buildThreadName(notification.issue.identifier, notification.issue.title);
      const thread = await message.startThread({ name: threadName, autoArchiveDuration: 60 });

      // Persist mapping
      await this.deps.db
        .insert(discordThreadMappings)
        .values({
          threadId: thread.id,
          issueId: notification.issue.id,
          channelMessageId: message.id,
        })
        .onConflictDoNothing();

      return { ok: true, metadata: { threadId: thread.id, channelMessageId: message.id } };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  private buildEmbed(notification: BoardNotificationPayload): EmbedBuilder {
    const description = notification.comment?.fullBody
      ?? notification.comment?.bodySnippet
      ?? notification.trigger.reason;
    const truncatedDescription = description.length > 4096
      ? description.slice(0, 4093) + "..."
      : description;

    const authorName = notification.comment
      ? (notification.comment.authorName ?? notification.comment.authorId)
      : notification.issue.identifier;

    return new EmbedBuilder()
      .setAuthor({ name: authorName, url: notification.issue.url })
      .setDescription(truncatedDescription)
      .setColor(NOTIFICATION_COLORS[notification.kind] ?? 0x5865f2);
  }

  private async handleInboundMessage(message: Message): Promise<void> {
    // Ignore bot's own messages
    if (message.author.id === this.client?.user?.id) return;

    // Only process messages in threads
    if (!message.channel.isThread()) return;

    // Skip attachment-only messages
    if (!message.content.trim()) return;

    // Lookup thread mapping
    const mapping = await this.deps.db
      .select()
      .from(discordThreadMappings)
      .where(eq(discordThreadMappings.threadId, message.channel.id))
      .limit(1)
      .then((rows) => rows[0] ?? null);

    if (!mapping) return;

    // Lookup user
    const userMapping = this.config.userMappings.find(
      (m) => m.discordUserId === message.author.id,
    );
    if (!userMapping) return;

    // Look up the most recent agent who commented on this issue to prepend @mention
    let mentionPrefix = "";
    try {
      const lastAgentComment = await this.deps.db
        .select({ authorAgentId: issueComments.authorAgentId })
        .from(issueComments)
        .where(and(
          eq(issueComments.issueId, mapping.issueId),
          isNotNull(issueComments.authorAgentId),
        ))
        .orderBy(desc(issueComments.createdAt))
        .limit(1)
        .then((rows) => rows[0] ?? null);
      if (lastAgentComment?.authorAgentId) {
        const agent = await this.deps.db
          .select({ name: agents.name })
          .from(agents)
          .where(eq(agents.id, lastAgentComment.authorAgentId))
          .limit(1)
          .then((rows) => rows[0] ?? null);
        if (agent) {
          mentionPrefix = `@${agent.name} `;
        }
      }
    } catch (err) {
      logger.error({ err }, "failed to resolve agent name for discord mention prefix");
    }

    // Post comment with agent @mention prefix
    try {
      await this.deps.onInboundComment(
        mapping.issueId,
        mentionPrefix + message.content,
        userMapping.paperclipUserId,
      );
      await message.react("✅");
    } catch (err) {
      logger.error({ err, threadId: message.channel.id, issueId: mapping.issueId }, "failed to route discord reply to issue comment");
      await message.react("❌").catch(() => {});
      await message.reply(`Failed to post comment: ${err instanceof Error ? err.message : "unknown error"}`).catch(() => {});
    }
  }
}
