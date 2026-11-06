import type { ReactNode } from 'react';

export function EmptyState({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mx-auto max-w-lg py-20 text-center">
      <h2 className="type-wide text-xl">{title}</h2>
      <div className="mt-3 text-[0.9375rem] leading-relaxed text-muted">{children}</div>
      {action && <div className="mt-6 flex justify-center">{action}</div>}
    </div>
  );
}
