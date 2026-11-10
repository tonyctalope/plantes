import {
  ArrowRight,
  Bug,
  Check,
  ChevronDown,
  Droplet,
  Droplets,
  FlaskConical,
  Gauge,
  GlassWater,
  Layers,
  Lightbulb,
  Package,
  PawPrint,
  Pencil,
  ScanSearch,
  Shovel,
  Sun,
  Thermometer,
  TriangleAlert,
  Waves,
  X,
} from 'lucide-react';
import {
  Children,
  Fragment,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import type { CareSheet, PlantDetail, PlantPatch, Toxicity } from '../../../shared/api.ts';
import {
  capitalize,
  everyNDaysShort,
  formatDate,
  relativeDays,
  temperatureRange,
  typo,
  typoDeep,
} from '../lib/format.ts';
import {
  confidenceShort,
  difficultyLabel,
  difficultyLevel,
  humidityLabel,
  humidityLevel,
  lightHint,
  lightLevel,
  lightShort,
  seasonLabel,
  seasonShort,
  toxicityLabel,
  toxicityTile,
} from '../lib/labels.ts';
import { Badge, Button, cardClass, toneClasses, type Tone } from './ui.tsx';

// The care sheet, in two layers: "L'essentiel" (eight tiles with the same
// structure on every plant) and one card per topic. Cards show the short
// structured facts (CareSheet.details) as pills and rows, and keep Claude's
// long texts behind a "Détails" disclosure. Plants added before the structured
// format (details = null) show the long texts directly, clamped to 4 lines.

export const toxicityTone: Record<Toxicity, Tone> = {
  toxic: 'danger',
  mildly_toxic: 'warn',
  non_toxic: 'brand',
  unknown: 'neutral',
};

const toneText: Record<Tone, string> = {
  brand: 'text-brand-strong',
  water: 'text-water-strong',
  warn: 'text-warn-strong',
  danger: 'text-danger-strong',
  neutral: 'text-ink-2',
};

const meterFill: Record<Tone, string> = {
  brand: 'bg-brand',
  water: 'bg-water',
  warn: 'bg-warn',
  danger: 'bg-danger',
  neutral: 'bg-ink-3',
};

const inputClass =
  'h-11 w-full rounded-2xl border border-line bg-surface px-3.5 text-ink placeholder:text-ink-3 focus:border-brand focus:outline-none';

interface LongText {
  label: string;
  text: string | null;
}

type PresentText = LongText & { text: string };

function present(items: LongText[]): PresentText[] {
  return items.filter((item): item is PresentText => Boolean(item.text?.trim()));
}

function joinParts(...parts: (string | null | undefined)[]): string | null {
  const kept = parts.filter((part): part is string => Boolean(part?.trim()));
  return kept.length > 0 ? kept.join(' · ') : null;
}

/* ------------------------------------------------------------------ */
/* L'essentiel                                                         */
/* ------------------------------------------------------------------ */

/** The plant with French typography applied to its care sheet texts. */
function usePolished(plant: PlantDetail): PlantDetail {
  return useMemo(() => ({ ...plant, care: typoDeep(plant.care) }), [plant]);
}

export function Essentials({ plant: raw }: { plant: PlantDetail }) {
  const plant = usePolished(raw);
  const { care, water } = plant;
  const details = care.details;
  const toxicity = toxicityTone[plant.toxicityPets];
  const temperature = temperatureRange(care.tempMinC, care.tempMaxC);

  return (
    <dl className="grid auto-rows-fr grid-cols-2 gap-2.5 sm:grid-cols-4">
      <Tile
        icon={<Sun />}
        tone="warn"
        label="Lumière"
        value={lightShort[care.light]}
        meter={{ level: lightLevel[care.light], max: 4 }}
      />
      <Tile
        icon={<Droplets />}
        tone="water"
        label="Arrosage"
        value={capitalize(everyNDaysShort(water.intervalDays))}
        sub={details?.wateringRule ?? `En ce moment (${typo(seasonShort[water.season]).toLowerCase()})`}
      />
      <Tile
        icon={<Waves />}
        tone="water"
        label="Humidité"
        value={care.humidity ? humidityLabel[care.humidity] : null}
        meter={care.humidity ? { level: humidityLevel[care.humidity], max: 3 } : null}
      />
      <Tile
        icon={<Thermometer />}
        tone="warn"
        label="Température"
        value={temperature ? capitalize(temperature) : null}
        sub={details?.tempIdeal ? `idéal ${details.tempIdeal}` : null}
      />
      <Tile
        icon={<PawPrint />}
        tone={toxicity}
        label="Animaux"
        value={toxicityTile[plant.toxicityPets]}
        valueClass={plant.toxicityPets === 'unknown' ? 'text-ink-3' : toneText[toxicity]}
        sub={details?.petRisk ?? null}
      />
      <Tile
        icon={<Gauge />}
        tone="brand"
        label="Entretien"
        value={care.difficulty ? difficultyLabel[care.difficulty] : null}
        meter={care.difficulty ? { level: difficultyLevel[care.difficulty], max: 3 } : null}
      />
      <Tile
        icon={<FlaskConical />}
        tone="brand"
        label="Engrais"
        value={details?.fertilizerFrequency ?? null}
        sub={details?.fertilizerSeason ?? null}
      />
      <Tile
        icon={<Shovel />}
        tone="brand"
        label="Rempotage"
        value={details?.repottingFrequency ?? null}
        sub={details?.repottingSeason ?? null}
      />
    </dl>
  );
}

function Tile({
  icon,
  tone,
  label,
  value,
  sub,
  meter,
  valueClass = 'text-ink',
}: {
  icon: ReactNode;
  tone: Tone;
  label: string;
  value: string | null;
  sub?: string | null;
  meter?: { level: number; max: number } | null;
  valueClass?: string;
}) {
  return (
    <div className={`flex min-w-0 flex-col p-3.5 ${cardClass}`}>
      <dt className="flex items-center gap-2 text-[13px] leading-tight font-semibold text-ink-3">
        <span
          aria-hidden
          className={`grid size-7 shrink-0 place-items-center rounded-[0.625rem] [&_svg]:size-4 ${toneClasses(tone)}`}
        >
          {icon}
        </span>
        <span className="truncate">{label}</span>
      </dt>
      <dd
        className={`mt-2.5 line-clamp-2 text-[15px] leading-snug font-semibold break-words ${value ? valueClass : 'text-ink-3'}`}
      >
        {value ?? <Missing />}
      </dd>
      {value && meter && (
        <dd className="mt-2">
          <Meter level={meter.level} max={meter.max} tone={tone} />
        </dd>
      )}
      {value && sub && <dd className="mt-1 line-clamp-2 text-[13px] leading-snug break-words text-ink-3">{sub}</dd>}
    </div>
  );
}

function Missing() {
  return (
    <>
      <span aria-hidden>—</span>
      <span className="sr-only">Non renseigné</span>
    </>
  );
}

function Meter({ level, max, tone }: { level: number; max: number; tone: Tone }) {
  return (
    <span role="img" aria-label={`Niveau ${level} sur ${max}`} className="flex gap-1">
      {Array.from({ length: max }, (_, step) => (
        <span key={step} className={`h-1.5 w-5 rounded-full ${step < level ? meterFill[tone] : 'bg-line'}`} />
      ))}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Fiche d'entretien                                                   */
/* ------------------------------------------------------------------ */

export function CareGuide({
  plant: raw,
  timeZone,
  today,
  onSaveIntervals,
}: {
  plant: PlantDetail;
  timeZone: string;
  today: string;
  onSaveIntervals: (patch: PlantPatch) => Promise<boolean>;
}) {
  const plant = usePolished(raw);
  return (
    <div className="space-y-3">
      <Placement care={plant.care} />
      <Watering plant={plant} onSaveIntervals={onSaveIntervals} />
      <Climate care={plant.care} />
      <Substrate care={plant.care} />
      <Feeding plant={plant} timeZone={timeZone} today={today} />
      <Problems care={plant.care} />
      <Advice care={plant.care} />
      <ToxicitySection plant={plant} />
      <Identification plant={plant} />
    </div>
  );
}

function Placement({ care }: { care: CareSheet }) {
  const d = care.details;
  const structured = d !== null && (d.lightGood.length > 0 || d.lightAvoid.length > 0);
  return (
    <CareCard
      icon={<Sun />}
      tone="warn"
      title="Emplacement"
      details={structured ? [{ label: 'Emplacement', text: care.lightNotes }] : []}
    >
      {structured ? (
        <>
          <Pills label="Idéal">
            {d.lightGood.map((item, index) => (
              <Pill key={index} tone="good" icon={<Check strokeWidth={2.75} />}>
                {item}
              </Pill>
            ))}
          </Pills>
          <Pills label="À éviter">
            {d.lightAvoid.map((item, index) => (
              <Pill key={index} tone="avoid" icon={<X strokeWidth={2.75} />}>
                {item}
              </Pill>
            ))}
          </Pills>
        </>
      ) : care.lightNotes ? (
        <ClampedText text={care.lightNotes} />
      ) : (
        <p>{lightHint[care.light]}</p>
      )}
    </CareCard>
  );
}

function Watering({
  plant,
  onSaveIntervals,
}: {
  plant: PlantDetail;
  onSaveIntervals: (patch: PlantPatch) => Promise<boolean>;
}) {
  const { care } = plant;
  const d = care.details;
  const tips = d?.wateringTips ?? [];
  const structured =
    d !== null &&
    (d.wateringRule !== null || tips.length > 0 || d.thirstSigns !== null || d.overwateringSigns !== null);
  const signs: Row[] = [];
  if (d?.thirstSigns) signs.push({ label: 'Soif', value: d.thirstSigns });
  if (d?.overwateringSigns) signs.push({ label: "Trop d'eau", value: d.overwateringSigns });

  return (
    <CareCard
      icon={<Droplets />}
      tone="water"
      title="Arrosage"
      details={structured ? [{ label: 'Arrosage', text: care.wateringInstructions }] : []}
    >
      {structured ? (
        d.wateringRule && (
          <p className="flex gap-2.5 rounded-2xl bg-water-soft px-3.5 py-2.5 leading-snug font-semibold text-water-strong">
            <LineIcon>
              <Droplet className="size-[1.125rem]" />
            </LineIcon>
            <span className="min-w-0">{d.wateringRule}</span>
          </p>
        )
      ) : (
        <ClampedText text={care.wateringInstructions} />
      )}
      {(care.waterAmount || tips.length > 0) && (
        <Pills>
          {care.waterAmount && (
            <Pill icon={<GlassWater className="text-water" />}>
              <Lead text={care.waterAmount} />
            </Pill>
          )}
          {tips.map((tip, index) => (
            <Pill key={index}>{tip}</Pill>
          ))}
        </Pills>
      )}
      <WateringSchedule plant={plant} onSave={onSaveIntervals} />
      {signs.length > 0 && <Rows rows={signs} />}
    </CareCard>
  );
}

/** "≈ 400 ml, jusqu'à écoulement": the amount in bold, the rest as is. */
function Lead({ text }: { text: string }) {
  const cut = text.indexOf(', ');
  if (cut <= 0 || cut > 32) return <>{text}</>;
  return (
    <>
      <strong className="font-bold">{text.slice(0, cut)}</strong>
      {text.slice(cut)}
    </>
  );
}

function Climate({ care }: { care: CareSheet }) {
  const d = care.details;
  const tips = d?.humidityTips ?? [];
  const temperature = temperatureRange(care.tempMinC, care.tempMaxC);
  const ideal = d?.tempIdeal ?? null;
  const structured = tips.length > 0 || ideal !== null;
  const texts: LongText[] = [
    { label: 'Humidité', text: care.humidityNotes },
    { label: 'Température', text: care.temperatureNotes },
  ];
  if (!structured && !temperature && present(texts).length === 0) return null;

  return (
    <CareCard icon={<Waves />} tone="water" title="Humidité & température" details={structured ? texts : []}>
      {tips.length > 0 && (
        <Pills>
          {tips.map((tip, index) => (
            <Pill key={index}>{tip}</Pill>
          ))}
        </Pills>
      )}
      {(temperature || ideal) && (
        <IconLine icon={<Thermometer />}>
          {temperature && <span className="font-semibold text-ink">{capitalize(temperature)}</span>}
          {temperature && ideal && <span className="text-ink-3"> · </span>}
          {ideal && <span>idéal {ideal}</span>}
        </IconLine>
      )}
      {!structured && <LongTexts items={texts} />}
    </CareCard>
  );
}

function Substrate({ care }: { care: CareSheet }) {
  const mix = care.details?.soilMix ?? [];
  const structured = mix.length > 0;
  const texts: LongText[] = [
    { label: 'Substrat', text: care.soil },
    { label: 'Pot', text: care.pot },
  ];
  if (!structured && present(texts).length === 0) return null;

  return (
    <CareCard icon={<Layers />} tone="neutral" title="Substrat & pot" details={structured ? texts : []}>
      {structured ? (
        <>
          <Pills>
            {mix.map((part, index) => (
              <Pill key={index}>{part}</Pill>
            ))}
          </Pills>
          {care.pot && (
            <IconLine icon={<Package />}>
              <span className="line-clamp-2">{care.pot}</span>
            </IconLine>
          )}
        </>
      ) : (
        <LongTexts items={texts} />
      )}
    </CareCard>
  );
}

function Feeding({ plant, timeZone, today }: { plant: PlantDetail; timeZone: string; today: string }) {
  const { care } = plant;
  const d = care.details;
  const pruning = d?.pruningTips ?? [];
  const fertilizerWhen = joinParts(d?.fertilizerFrequency, d?.fertilizerSeason);
  const repotting = joinParts(d?.repottingFrequency, d?.repottingSeason);
  const fertilizerType = d?.fertilizerType ?? null;
  const structured = Boolean(fertilizerType || fertilizerWhen || repotting || pruning.length > 0);
  const last = plant.lastFertilizedAt;
  const texts: LongText[] = [
    { label: 'Engrais', text: care.fertilizing },
    { label: 'Rempotage', text: care.repotting },
    { label: 'Taille', text: care.pruning },
  ];
  if (!structured && !last && present(texts).length === 0) return null;

  const rows: Row[] = [];
  if (fertilizerType || fertilizerWhen) {
    rows.push({
      label: 'Engrais',
      value: (
        <>
          {fertilizerType}
          {fertilizerWhen && (
            <span className={`block text-ink-3 ${fertilizerType ? 'text-sm' : ''}`}>{fertilizerWhen}</span>
          )}
        </>
      ),
    });
  }
  if (last) {
    rows.push({
      label: 'Dernier apport',
      value: (
        <>
          {capitalize(relativeDays(last, timeZone, today))}
          <span className="text-ink-3"> · {formatDate(last, timeZone)}</span>
        </>
      ),
    });
  }
  if (repotting) rows.push({ label: 'Rempotage', value: repotting });

  return (
    <CareCard
      icon={<FlaskConical />}
      tone="brand"
      title="Engrais, rempotage & taille"
      details={structured ? texts : []}
    >
      {rows.length > 0 && <Rows rows={rows} />}
      {pruning.length > 0 && (
        <Pills label="Taille">
          {pruning.map((tip, index) => (
            <Pill key={index}>{tip}</Pill>
          ))}
        </Pills>
      )}
      {!structured && <LongTexts items={texts} />}
    </CareCard>
  );
}

function Problems({ care }: { care: CareSheet }) {
  const problems = care.details?.problems ?? [];
  if (problems.length === 0 && !care.commonProblems) return null;
  return (
    <CareCard
      icon={<Bug />}
      tone="danger"
      title="Problèmes fréquents"
      details={problems.length > 0 ? [{ label: 'Problèmes fréquents', text: care.commonProblems }] : []}
    >
      {problems.length > 0 ? (
        <ul className="divide-y divide-line/70">
          {problems.map((problem, index) => (
            <li
              key={index}
              className="py-2.5 leading-snug first:pt-0 last:pb-0 sm:grid sm:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] sm:gap-4"
            >
              <p className="font-semibold text-ink">{problem.symptom}</p>
              <p className="mt-0.5 flex gap-1.5 text-ink-3 sm:mt-0">
                <LineIcon>
                  <ArrowRight className="size-3.5" />
                </LineIcon>
                <span className="min-w-0">
                  <span className="sr-only">Cause probable : </span>
                  {problem.cause}
                </span>
              </p>
            </li>
          ))}
        </ul>
      ) : (
        care.commonProblems && <ClampedText text={care.commonProblems} />
      )}
    </CareCard>
  );
}

function Advice({ care }: { care: CareSheet }) {
  const tips = care.details?.keyTips ?? [];
  if (tips.length === 0 && !care.tips) return null;
  return (
    <CareCard
      icon={<Lightbulb />}
      tone="warn"
      title="Conseils"
      details={tips.length > 0 ? [{ label: 'Conseils', text: care.tips }] : []}
    >
      {tips.length > 0 ? (
        <ul className="space-y-2">
          {tips.map((tip, index) => (
            <li key={index} className="flex gap-3 leading-snug">
              <LineIcon>
                <span className="size-1.5 rounded-full bg-warn" />
              </LineIcon>
              <span className="min-w-0">{tip}</span>
            </li>
          ))}
        </ul>
      ) : (
        care.tips && <ClampedText text={care.tips} />
      )}
    </CareCard>
  );
}

function ToxicitySection({ plant }: { plant: PlantDetail }) {
  const { care } = plant;
  const toxicity = plant.toxicityPets;
  const petRisk = care.details?.petRisk ?? null;
  const warning = toxicity === 'toxic' || toxicity === 'mildly_toxic';
  return (
    <CareCard
      icon={warning ? <TriangleAlert /> : <PawPrint />}
      tone={toxicityTone[toxicity]}
      title={toxicityLabel[toxicity]}
      variant={toxicity === 'toxic' ? 'danger' : toxicity === 'mildly_toxic' ? 'warn' : 'plain'}
      details={petRisk ? [{ label: 'Toxicité', text: care.toxicityNotes }] : []}
    >
      {petRisk ? (
        <p className="leading-snug">{petRisk}</p>
      ) : care.toxicityNotes ? (
        <ClampedText text={care.toxicityNotes} />
      ) : null}
    </CareCard>
  );
}

function Identification({ plant }: { plant: PlantDetail }) {
  const { care } = plant;
  const confidence = care.identificationConfidence;
  const tone: Tone = confidence === 'high' ? 'brand' : confidence === 'medium' ? 'warn' : 'danger';
  return (
    <details className={`group ${cardClass}`}>
      <summary className="flex cursor-pointer list-none items-center gap-3 rounded-3xl p-4 select-none sm:px-5 [&::-webkit-details-marker]:hidden">
        <SectionIcon tone="neutral">
          <ScanSearch />
        </SectionIcon>
        <span className="min-w-0 flex-1 font-semibold">Identification</span>
        <Badge tone={tone}>
          <span className="sr-only">Identification </span>
          {confidenceShort[confidence]}
        </Badge>
        <ChevronDown
          aria-hidden
          className="size-4 shrink-0 text-ink-3 transition-transform duration-200 group-open:rotate-180"
        />
      </summary>
      <div className="space-y-2 px-4 pb-4 text-[15px] leading-relaxed text-ink-2 sm:px-5 sm:pb-5">
        <p>
          <span className="italic">{plant.scientificName}</span>
          {care.family ? ` · famille des ${care.family}` : ''}
        </p>
        {care.identificationNotes && <p className="whitespace-pre-line">{care.identificationNotes}</p>}
      </div>
    </details>
  );
}

/* ------------------------------------------------------------------ */
/* Building blocks                                                     */
/* ------------------------------------------------------------------ */

const cardVariants = {
  plain: cardClass,
  warn: 'rounded-3xl border border-warn/30 bg-warn-soft',
  danger: 'rounded-3xl border border-danger/30 bg-danger-soft',
} as const;

/** One layout for every topic: icon + title, short content, then "Détails". */
function CareCard({
  icon,
  tone,
  title,
  variant = 'plain',
  details = [],
  children,
}: {
  icon: ReactNode;
  tone: Tone;
  title: string;
  variant?: keyof typeof cardVariants;
  details?: LongText[];
  children?: ReactNode;
}) {
  const titleId = useId();
  const extra = present(details);
  const tinted = variant !== 'plain';
  return (
    <section
      aria-labelledby={titleId}
      className={`px-4 pt-4 sm:px-5 sm:pt-5 ${extra.length > 0 ? 'pb-1 sm:pb-1.5' : 'pb-4 sm:pb-5'} ${cardVariants[variant]}`}
    >
      <div className="flex items-center gap-3">
        <SectionIcon tone={tone} tinted={tinted}>
          {icon}
        </SectionIcon>
        <h3 id={titleId} className={`leading-snug font-semibold ${tinted ? toneText[tone] : ''}`}>
          {title}
        </h3>
      </div>
      {children && <div className="mt-3.5 space-y-3.5 text-[15px] leading-relaxed text-ink-2">{children}</div>}
      {extra.length > 0 && <MoreDetails items={extra} topic={title} />}
    </section>
  );
}

function SectionIcon({ tone, tinted = false, children }: { tone: Tone; tinted?: boolean; children: ReactNode }) {
  return (
    <span
      aria-hidden
      className={`grid size-9 shrink-0 place-items-center rounded-xl [&_svg]:size-[1.125rem] ${
        tinted ? `bg-surface/70 ${toneText[tone]}` : toneClasses(tone)
      }`}
    >
      {children}
    </span>
  );
}

/** Long free texts of a card, collapsed by default (native disclosure: keyboard and screen readers for free). */
function MoreDetails({ items, topic }: { items: PresentText[]; topic: string }) {
  const labelled = items.length > 1;
  return (
    <details className="group mt-3.5 border-t border-line/70">
      <summary className="-mx-2 flex cursor-pointer list-none items-center justify-between gap-2 rounded-xl px-2 py-3 text-sm font-semibold text-ink-3 select-none hover:text-ink-2 [&::-webkit-details-marker]:hidden">
        <span>
          Détails<span className="sr-only"> : {topic.toLowerCase()}</span>
        </span>
        <ChevronDown aria-hidden className="size-4 transition-transform duration-200 group-open:rotate-180" />
      </summary>
      <div className="space-y-3 pb-3.5 text-[15px] leading-relaxed text-ink-2">
        {items.map((item) => (
          <div key={item.label}>
            {labelled && <p className="text-[13px] font-semibold text-ink-3">{item.label}</p>}
            <p className="whitespace-pre-line">{item.text}</p>
          </div>
        ))}
      </div>
    </details>
  );
}

/** Legacy plants: long texts shown directly, each clamped. */
function LongTexts({ items }: { items: LongText[] }) {
  const shown = present(items);
  const labelled = shown.length > 1;
  return (
    <>
      {shown.map((item) => (
        <div key={item.label}>
          {labelled && <p className="text-[13px] font-semibold text-ink-3">{item.label}</p>}
          <ClampedText text={item.text} />
        </div>
      ))}
    </>
  );
}

/** A paragraph clamped to 4 lines, with "Lire la suite" when it overflows. */
function ClampedText({ text }: { text: string }) {
  const ref = useRef<HTMLParagraphElement>(null);
  const id = useId();
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || expanded) return;
    const measure = () => setOverflows(element.scrollHeight > element.clientHeight + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [expanded, text]);

  return (
    <div>
      <p id={id} ref={ref} className={`whitespace-pre-line ${expanded ? '' : 'line-clamp-4'}`}>
        {text}
      </p>
      {(overflows || expanded) && (
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={id}
          onClick={() => setExpanded((value) => !value)}
          className="mt-1 rounded-lg text-sm font-semibold text-brand-strong underline-offset-4 hover:underline"
        >
          {expanded ? 'Réduire' : 'Lire la suite'}
        </button>
      )}
    </div>
  );
}

type PillTone = 'neutral' | 'good' | 'avoid' | 'water';

const pillTones: Record<PillTone, string> = {
  neutral: 'bg-surface-2 text-ink-2',
  good: 'bg-brand-soft text-brand-strong',
  avoid: 'bg-danger-soft text-danger-strong',
  water: 'bg-water-soft text-water-strong',
};

function Pills({ label, children }: { label?: string; children: ReactNode }) {
  const labelId = useId();
  if (Children.toArray(children).length === 0) return null;
  return (
    <div>
      {label && (
        <p id={labelId} className="mb-1.5 text-[13px] leading-tight font-semibold text-ink-3">
          {label}
        </p>
      )}
      <ul aria-labelledby={label ? labelId : undefined} className="flex flex-wrap gap-1.5">
        {children}
      </ul>
    </div>
  );
}

function Pill({ tone = 'neutral', icon, children }: { tone?: PillTone; icon?: ReactNode; children: ReactNode }) {
  return (
    <li
      className={`inline-flex max-w-full gap-1.5 rounded-2xl px-3 py-1.5 text-sm leading-snug font-medium ${pillTones[tone]}`}
    >
      {icon && <LineIcon className="[&_svg]:size-3.5">{icon}</LineIcon>}
      <span className="min-w-0 break-words">{children}</span>
    </li>
  );
}

/** Keeps an icon centred on the first line of the text next to it. */
function LineIcon({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <span aria-hidden className={`flex h-[1lh] shrink-0 items-center ${className}`}>
      {children}
    </span>
  );
}

function IconLine({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <div className="flex gap-2.5 leading-snug">
      <LineIcon className="text-ink-3 [&_svg]:size-4">{icon}</LineIcon>
      <p className="min-w-0">{children}</p>
    </div>
  );
}

interface Row {
  label: string;
  value: ReactNode;
}

function Rows({ rows }: { rows: Row[] }) {
  return (
    <dl className="grid grid-cols-[max-content_minmax(0,1fr)] items-baseline gap-x-4 gap-y-2 leading-snug">
      {rows.map((row) => (
        <Fragment key={row.label}>
          <dt className="text-[13px] font-semibold text-ink-3">{row.label}</dt>
          <dd className="min-w-0">{row.value}</dd>
        </Fragment>
      ))}
    </dl>
  );
}

/** The two seasonal intervals as chips (current season highlighted), editable. */
function WateringSchedule({ plant, onSave }: { plant: PlantDetail; onSave: (patch: PlantPatch) => Promise<boolean> }) {
  const { care } = plant;
  const season = plant.water.season;
  const [editing, setEditing] = useState(false);
  const [growing, setGrowing] = useState(String(care.waterIntervalGrowing));
  const [rest, setRest] = useState(String(care.waterIntervalRest));
  const [saving, setSaving] = useState(false);

  if (!editing) {
    return (
      <div>
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <p className="text-[13px] leading-tight font-semibold text-ink-3">Fréquence des rappels</p>
          <button
            type="button"
            aria-label="Modifier la fréquence d'arrosage"
            onClick={() => {
              setGrowing(String(care.waterIntervalGrowing));
              setRest(String(care.waterIntervalRest));
              setEditing(true);
            }}
            className="-my-1.5 -mr-2 inline-flex items-center gap-1 rounded-full px-2.5 py-1.5 text-[13px] font-semibold text-brand-strong transition-colors hover:bg-surface-2"
          >
            <Pencil className="size-3.5" aria-hidden />
            Modifier
          </button>
        </div>
        <ul className="grid grid-cols-2 gap-2">
          {(['growing', 'rest'] as const).map((key) => {
            const current = key === season;
            const days = key === 'growing' ? care.waterIntervalGrowing : care.waterIntervalRest;
            return (
              <li
                key={key}
                title={current ? 'En ce moment' : undefined}
                className={`min-w-0 rounded-2xl border px-3 py-2 leading-snug ${
                  current ? 'border-water/30 bg-water-soft text-water-strong' : 'border-line text-ink-2'
                }`}
              >
                <span className={`flex items-center gap-1.5 text-[13px] font-semibold ${current ? '' : 'text-ink-3'}`}>
                  {current && <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-water" />}
                  {typo(seasonShort[key])}
                  {current && <span className="sr-only"> (en ce moment)</span>}
                </span>
                <span className="block font-semibold">{everyNDaysShort(days)}</span>
              </li>
            );
          })}
        </ul>
      </div>
    );
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const nextGrowing = Number(growing);
    const nextRest = Number(rest);
    if (!Number.isInteger(nextGrowing) || !Number.isInteger(nextRest) || nextGrowing < 1 || nextRest < 1) return;
    setSaving(true);
    const ok = await onSave({ waterIntervalGrowing: nextGrowing, waterIntervalRest: nextRest });
    setSaving(false);
    if (ok) setEditing(false);
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="space-y-3 rounded-2xl bg-surface-2/70 p-3">
      <p className="text-sm text-ink-3">Arroser tous les combien de jours ?</p>
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="mb-1 block text-sm font-semibold text-ink">{seasonLabel.growing}</span>
          <input
            type="number"
            inputMode="numeric"
            min={1}
            max={90}
            required
            autoFocus
            value={growing}
            onChange={(event) => setGrowing(event.target.value)}
            className={inputClass}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-semibold text-ink">{seasonLabel.rest}</span>
          <input
            type="number"
            inputMode="numeric"
            min={1}
            max={180}
            required
            value={rest}
            onChange={(event) => setRest(event.target.value)}
            className={inputClass}
          />
        </label>
      </div>
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="outline" onClick={() => setEditing(false)}>
          Annuler
        </Button>
        <Button size="sm" type="submit" loading={saving}>
          Enregistrer
        </Button>
      </div>
    </form>
  );
}
