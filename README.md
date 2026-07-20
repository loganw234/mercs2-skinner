# mercs2-skinner

Make new skins for Mercenaries 2 characters, in your browser.

**→ https://skins.mercs2.tools/**

Or download [`dist/mercs2-skinner.html`](dist/mercs2-skinner.html) and open it offline — one
self-contained file, no install, no network, no server.

It starts by asking what you want to do and which character, then writes out the exact
command to get that character out of the game. If you only want to *paint* something, it
hands you a ready-made template and you need no game tools at all until you want to put the
result back in.

---

## Status: confirmed working in game

**256 custom skins, loaded and cycled in a running game** (2026-07-20). Everything below is
measured, not projected.

| | |
|---|---|
| skins proven simultaneously | **256** on one character |
| additive assets in one patch | 512 (256 models + 256 textures), 100.8 MB |
| encode time | 256 sheets in **6 s** |
| pack time | 512 assets in **0.4 s** |
| base game modified | **none** — everything ships in a patch WAD |

## Why it exists

The bytes were never the hard part — the community toolchain already decodes every texture
to PNG and re-encodes them. The hard part is that a texture sheet on its own is
**unpaintable**: open one and you get a smear of skin tones with no way to tell a sleeve
from a jaw. The UV layout that would tell you is sitting in the same export folder and
nothing joins them up.

So this draws the model's **UV layout over the texture**, shows the result on the model in
3D, lets you recolour it in place, and exports something the game can load.

## What you can do

**Recolour without leaving the page.** Click a colour on the sheet, move the hue /
saturation / brightness sliders. Selection is by hue rather than RGB distance, so a garment
in shadow and the same garment in light are picked up together while the skin beside them is
not. Saturation and value are multiplied rather than replaced, so folds survive.

**Paint properly.** Save the sheet with its UV wireframe as a template, edit it anywhere,
drop it back in.

**Start with no install at all.** Ready-made templates ship with the tool: every UV island
filled flat and coloured by the body part that drives it, so a shape reads as "right
forearm" rather than "some blob". They contain no game artwork, which is exactly why they
can be handed out.

**Wear someone else's outfit, without painting anything.** Pick whose body you want and
whose clothes you want, drop both export bundles in, and the tool dresses one in the other.
See below — it is not the filename swap it looks like.

## Swapping outfits between characters

Chris in Allied fatigues, in four steps: export `pmc_hum_chris`, export `al_hum_starter01`,
drop them in, export. No image editor involved.

The obvious way to build this is to copy the donor's sheet over the target's and rename it.
**That does not work**, and it is worth being precise about why, because the failure is not
obvious from looking at one sheet. Characters do not share UV layouts. Measured across 40
exported characters, comparing which *body part* each overlapping texel actually paints:

| sheet | median agreement | pairs above 0.85 |
|---|---|---|
| upper body | 0.21 | 1 of 276 |
| lower body | 0.29 | 4 of 190 |
| head | 0.71 | 38 of 465 |

Chris and the Allied soldier agree on **13%** of their upper-body texels. Renaming one sheet
to the other paints sleeves onto thighs. Only same-family variants (`chris` ↔ `chris_v4`)
line up well enough for a copy.

What every character *does* share is the skeleton and the bind pose. So the swap goes
through 3D instead of through UV coincidence:

```
for each texel of the target's sheet
  → its 3D position on the target body     (barycentric inside the target's UV triangle)
  → the nearest point on the donor body    (spatial grid over ~74k donor surface samples)
  → that point's UV on the donor           → sample the donor's texture
```

The donor's clothing comes out re-laid-out in the target's own UV space, which is what the
engine reads. On `pmc_hum_chris ← al_hum_starter01` the median correspondence error is
**0.56% of body height**, no texel is left unmapped, and the whole character takes about two
seconds.

The tool reports the fit per sheet. A poor number means the donor has no counterpart for
part of that body — gear one character carries and the other does not — and those areas take
the nearest colour available rather than something correct.

**It does not rescale, and that is deliberate.** An earlier version height-matched the two
bodies, which made the correspondence measurably *worse* (0.0098 → 0.0159 median on that
same pair). Two characters on a shared rig already occupy the same space; the apparent 6%
height difference was stray geometry dipping below the floor dragging a raw bounding box
with it. Heights are now measured with trimmed percentiles and only *reported*.

## Two ways out

Both paths take a swapped outfit exactly like a painted one.

| | **A · Modkit mod** | **B · New asset** |
|---|---|---|
| for | "recolour this character" | "add outfits that coexist" |
| does | replaces the character's own textures | mints a **new** model + textures |
| you get | PNGs + `mod.json` | `.ucfx` containers + a build script |
| packing | the modkit does everything | two commands (script included) |
| original | restored by uninstalling | never touched |
| geometry | always correct | correct on single-block characters |
| how many | one variant per character | **effectively unlimited** |

**A** exists because the modkit already solves the hard part — its texture-swap contract is
just `{name, image_path}`, and it handles the encode, the container, the WAD assembly and
the merge with your other mods.

**B** is for skins that should be a *new outfit* rather than a replacement.

## Which characters can host new outfits

