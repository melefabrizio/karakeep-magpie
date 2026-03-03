# Magpie — Discord Link Collector Bot

## Overview

Magpie is a Discord bot that monitors configured channels, extracts URLs from messages, classifies them through a three-step pipeline, and submits interesting links to a Karakeep instance as bookmarks.

## Tech Stack

| Component       | Choice                                             | Rationale                                                                                                          |
| --------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Runtime         | Node.js (>=20 LTS)                                 | Best Discord bot ecosystem, mature tooling                                                                         |
| Discord library | `discord.js` v14                                   | De facto standard, excellent docs, full gateway support                                                            |
| AI provider     | AWS Bedrock                                        | Already in Fabrizio's infra comfort zone, no separate API keys                                                     |
| AI SDK          | Vercel AI SDK (`ai` + `@ai-sdk/amazon-bedrock`)    | Minimal config, clean async API, swappable providers                                                               |
| Model           | Claude Haiku 4.5 (`anthropic.claude-haiku-4-5-v1`) | Fast, cheap, more than enough for URL triage. Note: "Haiku 4.7" does not exist; 4.5 is the latest Haiku on Bedrock |
| HTTP client     | Native `fetch` (Node 20+)                          | No extra dependency for Karakeep API calls and metadata fetching                                                   |
| Deployment      | Docker container                                   | Runs alongside the Karakeep instance via docker-compose                                                            |
| Language        | TypeScript                                         | Type safety without overhead, compiles to JS                                                                       |

## Configuration

All config lives in a single `config.ts` (or env vars). No database required.

```typescript
export const config = {
  // Discord
  discordToken: process.env.DISCORD_TOKEN!,
  channelIds: process.env.CHANNEL_IDS!.split(","), // e.g. "123456,789012"

  // Karakeep
  karakeepApiUrl: process.env.KARAKEEP_API_URL!, // e.g. "https://karakeep.example.com"
  karakeepApiKey: process.env.KARAKEEP_API_KEY!,

  // AWS Bedrock (picked up automatically from env / instance profile)
  awsRegion: process.env.AWS_REGION ?? "eu-west-1",

  // Pipeline — blocked domains
  // Hard-coded baseline. Merged at runtime with BLOCKED_DOMAINS env var
  // (comma-separated, e.g. "notion.so,linear.app").
  blockedDomains: [
    "drive.google.com",
    "clickup.com",
    "monade.io",
    "monadeapps.xyz",
    ...(process.env.BLOCKED_DOMAINS?.split(",")
      .map((d) => d.trim())
      .filter(Boolean) ?? []),
  ],

  // Metadata fetch timeout
  fetchTimeoutMs: 5000,
};
```

## Discord Bot Setup

### Required intents

- `GatewayIntentBits.Guilds`
- `GatewayIntentBits.GuildMessages`
- `GatewayIntentBits.MessageContent` (privileged — must be enabled in the Discord Developer Portal)

### Event flow

The bot subscribes to `messageCreate`. On each event:

1. Check if `message.channelId` is in `config.channelIds`. If not, ignore.
2. Extract URLs from `message.content` via regex, plus any URLs in `message.embeds`.
3. Feed each URL into the classification pipeline.
4. On success, optionally react to the message with a configurable emoji (e.g. 🐦) as visual feedback.

### URL extraction

Use a simple regex on `message.content`:

```
https?://[^\s<>)"']+
```

Also iterate `message.embeds` and collect `.url` from each embed object, since Discord sometimes strips the URL from the text and only shows the embed.

Deduplicate the combined list before processing.

## Classification Pipeline

Three sequential steps. Each URL passes through all three; any step can reject the URL and stop the pipeline.

### Step 1 — Domain blocklist (coarse filter)

Extract the hostname from the URL and check it against `config.blockedDomains`.

This is a synchronous, zero-cost gate that immediately drops internal/work URLs that are never interesting for bookmarking. The list is maintained in config and expected to grow over time.

**Decision: reject or pass.**

### Step 2 — Metadata extraction

Fetch the URL with a GET request (respecting `config.fetchTimeoutMs`) and extract:

- `<title>`
- `<meta name="description">`
- `<meta property="og:title">`
- `<meta property="og:description">`
- `<meta property="og:type">`
- `<meta property="og:image">`
- `<meta name="keywords">`

