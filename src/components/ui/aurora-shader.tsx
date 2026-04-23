import React, { useRef, useEffect } from 'react'

// Props interface for the InteractiveShader component
interface ShaderProps {
  flowSpeed?: number
  colorIntensity?: number
  noiseLayers?: number
  mouseInfluence?: number
  /** 0 = current colors, 1 = fully black (linear mix). */
  blackLevel?: number
}

// The core component responsible for rendering the WebGL shader
const InteractiveShader: React.FC<ShaderProps> = ({
  flowSpeed = 0.4,
  colorIntensity = 0.99,
  noiseLayers = 3.46,
  mouseInfluence = 0.0,
  blackLevel = 0.22,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const mousePos = useRef({ x: 0.5, y: 0.5 })

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const gl = canvas.getContext('webgl')
    if (!gl) {
      console.error('WebGL is not supported in this browser.')
      return
    }

    // --- Shader Sources ---
    const vertexShaderSource = `
      attribute vec2 aPosition;
      void main() {
        gl_Position = vec4(aPosition, 0.0, 1.0);
      }
    `

    // This fragment shader uses ray marching to render a volumetric aurora effect.
    const fragmentShaderSource = `
      precision highp float;
      uniform vec2 iResolution;
      uniform float iTime;
      uniform vec2 iMouse;
      uniform float uFlowSpeed;
      uniform float uColorIntensity;
      uniform float uNoiseLayers;
      uniform float uMouseInfluence;
      uniform float uBlackLevel;

      #define MARCH_STEPS 32

      // --- UTILITY & NOISE FUNCTIONS ---
      // 2D rotation matrix.
      mat2 rot(float a) {
          float s=sin(a), c=cos(a);
          return mat2(c, -s, s, c);
      }

      // Pseudo-random value generator.
      float hash(vec2 p) {
          p = fract(p * vec2(123.34, 456.21));
          p += dot(p, p+45.32);
          return fract(p.x*p.y);
      }

      // 3D Fractal Brownian Motion (FBM) for volumetric noise.
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

      // --- SCENE MAPPING ---
      // This function defines the density of the volume at a given point.
      float map(vec3 p) {
          vec3 q = p;
          // Animate the noise field over time.
          q.z += iTime * uFlowSpeed;
          // Mouse interaction: warp the space around the cursor.
          vec2 mouse = (iMouse.xy / iResolution.xy - 0.5) * 2.0;
          q.xy += mouse * uMouseInfluence;
          
          // Generate the base volumetric noise.
          float f = fbm(q * 2.0);
          
          // Carve out the aurora shape using sine waves.
          f *= sin(p.y * 2.0 + iTime) * 0.5 + 0.5;
          
          return clamp(f, 0.0, 1.0);
      }

      void main() {
        // --- UV & CAMERA SETUP ---
        vec2 uv = (gl_FragCoord.xy - 0.5 * iResolution.xy) / iResolution.y;
        vec3 ro = vec3(0, -1, 0); // Ray origin (camera position)
        vec3 rd = normalize(vec3(uv, 1.0)); // Ray direction

        // --- SKY (no true black at Black=0): deep twilight behind the aurora ---
        float skyT = clamp(rd.y * 0.5 + 0.52, 0.0, 1.0);
        vec3 skyHorizon = vec3(0.09, 0.06, 0.18);
        vec3 skyZenith = vec3(0.04, 0.035, 0.11);
        vec3 col = mix(skyHorizon, skyZenith, skyT);

        // --- VOLUMETRIC RAY MARCHING ---
        float t = 0.0; // Distance traveled along the ray.
        
        for (int i=0; i<MARCH_STEPS; i++) {
            vec3 p = ro + rd * t;
            
            // Get the density from our volume map.
            float density = map(p);
            
            if (density > 0.0) {
                // Define the color of the aurora based on position and time.
                vec3 auroraColor = 0.5 + 0.5 * cos(iTime * 0.5 + p.y * 2.0 + vec3(0,2,4));
                // Micro-noise on emission so smooth / cyan bands get the same grain as wispy regions.
                float micro = 0.88 + 0.26 * hash(p.xy * 9.0 + vec2(p.z * 3.0, p.z * 1.8) + vec2(iTime * 0.37, iTime * 0.21));
                col += auroraColor * density * 0.14 * uColorIntensity * micro;
            }
            
            // Step forward through the volume.
            t += 0.1;
        }

        // Lift overall exposure so "zero black" on the slider is a brighter scene (less crushed black).
        col *= 1.55;
        col = pow(clamp(col, 0.0, 1.0e3), vec3(0.92));

        // Screen-space grain (weighted toward luminance) so flat cyan areas show the same noise as the volume.
        float lum = dot(col, vec3(0.299, 0.587, 0.114));
        vec2 gPix = gl_FragCoord.xy;
        float g1 = hash(gPix * 0.68 + vec2(iTime * 11.3, iTime * 7.9)) - 0.5;
        float g2 = hash(gPix * 1.17 - vec2(iTime * 5.1, iTime * 8.6) + 41.7) - 0.5;
        float g3 = hash(gPix * 2.03 + iTime * 3.7) - 0.5;
        float grain = (g1 + 0.62 * g2 + 0.35 * g3) * 0.055;
        float grainW = 0.22 + 0.78 * clamp(lum * 4.0, 0.0, 1.0);
        col += grain * grainW;

        float blackAmt = clamp(uBlackLevel, 0.0, 1.0);
        // When Black is at 0, clamp away true black; as Black increases, allow crushing toward black before final mix.
        vec3 minGlow = vec3(0.05, 0.04, 0.09);
        col = max(col, mix(minGlow, vec3(0.0), blackAmt));

        col = mix(col, vec3(0.0), blackAmt);
        gl_FragColor = vec4(col, 1.0);
      }
    `

    // --- WebGL Setup (Boilerplate) ---
    const compileShader = (source: string, type: number): WebGLShader | null => {
      const shader = gl.createShader(type)
      if (!shader) return null
      gl.shaderSource(shader, source)
      gl.compileShader(shader)
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.error(`Shader compile error: ${gl.getShaderInfoLog(shader)}`)
        gl.deleteShader(shader)
        return null
      }
      return shader
    }

    const vertexShader = compileShader(vertexShaderSource, gl.VERTEX_SHADER)
    const fragmentShader = compileShader(fragmentShaderSource, gl.FRAGMENT_SHADER)
    if (!vertexShader || !fragmentShader) return

    const program = gl.createProgram()
    if (!program) return
    gl.attachShader(program, vertexShader)
    gl.attachShader(program, fragmentShader)
    gl.linkProgram(program)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error(`Program linking error: ${gl.getProgramInfoLog(program)}`)
      return
    }
    gl.useProgram(program)

    const vertices = new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1])
    const vertexBuffer = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer)
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW)

    const aPosition = gl.getAttribLocation(program, 'aPosition')
    gl.enableVertexAttribArray(aPosition)
    gl.vertexAttribPointer(aPosition, 2, gl.FLOAT, false, 0, 0)

    const iResolutionLocation = gl.getUniformLocation(program, 'iResolution')
    const iTimeLocation = gl.getUniformLocation(program, 'iTime')
    const iMouseLocation = gl.getUniformLocation(program, 'iMouse')
    const uFlowSpeedLocation = gl.getUniformLocation(program, 'uFlowSpeed')
    const uColorIntensityLocation = gl.getUniformLocation(program, 'uColorIntensity')
    const uNoiseLayersLocation = gl.getUniformLocation(program, 'uNoiseLayers')
    const uMouseInfluenceLocation = gl.getUniformLocation(program, 'uMouseInfluence')
    const uBlackLevelLocation = gl.getUniformLocation(program, 'uBlackLevel')

    // --- Animation and Interaction ---
    const startTime = performance.now()
    let animationFrameId: number

    const handleMouseMove = (e: MouseEvent) => {
      if (!canvas) return
      const rect = canvas.getBoundingClientRect()
      mousePos.current = {
        x: (e.clientX - rect.left) / rect.width,
        y: (e.clientY - rect.top) / rect.height,
      }
    }
    window.addEventListener('mousemove', handleMouseMove)

    const resizeCanvas = () => {
      canvas.width = canvas.clientWidth
      canvas.height = canvas.clientHeight
      gl.viewport(0, 0, gl.canvas.width, gl.canvas.height)
      gl.uniform2f(iResolutionLocation, gl.canvas.width, gl.canvas.height)
    }
    window.addEventListener('resize', resizeCanvas)
    resizeCanvas()

    const renderLoop = () => {
      if (!gl || gl.isContextLost()) return

      const currentTime = performance.now()
      gl.uniform1f(iTimeLocation, (currentTime - startTime) / 1000.0)

      gl.uniform2f(
        iMouseLocation,
        mousePos.current.x * canvas.width,
        (1.0 - mousePos.current.y) * canvas.height,
      )
      gl.uniform1f(uFlowSpeedLocation, flowSpeed)
      gl.uniform1f(uColorIntensityLocation, colorIntensity)
      gl.uniform1f(uNoiseLayersLocation, noiseLayers)
      gl.uniform1f(uMouseInfluenceLocation, mouseInfluence)
      gl.uniform1f(uBlackLevelLocation, blackLevel)

      gl.drawArrays(gl.TRIANGLES, 0, 6)
      animationFrameId = requestAnimationFrame(renderLoop)
    }
    renderLoop()

    // Cleanup function to prevent memory leaks
    return () => {
      cancelAnimationFrame(animationFrameId)
      window.removeEventListener('resize', resizeCanvas)
      window.removeEventListener('mousemove', handleMouseMove)
      if (gl && !gl.isContextLost()) {
        gl.deleteProgram(program)
        gl.deleteShader(vertexShader)
        gl.deleteShader(fragmentShader)
        gl.deleteBuffer(vertexBuffer)
      }
    }
  }, [flowSpeed, colorIntensity, noiseLayers, mouseInfluence, blackLevel])

  return <canvas ref={canvasRef} className="absolute top-0 left-0 h-full w-full" />
}

export default InteractiveShader
