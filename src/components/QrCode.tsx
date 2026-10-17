import QRCode from 'qrcode'
import { useMemo } from 'react'

/** A QR code drawn as one SVG path, so it stays sharp and follows the text colour. */
export function QrCode({ value, size = 168, label }: { value: string; size?: number; label: string }) {
  const { d, n } = useMemo(() => {
    const { modules } = QRCode.create(value, { errorCorrectionLevel: 'M' })
    const quiet = 2
    let path = ''
    for (let y = 0; y < modules.size; y++) {
      for (let x = 0; x < modules.size; x++) {
        if (modules.get(y, x)) path += `M${x + quiet} ${y + quiet}h1v1h-1z`
      }
    }
    return { d: path, n: modules.size + quiet * 2 }
  }, [value])

  return (
    <svg
      role="img"
      aria-label={label}
      width={size}
      height={size}
      viewBox={`0 0 ${n} ${n}`}
      shapeRendering="crispEdges"
      className="flex-none rounded-lg bg-white text-ink"
    >
      <path d={d} fill="currentColor" />
    </svg>
  )
}
