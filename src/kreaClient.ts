const DEFAULT_BASE_URL = "https://api.krea.ai/v1";

export class KreaApiError extends Error {
  readonly status: number;
  readonly body: string;

  constructor(message: string, status: number, body: string) {
    super(message);
    this.name = "KreaApiError";
    this.status = status;
    this.body = body;
  }
}

export class KreaClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(apiKey: string, baseUrl = DEFAULT_BASE_URL) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
  }

  static fromEnv(): KreaClient {
    const apiKey = process.env.KREA_API_KEY;
    if (!apiKey) {
      throw new Error("KREA_API_KEY is not set.");
    }
    const baseUrl = process.env.KREA_API_BASE_URL ?? DEFAULT_BASE_URL;
    return new KreaClient(apiKey, baseUrl);
  }

  async generateImage(endpoint: string, payload: Record<string, unknown>): Promise<unknown> {
    return this.request(endpoint, {
      method: "POST",
      body: JSON.stringify(payload)
    });
  }

  async getJob(jobId: string): Promise<unknown> {
    return this.request(`/jobs/${encodeURIComponent(jobId)}`, { method: "GET" });
  }

  private async request(path: string, init: RequestInit): Promise<unknown> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        ...(init.headers ?? {})
      }
    });

    const bodyText = await response.text();
    let jsonBody: unknown = undefined;
    if (bodyText.trim().length > 0) {
      try {
        jsonBody = JSON.parse(bodyText);
      } catch {
        jsonBody = bodyText;
      }
    }

    if (!response.ok) {
      throw new KreaApiError(`Krea API error ${response.status}`, response.status, stringifyUnknown(jsonBody));
    }

    return jsonBody;
  }
}

export function normalizeStatus(status: unknown): string {
  if (typeof status !== "string") {
    return "unknown";
  }
  return status.toLowerCase();
}

export function isTerminalStatus(status: string): boolean {
  return status === "completed" || status === "failed" || status === "cancelled";
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function extractHttpUrls(value: unknown): string[] {
  const found = new Set<string>();
  const stack = [value];

  while (stack.length > 0) {
    const current = stack.pop();
    if (typeof current === "string") {
      if (looksLikeUrl(current)) {
        found.add(current);
      }
      continue;
    }
    if (Array.isArray(current)) {
      for (const item of current) {
        stack.push(item);
      }
      continue;
    }
    if (current && typeof current === "object") {
      for (const nested of Object.values(current as Record<string, unknown>)) {
        stack.push(nested);
      }
    }
  }

  return [...found];
}

export function stringifyUnknown(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function looksLikeUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}
