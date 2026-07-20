# mercs2-skinner

> ## ⚠ UNVERIFIED — nothing this tool produces has been loaded in the game yet
>
> The DXT1/UCFX encoder is held **byte-identical** to the community project's reference
> script (see [Tests](#tests)), and the whole flow was exercised in a browser. But no skin
> built here has been injected and seen on screen, and the additive
> `inject_parts --repoint` step is written from that tool's documented interface rather
> than from a run that completed. Treat the output as a candidate, not a result.
>
> If you try it, please open an issue with what you saw.

Browser tool for painting new skins onto existing Mercenaries 2 characters. Exports either
a **modkit mod** (no command line) or a **new, additional asset** that leaves the original
character intact.

Open **`dist/mercs2-skinner.html`**. One self-contained file: no install, no network, no
server. (`open.cmd` on Windows.)

## Why it exists

The bytes were never the hard part — the community toolchain already decodes every texture
to PNG and re-encodes them. The hard part is that a texture sheet on its own is
**unpaintable**: open `tex_0x17DF83D8.png` and you get a 256×256 smear with no way to tell
a sleeve from a jaw. The UV layout that would tell you is sitting in the same export folder
and nothing joins them up.

So this tool draws the model's **UV wireframe over the texture**, shows the result on the
model in 3D, and exports an engine-ready container.

## Two ways out, for two crowds

| | **A · Modkit mod** | **B · New asset** |
|---|---|---|
| for | "I just want to recolour this" | "I want a totally new skin" |
| does | replaces the character's own textures | mints a **new** texture set + a **new** model asset |
| you get | PNGs + `mod.json` in a zip | `.ucfx` containers + a build script |
| packing | the modkit does everything | three commands (script included) |
| original | restored by uninstalling the mod | never touched; both coexist |
| in game | the character just looks different | `Player.SetOutfit(char, "your_skin")` |

**A** exists because the modkit already solves the hard part. Its texture-swap contract is
just `{name, image_path}` — it does the DXT1 encode, the fully-resident container, the WAD
assembly, the load order and the merge with your other installed mods. So this path stops
at PNGs plus a definition and gets out of the way. That needs the texture's **engine name**,
which the export bundle does not carry, so names are recovered by hashing a 10,047-entry
list back through `pandemic_hash_m2` — which is also why the UI can say "upper body"
instead of `0x17DF83D8`.

**B** exists for skins that should be a *new outfit* rather than a replacement, and for the
few textures whose names were never recovered (those cannot be swapped by name at all). It
clones the donor's original block bytes into a new-hash model whose materials point at your
textures, so the original character is untouched and yours is selectable by name.

Both cover **every** sheet you edited. That matters more than it sounds: this character
splits into head / upper body / lower body / hair, so a uniform spans several textures and
exporting one at a time gives you a repainted torso on a stock face. The tool warns when
sheets are left original.

## Flow

```
mercs2_workshop --export-bundle <character> --out mychar
        │  manifest.json · model.gltf · model.bin · textures/*.png · raw/*.ucfx
        ▼
   ★ mercs2-skinner ★     drop the folder · pick a texture · paint · preview
        │
        ├─ A: <name>-modkit.zip     (PNGs + mod.json — the modkit packs it)
        └─ B: <name>-assets.zip     (.ucfx containers + build.sh)
```

1. **Export a bundle** with `mercs2_workshop` (in the community project's
   [releases](https://github.com/Mercenaries-Fan-Build/mercs2-wad-simulator/releases)).
2. **Drop the folder** into the tool.
3. **Pick a texture.** They are listed diffuse-first with their role, size and triangle count.
4. **Save the sheet as PNG** with the wireframe on — that is your paint template. Edit it
   anywhere, then **Replace** it back in. Non-matching sizes are resampled to the original
   sheet size, because the texture pool has a hard cell cap and upscaling a 256 sheet to
   1024 costs 16× the budget for no visible gain at gameplay distance.
5. **Check the 3D preview**, then export.

## Tests

```
npm test
```

75 assertions. The core one is byte-parity: `src/texture.js` is a port of the community
project's `dds_to_ucfx_texture.py` (vendored under `tools/reference-python/`), which
reverse-engineered the container layout and the fully-resident `INFO` flags — so **that
script is the specification**, not this port.

- **UCFX container byte-identical** to the reference encoder
- `pandemic_hash_m2` verified against **all 80** recovered bone name/hash pairs
- fully-resident invariants pinned: `INFO[26:32] == 0`, the `0xFFFF` sentinel, and
  `BODY == mipChainSize(w,h)` — a wrong BODY length is the documented `BUFFER_TOO_SMALL`
  streaming over-read
- UV extraction checked against a real bundle: finest LOD only, UVs inside `[0,1]`,
  index buffers in range
- both export paths cover every edited sheet, and a texture with no recovered name is
  *reported* rather than silently dropped from the modkit swap list

The primary parity fixture is **synthetic** (`tools/make_synthetic_fixture.py`) — a
procedural image built to be hostile to a block compressor (smooth ramps, hard checker
edges, noise, flat blocks). That way a fresh clone runs full byte-parity with **no
extracted game art committed**. A second case at 1024²/9 mips uses a real game sheet and
skips itself when absent.

## Bulk test: 16 skins, 48 assets

A full run of the new-asset path, to test capacity rather than one-off correctness:
16 hue-shifted variants of one character's swimsuit, each a separately named NPC skin.

| step | result |
|---|---|
| recolour (suit pixels only, hue swapped, sat/value kept) | 316,144 px across 32 sheets |
| encode to UCFX via `src/texture.js` | 32 containers, **0.2 s** |
| clone + repoint the model 16× | 16 × 38,280 B, size unchanged, CSUM re-verified |
| pack with `mercs2_smuggler --extra-only` | **48 blocks, 3.53 MB, 0.37 s** |
| verify the ASET table | **48/48 assets resolve**, no hash collisions |

Two corrections came out of doing it for real rather than from reading flags:

* **`inject_parts --repoint` cannot do a reskin.** It requires at least one `--part`, so it
  cannot express "same mesh, different textures" — it prints usage and refuses. Nothing
  published does a repoint-only clone, so `tools/repoint_model.py` does it: rewrite the
  4-byte texture hashes inside `MTRL`, fix the trailing CSUM, copy every other byte
  verbatim, then re-read and re-verify. A reskin has no business touching geometry.
* **The pack needs `--extra-only`**, or smuggler edits a donor block and the result stops
  being additive.

The generated command block now emits exactly the sequence that was run.

## Getting the float arithmetic right

Worth recording, since it cost the only real debugging in the port: the first attempt
differed in **90 bytes out of 699,188**, all of them *index* bits rather than colour
endpoints. numpy computes the DXT palette and the nearest-colour search in **float32**, and
doing the same work in JavaScript's float64 picks a different palette entry for pixels
sitting near the midpoint of the two interpolated colours. `Math.fround` at each step of
the subtract, the square and the 3-element reduction makes it exact.

Mip generation needed no such care — box-filtering integers stays exactly representable all
the way down (a 1024 sheet's deepest mip needs 24 mantissa bits, precisely what float32
has), so those values agree in either precision.

## Credits

The Mercenaries 2 file formats, the `mercs2_workshop` exporter, the texture decode/encode
and the `inject_parts` repointing all come from
[**Mercenaries-Fan-Build/mercs2-wad-simulator**](https://github.com/Mercenaries-Fan-Build/mercs2-wad-simulator).
This repo is a front end over their work: it joins the pieces their export already produces
and re-implements one encoder in JavaScript so the whole loop runs in a browser.

`tools/reference-python/` is their `mercs2-mesh-pipeline-scripts.zip`, vendored unmodified
so the parity test has something to check against. No compiled community code is
redistributed — get `mercs2_workshop` from their releases.

Not affiliated with or endorsed by EA or Pandemic Studios.

## Not done

- **Normal maps.** Mercs2 stores them as **DXT5nm** with `normal.x` in the alpha channel;
  only the DXT1 diffuse path is implemented. Their `nm_to_ucfx_dxt5nm.py` handles it today.
- **No painting in-tool** — you round-trip through your own image editor.
- **Neither install path has been run end to end.** The modkit definition matches its
  `TextureSwap {name, image_path}` contract as read from source, and the new-asset command
  block is generated from documented flags — but nobody has packed either and launched.
- **No texture-sharing check across characters** — the warning only covers draw groups
  within the loaded model. A texture shared with a *different* character would not be
  flagged.
