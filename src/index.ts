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
const UPSCALE_MODES = ["standard", "generative", "bloom"] as const;
const UPSCALE_OUTPUT_FORMATS = ["png", "jpg", "webp"] as const;
const UPSCALE_SUBJECT_DETECTION = ["All", "Foreground", "Background"] as const;
const UPSCALE_STANDARD_MODELS = [
  "Standard V2",
  "Low Resolution V2",
  "CGI",
  "High Fidelity V2",
  "Text Refine"
] as const;
const UPSCALE_GENERATIVE_MODELS = ["Redefine", "Recovery", "Recovery V2", "Reimagine"] as const;

type UpscaleMode = (typeof UPSCALE_MODES)[number];

type GenerateInput = {
  model: ModelKey;
  prompt: string;
  width?: number;
  height?: number;
  seed?: number;
  batch_size?: number;
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

type UpscaleInput = {
  mode?: UpscaleMode;
  image_url: string;
  width: number;
  height: number;
  model?: string;
  batch_size?: number;
  seed?: number;
  prompt?: string;
  output_format?: (typeof UPSCALE_OUTPUT_FORMATS)[number];
  subject_detection?: (typeof UPSCALE_SUBJECT_DETECTION)[number];
  face_enhancement?: boolean;
  face_enhancement_creativity?: number;
  face_enhancement_strength?: number;
  crop_to_fill?: boolean;
  upscaling_activated?: boolean;
  image_scaling_factor?: number;
  sharpen?: number;
  denoise?: number;
  fix_compression?: number;
  strength?: number;
  creativity?: number;
  texture?: number;
  detail?: number;
  face_preservation?: boolean;
  color_preservation?: boolean;
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
  "krea_upscale_image",
  {
    title: "Upscale and enhance image with Krea",
    description:
      "Upscales and enhances an image using Krea Topaz enhance endpoints (standard, generative, bloom).",
    inputSchema: {
      mode: z.enum(UPSCALE_MODES).default("standard"),
      image_url: z.string().url(),
      width: z.number().int().min(1).max(32000),
      height: z.number().int().min(1).max(32000),
      model: z.string().optional(),
      batch_size: z.number().int().min(1).max(4).optional(),
      seed: z.number().int().min(0).optional(),
      prompt: z.string().optional(),
      output_format: z.enum(UPSCALE_OUTPUT_FORMATS).optional(),
      subject_detection: z.enum(UPSCALE_SUBJECT_DETECTION).optional(),
      face_enhancement: z.boolean().optional(),
      face_enhancement_creativity: z.number().min(0).max(1).optional(),
      face_enhancement_strength: z.number().min(0).max(1).optional(),
      crop_to_fill: z.boolean().optional(),
      upscaling_activated: z.boolean().optional(),
      image_scaling_factor: z.number().min(1).max(32).optional(),
      sharpen: z.number().min(0).max(1).optional(),
      denoise: z.number().min(0).max(1).optional(),
      fix_compression: z.number().min(0).max(1).optional(),
      strength: z.number().min(0.01).max(1).optional(),
      creativity: z.number().int().min(1).max(9).optional(),
      texture: z.number().int().min(1).max(5).optional(),
      detail: z.number().min(0).max(1).optional(),
      face_preservation: z.boolean().optional(),
      color_preservation: z.boolean().optional(),
      wait_for_completion: z.boolean().default(true),
      poll_interval_ms: z.number().int().min(500).max(10000).default(DEFAULT_POLL_INTERVAL_MS),
      timeout_ms: z.number().int().min(5000).max(600000).default(DEFAULT_TIMEOUT_MS)
    }
  },
  async (rawInput: UpscaleInput) => {
    const input: UpscaleInput = {
      ...rawInput,
      mode: rawInput.mode ?? "standard",
      wait_for_completion: rawInput.wait_for_completion ?? true,
      poll_interval_ms: rawInput.poll_interval_ms ?? DEFAULT_POLL_INTERVAL_MS,
      timeout_ms: rawInput.timeout_ms ?? DEFAULT_TIMEOUT_MS
    };

    const { endpoint, mode, normalizedModel, payload } = buildUpscaleRequest(input);
    const client = KreaClient.fromEnv();

    const createResponse = await client.generateImage(endpoint, payload);
    const createJob = pickJob(createResponse);
    const jobId = readString(createJob, "id") ?? readString(createJob, "job_id");

    if (!jobId) {
      const details = stringifyUnknown(createResponse);
      throw new Error(`Krea response does not include job id. Response: ${details}`);
    }

    if (!input.wait_for_completion) {
      const initialStatus = normalizeStatus(readString(createJob, "status"));
      const output = {
        mode,
        model: normalizedModel,
        endpoint,
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
            text: `Upscale job ${jobId} created with status: ${initialStatus}.`
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

    const imageUrls = extractHttpUrls(readUnknown(finalJobResult.job, "result"));
    const status = normalizeStatus(readString(finalJobResult.job, "status"));
    const error = readUnknown(finalJobResult.job, "error");

    const summaryLines = [
      `Mode: ${mode}`,
      `Model: ${normalizedModel}`,
      `Endpoint: ${endpoint}`,
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
      mode,
      model: normalizedModel,
      endpoint,
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
      batch_size: z.number().int().min(1).max(8).optional(),
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
    const jobId = readString(createJob, "id") ?? readString(createJob, "job_id");

    if (!jobId) {
      const details = stringifyUnknown(createResponse);
      throw new Error(`Krea response does not include job id. Response: ${details}`);
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

    const imageUrls = extractHttpUrls(readUnknown(finalJobResult.job, "result"));
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

  const size = parseSize(input.size);

  if (input.width !== undefined) {
    payload.width = input.width;
  } else if (size?.width !== undefined) {
    payload.width = size.width;
  } else if (model.requiredFields.includes("width") && model.defaultWidth !== undefined) {
    payload.width = model.defaultWidth;
  }

  if (input.height !== undefined) {
    payload.height = input.height;
  } else if (size?.height !== undefined) {
    payload.height = size.height;
  } else if (model.requiredFields.includes("height") && model.defaultHeight !== undefined) {
    payload.height = model.defaultHeight;
  }

  if (input.seed !== undefined) {
    payload.seed = input.seed;
  }
  if (input.batch_size !== undefined) {
    payload.batchSize = input.batch_size;
  }
  if (input.guidance_scale !== undefined) {
    if (input.model === "qwen_image") {
      payload.cfg_scale = input.guidance_scale;
    } else {
      payload.guidance_scale_flux = input.guidance_scale;
    }
  }
  if (input.num_inference_steps !== undefined) {
    if (input.model === "qwen_image") {
      payload.num_inference_steps = input.num_inference_steps;
    } else {
      payload.steps = input.num_inference_steps;
    }
  }
  if (input.negative_prompt !== undefined && input.model === "qwen_image") {
    payload.negative_prompt = input.negative_prompt;
  }
  if (input.style !== undefined) {
    payload.styles = [input.style];
  }
  if (input.reference_image !== undefined) {
    payload.styleImages = [input.reference_image];
  }
  if (input.reference_images !== undefined) {
    payload.referenceImages = input.reference_images;
  }
  if (input.image_url !== undefined) {
    payload.imageUrl = input.image_url;
  }

  return payload;
}

function buildUpscaleRequest(input: UpscaleInput): {
  mode: UpscaleMode;
  endpoint: string;
  normalizedModel: string;
  payload: Record<string, unknown>;
} {
  const mode = input.mode ?? "standard";
  const endpoint =
    mode === "standard"
      ? "/generate/enhance/topaz/standard-enhance"
      : mode === "generative"
        ? "/generate/enhance/topaz/generative-enhance"
        : "/generate/enhance/topaz/bloom-enhance";

  const maxDimension = mode === "bloom" ? 10000 : 32000;
  if (input.width > maxDimension || input.height > maxDimension) {
    throw new Error(
      `Mode ${mode} supports up to ${maxDimension}x${maxDimension}. Received ${input.width}x${input.height}.`
    );
  }

  const normalizedModel = resolveUpscaleModel(mode, input.model);
  const payload: Record<string, unknown> = {
    width: input.width,
    height: input.height,
    image_url: input.image_url,
    model: normalizedModel
  };

  if (input.batch_size !== undefined) {
    payload.batchSize = input.batch_size;
  }
  if (input.seed !== undefined) {
    payload.seed = input.seed;
  }
  if (input.prompt !== undefined) {
    payload.prompt = input.prompt;
  }
  if (input.output_format !== undefined) {
    payload.output_format = input.output_format;
  }
  if (input.crop_to_fill !== undefined) {
    payload.crop_to_fill = input.crop_to_fill;
  }
  if (input.upscaling_activated !== undefined) {
    payload.upscaling_activated = input.upscaling_activated;
  }
  if (input.image_scaling_factor !== undefined) {
    payload.image_scaling_factor = input.image_scaling_factor;
  }
  if (input.sharpen !== undefined) {
    if (mode === "bloom") {
      throw new Error("sharpen is not supported in bloom mode.");
    }
    payload.sharpen = input.sharpen;
  }
  if (input.denoise !== undefined) {
    if (mode === "bloom") {
      throw new Error("denoise is not supported in bloom mode.");
    }
    payload.denoise = input.denoise;
  }
  if (input.subject_detection !== undefined) {
    if (mode === "bloom") {
      throw new Error("subject_detection is not supported in bloom mode.");
    }
    payload.subject_detection = input.subject_detection;
  }
  if (input.face_enhancement !== undefined) {
    if (mode === "bloom") {
      throw new Error("face_enhancement is not supported in bloom mode.");
    }
    payload.face_enhancement = input.face_enhancement;
  }
  if (input.face_enhancement_creativity !== undefined) {
    if (mode === "bloom") {
      throw new Error("face_enhancement_creativity is not supported in bloom mode.");
    }
    payload.face_enhancement_creativity = input.face_enhancement_creativity;
  }
  if (input.face_enhancement_strength !== undefined) {
    if (mode === "bloom") {
      throw new Error("face_enhancement_strength is not supported in bloom mode.");
    }
    payload.face_enhancement_strength = input.face_enhancement_strength;
  }
  if (input.strength !== undefined) {
    if (mode !== "standard") {
      throw new Error("strength is only supported in standard mode.");
    }
    payload.strength = input.strength;
  }
  if (input.fix_compression !== undefined) {
    if (mode !== "standard") {
      throw new Error("fix_compression is only supported in standard mode.");
    }
    payload.fix_compression = input.fix_compression;
  }
  if (input.texture !== undefined) {
    if (mode !== "generative") {
      throw new Error("texture is only supported in generative mode.");
    }
    payload.texture = input.texture;
  }
  if (input.detail !== undefined) {
    if (mode !== "generative") {
      throw new Error("detail is only supported in generative mode.");
    }
    payload.detail = input.detail;
  }
  if (input.creativity !== undefined) {
    if (mode === "standard") {
      throw new Error("creativity is only supported in generative or bloom mode.");
    }
    if (mode === "generative" && input.creativity > 6) {
      throw new Error("generative mode supports creativity from 1 to 6.");
    }
    payload.creativity = input.creativity;
  }
  if (input.face_preservation !== undefined) {
    if (mode !== "bloom") {
      throw new Error("face_preservation is only supported in bloom mode.");
    }
    payload.face_preservation = input.face_preservation;
  }
  if (input.color_preservation !== undefined) {
    if (mode !== "bloom") {
      throw new Error("color_preservation is only supported in bloom mode.");
    }
    payload.color_preservation = input.color_preservation;
  }

  return { mode, endpoint, normalizedModel, payload };
}

function resolveUpscaleModel(mode: UpscaleMode, model: string | undefined): string {
  if (mode === "standard") {
    const selected = model ?? "Standard V2";
    if (!UPSCALE_STANDARD_MODELS.includes(selected as (typeof UPSCALE_STANDARD_MODELS)[number])) {
      throw new Error(`Invalid standard model "${selected}".`);
    }
    return selected;
  }

  if (mode === "generative") {
    const selected = model ?? "Redefine";
    if (!UPSCALE_GENERATIVE_MODELS.includes(selected as (typeof UPSCALE_GENERATIVE_MODELS)[number])) {
      throw new Error(`Invalid generative model "${selected}".`);
    }
    return selected;
  }

  const selected = model ?? "Reimagine";
  if (selected !== "Reimagine") {
    throw new Error('Bloom mode supports only model "Reimagine".');
  }
  return selected;
}

function parseSize(size: string | undefined): { width: number; height: number } | undefined {
  if (!size) {
    return undefined;
  }
  const match = /^([1-9][0-9]*)x([1-9][0-9]*)$/.exec(size);
  if (!match) {
    return undefined;
  }
  return {
    width: Number(match[1]),
    height: Number(match[2])
  };
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
