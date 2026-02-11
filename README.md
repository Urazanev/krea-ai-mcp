# Krea Image MCP Server (Node/TS)

Local MCP server for generating images through the Krea API.

## What this server provides

- `krea_list_models`: lists supported models and required fields.
- `krea_generate_image`: creates an image generation job for a selected model and optionally waits for completion.

Supported model keys:

- `flux_1_dev`
- `flux_kontext_max`
- `nano_banana_pro`
- `nano_banana`
- `flux_1_1_pro`
- `flux_1_1_pro_ultra`
- `ideogram_2a`
- `ideogram_3`
- `imagen_3`
- `imagen_4`
- `imagen_4_fast`
- `imagen_4_ultra`
- `runway_gen_4_image`
- `chatgpt_image_1`
- `seedream_3`
- `seedream_4`
- `seededit_3`
- `qwen_image`
- `zimage`

## Prerequisites

- Node.js `>=20`
- Krea API key from [Krea dashboard](https://www.krea.ai/settings/api)

## Install and run

```bash
npm install
npm run build
KREA_API_KEY=your_key_here npm start
```

For development:

```bash
KREA_API_KEY=your_key_here npm run dev
```

## MCP client configuration example (local path)

Use absolute paths for your machine:

```json
{
  "mcpServers": {
    "krea-images": {
      "command": "node",
      "args": ["/Users/master/projects/kreaMcp/dist/index.js"],
      "env": {
        "KREA_API_KEY": "your_krea_api_key_here"
      }
    }
  }
}
```

## MCP client configuration example (run directly from GitHub)

This is useful when your client (Arc) should pull server code from the repository URL:

```json
{
  "mcpServers": {
    "krea-images": {
      "command": "npx",
      "args": ["-y", "github:Urazanev/krea-ai-mcp"],
      "env": {
        "KREA_API_KEY": "your_krea_api_key_here"
      }
    }
  }
}
```

## Tool input notes

`krea_generate_image` main fields:

- `model` (required): one of model keys above
- `prompt` (required): generation prompt
- `wait_for_completion` (default `true`): if `true`, polls `/jobs/{id}` until terminal status
- `timeout_ms` (default `180000`)
- `poll_interval_ms` (default `2000`)

Common optional fields:

- `width`, `height`, `seed`
- `guidance_scale`, `num_inference_steps`, `negative_prompt`
- `size`, `style`
- `sync_mode`

Model-specific required fields:

- `runway_gen_4_image`: requires `reference_images` (array of URLs)
- `seededit_3`: requires `image_url`
- `flux_1_1_pro`, `seedream_4`, `zimage`: require dimensions (`width`, `height`)  
  If missing, the server defaults them to `1024x1024`.

## API references

- [Krea API introduction](https://docs.krea.ai/developers/introduction)
- [Krea OpenAPI](https://api.krea.ai/openapi.json)
