import { clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'
import type { ButtonHTMLAttributes } from 'react'

type Variant = 'primary' | 'ghost'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  loading?: boolean
  /** Share of the work done, 0–1. Fills the button from the left while loading. */
  progress?: number | null
}

export function Button({
  variant = 'primary',
  loading,
  progress,
  className,
  children,
  ...props
}: ButtonProps) {
  const showProgress = loading && progress != null
  return (
    <button
      {...props}
      disabled={props.disabled ?? loading}
      className={twMerge(
        clsx(
          'relative flex items-center justify-center gap-2 overflow-hidden rounded-xl px-5 py-3 text-sm font-semibold transition-all active:scale-95 disabled:opacity-40 disabled:pointer-events-none',
          {
            'bg-orange-500 text-white shadow-md hover:bg-orange-400': variant === 'primary',
            'bg-white/80 text-gray-700 border border-gray-200 hover:bg-gray-50':
              variant === 'ghost',
          },
          className,
        ),
      )}
    >
      {showProgress && (
        <span
          aria-hidden="true"
          className="absolute inset-y-0 left-0 bg-black/15 transition-[width] duration-150"
          style={{ width: `${Math.round(Math.min(1, Math.max(0, progress)) * 100)}%` }}
        />
      )}
      {loading ? (
        <span
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={showProgress ? Math.round(progress * 100) : undefined}
          className="relative h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"
        />
      ) : (
        children
      )}
    </button>
  )
}
