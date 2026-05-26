(function(){
  var PRESETS = [
    {
      name: 'Atardecer',
      swatchA: '#c88200', swatchB: '#00703c', swatchC: '#003d8f',
      grad: 'radial-gradient(ellipse at 5% 45%,rgba(200,130,0,.38) 0%,transparent 55%),radial-gradient(ellipse at 38% 85%,rgba(15,180,90,.28) 0%,transparent 55%),radial-gradient(ellipse at 75% 25%,rgba(0,110,220,.22) 0%,transparent 55%),radial-gradient(ellipse at 95% 70%,rgba(90,10,180,.3) 0%,transparent 55%),#080810'
    },
    {
      name: 'Océano',
      swatchA: '#0050c8', swatchB: '#00b0c8', swatchC: '#5000c8',
      grad: 'radial-gradient(ellipse at 10% 30%,rgba(0,80,200,.42) 0%,transparent 55%),radial-gradient(ellipse at 60% 75%,rgba(0,180,200,.32) 0%,transparent 55%),radial-gradient(ellipse at 90% 20%,rgba(80,0,200,.32) 0%,transparent 55%),#060812'
    },
    {
      name: 'Bosque',
      swatchA: '#00a050', swatchB: '#007890', swatchC: '#3c0078',
      grad: 'radial-gradient(ellipse at 20% 65%,rgba(0,160,80,.38) 0%,transparent 55%),radial-gradient(ellipse at 75% 35%,rgba(0,120,160,.3) 0%,transparent 55%),radial-gradient(ellipse at 55% 92%,rgba(60,0,120,.28) 0%,transparent 55%),#060e0a'
    },
    {
      name: 'Aurora',
      swatchA: '#c000a0', swatchB: '#00c8b4', swatchC: '#6400c8',
      grad: 'radial-gradient(ellipse at 0% 55%,rgba(180,0,120,.38) 0%,transparent 55%),radial-gradient(ellipse at 55% 5%,rgba(0,200,180,.32) 0%,transparent 55%),radial-gradient(ellipse at 100% 65%,rgba(100,0,200,.32) 0%,transparent 55%),#080812'
    },
    {
      name: 'Volcán',
      swatchA: '#dc3200', swatchB: '#c87800', swatchC: '#5000a0',
      grad: 'radial-gradient(ellipse at 15% 70%,rgba(220,50,0,.4) 0%,transparent 55%),radial-gradient(ellipse at 60% 25%,rgba(200,120,0,.32) 0%,transparent 55%),radial-gradient(ellipse at 90% 80%,rgba(80,0,160,.3) 0%,transparent 55%),#0e0608'
    },
    {
      name: 'Obsidiana',
      swatchA: '#303060', swatchB: '#202050', swatchC: '#101030',
      grad: 'radial-gradient(ellipse at 25% 35%,rgba(50,50,120,.45) 0%,transparent 60%),radial-gradient(ellipse at 75% 70%,rgba(30,30,90,.35) 0%,transparent 60%),#04040e'
    }
  ];

  var SK = 'trazzo_theme';
  var cur = parseInt(localStorage.getItem(SK) || '0', 10);
  if (cur < 0 || cur >= PRESETS.length) cur = 0;

  function applyPreset(idx) {
    cur = idx;
    localStorage.setItem(SK, String(idx));
    document.documentElement.style.setProperty('--t-grad', PRESETS[idx].grad);
  }

  // ── PICKER UI ──────────────────────────────────────────────────
  function buildUI() {
    // Picker panel (hidden initially)
    var picker = document.createElement('div');
    picker.id = '_tPicker';
    picker.style.cssText = [
      'position:fixed;bottom:64px;right:14px;z-index:99900',
      'display:flex;flex-direction:column;gap:8px',
      'background:rgba(8,8,22,.92);backdrop-filter:blur(28px);-webkit-backdrop-filter:blur(28px)',
      'border:0.5px solid rgba(255,255,255,.12);border-radius:18px;padding:12px 14px',
      'box-shadow:0 16px 60px rgba(0,0,0,.85)',
      'opacity:0;pointer-events:none;transform:translateY(6px);transition:opacity .22s,transform .22s'
    ].join(';');

    // Title
    var title = document.createElement('div');
    title.style.cssText = 'font-size:9px;font-weight:700;color:rgba(255,255,255,.35);letter-spacing:.1em;text-transform:uppercase;margin-bottom:2px;font-family:Inter,sans-serif;';
    title.textContent = 'Tema de color';
    picker.appendChild(title);

    // Swatches row
    PRESETS.forEach(function(p, i) {
      var row = document.createElement('button');
      row.style.cssText = [
        'display:flex;align-items:center;gap:10px',
        'background:' + (i === cur ? 'rgba(255,255,255,.1)' : 'transparent'),
        'border:0.5px solid ' + (i === cur ? 'rgba(255,255,255,.22)' : 'transparent'),
        'border-radius:10px;padding:7px 10px;cursor:pointer',
        'transition:all .15s;width:100%;font-family:Inter,sans-serif'
      ].join(';');

      // Mini gradient circle
      var circle = document.createElement('div');
      circle.style.cssText = [
        'width:26px;height:26px;border-radius:50%;flex-shrink:0',
        'background:conic-gradient(' + p.swatchA + ' 0deg,' + p.swatchB + ' 120deg,' + p.swatchC + ' 240deg,' + p.swatchA + ' 360deg)',
        'box-shadow:0 2px 8px rgba(0,0,0,.5)'
      ].join(';');

      var label = document.createElement('span');
      label.style.cssText = 'font-size:12px;font-weight:600;color:rgba(255,255,255,' + (i === cur ? '.9' : '.45') + ');';
      label.textContent = p.name;

      if (i === cur) {
        var check = document.createElement('span');
        check.style.cssText = 'margin-left:auto;font-size:11px;color:rgba(255,255,255,.6);';
        check.textContent = '✓';
        row.appendChild(circle);
        row.appendChild(label);
        row.appendChild(check);
      } else {
        row.appendChild(circle);
        row.appendChild(label);
      }

      row.onmouseenter = function() { if (i !== cur) row.style.background = 'rgba(255,255,255,.06)'; };
      row.onmouseleave = function() { if (i !== cur) row.style.background = 'transparent'; };
      row.onclick = function() { applyPreset(i); rebuildPicker(); };
      picker.appendChild(row);
    });

    document.body.appendChild(picker);
    return picker;
  }

  var _picker = null;
  function rebuildPicker() {
    if (_picker) { _picker.remove(); }
    _picker = buildUI();
  }

  // ── TRIGGER BUTTON ────────────────────────────────────────────
  function buildTrigger() {
    var btn = document.createElement('button');
    btn.id = '_tBtn';
    btn.title = 'Cambiar tema';
    btn.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>';
    btn.style.cssText = [
      'position:fixed;bottom:18px;right:18px;z-index:99901',
      'width:38px;height:38px;border-radius:50%',
      'background:rgba(10,10,28,.88);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px)',
      'border:0.5px solid rgba(255,255,255,.16);color:rgba(255,255,255,.52)',
      'cursor:pointer;display:flex;align-items:center;justify-content:center',
      'box-shadow:0 4px 22px rgba(0,0,0,.7);transition:all .18s;font-family:Inter,sans-serif'
    ].join(';');

    btn.onmouseenter = function() { btn.style.color = '#fff'; btn.style.borderColor = 'rgba(255,255,255,.32)'; btn.style.background = 'rgba(16,16,40,.95)'; };
    btn.onmouseleave = function() { btn.style.color = 'rgba(255,255,255,.52)'; btn.style.borderColor = 'rgba(255,255,255,.16)'; btn.style.background = 'rgba(10,10,28,.88)'; };

    var _open = false;
    btn.onclick = function(e) {
      e.stopPropagation();
      _open = !_open;
      if (!_picker) _picker = buildUI();
      _picker.style.opacity = _open ? '1' : '0';
      _picker.style.transform = _open ? 'translateY(0)' : 'translateY(6px)';
      _picker.style.pointerEvents = _open ? 'all' : 'none';
    };

    document.addEventListener('click', function(e) {
      if (_open && _picker && !_picker.contains(e.target) && e.target !== btn) {
        _open = false;
        _picker.style.opacity = '0';
        _picker.style.transform = 'translateY(6px)';
        _picker.style.pointerEvents = 'none';
      }
    });

    document.body.appendChild(btn);
  }

  // ── INIT ─────────────────────────────────────────────────────
  applyPreset(cur);
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() { buildTrigger(); });
  } else {
    buildTrigger();
  }
})();
