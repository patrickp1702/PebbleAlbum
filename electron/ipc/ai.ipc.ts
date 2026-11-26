/**
 * ai.ipc.ts
 * -----------------------------------------------------------------------------
 * Provides the "Connect AI" details: the MCP client config JSON the user pastes
 * into their AI agent, and a ready-made starter prompt. The PebbleAlbum MCP
 * server is a standalone Node script (mcp/pebble-mcp-server.mjs) that the agent
 * launches over stdio; it reads/writes the same ~/Documents/Pebble/*.pebble
 * files this app uses, so the agent can design albums that show up here.
 */
import { ipcMain, app } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { pebbleRoot } from './project.ipc';
import type { McpConnectInfo } from '../../src/types/ipc.types';

/** Locate the MCP server script in dev (app root) or packaged (resources). */
function resolveServerPath(): string {
  const candidates = [
    path.join(app.getAppPath(), 'mcp', 'pebble-mcp-server.mjs'),
    path.join(process.resourcesPath || '', 'mcp', 'pebble-mcp-server.mjs'),
  ];
  return candidates.find((p) => { try { return fs.existsSync(p); } catch { return false; } }) ?? candidates[0];
}

const PROMPT_FAST = `You are connected to my PebbleAlbum studio via its MCP server ("pebble-album"). Build a polished album for me QUICKLY and efficiently (keep tool calls low).

1. Call \`pebble_guide\`, then \`read_skill "pebble-gotchas"\`.
2. \`get_project { "project": "{{PROJECT}}" }\`, \`list_images\`, and \`list_catalog { "kind":"layouts", "project":"{{PROJECT}}" }\` (for slot orientation).
3. \`set_theme\` to fit the occasion. For each spread pick a VARIED layout (\`update_page\`) whose slot orientation matches the photos; photos auto-fill.
4. Style in bulk: \`set_page_image_style { "allPages":true, "preset":"matte_white" }\` (or a frame preset like "scallop_frame"); add ONE \`add_pattern\` per spread; a few \`add_sticker\` on the cover + celebration pages; \`add_proverb\` where it fits.
5. Verify with ONE \`render_album\`; then \`update_image { focusX, focusY }\` only the faces that look cropped; re-check with \`render_album\`.

Use batch tools + render_album (not per-image styling or per-page renders). Use only my photos; never stretch or over-crop.`;

const PROMPT_DEEP = `You are connected to my PebbleAlbum studio via its MCP server ("pebble-album"). Design a magazine-quality album — take your time and make it genuinely beautiful.

1. Call \`pebble_guide\`; \`read_skill\` for "pebble-workflow", "pebble-catalogs", and "pebble-gotchas".
2. \`get_project { "project": "{{PROJECT}}" }\`; \`list_images\`; \`view_image\` a representative sample to understand the story; \`list_catalog\` layouts (with project) for slot orientation.
3. Plan a narrative and a consistent occasion theme (\`set_theme\`).
4. Build each page deliberately, following the workflow skill's design-richness checklist:
   - varied layouts matched to photo orientation; **focal-crop every face** (\`update_image\` focusX/focusY/zoom);
   - **decorative frames** on hero shots, a tasteful **pattern or gradient/texture background** per spread, occasional **stickers** (birthday pack for birthdays);
   - proverbs/captions with **legibility** plates/outlines when over a photo; \`copy_image_style\` to stay consistent.
5. Verify EVERY page with \`render_page\` and refine until each is clean, face-safe, and richly but tastefully decorated.
6. Finish with \`render_album\`, then summarise what you made and tell me to reload the project.

Never stretch or over-crop; use only my photos. Prioritise quality over speed.`;

/** AI Enhance (Enhance studio → "Copy prompt"). Placeholders {{PROJECT}}, {{SCENE}},
 *  {{IDENTITY}}, {{COUNT}}, {{MAX_ATTEMPTS}} are filled by src/views/EnhanceView.vue.
 *  Tool names + thresholds must match mcp/skills/pebble-enhance.md. */
