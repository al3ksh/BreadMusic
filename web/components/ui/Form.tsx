'use client';

interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  disabled?: boolean;
}

export function Toggle({ checked, onChange, label, disabled }: ToggleProps) {
  return (
    <label className="inline-flex items-center gap-3 cursor-pointer">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
          checked ? 'bg-accent' : 'bg-border'
        }`}
      >
        <span
          className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-lg transition-transform duration-200 ${
            checked ? 'translate-x-5' : 'translate-x-0'
          }`}
        />
      </button>
      {label && <span className="text-sm text-text-secondary">{label}</span>}
    </label>
  );
}

interface SelectProps {
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

export function Select({ value, onChange, options, placeholder, disabled, className }: SelectProps) {
  return (
    <select
      value={value || ''}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      className={`w-full rounded-md border border-border bg-bg-input text-text-primary px-3 py-2 text-sm outline-none transition-colors focus:border-accent disabled:opacity-50 disabled:cursor-not-allowed font-[inherit] ${className || ''}`}
    >
      {placeholder && (
        <option value="">{placeholder}</option>
      )}
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}

interface SliderProps {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  label?: string;
  disabled?: boolean;
}

export function Slider({ value, onChange, min = 0, max = 100, step = 1, label, disabled }: SliderProps) {
  return (
    <div className="flex items-center gap-3">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        disabled={disabled}
        className="flex-1 h-2 rounded-full appearance-none cursor-pointer bg-border accent-accent disabled:opacity-50 disabled:cursor-not-allowed"
      />
      {label !== undefined && (
        <span className="text-sm text-text-secondary w-12 text-right tabular-nums">{label}</span>
      )}
    </div>
  );
}

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
}

export function Input({ label, className, ...props }: InputProps) {
  return (
    <div>
      {label && <label className="block text-sm text-text-secondary mb-1.5">{label}</label>}
      <input
        {...props}
        className={`w-full rounded-md border border-border bg-bg-input text-text-primary px-3 py-2 text-sm outline-none transition-colors placeholder:text-text-muted focus:border-accent disabled:opacity-50 disabled:cursor-not-allowed font-[inherit] ${className || ''}`}
      />
    </div>
  );
}
