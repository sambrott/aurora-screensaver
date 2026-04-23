import { useEffect, useRef } from 'react'

// --- WebGL1 aurora (from aurora-shader) ported to GLSL 300 es for pass 1 ---
const AURORA_VERT = `#version 300 es
in vec2 aPosition;
void main() {
  gl_Position = vec4(aPosition, 0.0, 1.0);
}
`

const AURORA_FRAG = `#version 300 es
precision highp float;
uniform vec2 iResolution;
uniform float iTime;
uniform vec2 iMouse;
uniform float uFlowSpeed;
uniform float uColorIntensity;
uniform float uNoiseLayers;
uniform float uMouseInfluence;
uniform float uBlackLevel;
out vec4 fragColor;
#define MARCH_STEPS 32
mat2 rot(float a) {
  float s = sin(a), c = cos(a);
  return mat2(c, -s, s, c);
}
float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float fbm(vec3 p) {
  float f = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 8; i++) {
    if (float(i) >= uNoiseLayers) break;
    f += amp * hash(p.xy);
    p *= 2.0;
    amp *= 0.5;
  }
  return f;
}
float map(vec3 p) {
  vec3 q = p;
  q.z += iTime * uFlowSpeed;
  vec2 mouse = (iMouse.xy / iResolution.xy - 0.5) * 2.0;
  q.xy += mouse * uMouseInfluence;
  float f = fbm(q * 2.0);
  f *= sin(p.y * 2.0 + iTime) * 0.5 + 0.5;
  return clamp(f, 0.0, 1.0);
}
void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * iResolution.xy) / iResolution.y;
  vec3 ro = vec3(0, -1, 0);
  vec3 rd = normalize(vec3(uv, 1.0));
  float skyT = clamp(rd.y * 0.5 + 0.52, 0.0, 1.0);
  vec3 skyHorizon = vec3(0.09, 0.06, 0.18);
  vec3 skyZenith = vec3(0.04, 0.035, 0.11);
  vec3 col = mix(skyHorizon, skyZenith, skyT);
  float t = 0.0;
  for (int i = 0; i < MARCH_STEPS; i++) {
    vec3 p = ro + rd * t;
    float density = map(p);
    if (density > 0.0) {
      vec3 auroraColor = 0.5 + 0.5 * cos(iTime * 0.5 + p.y * 2.0 + vec3(0, 2, 4));
      float micro = 0.88 + 0.26 * hash(
        p.xy * 9.0 + vec2(p.z * 3.0, p.z * 1.8) + vec2(iTime * 0.37, iTime * 0.21)
      );
      col += auroraColor * density * 0.14 * uColorIntensity * micro;
    }
    t += 0.1;
  }
  col *= 1.55;
  col = pow(clamp(col, 0.0, 1.0e3), vec3(0.92));
  float lum = dot(col, vec3(0.299, 0.587, 0.114));
  vec2 gPix = gl_FragCoord.xy;
  float g1 = hash(gPix * 0.68 + vec2(iTime * 11.3, iTime * 7.9)) - 0.5;
  float g2 = hash(gPix * 1.17 - vec2(iTime * 5.1, iTime * 8.6) + 41.7) - 0.5;
  float g3 = hash(gPix * 2.03 + iTime * 3.7) - 0.5;
  float grain = (g1 + 0.62 * g2 + 0.35 * g3) * 0.055;
  float grainW = 0.22 + 0.78 * clamp(lum * 4.0, 0.0, 1.0);
  col += grain * grainW;
  float blackAmt = clamp(uBlackLevel, 0.0, 1.0);
  vec3 minGlow = vec3(0.05, 0.04, 0.09);
  col = max(col, mix(minGlow, vec3(0.0), blackAmt));
  col = mix(col, vec3(0.0), blackAmt);
  fragColor = vec4(col, 1.0);
}
`

// --- High refraction + first-version glass overlay (tint, rim, spec) on same paths ---
const COMPOSITE_VERT = `#version 300 es
in vec2 aPosition;
void main() {
  gl_Position = vec4(aPosition, 0.0, 1.0);
}
`

