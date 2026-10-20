type P = { size?: number; className?: string }

const stroke = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
}

export const TerminalIcon = ({ size = 13, className }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...stroke} className={className} aria-hidden="true">
    <polyline points="4 17 10 11 4 5" />
    <line x1="12" y1="19" x2="20" y2="19" />
  </svg>
)

export const MailIcon = ({ size = 13, className }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...stroke} className={className} aria-hidden="true">
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <path d="m3 7 9 6 9-6" />
  </svg>
)

export const ConsoleIcon = ({ size = 13, className }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...stroke} className={className} aria-hidden="true">
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M3 9h18M8 13l2 2-2 2" />
  </svg>
)

export const PenIcon = ({ size = 13, className }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...stroke} className={className} aria-hidden="true">
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
  </svg>
)

export const PlayIcon = ({ size = 12, className }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
    <path d="M7 4.5v15l13-7.5z" />
  </svg>
)

export const StopIcon = ({ size = 12, className }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
    <rect x="5" y="5" width="14" height="14" rx="2" />
  </svg>
)

export const AlertIcon = ({ size = 16, className }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...stroke} className={className} aria-hidden="true">
    <circle cx="12" cy="12" r="9" />
    <line x1="12" y1="7.5" x2="12" y2="13" />
    <line x1="12" y1="16.5" x2="12" y2="16.6" />
  </svg>
)

export const PlusIcon = ({ size = 18, className }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...stroke} className={className} aria-hidden="true">
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
)

export const ArrowUpIcon = ({ size = 16, className }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...stroke} className={className} aria-hidden="true">
    <line x1="12" y1="19" x2="12" y2="5" />
    <path d="M5 12l7-7 7 7" />
  </svg>
)

export const ExternalIcon =({ size = 12, className }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...stroke} className={className} aria-hidden="true">
    <path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
  </svg>
)

export const PaperclipIcon = ({ size = 16, className }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...stroke} className={className} aria-hidden="true">
    <path d="m21.4 11.1-8.5 8.5a5.5 5.5 0 0 1-7.8-7.8l8.5-8.5a3.7 3.7 0 0 1 5.2 5.2l-8.5 8.5a1.8 1.8 0 0 1-2.6-2.6l7.8-7.8" />
  </svg>
)

export const ExpandIcon = ({ size = 14, className }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...stroke} className={className} aria-hidden="true">
    <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
  </svg>
)

export const ShrinkIcon = ({ size = 14, className }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...stroke} className={className} aria-hidden="true">
    <path d="M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7" />
  </svg>
)

export const sourceIcon = {
  manual: PenIcon,
  terminal: TerminalIcon,
  console: ConsoleIcon,
  email: MailIcon,
}
