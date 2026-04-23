import { useState, useCallback } from 'react'
import InteractiveShader from '@/components/ui/aurora-shader'
import {
  ShaderComponent,
  buildLavaPrompt,
  DEFAULT_LAVA,
  type LavaLampControlValues,
} from '@/components/ui/abstract-glassy-shader'

const SLIDERS: { key: keyof LavaLampControlValues; label: string; min: number; max: number; step: number }[] = [
  { key: 'morph', label: 'Morph (master surface)', min: 0, max: 1, step: 0.01 },
  { key: 'sizeScale', label: 'Size scale (0.6 = 40% smaller)', min: 0.35, max: 0.8, step: 0.01 },
  { key: 'merge', label: 'Merge / smooth-union', min: 0, max: 1, step: 0.01 },
  { key: 'edgeWave', label: 'Edge wave (rim undulation)', min: 0, max: 1, step: 0.01 },
  { key: 'axisPuff', label: 'Axis puff (lobe bulge)', min: 0, max: 1, step: 0.01 },
  { key: 'detail', label: 'Detail ripples', min: 0, max: 1, step: 0.01 },
  { key: 'whiteRim', label: 'White / ice band', min: 0.4, max: 1.5, step: 0.01 },
  { key: 'cpuMotion', label: 'CPU Liss wobble', min: 0, max: 1, step: 0.01 },
  { key: 'aaSoft', label: 'Edge anti-alias softness', min: 0, max: 1, step: 0.01 },
  { key: 'breathe', label: 'Expand / compress pulse (morph beat)', min: 0, max: 1, step: 0.01 },
]

/** Aurora (full pass) + lava with full control set + copy for prompts. */
export default function AuroraDemo() {
  const [lava, setLava] = useState<LavaLampControlValues>({ ...DEFAULT_LAVA })
  const [copied, setCopied] = useState(false)

  const setK = (key: keyof LavaLampControlValues, v: number) => {
    setLava((prev) => ({ ...prev, [key]: v }))
  }

  const copyAll = useCallback(() => {
    const text = buildLavaPrompt(lava)
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    })
  }, [lava])

  return (
    <div className="relative h-screen w-full">
      <InteractiveShader
        flowSpeed={0.4}
        colorIntensity={0.99}
        noiseLayers={3.46}
        mouseInfluence={0}
        blackLevel={0.22}
      />
      <ShaderComponent params={lava} />
      <div className="pointer-events-auto absolute bottom-4 right-4 z-20 max-h-[min(90vh,720px)] w-[min(100vw-2rem,320px)] select-none overflow-y-auto rounded-lg border border-white/15 bg-zinc-950/80 px-3 py-2.5 text-sm text-zinc-100 shadow-lg backdrop-blur">
        <div className="mb-2 font-medium">Lava controls</div>
        <p className="mb-2 text-[11px] leading-snug text-zinc-500">
          Defaults match your last saved JSON + breathe. Copy bundles JSON + prompt. Breathe adds
          isotropic in/out and pulsing wobble (not the sizeScale slider).
        </p>
        <div className="mb-2 flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={copyAll}
            className="rounded border border-sky-600/50 bg-sky-950/60 px-2 py-1 text-xs text-sky-100 transition hover:border-sky-400/60"
          >
            {copied ? 'Copied' : 'Copy values'}
          </button>
          <button
            type="button"
            onClick={() => setLava({ ...DEFAULT_LAVA })}
            className="rounded border border-zinc-600/80 bg-zinc-800/80 px-2 py-1 text-xs text-zinc-200"
          >
            Reset defaults
          </button>
        </div>
        <div className="flex flex-col gap-2 pr-0.5">
          {SLIDERS.map((s) => (
            <label key={s.key} className="block text-[11px] text-zinc-300">
              <div className="mb-0.5 flex justify-between text-zinc-500">
                <span>{s.label}</span>
                <span className="font-mono text-zinc-400">
                  {lava[s.key].toFixed(s.step < 0.1 ? 2 : 2)}
                </span>
              </div>
              <input
                type="range"
                min={s.min}
                max={s.max}
                step={s.step}
                value={lava[s.key]}
                onChange={(e) => setK(s.key, Number(e.target.value))}
                className="w-full accent-sky-400"
              />
            </label>
          ))}
        </div>
      </div>
    </div>
  )
}
