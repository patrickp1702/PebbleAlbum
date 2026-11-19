/**
 * main.ts — Vue renderer entry. Mounts the app with Pinia + Vue Router and
 * loads persisted app state (recent projects, version).
 */
import { createApp } from 'vue';
import { createPinia } from 'pinia';
import { config as fabricConfig } from 'fabric';
import App from './App.vue';
import { router } from './router';
import { useAppStore } from './stores/appStore';
import './style.css';

// Fabric's WebGL filter helper canvas defaults to 4096² — smaller than a typical
// 24MP portrait photo (e.g. 3376×6000), whose filtered output would be truncated
// at full resolution (export path). Raise the limit to 8192 when the GPU allows;
// images even larger than that fall back to the CPU backend (see pageRenderer's
// applyFiltersSafe). Must run BEFORE the first filter backend is initialised.
{
  const probe = document.createElement('canvas');
  const gl = probe.getContext('webgl2') ?? probe.getContext('webgl');
  const maxTex = gl ? (gl.getParameter(gl.MAX_TEXTURE_SIZE) as number) : 0;
  if (maxTex >= 8192) fabricConfig.configure({ textureSize: 8192 });
}

const app = createApp(App);
app.use(createPinia());
app.use(router);
app.mount('#app');

// Warm up app-wide state once Pinia is active.
const store = useAppStore();
void store.loadRecents();
void store.loadVersion();
