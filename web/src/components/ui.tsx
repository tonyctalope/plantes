import { LoaderCircle } from 'lucide-react';
import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode, Ref } from 'react';
import { Link } from '../lib/router.tsx';

export type ButtonVariant = 'primary' | 'water' | 'soft' | 'outline' | 'ghost' | 'danger' | 'danger-soft';
export type ButtonSize = 'sm' | 'md' | 'lg';

const base =
  'inline-flex items-center justify-center gap-2 rounded-full font-semibold whitespace-nowrap select-none ' +
  'transition-[background-color,color,filter,transform] duration-150 active:scale-[.97] ' +
  'disabled:opacity-55 disabled:pointer-events-none [&_svg]:size-[1.15em] [&_svg]:shrink-0';

const variants: Record<ButtonVariant, string> = {
  primary: 'bg-brand text-brand-ink shadow-sm hover:brightness-110',
  water: 'bg-water text-water-ink shadow-sm hover:brightness-110',
  soft: 'bg-brand-soft text-brand-strong hover:brightness-[.97] dark:hover:brightness-110',
  outline: 'border border-line bg-surface text-ink hover:bg-surface-2',
  ghost: 'text-ink-2 hover:bg-surface-2',
  danger: 'bg-danger text-danger-ink shadow-sm hover:brightness-110',
  'danger-soft': 'bg-danger-soft text-danger-strong hover:brightness-[.97] dark:hover:brightness-110',
};

const sizes: Record<ButtonSize, string> = {
  sm: 'h-9 px-3.5 text-sm',
  md: 'h-11 px-5 text-[15px]',
  lg: 'h-13 px-6 text-base',
};

export function buttonClass(variant: ButtonVariant = 'primary', size: ButtonSize = 'md', extra = ''): string {
  return `${base} ${variants[variant]} ${sizes[size]} ${extra}`.trim();
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: ReactNode;
  ref?: Ref<HTMLButtonElement>;
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  icon,
  className = '',
  children,
  disabled,
  type = 'button',
  ref,
  ...rest
}: ButtonProps) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={buttonClass(variant, size, className)}
      {...rest}
    >
      {loading ? <LoaderCircle className="animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
}

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  tone?: 'plain' | 'surface' | 'danger';
  size?: 'sm' | 'md';
  loading?: boolean;
}

const iconTones = {
  plain: 'text-ink-2 hover:bg-surface-2',
  surface: 'bg-surface/85 text-ink shadow-sm backdrop-blur hover:bg-surface',
  danger: 'text-danger-strong hover:bg-danger-soft',
};

export function IconButton({
  label,
  tone = 'plain',
  size = 'md',
  loading = false,
  className = '',
  children,
  type = 'button',
  disabled,
  ...rest
}: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      disabled={disabled || loading}
      className={`inline-grid shrink-0 place-items-center rounded-full transition-colors active:scale-95 disabled:opacity-50 [&_svg]:size-5 ${
        size === 'sm' ? 'size-9' : 'size-11'
      } ${iconTones[tone]} ${className}`}
      {...rest}
    >
      {loading ? <LoaderCircle className="animate-spin" aria-hidden /> : children}
    </button>
  );
}

export function IconLink({
  to,
  label,
  children,
  className = '',
}: {
  to: string;
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Link
      to={to}
      aria-label={label}
      title={label}
      className={`inline-grid size-11 shrink-0 place-items-center rounded-full text-ink-2 transition-colors hover:bg-surface-2 [&_svg]:size-5 ${className}`}
    >
      {children}
    </Link>
  );
}

export function Card({ className = '', children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`rounded-3xl border border-line/80 bg-surface shadow-[0_1px_2px_rgb(0_0_0/0.04)] ${className}`}
      {...rest}
    >
      {children}
    </div>
  );
}

export type Tone = 'brand' | 'water' | 'warn' | 'danger' | 'neutral';

const badgeTones: Record<Tone, string> = {
  brand: 'bg-brand-soft text-brand-strong',
  water: 'bg-water-soft text-water-strong',
  warn: 'bg-warn-soft text-warn-strong',
  danger: 'bg-danger-soft text-danger-strong',
  neutral: 'bg-surface-2 text-ink-2',
};

export function Badge({
  tone = 'neutral',
  icon,
  className = '',
  children,
}: {
  tone?: Tone;
  icon?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap [&_svg]:size-3.5 ${badgeTones[tone]} ${className}`}
    >
      {icon}
      {children}
    </span>
  );
}

export function toneClasses(tone: Tone): string {
  return badgeTones[tone];
}

export function Switch({
  checked,
  onChange,
  label,
  disabled,
  id,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
  id?: string;
}) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${
        checked ? 'bg-brand' : 'bg-line'
      }`}
    >
      <span
        aria-hidden
        className={`inline-block size-5.5 rounded-full bg-white shadow transition-transform ${
          checked ? 'translate-x-[1.375rem]' : 'translate-x-[0.25rem]'
        }`}
      />
    </button>
  );
}

export function Spinner({ label = 'Chargement…', className = '' }: { label?: string; className?: string }) {
  return (
    <div role="status" className={`flex items-center justify-center gap-3 py-16 text-ink-3 ${className}`}>
      <LoaderCircle className="size-6 animate-spin" aria-hidden />
      <span>{label}</span>
    </div>
  );
}

export function SectionTitle({ children, aside, id }: { children: ReactNode; aside?: ReactNode; id?: string }) {
  return (
    <div className="mb-3 flex items-end justify-between gap-3 px-1">
      <h2 id={id} className="text-[13px] font-bold tracking-[0.08em] text-ink-3 uppercase">
        {children}
      </h2>
      {aside}
    </div>
  );
}

export function ErrorState({
  title = 'Oups',
  message,
  onRetry,
}: {
  title?: string;
  message: string;
  onRetry?: () => void;
}) {
  return (
    <Card className="mx-auto mt-8 max-w-md p-6 text-center">
      <p className="font-display text-2xl font-semibold">{title}</p>
      <p className="mt-2 text-ink-2">{message}</p>
      {onRetry && (
        <Button variant="soft" className="mt-5" onClick={onRetry}>
          Réessayer
        </Button>
      )}
    </Card>
  );
}