const PROMPT_ENHANCE = `You are connected to my PebbleAlbum studio via its MCP server ("pebble-album"). Task: AI-ENHANCE the queued photos of project "{{PROJECT}}" — change the scene / wardrobe / lighting as I describe, but keep every person's REAL face: the app composites the ORIGINAL face back onto the generated image and matches the skin tone, so your job is to get a variant whose pose, head angle and framing match the original.

Scene I want: {{SCENE}}

Identity rules (include them in EVERY generation prompt):
{{IDENTITY}}

Workflow — follow it exactly, keep previews small:
1. \`pebble_guide\`, then \`read_skill "pebble-enhance"\` (the loop, verdict thresholds, gotchas).
2. \`enhance_get_queue { "project": "{{PROJECT}}" }\` — {{COUNT}} queued photo(s) with status, earlier attempts and whether my image provider is configured. Skip items already \`done\`; stop and tell me if no provider is configured.
3. For each \`pending\` / \`review\` photo (treat a photo stuck in \`generating\` as \`pending\` — the agent before you was interrupted):
   a. Write the generation prompt: the scene above adapted to THIS photo (people count, pose, framing — \`enhance_view which:"source"\` if you need to look), plus the identity rules. Call \`enhance_generate { project, filename, prompt }\`. The app sends the full-resolution photo to my configured image API and returns a small preview plus face metrics (yawDiff / pitchDiff / rollDiff in degrees, similarity 0..1).
   b. Judge the variant: head angle must match (yawDiff and pitchDiff ≤ 8°, rollDiff ≤ 6°), framing similar, face detected, scene as requested. Use \`enhance_compare_faces\` when unsure. If it fails, refine the prompt (state the exact head direction, gaze, crop and how many people) and generate again — at most {{MAX_ATTEMPTS}} attempts per photo, then \`enhance_set_status { status: "failed", note }\` and move on.
   c. When a variant passes: \`enhance_composite { project, filename, variant }\` — the original face is aligned onto it and the skin tone matched. Check the returned blend crop: if the seam or tone shows, re-run with a larger \`feather\` (0.18–0.25) or a different \`toneMatch\`; if the face sits wrong, generate again instead.
4. Finish with \`enhance_get_queue\` and report: done / failed with the reason for each failure. Tell me to reload the project — the finals are registered as album photos under \`enhanced/\`.

Rules: never alter identity in your prompts; never exceed {{MAX_ATTEMPTS}} generations per photo; previews are deliberately low-res — do not request full-size images; do not touch album pages unless I ask. If an \`enhance_generate\` call times out, do NOT retry blindly: call \`enhance_get_queue\` first — the attempt usually landed and still counts.`;

export function registerAiIpc(): void {
  ipcMain.handle('ai:mcpConfig', (): McpConnectInfo => {
    const serverPath = resolveServerPath();
    const home = pebbleRoot();
    const command = 'node';
    const args = [serverPath];
    // A plain Node process can't read inside an asar; in a packaged build point
    // the server at the unpacked resources copies of config/assets/skills.
    const res = process.resourcesPath || '';
    const env: Record<string, string> = {
      PEBBLE_HOME: home,
      PEBBLE_APP_ROOT: app.getAppPath(),
      PEBBLE_CONFIG_DIR: app.isPackaged ? path.join(res, 'config') : path.join(app.getAppPath(), 'src', 'config'),
      PEBBLE_ASSETS_DIR: app.isPackaged ? path.join(res, 'assets') : path.join(app.getAppPath(), 'assets'),
      PEBBLE_SKILLS_DIR: path.join(path.dirname(serverPath), 'skills'),
    };
    const config = { mcpServers: { 'pebble-album': { command, args, env } } };
    return {
      serverPath,
      command,
      args,
      env,
      configJson: JSON.stringify(config, null, 2),
      promptFast: PROMPT_FAST,
      promptDeep: PROMPT_DEEP,
      promptEnhance: PROMPT_ENHANCE,
      projectsFolder: home,
    };
  });
}
