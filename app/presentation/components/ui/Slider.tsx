import { useId } from 'react'
import { twMerge } from 'tailwind-merge'
import type { InputHTMLAttributes } from 'react'

interface SliderProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label: string
  valueLabel: string
}

export function Slider({ id, label, valueLabel, className, ...props }: SliderProps) {
  const generatedId = useId()
  const inputId = id ?? generatedId

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-3 text-sm">
        <label className="font-medium text-gray-700" htmlFor={inputId}>
          {label}
        </label>
        <output className="tabular-nums text-gray-500" htmlFor={inputId}>
          {valueLabel}
        </output>
      </div>
      <input
        {...props}
        id={inputId}
        type="range"
        className={twMerge('h-11 w-full cursor-pointer accent-orange-500', className)}
      />
    </div>
  )
}
