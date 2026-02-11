#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod/v4";
import {
  describeRequiredFields,
  KREA_IMAGE_MODELS,
  MODEL_KEYS,
  type ModelDefinition,
  type ModelKey
} from "./models.js";
import {
  extractHttpUrls,
  isTerminalStatus,
  KreaClient,
  normalizeStatus,
  sleep,
  stringifyUnknown
} from "./kreaClient.js";

const DEFAULT_POLL_INTERVAL_MS = 2000;
const DEFAULT_TIMEOUT_MS = 180000;

type GenerateInput = {
  model: ModelKey;
  prompt: string;
  width?: number;
  height?: number;
  seed?: number;
  guidance_scale?: number;
  num_inference_steps?: number;
  negative_prompt?: string;
  size?: string;
  style?: string;
  reference_image?: string;
  reference_images?: string[];
  image_url?: string;
  sync_mode?: boolean;
  wait_for_completion?: boolean;
  poll_interval_ms?: number;
  timeout_ms?: number;
};

const server = new McpServer({
  name: "krea-image-generator",
  version: "0.1.0"
});

server.registerTool(
  "krea_list_models",
  {
    title: "List Krea image models",
    description: "Returns the supported Krea image generation models and their required fields.",
    inputSchema: {}
  },
  async () => {
    const models = MODEL_KEYS.map((key) => {
      const model = KREA_IMAGE_MODELS[key] as ModelDefinition;
      return {
        key,
        title: model.title,
        endpoint: model.endpoint,
        required_fields: model.requiredFields,
        notes: model.notes ?? null
      };
    });

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(models, null, 2)
        }
      ],
      structuredContent: { models }
    };
  }
);

server.registerTool(
  "krea_generate_image",
  {
    title: "Generate image with Krea",
    description: "Generates an image using Krea API with selectable model and optional polling until completion.",
    inputSchema: {
      model: z.enum(MODEL_KEYS).describe("Model key from krea_list_models."),
      prompt: z.string().min(1),
      width: z.number().int().min(256).max(4096).optional(),
      height: z.number().int().min(256).max(4096).optional(),
      seed: z.number().int().min(0).optional(),
      guidance_scale: z.number().positive().optional(),
      num_inference_steps: z.number().int().positive().optional(),
      negative_prompt: z.string().optional(),
      size: z.string().regex(/^[1-9][0-9]*x[1-9][0-9]*$/).optional(),
      style: z.string().optional(),
      reference_image: z.string().url().optional(),
      reference_images: z.array(z.string().url()).min(1).optional(),
      image_url: z.string().url().optional(),
      sync_mode: z.boolean().optional(),
      wait_for_completion: z.boolean().default(true),
      poll_interval_ms: z.number().int().min(500).max(10000).default(DEFAULT_POLL_INTERVAL_MS),
      timeout_ms: z.number().int().min(5000).max(600000).default(DEFAULT_TIMEOUT_MS)
    }
  },
  async (rawInput: GenerateInput) => {
    const input: GenerateInput = {
      ...rawInput,
      wait_for_completion: rawInput.wait_for_completion ?? true,
      poll_interval_ms: rawInput.poll_interval_ms ?? DEFAULT_POLL_INTERVAL_MS,
      timeout_ms: rawInput.timeout_ms ?? DEFAULT_TIMEOUT_MS
    };

    const model = KREA_IMAGE_MODELS[input.model] as ModelDefinition;
    validateInputByModel(input, model);

    const payload = buildPayload(input, model);
    const client = KreaClient.fromEnv();

    const createResponse = await client.generateImage(model.endpoint, payload);
    const createJob = pickJob(createResponse);
    const jobId = readString(createJob, "id");

    if (!jobId) {
      const details = stringifyUnknown(createResponse);
      throw new Error(`Krea response does not include job.id. Response: ${details}`);
    }

    if (!input.wait_for_completion) {
      const initialStatus = normalizeStatus(readString(createJob, "status"));
      const output = {
        model: input.model,
        endpoint: model.endpoint,
        payload_sent: payload,
        job_id: jobId,
        status: initialStatus,
        wait_for_completion: false,
        create_response: createResponse
      };

      return {
        content: [
          {
            type: "text",
            text: `Job ${jobId} created with status: ${initialStatus}.`
          }
        ],
        structuredContent: output
      };
    }

    const pollIntervalMs = input.poll_interval_ms ?? DEFAULT_POLL_INTERVAL_MS;
    const timeoutMs = input.timeout_ms ?? DEFAULT_TIMEOUT_MS;

    const finalJobResult = await waitForJobCompletion(client, jobId, {
      initialJob: createJob,
      pollIntervalMs,
      timeoutMs
    });

    const imageUrls = extractHttpUrls(readUnknown(finalJobResult.job, "data", "output"));
    const status = normalizeStatus(readString(finalJobResult.job, "status"));
    const error = readUnknown(finalJobResult.job, "error");

    const summaryLines = [
      `Model: ${input.model} (${model.title})`,
      `Endpoint: ${model.endpoint}`,
      `Job ID: ${jobId}`,
      `Status: ${status}`
    ];
    if (imageUrls.length > 0) {
      summaryLines.push(`Images: ${imageUrls.join(", ")}`);
    }
    if (error) {
      summaryLines.push(`Error: ${stringifyUnknown(error)}`);
    }

    const output = {
      model: input.model,
      endpoint: model.endpoint,
      payload_sent: payload,
      job_id: jobId,
      status,
      image_urls: imageUrls,
      error,
      final_job: finalJobResult.job,
      final_job_response: finalJobResult.rawResponse
    };

    return {
      content: [{ type: "text", text: summaryLines.join("\n") }],
      structuredContent: output
    };
  }
);

