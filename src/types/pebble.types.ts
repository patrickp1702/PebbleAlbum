/**
 * pebble.types.ts
 * -----------------------------------------------------------------------------
 * The complete TypeScript model for the `.pebble` project file format.
 * A `.pebble` file is a single JSON document that is the ground-truth of an
 * entire album: every image position, crop, decoration, and text block is
 * persisted here so a project can be reconstructed pixel-perfect on reload.
 *
 * These types are shared between the Electron main process and the Vue renderer.
 */

/** Sizing buckets parsed from filename labels, mapped to relative slot sizes. */
export type SlotSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl' | 'xxl';
export type AspectMode = 'sq' | 'land' | 'port' | 'free';
export type FilterId =
  | 'none' | 'bw' | 'sepia' | 'vivid' | 'muted' | 'warm' | 'cool'
  | 'faded' | 'dramatic' | 'lomo' | 'chrome' | 'fade';
export type PatternId =
  | 'floral' | 'bokeh' | 'geometric' | 'vintage' | 'plain'
  | 'lace' | 'dots' | 'hearts' | 'stars' | 'leaves';
export type SlotPosition = 'left' | 'right' | 'top' | 'bottom' | 'center' | 'fill';
export type ImageRole = 'cover' | 'hero' | 'thumb' | 'bg' | 'accent' | 'featured';
export type BlendMode = 'normal' | 'multiply' | 'screen' | 'overlay' | 'soft-light';
export type ImageFlag =
  | 'newpage' | 'proverb' | 'skip' | 'noborder' | 'nocaption' | 'nofilter'
  | 'spotlight' | 'blurbg' | 'fullpage' | 'duotone' | 'vignette' | 'glow'
  | 'matte' | 'textover';

/** The root project document persisted to disk. */
export interface PebbleProject {
  version: string;
  meta: AlbumMeta;
  pages: AlbumPage[];
  imageRegistry: ImageRecord[];
  history?: HistoryEntry[];
  /** Near-duplicate groups detected by the culling engine (members = relativePaths). */
  duplicateGroups?: DuplicateGroup[];
  /** AI Enhance studio: scene/identity prompts + the per-photo queue the agent
   *  works through (generate → review → composite the ORIGINAL face back). */
  enhance?: EnhanceConfig;
}

// ---- AI Enhance (identity-safe scene/wardrobe re-imagining) -----------------

/** Lifecycle of one queued photo. `review` = a variant exists, awaiting the
 *  agent's verdict; `done` = `resultPath` holds the composited final. */
export type EnhanceStatus = 'pending' | 'generating' | 'review' | 'compositing' | 'done' | 'failed' | 'skipped';

/** Head-pose + detection metrics for the LARGEST face in an image. Angles in
 *  degrees (geometric estimates from 68 landmarks, good for DIFFERENCES);
 *  `box` is 0..1 fractions of the image. */
export interface EnhanceFaceMetrics {
  detected: boolean;
  score?: number;
  yaw?: number;
  pitch?: number;
  roll?: number;
  /** Inter-ocular distance as a fraction of image width (framing/scale cue). */
  eyeDistance?: number;
  box?: { x: number; y: number; width: number; height: number };
  faces?: number;
}

/** One generation call for a queued photo. `path` is relative to the album
 *  folder: `enhanced/<stem>/attempt-<n>.png`. */
export interface EnhanceAttempt {
  n: number;
  path: string;
  prompt: string;
  provider: string;
  model: string;
  createdAt: string;
  width: number;
  height: number;
  verdict: 'pending' | 'accepted' | 'rejected';
  note?: string;
  metrics?: {
    source?: EnhanceFaceMetrics;
    generated?: EnhanceFaceMetrics;
    yawDiff?: number;
    pitchDiff?: number;
    rollDiff?: number;
    /** 0..1 face-embedding similarity (1 = identical); undefined if a face is missing. */
    similarity?: number;
  };
}

export interface EnhanceItem {
  /** Registry `relativePath` of the source photo. */
  filename: string;
  status: EnhanceStatus;
  attempts: EnhanceAttempt[];
  /** `enhanced/<stem>/final.jpg` once composited (also registered in imageRegistry). */
  resultPath?: string;
  note?: string;
  updatedAt: string;
}

