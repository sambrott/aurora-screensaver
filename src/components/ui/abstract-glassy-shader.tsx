import { useEffect, useRef } from 'react'

// --- Lava: metaballs + uniforms; size via uSizeScale; morph split across controls ---

const VERT = `#version 300 es
in vec2 aPosition;
void main() {
  gl_Position = vec4(aPosition, 0.0, 1.0);
}
`

const FRAG = `#version 300 es
precision highp float;
uniform float time;
uniform vec2 resolution;
uniform vec2 uC0, uC1, uC2, uC3, uC4;
uniform float uMorph;
uniform float uSizeScale;
uniform float uMerge;
uniform float uEdgeWave;
uniform float uAxisPuff;
uniform float uDetail;
uniform float uRim;
uniform float uAASoft;
// Pulsing expand / compress: isotropic + wobble envelope (0 = off)
uniform float uBreathe;
out vec4 fragColor;

void fusionSpread(float t, out float kOut, out float spreadOut) {
  float g = mix(0.2, 0.48, clamp(uMerge, 0.0, 1.0)) + 0.02 * sin(t * 0.3 + 0.2);
  kOut = g;
  spreadOut = 1.0;
}

float opSmoothUnion(float d1, float d2, float k) {
  float h = clamp(0.5 + 0.5 * (d2 - d1) / k, 0.0, 1.0);
  return mix(d2, d1, h) - k * h * (1.0 - h);
}

mat2 mrot(float a) { float s = sin(a), c = cos(a); return mat2(c, -s, s, c); }

float sdMetaball(vec2 p, vec2 ctr, vec2 ax, float rot, float t, float ph) {
  vec2 q = mrot(-rot) * (p - ctr);
  vec2 qn = q / max(ax, vec2(1e-4));
  float rp = length(qn);
  float th = atan(qn.y, qn.x);
  float ew = clamp(uEdgeWave, 0.0, 1.0);
  float um = clamp(uMorph, 0.0, 1.0);
  float mBody = (0.12 + 0.9 * um) * (0.2 + 0.85 * ew) * 2.0;
  float mm = 1.0 + 1.4 * mBody;
  float tw = 1.0 + 0.6 * mBody;
  float w0 = 0.032 * mm * sin(2.0 * th + t * 0.48 * tw + ph);
  float w1 = 0.024 * mm * sin(1.3 * th - t * 0.4 * tw + ph * 0.8);
  float w2 = 0.014 * mm * sin(0.7 * th + 0.28 * sin(t * (0.22 + 0.3 * mBody) + ph * 0.25));
  float det = clamp(uDetail, 0.0, 1.0);
  float w3 = (0.01 + 0.022 * det) * mBody * sin(2.3 * th + 2.0 * ph + t * 0.62);
  float B = clamp(uBreathe, 0.0, 1.0);
  // Envelope + isotropic: time-only (shared across lobes) so smooth-union doesn’t kink
  float e1 = 0.5 + 0.5 * sin(t * 0.2);
  float e2 = 0.5 + 0.5 * sin(t * 0.32);
  float e3 = 0.5 + 0.5 * sin(t * 0.11);
  float e4 = 0.5 + 0.5 * sin(t * 0.27);
  float env = (e1 * e2 + e3 * e4) * 0.5;
  float qW = 1.0 - 0.38 * B * (1.0 - env);
  float sumW = w0 + w1 + w2 + w3;
  sumW *= qW;
  float sIso = 0.16 + 0.84 * clamp(um, 0.0, 1.0);
  // All-t only: one coherent radial pulse; tiny ph wiggle keeps it from static moiré
  float iso = 0.028 * B * sIso * (
    0.5 * sin(t * 0.22) +
    0.38 * sin(t * 0.095) +
    0.22 * sin(t * 0.165 + 0.12 * ph)
  );
  return (rp - 1.0 - sumW + iso) * min(ax.x, ax.y);
}

const float TSCALE = 0.7;

void metaballState(
  in float t,
  in float sp,
  in vec2 c0, in vec2 c1, in vec2 c2, in vec2 c3, in vec2 c4,
  out vec2 p0, out vec2 p1, out vec2 p2, out vec2 p3, out vec2 p4,
  out vec2 a0, out vec2 a1, out vec2 a2, out vec2 a3, out vec2 a4,
  out float r0, out float r1, out float r2, out float r3, out float r4
) {
  float s = t * TSCALE;
  p0 = c0 * sp; p1 = c1 * sp; p2 = c2 * sp; p3 = c3 * sp; p4 = c4 * sp;
  vec2 b0 = vec2(0.2, 0.144);
  vec2 b1 = vec2(0.165, 0.118);
  vec2 b2 = vec2(0.14, 0.102);
  vec2 b3 = vec2(0.123, 0.094);
  vec2 b4 = vec2(0.115, 0.082);
  float um = clamp(uMorph, 0.0, 1.0);
  float ap = clamp(uAxisPuff, 0.0, 1.0);
  float mA = (0.15 + 0.9 * um) * (0.2 + 0.85 * ap);
  float kx = 0.4 * (1.0 + 1.0 * mA);
  a0 = b0 * (vec2(1.0) + kx * vec2(sin(s * 0.6 + 0.1 + 0.2 * mA),  sin(s * 0.7 + 0.7 - 0.12 * mA)));
  a1 = b1 * (vec2(1.0) + kx * vec2(sin(s * 0.6 + 2.0 + 0.3 * mA),  sin(s * 0.65 + 1.0 + 0.1 * mA)));
  a2 = b2 * (vec2(1.0) + kx * vec2(sin(s * 0.62 + 2.4 - 0.08 * mA),  sin(s * 0.6 + 3.0 + 0.18 * mA)));
  a3 = b3 * (vec2(1.0) + 0.86 * kx * vec2(sin(s * 0.6 + 4.0 + 0.12 * mA),  sin(s * 0.7 + 2.5 - 0.08 * mA)));
  a4 = b4 * (vec2(1.0) + kx * vec2(sin(s * 0.6 + 0.2 + 0.2 * mA),  sin(s * 0.6 + 5.0 + 0.1 * mA)));
  // One shared lobe “breath” (same t phase for all) → no seam at smooth-union joins
  float Br = clamp(uBreathe, 0.0, 1.0) * 0.11;
  float pAll = 1.0 + Br * sin(s * 0.45);
  a0 *= pAll; a1 *= pAll; a2 *= pAll; a3 *= pAll; a4 *= pAll;
  r0 = s * 0.15 + 0.55; r1 = -s * 0.2 + 1.5; r2 =  s * 0.2 + 2.2; r3 = -s * 0.18 + 2.0; r4 =  s * 0.22 + 0.9;
}

float scene(vec2 uv, float t) {
  float d = 1e9;
  float kf, sp;
  fusionSpread(t, kf, sp);
  vec2 p0, p1, p2, p3, p4, a0, a1, a2, a3, a4;
  float r0, r1, r2, r3, r4;
  metaballState(t, sp, uC0, uC1, uC2, uC3, uC4, p0, p1, p2, p3, p4, a0, a1, a2, a3, a4, r0, r1, r2, r3, r4);
  d = opSmoothUnion(d, sdMetaball(uv, p0, a0, r0, t, 0.0), kf);
  d = opSmoothUnion(d, sdMetaball(uv, p1, a1, r1, t, 1.3), kf);
  d = opSmoothUnion(d, sdMetaball(uv, p2, a2, r2, t, 2.6), kf);
  d = opSmoothUnion(d, sdMetaball(uv, p3, a3, r3, t, 3.8), kf);
  d = opSmoothUnion(d, sdMetaball(uv, p4, a4, r4, t, 5.1), kf);
  return d;
}

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * resolution.xy) / resolution.y;
  float t = time;
  float S = clamp(uSizeScale, 0.25, 0.85);
  float d = S * scene(uv / S, t);
  float b = clamp(uBreathe, 0.0, 1.0);
  float sPx = (0.48 + 0.15 * b) / min(resolution.x, resolution.y);
  if (abs(d) < 0.13) {
    // 5-tap box on d: stabilizes fwidth/derivs when the surface breathes
    d = (d
      + S * scene((uv + vec2(sPx, 0.0)) / S, t)
      + S * scene((uv + vec2(-sPx, 0.0)) / S, t)
      + S * scene((uv + vec2(0.0, sPx)) / S, t)
      + S * scene((uv + vec2(0.0, -sPx)) / S, t)
    ) * 0.2;
  }
  float gL = max(length(vec2(dFdx(d), dFdy(d))), 1e-5);
  float as = clamp(uAASoft, 0.0, 1.0);
  float nRes = 1.0 / min(resolution.x, resolution.y);
  float minAA = nRes * (2.15 + 1.0 * as + 0.5 * b);
  float edgeW = 3.55 * (1.0 + 0.2 * b) * gL + minAA;
  float fill = 1.0 - smoothstep(0.0, edgeW, d);
  float rim = exp(-12.0 * d * d) * smoothstep(0.16, 0.0, d);
  float spec = exp(-58.0 * d * d) * smoothstep(0.055, 0.0, d);

  float rw = max(0.0, uRim);
  vec3 ice = vec3(0.98, 0.995, 1.0);
  vec3 tint = vec3(0.5, 0.74, 0.99);
  vec3 vary = 0.5 + 0.5 * cos(t * 0.4 + vec3(0.0, 2.0, 4.0));
  vec3 bodyCol = mix(tint, vary, 0.18);
  vec3 fillRgb = bodyCol * fill;
  vec3 edge = rw * ice * (rim * 0.95 + spec * 0.7);
  vec3 rgb = fillRgb + edge;
  float alpha = min(0.96, 0.9 * fill + 0.52 * rw * (rim + spec));
  fragColor = vec4(rgb, alpha);
}
`

