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

## Two ways out

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

The tool's character picker knows which is which and only offers the safe ones for new
outfits. Full detail in [docs/LOD-CHAIN.md](docs/LOD-CHAIN.md).

Everything else can still be **reskinned in place**, which never clones anything and so is
always geometrically correct.

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

95 assertions. The core ones are parity: `src/texture.js` is a port of the community
project's `dds_to_ucfx_texture.py`, so **that script is the specification**, not this port.

- **UCFX container byte-identical** to the reference encoder
- `pandemic_hash_m2` verified against **all 80** recovered bone name/hash pairs
- fully-resident invariants pinned: `INFO[26:32] == 0`, the `0xFFFF` sentinel, and
  `BODY == mipChainSize(w,h)` — a wrong BODY length is a documented `BUFFER_TOO_SMALL`
  over-read
- UV extraction: finest LOD only, UVs inside `[0,1]`, index buffers in range
- recolour: hue selection separates fabric from skin, shading survives a shift, and the
  selection still resolves after a shift is applied

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
- **Two-block characters cannot host new outfits.** Fixing it upstream is small: let the
  injector write `packed_block_ref = (resident << 16) | lod_block` instead of forcing
  `65535`. `AsetEntry` already exposes it.
- **Some characters cannot be exported at all** — they exist only as shared sub-entries with
  no model row of their own, so there is nothing to pull out. `pmc_hum_jennifer` is the
  well-known case.
