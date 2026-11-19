# PebbleAlbum MCP Server

`pebble-mcp-server.mjs` is a standalone [Model Context Protocol](https://modelcontextprotocol.io)
server that lets an external AI agent design PebbleAlbum projects. It speaks
MCP over **stdio** (newline-delimited JSON-RPC 2.0) and depends only on Node
built-ins + `sharp` (already in the app's `node_modules`).

It operates directly on the `.pebble` JSON files in `~/Documents/Pebble` — the
exact files the desktop app reads/writes — so anything the agent builds shows up
in the app when the project is reloaded.

## How a user connects it

In the app: **open a project → top bar → 🤖 Connect AI**. That panel gives you:

1. **MCP config JSON** to paste into your agent (Claude, etc.):
   ```json
   {
     "mcpServers": {
       "pebble-album": {
         "command": "node",
         "args": ["/abs/path/to/mcp/pebble-mcp-server.mjs"],
         "env": { "PEBBLE_HOME": "…/Documents/Pebble", "PEBBLE_APP_ROOT": "…" }
       }
     }
   }
   ```
   (Requires Node.js installed.)
2. A **starter prompt** that tells the agent to read the skills and design the
   open project.

## Tools (51)

- **Discovery:** `pebble_guide`, `list_skills`, `read_skill`, `list_projects`,
  `get_project`, `get_page`, `list_images`, `list_catalog`.
- **Vision (low-cost JPEGs):** `render_page`, `view_image`.
- **Pages:** `add_page`, `delete_page`, `duplicate_page`, `move_page`, `update_page`.
- **Images:** `place_image` (`free:true` = "Add photo" overlay), `update_image` (geometry + filter presets w/ strength +
  adjust sliders: exposure/brightness/contrast/highlights/shadows/saturation/
  temperature/tint/hue/sharpness/blur/grain/vignette), `set_image_mask` (shape
  crop), `set_image_border`, `set_image_shadow`, `remove_image`, `swap_images`, `erase_image_region` / `clear_image_erase`
  (non-destructive eraser; masks go to `<sourceFolder>/.pebble_masks/`).
- **Decorations:** `add_pattern`, `add_sticker`, `remove_decoration`.
- **Text/proverbs:** `add_text`, `add_proverb`, `update_text`, `remove_text`.
- **Album:** `set_theme`, `update_album`.
- …plus culling, collage, cutout (`remove_background`) and utility tools — call
  `tools/list` for the full set of 51.

Every edit tool loads the `.pebble`, mutates it, and saves immediately (+ `.bak`).
Render tools return small JPEGs (default ≤640px, q62 — a page is ~5–80 KB) so the
model can *see* its work without large token cost.

## Skills

`skills/*.md` teach the agent the app's purpose, workflow, the filename-label
system, and the catalogs. The agent fetches them via `read_skill`.

## Env vars

| Var | Purpose | Default |
|---|---|---|
| `PEBBLE_HOME` | Projects folder | `~/Documents/Pebble` |
| `PEBBLE_APP_ROOT` | App root (finds `src/config`, `assets`) | parent of `mcp/` |
| `PEBBLE_CONFIG_DIR` | Override config dir (packaged builds) | `<root>/src/config` |
| `PEBBLE_ASSETS_DIR` | Override assets dir (packaged builds) | `<root>/assets` |
| `PEBBLE_SKILLS_DIR` | Override skills dir | `mcp/skills` |

## Run manually (debug)

```bash
PEBBLE_HOME=~/Documents/Pebble node mcp/pebble-mcp-server.mjs
# then send newline-delimited JSON-RPC on stdin, e.g.:
# {"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{}}}
# {"jsonrpc":"2.0","id":2,"method":"tools/list"}
```
Logs go to **stderr**; stdout is reserved for protocol messages.