function compileShader(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader | null {
  const s = gl.createShader(type)
  if (!s) return null
  gl.shaderSource(s, src)
  gl.compileShader(s)
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    console.error('Shader error:', gl.getShaderInfoLog(s), src.substring(0, 200))
    gl.deleteShader(s)
    return null
  }
  return s
}

const FULLSCREEN = new Float32Array([-1, 1, -1, -1, 1, 1, 1, -1])

const N = 5
const TSCALE = 0.7
const CLUSTER = 0.1
const PAD = 0.01
const K_FLOAT = 3.2
const B_DRAG = 0.55
const REST = 0.7
const WOBBLE = 0.02
const R_BALL_BASE = 0.2

function lissajous(tSec: number): Float32Array {
  const s = tSec * TSCALE
  const scale = CLUSTER
  const c = new Float32Array(10)
  c[0] = Math.cos(s * 0.9) * 0.42 * scale
  c[1] = Math.sin(s * 1.4) * 0.28 * scale
  c[2] = Math.cos(s * 0.7 + 2.2) * 0.35 * scale
  c[3] = Math.sin(s * 1.1 + 1.0) * 0.32 * scale
  c[4] = Math.cos(s * 1.1 + 4.0) * 0.38 * scale
  c[5] = Math.sin(s * 0.9 + 3.3) * 0.24 * scale
  c[6] = Math.cos(s * 0.85 + 5.5) * 0.28 * scale
  c[7] = Math.sin(s * 1.25) * 0.38 * scale
  c[8] = Math.sin(s * 0.95) * 0.22 * scale
  c[9] = Math.cos(s * 1.05 + 0.8) * 0.42 * scale
  return c
}

