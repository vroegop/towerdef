/* input/joystick.js — dynamic virtual joystick. Touch anywhere in the zone to place it.
   Pure input: it only produces a movement vector; the sim reads it as hero.intent. */
(function (A) {
  A.Joystick = function (zone) {
    const out = { x: 0, y: 0, active: false };
    const R = 60; // max throw in px
    let pid = null, cx = 0, cy = 0;

    const base = document.createElement('div');
    const knob = document.createElement('div');
    Object.assign(base.style, {
      position: 'fixed', width: R * 2 + 'px', height: R * 2 + 'px', borderRadius: '50%',
      border: '2px solid rgba(74,168,255,.35)', background: 'rgba(74,168,255,.06)',
      pointerEvents: 'none', display: 'none', transform: 'translate(-50%,-50%)', zIndex: 30,
    });
    Object.assign(knob.style, {
      position: 'fixed', width: '46px', height: '46px', borderRadius: '50%',
      background: 'rgba(74,168,255,.5)', pointerEvents: 'none', display: 'none',
      transform: 'translate(-50%,-50%)', zIndex: 31,
    });
    document.body.appendChild(base); document.body.appendChild(knob);

    function show(x, y) { base.style.display = knob.style.display = 'block'; base.style.left = knob.style.left = x + 'px'; base.style.top = knob.style.top = y + 'px'; }
    function moveKnob(x, y) { knob.style.left = x + 'px'; knob.style.top = y + 'px'; }
    function hide() { base.style.display = knob.style.display = 'none'; }

    zone.addEventListener('pointerdown', (e) => {
      if (pid !== null) return;
      pid = e.pointerId; cx = e.clientX; cy = e.clientY; out.active = true;
      show(cx, cy);
    });
    window.addEventListener('pointermove', (e) => {
      if (e.pointerId !== pid) return;
      let dx = e.clientX - cx, dy = e.clientY - cy;
      const d = Math.hypot(dx, dy), m = Math.min(d, R), a = Math.atan2(dy, dx);
      out.x = Math.cos(a) * (m / R); out.y = Math.sin(a) * (m / R);
      moveKnob(cx + Math.cos(a) * m, cy + Math.sin(a) * m);
    });
    const end = (e) => { if (e.pointerId !== pid) return; pid = null; out.x = 0; out.y = 0; out.active = false; hide(); };
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);

    return out;
  };
})(window.ARENA = window.ARENA || {});
