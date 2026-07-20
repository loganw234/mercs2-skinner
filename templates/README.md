# Repaint templates

Ready-made paint surfaces for five characters. **Derived structure only — no game
artwork**, so these are safe to redistribute.

| character | main sheets | upper body | notes |
|---|---|---|---|
| `pmc_hum_chris` | 512² | 21,626 tris | densest; most room for detail |
| `pmc_hum_mattias` | 512² | 12,798 tris | |
| `pmc_hum_eva` | 512² | 10,884 tris | unusually leg-heavy (7,958 lower body) |
| `pmc_hum_fiona` | 512² | 9,674 tris | |
| `pmc_hum_mechanic` | 512² | 4,871 tris | lightest; a good first repaint |

## What is in them

`*_SAFE.png` — every UV island filled flat and coloured by **the bone that actually drives
it**, so a shape reads as "right forearm" rather than "some blob". Island boundaries in
white, triangle wireframe over the top. Paint onto this directly.

`*_wire.png` — wireframe only, on transparency, for use as a top layer.

Sheets are rendered at 3x and downsampled. A 512 head can carry 16,000+ triangles, about
one per 16 pixels, and drawing every edge a pixel wide at final size buried up to 54% of
the sheet under black lines. The interior wireframe also fades as density rises: crisp
where the mesh is worth seeing, a soft tint where it would only be noise. Island
boundaries stay hard white at every density, because those are the lines that matter.

`_LEGEND.png` — colour to body region. The palette is the same for every character: left
limbs green, right limbs gold, torso blue, legs purple/magenta, head warm. Islands inside
one region vary slightly in lightness, so a head or hair sheet — where everything is driven
by one bone — is still readable as separate pieces.

## Why not the obvious template

A far easier template is the original texture dimmed under a wireframe. It is also better
for tracing, and it cannot be distributed: it *contains the artwork*. These are generated
from UV coordinates, mesh connectivity and skin weights, and contain no sample of any game
texture. Measured against the art-bearing version of the same sheet: 280 distinct colours
against 3,742, luminance correlation 0.107 — the residual is shared UV layout, not pixels.

If you own the game you can build the art-bearing version yourself in seconds with
`tools/make_templates.py`. It just is not ours to hand out.

## Making these for another character

```bash
mercs2_workshop --export-bundle <character> --out bundles
python tools/make_safe_template.py bundles/<character> out/ \
    ../mercs2-mesher/data/skeleton_npc84.json \
    ../mercs2-mesher/data/skeleton_hero100.json names.json
```

## Not covered

`pmc_hum_jennifer` has **no primary ASET row** — she exists only as a sub-entry, so the
exporter cannot reach her model, and no model means no UVs means no template. Her textures
extract fine; only the layout is missing. If anyone finds a rig that paints them, a proper
template is a five-minute job.