class LavaSim {
  p = new Float32Array(10)
  v = new Float32Array(10)
  w = 1
  h = 1
  rBall = R_BALL_BASE

  reset(w: number, h: number) {
    this.w = w
    this.h = h
    const c = lissajous(0)
    for (let i = 0; i < N; i++) {
      this.p[i * 2] = c[i * 2]
      this.p[i * 2 + 1] = c[i * 2 + 1]
      this.v[i * 2] = 0
      this.v[i * 2 + 1] = 0
    }
  }

  setWallRadiusForSizeScale(sizeScale: number) {
    this.rBall = R_BALL_BASE * Math.max(0.3, Math.min(0.85, sizeScale))
  }

  private bounds() {
    const a = this.w / this.h
    return {
      xMin: -0.5 * a + PAD,
      xMax: 0.5 * a - PAD,
      yMin: -0.5 + PAD,
      yMax: 0.5 - PAD,
    }
  }

  private wallSoft(i: number, t: number) {
    const b = this.bounds()
    const r = this.rBall
    const ix = i * 2
    const iy = ix + 1
    if (this.p[ix] < b.xMin + r) {
      this.p[ix] = b.xMin + r
      this.v[ix] = Math.abs(this.v[ix]) * REST
      this.v[iy] += 0.08 * Math.sin(2.4 * t + i * 0.3)
    }
    if (this.p[ix] > b.xMax - r) {
      this.p[ix] = b.xMax - r
      this.v[ix] = -Math.abs(this.v[ix]) * REST
      this.v[iy] += 0.08 * Math.sin(1.7 * t + i * 0.25)
    }
    if (this.p[iy] < b.yMin + r) {
      this.p[iy] = b.yMin + r
      this.v[iy] = Math.abs(this.v[iy]) * REST
      this.v[ix] += 0.08 * Math.cos(2.0 * t + i * 0.2)
    }
    if (this.p[iy] > b.yMax - r) {
      this.p[iy] = b.yMax - r
      this.v[iy] = -Math.abs(this.v[iy]) * REST
      this.v[ix] += 0.08 * Math.sin(1.5 * t - i * 0.2)
    }
  }

