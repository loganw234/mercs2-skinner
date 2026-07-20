# How a model's LOD chain is actually linked

Established 2026-07-20 by dumping vz.wad's ASET table and cross-referencing four exported
bundles. This corrects an assumption that cost a wasted experiment and one crash.

## The mechanism

An ASET row is `{asset_hash, secondary_ref, packed_block_ref, type_id}`, where the packed
reference decodes to `(block_index, sub)`. For a character model, **`sub` is the index of
the SECOND block holding the finer LOD rungs** — it is not a sub-entry ordinal:

| model | ASET block | sub | manifest `lod_chain` |
|---|---|---|---|
| `civ_hum_beachfemale_a` | 2110 | **4587** | `[2110, 4587]` ✅ |
| `pmc_hum_mechanic` | 2579 | 65535 | `[2579]` |
| `pmc_hum_mattias` | 1307 | 65535 | `[1307]` |
| `pmc_hum_chris` | 2552 | 65535 | `[2552]` |

`65535` means "no second block". The chain is **in the ASET row**, not in the block path
naming — which is what I had assumed, and which sent me appending containers into a block
where the engine was never going to look for them.

## Consequences

**Single-block characters clone correctly today.** Mattias, Chris and the mechanic have no
second block, so an additive clone of one loses nothing. That is why the bundled `blueprint`
sample on `pmc_hum_mechanic` looks sharp while the rainbow set on `civ_hum_beachfemale_a`
comes out flat: different LOD structures, not different pipelines.

**Two-block characters cannot be cloned correctly with the published tools.**
`mercs2_smuggler --inject-extra` writes `sub = 65535`, so the clone is resident-only and
renders its coarsest tier at every distance — 639 triangles instead of 3,856.

**Appending containers into an existing block does not work.** They are unreachable without
an ASET row of their own, and asking for one is not a graceful failure: `Player.SetOutfit`
on an unresolvable name **crashes the game to desktop**.

## What would fix it

An injector able to write an ASET row with a chosen second-block reference — i.e. construct
`AsetEntry` with `packed_block_ref = (resident_block << 16) | lod_block` instead of forcing
`65535`. `mercs2_formats::patch_wad::AsetEntry` already exposes this; the modkit's
`wad_builder` imports it directly. It is a flag on the injector, not a new subsystem.

## Safety rule for generated Lua

Never call `Player.SetOutfit` on a name that has not been confirmed to resolve. There is no
soft failure. And do not rely on `Pg.AssetExists` as the guard — it threw here (the pcall
reported `call failed`), so a check written around it silently does nothing and the unsafe
call proceeds anyway.
