import { generateObject } from "ai";
import { createAmazonBedrock } from "@ai-sdk/amazon-bedrock";
import { fromNodeProviderChain } from "@aws-sdk/credential-providers";
import { z } from "zod";
import { config } from "../config.js";
import type { UrlMetadata } from "./metadata.js";
import { error } from "console";

export interface ClassifyResult {
  interesting: boolean;
  reason: string;
  error?: any;
}

const bedrock = createAmazonBedrock({
  region: config.awsRegion,
  credentialProvider: fromNodeProviderChain(),
});

const BEDROCK_MODEL = "eu.anthropic.claude-haiku-4-5-20251001-v1:0";

const schema = z.object({
  interesting: z.boolean(),
  reason: z.string(),
  error: z.string().optional(),
});

export async function classify(metadata: UrlMetadata): Promise<ClassifyResult> {
  try {
    const { object } = await generateObject({
      model: bedrock(BEDROCK_MODEL),
      schema,
      temperature: 0,
      maxTokens: 300,
      system: "You are a link triage assistant for a software engineering team.",
      prompt: `Decide if this URL is worth bookmarking for a software engineer interested in:
cloud infrastructure, DevOps, backend development, Rust, Ruby/Rails, AWS,
distributed systems, open source tooling, tech industry news, programmer humor, team building,
agile practices, patterns, strategies, architectures, and other things you would find interesting as
a developer, or it engineer, or cloud architect, or manager, or designer in a small friendly sw dev company.

URL metadata:
${JSON.stringify(metadata, null, 2)}`,
    });
    return object;
  } catch (error) {
    console.error("Error during classification:", error);
    return { interesting: false, reason: "classification failed", error };
  }
}
