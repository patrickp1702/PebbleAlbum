<script setup lang="ts">
/**
 * AiConnectModal.vue — "Connect AI" panel. Shows the MCP client config the user
 * pastes into their AI agent (Claude, etc.) to connect this app's MCP server,
 * plus a ready-made starter prompt. The agent then uses the PebbleAlbum MCP
 * tools to design the album, editing the same .pebble file this app opens.
 */
import { ref, watch, computed } from 'vue';
import { useProjectStore } from '@/stores/projectStore';
import { useAppStore } from '@/stores/appStore';
import type { McpConnectInfo } from '@shared/ipc.types';
import AppModal from '@/components/ui/AppModal.vue';
import AppButton from '@/components/ui/AppButton.vue';

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ (e: 'update:open', v: boolean): void }>();

const project = useProjectStore();
const app = useAppStore();
const info = ref<McpConnectInfo | null>(null);
const loading = ref(false);

const projectName = computed(() => project.meta?.name || 'your project');
const fill = (t?: string) => (t || '').replaceAll('{{PROJECT}}', projectName.value);
const promptFast = computed(() => fill(info.value?.promptFast));
const promptDeep = computed(() => fill(info.value?.promptDeep));

watch(() => props.open, async (o) => {
  if (!o || info.value) return;
  loading.value = true;
  try { info.value = await window.pebble.getMcpConnectInfo(); }
  catch (e) { app.toast(`Could not load MCP config: ${(e as Error).message}`, 'error'); }
  finally { loading.value = false; }
});

async function copy(text: string, label: string) {
  try {
    if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
    else {
      const ta = document.createElement('textarea');
      ta.value = text; document.body.appendChild(ta); ta.select();
      document.execCommand('copy'); document.body.removeChild(ta);
    }
    app.toast(`${label} copied to clipboard`, 'success', 1800);
  } catch { app.toast('Copy failed — select and copy manually', 'error'); }
}
function revealServer() { if (info.value) window.pebble.revealInExplorer(info.value.serverPath); }
</script>

<template>
  <AppModal :open="open" title="Connect an AI agent" @update:open="emit('update:open', $event)">
    <div class="space-y-4 text-sm max-w-2xl">
      <p class="text-pebble-text-dim">
        Let an AI agent (e.g. Claude) design this album for you. It connects to PebbleAlbum's
        built-in <b>MCP server</b> and uses tools to edit pages, layouts, photos, borders, patterns,
        stickers and text — then it can view low-res renders to check its work. Your edits appear
        here when you reload the project.
      </p>

      <div v-if="loading" class="text-pebble-text-dim">Loading…</div>

      <template v-else-if="info">
        <!-- Step 1: config -->
        <div>
          <div class="flex items-center justify-between mb-1">
            <div class="text-[11px] uppercase tracking-wider text-pebble-text-dim">1 · Add this MCP server to your agent</div>
            <AppButton size="sm" @click="copy(info.configJson, 'Config')">Copy config</AppButton>
          </div>
          <pre class="pa-code max-h-52 overflow-auto text-[11px] leading-relaxed">{{ info.configJson }}</pre>
          <p class="text-[10px] text-pebble-text-dim mt-1">
            Requires <b>Node.js</b> installed (the <code>node</code> command). Paste into your agent's MCP
            settings. <button class="underline hover:text-pebble-accent" @click="revealServer">Show server file</button>
          </p>
        </div>

        <!-- Step 2: pick a prompt -->
        <div>
          <div class="text-[11px] uppercase tracking-wider text-pebble-text-dim mb-1">2 · Give your agent a prompt — pick one</div>

          <div class="rounded border border-pebble-border p-2 mb-2">
            <div class="flex items-center justify-between mb-1">
              <div class="text-xs"><b>⚡ Fast completion</b> <span class="text-pebble-text-dim">— efficient, fewest tool calls</span></div>
              <AppButton size="sm" @click="copy(promptFast, 'Fast prompt')">Copy</AppButton>
            </div>
            <pre class="pa-code max-h-40 overflow-auto whitespace-pre-wrap text-[11px] leading-relaxed">{{ promptFast }}</pre>
          </div>

          <div class="rounded border border-pebble-border p-2">
            <div class="flex items-center justify-between mb-1">
              <div class="text-xs"><b>🔬 Deep analysis &amp; complete</b> <span class="text-pebble-text-dim">— magazine-quality, thorough</span></div>
              <AppButton size="sm" @click="copy(promptDeep, 'Deep prompt')">Copy</AppButton>
            </div>
            <pre class="pa-code max-h-40 overflow-auto whitespace-pre-wrap text-[11px] leading-relaxed">{{ promptDeep }}</pre>
          </div>
        </div>

        <p class="text-[11px] text-pebble-text-dim">
          3 · The agent will design <b>{{ projectName }}</b>. When it's done, <b>reload the project</b>
          here to see the result. Projects live in <code>{{ info.projectsFolder }}</code>.
        </p>
      </template>
    </div>
  </AppModal>
</template>
