import { Client, GatewayIntentBits } from "discord.js";
import { config } from "./config.js";
import { log } from "./logger.js";
import { extractUrls } from "./pipeline/extract.js";
import { filterByDomain } from "./pipeline/filter.js";
import { fetchMetadata } from "./pipeline/metadata.js";
import { classify } from "./pipeline/classify.js";
import { isAlreadyBookmarked, submitBookmark } from "./karakeep.js";

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

client.once("ready", (c) => {
  log("info", "bot ready", { username: c.user.tag });
});

client.on("messageCreate", async (message) => {
  if (!config.channelIds.includes(message.channelId)) return;
  if (message.author.bot) return;

  const urls = extractUrls(message);
  if (urls.length === 0) return;

  log("info", "processing message", {
    channelId: message.channelId,
    messageId: message.id,
    urlCount: urls.length,
  });

  const channelName =
    "name" in message.channel ? `#${message.channel.name}` : message.channelId;
  const note = `Shared by @${message.author.username} in ${channelName}\n\n> ${message.content}`;

  for (const url of urls) {
    try {
      // Step 1 — domain blocklist
      const filterResult = filterByDomain(url);
      if (!filterResult.passed) {
        log("info", "url filtered", { url, reason: filterResult.reason });
        continue;
      }

      // Step 2 — metadata
      const metadata = await fetchMetadata(url);
      const canonicalUrl = metadata.resolvedUrl ?? url;
      log("debug", "metadata fetched", {
        url,
        canonicalUrl,
        fetchFailed: metadata.fetchFailed,
      });

      // Step 2b — deduplication
      const alreadyBookmarked = await isAlreadyBookmarked(canonicalUrl);
      if (alreadyBookmarked) {
        log("info", "url already bookmarked", { url, canonicalUrl });
        continue;
      }

      // Step 3 — classify
      const classification = await classify(metadata);
      log("info", "url classified", {
        url,
        interesting: classification.interesting,
        reason: classification.reason,
      });

      if (!classification.interesting) continue;

      // Submit to Karakeep
      const result = await submitBookmark(canonicalUrl, note);
      if (result.ok) {
        await message.react(config.successEmoji);
      } else {
        log("warn", "karakeep submission failed", { url, error: result.error });
        await message.react(config.errorEmoji);
      }
    } catch (err) {
      log("error", "pipeline error", {
        url,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
});

client.login(config.discordToken);