  private solveWalls(t: number) {
    for (let p = 0; p < 2; p++) {
      for (let i = 0; i < N; i++) {
        this.wallSoft(i, t)
      }
    }
  }

  step(dt: number, tSec: number, cpuMotion: number) {
    if (dt <= 0 || this.w < 1 || this.h < 1) return
    const cm = Math.max(0, Math.min(1, cpuMotion))
    const wob = WOBBLE * 0.55 * (0.2 + 0.85 * cm)
    const tar = lissajous(tSec)
    for (let i = 0; i < N; i++) {
      const wx = wob * (Math.sin(1.2 * tSec + 0.4 * i) + 0.7 * Math.sin(2.4 * tSec - i * 0.5))
      const wy = wob * (Math.cos(1.0 * tSec + 0.3 * i) + 0.7 * Math.cos(2.1 * tSec + 0.2 * i))
      const tx = tar[i * 2] + wx
      const ty = tar[i * 2 + 1] + wy
      const j = i * 2
      const ax = K_FLOAT * (tx - this.p[j]) - B_DRAG * this.v[j]
      const ay = K_FLOAT * (ty - this.p[j + 1]) - B_DRAG * this.v[j + 1]
      this.v[j] += ax * dt
      this.v[j + 1] += ay * dt
    }
    for (let i = 0; i < N; i++) {
      this.p[i * 2] += this.v[i * 2] * dt
      this.p[i * 2 + 1] += this.v[i * 2 + 1] * dt
    }
    this.solveWalls(tSec)
    const vmax = 0.65
    for (let i = 0; i < N; i++) {
      const m = this.v[i * 2] * this.v[i * 2] + this.v[i * 2 + 1] * this.v[i * 2 + 1]
      if (m > vmax * vmax) {
        const s = (vmax / Math.sqrt(m)) * 0.98
        this.v[i * 2] *= s
        this.v[i * 2 + 1] *= s
      }
    }
  }
}

