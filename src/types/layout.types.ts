/**
 * layout.types.ts — Layout template + slot definitions used by the layout engine.
 */

export type LayoutCategory = 'cover' | 'single' | 'spread' | 'creative' | 'divider';

/** A single image placeholder within a layout, expressed in 0..1 fractions. */
export interface LayoutSlot {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  weight: number;
  role?: string;
  /** CSS-style clip-path for creative cut slots. */
  clipPath?: string;
  /** Pre-applied rotation (deg) e.g. for scattered polaroids. */
  rotation?: number;
  /** Force a border style for this slot regardless of theme. */
  borderForce?: string;
  /** Stacking order for overlapping layouts. */
  zIndex?: number;
  /** Default opacity for background slots. */
  opacity?: number;
}

/** A text zone hint — either absolute fractions or anchored to a slot corner. */
export interface LayoutTextZone {
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  slot?: string;
  corner?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
}

export interface LayoutTemplate {
  id: string;
  name: string;
  category: LayoutCategory;
  minImages: number;
  maxImages: number;
  slots: LayoutSlot[];
  textZone: LayoutTextZone | null;
  frameDecoration?: string;
}
