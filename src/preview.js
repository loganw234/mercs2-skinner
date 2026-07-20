// Textured 3D preview. Raw WebGL, no three.js -- the tool has to stay one self-contained
// file with no network access, and this needs exactly one shader.
//
// The point of the preview is to answer "does my paint land where I think it does", so it
// shows the edited texture on the real geometry with flat-ish lighting: strong shading
// would hide exactly the seam and stretch problems the user is looking for.

const VS = `
attribute vec3 aPos; attribute vec2 aUV; attribute vec3 aNrm;
uniform mat4 uMVP; uniform mat4 uModel;
varying vec2 vUV; varying vec3 vNrm;
void main() {
  vUV = aUV;
  vNrm = mat3(uModel) * aNrm;
  gl_Position = uMVP * vec4(aPos, 1.0);
}`;

const FS = `
precision mediump float;
varying vec2 vUV; varying vec3 vNrm;
uniform sampler2D uTex;
uniform float uLit;
void main() {
  vec4 t = texture2D(uTex, vUV);
  // Deliberately shallow lighting: 0.75 ambient + 0.25 wrap diffuse keeps the texture
  // readable everywhere instead of burying half the model in shadow.
  float d = max(dot(normalize(vNrm), normalize(vec3(0.4, 0.8, 0.6))), 0.0);
  float l = mix(1.0, 0.75 + 0.25 * d, uLit);
  gl_FragColor = vec4(t.rgb * l, 1.0);
}`;

const perspective = (fovy, aspect, n, f) => {
  const t = 1 / Math.tan(fovy / 2);
  return [t / aspect, 0, 0, 0, 0, t, 0, 0, 0, 0, (f + n) / (n - f), -1, 0, 0, (2 * f * n) / (n - f), 0];
};

function lookAt(eye, ctr, up) {
  const z = norm3(sub3(eye, ctr));
  const x = norm3(cross3(up, z));
  const y = cross3(z, x);
  return [x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0,
          -dot3(x, eye), -dot3(y, eye), -dot3(z, eye), 1];
}
const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm3 = (a) => { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
function mul4(a, b) {
  const o = new Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    let s = 0;
    for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
    o[c * 4 + r] = s;
  }
  return o;
}
const rotY = (t) => [Math.cos(t), 0, -Math.sin(t), 0, 0, 1, 0, 0, Math.sin(t), 0, Math.cos(t), 0, 0, 0, 0, 1];
const rotX = (t) => [1, 0, 0, 0, 0, Math.cos(t), Math.sin(t), 0, 0, -Math.sin(t), Math.cos(t), 0, 0, 0, 0, 1];

