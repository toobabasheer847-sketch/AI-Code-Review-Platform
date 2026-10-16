import type { LucideIcon } from 'lucide-react';

interface DashboardMetricCardProps {
  label: string;
  value: number | string;
  icon: LucideIcon;
  tone: string;
  detail?: string;
}

export function DashboardMetricCard({
  label,
  value,
  icon: Icon,
  tone,
  detail,
}: DashboardMetricCardProps): JSX.Element {
  return (
    <article className="rounded-xl border border-white/[0.07] bg-[#0e121b] p-4 transition-colors hover:border-white/[0.12] sm:p-5">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-medium text-slate-500">{label}</p>
          <p className="mt-3 text-2xl font-semibold tracking-tight text-white">{value}</p>
        </div>
        <span className={`flex h-9 w-9 items-center justify-center rounded-lg ${tone}`}>
          <Icon className="h-4 w-4" aria-hidden="true" />
        </span>
      </div>
      {detail && <p className="mt-3 text-[11px] leading-4 text-slate-500">{detail}</p>}
    </article>
  );
}