Use a lightweight HTML parser (e.g. `cheerio` or a simple regex pass — `cheerio` preferred for robustness).

If the fetch fails (timeout, 4xx/5xx, non-HTML content type), attach a flag `fetchFailed: true` but do **not** reject. Step 3 will decide what to do with URLs that couldn't be fetched.

**Output: a metadata object passed to Step 3.**

```typescript
interface UrlMetadata {
  url: string;
  resolvedUrl?: string;
  domain: string;
  title?: string;
  description?: string;
  ogType?: string;
  keywords?: string;
  fetchFailed: boolean;
}
```

### Step 3 — LLM interest classification

Send the metadata to Claude Haiku 4.5 via Bedrock with a structured prompt.

**Prompt design:**

```
You are a link triage assistant. Based on the following URL metadata, decide
whether this link is worth bookmarking for a software engineer interested in:
cloud infrastructure, DevOps, backend development, Rust, Ruby/Rails, AWS,
distributed systems, open source tooling, and tech industry news.

Respond with a JSON object only:
{
  "dominated": true | false,
  "reason": "one sentence explaining the decision",
  "tags": ["tag1", "tag2"]   // only if interesting
}

URL metadata:
<metadata>
${JSON.stringify(metadata)}
</metadata>
```

- If `interesting` is true → proceed to Karakeep submission with the suggested tags.
- If `interesting` is false → drop the URL, log the reason.
- If `fetchFailed` is true and no metadata is available, the LLM should make a best-effort guess from the URL/domain alone, or return `interesting: false` if genuinely unclear.

**Model parameters:**

- `temperature: 0` — deterministic classification, no creativity needed
- `maxTokens: 200` — response is a small JSON object

**Vercel AI SDK usage sketch:**

```typescript
import { generateText } from "ai";
import { bedrock } from "@ai-sdk/amazon-bedrock";

const { text } = await generateText({
  model: bedrock("anthropic.claude-haiku-4-5-v1"),
  prompt: buildClassificationPrompt(metadata),
  temperature: 0,
  maxTokens: 200,
});

const result = JSON.parse(text);
```

## Karakeep Submission

For URLs that pass all three steps, POST to Karakeep's API:

```
POST {config.karakeepApiUrl}/api/v1/bookmarks
Authorization: Bearer {config.karakeepApiKey}
Content-Type: application/json

{
  "type": "link",
  "url": "https://example.com/article",
  "tags": [
    { "name": "devops" },
    { "name": "aws" }
  ]
}
```

On success (2xx), react to the Discord message with the configured emoji.
On failure, log the error but do not retry (Karakeep is expected to be on the same network; transient failures are rare).

## Error Handling

- **Discord disconnections**: `discord.js` handles reconnection automatically. No custom logic needed.
- **Metadata fetch failures**: caught and flagged, never crash the pipeline.
- **LLM errors**: catch, log, skip the URL. Do not block the bot.
- **Karakeep errors**: catch, log, skip. Optionally react with a different emoji (e.g. ❌) to signal failure.
- **Malformed LLM output**: if JSON parsing fails, treat as not interesting and log a warning.

All errors are logged to stdout (structured JSON preferred) for Docker log collection.

## Project Structure

```
magpie/
├── src/
│   ├── index.ts              # Entry point, Discord client setup
│   ├── config.ts             # Configuration constants
│   ├── pipeline/
│   │   ├── extract.ts        # URL extraction from messages
│   │   ├── filter.ts         # Step 1: domain blocklist
│   │   ├── metadata.ts       # Step 2: fetch and parse metadata
│   │   └── classify.ts       # Step 3: LLM classification via Bedrock
│   ├── karakeep.ts           # Karakeep API client
│   └── logger.ts             # Structured logging
├── Dockerfile
├── monade.yaml # for local dev, see schemastore
├── package.json
├── tsconfig.json
└── .env.example
```

## Deployment

The bot runs as a single long-lived process. Will be deployed via an AWS ECS Service using dockerfile.

