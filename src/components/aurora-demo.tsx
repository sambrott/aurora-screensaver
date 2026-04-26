import InteractiveShader from '@/components/ui/aurora-shader'
import { ShaderComponent, DEFAULT_LAVA } from '@/components/ui/abstract-glassy-shader'

/** Aurora (full pass) + lava; controls panel removed for screensaver use. */
export default function AuroraDemo() {
  return (
    <div className="relative h-screen w-full">
      <InteractiveShader
        flowSpeed={0.4}
        colorIntensity={0.99}
        noiseLayers={3.46}
        mouseInfluence={0}
        blackLevel={0.22}
      />
      <ShaderComponent params={DEFAULT_LAVA} />
    </div>
  )
}
