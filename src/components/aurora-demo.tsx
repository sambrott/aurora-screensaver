import { ShaderComponent } from '@/components/ui/abstract-glassy-shader'

/** Full-screen aurora + liquid-glass bubbles (single WebGL2 pipeline). */
export default function AuroraDemo() {
  return (
    <div className="relative h-screen w-full">
      <ShaderComponent />
    </div>
  )
}