AWS credentials for Bedrock are passed via environment variables (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`) or, better, via an IAM instance profile / ECS task role if running on AWS.

## Dependencies

```json
{
  "dependencies": {
    "discord.js": "^14",
    "ai": "^4",
    "@ai-sdk/amazon-bedrock": "^2",
    "cheerio": "^1"
  },
  "devDependencies": {
    "typescript": "^5",
    "@types/node": "^20"
  }
}
```

## Planned Improvements

### [IMPLEMENTED] Fix: remove tags from classification + submission

Tagging is handled entirely by Karakeep after submission. The classifier no longer needs to produce tags, and the Karakeep API call should not include a `tags` field.

Changes required:

- `src/pipeline/classify.ts` — remove `tags` from Zod schema and `ClassifyResult`; remove unused `import { error } from "console"`
- `src/karakeep.ts` — remove `tags` parameter from `submitBookmark`
- `src/index.ts` — remove `tags` from the `submitBookmark` call

---

### [IMPLEMENTED] Configurable blocked domains via env var

The `BLOCKED_DOMAINS` env var (comma-separated hostnames) should be merged with the hard-coded baseline at startup. This lets the list be extended at deploy time without code changes.

```
BLOCKED_DOMAINS=notion.so,linear.app,figma.com
```

Config change: spread `process.env.BLOCKED_DOMAINS?.split(",")` into `blockedDomains` array.

---

### [IMPLEMENTED] Metadata: follow redirects + existence check

`fetchMetadata` should:

1. **Follow redirects** transparently (Node `fetch` does this by default; no change needed for the common case). Track the final resolved URL so the classifier sees the canonical destination, not a `t.co` or `bit.ly` shortener.
2. **Treat non-200 final responses as `fetchFailed: true`** and include a `resolvedUrl` field in `UrlMetadata` when the URL was redirected.

```typescript
interface UrlMetadata {
  url: string;           // original URL as posted
  resolvedUrl?: string;  // final URL after redirects (if different)
  domain: string;        // hostname of resolvedUrl (or url if no redirect)
  ...
  fetchFailed: boolean;
}
```

The resolved URL should be used for deduplication (below) and for the Karakeep submission, so shortlinks don't create duplicate bookmarks for the same canonical page.

---

### [IMPLEMENTED] Deduplication via Karakeep API

Before submitting, check whether the URL already exists in Karakeep:

```
GET {karakeepApiUrl}/bookmarks?url={encodedUrl}
Authorization: Bearer {karakeepApiKey}
```

If the response contains at least one bookmark matching that URL, skip submission and log `"url already bookmarked"`. This works across bot restarts and days without any local state.

Use the **resolved URL** (after redirects) for the lookup so that `bit.ly/xxx` and the canonical URL don't create duplicates.

Implementation sketch in `src/karakeep.ts`:

```typescript
export async function isAlreadyBookmarked(url: string): Promise<boolean> { ... }
```

Called in `index.ts` after metadata fetch, before classification (no point paying for an LLM call if the URL is already saved).

---

### [IMPLEMENTED] Pass Discord message context as Karakeep note

When submitting a bookmark, include a `note` field with context from the original Discord message:

```json
{
  "type": "link",
  "url": "...",
  "note": "Shared by @username in #channel-name\n\n> original message text"
}
```

This preserves the human context (who shared it, why, with what comment) inside Karakeep, which otherwise shows only the URL title/description.

The note is built in `index.ts` from `message.author.username`, `message.channel` (name or id), and `message.content` (with the URL stripped or kept — keep it for context).

`submitBookmark` signature change:

```typescript
export async function submitBookmark(
  url: string,
  note?: string,
): Promise<BookmarkResult>;
```

---

## Open Questions / Future Work

- **Rate limiting**: if a channel gets flooded with links, the bot will fire many LLM calls in parallel. Consider a simple concurrency limiter (e.g. `p-limit`).
- **All-channel**: current design assumes a selection of channel. Consider enabling the bot on all server's channels.
- **Prompt tuning**: the classification prompt will need iteration based on real traffic. Consider logging all LLM decisions for a week before trusting it fully.
- **Feedback loop**: a Discord slash command like `/magpie why <url>` that explains why a URL was or wasn't bookmarked could help tune the system.
- **`messageUpdate` handler**: edited messages that add a URL are currently ignored.
- **Disable LLM**: make LLM optional by omitting bedrock credentials.
- **support more ai providers out of the box**
