import { Bug, Droplet, FlaskConical, Scissors, Shovel, SprayCan, StickyNote, type LucideIcon } from 'lucide-react';
import type { CareType } from '../../../shared/api.ts';

const careIcons: Record<CareType, LucideIcon> = {
  water: Droplet,
  fertilize: FlaskConical,
  repot: Shovel,
  prune: Scissors,
  treat: Bug,
  mist: SprayCan,
  note: StickyNote,
};

export function CareIcon({ type, className }: { type: CareType; className?: string }) {
  const Icon = careIcons[type];
  return <Icon className={className} aria-hidden />;
}
