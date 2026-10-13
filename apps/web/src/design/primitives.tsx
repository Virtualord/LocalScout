import * as AccordionPrimitive from '@radix-ui/react-accordion';
import * as TabsPrimitive from '@radix-ui/react-tabs';
import { forwardRef, type ReactNode } from 'react';

/**
 * Tabs and accordion, both on Radix primitives.
 *
 * Radix supplies the keyboard model (arrow keys, Home/End, roving focus) and the
 * ARIA wiring, which is the part that is easy to get subtly wrong and hard to
 * notice until someone cannot use the page. The styling is the design system's.
 */

export const Tabs = TabsPrimitive.Root;

export function TabsList({ children }: { children: ReactNode }) {
  return <TabsPrimitive.List className="tabs-list">{children}</TabsPrimitive.List>;
}

export function TabsTrigger({ value, children }: { value: string; children: ReactNode }) {
  return (
    <TabsPrimitive.Trigger className="tabs-trigger" value={value}>
      {children}
    </TabsPrimitive.Trigger>
  );
}

export function TabsContent({
  value,
  children,
  className = '',
}: {
  value: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <TabsPrimitive.Content
      className={['pt-5 outline-none', className].filter(Boolean).join(' ')}
      value={value}
    >
      {children}
    </TabsPrimitive.Content>
  );
}

/**
 * Accordion.
 *
 * One item open at a time, which is the reference's behaviour and is also what
 * a FAQ wants: a reader is answering one question at a time, not comparing
 * three answers.
 */
export const Accordion = AccordionPrimitive.Root;

export function AccordionItem({
  value,
  question,
  children,
}: {
  value: string;
  question: ReactNode;
  children: ReactNode;
}) {
  return (
    <AccordionPrimitive.Item value={value} className="border-b border-ink">
      <AccordionPrimitive.Header>
        <AccordionPrimitive.Trigger className="accordion-trigger">
          <span className="flex-1 pr-4 text-left">{question}</span>
          {/* Chevron rotates 180 degrees when open. */}
          <span
            aria-hidden="true"
            className="accordion-chevron shrink-0 transition-transform duration-[--dur-base] ease-[--ease-out]"
          >
            ▾
          </span>
        </AccordionPrimitive.Trigger>
      </AccordionPrimitive.Header>

      <AccordionPrimitive.Content className="accordion-content">
        <div className="pb-5 pr-8 text-[15px] leading-relaxed text-ink/85">{children}</div>
      </AccordionPrimitive.Content>
    </AccordionPrimitive.Item>
  );
}

export const AccordionTrigger = AccordionPrimitive.Trigger;

/** A vertical rule used by the CTA timeline. */
export const Timeline = forwardRef<HTMLDivElement, { children: ReactNode; className?: string }>(
  function Timeline({ children, className = '' }, ref) {
    return (
      <div
        ref={ref}
        className={['relative pl-8', className].filter(Boolean).join(' ')}
        // The line sits at 40% of the remaining width, as in the reference.
        style={{ ['--timeline-line' as string]: '40%' }}
      >
        <span
          aria-hidden="true"
          className="absolute bottom-0 left-[calc(40%-1px)] top-0 w-[2px] bg-paper/40"
        />
        {children}
      </div>
    );
  },
);

/** One step in the CTA timeline: a square node, a number, and a title. */
export function TimelineStep({
  index,
  title,
  children,
}: {
  index: number;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="relative pb-9 last:pb-0">
      <span
        aria-hidden="true"
        className="absolute left-[-32px] top-1 size-3 bg-blue"
        style={{ left: 'calc(40% - 28px)' }}
      />
      <div className="mono text-[11px] font-bold tracking-[0.16em] text-paper/60">
        {String(index).padStart(2, '0')}
      </div>
      <div className="mt-1 text-[17px] font-semibold text-paper">{title}</div>
      <p className="mt-1 max-w-[46ch] text-[14px] leading-relaxed text-paper/70">{children}</p>
    </div>
  );
}
