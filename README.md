# Magpie

A Discord bot that watches channels for URLs, classifies them with AI, and saves the interesting ones to [Karakeep](https://karakeep.app) as bookmarks.

> **Intended for internal use in private, trusted Discord servers.**
> The bot fetches arbitrary URLs posted by members and sends their content to an external LLM for classification. In a public or untrusted server this can be abused to exfiltrate data or trigger requests to internal network resources. Do not add Magpie to servers where you cannot vet every member.

## How it works

Every message posted to a monitored channel goes through a three-step pipeline:

1. **Domain filter** — drops URLs from a configurable blocklist (internal tools, project management apps, etc.) before spending any resources on them.
2. **Metadata fetch** — fetches the page and extracts title, description, and Open Graph tags. Follows redirects so short links resolve to their canonical URL.
3. **LLM classification** — sends the metadata to Claude Haiku via AWS Bedrock. The model decides whether the link is worth bookmarking for a software engineering team, and explains why.

Links that pass all three steps are submitted to Karakeep, with a note recording who shared it and in which channel. The bot reacts to the original message with 🐦 on success or ❌ on failure.

### Manual bookmarking

Any member can force-save a link by right-clicking (or long-pressing on mobile) a message and selecting **Apps → Save to Magpie**. This bypasses the domain filter and LLM classification and saves the first URL found in the message directly to Karakeep. Useful for links that would otherwise be filtered out or classified as not worth saving.

## Prerequisites

- A Discord bot with the **Message Content** privileged intent enabled ([Discord Developer Portal](https://discord.com/developers/applications))
- A running [Karakeep](https://github.com/karakeep-app/karakeep) instance with an API key
- AWS credentials with access to Bedrock in your chosen region (Claude Haiku must be enabled)

## Setup

```bash
# Install dependencies
yarn install

# Copy the example env file and fill in the values
cp .env.example .env
```

### Environment variables

| Variable                                      | Required | Description                                                                                                     |
| --------------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------- |
| `DISCORD_TOKEN`                               | yes      | Bot token from the Discord Developer Portal                                                                     |
| `CHANNEL_IDS`                                 | yes      | Comma-separated IDs of channels to monitor                                                                      |
| `KARAKEEP_API_URL`                            | yes      | Base URL of your Karakeep instance                                                                              |
| `KARAKEEP_API_KEY`                            | yes      | Karakeep API key                                                                                                |
| `AWS_REGION`                                  | no       | Bedrock region (default: `eu-west-1`)                                                                           |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | no       | AWS credentials (or use `AWS_PROFILE` / instance role)                                                          |
| `BLOCKED_DOMAINS`                             | no       | Extra comma-separated domains to ignore, merged with the built-in list                                          |
| `CLASSIFY_SYSTEM_PROMPT`                      | no       | Override the LLM system prompt used for classification (default prompt is tuned for software engineering teams) |

### Blocklist

A set of domains is filtered out before classification. The built-in list includes common internal/project management tools. You can extend it at runtime via the `BLOCKED_DOMAINS` env var, or edit `src/config.ts` to change the defaults.

## Running

```bash
# Development (runs TypeScript directly, reads .env automatically)
yarn dev

# Production
yarn build
yarn start
```

## Deployment

The bot is a single long-lived process. Run it anywhere you can run a Node.js container. Working Dockerfile provided.

For AWS ECS, pass credentials via a task IAM role rather than environment variables — the AWS SDK will pick them up automatically through the default credential provider chain.

## Tech stack

- [discord.js](https://discord.js.org/) v14
- [Vercel AI SDK](https://sdk.vercel.ai/) with `@ai-sdk/amazon-bedrock`
- [cheerio](https://cheerio.js.org/) for HTML metadata parsing
- [Zod](https://zod.dev/) for LLM output validation
- TypeScript 5, Node.js 20+
