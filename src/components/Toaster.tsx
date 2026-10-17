import { dismissToast, useToast } from '#/lib/toast'

export function Toaster() {
  const toast = useToast()
  return (
    <div role="status" aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex justify-center px-4">
      {toast && (
        <div
          key={toast.id}
          className="pointer-events-auto flex max-w-[560px] items-center gap-4 rounded-xl bg-ink py-2.5 pr-2 pl-4 text-sm text-white shadow-[0_10px_30px_rgba(0,0,0,0.25)]"
        >
          <span className="min-w-0 break-words">{toast.text}</span>
          <div className="flex flex-none items-center gap-1">
            {toast.action && (
              <button
                type="button"
                onClick={() => {
                  const run = toast.action!.run
                  dismissToast()
                  void run()
                }}
                className="h-8 rounded-lg px-3 font-semibold hover:bg-white/15"
              >
                {toast.action.label}
              </button>
            )}
            <button
              type="button"
              aria-label="Dismiss"
              onClick={dismissToast}
              className="flex size-8 items-center justify-center rounded-lg text-white/70 hover:bg-white/15 hover:text-white"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
