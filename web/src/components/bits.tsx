import { ChevronLeft, PawPrint, Sprout } from 'lucide-react';
import { useId, type ReactNode } from 'react';
import type { PlantSummary, Toxicity, UserSummary, WaterStatus } from '../../../shared/api.ts';
import { displayName, dueBadge, initials } from '../lib/format.ts';
import { toxicityShort } from '../lib/labels.ts';
import { goBack } from '../lib/router.tsx';
import { Badge, IconButton, type Tone } from './ui.tsx';

/** The app icon, inline so it needs no request (and passes a strict CSP). */
export function Logo({ className = 'size-9' }: { className?: string }) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const bg = `logo-bg-${uid}`;
  const pot = `logo-pot-${uid}`;
  const leaf = `logo-leaf-${uid}`;
  return (
    <svg viewBox="0 0 512 512" className={className} aria-hidden>
      <defs>
        <linearGradient id={bg} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#3f8a5a" />
          <stop offset="1" stopColor="#22573a" />
        </linearGradient>
        <linearGradient id={pot} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#e4895c" />
          <stop offset="1" stopColor="#c25f37" />
        </linearGradient>
        <linearGradient id={leaf} x1="0" y1="1" x2="0" y2="0">
          <stop offset="0" stopColor="#86cf7f" />
          <stop offset="1" stopColor="#d3f2bd" />
        </linearGradient>
      </defs>
      <rect width="512" height="512" rx="116" fill={`url(#${bg})`} />
      <g transform="translate(0 -18)">
        <g transform="translate(256 290)">
          {[-52, 52, 0].map((angle) => (
            <g key={angle} transform={`rotate(${angle}) scale(${angle === 0 ? 1 : 0.82})`}>
              <path d="M0 0 C-46 -46 -46 -128 0 -172 C46 -128 46 -46 0 0 Z" fill={`url(#${leaf})`} />
              <path d="M0 -12 L0 -150" stroke="#2f6f47" strokeWidth="8" strokeLinecap="round" opacity=".5" />
            </g>
          ))}
        </g>
        <path d="M176 316 H336 L318 418 Q316 430 304 430 H208 Q196 430 194 418 Z" fill={`url(#${pot})`} />
        <rect x="160" y="282" width="192" height="42" rx="15" fill="#d9774b" />
      </g>
    </svg>
  );
}

export function PlantThumb({
  plant,
  className = 'size-14 rounded-2xl',
  full = false,
}: {
  plant: Pick<PlantSummary, 'photo'>;
  className?: string;
  full?: boolean;
}) {
  if (plant.photo) {
    return (
      <img
        src={full ? plant.photo.full : plant.photo.thumb}
        alt=""
        loading="lazy"
        decoding="async"
        className={`shrink-0 bg-surface-2 object-cover ${className}`}
      />
    );
  }
  return (
    <div
      aria-hidden
      className={`grid shrink-0 place-items-center bg-gradient-to-br from-brand-soft to-surface-2 text-brand-strong ${className}`}
    >
      <Sprout className="size-[42%] opacity-70" strokeWidth={1.6} />
    </div>
  );
}

const avatarTones = [
  'bg-brand-soft text-brand-strong',
  'bg-water-soft text-water-strong',
  'bg-warn-soft text-warn-strong',
  'bg-danger-soft text-danger-strong',
];

function toneFor(user: Pick<UserSummary, 'email'>): string {
  let hash = 0;
  for (const char of user.email) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return avatarTones[hash % avatarTones.length] ?? avatarTones[0]!;
}

export function Avatar({
  user,
  className = 'size-9 text-sm',
}: {
  user: Pick<UserSummary, 'name' | 'email'>;
  className?: string;
}) {
  return (
    <span
      title={displayName(user)}
      className={`inline-grid shrink-0 place-items-center rounded-full font-semibold ring-2 ring-bg ${toneFor(user)} ${className}`}
    >
      <span aria-hidden>{initials(user)}</span>
      <span className="sr-only">{displayName(user)}</span>
    </span>
  );
}

export function AvatarStack({ users }: { users: UserSummary[] }) {
  if (users.length === 0) return null;
  return (
    <div className="flex -space-x-1.5" aria-label={`Foyer : ${users.map(displayName).join(', ')}`}>
      {users.slice(0, 4).map((user) => (
        <Avatar key={user.id} user={user} className="size-8 text-xs" />
      ))}
    </div>
  );
}

export function waterTone(water: Pick<WaterStatus, 'state'>): Tone {
  switch (water.state) {
    case 'overdue':
      return 'danger';
    case 'due':
      return 'warn';
    case 'soon':
      return 'water';
    default:
      return 'brand';
  }
}

export function WaterBadge({ water, className = '' }: { water: WaterStatus; className?: string }) {
  return (
    <Badge tone={waterTone(water)} className={className}>
      {dueBadge(water.daysUntilDue)}
    </Badge>
  );
}

export function ToxicBadge({ toxicity, compact = false }: { toxicity: Toxicity; compact?: boolean }) {
  if (toxicity !== 'toxic' && toxicity !== 'mildly_toxic') return null;
  return (
    <Badge tone={toxicity === 'toxic' ? 'danger' : 'warn'} icon={<PawPrint aria-hidden />}>
      {compact ? (toxicity === 'toxic' ? 'Toxique' : 'Un peu toxique') : toxicityShort[toxicity]}
      <span className="sr-only"> pour les animaux</span>
    </Badge>
  );
}

/** Sticky page header with an optional back button. */
export function TopBar({
  title,
  back,
  right,
  left,
  heading = true,
}: {
  title?: ReactNode;
  back?: string;
  right?: ReactNode;
  left?: ReactNode;
  /** false when the page renders its own <h1> (the bar then only echoes it). */
  heading?: boolean;
}) {
  const TitleTag = heading ? 'h1' : 'p';
  return (
    <header className="sticky top-0 z-30 bg-bg/85 pt-[env(safe-area-inset-top)] backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-3xl items-center gap-2 px-3">
        {back !== undefined && (
          <IconButton label="Retour" onClick={() => goBack(back)}>
            <ChevronLeft className="size-6!" />
          </IconButton>
        )}
        {left}
        {title && (
          <TitleTag
            className="min-w-0 flex-1 truncate font-display text-xl font-semibold"
            aria-hidden={!heading || undefined}
          >
            {title}
          </TitleTag>
        )}
        {!title && <div className="flex-1" />}
        {right && <div className="flex items-center gap-1">{right}</div>}
      </div>
    </header>
  );
}

export function PageContainer({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <main className={`mx-auto w-full max-w-3xl px-4 pb-[calc(env(safe-area-inset-bottom)+6rem)] ${className}`}>
      {children}
    </main>
  );
}
