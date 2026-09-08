import { clsx } from 'clsx'

interface SegmentedControlOption<Value extends string> {
  label: string
  value: Value
}

interface SegmentedControlProps<Value extends string> {
  label: string
  options: SegmentedControlOption<Value>[]
  value: Value
  onChange: (value: Value) => void
}

export function SegmentedControl<Value extends string>({
  label,
  options,
  value,
  onChange,
}: SegmentedControlProps<Value>) {
  return (
    <div aria-label={label} className="flex rounded-lg bg-gray-100 p-1" role="radiogroup">
      {options.map(option => {
        const selected = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            className={clsx(
              'min-h-9 flex-1 rounded-md px-3 text-sm font-medium transition-colors',
              selected ? 'bg-white text-orange-600 shadow-sm' : 'text-gray-500 hover:text-gray-700',
            )}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