export interface EnhanceConfig {
  /** What should change: scene, wardrobe, lighting, setting. */
  scenePrompt: string;
  /** What must NOT change — the identity paragraph appended to every generation prompt. */
  identityText: string;
  /** Ask the provider to inpaint AROUND the face (mask) when it supports masks. */
  keepFace: boolean;
  /** Generation cap per photo (default 3). */
  maxAttempts: number;
  items: EnhanceItem[];
}

/** A cluster of near-duplicate photos with the best frame suggested as keeper. */
export interface DuplicateGroup {
  id: string;
  members: string[];      // relativePaths, best-first
  suggested: string;      // relativePath of the auto-suggested keeper
}

/** Per-photo quality metrics from the similarity engine. */
export interface PhotoQuality {
  sharpness: number;
  exposure: number;
  score: number;
  clipOver: number;
  clipUnder: number;
}

export type Orientation = 'landscape' | 'portrait' | 'square';
export type PageTurnStyle = 'curl' | 'slide' | 'fade' | 'hard' | 'push' | 'zoom' | 'flip_up';
export type PageTurnSpeed = 'slow' | 'normal' | 'fast';

export interface AlbumMeta {
  name: string;
  createdAt: string;
  updatedAt: string;
  sourceFolder: string;
  albumWidth: number;
  albumHeight: number;
  dpi: number;
  unit: 'px' | 'mm' | 'inch';
  theme: string;
  coverTitle: string;
  coverSubtitle: string;
  coverDate: string;
  proverbs: string[];
  customFont?: string;
  pageBackgroundColor: string;
  pageBackgroundTexture?: string;
  gutterWidth: number;
  bleedMargin: number;
  safeMargin: number;
  pageCount: number;
  orientation: Orientation;
  bindingType: 'left' | 'top';
  pageTurnStyle: PageTurnStyle;
  pageTurnSpeed: PageTurnSpeed;
  /** Default seconds each page stays on screen in the slideshow (pages can
   *  override with `durationSec`). Default 4. */
  slideshowInterval?: number;
  /** Ordered slideshow playlist: absolute paths into the music libraries
   *  (bundled defaults or ~/PebbleAlbum/music). Loops when shorter than the
   *  show; empty/undefined = silent. */
  slideshowMusic?: string[];
  autoSave: boolean;
  lastExportPath?: string;
  /** Optional custom theme token overrides (when meta.theme === 'custom'). */
  customTheme?: Record<string, unknown>;
  watermark?: WatermarkConfig;
  pageNumbers?: PageNumberConfig;
  spineText?: string;
}

export interface WatermarkConfig {
  enabled: boolean;
  text: string;
  position: 'bottom-right' | 'bottom-left' | 'bottom-center' | 'top-right' | 'top-left';
  opacity: number;
}

export interface PageNumberConfig {
  enabled: boolean;
  position: 'footer-center' | 'footer-right' | 'footer-left';
  startAt: number;
}

export type PageType = 'cover' | 'back_cover' | 'spread' | 'single' | 'divider';
export type ProverbPosition = 'standalone' | 'overlay' | 'sidebar' | 'footer';

export interface AlbumPage {
  id: string;
  index: number;
  type: PageType;
  layoutId: string;
  backgroundColor?: string;
  backgroundTexture?: string;
  /** Optional per-page linear-gradient background (overrides the theme bg). */
  backgroundGradient?: { from: string; to: string; angle: number };
  /** Optional per-page faint pattern texture (pattern id), painted over the base. */
  backgroundPattern?: string;
  images: PageImage[];
  decorations: Decoration[];
  textBlocks: TextBlock[];
  proverb?: string;
  proverbPosition?: ProverbPosition;
  locked: boolean;
  notes?: string;
  /** How long this page stays on screen in the slideshow / exported video
   *  (seconds). Falls back to meta.slideshowInterval (default 4). */
  durationSec?: number;
}

export interface SlotTransform {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
  flipX: boolean;
  flipY: boolean;
}

