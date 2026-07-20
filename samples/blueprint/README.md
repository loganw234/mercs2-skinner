# Bundled sample — "blueprint"

A worked example of the new-asset path, on `pmc_hum_mechanic`. Two 512×512 diffuse sheets
(upper and lower body); head and hair are deliberately left stock so the character still
reads as a person.

## The one technique worth stealing

`make_skin.py` multiplies the design by the **luminance of the original texture**:

```python
lum = 0.299*R + 0.587*G + 0.114*B
out = design * lum
```

Painting a flat synthetic pattern straight over a character throws away every fold, seam
and baked shadow, and the result reads as a cardboard cut-out in motion. Keeping the
original's light means the garment holds its form while the colour and pattern are
entirely new. It costs one line and it is the difference between "a texture" and "clothing".

Two smaller things that matter at this resolution:

* **A blurred glow under a sharp core.** DXT1 stores two endpoints per 4×4 block, so a
  1-pixel bright line on a dark field rings badly. A soft halo gives the block something to
  interpolate toward, and reads as emission besides.
* **Grid spacing derived from texture width** (`W // 16`), so the lines survive the mip
  chain instead of dissolving into noise at distance.

## Rebuilding it

```bash
mercs2_workshop --export-bundle pmc_hum_mechanic --out mech
python make_skin.py mech/pmc_hum_mechanic ./out '["0x98529145","0x87F9725E"]'
```

Then either drop the PNGs into mercs2-skinner and use an export path, or follow `mod.json`
for the modkit route.
