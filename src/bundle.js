// Reader for a `mercs2_workshop --export-bundle <name>` folder.
//
// The bundle already contains everything a reskin needs, it is just not usable as-is:
//   manifest.json  draw_groups[] -> {diffuse, normal, specular} texture hashes per group
//   model.gltf     the mesh, with TEXCOORD_0 on every primitive
//   model.bin      the vertex data
//   textures/      every texture already decoded to PNG
//   raw/           the ORIGINAL block bytes, which the additive path uses as a template
//
// This module joins them so a texture can be shown with the UV layout that actually maps
// onto it -- without that, painting a 1024x1024 sheet is guesswork.

import { nameForHash, describeName } from './names.js';

const COMPONENT = {
  5120: { get: (dv, o) => dv.getInt8(o), size: 1 },
  5121: { get: (dv, o) => dv.getUint8(o), size: 1 },
  5122: { get: (dv, o) => dv.getInt16(o, true), size: 2 },
  5123: { get: (dv, o) => dv.getUint16(o, true), size: 2 },
  5125: { get: (dv, o) => dv.getUint32(o, true), size: 4 },
  5126: { get: (dv, o) => dv.getFloat32(o, true), size: 4 },
};
const NCOMP = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

function accessor(gltf, bin, idx) {
  const a = gltf.accessors[idx];
  const n = NCOMP[a.type];
  const comp = COMPONENT[a.componentType];
  if (!comp) throw new Error('unsupported componentType ' + a.componentType);
  const bv = gltf.bufferViews[a.bufferView];
  const base = (bv.byteOffset || 0) + (a.byteOffset || 0);
  const stride = bv.byteStride || comp.size * n;
  const dv = new DataView(bin);
  const out = new Float32Array(a.count * n);
  for (let i = 0; i < a.count; i++) {
    for (let c = 0; c < n; c++) out[i * n + c] = comp.get(dv, base + i * stride + c * comp.size);
  }
  return { data: out, count: a.count, n };
}

const roleOf = (mat, hash) => {
  const e = mat.extras || {};
  const r = [];
  if (e.diffuse === hash) r.push('diffuse');
  if (e.normal === hash) r.push('normal');
  if (e.specular === hash) r.push('specular');
  return r;
};

/** Parse `LOD0_group2_seg10_node0` -> {lod:0, group:2, seg:10}. Purely for labelling. */
function parseMeshName(name) {
  const m = /LOD(\d+)_group(\d+)_seg(\d+)/.exec(name || '');
  return m ? { lod: +m[1], group: +m[2], seg: +m[3] } : null;
}

/**
 * @param {{manifest:object, gltf:object, bin:ArrayBuffer, textureFiles:Map<string,{width,height}>}} src
 */