export class Preview {
  constructor(canvas) {
    this.cv = canvas;
    this.gl = canvas.getContext('webgl', { antialias: true, alpha: true });
    this.ok = !!this.gl;
    this.yaw = 0.6; this.pitch = 0.1; this.dist = 3; this.lit = 1;
    if (!this.ok) return;
    const gl = this.gl;
    this.prog = link(gl, VS, FS);
    this.loc = {
      aPos: gl.getAttribLocation(this.prog, 'aPos'),
      aUV: gl.getAttribLocation(this.prog, 'aUV'),
      aNrm: gl.getAttribLocation(this.prog, 'aNrm'),
      uMVP: gl.getUniformLocation(this.prog, 'uMVP'),
      uModel: gl.getUniformLocation(this.prog, 'uModel'),
      uTex: gl.getUniformLocation(this.prog, 'uTex'),
      uLit: gl.getUniformLocation(this.prog, 'uLit'),
    };
    this.buf = { pos: gl.createBuffer(), uv: gl.createBuffer(), nrm: gl.createBuffer(), idx: gl.createBuffer() };
    this.tex = gl.createTexture();
    this.count = 0;

    let drag = null;
    canvas.addEventListener('pointerdown', (e) => { drag = { x: e.offsetX, y: e.offsetY, yaw: this.yaw, pitch: this.pitch }; canvas.setPointerCapture(e.pointerId); });
    canvas.addEventListener('pointermove', (e) => {
      if (!drag) return;
      this.yaw = drag.yaw + (e.offsetX - drag.x) * 0.01;
      this.pitch = Math.max(-1.4, Math.min(1.4, drag.pitch + (e.offsetY - drag.y) * 0.01));
      this.draw();
    });
    canvas.addEventListener('pointerup', () => { drag = null; });
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.dist = Math.max(0.4, Math.min(20, this.dist * (1 + Math.sign(e.deltaY) * 0.12)));
      this.draw();
    }, { passive: false });
  }

  setGeometry(geo) {
    if (!this.ok || !geo) { this.count = 0; return; }
    const gl = this.gl;
    // Index range decides whether we need the 32-bit index extension; most single-texture
    // groups fit in 16 bits, so only reach for it when the model actually demands it.
    const need32 = geo.index.length && geo.position.length / 3 > 65535;
    this.ext32 = need32 ? gl.getExtension('OES_element_index_uint') : null;
    if (need32 && !this.ext32) { this.count = 0; this.error = 'model needs 32-bit indices, unsupported here'; return; }
    this.idxType = need32 ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT;
    const idx = need32 ? geo.index : new Uint16Array(geo.index);

    bind(gl, this.buf.pos, geo.position);
    bind(gl, this.buf.uv, geo.uv);
    bind(gl, this.buf.nrm, geo.normal);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.buf.idx);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
    this.count = idx.length;

    // Frame the geometry so it fills the view regardless of model scale.
    let mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
    for (let i = 0; i < geo.position.length; i += 3) {
      for (let c = 0; c < 3; c++) {
        mn[c] = Math.min(mn[c], geo.position[i + c]);
        mx[c] = Math.max(mx[c], geo.position[i + c]);
      }
    }
    this.center = [(mn[0] + mx[0]) / 2, (mn[1] + mx[1]) / 2, (mn[2] + mx[2]) / 2];
    this.radius = Math.max(1e-3, Math.hypot(mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]) / 2);
    this.dist = 2.6;
    this.draw();
  }

  /** @param {ImageData|HTMLCanvasElement|HTMLImageElement} img */
  setTexture(img) {
    if (!this.ok) return;
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    if (img instanceof ImageData) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, img.width, img.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(img.data.buffer));
    } else {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
    }
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    this.draw();
  }

  draw() {
    if (!this.ok) return;
    const gl = this.gl;
    const dpr = window.devicePixelRatio || 1;
    const w = this.cv.clientWidth, h = this.cv.clientHeight;
    if (this.cv.width !== w * dpr) { this.cv.width = w * dpr; this.cv.height = h * dpr; }
    gl.viewport(0, 0, this.cv.width, this.cv.height);
    gl.clearColor(0, 0, 0, 0);
    gl.enable(gl.DEPTH_TEST);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    if (!this.count) return;

    const r = this.radius || 1;
    const model = mul4(rotX(this.pitch), rotY(this.yaw));
    const view = lookAt([0, 0, this.dist * r * 2], [0, 0, 0], [0, 1, 0]);
    const proj = perspective(0.9, (w || 1) / (h || 1), r * 0.05, r * 40);
    // centre the model at the origin before rotating, so orbit does not swing it away
    const t = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -this.center[0], -this.center[1], -this.center[2], 1];
    const mv = mul4(model, t);
    const mvp = mul4(proj, mul4(view, mv));

    gl.useProgram(this.prog);
    gl.uniformMatrix4fv(this.loc.uMVP, false, new Float32Array(mvp));
    gl.uniformMatrix4fv(this.loc.uModel, false, new Float32Array(mv));
    gl.uniform1f(this.loc.uLit, this.lit);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.uniform1i(this.loc.uTex, 0);
    attrib(gl, this.buf.pos, this.loc.aPos, 3);
    attrib(gl, this.buf.uv, this.loc.aUV, 2);
    attrib(gl, this.buf.nrm, this.loc.aNrm, 3);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.buf.idx);
    gl.drawElements(gl.TRIANGLES, this.count, this.idxType, 0);
  }
}

function bind(gl, b, data) {
  gl.bindBuffer(gl.ARRAY_BUFFER, b);
  gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
}
function attrib(gl, b, loc, n) {
  if (loc < 0) return;
  gl.bindBuffer(gl.ARRAY_BUFFER, b);
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, n, gl.FLOAT, false, 0, 0);
}
function link(gl, vs, fs) {
  const c = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('shader: ' + gl.getShaderInfoLog(s));
    return s;
  };
  const p = gl.createProgram();
  gl.attachShader(p, c(gl.VERTEX_SHADER, vs));
  gl.attachShader(p, c(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('link: ' + gl.getProgramInfoLog(p));
  return p;
}
