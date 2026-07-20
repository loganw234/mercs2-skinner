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

Browser tool for painting **new skins** for existing Mercenaries 2 characters — as new,
additional assets rather than overwrites.

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

## Additive, not destructive

Replacing texture `0x17DF83D8` in place changes it for **every** model that references it —
they are shared across LOD rungs, and with 36,724 textures game-wide, very likely across
characters too. So the export mints new assets instead:

1. a **new texture** asset, named by you, hashed with `pandemic_hash_m2`
2. a **new model** asset cloned from the donor's original block bytes (`raw/` in the
   bundle), with its material references repointed at (1) via `inject_parts --repoint`

The original character keeps its own texture, both coexist in one patch WAD, and the new
one is worn with `Player.SetOutfit(char, "your_skin_name")`.

The tool warns when the texture you edited is shared by several draw groups, because
repointing swaps it for all of them on the new model.

## Flow

```
mercs2_workshop --export-bundle <character> --out mychar
        │  manifest.json · model.gltf · model.bin · textures/*.png · raw/*.ucfx
        ▼
   ★ mercs2-skinner ★     drop the folder · pick a texture · paint · preview
        │
        ├─ <name>_diffuse.ucfx      (engine-ready, DXT1, fully resident)
        └─ the inject_parts + smuggler + merge_patches command block
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

61 assertions. The core one is byte-parity: `src/texture.js` is a port of the community
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

The primary parity fixture is **synthetic** (`tools/make_synthetic_fixture.py`) — a
procedural image built to be hostile to a block compressor (smooth ramps, hard checker
edges, noise, flat blocks). That way a fresh clone runs full byte-parity with **no
extracted game art committed**. A second case at 1024²/9 mips uses a real game sheet and
skips itself when absent.

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
- **The additive chain is unrun.** The command block is generated from documented flags;
  nobody has executed it end to end.
- **No texture-sharing check across characters** — the warning only covers draw groups
  within the loaded model. A texture shared with a *different* character would not be
  flagged.