export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PageImage {
  id: string;
  filename: string;
  slotId: string;
  /** The displayed image box (cover-fit, may extend beyond the frame). */
  position: SlotTransform;
  /**
   * The fixed slot frame the image is clipped to (absolute album px). When
   * present the image is cover-fit and cropped to this rect, so photos are
   * never stretched and can be panned/zoomed inside the frame. Omitted for
   * free-floating images dragged onto the page.
   */
  slotRect?: CropRect;
  /** True for images dropped freely onto a page (no slot, fully movable). */
  free?: boolean;
  /**
   * How the image fills its slot frame:
   *  - undefined / 'auto' → fill the frame, but fall back to fitting the whole
   *    photo when filling would crop too heavily (avoids over-zoom).
   *  - 'cover' → always fill (crop overflow)
   *  - 'contain' → always fit the whole photo (letterbox)
   */
  fit?: 'auto' | 'cover' | 'contain' | 'fill';
  /**
   * When false/undefined the photo auto-fits its frame (computed from the frame
   * + the photo's TRUE size, so it never over-zooms). Once the user pans/zooms
   * it becomes true and `position` (the display box) is the source of truth.
   */
  manual?: boolean;
  /**
   * Focal point for AUTO cover-fit (slot + !manual), as 0..1 fractions of the
   * image (0.5,0.5 = centre). The crop is shifted so this point sits at the frame
   * centre (clamped to keep the frame covered) — so faces aren't cropped out when
   * a portrait lands in a landscape slot.
   */
  focus?: { x: number; y: number };
  /** Extra zoom over the auto cover-fit (1 = fill exactly; >1 zooms in). Applies
   *  in the slot + !manual path and stays uniformly scaled (never stretches). */
  coverZoom?: number;
  /** Absolute-px polygon (e.g. for diagonal/angled slots) the image is clipped
   *  to. When present it overrides the rectangular slotRect clip. */
  clipPolygon?: { x: number; y: number }[];
  /** Shape mask (circle/heart/star/…) the photo is clipped to, fitted to its
   *  frame (slotRect) or display box. Overrides the rectangular clip; ignored
   *  when a clipPolygon is present. */
  maskId?: MaskId;
  /**
   * Non-destructive ERASE MASK (PicsArt-style eraser). Project-relative path
   * (inside sourceFolder, under `.pebble_masks/`) of a PNG whose ALPHA channel
   * is the keep-amount (opaque = keep, transparent = erased), stretched over the
   * WHOLE source photo. The source photo is never modified, so the Restore
   * brush can always bring erased pixels back. Each save writes a NEW file, so
   * undo/redo is just swapping this path.
   */
  eraseMask?: string;
  /**
   * Non-destructive FILTER MASK (the "Filter brush": PicsArt-style partial
   * filter). Same storage rules as `eraseMask` — project-relative PNG under
   * `.pebble_masks/`, a NEW file per save, in UN-FLIPPED source-pixel space,
   * stretched over the WHOLE photo. Its ALPHA is how much of `effects` applies
   * per pixel: 255 = fully filtered, 0 = the original photo. Covers the whole
   * per-pixel colour pipeline of `effects` (named preset at its strength + every
   * adjust slider incl. blur / sharpen / grain); separate overlay objects
   * (vignette, border, shadow) are NOT masked. Absent = filter everywhere.
   * The erase mask is applied on top, as without a filter mask.
   */
  filterMask?: string;
  crop: CropRect;
  parsedLabels: ParsedImageLabels;
  overrides: Partial<ParsedImageLabels>;
  effects: ImageEffects;
  border: BorderConfig | null;
  shadow: ShadowConfig | null;
  caption?: string;
  captionStyle?: TextStyle;
  opacity: number;
  zIndex: number;
  visible: boolean;
}

export interface ParsedImageLabels {
  size?: SlotSize;
  aspect?: AspectMode;
  borderStyle?: 'none' | 'thin' | 'thick' | 'double' | 'rounded' | 'polaroid' | 'filmstrip';
  pattern?: PatternId;
  filter?: FilterId;
  position?: SlotPosition;
  role?: ImageRole;
  flags?: ImageFlag[];
  rotate?: 0 | 90 | 180 | 270;
  captionText?: string;
  pageTag?: string;
  frameId?: string;
  colorTint?: string;
  blendMode?: BlendMode;
  order?: number;
}

