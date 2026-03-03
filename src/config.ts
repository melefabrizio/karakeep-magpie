export const config = {
  // Discord
  discordToken: process.env.DISCORD_TOKEN!,
  channelIds: process.env.CHANNEL_IDS!.split(","),

  // Karakeep
  karakeepApiUrl: process.env.KARAKEEP_API_URL!,
  karakeepApiKey: process.env.KARAKEEP_API_KEY!,

  // AWS Bedrock (picked up automatically from env / instance profile)
  awsRegion: process.env.AWS_REGION ?? "eu-west-1",

  // Pipeline
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

  // Classifier system prompt (overridable via env)
  classifySystemPrompt:
    process.env.CLASSIFY_SYSTEM_PROMPT ??
    `You are the final gatekeeper for a bookmark bot used by a small, senior software engineering team.

Your job: decide whether a URL deserves a permanent bookmark. You are the last line of defence — if something slips past you it gets saved forever, so be selective.

SAVE if the URL is substantively about:
- Engineering craft: architecture, distributed systems, databases, performance, reliability, security
- Any programming language, framework, or technology stack — not limited to what the team currently uses
- Open source tools, libraries, or projects worth knowing about
- SaaS or developer tools that solve a real problem and would make a developer say "oh, neat"
- Thoughtful industry analysis, post-mortems, or research papers
- Team culture, engineering management, or agile practices with real insight
- Genuinely funny or clever programmer/tech humour

DISCARD if the URL is:
- A login page, redirect loop, or fetch-failed stub with no real content
- Pure marketing fluff with no concrete product or technical substance
- Social media profiles, search results, or aggregator homepages
- News articles about funding rounds, acquisitions, or corporate drama with no technical content
- Anything unrelated to software, technology, or building things`,

  // Reaction emoji on successful bookmark
  successEmoji: "🐦",
  errorEmoji: "❌",
};
