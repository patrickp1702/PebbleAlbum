/**
 * keyboard.ts — small shared keyboard helpers for the screens that install
 * window-level shortcuts (album editor, Pixart, Collage). Pure UI helpers: no
 * store, no component imports.
 */

/** Platform modifier as shown in tooltips: "⌘" on Apple platforms, "Ctrl+" elsewhere. */
export const MOD = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl+';

/** Input types that take typed text (so Backspace/arrows/letters belong to them). */
const NON_TEXT_INPUTS = new Set(['range', 'checkbox', 'radio', 'button', 'submit', 'reset', 'color', 'file', 'image']);

/**
 * True when the event target is a control the user TYPES into — a text-like
 * <input>, a <textarea>, a <select> or contenteditable. Window-level shortcuts
 * must stand down then, or Backspace in a caption field deletes the selected
 * photo. Sliders, checkboxes and colour swatches are deliberately NOT text
 * entry: after dragging a slider, Delete / undo must still work.
 */
export function isTextEntry(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || !el.tagName) return false;
  if (el.isContentEditable) return true;
  if (el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') return true;
  if (el.tagName === 'INPUT') return !NON_TEXT_INPUTS.has(((el as HTMLInputElement).type || 'text').toLowerCase());
  return false;
}

/** True when the target is a slider — its arrow keys adjust the value. */
export function isRangeInput(target: EventTarget | null): boolean {
  const el = target as HTMLInputElement | null;
  return !!el && el.tagName === 'INPUT' && el.type === 'range';
}