/** All lava controls; copy this object for repro / prompts. */
export type LavaLampControlValues = {
  /** Master surface morph (0–1) */
  morph: number
  /** 0.6 ≈ 40% smaller; linear scale of the SDF */
  sizeScale: number
  /** Smooth-union / merge “glue” 0 = softer blend, 1 = tighter lobe contact */
  merge: number
  /** Rim + bulk edge wave 0–1 */
  edgeWave: number
  /** Per-lobe ellipsoid stretch 0–1 */
  axisPuff: number
  /** Fine ripples on the surface 0–1 */
  detail: number
  /** Brightness of the white / ice shell (≈0.6–1.4) */
  whiteRim: number
  /** Lissajous wobble in CPU sim 0–1 */
  cpuMotion: number
  /** Wider antialiasing / softer silhouette 0–1 */
  aaSoft: number
  /** Expand / compress “breath” on top of other morphs (0 = static envelope) 0–1 */
  breathe: number
}

export const DEFAULT_LAVA: LavaLampControlValues = {
  morph: 0.49,
  sizeScale: 0.44,
  merge: 0.61,
  edgeWave: 0.72,
  axisPuff: 0.71,
  detail: 0.65,
  whiteRim: 1.5,
  cpuMotion: 0.69,
  aaSoft: 0.59,
  breathe: 0.64,
}

function cloneLava(l: LavaLampControlValues): LavaLampControlValues {
  return { ...l }
}

class LavaLampLayer {
  private readonly canvas: HTMLCanvasElement
  private readonly gl: WebGL2RenderingContext
  private readonly program: WebGLProgram
  private readonly buf: WebGLBuffer
  private readonly u: {
    time: WebGLUniformLocation | null
    res: WebGLUniformLocation | null
    c: (WebGLUniformLocation | null)[]
    morph: WebGLUniformLocation | null
    sizeScale: WebGLUniformLocation | null
    merge: WebGLUniformLocation | null
    edgeWave: WebGLUniformLocation | null
    axisPuff: WebGLUniformLocation | null
    detail: WebGLUniformLocation | null
    rim: WebGLUniformLocation | null
    aaSoft: WebGLUniformLocation | null
    breathe: WebGLUniformLocation | null
  }
  private readonly sim = new LavaSim()
  private simClock = 0
  private readonly vs: WebGLShader
  private readonly fs: WebGLShader

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    const gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: false, antialias: true })
    if (!gl) {
      throw new Error('WebGL2 not supported')
    }
    this.gl = gl

    const vs = compileShader(gl, gl.VERTEX_SHADER, VERT)!
    const fs = compileShader(gl, gl.FRAGMENT_SHADER, FRAG)!
    this.vs = vs
    this.fs = fs
    const program = gl.createProgram()!
    gl.attachShader(program, vs)
    gl.attachShader(program, fs)
    gl.bindAttribLocation(program, 0, 'aPosition')
    gl.linkProgram(program)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error('Program link failed: ' + gl.getProgramInfoLog(program))
    }
    this.program = program

    const b = gl.createBuffer()!
    gl.bindBuffer(gl.ARRAY_BUFFER, b)
    gl.bufferData(gl.ARRAY_BUFFER, FULLSCREEN, gl.STATIC_DRAW)
    this.buf = b

    const c: (WebGLUniformLocation | null)[] = []
    for (let i = 0; i < 5; i++) c.push(gl.getUniformLocation(program, `uC${i}`))
    this.u = {
      time: gl.getUniformLocation(program, 'time'),
      res: gl.getUniformLocation(program, 'resolution'),
      c,
      morph: gl.getUniformLocation(program, 'uMorph'),
      sizeScale: gl.getUniformLocation(program, 'uSizeScale'),
      merge: gl.getUniformLocation(program, 'uMerge'),
      edgeWave: gl.getUniformLocation(program, 'uEdgeWave'),
      axisPuff: gl.getUniformLocation(program, 'uAxisPuff'),
      detail: gl.getUniformLocation(program, 'uDetail'),
      rim: gl.getUniformLocation(program, 'uRim'),
      aaSoft: gl.getUniformLocation(program, 'uAASoft'),
      breathe: gl.getUniformLocation(program, 'uBreathe'),
    }

    gl.disable(gl.DEPTH_TEST)
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
    gl.clearColor(0, 0, 0, 0)
  }

  resize() {
    const gl = this.gl
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5)
    const q = 0.9
    const w = Math.max(1, Math.floor(this.canvas.clientWidth * dpr * q))
    const h = Math.max(1, Math.floor(this.canvas.clientHeight * dpr * q))
    if (this.canvas.width === w && this.canvas.height === h) {
      return
    }
    this.canvas.width = w
    this.canvas.height = h
    gl.viewport(0, 0, w, h)
    this.sim.reset(w, h)
  }

  setUniform1f(loc: WebGLUniformLocation | null, v: number) {
    if (loc) {
      this.gl.uniform1f(loc, v)
    }
  }

  render(tSec: number, p: LavaLampControlValues) {
    const gl = this.gl
    const dt = this.simClock > 0 ? Math.min(0.04, (tSec - this.simClock) / 1000) : 0
    this.simClock = tSec
    this.sim.setWallRadiusForSizeScale(p.sizeScale)
    this.sim.step(dt, tSec * 0.001, p.cpuMotion)

    gl.clear(gl.COLOR_BUFFER_BIT)
    gl.useProgram(this.program)
    gl.enableVertexAttribArray(0)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
    this.setUniform1f(this.u.time, tSec * 0.001)
    if (this.u.res) {
      gl.uniform2f(this.u.res, gl.canvas.width, gl.canvas.height)
    }
    this.setUniform1f(this.u.morph, p.morph)
    this.setUniform1f(this.u.sizeScale, p.sizeScale)
    this.setUniform1f(this.u.merge, p.merge)
    this.setUniform1f(this.u.edgeWave, p.edgeWave)
    this.setUniform1f(this.u.axisPuff, p.axisPuff)
    this.setUniform1f(this.u.detail, p.detail)
    this.setUniform1f(this.u.rim, p.whiteRim)
    this.setUniform1f(this.u.aaSoft, p.aaSoft)
    this.setUniform1f(this.u.breathe, p.breathe)
    for (let i = 0; i < 5; i++) {
      const l = this.u.c[i]
      if (l) {
        const j = i * 2
        gl.uniform2f(l, this.sim.p[j], this.sim.p[j + 1])
      }
    }
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
  }

  destroy() {
    const gl = this.gl
    gl.deleteBuffer(this.buf)
    gl.deleteProgram(this.program)
    gl.deleteShader(this.vs)
    gl.deleteShader(this.fs)
  }
}