const COMPOSITE_FRAG = `#version 300 es
precision highp float;
uniform float time;
uniform vec2 resolution;
uniform sampler2D uBackground;
out vec4 fragColor;

const float IOR = 1.55;
const float BLEND = 0.22;

float opSmoothUnion(float d1, float d2, float k) {
  float h = clamp(0.5 + 0.5 * (d2 - d1) / k, 0.0, 1.0);
  return mix(d2, d1, h) - k * h * (1.0 - h);
}

float sdCircle(vec2 p, float r) {
  return length(p) - r;
}

void bubbleCenters(
  in float t,
  out vec2 p0, out vec2 p1, out vec2 p2, out vec2 p3, out vec2 p4
) {
  p0 = vec2(cos(t * 0.9) * 0.42, sin(t * 1.4) * 0.28);
  p1 = vec2(cos(t * 0.7 + 2.2) * 0.35, sin(t * 1.1 + 1.0) * 0.32);
  p2 = vec2(cos(t * 1.1 + 4.0) * 0.38, sin(t * 0.9 + 3.3) * 0.24);
  p3 = vec2(cos(t * 0.85 + 5.5) * 0.28, sin(t * 1.25) * 0.38);
  p4 = vec2(sin(t * 0.95) * 0.22, cos(t * 1.05 + 0.8) * 0.42);
}

void bubbleVelocities(
  in float t,
  out vec2 v0, out vec2 v1, out vec2 v2, out vec2 v3, out vec2 v4
) {
  v0 = vec2(-sin(t * 0.9) * 0.9 * 0.42,  cos(t * 1.4) * 1.4 * 0.28);
  v1 = vec2(-sin(t * 0.7 + 2.2) * 0.7 * 0.35, cos(t * 1.1 + 1.0) * 1.1 * 0.32);
  v2 = vec2(-sin(t * 1.1 + 4.0) * 1.1 * 0.38, cos(t * 0.9 + 3.3) * 0.9 * 0.24);
  v3 = vec2(-sin(t * 0.85 + 5.5) * 0.85 * 0.28, cos(t * 1.25) * 1.25 * 0.38);
  v4 = vec2( cos(t * 0.95) * 0.95 * 0.22, -sin(t * 1.05 + 0.8) * 1.05 * 0.42);
}

float scene(vec2 uv, float t) {
  float d = 1e9;
  vec2 p0, p1, p2, p3, p4;
  bubbleCenters(t, p0, p1, p2, p3, p4);
  d = opSmoothUnion(d, sdCircle(uv - p0, 0.18), BLEND);
  d = opSmoothUnion(d, sdCircle(uv - p1, 0.14), BLEND);
  d = opSmoothUnion(d, sdCircle(uv - p2, 0.12), BLEND);
  d = opSmoothUnion(d, sdCircle(uv - p3, 0.11), BLEND);
  d = opSmoothUnion(d, sdCircle(uv - p4, 0.095), BLEND);
  return d;
}

int dominantBubble(vec2 frag, float t, out float bestSd) {
  vec2 p0, p1, p2, p3, p4;
  bubbleCenters(t, p0, p1, p2, p3, p4);
  float s0 = sdCircle(frag - p0, 0.18);
  float s1 = sdCircle(frag - p1, 0.14);
  float s2 = sdCircle(frag - p2, 0.12);
  float s3 = sdCircle(frag - p3, 0.11);
  float s4 = sdCircle(frag - p4, 0.095);
  int idx = 0;
  bestSd = s0;
  if (s1 < bestSd) { bestSd = s1; idx = 1; }
  if (s2 < bestSd) { bestSd = s2; idx = 2; }
  if (s3 < bestSd) { bestSd = s3; idx = 3; }
  if (s4 < bestSd) { bestSd = s4; idx = 4; }
  return idx;
}

void centerVelRadius(int idx, float t, out vec2 c, out vec2 vel, out float rBall) {
  vec2 p0, p1, p2, p3, p4;
  vec2 v0, v1, v2, v3, v4;
  bubbleCenters(t, p0, p1, p2, p3, p4);
  bubbleVelocities(t, v0, v1, v2, v3, v4);
  if (idx == 0) { c = p0; vel = v0; rBall = 0.18; return; }
  if (idx == 1) { c = p1; vel = v1; rBall = 0.14; return; }
  if (idx == 2) { c = p2; vel = v2; rBall = 0.12; return; }
  if (idx == 3) { c = p3; vel = v3; rBall = 0.11; return; }
  c = p4; vel = v4; rBall = 0.095;
}

// Sample background with 5-tap cross blur to diffuse the refracted gradient
vec3 sampleBlur(sampler2D tex, vec2 uv, vec2 px, float rad) {
  vec2 o = px * rad;
  vec3 c = texture(tex, uv).rgb * 0.34;
  c += texture(tex, uv + vec2( o.x, 0.0)).rgb * 0.165;
  c += texture(tex, uv + vec2(-o.x, 0.0)).rgb * 0.165;
  c += texture(tex, uv + vec2(0.0,  o.y)).rgb * 0.165;
  c += texture(tex, uv + vec2(0.0, -o.y)).rgb * 0.165;
  return c;
}

void main() {
  vec2 frag = (gl_FragCoord.xy - 0.5 * resolution.xy) / resolution.y;
  float t = time;
  float d = scene(frag, t);

  // Analytic + stabilised normal (SDF gradient fallback)
  vec2 gSdf = vec2(dFdx(d), dFdy(d));
  vec2 nSdf = length(gSdf) < 1e-7 ? vec2(0.0, 1.0) : -normalize(gSdf);

  float bsd;
  int bi = dominantBubble(frag, t, bsd);
  vec2 c, velL;
  float rBall;
  centerVelRadius(bi, t, c, velL, rBall);
  float vlen = max(length(velL), 1e-4);
  vec2 vdir = velL / vlen;

  // Hemispheric normal for a circular cross-section, blended to SDF near merges
  vec2 fromC = frag - c;
  float rNorm = clamp(length(fromC) / rBall, 0.0, 1.0);
  float zHemi = sqrt(max(0.0, 1.0 - rNorm * rNorm));
  vec2 n2 = rNorm > 1e-4 ? fromC / length(fromC) : vec2(0.0, 1.0);
  float blobWeight = smoothstep(0.9, 1.02, rNorm);
  vec2 n = normalize(mix(n2, nSdf, blobWeight) + 1e-6);

  // Soft mask for refracted field (keeps the strong bend of the "high refraction" pass)
  float inGlass = 1.0 - smoothstep(0.0, 0.01, d);

  vec2 pPix = gl_FragCoord.xy;
  vec2 cPix = c * resolution.y + 0.5 * resolution;
  vec2 onePix = 1.0 / resolution;

  // On a sphere, the silhouette center is near-normal: almost no *lateral* refraction
  // (and no dark “pinhole” from overshooting UVs). Grazing = rim, where refraction is strong.
  float lateralSphere = 1.0 - zHemi; // 0 at center, 1 at edge

  // Lensing: magnify (sphere center acts as a simple lens) — keep z; avoid extra zHemi boost
  float r2 = rNorm * rNorm;
  float lensAmt = 0.58 + 0.30 * smoothstep(0.0, 1.0, 1.0 - r2) + 0.06 * rNorm;
  vec2 pMag = cPix + (pPix - cPix) * lensAmt;

  float refrPx = (1.0 - 1.0 / IOR) * 120.0 * pow(lateralSphere, 0.75);
  float rimBend = smoothstep(0.78, 1.0, rNorm) * 60.0;
  vec2 pRefr = pPix - n * (refrPx + rimBend);

  vec2 pGlass = pMag * 0.45 + pRefr * 0.55;

  // Parallax only where viewing is oblique, not at the pole (avoids spurious center shift)
  pGlass += vdir * (6.0 * lateralSphere);

  vec2 stGlass = clamp(pGlass / resolution, vec2(0.0), vec2(1.0));
  vec2 stBase = pPix / resolution;

  // --- Chromatic aberration: channel-split along the refraction direction ---
  float caBase = (0.0032 + 0.010 * smoothstep(0.6, 1.0, rNorm)) * (0.35 + 0.65 * lateralSphere);
  vec2 caDir = n;
  vec2 caU = caDir * caBase;
  float blurRad = mix(0.7, 3.2, lateralSphere);
  vec3 rSample = sampleBlur(uBackground, stGlass + caU * 1.4, onePix, blurRad);
  vec3 gSample = sampleBlur(uBackground, stGlass,            onePix, blurRad);
  vec3 bSample = sampleBlur(uBackground, stGlass - caU * 1.2, onePix, blurRad);
  vec3 warped = vec3(rSample.r, gSample.g, bSample.b);

  // Background behind glass (no refraction), used outside + for rim pickup
  vec3 baseBg = texture(uBackground, stBase).rgb;

  // High refraction: show warped aurora in the glass volume
  vec3 col = mix(baseBg, warped, inGlass);

  // First-version glassy overlay: tint + chroma body, ice rim + spec (add like the original)
  float inside = smoothstep(0.11, -0.035, d);
  float rim = exp(-32.0 * d * d) * smoothstep(0.07, 0.0, d);
  float spec = exp(-130.0 * d * d) * smoothstep(0.025, 0.0, d);
  vec3 ice = vec3(0.88, 0.96, 1.05);
  vec3 tint = vec3(0.52, 0.76, 1.0);
  vec3 chroma = 0.5 + 0.5 * cos(t * 0.55 + frag.xyx * 2.0 + vec3(0.0, 2.0, 4.0));
  vec3 bodyTint = mix(tint, chroma, 0.32) * inside * 0.2;
  // Rim/spec ice stroke: reduced 60% so refracted field reads through more
  vec3 edgeTint = ice * (rim * 0.88 + spec * 0.45) * 0.4;
  col += bodyTint;
  col += edgeTint;

  fragColor = vec4(col, 1.0);
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

const AURORA_DEFAULTS = {
  flowSpeed: 0.4,
  colorIntensity: 0.99,
  noiseLayers: 3.46,
  mouseInfluence: 0.0,
  blackLevel: 0.22,
} as const

class AuroraGlassRenderer {
  private fboSize: { w: number; h: number } = { w: 0, h: 0 }
  private readonly canvas: HTMLCanvasElement
  private readonly gl: WebGL2RenderingContext
  private readonly progAurora: WebGLProgram
  private readonly progComp: WebGLProgram
  private readonly buf: WebGLBuffer
  private readonly fbo: WebGLFramebuffer
  private readonly bgTex: WebGLTexture
  private readonly aVertAur: WebGLShader
  private readonly aFrag: WebGLShader
  private readonly cVert: WebGLShader
  private readonly cFrag: WebGLShader
  private readonly u: {
    iRes: WebGLUniformLocation | null
    iTime: WebGLUniformLocation | null
    iMouse: WebGLUniformLocation | null
    uFlow: WebGLUniformLocation | null
    uColor: WebGLUniformLocation | null
    uNoise: WebGLUniformLocation | null
    uMouseInf: WebGLUniformLocation | null
    uBlack: WebGLUniformLocation | null
    uCtime: WebGLUniformLocation | null
    uCres: WebGLUniformLocation | null
    uBg: WebGLUniformLocation | null
  }

  private readonly onMouseMove: (e: MouseEvent) => void
  private mouse: { x: number; y: number } = { x: 0.5, y: 0.5 }

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    const gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: false, antialias: true })
    if (!gl) throw new Error('WebGL2 not supported')
    this.gl = gl

    this.aVertAur = compileShader(gl, gl.VERTEX_SHADER, AURORA_VERT)!
    this.aFrag = compileShader(gl, gl.FRAGMENT_SHADER, AURORA_FRAG)!
    this.cVert = compileShader(gl, gl.VERTEX_SHADER, COMPOSITE_VERT)!
    this.cFrag = compileShader(gl, gl.FRAGMENT_SHADER, COMPOSITE_FRAG)!

    const pa = gl.createProgram()!
    const pc = gl.createProgram()!
    gl.attachShader(pa, this.aVertAur)
    gl.attachShader(pa, this.aFrag)
    gl.bindAttribLocation(pa, 0, 'aPosition')
    gl.linkProgram(pa)
    if (!gl.getProgramParameter(pa, gl.LINK_STATUS)) {
      throw new Error('Aurora program: ' + gl.getProgramInfoLog(pa))
    }
    gl.attachShader(pc, this.cVert)
    gl.attachShader(pc, this.cFrag)
    gl.bindAttribLocation(pc, 0, 'aPosition')
    gl.linkProgram(pc)
    if (!gl.getProgramParameter(pc, gl.LINK_STATUS)) {
      throw new Error('Composite program: ' + gl.getProgramInfoLog(pc))
    }
    this.progAurora = pa
    this.progComp = pc

    this.buf = gl.createBuffer()!
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf)
    gl.bufferData(gl.ARRAY_BUFFER, FULLSCREEN, gl.STATIC_DRAW)

    this.fbo = gl.createFramebuffer()!
    this.bgTex = gl.createTexture()!

    this.u = {
      iRes: gl.getUniformLocation(pa, 'iResolution'),
      iTime: gl.getUniformLocation(pa, 'iTime'),
      iMouse: gl.getUniformLocation(pa, 'iMouse'),
      uFlow: gl.getUniformLocation(pa, 'uFlowSpeed'),
      uColor: gl.getUniformLocation(pa, 'uColorIntensity'),
      uNoise: gl.getUniformLocation(pa, 'uNoiseLayers'),
      uMouseInf: gl.getUniformLocation(pa, 'uMouseInfluence'),
      uBlack: gl.getUniformLocation(pa, 'uBlackLevel'),
      uCtime: gl.getUniformLocation(pc, 'time'),
      uCres: gl.getUniformLocation(pc, 'resolution'),
      uBg: gl.getUniformLocation(pc, 'uBackground'),
    }

    const onMouseMove = (e: MouseEvent) => {
      const r = canvas.getBoundingClientRect()
      this.mouse = { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height }
    }
    this.onMouseMove = onMouseMove
    window.addEventListener('mousemove', onMouseMove)

    gl.disable(gl.DEPTH_TEST)
    gl.clearColor(0, 0, 0, 1)
  }

  resize() {
    const gl = this.gl
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const w = Math.max(1, Math.floor(this.canvas.clientWidth * dpr))
    const h = Math.max(1, Math.floor(this.canvas.clientHeight * dpr))
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w
      this.canvas.height = h
    }
    gl.viewport(0, 0, this.canvas.width, this.canvas.height)
    this.allocFbo(this.canvas.width, this.canvas.height)
  }

  private allocFbo(w: number, h: number) {
    if (this.fboSize.w === w && this.fboSize.h === h) return
    this.fboSize = { w, h }
    const gl = this.gl
    gl.bindTexture(gl.TEXTURE_2D, this.bgTex)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.bgTex, 0)
    const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    if (!ok) console.error('FBO incomplete')
  }

  private startTime = performance.now()
  private frameTime = 0

  render(nowMs: number) {
    const gl = this.gl
    this.frameTime = (nowMs - this.startTime) * 0.001
    const w = gl.canvas.width
    const h = gl.canvas.height

    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf)

    // Pass 1: aurora → FBO
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo)
    gl.viewport(0, 0, w, h)
    gl.clear(gl.COLOR_BUFFER_BIT)
    gl.useProgram(this.progAurora)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
    gl.uniform2f(this.u.iRes, w, h)
    gl.uniform1f(this.u.iTime, this.frameTime)
    gl.uniform2f(this.u.iMouse, this.mouse.x * w, (1.0 - this.mouse.y) * h)
    gl.uniform1f(this.u.uFlow, AURORA_DEFAULTS.flowSpeed)
    gl.uniform1f(this.u.uColor, AURORA_DEFAULTS.colorIntensity)
    gl.uniform1f(this.u.uNoise, AURORA_DEFAULTS.noiseLayers)
    gl.uniform1f(this.u.uMouseInf, AURORA_DEFAULTS.mouseInfluence)
    gl.uniform1f(this.u.uBlack, AURORA_DEFAULTS.blackLevel)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)

    // Pass 2: glass + lensing → screen
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.viewport(0, 0, w, h)
    gl.clear(gl.COLOR_BUFFER_BIT)
    gl.useProgram(this.progComp)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.bgTex)
    gl.uniform1i(this.u.uBg, 0)
    gl.uniform1f(this.u.uCtime, this.frameTime)
    gl.uniform2f(this.u.uCres, w, h)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
  }

  destroy() {
    const gl = this.gl
    window.removeEventListener('mousemove', this.onMouseMove)
    gl.deleteFramebuffer(this.fbo)
    gl.deleteTexture(this.bgTex)
    gl.deleteBuffer(this.buf)
    gl.deleteProgram(this.progAurora)
    gl.deleteProgram(this.progComp)
    gl.deleteShader(this.aVertAur)
    gl.deleteShader(this.aFrag)
    gl.deleteShader(this.cVert)
    gl.deleteShader(this.cFrag)
  }
}

export function ShaderComponent() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    let renderer: AuroraGlassRenderer
    try {
      renderer = new AuroraGlassRenderer(canvas)
    } catch (e) {
      console.error(e)
      return
    }

    let raf = 0
    const ro = new ResizeObserver(() => {
      renderer.resize()
    })
    ro.observe(canvas)

    const loop = (t: number) => {
      renderer.render(t)
      raf = requestAnimationFrame(loop)
    }

    renderer.resize()
    raf = requestAnimationFrame(loop)

    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      renderer.destroy()
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className="absolute inset-0 h-full w-full"
    />
  )
}
