import { useEffect, useRef, type ReactNode } from 'react';

const HIDE_AFTER_MS = 1000;
const MIN_THUMB = 24;
const GAP = 2;

/**
 * Scroll area whose bars stay hidden until the pointer is over it or it moves,
 * then fade a second after the pointer leaves and scrolling stops.
 * Native bars are turned off so they do not reserve a gutter.
 */
export function DomainTableScroll({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const verticalRef = useRef<HTMLDivElement>(null);
  const horizontalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    const host = hostRef.current;
    const vertical = verticalRef.current;
    const horizontal = horizontalRef.current;
    if (!el || !host || !vertical || !horizontal) return;

    let hideTimer = 0;
    let dragging: { axis: 'y' | 'x'; start: number; scroll: number } | null =
      null;
    // Free travel for each thumb, kept from the last place() for dragging.
    let vTravel = 0;
    let hTravel = 0;

    const place = () => {
      const {
        scrollTop,
        scrollLeft,
        scrollHeight,
        scrollWidth,
        clientHeight,
        clientWidth,
      } = el;
      const both =
        scrollHeight > clientHeight + 1 && scrollWidth > clientWidth + 1;
      // The column names stick to the top, so the vertical track starts
      // under them and sizes to the body rows alone.
      const header = el.querySelector('thead')?.offsetHeight ?? 0;
      const vRoom = clientHeight - header - GAP * 2 - (both ? 12 : 0);
      const hRoom = clientWidth - GAP * 2 - (both ? 12 : 0);

      if (scrollHeight <= clientHeight + 1) {
        vertical.hidden = true;
      } else {
        vertical.hidden = false;
        const size = Math.max(
          MIN_THUMB,
          ((clientHeight - header) / (scrollHeight - header)) * vRoom,
        );
        const max = Math.max(0, vRoom - size);
        vTravel = max;
        const top = (scrollTop / (scrollHeight - clientHeight)) * max;
        vertical.style.top = `${header + GAP}px`;
        vertical.style.height = `${size}px`;
        vertical.style.transform = `translateY(${top}px)`;
      }

      if (scrollWidth <= clientWidth + 1) {
        horizontal.hidden = true;
      } else {
        horizontal.hidden = false;
        const size = Math.max(MIN_THUMB, (clientWidth / scrollWidth) * hRoom);
        const max = Math.max(0, hRoom - size);
        hTravel = max;
        const left = (scrollLeft / (scrollWidth - clientWidth)) * max;
        horizontal.style.width = `${size}px`;
        horizontal.style.transform = `translateX(${left}px)`;
      }
    };

    const reveal = () => {
      host.classList.add('is-scrollbar-visible');
      window.clearTimeout(hideTimer);
    };
    const scheduleHide = () => {
      if (dragging) return;
      window.clearTimeout(hideTimer);
      hideTimer = window.setTimeout(() => {
        if (host.matches(':hover') || dragging) return;
        host.classList.remove('is-scrollbar-visible');
      }, HIDE_AFTER_MS);
    };
    const onScroll = () => {
      place();
      reveal();
      scheduleHide();
    };
    const startDrag = (axis: 'y' | 'x', event: PointerEvent) => {
      event.preventDefault();
      event.stopPropagation();
      dragging = {
        axis,
        start: axis === 'y' ? event.clientY : event.clientX,
        scroll: axis === 'y' ? el.scrollTop : el.scrollLeft,
      };
      reveal();
      (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    };
    const onPointerMove = (event: PointerEvent) => {
      if (!dragging) return;
      const { scrollHeight, scrollWidth, clientHeight, clientWidth } = el;
      if (dragging.axis === 'y') {
        const room = vTravel;
        const span = scrollHeight - clientHeight;
        if (room > 0)
          el.scrollTop =
            dragging.scroll + ((event.clientY - dragging.start) * span) / room;
      } else {
        const room = hTravel;
        const span = scrollWidth - clientWidth;
        if (room > 0)
          el.scrollLeft =
            dragging.scroll + ((event.clientX - dragging.start) * span) / room;
      }
    };
    const endDrag = () => {
      if (!dragging) return;
      dragging = null;
      scheduleHide();
    };

    vertical.addEventListener('pointerdown', (event) => startDrag('y', event));
    horizontal.addEventListener('pointerdown', (event) =>
      startDrag('x', event),
    );
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', endDrag);
    window.addEventListener('pointercancel', endDrag);
    el.addEventListener('scroll', onScroll, { passive: true });
    host.addEventListener('pointerenter', reveal);
    host.addEventListener('pointerleave', scheduleHide);
    const observer = new ResizeObserver(place);
    observer.observe(el);
    const thead = el.querySelector('thead');
    if (thead) observer.observe(thead);
    place();

    return () => {
      window.clearTimeout(hideTimer);
      observer.disconnect();
      el.removeEventListener('scroll', onScroll);
      host.removeEventListener('pointerenter', reveal);
      host.removeEventListener('pointerleave', scheduleHide);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', endDrag);
      window.removeEventListener('pointercancel', endDrag);
      host.classList.remove('is-scrollbar-visible');
    };
  }, []);

  return (
    <div
      ref={hostRef}
      className="domain-scroll-host relative min-h-0 min-w-0 flex-1"
    >
      <div ref={scrollRef} className={className}>
        {children}
      </div>
      <div
        ref={verticalRef}
        aria-hidden
        className="domain-scroll-thumb domain-scroll-thumb-v"
      />
      <div
        ref={horizontalRef}
        aria-hidden
        className="domain-scroll-thumb domain-scroll-thumb-h"
      />
    </div>
  );
}
