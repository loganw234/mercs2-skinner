# Repaint templates - pmc_hum_mechanic

**Derived structure only. No game artwork.** Every pixel here is generated from UV layout,
mesh connectivity and skin weights - there is no sample of the original texture in any of
these files, which is what makes them redistributable.

## Files

  *_SAFE.png    Each UV island filled flat, coloured by the BONE that drives it, with
                island boundaries in white and the triangle wireframe over the top.
                Paint straight onto this.
  *_wire.png    Wireframe only, on transparency. Use as a top layer in an image editor and
                keep it visible while you paint underneath.
  _LEGEND.png   Which colour means which body region.

The palette is identical across every character, so it is learned once. Left-side limbs
are greens, right-side are golds, torso is blue, legs are purple/magenta, head is warm.
Islands within one region get slightly different lightness so a head or hair sheet - where
everything is driven by the same bone - is still readable as separate pieces.

## Working from these

The white lines are ISLAND BOUNDARIES. They are the ones that matter: an island edge is a
seam on the model, and paint has to run past it. The thin dark lines are the triangle
wireframe, useful for judging how much geometry a region has to work with but not something
you need to respect while painting.

## Rules that will bite you

* KEEP THE EXACT DIMENSIONS. The engine reads a fixed byte count derived from the sheet's
  size; a different size is not "a bigger texture", it is a buffer over-read.
* Power-of-two only, and resist upscaling - the texture pool has a hard cell cap.
* Paint a few pixels PAST every island boundary. Neighbouring pixels bleed into each other
  through the mip chain, and a hard edge shows as a halo at distance.
* Some sheets are SHARED assets rather than this character's own - they are named as what
  they are, and repainting one changes it everywhere it is used.

## Sheets

  pmc_hum_mechanic_ub                 512x512     4871 tris  0x98529145
  pmc_hum_mechanic_hair               512x512     4156 tris  0xD889B9C8
  pmc_hum_mechanic_head               512x512     4036 tris  0x1C394F9A
  pmc_hum_mechanic_lb                 512x512     3585 tris  0x87F9725E
  tex_0xDFCDA372                      256x256     1873 tris  0xDFCDA372
  tex_0xE27C6F51                       64x128     1862 tris  0xE27C6F51
  tex_0xFC1431D5                      256x256     1254 tris  0xFC1431D5
  tex_0x7411ADBD                      256x256     1228 tris  0x7411ADBD
  pmc_hum_jennifer_eyelashes           64x32       699 tris  0x83E4A64E
  tex_0xF32A4CF5                      128x128      436 tris  0xF32A4CF5
  tex_0x5AAB9E8A                       64x64       312 tris  0x5AAB9E8A
  pr_hum_boss_eye                     256x256      284 tris  0x5EBD193E

## Then what

Drop the finished PNGs into mercs2-skinner, which shows them on the model and exports
either a modkit mod or a new standalone asset. Normal (_nm) and specular (_sm) maps are not
included - a recolour keeps the same fabric surface, so leaving them alone is usually right.