export function buildLavaPrompt(values: LavaLampControlValues): string {
  const json = JSON.stringify(values, null, 2)
  return [
    'Aurora screensaver — lava (metaball) layer parameters I want to keep:',
    '',
    json,
    '',
    'Meaning: morph=overall undulation; sizeScale=rendered SDF scale (1.0=full; <1=smaller);',
    'merge=smooth-union width; edgeWave/axisPuff/detail=rim vs lobe bulge vs fine ripples;',
    'whiteRim=ice band; cpuMotion=CPU Liss wobble; aaSoft=AA; breathe=expand/compress pulsing on morph.',
  ].join('\n')
}

export function ShaderComponent({ params }: { params: LavaLampControlValues }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const paramsRef = useRef(cloneLava(params))
  paramsRef.current = cloneLava(params)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    let layer: LavaLampLayer
    try {
      layer = new LavaLampLayer(canvas)
    } catch (e) {
      console.error(e)
      return
    }

    let raf = 0
    const t0 = performance.now()
    const ro = new ResizeObserver(() => layer.resize())
    ro.observe(canvas)

    const loop = (now: number) => {
      layer.render(now - t0, paramsRef.current)
      raf = requestAnimationFrame(loop)
    }
    layer.resize()
    raf = requestAnimationFrame(loop)

    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      layer.destroy()
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className="pointer-events-none absolute inset-0 z-10 h-full w-full"
    />
  )
}
