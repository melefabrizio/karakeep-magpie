import {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  ApplicationCommandType,
} from "discord.js";
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

client.once("ready", async (c) => {
  log("info", "bot ready", { username: c.user.tag });

  const rest = new REST().setToken(config.discordToken);
  try {
    await rest.put(Routes.applicationCommands(c.application.id), {
      body: [
        {
          name: config.bookmarkCommandName,
          type: ApplicationCommandType.Message,
        },
      ],
    });
    log("info", "context menu command registered", {
      name: config.bookmarkCommandName,
    });
  } catch (err) {
    log("error", "failed to register context menu command", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

// Manual bookmark: right-click a message → Apps → "Save to Magpie"
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isMessageContextMenuCommand()) return;
  if (interaction.commandName !== config.bookmarkCommandName) return;

  await interaction.deferReply({ ephemeral: true });

  const message = interaction.targetMessage;
  const urls = extractUrls(message);

  if (urls.length === 0) {
    await interaction.editReply("No URLs found in that message.");
    return;
  }

  const channelName =
    "name" in message.channel ? `#${message.channel.name}` : message.channelId;
  const note = `Manually bookmarked by @${interaction.user.username} in ${channelName}\n\n> ${message.content}`;

  let anySuccess = false;
  for (const url of urls) {
    log("info", "manual bookmark", { url, invokedBy: interaction.user.username });
    const result = await submitBookmark(url, note);
    if (result.ok) {
      anySuccess = true;
    } else {
      log("warn", "manual bookmark submission failed", { url, error: result.error });
    }
  }

  if (anySuccess) {
    await message.react(config.successEmoji);
    const count = urls.length === 1 ? "1 link" : `${urls.length} links`;
    await interaction.editReply(`Saved ${count}.`);
  } else {
    await interaction.editReply("Failed to bookmark — check the logs.");
  }
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
