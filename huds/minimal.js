/* huds/minimal.js — a reference SWAPPABLE HUD prototype.

   This is the template to copy when prototyping a new HUD. It's an ES module that the dev menu
   `import()`s on demand; it default-exports a FACTORY (root, handlers) => instance. It reads the
   SAME ARENA sim API as the classic HUD (window.ARENA) and acts on the game only through the
   shared `handlers` controller — it never touches sim state or the renderer. It also brings its
   OWN styles (a <style> inside `root`, auto-removed when the host clears root on swap), so a
   prototype is fully self-contained.

   Contract (all optional — the host no-ops anything missing, so a partial prototype is fine):
     update(s)            paint a live frame from a sim snapshot
     showMenu(meta,opts)  the between-runs Workshop view
     refreshMenu(meta)    re-render the menu after a purchase
     hideMenu()           leaving the menu (run starting / overview)
     showOverview(m,earn) the post-death summary
     hideOverview()
     showHint(html) / hideHint()
     setMeta(meta)        cache meta for menu re-renders
     destroy()            teardown before a swap (only needed if you add global listeners) */
const A = window.ARENA;

export default function createMinimalHud(root, handlers) {
  let meta = null, builtRun = false;
  const ATTACK = () => A.upgradesIn('attack'); // this proof HUD only surfaces the attack tab

  root.innerHTML =
    '<style>' +
    '.mhud{position:fixed;inset:0;pointer-events:none;font:13px ui-monospace,SFMono-Regular,Menlo,monospace;color:#e7e1ff}' +
    '.mhud .hide{display:none!important}' +
    '.mhud button{pointer-events:auto;cursor:pointer;font:inherit}' +
    '.m-top{position:fixed;top:10px;left:12px;display:flex;gap:14px;letter-spacing:.5px;' +
    'text-shadow:0 1px 3px #000;color:#ff5ad0;font-weight:700}' +
    '.m-run{position:fixed;left:12px;bottom:12px;display:flex;flex-direction:column;gap:4px;max-height:60vh;overflow:auto}' +
    '.m-up{display:grid;grid-template-columns:120px 70px 56px;gap:8px;align-items:center;text-align:left;' +
    'background:rgba(20,12,28,.82);border:1px solid #5a2a6e;border-radius:4px;color:#e7e1ff;padding:5px 8px}' +
    '.m-up b{font-weight:600;color:#ff8de0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
    '.m-up em{font-style:normal;text-align:right;color:#9ad0ff}.m-up em.no{color:#ff6b7d}' +
    '.m-menu,.m-over{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(6,4,12,.78);pointer-events:auto}' +
    '.m-card{background:#140c1c;border:1px solid #5a2a6e;border-radius:8px;padding:22px;min-width:300px;max-height:84vh;overflow:auto;box-shadow:0 10px 40px #000}' +
    '.m-title{font-size:20px;font-weight:800;letter-spacing:3px;color:#ff5ad0;text-align:center;margin-bottom:6px}' +
    '.m-cores{text-align:center;color:#9ad0ff;margin-bottom:14px}' +
    '.m-start{width:100%;padding:12px;margin-bottom:14px;background:#ff2e9a;border:0;border-radius:6px;color:#fff;' +
    'font-weight:800;letter-spacing:2px}' +
    '.m-perms{display:flex;flex-direction:column;gap:5px}' +
    '.m-perm{display:grid;grid-template-columns:1fr 64px 56px;gap:8px;align-items:center;text-align:left;' +
    'background:#1d1228;border:1px solid #4a2360;border-radius:5px;color:#e7e1ff;padding:8px}' +
    '.m-perm b{font-weight:600}.m-perm span{color:#9ad0ff;text-align:right}.m-perm em{font-style:normal;text-align:right;color:#ffd34d}' +
    '.m-perm.off{opacity:.5}' +
    '.m-stats{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:10px 0 16px;text-align:center}' +
    '.m-stats div{background:#1d1228;border:1px solid #4a2360;border-radius:5px;padding:10px}' +
    '.m-hint{position:fixed;top:46px;left:50%;transform:translateX(-50%);background:rgba(20,12,28,.92);' +
    'border:1px solid #5a2a6e;border-radius:5px;padding:8px 12px;color:#ff8de0}' +
    '</style>' +
    '<div class="mhud">' +
    '  <div class="m-top hide" id="m-top"><span id="m-wave">W1</span><span id="m-hp">HP</span><span id="m-gold">0g</span></div>' +
    '  <div class="m-run hide" id="m-run"></div>' +
    '  <div class="m-menu hide" id="m-menu"></div>' +
    '  <div class="m-over hide" id="m-over"></div>' +
    '  <div class="m-hint hide" id="m-hint"></div>' +
    '</div>';

  const $ = (s) => root.querySelector(s);
  const show = (id, on) => $(id).classList.toggle('hide', !on);

  function setMeta(m) { meta = m; }

  function renderMenu() {
    const cores = (meta && meta.cores) || 0;
    let h = '<div class="m-card"><div class="m-title">MINIMAL</div>' +
      '<div class="m-cores">Cores: ' + cores + '</div>' +
      '<button class="m-start" id="m-start">START RUN &#9654;</button><div class="m-perms">';
    ATTACK().forEach((u) => {
      const bought = A.permBought(meta, u.id), maxed = A.permAtMax(meta, u.id), cost = A.permCost(meta, u.id);
      h += '<button class="m-perm' + ((cores >= cost && !maxed) ? '' : ' off') + '" data-perm="' + u.id + '">' +
        '<b>' + u.label + '</b><span>' + u.fmt(bought) + '</span><em>' + (maxed ? 'MAX' : cost + 'c') + '</em></button>';
    });
    $('#m-menu').innerHTML = h + '</div></div>';
    $('#m-start').addEventListener('click', () => handlers.onStartRun && handlers.onStartRun());
    $('#m-menu').querySelectorAll('[data-perm]').forEach((b) =>
      b.addEventListener('click', () => { if (handlers.onBuyPerm && handlers.onBuyPerm(b.dataset.perm)) renderMenu(); }));
  }

  function showMenu(m) { if (m) meta = m; builtRun = false; show('#m-top', false); show('#m-run', false); show('#m-over', false); renderMenu(); show('#m-menu', true); }
  function refreshMenu(m) { if (m) meta = m; if (!$('#m-menu').classList.contains('hide')) renderMenu(); }
  function hideMenu() { show('#m-menu', false); }

  function buildRun() {
    let h = '';
    ATTACK().forEach((u) => {
      h += '<button class="m-up" data-run="' + u.id + '"><b>' + u.label + '</b>' +
        '<span id="m-cur-' + u.id + '"></span><em id="m-cost-' + u.id + '"></em></button>';
    });
    $('#m-run').innerHTML = h;
    $('#m-run').querySelectorAll('[data-run]').forEach((b) =>
      b.addEventListener('click', () => handlers.onBuyRun && handlers.onBuyRun(b.dataset.run)));
    builtRun = true;
  }

  function update(s) {
    show('#m-top', true);
    if (!builtRun) buildRun();
    show('#m-run', true);
    $('#m-wave').textContent = 'W' + s.wave.n;
    $('#m-hp').textContent = 'HP ' + Math.ceil(s.hero.hp) + '/' + Math.ceil(s.hero.hpMax);
    $('#m-gold').textContent = s.econ.gold + 'g';
    ATTACK().forEach((u) => {
      const cur = $('#m-cur-' + u.id), cost = $('#m-cost-' + u.id); if (!cur || !cost) return;
      cur.textContent = u.fmt(A.boughtOf(s, u.id));
      if (A.runAtMax(s, u.id)) { cost.textContent = 'MAX'; cost.classList.remove('no'); }
      else { const c = A.runUpgradeCost(s, u.id); cost.textContent = c + 'g'; cost.classList.toggle('no', s.econ.gold < c); }
    });
  }

  function showOverview(m, earn) {
    if (m) meta = m; earn = earn || {};
    show('#m-top', false); show('#m-run', false); show('#m-menu', false);
    $('#m-over').innerHTML = '<div class="m-card"><div class="m-title">RUN OVER</div>' +
      '<div class="m-stats"><div>Wave ' + (earn.wave || 0) + '</div><div>Kills ' + (earn.kills || 0) + '</div>' +
      '<div>+' + (earn.cores || 0) + ' cores</div></div>' +
      '<button class="m-start" id="m-back">&#9664; WORKSHOP</button></div>';
    $('#m-back').addEventListener('click', () => handlers.onToWorkshop && handlers.onToWorkshop());
    show('#m-over', true);
  }
  function hideOverview() { show('#m-over', false); }
  function showHint(html) { $('#m-hint').innerHTML = html; show('#m-hint', true); }
  function hideHint() { show('#m-hint', false); }

  return { update, showMenu, refreshMenu, hideMenu, showOverview, hideOverview, showHint, hideHint, setMeta };
}