export function readBundle({ manifest, gltf, bin, textureFiles = new Map() }) {
  const byHash = new Map();
  for (const t of manifest.textures || []) {
    byHash.set(t.hash, {
      hash: t.hash,
      file: t.file,
      width: t.width,
      height: t.height,
      declaredWidth: t.declared_width,
      declaredHeight: t.declared_height,
      fullResolution: t.full_resolution,
      roles: new Set(),
      groups: [],
      primitives: [],
      triangles: 0,
    });
  }

  // Walk every primitive once, attributing it to whichever textures its material names.
  const prims = [];
  (gltf.meshes || []).forEach((mesh, mi) => {
    const label = parseMeshName(mesh.name);
    mesh.primitives.forEach((p, pi) => {
      const mat = gltf.materials[p.material] || { extras: {} };
      const rec = { meshIndex: mi, primIndex: pi, name: mesh.name, label, material: mat, prim: p };
      prims.push(rec);
      for (const [hash, tex] of byHash) {
        const roles = roleOf(mat, hash);
        if (!roles.length) continue;
        roles.forEach((r) => tex.roles.add(r));
        tex.primitives.push(rec);
        if (label) tex.groups.push(label);
      }
    });
  });

  // Triangle counts and the LOD rung each texture is used at, for labelling.
  for (const tex of byHash.values()) {
    for (const rec of tex.primitives) {
      const p = rec.prim;
      if (p.indices !== undefined) tex.triangles += Math.floor(gltf.accessors[p.indices].count / 3);
    }
  }

  const textures = [...byHash.values()].map((t) => ({
    ...t,
    roles: [...t.roles],
    // Recovered engine name: makes the UI readable AND is required by the modkit export,
    // whose swap contract targets a texture by name rather than hash.
    name: nameForHash(t.hash),
    described: describeName(nameForHash(t.hash)),
    // Only the finest LOD rung is worth showing UVs for; coarser rungs reuse the sheet.
    bestLod: t.groups.length ? Math.min(...t.groups.map((g) => g.lod)) : null,
  })).sort((a, b) => {
    const rank = (x) => (x.roles.includes('diffuse') ? 0 : x.roles.includes('normal') ? 1 : x.roles.includes('specular') ? 2 : 3);
    return rank(a) - rank(b) || b.triangles - a.triangles;
  });

  return {
    name: manifest.name || 'model',
    modelHash: manifest.model_hash,
    skinned: manifest.skinned,
    manifest,
    gltf,
    bin,
    textures,
    prims,
    /** UV triangles (in 0..1) for every primitive that uses `hash`, finest LOD only. */
    uvTriangles(hash) {
      const tex = textures.find((t) => t.hash === hash);
      if (!tex) return [];
      const lod = tex.bestLod;
      const out = [];
      for (const rec of tex.primitives) {
        if (lod !== null && rec.label && rec.label.lod !== lod) continue;
        const p = rec.prim;
        if (p.attributes.TEXCOORD_0 === undefined || p.indices === undefined) continue;
        const uv = accessor(gltf, bin, p.attributes.TEXCOORD_0);
        const ix = accessor(gltf, bin, p.indices);
        for (let i = 0; i + 2 < ix.count; i += 3) {
          const a = ix.data[i], b = ix.data[i + 1], c = ix.data[i + 2];
          out.push([uv.data[a * 2], uv.data[a * 2 + 1],
                    uv.data[b * 2], uv.data[b * 2 + 1],
                    uv.data[c * 2], uv.data[c * 2 + 1]]);
        }
      }
      return out;
    },
    /** Interleaved geometry for the WebGL preview: finest LOD, primitives using `hash`. */
    geometryFor(hash) {
      const tex = textures.find((t) => t.hash === hash);
      if (!tex) return null;
      const lod = tex.bestLod;
      const pos = [], uvs = [], nrm = [], idx = [];
      let base = 0;
      for (const rec of tex.primitives) {
        if (lod !== null && rec.label && rec.label.lod !== lod) continue;
        const p = rec.prim;
        if (p.attributes.POSITION === undefined || p.indices === undefined) continue;
        const P = accessor(gltf, bin, p.attributes.POSITION);
        const T = p.attributes.TEXCOORD_0 !== undefined ? accessor(gltf, bin, p.attributes.TEXCOORD_0) : null;
        const N = p.attributes.NORMAL !== undefined ? accessor(gltf, bin, p.attributes.NORMAL) : null;
        const I = accessor(gltf, bin, p.indices);
        for (let i = 0; i < P.count; i++) {
          pos.push(P.data[i * 3], P.data[i * 3 + 1], P.data[i * 3 + 2]);
          uvs.push(T ? T.data[i * 2] : 0, T ? T.data[i * 2 + 1] : 0);
          nrm.push(N ? N.data[i * 3] : 0, N ? N.data[i * 3 + 1] : 1, N ? N.data[i * 3 + 2] : 0);
        }
        for (let i = 0; i < I.count; i++) idx.push(base + I.data[i]);
        base += P.count;
      }
      if (!pos.length) return null;
      return {
        position: new Float32Array(pos),
        uv: new Float32Array(uvs),
        normal: new Float32Array(nrm),
        index: new Uint32Array(idx),
      };
    },
  };
}

/** Group the loose files a user dropped into the pieces a bundle needs. */
export function sortBundleFiles(files) {
  const out = { manifest: null, gltf: null, bin: null, textures: new Map(), raw: new Map(), unknown: [] };
  for (const f of files) {
    const path = (f.webkitRelativePath || f.name).replace(/\\/g, '/');
    const base = path.split('/').pop().toLowerCase();
    if (base === 'manifest.json') out.manifest = f;
    else if (base.endsWith('.gltf')) out.gltf = f;
    else if (base.endsWith('.bin') && base !== 'model.bin' && !/\/textures\//.test(path)) out.bin = out.bin || f;
    else if (base === 'model.bin') out.bin = f;
    else if (base.endsWith('.png')) out.textures.set(base, f);
    else if (base.endsWith('.ucfx')) out.raw.set(base, f);
    else out.unknown.push(path);
  }
  return out;
}

export const MISSING_HINT =
  'Expected a folder produced by:  mercs2_workshop --export-bundle <character> --out <dir>\n' +
  'It should contain manifest.json, model.gltf, model.bin, textures/ and raw/.';
