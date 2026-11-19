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
  <AppModal :open="open" title="Connect an AI agent" width="640px" @update:open="emit('update:open', $event)">
    <div class="space-y-5 text-sm">
      <p class="text-pebble-text-dim">
        Let an AI agent design this album for you. It connects to PebbleAlbum's built-in
        <b class="text-pebble-text">MCP server</b> and uses tools to edit pages, layouts, photos, borders, patterns,
        stickers and text — then views low-res renders to check its work. Your edits appear
        here when you reload the project.
      </p>

      <div v-if="loading" class="text-pebble-text-dim">Loading…</div>

      <template v-else-if="info">
        <!-- Step 1: config -->
        <section>
          <div class="flex items-center justify-between mb-2">
            <div class="flex items-center gap-2 font-medium"><span class="pa-kbd">1</span>Add this MCP server to your agent</div>
            <AppButton size="sm" icon="copy" @click="copy(info.configJson, 'Config')">Copy config</AppButton>
          </div>
          <pre class="pa-code max-h-52 overflow-auto text-2xs leading-relaxed select-text">{{ info.configJson }}</pre>
          <p class="pa-hint mt-1.5">
            Requires <b>Node.js</b> installed (the <code>node</code> command). Paste into your agent's MCP
            settings. <button type="button" class="text-pebble-accent-soft hover:underline" @click="revealServer">Show server file</button>
          </p>
        </section>

        <!-- Step 2: pick a prompt -->
        <section>
          <div class="flex items-center gap-2 font-medium mb-2"><span class="pa-kbd">2</span>Give your agent a prompt — pick one</div>

          <div class="rounded-lg border border-pebble-border p-2.5 mb-2">
            <div class="flex items-center justify-between mb-1.5">
              <div class="text-xs"><b>Fast completion</b> <span class="text-pebble-text-dim">— efficient, fewest tool calls</span></div>
              <AppButton size="sm" variant="secondary" icon="copy" @click="copy(promptFast, 'Fast prompt')">Copy</AppButton>
            </div>
            <pre class="pa-code max-h-40 overflow-auto whitespace-pre-wrap text-2xs leading-relaxed select-text">{{ promptFast }}</pre>
          </div>

          <div class="rounded-lg border border-pebble-border p-2.5">
            <div class="flex items-center justify-between mb-1.5">
              <div class="text-xs"><b>Deep analysis &amp; complete</b> <span class="text-pebble-text-dim">— magazine-quality, thorough</span></div>
              <AppButton size="sm" variant="secondary" icon="copy" @click="copy(promptDeep, 'Deep prompt')">Copy</AppButton>
            </div>
            <pre class="pa-code max-h-40 overflow-auto whitespace-pre-wrap text-2xs leading-relaxed select-text">{{ promptDeep }}</pre>
          </div>
        </section>

        <p class="flex items-start gap-2 text-xs text-pebble-text-dim">
          <span class="pa-kbd shrink-0">3</span>
          <span>The agent will design <b class="text-pebble-text">{{ projectName }}</b>. When it's done, <b class="text-pebble-text">reload the project</b>
          here to see the result. Projects live in <code>{{ info.projectsFolder }}</code>.</span>
        </p>
      </template>
    </div>
  </AppModal>
</template>
