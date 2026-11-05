# Colour QA

Median ΔE2000 per frame between the **shipped** frames (stabilised, 720p H.264) and references. Target ≈ 3.

Pixel ΔE includes sub-pixel misregistration and codec noise; the colour-only column blurs both images (σ = 3 px) first, so it measures colour, not detail.

| reference | class | pixel ΔE median (worst) | colour-only ΔE median (worst) |
|---|---|---|---|
| Apple renderer · downstairs | skin | 3.62 (3.79) | 3.48 (3.62) |
| Apple renderer · downstairs | white_walls | 3.56 (3.74) | 3.15 (3.28) |
| Apple renderer · downstairs | magenta_violet | 2.9 (3.63) | 2.68 (2.99) |
| Apple renderer · downstairs | all | 2.5 (3.74) | 2.42 (3.6) |
| Apple renderer · upstairs | magenta_violet | 2.96 (3.26) | 2.83 (3.16) |
| Apple renderer · upstairs | all | 2.3 (3.11) | 2.29 (3.04) |
| iPhone Photos screenshots | skin | 9.66 (9.66) | 9.49 (9.49) |
| iPhone Photos screenshots | white_walls | 5.34 (7.08) | 5.35 (7.05) |
| iPhone Photos screenshots | magenta_violet | 6.38 (8.84) | 6.35 (8.77) |
| iPhone Photos screenshots | all | 7.85 (8.68) | 7.79 (8.58) |

`sheet.jpg`: left = Apple reference (stabilised to match), right = shipped frame, at 5/20/35/50/65/80/95 s.

Photos screenshots are a second, independent check: they include the display's own tone mapping and screenshot compression, and their annotation strokes are masked out. Per-frame numbers are in `results.json`.
