import { api } from "./client";

export interface NotificationsConfig {
  provider: "disabled" | "command" | "webhook" | "discord";
  boardEmails: string[];
  webhookUrl?: string;
  discord?: {
    channelId: string;
    userMappings: Array<{ discordUserId: string; paperclipUserId: string }>;
  };
  command: { path?: string; args: string[] };
  stalledThresholdMinutes: number;
  stalledCooldownMinutes: number;
}

export const notificationsApi = {
  get: () => api.get<NotificationsConfig>("/instance/notifications"),
  update: (data: NotificationsConfig) =>
    api.patch<NotificationsConfig>("/instance/notifications", data),
  test: () => api.post<{ ok: boolean; error?: string }>("/instance/notifications/test", {}),
  discordStatus: () => api.get<{ connected: boolean }>("/instance/notifications/discord-status"),
};