export interface ImageEffects {
  filter: string;
  /** Strength of the named `filter` preset, 0..1 (1 = full, default). */
  filterStrength?: number;
  brightness: number;
  contrast: number;
  saturation: number;
  /** Legacy sharpness multiplier: 1 = neutral (default), up to 2 = strong sharpen. */
  sharpness: number;
  vignette: number;
  blur: number;
  noise: number;
  /** Multiplicative exposure, −1..1 (0 = neutral). */
  exposure?: number;
  /** Warm/cool white balance, −1 (cool) .. 1 (warm). */
  temperature?: number;
  /** Green–magenta tint, −1 (green) .. 1 (magenta). */
  tint?: number;
  /** Hue rotation in degrees, −180..180. */
  hue?: number;
  /** Lift/crush the top end, −1..1 (0 = neutral). */
  highlights?: number;
  /** Lift/crush the low end, −1..1 (0 = neutral). */
  shadows?: number;
  tintColor?: string;
  tintOpacity: number;
  duotoneHighlight?: string;
  duotoneShadow?: string;
  lut?: string;
}

/** Shape-mask ids an image can be clipped to (PicsArt-style shape crop). */
export type MaskId =
  | 'circle' | 'ellipse' | 'squircle' | 'heart' | 'star' | 'hexagon'
  | 'diamond' | 'arch' | 'blob' | 'scallop';

export interface BorderConfig {
  /** 'pattern' renders a decorative SVG frame (see `frameId`); the rest are
   *  stroked rectangle styles. */
  style: 'solid' | 'double' | 'dashed' | 'dotted' | 'groove' | 'ridge' | 'none' | 'pattern';
  width: number;
  color: string;
  radius: number;
  innerGlow?: string;
  outerGlow?: string;
  padding: number;
  /** When set, the stroked border uses a linear gradient instead of `color`. */
  gradient?: { from: string; to: string; angle: number } | null;
  /** Decorative SVG border-frame id (used when `style === 'pattern'`). */
  frameId?: string;
}

export interface ShadowConfig {
  offsetX: number;
  offsetY: number;
  blur: number;
  spread: number;
  color: string;
  opacity: number;
}

export interface Decoration {
  id: string;
  type: 'svg_overlay' | 'canvas_draw' | 'pattern_tile' | 'frame' | 'shape' | 'sticker';
  assetId?: string;
  renderer?: string;
  params: Record<string, unknown>;
  position: { x: number; y: number; width: number; height: number; rotation: number };
  opacity: number;
  blendMode: string;
  zIndex: number;
  visible: boolean;
  locked: boolean;
}

export interface TextBlock {
  id: string;
  content: string;
  style: TextStyle;
  position: { x: number; y: number; width: number; height: number; rotation: number };
  type: 'proverb' | 'title' | 'caption' | 'date' | 'custom' | 'name_script' | 'watermark';
  zIndex: number;
  visible: boolean;
  locked: boolean;
}

export interface TextStyle {
  fontFamily: string;
  fontSize: number;
  fontWeight: 'normal' | 'bold' | '100' | '200' | '300' | '400' | '500' | '600' | '700' | '800' | '900';
  fontStyle: 'normal' | 'italic';
  color: string;
  align: 'left' | 'center' | 'right' | 'justify';
  letterSpacing: number;
  lineHeight: number;
  textShadow?: ShadowConfig;
  textStroke?: { width: number; color: string };
  textTransform: 'none' | 'uppercase' | 'lowercase' | 'capitalize';
  opacity: number;
  background?: string;
  padding?: number;
  /** Curved text (PicsArt "Bend"): −100..100. 0/undefined = straight; positive
   *  arcs upward (rainbow), negative downward; ±100 ≈ a full circle. */
  curve?: number;
}

export interface ExifData {
  dateTaken?: string;
  cameraMake?: string;
  cameraModel?: string;
  focalLength?: number;
  aperture?: number;
  iso?: number;
  orientation?: number;
}

export interface ImageRecord {
  filename: string;
  relativePath: string;
  absolutePath: string;
  width: number;
  height: number;
  fileSize: number;
  mimeType: string;
  exif?: ExifData;
  thumbnailPath: string;
  parsedLabels: ParsedImageLabels;
  usedOnPages: string[];
  skipped: boolean;                 // excluded from the album (deselected / labelled skip)
  /** Perceptual hash (dHash, 16 hex) for near-duplicate detection. */
  phash?: string;
  /** Quality metrics used to suggest the best frame in a duplicate group. */
  quality?: PhotoQuality;
}

/** A single undo/redo entry persisted (optionally) with the project. */
export interface HistoryEntry {
  type: string;
  description: string;
  timestamp: string;
  /** Opaque snapshot payload used by the command to undo/redo. */
  payload?: unknown;
}
