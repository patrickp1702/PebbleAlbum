/**
 * historyStore.ts — Undo/redo via the command pattern (max 50 entries).
 * Every editor mutation should be wrapped in a Command and pushed here; the
 * project store listens and triggers a debounced autosave after each execute.
 */
import { defineStore } from 'pinia';
import { ref, computed } from 'vue';

/** A reversible editor action. */
export interface Command {
  type: string;
  description: string;
  execute: () => void;
  undo: () => void;
}

const MAX_STACK = 50;

export const useHistoryStore = defineStore('history', () => {
  const undoStack = ref<Command[]>([]);
  const redoStack = ref<Command[]>([]);
  /** Bumped after every execute/undo/redo so the project store can autosave. */
  const revision = ref(0);

  const canUndo = computed(() => undoStack.value.length > 0);
  const canRedo = computed(() => redoStack.value.length > 0);
  const undoLabel = computed(() => (canUndo.value ? `Undo: ${undoStack.value.at(-1)!.description}` : 'Undo'));
  const redoLabel = computed(() => (canRedo.value ? `Redo: ${redoStack.value.at(-1)!.description}` : 'Redo'));

  /** Execute a command and record it for undo. Clears the redo stack. */
  function run(cmd: Command): void {
    cmd.execute();
    undoStack.value.push(cmd);
    if (undoStack.value.length > MAX_STACK) undoStack.value.shift();
    redoStack.value = [];
    revision.value += 1;
  }

  function undo(): void {
    const cmd = undoStack.value.pop();
    if (!cmd) return;
    cmd.undo();
    redoStack.value.push(cmd);
    revision.value += 1;
  }

  function redo(): void {
    const cmd = redoStack.value.pop();
    if (!cmd) return;
    cmd.execute();
    undoStack.value.push(cmd);
    revision.value += 1;
  }

  function clear(): void {
    undoStack.value = [];
    redoStack.value = [];
  }

  return { undoStack, redoStack, revision, canUndo, canRedo, undoLabel, redoLabel, run, undo, redo, clear };
});

/** Factory for a simple property-set command operating on a target object. */
export function makeSetCommand<T extends object, K extends keyof T>(
  target: T, key: K, next: T[K], description: string, type = 'set',
): Command {
  const prev = target[key];
  return {
    type,
    description,
    execute: () => { target[key] = next; },
    undo: () => { target[key] = prev; },
  };
}
