import { clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'
import type { ButtonHTMLAttributes } from 'react'

type Variant = 'primary' | 'ghost'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  loading?: boolean
}

export function Button({ variant = 'primary', loading, className, children, ...props }: ButtonProps) {
  return (
    <button
      {...props}
      disabled={props.disabled ?? loading}
      className={twMerge(
        clsx(
          'flex items-center justify-center gap-2 rounded-xl px-5 py-3 text-sm font-semibold transition-all active:scale-95 disabled:opacity-40 disabled:pointer-events-none',
          {
            'bg-orange-500 text-white shadow-md hover:bg-orange-400': variant === 'primary',
            'bg-white/80 text-gray-700 border border-gray-200 hover:bg-gray-50': variant === 'ghost',
          },
          className,
        ),
      )}
    >
      {loading ? (
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
      ) : (
        children
      )}
    </button>
  )
}
