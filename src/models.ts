export type RequiredField = "prompt" | "width" | "height" | "referenceImages" | "imageUrl";

export interface ModelDefinition {
  title: string;
  endpoint: string;
  requiredFields: RequiredField[];
  fixedPayload?: Record<string, unknown>;
  defaultWidth?: number;
  defaultHeight?: number;
  notes?: string;
}

export const KREA_IMAGE_MODELS = {
  flux_1_dev: {
    title: "BFL Flux 1 Dev",
    endpoint: "/generate/image/bfl/flux-1-dev",
    requiredFields: ["prompt"],
    notes: "General-purpose text-to-image model."
  },
  flux_kontext_max: {
    title: "BFL Flux 1 Kontext Dev",
    endpoint: "/generate/image/bfl/flux-1-kontext-dev",
    requiredFields: ["prompt"],
    notes: "Uses the current Kontext endpoint from Krea OpenAPI."
  },
  nano_banana_pro: {
    title: "Google Nano Banana Pro",
    endpoint: "/generate/image/google/nano-banana-pro",
    requiredFields: ["prompt"]
  },
  nano_banana: {
    title: "Google Nano Banana",
    endpoint: "/generate/image/google/nano-banana",
    requiredFields: ["prompt"]
  },
  flux_1_1_pro: {
    title: "BFL Flux 1.1 Pro",
    endpoint: "/generate/image/bfl/flux-1.1-pro",
    requiredFields: ["prompt", "width", "height"],
    defaultWidth: 1024,
    defaultHeight: 1024
  },
  flux_1_1_pro_ultra: {
    title: "BFL Flux 1.1 Pro Ultra",
    endpoint: "/generate/image/bfl/flux-1.1-pro-ultra",
    requiredFields: ["prompt"]
  },
  ideogram_2a: {
    title: "Ideogram 2 Turbo",
    endpoint: "/generate/image/ideogram/ideogram-2-turbo",
    requiredFields: ["prompt"]
  },
  ideogram_3: {
    title: "Ideogram 3",
    endpoint: "/generate/image/ideogram/ideogram-3",
    requiredFields: ["prompt"],
    notes: "Supports optional style and referenceImage."
  },
  imagen_3: {
    title: "Google Imagen 3",
    endpoint: "/generate/image/google/imagen-3",
    requiredFields: ["prompt"]
  },
  imagen_4: {
    title: "Google Imagen 4",
    endpoint: "/generate/image/google/imagen-4",
    requiredFields: ["prompt"]
  },
  imagen_4_fast: {
    title: "Google Imagen 4 Fast",
    endpoint: "/generate/image/google/imagen-4-fast",
    requiredFields: ["prompt"]
  },
  imagen_4_ultra: {
    title: "Google Imagen 4 Ultra",
    endpoint: "/generate/image/google/imagen-4-ultra",
    requiredFields: ["prompt"]
  },
  runway_gen_4_image: {
    title: "Runway Gen-4 Image",
    endpoint: "/generate/image/runway/gen-4",
    requiredFields: ["prompt", "referenceImages"],
    notes: "Requires one or more reference image URLs."
  },
  chatgpt_image_1: {
    title: "OpenAI GPT Image",
    endpoint: "/generate/image/openai/gpt-image",
    requiredFields: ["prompt"]
  },
  seedream_3: {
    title: "Bytedance Seedream 3",
    endpoint: "/generate/image/bytedance/seedream-3",
    requiredFields: ["prompt"],
    fixedPayload: { model: "seedream-3" }
  },
  seedream_4: {
    title: "Bytedance Seedream 4",
    endpoint: "/generate/image/bytedance/seedream-4",
    requiredFields: ["prompt", "width", "height"],
    defaultWidth: 1024,
    defaultHeight: 1024
  },
  seededit_3: {
    title: "Bytedance Seededit 3",
    endpoint: "/generate/image/bytedance/seededit",
    requiredFields: ["prompt", "imageUrl"],
    notes: "Image-to-image endpoint that requires image_url."
  },
  qwen_image: {
    title: "Qwen Image",
    endpoint: "/generate/image/qwen/2512",
    requiredFields: ["prompt"]
  },
  zimage: {
    title: "ZAI ZImage",
    endpoint: "/generate/image/z-image/z-image",
    requiredFields: ["prompt", "width", "height"],
    defaultWidth: 1024,
    defaultHeight: 1024
  }
} as const satisfies Record<string, ModelDefinition>;

export const MODEL_KEYS = Object.keys(KREA_IMAGE_MODELS) as [keyof typeof KREA_IMAGE_MODELS, ...(keyof typeof KREA_IMAGE_MODELS)[]];

export type ModelKey = keyof typeof KREA_IMAGE_MODELS;

export function describeRequiredFields(requiredFields: RequiredField[]): string {
  if (requiredFields.length === 0) {
    return "none";
  }
  return requiredFields.join(", ");
}
