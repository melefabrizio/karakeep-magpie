import type { Message } from "discord.js";

const URL_REGEX = /https?:\/\/[^\s<>)"']+/g;

export function extractUrls(message: Message): string[] {
  const fromContent = message.content.match(URL_REGEX) ?? [];
  const fromEmbeds = message.embeds.flatMap((embed) =>
    embed.url ? [embed.url] : [],
  );

  // Deduplicate
  return [...new Set([...fromContent, ...fromEmbeds])];
}