async function waitForJobCompletion(
  client: KreaClient,
  jobId: string,
  options: {
    initialJob: unknown;
    pollIntervalMs: number;
    timeoutMs: number;
  }
): Promise<{ job: Record<string, unknown>; rawResponse: unknown }> {
  const initialJob = asObject(options.initialJob) ?? {};
  const initialStatus = normalizeStatus(readString(initialJob, "status"));
  if (isTerminalStatus(initialStatus)) {
    return { job: initialJob, rawResponse: { job: initialJob } };
  }

  const deadline = Date.now() + options.timeoutMs;
  while (Date.now() < deadline) {
    const rawResponse = await client.getJob(jobId);
    const job = pickJob(rawResponse);
    const status = normalizeStatus(readString(job, "status"));
    if (isTerminalStatus(status)) {
      return { job, rawResponse };
    }
    await sleep(options.pollIntervalMs);
  }

  throw new Error(`Job ${jobId} did not reach a terminal status within ${options.timeoutMs}ms.`);
}

function validateInputByModel(input: GenerateInput, model: ModelDefinition): void {
  const missing: string[] = [];

  for (const field of model.requiredFields) {
    if (field === "prompt") {
      continue;
    }
    if (field === "width" && input.width === undefined && model.defaultWidth === undefined) {
      missing.push("width");
    }
    if (field === "height" && input.height === undefined && model.defaultHeight === undefined) {
      missing.push("height");
    }
    if (field === "referenceImages" && (!input.reference_images || input.reference_images.length === 0)) {
      missing.push("reference_images");
    }
    if (field === "imageUrl" && !input.image_url) {
      missing.push("image_url");
    }
  }

  if (missing.length > 0) {
    throw new Error(
      `Missing required fields for model ${input.model}: ${missing.join(", ")}. ` +
        `Model requires: ${describeRequiredFields(model.requiredFields)}`
    );
  }
}

function buildPayload(input: GenerateInput, model: ModelDefinition): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    ...(model.fixedPayload ?? {}),
    prompt: input.prompt
  };

  if (input.width !== undefined) {
    payload.width = input.width;
  } else if (model.requiredFields.includes("width") && model.defaultWidth !== undefined) {
    payload.width = model.defaultWidth;
  }

  if (input.height !== undefined) {
    payload.height = input.height;
  } else if (model.requiredFields.includes("height") && model.defaultHeight !== undefined) {
    payload.height = model.defaultHeight;
  }

  if (input.seed !== undefined) {
    payload.seed = input.seed;
  }
  if (input.guidance_scale !== undefined) {
    payload.guidance_scale = input.guidance_scale;
  }
  if (input.num_inference_steps !== undefined) {
    payload.num_inference_steps = input.num_inference_steps;
  }
  if (input.negative_prompt !== undefined) {
    payload.negative_prompt = input.negative_prompt;
  }
  if (input.size !== undefined) {
    payload.size = input.size;
  }
  if (input.style !== undefined) {
    payload.style = input.style;
  }
  if (input.reference_image !== undefined) {
    payload.referenceImage = input.reference_image;
  }
  if (input.reference_images !== undefined) {
    payload.referenceImages = input.reference_images;
  }
  if (input.image_url !== undefined) {
    payload.imageUrl = input.image_url;
  }
  if (input.sync_mode !== undefined) {
    payload.sync_mode = input.sync_mode;
  }

  return payload;
}

function pickJob(rawResponse: unknown): Record<string, unknown> {
  if (rawResponse && typeof rawResponse === "object") {
    const asRecord = rawResponse as Record<string, unknown>;
    if (asRecord.job && typeof asRecord.job === "object") {
      return asRecord.job as Record<string, unknown>;
    }
    return asRecord;
  }
  return {};
}

function readUnknown(obj: unknown, ...path: string[]): unknown {
  let current: unknown = obj;
  for (const key of path) {
    if (!current || typeof current !== "object") {
      return undefined;
    }
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function readString(obj: unknown, ...path: string[]): string | undefined {
  const value = readUnknown(obj, ...path);
  return typeof value === "string" ? value : undefined;
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(message);
  process.exit(1);
});
