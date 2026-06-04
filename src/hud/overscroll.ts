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
   untouched.

   The clip inherits the panel's background colour so the revealed gap reads as the panel's
   own edge, not a black hole behind it. With `alwaysBounce` (the default) a panel that the
   player would *expect* to scroll bounces even when its content currently fits, so it feels
   like "there's nothing more here" instead of a dead, broken scroll. */

const MAX_PULL = 110; // hard cap (px) on how far content can be pulled past an edge
const TOUCH_RESIST = 0.5; // base fraction of finger travel applied while overscrolling
const WHEEL_RESIST = 0.28; // wheel deltas are coarse, so pull a little less per tick
const WHEEL_IDLE_MS = 90; // spring back this long after the last wheel tick
// A touch of overshoot past 0 on the return reads as a "bounce" rather than a slide.
const SPRING = 'transform .42s cubic-bezier(.22,1.2,.36,1)';

interface BounceOpts {
  // Bounce even when the content currently fits (not scrollable). True by default: panels the
  // player expects to scroll should still rubber-band so a full list and a short one feel the
  // same. Pass false for incidental scrollers (e.g. a 1-card horizontal strip) that shouldn't
  // wobble when there's nothing to scroll.
  alwaysBounce?: boolean;
}

// True when a computed colour actually paints something (alpha > 0). `transparent` and a 0-alpha
// rgba() return false; an `rgb()` or any positive-alpha rgba() returns true.
function isOpaqueColor(c: string): boolean {
  const m = /^rgba?\(([^)]+)\)/.exec(c);
  if (!m) return false;
  const parts = m[1].split(',');
  const alpha = parts.length === 4 ? parseFloat(parts[3]) : 1;
  return alpha > 0;
}

export function attachOverscrollBounce(el: HTMLElement | null, opts: BounceOpts = {}): void {
  if (!el || el.dataset.osBounce) return;
  el.dataset.osBounce = '1';
  const alwaysBounce = opts.alwaysBounce !== false;

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
  // body and modal bodies) need the clip to take their exact place in the flex line; the
  // element then keeps its OWN flex (crucially flex-basis) so a content-sized modal still sizes
  // to its content rather than collapsing. Plain block panels (e.g. the tab dock, sized by its
  // own max-height) are simply wrapped as-is.
  //
  // The distinction is whether the panel is a flex *item* (its parent lays it out with flexbox) —
  // not whether it grows. A non-growing flex child (e.g. the milestones list, which shrinks to fit
  // the modal and scrolls) still needs the clip to stand in for it on the flex line, or the modal
  // mis-sizes and the content spills to the very edge over the shell's shadow.
  // `flexGrow > 0` is visibility-independent (panels like the menu body are wrapped while their
  // overlay is still display:none). For non-growing vertical panels — chiefly the milestones list,
  // which shrinks to fit its modal and scrolls — fall back to checking whether the parent actually
  // lays the panel out with flexbox (those are always wrapped while visible, so this reads true).
  const parentDisplay = el.parentElement ? getComputedStyle(el.parentElement).display : '';
  const parentIsFlex = parentDisplay === 'flex' || parentDisplay === 'inline-flex';
  const isFlexItem = parseFloat(cs.flexGrow) > 0 || (!horizontal && parentIsFlex);
  if (isFlexItem) {
    clip.style.display = 'flex';
    clip.style.flexDirection = horizontal ? 'row' : 'column';
    clip.style.flexGrow = cs.flexGrow;
    clip.style.flexShrink = cs.flexShrink;
    clip.style.flexBasis = cs.flexBasis;
    clip.style.alignSelf = cs.alignSelf;
    clip.style.minWidth = '0';
    clip.style.minHeight = '0';
    // Let both the clip and the element shrink below their content so overflow scrolling still
    // engages inside the cap. The element keeps its own flex shorthand untouched.
    el.style.minWidth = '0';
    el.style.minHeight = '0';
  }
  el.parentNode!.insertBefore(clip, el);
  clip.appendChild(el);
  // Fill the overscroll gap with the panel's OWN surface colour when it has one (e.g. the parchment
  // menu body), so pulling it never reveals the darker frame behind it. When the panel is itself
  // transparent — a modal body whose parchment fill + inset border live on the modal shell — leave
  // the clip transparent so the gap reveals that shell intact. Painting it here would hide the
  // shell's inset border and make the content look like it spills past the frame.
  const ownBg = getComputedStyle(el).backgroundColor;
  if (isOpaqueColor(ownBg)) clip.style.background = ownBg;

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
    const max = maxPos();
    const scrollable = max > 0;
    const atStart = pos() <= 0;
    const atEnd = pos() >= max - 1;
    const canStart = (atStart && delta > 0) || (atEnd && delta < 0);
    // Don't bounce a non-scrollable panel unless it's explicitly opted in.
    if (!scrollable && !alwaysBounce) return false;
    if (offset === 0 && !canStart) return false;
    const c = cap();
    const f = resist * (1 - Math.min(1, Math.abs(offset) / c));
    offset += delta * f;
    // While there's still scroll room on one side, a reversing gesture must hand back to native
    // rather than drag past 0 into the wrong direction. When the panel can't scroll at all both
    // edges are "live", so we let the offset cross 0 freely (top bounce ↔ bottom bounce).
    if (scrollable) {
      if (atStart && offset < 0) offset = 0;
      if (atEnd && offset > 0) offset = 0;
    }
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
export function attachOverscrollBounceAll(root: ParentNode, selector: string, opts: BounceOpts = {}): void {
  root.querySelectorAll<HTMLElement>(selector).forEach((el) => attachOverscrollBounce(el, opts));
}
