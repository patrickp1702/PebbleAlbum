/**
 * router/index.ts — Route table: welcome → setup → editor → export.
 * Uses hash history so it works under the file:// protocol in production.
 */
import { createRouter, createWebHashHistory } from 'vue-router';

export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', name: 'welcome', component: () => import('@/views/WelcomeView.vue') },
    { path: '/setup', name: 'setup', component: () => import('@/views/ProjectSetupView.vue') },
    { path: '/editor', name: 'editor', component: () => import('@/views/AlbumEditorView.vue') },
    { path: '/export', name: 'export', component: () => import('@/views/ExportView.vue') },
    { path: '/collage', name: 'collage', component: () => import('@/views/CollageView.vue') },
    { path: '/duplicates', name: 'duplicates', component: () => import('@/views/DuplicateFinderView.vue') },
    { path: '/pixart', name: 'pixart', component: () => import('@/views/PixartView.vue') },
    { path: '/enhance', name: 'enhance', component: () => import('@/views/EnhanceView.vue') },
    { path: '/folder-duplicates', name: 'folder-duplicates', component: () => import('@/views/FolderDupView.vue') },
  ],
});
