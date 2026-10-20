import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

export interface MenuItem {
  label: string
  onSelect: () => void
  danger?: boolean
  /** A line under the label, saying what it does. */
  hint?: string
  /** For a choice of one: whether this is the current one. */
  checked?: boolean
}

/**
 * A small ⋯ menu: click or Enter opens it, arrows move, Escape or a click outside closes it.
 * With `trigger`, it opens from a labelled button instead, like a picker.
 */
export function Menu({
  label,
  items,
  size = 'md',
  trigger,
  triggerClassName,
  footer,
  badge,
}: {
  label: string
  items: MenuItem[]
  size?: 'sm' | 'md'
  trigger?: ReactNode
  /** The labelled trigger's look, when it should match something else (e.g. a chip). */
  triggerClassName?: string
  /** A quiet line at the bottom, under a rule: read, not picked, so the arrows skip it. */
  footer?: ReactNode
  /** A small dot on the ⋯ button, for something that's on. */
  badge?: boolean
}) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const opener = useRef<HTMLButtonElement>(null)
  const list = useRef<HTMLDivElement>(null)
  // Drawn over the page, so a card that hides its overflow can't cut it off.
  const [at, setAt] = useState<{
    top?: number
    bottom?: number
    left?: number
    right?: number
    maxHeight: number
  } | null>(null)

  useLayoutEffect(() => {
    // Forget the last spot, so the list is measured at full height before it's placed.
    if (!open) return setAt(null)
    if (!opener.current) return
    const r = opener.current.getBoundingClientRect()
    const width = list.current?.offsetWidth ?? 192
    const height = list.current?.offsetHeight ?? 0
    const below = window.innerHeight - r.bottom - 12
    const above = r.top - 12
    // Under its button, or over it when it wouldn't fit below and there's more room above.
    const up = height > below && above > below
    const side = r.right - width >= 8 ? { right: window.innerWidth - r.right } : { left: Math.max(8, r.left) }
    setAt(
      up
        ? { bottom: window.innerHeight - r.top + 4, maxHeight: above, ...side }
        : { top: r.bottom + 4, maxHeight: below, ...side },
    )
  }, [open])

  useEffect(() => {
    if (!open) return
    // A picker opens on the current choice.
    const first =
      list.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]') ??
      list.current?.querySelector<HTMLButtonElement>('[role^="menuitem"]')
    first?.focus()
    const onDown = (e: MouseEvent) => {
      const inside = root.current?.contains(e.target as Node) || list.current?.contains(e.target as Node)
      if (!inside) setOpen(false)
    }
    // It doesn't follow its button around, so it closes instead.
    const onMove = (e: Event) => {
      // Scrolling a long list inside the menu keeps it open.
      if (e.type === 'scroll' && list.current?.contains(e.target as Node)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    window.addEventListener('resize', onMove)
    window.addEventListener('scroll', onMove, true)
    return () => {
      document.removeEventListener('mousedown', onDown)
      window.removeEventListener('resize', onMove)
      window.removeEventListener('scroll', onMove, true)
    }
  }, [open])

  function onKeyDown(e: React.KeyboardEvent) {
    const buttons = [...(list.current?.querySelectorAll<HTMLButtonElement>('[role^="menuitem"]') ?? [])]
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement)
    if (e.key === 'Escape') {
      e.preventDefault()
      setOpen(false)
      opener.current?.focus()
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      buttons[(i + 1) % buttons.length]?.focus()
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      buttons[(i - 1 + buttons.length) % buttons.length]?.focus()
    } else if (e.key === 'Tab') {
      setOpen(false)
    }
  }

  const box = size === 'sm' ? 'size-8' : 'size-10'
  return (
    <div ref={root} className="relative" onClick={(e) => e.stopPropagation()}>
      <button
        ref={opener}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={
          trigger && triggerClassName
            ? `${triggerClassName} ${open ? 'border-ink-faint text-ink' : ''}`
            : trigger
              ? `inline-flex h-9 items-center gap-1 rounded-lg border border-line px-2.5 text-[13px] font-medium whitespace-nowrap hover:bg-line-soft ${open ? 'bg-line-soft' : ''}`
              : `relative flex ${box} items-center justify-center rounded-[10px] text-ink-soft hover:bg-line-soft hover:text-ink ${open ? 'bg-line-soft text-ink' : ''}`
        }
      >
        {trigger ?? (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <circle cx="5" cy="12" r="1.8" />
            <circle cx="12" cy="12" r="1.8" />
            <circle cx="19" cy="12" r="1.8" />
          </svg>
        )}
        {badge && <span aria-hidden="true" className="absolute top-1.5 right-1.5 size-2 rounded-full bg-ok" />}
      </button>
      {open &&
        createPortal(
          <div
            ref={list}
            role="menu"
            aria-label={label}
            onKeyDown={onKeyDown}
            onClick={(e) => e.stopPropagation()}
            style={{
              position: 'fixed',
              top: at ? at.top : -9999,
              bottom: at?.bottom,
              left: at?.left,
              right: at?.right,
              maxHeight: at?.maxHeight,
              visibility: at ? 'visible' : 'hidden',
            }}
            className="z-50 flex min-w-48 flex-col overflow-y-auto rounded-xl border border-line bg-surface p-1 shadow-[0_12px_32px_rgba(0,0,0,0.12)]"
          >
            {items.map((item) => (
              <button
                key={item.label}
                type="button"
                role={item.checked === undefined ? 'menuitem' : 'menuitemradio'}
                aria-checked={item.checked}
                onClick={() => {
                  setOpen(false)
                  if (trigger) opener.current?.focus()
                  item.onSelect()
                }}
                className={`flex min-h-9 items-center gap-2 rounded-lg px-3 py-1.5 text-left text-[13px] font-medium outline-none hover:bg-line-soft focus:bg-line-soft ${item.danger ? 'text-err' : ''}`}
              >
                {item.checked !== undefined && (
                  <span aria-hidden="true" className="w-3 flex-none text-ink">
                    {item.checked ? '✓' : ''}
                  </span>
                )}
                <span className="flex flex-col">
                  {item.label}
                  {item.hint && <span className="text-xs font-normal text-ink-soft">{item.hint}</span>}
                </span>
              </button>
            ))}
            {footer && (
              <div className="mt-1 border-t border-line px-3 pt-2 pb-1.5 text-xs text-ink-faint select-text">
                {footer}
              </div>
            )}
          </div>,
          document.body,
        )}
    </div>
  )
}