Not all of them, and the reason is structural rather than arbitrary.

A model's LOD chain lives in its ASET row: the packed block reference decodes to
`(block, sub)`, where `sub` is the index of a **second block** holding the finer geometry,
or `65535` for none. Cloning copies one block, so:

* **Single-block characters clone perfectly.** All their geometry is in one place.
* **Two-block characters lose their detail rungs** and render their coarsest tier at every
  distance — a visibly flattened face.

Of the **85 characters with a model of their own, 38 are single-block** and clone at full
detail. The picker lists those first and marks them ✓; the other 47 are still offered, with
what cloning costs them spelled out. Full detail in [docs/LOD-CHAIN.md](docs/LOD-CHAIN.md).

A further **67 characters exist only as shared sub-entries** with no model row of their own.
They can never be cloned, but they can be **reskinned in place**, which never clones anything
and so is always geometrically correct. 152 characters in total.

## How many skins can you actually have

Measured and reasoned, in the order you would hit them:

1. **Hash collisions** — `pandemic_hash_m2` is 32-bit and the game already holds 30,645
   assets. A collision doesn't error; it silently replaces whatever it lands on. Roughly
   0.2% at 256 new assets, 3.5% at 5,000, 13% at 20,000. The tool warns when a generated
   name resolves to something real.
2. **Patch size** — about 600 KB per variant with a 512² donor. 1,000 variants ≈ 600 MB.
3. **Format ceiling** — the ASET block index is a `u16`, so 65,535 blocks per patch, which
   is ~32,767 variants. Nowhere near it.
4. **Texture pool** — the 5,120-cell cap counts *simultaneously resident* textures, not
   total. 256 variants worn one at a time cost one.

Nobody is going to run out.

## Tests

```
npm test
```

123 assertions. The core ones are parity: `src/texture.js` is a port of the community
project's `dds_to_ucfx_texture.py`, so **that script is the specification**, not this port.

- **UCFX container byte-identical** to the reference encoder
- `pandemic_hash_m2` verified against **all 80** recovered bone name/hash pairs
- fully-resident invariants pinned: `INFO[26:32] == 0`, the `0xFFFF` sentinel, and
  `BODY == mipChainSize(w,h)` — a wrong BODY length is a documented `BUFFER_TOO_SMALL`
  over-read
- UV extraction: finest LOD only, UVs inside `[0,1]`, index buffers in range
- recolour: hue selection separates fabric from skin, shading survives a shift, and the
  selection still resolves after a shift is applied
- outfit transfer, on a pair built to defeat a naive copy — same body, **mirrored** UV
  layouts. The transfer scores **97.5%** of texels on the correct body part; a filename
  swap on that same pair scores **0%**. The spatial grid is also checked against brute
  force, since a wrong search bound degrades quality silently instead of throwing.

The parity fixture is **synthetic** — a procedural image built to be hostile to a block
compressor — so a fresh clone runs full byte-parity with no extracted game art committed.

## Getting the float arithmetic right

The first port of the encoder differed in **90 bytes out of 699,188**, all of them *index*
bits rather than colour endpoints. numpy computes the DXT palette and the nearest-colour
search in **float32**, and doing the same work in float64 picks a different palette entry
for pixels sitting near the midpoint of the two interpolated colours. `Math.fround` at each
step makes it exact.

Mip generation needed no such care — box-filtering integers stays exactly representable all
the way down.

## Credits

The Mercenaries 2 file formats, the `mercs2_workshop` exporter, the texture decode/encode
and the WAD tooling all come from
[**Mercenaries-Fan-Build/mercs2-wad-simulator**](https://github.com/Mercenaries-Fan-Build/mercs2-wad-simulator).
This repo is a front end over their work.

`tools/reference-python/` is their `mercs2-mesh-pipeline-scripts.zip`, vendored unmodified
so the parity test has something to check against. No compiled community code and no game
asset is redistributed here.

Not affiliated with or endorsed by EA or Pandemic Studios.

## Not done

- **Normal maps.** Mercs2 stores them as **DXT5nm** with `normal.x` in the alpha channel;
  only the DXT1 diffuse path is implemented here. Their `nm_to_ucfx_dxt5nm.py` handles it.
- **No freehand painting** — the recolour covers hue/saturation/brightness, anything else
  round-trips through your own image editor.
- **Two-block characters lose detail when cloned.** Fixing it upstream is small: let the
  injector write `packed_block_ref = (resident << 16) | lod_block` instead of forcing
  `65535`. `AsetEntry` already exposes it.
- **A swapped outfit has not yet been seen in game.** The transfer is verified numerically
  and against a synthetic worst case, and the export path it feeds is the same one that put
  256 skins on screen — but this particular combination has not been loaded yet.
- **The swap copies colour, not geometry.** Clothing that stands off the body — a helmet,
  a backpack, loose webbing — exists as *shape* on the donor, and shape is not what moves.
  You get its colours projected onto whatever the target has in that space.
- **Some characters cannot be exported at all** — they exist only as shared sub-entries with
  no model row of their own, so there is nothing to pull out. `pmc_hum_jennifer` is the
  well-known case.
