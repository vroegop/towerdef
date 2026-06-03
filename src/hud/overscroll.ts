/* src/hud/overscroll.ts — custom rubber-band overscroll for HUD scroll panels.

   Native overscroll bounce is intentionally suppressed here (body { touch-action:none },
   .tabcontent { overscroll-behavior:contain }) and — more importantly — no browser bounces
   inner scroll containers on mouse-wheel/trackpad at all. So we recreate the iOS-style
   "pull past the edge → reveal a gap → spring back on release" feel by hand, consistently
   across platforms, for BOTH touch-drag and wheel.

   How it works: the scroll element keeps its own native scrolling. We wrap it in an
   `.os-clip` parent that clips with overflow:hidden. Once the element is pinned at an edge
   and the gesture keeps pushing further, we translate the *element itself* (revealing the
   gap inside the clip — it never overlaps siblings) with resistance that grows toward a cap,
   then spring the transform back to 0. Wrapping the parent rather than the children means
   this survives the frequent `el.innerHTML = …` rebuilds the HUD does: those only replace
   the element's children, leaving the element and its clip wrapper (and the live transform)
   untouched. */

const MAX_PULL = 110; // hard cap (px) on how far content can be pulled past an edge
const TOUCH_RESIST = 0.5; // base fraction of finger travel applied while overscrolling
const WHEEL_RESIST = 0.28; // wheel deltas are coarse, so pull a little less per tick
const WHEEL_IDLE_MS = 90; // spring back this long after the last wheel tick
// A touch of overshoot past 0 on the return reads as a "bounce" rather than a slide.
const SPRING = 'transform .42s cubic-bezier(.22,1.2,.36,1)';

export function attachOverscrollBounce(el: HTMLElement | null): void {
  if (!el || el.dataset.osBounce) return;
  el.dataset.osBounce = '1';

  const cs = getComputedStyle(el);
  // Bounce along whichever axis actually scrolls (the horizontal active-cards strip vs. the
  // vertical panels). We treat "scrolls horizontally and not vertically" as the X case.
  const horizontal =
    (cs.overflowX === 'auto' || cs.overflowX === 'scroll') && cs.overflowY !== 'auto' && cs.overflowY !== 'scroll';

  // ---- clip wrapper ----
  const clip = document.createElement('div');
  clip.className = 'os-clip';
  clip.style.overflow = 'hidden';
  // Preserve the element's layout role. Stretch-fill flex items (flex-grow>0, e.g. the menu
  // body and modal bodies) need the clip to take their place in the flex line and the element
  // to fill the clip; plain block panels (e.g. the tab dock, sized by its own max-height) are
  // simply wrapped as-is.
  if (parseFloat(cs.flexGrow) > 0) {
    clip.style.flex = cs.flex;
    clip.style.alignSelf = cs.alignSelf;
    clip.style.display = 'flex';
    clip.style.flexDirection = horizontal ? 'row' : 'column';
    clip.style.minWidth = '0';
    clip.style.minHeight = '0';
    el.style.flex = '1 1 0';
    el.style.minWidth = '0';
    el.style.minHeight = '0';
  }
  el.parentNode!.insertBefore(clip, el);
  clip.appendChild(el);

  let offset = 0; // current rubber-band translate (px), signed
  let springTimer = 0;
  let wheelTimer = 0;

  const pos = (): number => (horizontal ? el.scrollLeft : el.scrollTop);
  const maxPos = (): number => (horizontal ? el.scrollWidth - el.clientWidth : el.scrollHeight - el.clientHeight);
  const cap = (): number => Math.min(MAX_PULL, (horizontal ? el.clientWidth : el.clientHeight) * 0.5);

  function apply(): void {
    el!.style.transform = offset ? (horizontal ? `translateX(${offset}px)` : `translateY(${offset}px)`) : '';
  }

  // Add `delta` of gesture travel (toward the over-scrolled side is positive at the start edge,
  // negative at the end edge) while pinned at an edge, with resistance that grows toward the cap
  // so the pull feels heavier the further you go. Returns true if it consumed the gesture.
  function pull(delta: number, resist: number): boolean {
    const atStart = pos() <= 0;
    const atEnd = pos() >= maxPos() - 1;
    const canStart = maxPos() > 0 && ((atStart && delta > 0) || (atEnd && delta < 0));
    if (offset === 0 && !canStart) return false;
    const c = cap();
    const f = resist * (1 - Math.min(1, Math.abs(offset) / c));
    offset += delta * f;
    // A reversing gesture must not drag past 0 into the wrong direction — hand back to native.
    if (atStart && offset < 0) offset = 0;
    if (atEnd && offset > 0) offset = 0;
    offset = Math.max(-c, Math.min(c, offset));
    el!.style.transition = 'none';
    apply();
    return offset !== 0;
  }

  function springBack(): void {
    if (!offset && !el!.style.transform) return;
    offset = 0;
    el!.style.transition = SPRING;
    el!.style.transform = '';
    clearTimeout(springTimer);
    springTimer = window.setTimeout(() => {
      el!.style.transition = '';
    }, 460);
  }

  // ---- touch drag ----
  let last = 0;
  el.addEventListener(
    'touchstart',
    (e) => {
      clearTimeout(springTimer);
      el!.style.transition = 'none';
      last = horizontal ? e.touches[0].clientX : e.touches[0].clientY;
    },
    { passive: true },
  );
  el.addEventListener(
    'touchmove',
    (e) => {
      const c = horizontal ? e.touches[0].clientX : e.touches[0].clientY;
      const delta = c - last;
      last = c;
      if (pull(delta, TOUCH_RESIST)) e.preventDefault();
    },
    { passive: false },
  );
  el.addEventListener('touchend', springBack, { passive: true });
  el.addEventListener('touchcancel', springBack, { passive: true });

  // ---- wheel / trackpad ----
  el.addEventListener(
    'wheel',
    (e) => {
      // A positive delta scrolls toward the end; overscrolling there moves content the other
      // way, so feed the negated delta into pull() (matching the touch sign convention).
      const raw = horizontal ? e.deltaX || e.deltaY : e.deltaY;
      if (pull(-raw, WHEEL_RESIST)) {
        e.preventDefault();
        clearTimeout(wheelTimer);
        wheelTimer = window.setTimeout(springBack, WHEEL_IDLE_MS); // no "release" event, so spring on idle
      }
    },
    { passive: false },
  );
}

/** Attach the bounce to every matching scroll container under `root` (idempotent). */
export function attachOverscrollBounceAll(root: ParentNode, selector: string): void {
  root.querySelectorAll<HTMLElement>(selector).forEach(attachOverscrollBounce);
}
