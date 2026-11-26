# AI Enhance — identity-safe re-imagining

Change a photo's **scene, wardrobe and lighting** with the user's own image API,
while every person keeps their **real face**: after you pick a good variant, the
app pastes the ORIGINAL face back onto it (5-point alignment, feathered mask,
skin-tone match). Your job is to get a variant whose **pose, head angle and
framing match the original** — the composite takes care of the face.

The user sets everything up in the app's **AI Enhance** studio: the queue (ticked
photos), the scene wish, the identity paragraph, and the image provider (OpenAI,
Gemini, an OpenAI-compatible host, or `mock` for offline tests). The API key stays
in `ai-provider.json` on their machine — you never see it.

## Privacy & cost (why previews are small)
- `enhance_generate` sends the photo (upright, long side ≤ 2048 px) **only** to the
  configured provider. Outputs go only to disk (`<album>/enhanced/<stem>/`).
- You only ever get **≤ 640 px JPEG previews** and ≤ 320 px face crops. Do not ask
  for full-size images; judge from the preview + metrics.
- Every `enhance_generate` is a paid API call. Respect `maxAttempts`.

## The loop (per queued photo)
1. `enhance_get_queue {project}` — settings, provider status, items. Skip `done`.
   If `provider.configured` is false → stop and tell the user to configure one.
2. Optional: `enhance_view {which:"source"}` to see people count, pose, crop.
3. `enhance_generate {project, filename, prompt}` — the prompt = the scene adapted
   to THIS photo + the identity rules. Be concrete about **head direction, gaze,
   crop and how many people** ("three-quarter view facing left, eyes to camera,
   head-and-shoulders crop, one child"). The server appends the identity paragraph
   when the provider can't keep the face with a mask (or keepFace is false) and
   always appends a pose-lock line.
4. Judge the returned metrics + preview:

   | metric | pass |
   |---|---|
   | `yawDiff` (left/right turn) | ≤ 8° |
   | `pitchDiff` (up/down tilt) | ≤ 8° |
   | `rollDiff` (head tilt) | ≤ 6° |
   | `generated.detected` | true (face visible) |
   | `generated.faces` | same as `source.faces` for group photos |
   | scene | as requested, framing similar |

   `similarity` (0..1, face-embedding) is informational: the composite restores
   the face anyway. Below ~0.4 usually means a different person or a heavily
   restyled face — fine if the pose matches. `verdictHint` summarises this.
   Unsure? `enhance_compare_faces {variant}` shows source | variant face crops.
5. Fail → refine the prompt (name the exact head direction / crop / people count
   that was wrong) and generate again. After `maxAttempts`: if one attempt is within
   the thresholds composite it; otherwise `enhance_set_status {status:"failed",
   note:"why"}` and move on (the user's prompt says the same). A photo stuck in
   `generating` (interrupted agent) counts as `pending`. If `enhance_generate` times
   out in your client, call `enhance_get_queue` before retrying — the attempt
   usually landed and still counts toward `maxAttempts`.
6. Pass → `enhance_composite {project, filename, variant}`. Check the **blend crop**
   (2nd image):
   - visible seam / halo / hard jaw line → re-run with `feather` 0.18–0.25;
   - face too orange / grey vs the scene → change `toneMatch` (0 = keep original
     colours, 1 = fully match the variant's lighting; default 0.85);
   - forehead edge shows → `maskTop` 0.45–0.6; cheeks cut → `expand` 1.1–1.2;
   - face misplaced / doubled features → the pose differs too much: generate again.
   Re-running composite overwrites `final.jpg` (no new generation cost).
7. Finish: `enhance_get_queue` and report done / failed (+ reasons). Tell the user
   to reload the project — finals are registered album photos under `enhanced/`.

## Tools
- `enhance_provider_status {}` — configured?, provider, model, keyHint, supportsMask.
- `enhance_get_queue {project}` — settings + items + counts.
- `enhance_set_settings {project, scenePrompt?, identityText?, keepFace?, maxAttempts?}`
- `enhance_set_queue {project, add?: [relativePath], remove?: [relativePath]}`
- `enhance_set_status {project, filename, status, note?}` — pending / generating /
  review / compositing / done / failed / skipped.
- `enhance_generate {project, filename, prompt, keepFace?, size?, quality?}`
- `enhance_compare_faces {project, filename, variant?}` — `variant` = attempt n or `"final"`.
- `enhance_composite {project, filename, variant?, feather?, toneMatch?, expand?, maskTop?}`
- `enhance_view {project, filename, which: source|attempt|final, attempt?, maxWidth?}`

## Gotchas
- `filename` is the registry `relativePath` (as in `list_images` / the queue). A
  photo must be queued (`enhance_set_queue add`) before `enhance_generate`.
- Pose angles are **geometric estimates** from 68 landmarks — reliable for the
  DIFFERENCE between source and variant, not as absolute angles.
- Masked providers (OpenAI / compatible, keepFace on) keep the face pixels during
  generation, so the head pose usually matches; Gemini has no mask, so pose drift
  is more common — be extra explicit about head direction there.
- The final has the **variant's** resolution (whatever the provider returned).
- Attempts (`attempt-<n>.png`) are not album photos; view them with `enhance_view`.
  Only `final.jpg` is registered; place it with `place_image` only if the user asks.
- No face in the source → composite is impossible; mark it `skipped` or ask.
- `mock` provider = offline test: returns a re-tinted, slightly zoomed copy.
