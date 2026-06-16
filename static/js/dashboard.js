/* ============================================================
   1. TAB SWITCHING (URL hash persists active tab)
   ============================================================ */
const TABS = ['overview','tickets','techniciens','clients','machines','pieces'];

function activateTab(id) {
  const safe = TABS.includes(id) ? id : 'overview';
  document.querySelectorAll('.dash-tab').forEach(b => b.classList.toggle('active', b.dataset.panel === safe));
  document.querySelectorAll('.dash-panel').forEach(p => p.classList.toggle('active', p.id === 'panel-' + safe));
  if (safe === 'overview') { pipHandleResize(); renderOverviewSections(); }
  if (safe === 'techniciens') { renderTechKPIs(); renderTechTable(); }
  history.replaceState(null, '', '#' + safe);
}

document.querySelectorAll('.dash-tab').forEach(btn => {
  btn.addEventListener('click', () => activateTab(btn.dataset.panel));
});

/* ============================================================
   1b. STICKY FILTER ROW — shadow on scroll
   ============================================================ */
(function(){
  const sentinel = document.getElementById('filter-sentinel');
  const bar      = document.getElementById('filters-sticky-bar');
  if(!sentinel||!bar) return;
  new IntersectionObserver(
    ([e]) => bar.classList.toggle('is-stuck', !e.isIntersecting),
    {threshold:0, rootMargin:'-1px 0px 0px 0px'}
  ).observe(sentinel);
})();

/* ============================================================
   2. MULTI-SELECT CLASS
   ============================================================ */
const allFilterInstances = [];

class MultiSelect {
  constructor(elementId, name, placeholder, data, onChange = null) {
    this.elementId = elementId;
    this.name = name;
    this.container = document.getElementById(elementId);
    this.defaultPlaceholder = placeholder;
    this.data = data;
    this.selectedValues = new Set();
    this.searchQuery = '';
    this.onChange = onChange;
    this._build();
    allFilterInstances.push(this);
  }

  _build() {
    this.container.innerHTML = `
      <input type="text" class="ms-input" placeholder="${this.defaultPlaceholder}" autocomplete="off">
      <svg class="ms-chevron" viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9"/></svg>
      <div class="ms-dropdown"><div class="ms-options"></div></div>`;
    this.input = this.container.querySelector('.ms-input');
    this.optionsEl = this.container.querySelector('.ms-options');
    this.container.querySelector('.ms-dropdown').addEventListener('click', e => e.stopPropagation());
    this.input.addEventListener('focus', () => this.open());
    this.input.addEventListener('click', () => this.open());
    this.input.addEventListener('input', e => { this.searchQuery = e.target.value.toLowerCase(); this._renderOpts(); this.open(); });
    this._renderOpts();
  }

  open() {
    document.querySelectorAll('.ms-wrap').forEach(el => { if (el !== this.container) el.classList.remove('open'); });
    this.container.classList.add('open');
    this.input.classList.add('is-typing');
    this.input.classList.remove('has-selection');
    this.input.placeholder = 'Taper pour chercher...';
  }

  close() {
    this.container.classList.remove('open');
    this.input.value = '';
    this.input.classList.remove('is-typing');
    this.searchQuery = '';
    this._renderOpts();
    this._updatePlaceholder();
  }

  disable(msg) { this.input.disabled = true; this.input.placeholder = msg || this.defaultPlaceholder; this.container.classList.add('is-disabled'); }
  enable(msg) { this.input.disabled = false; if (msg) this.defaultPlaceholder = msg; this._updatePlaceholder(); this.container.classList.remove('is-disabled'); }

  setValuesSilent(arr) { this.selectedValues = new Set(arr); this._renderOpts(); this._updatePlaceholder(); }

  /* Swap in a new option list, pruning any stale selections silently.
     Does NOT fire onChange — cascade rebuild functions handle propagation. */
  updateData(newData) {
    const valid = new Set(newData.map(i => i.value));
    this.selectedValues.forEach(v => { if (!valid.has(v)) this.selectedValues.delete(v); });
    this.data = newData;
    this._renderOpts();
    this._updatePlaceholder();
  }

  removeValue(val) {
    this.selectedValues.delete(val);
    this._renderOpts(); this._updatePlaceholder();
    if (this.onChange) this.onChange(Array.from(this.selectedValues));
  }

  reset() {
    this.selectedValues.clear(); this.input.value = ''; this.searchQuery = '';
    this._renderOpts(); this._updatePlaceholder();
    if (this.onChange) this.onChange([]);
    updateGlobalTags();
  }

  _renderOpts() {
    this.optionsEl.innerHTML = '';
    const filtered = this.data.filter(i => i.label.toLowerCase().includes(this.searchQuery));
    if (!filtered.length) { this.optionsEl.innerHTML = '<div style="padding:10px 16px;font-size:12px;color:var(--light-slate);">Aucun résultat</div>'; return; }

    const groups = {};
    filtered.forEach(i => { const g = i.group || 'default'; (groups[g] = groups[g] || []).push(i); });

    for (const [gName, items] of Object.entries(groups)) {
      if (gName !== 'default') {
        const gl = document.createElement('div');
        const clickable = items.some(i => i.groupClickable);
        if (clickable) {
          const allV = items.map(i => i.value);
          const allSel = allV.every(v => this.selectedValues.has(v));
          gl.className = 'ms-group-label clickable';
          gl.innerHTML = `<span>${gName}</span><small>${allSel ? 'Tout décocher' : 'Tout cocher'}</small>`;
          gl.onclick = e => {
            e.stopPropagation();
            allSel ? allV.forEach(v => this.selectedValues.delete(v)) : allV.forEach(v => this.selectedValues.add(v));
            this._renderOpts(); this._updatePlaceholder();
            if (this.onChange) this.onChange(Array.from(this.selectedValues));
            updateGlobalTags();
          };
        } else {
          gl.className = 'ms-group-label';
          gl.innerHTML = `<span>${gName}</span>`;
        }
        this.optionsEl.appendChild(gl);
      }

      items.forEach(item => {
        const lbl = document.createElement('label');
        lbl.className = 'ms-opt';
        const checked = this.selectedValues.has(item.value) ? 'checked' : '';
        const content = item.htmlLabel || `<span>${item.label}</span>`;
        lbl.innerHTML = `<input type="checkbox" value="${item.value}" ${checked}>${content}`;
        lbl.querySelector('input').addEventListener('change', e => {
          e.target.checked ? this.selectedValues.add(item.value) : this.selectedValues.delete(item.value);
          this._updatePlaceholder();
          if (this.onChange) this.onChange(Array.from(this.selectedValues));
          this._renderOpts();
          updateGlobalTags();
        });
        this.optionsEl.appendChild(lbl);
      });
    }
  }

  _updatePlaceholder() {
    const n = this.selectedValues.size;
    if (n === 0) { this.input.placeholder = this.defaultPlaceholder; this.input.classList.remove('has-selection'); }
    else if (n === 1) {
      const v = Array.from(this.selectedValues)[0];
      const item = this.data.find(d => d.value === v);
      this.input.placeholder = item ? item.label : v;
      this.input.classList.add('has-selection');
    } else { this.input.placeholder = `${n} sélectionnés`; this.input.classList.add('has-selection'); }
  }
}

document.addEventListener('click', e => {
  allFilterInstances.forEach(inst => { if (!inst.container.contains(e.target) && inst.container.classList.contains('open')) inst.close(); });
});

/* ============================================================
   4. TAGS BAR
   ============================================================ */
function updateGlobalTags() {
  const bar = document.getElementById('active-tags-bar');
  bar.innerHTML = '';
  const ps = document.getElementById('period-select');
  if (ps.value !== 'year') {
    const t = document.createElement('div'); t.className = 'filter-tag';
    t.innerHTML = `<span>Période: <strong>${ps.options[ps.selectedIndex].text}</strong></span><span class="tag-close"><svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></span>`;
    t.querySelector('.tag-close').onclick = () => { ps.value = 'year'; ps.dispatchEvent(new Event('change')); };
    bar.appendChild(t);
  }
  allFilterInstances.forEach(inst => {
    if (!inst.selectedValues.size) return;
    const t = document.createElement('div'); t.className = 'filter-tag';
    if (inst.selectedValues.size === 1) {
      const v = Array.from(inst.selectedValues)[0];
      const item = inst.data.find(d => d.value === v);
      t.innerHTML = `<span>${inst.name}: <strong>${item ? item.label : v}</strong></span><span class="tag-close"><svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></span>`;
      t.querySelector('.tag-close').onclick = () => inst.removeValue(v);
    } else {
      t.innerHTML = `<span>${inst.name}: <strong>${inst.selectedValues.size} sélectionnés</strong></span><span class="tag-close"><svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></span>`;
      t.querySelector('.tag-close').onclick = () => inst.reset();
    }
    bar.appendChild(t);
  });
}

function resetAllFilters() {
  allFilterInstances.forEach(inst => inst.reset());
  document.getElementById('period-select').value = 'year';
  document.getElementById('period-select').dispatchEvent(new Event('change'));
}

/* ============================================================
   5. DATE PICKER
   ============================================================ */
function initDatePicker() {
  const sel = document.getElementById('period-select');
  const ds = document.getElementById('date-start');
  const de = document.getElementById('date-end');
  const fmt = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;

  function update() {
    const v = sel.value;
    if (v === 'custom') { updateGlobalTags(); return; }
    const today = new Date();
    let s = new Date(today), e = new Date(today);
    if (v === '7days') { s.setDate(today.getDate()-6); }
    else if (v === 'week') { const d = today.getDate()-today.getDay()+(today.getDay()===0?-6:1); s.setDate(d); e.setDate(s.getDate()+6); }
    else if (v === 'month') { s = new Date(today.getFullYear(),today.getMonth(),1); e = new Date(today.getFullYear(),today.getMonth()+1,0); }
    else if (v === 'quarter') { const q=Math.floor(today.getMonth()/3); s=new Date(today.getFullYear(),q*3,1); e=new Date(today.getFullYear(),q*3+3,0); }
    else if (v === 'year') { s=new Date(today.getFullYear(),0,1); e=new Date(today.getFullYear(),11,31); }
    ds.value = fmt(s); de.value = fmt(e);
    updateGlobalTags();
  }

  sel.addEventListener('change', update);
  ds.addEventListener('change', () => { sel.value='custom'; updateGlobalTags(); });
  de.addEventListener('change', () => { sel.value='custom'; updateGlobalTags(); });
  update();
}

/* ============================================================
   6. FILTER INITIALIZATION (real data from bootstrap)
   ============================================================ */
function initFilters(data) {
  const unique = arr => [...new Set(arr.filter(Boolean))];
  const parc = data.parc || [];

  const CHEMINS = [
    { label:'Envoyé',           value:'envoye',    group:'Flux Commun',     groupClickable:true, htmlLabel:'<span class="st-pill st-envoye">Envoyé</span>' },
    { label:'Assigné',          value:'assigne',   group:'Flux Commun',     groupClickable:true, htmlLabel:'<span class="st-pill st-assigne">Assigné</span>' },
    { label:'Attente pièce',    value:'attente',   group:'Chemin Terrain',  groupClickable:true, htmlLabel:'<span class="st-pill st-attente">Attente pièce</span>' },
    { label:'En route',         value:'route',     group:'Chemin Terrain',  groupClickable:true, htmlLabel:'<span class="st-pill st-route">En route</span>' },
    { label:'En Réparation',    value:'reparation',group:'Chemin Terrain',  groupClickable:true, htmlLabel:'<span class="st-pill st-reparation">En Réparation</span>' },
    { label:'Terminé (Terrain)',value:'termine_t', group:'Chemin Terrain',  groupClickable:true, htmlLabel:'<span class="st-pill st-termine">Terminé</span>' },
    { label:'À distance',       value:'distance',  group:'Chemin Distance', groupClickable:true, htmlLabel:'<span class="st-pill st-distance">À distance</span>' },
    { label:'Terminé (Distance)',value:'termine_d',group:'Chemin Distance', groupClickable:true, htmlLabel:'<span class="st-pill st-termine">Terminé</span>' }
  ];
  const ANNULATIONS = [
    { label:'Doublon', value:'doublon' }, { label:'Problème résolu', value:'resolu' },
    { label:'Envoi par erreur', value:'erreur' }, { label:'Autre raison', value:'autre' }
  ];
  const RAPPORTS    = [{ label:'Rempli', value:'rempli' }, { label:'Manquant', value:'manquant' }];
  const EVALUATIONS = [
    { label:'Non noté', value:'non', group:'Statut Global' },
    { label:'Noté (Toutes notes)', value:'note', group:'Statut Global' },
    { label:'5/5', value:'5', group:'Détail des notes' }, { label:'4/5', value:'4', group:'Détail des notes' },
    { label:'3/5', value:'3', group:'Détail des notes' }, { label:'2/5', value:'2', group:'Détail des notes' },
    { label:'1/5', value:'1', group:'Détail des notes' }
  ];

  const poles      = unique(parc.map(m => m.pole)).map(p => ({ label:p, value:p }));
  const marques    = unique(parc.map(m => m.marque)).map(m => ({ label:m, value:m }));
  const categories = unique(parc.map(m => m.categorie)).map(c => ({ label:c, value:c }));
  const references = unique(parc.map(m => m.reference)).map(r => ({ label:r, value:r }));
  const instances  = parc.map(m => ({ label:m.instance_id, value:m.instance_id }));
  const clients    = (data.clients || []).map(c => ({ label:c.raison_sociale, value:c.id }));
  const techs      = (data.techniciens || []).filter(t => !t.archived)
                       .map(t => ({ label:(t.prenom+' '+(t.nom||'')).trim(), value:t.id, group:'Actifs' }));
  const pannesSet  = new Set();
  Object.values((data.catalogue||{}).nodes||{}).forEach(n => {
    if (n.level === 4) (n.pannes||[]).filter(p => p.type==='panne' && !p.system).forEach(p => pannesSet.add(p.label));
  });
  const pannes = [...pannesSet].map(p => ({ label:p, value:p }));

  new MultiSelect('ms-chemin',     'Chemin',      'Tous les états',     CHEMINS,
    () => { updateGlobalTags(); pipRefresh(); });
  new MultiSelect('ms-annulation', 'Annulation',  'Toutes les raisons', ANNULATIONS,
    () => { updateGlobalTags(); pipRefresh(); });
  new MultiSelect('ms-rapport',    'Rapport',     'Tous les états',     RAPPORTS,
    () => { updateGlobalTags(); pipRefresh(); });

  // Évaluation — note group auto-toggle
  let prevEval = [];
  const msEval = new MultiSelect('ms-eval', 'Évaluation', 'Toutes les évaluations', EVALUATIONS, sel => {
    const notes = ['1','2','3','4','5'];
    const added   = sel.filter(x => !prevEval.includes(x));
    const removed = prevEval.filter(x => !sel.includes(x));
    const ns = new Set(sel);
    if (added.includes('note'))        notes.forEach(n => ns.add(n));
    else if (removed.includes('note')) notes.forEach(n => ns.delete(n));
    else { notes.every(n => ns.has(n)) ? ns.add('note') : ns.delete('note'); }
    const arr = Array.from(ns);
    prevEval = arr;
    if (arr.sort().join(',') !== sel.sort().join(',')) msEval.setValuesSilent(arr);
    updateGlobalTags(); pipRefresh();
  });

  // -----------------------------------------------------------------------
  // Cascade: Pôle → Marque → Catégorie → Référence → Instance / Panne
  // Each level narrows the options of all downstream levels using only the
  // parc entries that satisfy the cumulative upstream selections.
  // -----------------------------------------------------------------------
  let msPole, msMarque, msCat, msRef, msInstance, msPanne;
  const _gv  = inst => inst ? Array.from(inst.selectedValues) : [];
  const _clr = inst => { inst.selectedValues.clear(); inst._renderOpts(); inst._updatePlaceholder(); };

  function _fprc(pols, mars, cats, refs) {
    return parc.filter(m =>
      (!pols.length || pols.includes(m.pole))      &&
      (!mars.length || mars.includes(m.marque))    &&
      (!cats.length || cats.includes(m.categorie)) &&
      (!refs.length || refs.includes(m.reference))
    );
  }

  /* Leaf of the cascade — rebuilds Instance and Panne from selected Références */
  function _cascadeInstancePanne() {
    const re = _gv(msRef);
    if (re.length) {
      const fp = _fprc(_gv(msPole), _gv(msMarque), _gv(msCat), re);
      const instOpts = fp.map(m => ({ label: m.instance_id, value: m.instance_id }));
      const panSet = new Set();
      Object.values((data.catalogue || {}).nodes || {}).forEach(n => {
        if (n.level === 4 && re.includes(n.name))
          (n.pannes || []).filter(x => x.type === 'panne' && !x.system).forEach(x => panSet.add(x.label));
      });
      const panOpts = [...panSet].map(x => ({ label: x, value: x }));
      msInstance.updateData(instOpts); msInstance.enable('Toutes les instances');
      msPanne.updateData(panOpts);     msPanne.enable('Toutes les pannes');
    } else {
      msInstance.updateData(instances); msInstance.disable('Requiert Réf.'); _clr(msInstance);
      msPanne.updateData(pannes);       msPanne.disable('Requiert Réf.');    _clr(msPanne);
    }
    updateGlobalTags(); pipRefresh();
  }

  /* Rebuilds Référence options then propagates down */
  function _cascadeRef() {
    const ca = _gv(msCat);
    if (ca.length) {
      const opts = unique(_fprc(_gv(msPole), _gv(msMarque), ca, []).map(m => m.reference))
                     .map(r => ({ label: r, value: r }));
      msRef.updateData(opts); msRef.enable('Toutes les références');
    } else {
      msRef.updateData(references); msRef.disable('Requiert Catégorie'); _clr(msRef);
    }
    _cascadeInstancePanne();
  }

  /* Rebuilds Catégorie options then propagates down */
  function _cascadeCat() {
    const ma = _gv(msMarque);
    if (ma.length) {
      const opts = unique(_fprc(_gv(msPole), ma, [], []).map(m => m.categorie))
                     .map(c => ({ label: c, value: c }));
      msCat.updateData(opts); msCat.enable('Toutes les catégories');
    } else {
      msCat.updateData(categories); msCat.disable('Requiert Marque'); _clr(msCat);
    }
    _cascadeRef();
  }

  /* Rebuilds Marque options then propagates down */
  function _cascadeMarque() {
    const p = _gv(msPole);
    if (p.length) {
      const opts = unique(_fprc(p, [], [], []).map(m => m.marque))
                     .map(m => ({ label: m, value: m }));
      msMarque.updateData(opts); msMarque.enable('Toutes les marques');
    } else {
      msMarque.updateData(marques); msMarque.disable('Requiert Pôle'); _clr(msMarque);
    }
    _cascadeCat();
  }

  msPole    = new MultiSelect('ms-pole',     'Pôle',      'Tous les pôles',        poles,      () => _cascadeMarque());
  msMarque  = new MultiSelect('ms-marque',   'Marque',    'Toutes les marques',    marques,    () => _cascadeCat());
  msMarque.disable('Requiert Pôle');

  msCat     = new MultiSelect('ms-cat',      'Catégorie', 'Toutes les catégories', categories, () => _cascadeRef());
  msCat.disable('Requiert Marque');

  msRef     = new MultiSelect('ms-ref',      'Référence', 'Toutes les références', references, () => _cascadeInstancePanne());
  msRef.disable('Requiert Catégorie');

  msInstance = new MultiSelect('ms-instance', 'Instance', 'Toutes les instances',  instances,  () => { updateGlobalTags(); pipRefresh(); });
  msInstance.disable('Requiert Réf.');

  msPanne   = new MultiSelect('ms-panne',    'Panne',     'Toutes les pannes',     pannes,     () => { updateGlobalTags(); pipRefresh(); });
  msPanne.disable('Requiert Réf.');

  new MultiSelect('ms-client', 'Client',     'Tous les clients',     clients, () => { updateGlobalTags(); pipRefresh(); });
  new MultiSelect('ms-tech',   'Technicien', 'Tous les techniciens', techs,   () => { updateGlobalTags(); pipRefresh(); });
}

/* ============================================================
   7. PIPELINE — CALCUL LIVE
   ============================================================ */
let pipMetric  = 'mean';
let _pipTickets = [];   // cache de la dernière réponse API

/* Overview section stores */
let _liveClients  = [];
let _liveTechs    = [];
let _liveParc     = [];
let _ovEAMode     = 'eval';    // 'eval' | 'annul'
let _ovTkMode     = 'resolus'; // 'resolus' | 'crees'

/* ---------- Formatage des durées ---------- */
function pipFmt(mins) {
  if (mins === null || mins === undefined || isNaN(mins)) return '—';
  if (mins === 0) return '00m';
  const d = Math.floor(mins/1440), h = Math.floor((mins%1440)/60), m = Math.floor(mins%60);
  const p = n => String(n).padStart(2,'0');
  if (d > 0) return `${p(d)}j ${p(h)}h${p(m)}m`;
  if (h > 0) return `${p(h)}h${p(m)}m`;
  return `${p(m)}m`;
}

/* ---------- Stats (mean / median / trimmed-mean) sur tableau de minutes ---------- */
function pipStats(arr) {
  if (!arr.length) return { mean:null, median:null, trimmed:null };
  const s = [...arr].sort((a,b) => a-b);
  const mean   = s.reduce((a,v)=>a+v,0) / s.length;
  const mid    = Math.floor(s.length/2);
  const median = s.length%2 ? s[mid] : (s[mid-1]+s[mid])/2;
  const pct    = parseInt(document.getElementById('pip-trim-input')?.value||'10',10)/100;
  const cut    = Math.floor(s.length*pct);
  const sub    = cut*2 < s.length ? s.slice(cut, s.length-cut) : s;
  const trimmed = sub.reduce((a,v)=>a+v,0) / sub.length;
  return { mean:Math.round(mean), median:Math.round(median), trimmed:Math.round(trimmed) };
}

/* ---------- Lire la valeur courante de tous les filtres ---------- */
function pipGetFilters() {
  // Date range
  const ds = document.getElementById('date-start')?.value || null;
  const de = document.getElementById('date-end')?.value   || null;
  // Multi-select values (Set → Array)
  function msVals(id) {
    const inst = allFilterInstances.find(i => i.elementId === id);
    return inst ? Array.from(inst.selectedValues) : [];
  }
  return {
    dateStart:  ds,
    dateEnd:    de,
    clients:    msVals('ms-client'),
    techs:      msVals('ms-tech'),
    chemins:    msVals('ms-chemin'),
    annulations:msVals('ms-annulation'),
    rapports:   msVals('ms-rapport'),
    evaluations:msVals('ms-eval'),
    poles:      msVals('ms-pole'),
    marques:    msVals('ms-marque'),
    categories: msVals('ms-cat'),
    references: msVals('ms-ref'),
    instances:  msVals('ms-instance'),
    pannes:     msVals('ms-panne'),
  };
}

/* ---------- Tester si un ticket passe les filtres actifs ---------- */
function pipMatchesFilter(t, f) {
  // Période (created_at date)
  if (f.dateStart) {
    const cdate = (t.created_at||'').slice(0,10);
    if (cdate < f.dateStart || cdate > f.dateEnd) return false;
  }
  // Client
  if (f.clients.length && !f.clients.includes(String(t.client_id))) return false;
  // Technicien
  if (f.techs.length) {
    const ids = (t.technicien_ids||[]).map(String);
    if (!f.techs.some(v => ids.includes(v))) return false;
  }
  // Chemin / État — map filter values → actual statuses
  if (f.chemins.length) {
    const STATUS_MAP = {
      envoye:'Envoyé', assigne:'Assigné', attente:'Attente pièce',
      route:'En route', reparation:'En Réparation',
      termine_t:'Terminé', distance:'Maintenance à distance', termine_d:'Terminé'
    };
    const via = t.termine_via;
    const status = t.status;
    const match = f.chemins.some(v => {
      if (v === 'termine_t') return status === 'Terminé' && via === 'terrain';
      if (v === 'termine_d') return status === 'Terminé' && via === 'distance';
      return status === (STATUS_MAP[v]||v);
    });
    if (!match) return false;
  }
  // Annulation
  if (f.annulations.length) {
    if (t.status !== 'Annulé') return false;
    const raison = (t.cancellation?.raison||'').toLowerCase();
    const AMAP = {doublon:'doublon',resolu:'résolu',erreur:'erreur',autre:'autre'};
    if (!f.annulations.some(v => raison.includes(AMAP[v]||v))) return false;
  }
  // Rapport
  if (f.rapports.length) {
    const hasReport = !!t.report;
    if (f.rapports.includes('rempli') && !hasReport) return false;
    if (f.rapports.includes('manquant') && hasReport) return false;
  }
  // Évaluation
  if (f.evaluations.length) {
    const note = t.evaluation?.note ?? null;
    const hasNote = note !== null;
    if (f.evaluations.includes('non') && hasNote) return false;
    if (f.evaluations.includes('note') && !hasNote) return false;
    const noteVals = f.evaluations.filter(v => ['1','2','3','4','5'].includes(v));
    if (noteVals.length && !noteVals.includes(String(note))) return false;
  }
  // Parc cascade
  if (f.poles.length      && !f.poles.includes(t.pole||''))           return false;
  if (f.marques.length    && !f.marques.includes(t.marque||''))       return false;
  if (f.categories.length && !f.categories.includes(t.categorie||''))return false;
  if (f.references.length && !f.references.includes(t.reference||''))return false;
  if (f.instances.length  && !f.instances.includes(t.instance_id||''))return false;
  return true;
}

/* ---------- Extraire la durée (en minutes) passée dans un statut ----------
   On parcourt la timeline et on somme tous les intervalles
   [entrée dans `status`] → [sortie de `status`].
   Pour un ticket ACTUELLEMENT dans ce statut, on inclut le temps
   depuis la dernière entrée jusqu'à maintenant. */
function pipDurationIn(ticket, targetStatus) {
  const tl = ticket.timeline || [];
  let totalMs = 0;
  let enteredAt = null;
  const now = Date.now();
  for (let i = 0; i < tl.length; i++) {
    const e = tl[i];
    if (e.status === targetStatus) {
      enteredAt = new Date(e.timestamp).getTime();
    } else if (enteredAt !== null) {
      totalMs += new Date(e.timestamp).getTime() - enteredAt;
      enteredAt = null;
    }
  }
  // Still in status right now
  if (enteredAt !== null) totalMs += now - enteredAt;
  return totalMs > 0 ? totalMs / 60000 : null;  // → minutes
}

/* Durée entre la PREMIÈRE apparition de statusA et la PREMIÈRE SUIVANTE de statusB */
function pipTransition(ticket, statusA, statusB) {
  const tl = ticket.timeline || [];
  let exitA = null;
  for (let i = 0; i < tl.length-1; i++) {
    if (tl[i].status === statusA && tl[i+1].status === statusB) {
      const ms = new Date(tl[i+1].timestamp) - new Date(tl[i].timestamp);
      return ms / 60000;
    }
  }
  return null;
}

/* ---------- Durée totale de résolution (created_at → Terminé) ---------- */
function pipTotalTime(ticket) {
  if (ticket.resolution_time_ms) return ticket.resolution_time_ms / 60000;
  const termEntry = (ticket.timeline||[]).slice().reverse().find(e => e.status === 'Terminé');
  if (!termEntry) return null;
  return (new Date(termEntry.timestamp) - new Date(ticket.created_at)) / 60000;
}

/* ---------- Calcul principal : produit un objet LIVE_DATA ---------- */
function pipCompute(tickets) {
  const f = pipGetFilters();
  const matched = tickets.filter(t => pipMatchesFilter(t, f));

  // Statuts actifs en ce moment
  const countStatus = s => matched.filter(t => t.status === s).length;
  const countStatusVia = (s,via) => matched.filter(t => t.status===s && t.termine_via===via).length;

  // Durées passées dans un statut (tickets qui ont DÉJÀ quitté ce statut = "passés")
  function durationsIn(status, via) {
    const arr = [];
    const TERRAIN_STATUSES = new Set(['Attente pièce', 'En route', 'En Réparation']);
    const DIST_STATUSES    = new Set(['Maintenance à distance']);
    for (const t of matched) {
      if (via) {
        // Include only tickets that completed via this branch, OR active tickets
        // that have already entered a status specific to that branch.
        const branchStatuses = via === 'terrain' ? TERRAIN_STATUSES : DIST_STATUSES;
        const inBranch = t.termine_via === via
          || (t.status !== 'Terminé' && t.status !== 'Annulé'
              && (t.timeline || []).some(e => branchStatuses.has(e.status)));
        if (!inBranch) continue;
      }
      const d = pipDurationIn(t, status);
      if (d !== null) arr.push(d);
    }
    return arr;
  }

  // Transition Envoyé → Assigné (first occurrence in each ticket)
  const transAssignMins = matched
    .map(t => pipTransition(t,'Envoyé','Assigné'))
    .filter(v => v !== null);

  // Temps total résolution (Terminé tickets only)
  const terrainDone = matched.filter(t => t.status === 'Terminé' && t.termine_via === 'terrain');
  const distDone    = matched.filter(t => t.status === 'Terminé' && t.termine_via === 'distance');
  const terrainTotals = terrainDone.map(pipTotalTime).filter(v=>v!==null);
  const distTotals    = distDone.map(pipTotalTime).filter(v=>v!==null);

  // Post-clôture : délai rapport (Terminé → rapport soumis)
  const rapportMins = matched
    .filter(t => t.status === 'Terminé' && t.report)
    .map(t => {
      const termEntry = (t.timeline||[]).slice().reverse().find(e=>e.status==='Terminé');
      if (!termEntry || !t.report.submitted_at) return null;
      return (new Date(t.report.submitted_at) - new Date(termEntry.timestamp)) / 60000;
    }).filter(v=>v!==null && v>=0);

  // Post-clôture : note moyenne des évaluations (sur 5)
  const evalNotes = matched
    .filter(t => t.evaluation?.note != null)
    .map(t => Number(t.evaluation.note))
    .filter(n => n >= 1 && n <= 5);
  const avgNote = evalNotes.length
    ? Math.round((evalNotes.reduce((a,v)=>a+v,0) / evalNotes.length) * 10) / 10
    : null;

  // Annulés : durée depuis created_at jusqu'à l'annulation
  const annuleMins = matched
    .filter(t => t.status === 'Annulé' && t.cancellation?.at)
    .map(t => (new Date(t.cancellation.at) - new Date(t.created_at)) / 60000)
    .filter(v=>v!==null && v>=0);

  function stats(arr) { return pipStats(arr); }

  return {
    envoye:    { current: countStatus('Envoyé'), passed: matched.filter(t => (t.timeline||[]).some(e => e.status !== 'Envoyé')).length, isStart:true },
    trans_assign: { times: stats(transAssignMins), isTransition:true },
    assigne:   { current: countStatus('Assigné'), passed: durationsIn('Assigné').length, times: stats(durationsIn('Assigné')) },
    attente:   { current: countStatus('Attente pièce'), passed: durationsIn('Attente pièce').length, times: stats(durationsIn('Attente pièce')) },
    route:     { current: countStatus('En route'),     passed: durationsIn('En route').length,     times: stats(durationsIn('En route')) },
    reparation:{ current: countStatus('En Réparation'),passed: durationsIn('En Réparation').length, times: stats(durationsIn('En Réparation')) },
    distance:  { current: countStatus('Maintenance à distance'), passed: durationsIn('Maintenance à distance').length, times: stats(durationsIn('Maintenance à distance')) },
    'termine-terrain': { current: terrainDone.length, passed: terrainDone.length, times: stats(terrainTotals), isTotal:true },
    'termine-distance':{ current: distDone.length,    passed: distDone.length,    times: stats(distTotals),    isTotal:true },
    rapport:   { passed: matched.filter(t=>t.status==='Terminé'&&t.report).length, times: stats(rapportMins), isPost:true },
    evaluation:{ passed: evalNotes.length, avgNote, isEval:true },
    annule:    { passed: matched.filter(t=>t.status==='Annulé').length, times: stats(annuleMins), isPost:true },
    _total: matched.length
  };
}

/* ---------- Rendu DOM ---------- */
function pipRender(data) {
  const LABELS = { mean:'Moyenne', median:'Médiane', trimmed:'Moy. tronquée' };
  const lbl = LABELS[pipMetric];

  const MAP = {
    'envoye':            '#pip-envoye',
    'assigne':           '#pip-assigne',
    'attente':           '#pip-attente',
    'route':             '#pip-route',
    'reparation':        '#pip-reparation',
    'distance':          '#pip-distance',
    'termine-terrain':   '#pip-termine-terrain',
    'termine-distance':  '#pip-termine-distance',
    'rapport':           '#pip-rapport',
    'evaluation':        '#pip-evaluation',
    'annule':            '#pip-annule'
  };

  // Transition card
  const tc = document.getElementById('pip-trans-assignation');
  if (tc && data.trans_assign?.times) {
    const v = data.trans_assign.times[pipMetric];
    tc.querySelector('.pip-val-time').textContent  = pipFmt(v);
    tc.querySelector('.pip-label-type').textContent = lbl;
  }

  for (const [key, sel] of Object.entries(MAP)) {
    const el = document.querySelector(sel);
    const d  = data[key];
    if (!el || !d) continue;

    const cv = el.querySelector('.pip-val-current');
    if (cv) cv.textContent = d.current ?? 0;

    const tv = el.querySelector('.pip-val-time');
    if (tv && d.times) tv.textContent = pipFmt(d.times[pipMetric]);

    const lt = el.querySelector('.pip-label-type');
    if (lt) {
      if (d.isTotal) {
        lt.innerHTML = `Total (${lbl}) • <span class="pip-val-passed">${d.passed??0}</span> passés`;
      } else if (d.isPost) {
        const sub = key==='rapport' ? `Saisie après clôture (${lbl})` :
                    `Avant annulation (${lbl})`;
        lt.textContent = sub;
        const pv = el.querySelector('.pip-val-passed');
        if (pv) pv.textContent = d.passed ?? 0;
      } else {
        lt.innerHTML = `${lbl} • <span class="pip-val-passed">${d.passed??0}</span> passés`;
      }
    } else if (d.passed !== undefined) {
      // Nodes without a pip-label-type (e.g. Envoyé) — write passed directly
      const pv = el.querySelector('.pip-val-passed');
      if (pv) pv.textContent = d.passed ?? 0;
    }

    // Evaluation: show avg rating, not a time
    if (d.isEval) {
      const rv = el.querySelector('.pip-val-rating');
      if (rv) rv.textContent = d.avgNote !== null ? d.avgNote.toFixed(1) : '—';
      const pv = el.querySelector('.pip-val-passed');
      if (pv) pv.textContent = d.passed ?? 0;
    }
  }

  // Update last-refresh timestamp
  const ts = document.getElementById('pip-last-updated');
  if (ts) ts.textContent = 'Mis à jour : ' + new Date().toLocaleTimeString('fr-FR');
}

/* Called whenever tickets or filters change */
function pipRefresh() {
  if (!_pipTickets.length && _pipTickets._loaded !== true) return;
  const data = pipCompute(_pipTickets);
  pipRender(data);
  pipHandleResize();
  renderOverviewSections();
  renderTechKPIs();
  renderTechTable();
}

function pipHandleResize() {
  const flow  = document.getElementById('pip-flow');
  const panel = document.getElementById('panel-overview');
  if (!flow || !panel || !panel.classList.contains('active')) return;
  const w = flow.parentElement.clientWidth;
  flow.style.transform = w < 1050 ? `scale(${w/1100})` : 'scale(1)';
}

function initPipeline() {
  window.addEventListener('resize', pipHandleResize, { passive:true });

  // Metric toggle
  document.querySelectorAll('#pip-metric-toggle button').forEach(btn => {
    btn.addEventListener('click', e => {
      document.querySelectorAll('#pip-metric-toggle button').forEach(b => b.classList.remove('active'));
      e.target.classList.add('active');
      pipMetric = e.target.dataset.metric;
      document.getElementById('pip-trim-wrapper').classList.toggle('pip-hidden', pipMetric !== 'trimmed');
      pipRefresh();
    });
  });

  // Trimmed % input → re-compute
  document.getElementById('pip-trim-input')?.addEventListener('input', () => pipRefresh());
}

/* ============================================================
   8. TOAST HELPER
   ============================================================ */
function showToast(msg, type='success') {
  const c = document.getElementById('toast-container');
  const t = document.createElement('div'); t.className = 'toast';
  const col = type==='error' ? 'var(--danger)' : 'var(--status-success)';
  const icon = type==='error'
    ? '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>'
    : '<polyline points="20 6 9 17 4 12"/>';
  t.style.borderLeftColor = col;
  t.innerHTML = `<div style="width:20px;height:20px;flex-shrink:0;color:${col}"><svg viewBox="0 0 24 24" stroke="currentColor" fill="none" stroke-width="2">${icon}</svg></div><div style="flex:1;font-size:13px;font-weight:500;">${xe(msg)}</div>`;
  c.appendChild(t);
  setTimeout(() => { t.style.opacity='0'; t.style.transition='opacity 0.3s'; setTimeout(()=>t.remove(),300); }, 3000);
}

/* ============================================================
   9. OVERVIEW SECTIONS - HELPERS & RENDERS
   ============================================================ */

function ovClientName(id) {
  const c = _liveClients.find(x => String(x.id) === String(id));
  return c ? c.raison_sociale : (id || '—');
}
function ovTechName(ids) {
  if (!ids || !ids.length) return '—';
  const t = _liveTechs.find(x => x.id === ids[0]);
  return t ? (t.prenom + ' ' + (t.nom||'')).trim() : ids[0];
}
function ovFmtDate(iso) {
  if (!iso) return { date:'—', time:'' };
  try {
    const d  = new Date(iso);
    const dd = String(d.getDate()).padStart(2,'0');
    const mo = String(d.getMonth()+1).padStart(2,'0');
    const yy = String(d.getFullYear()).slice(2);
    return {
      date: dd+'/'+mo+'/'+yy,
      time: String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0')
    };
  } catch(e) { return { date: iso, time: '' }; }
}
function ovTrunc(str, n) { return (!str) ? '—' : str.length > n ? str.slice(0,n)+'…' : str; }
function ovRoleLabel(r) {
  if (!r) return '';
  const l = r.toLowerCase();
  return l==='manager' ? 'Manager' : l==='technicien' ? 'Technicien' : l==='client' ? 'Client' : r;
}

const OV_EYE = '<svg viewBox="0 0 24 24"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';

function ovDateCell(iso) {
  const p = ovFmtDate(iso);
  return '<td class="ov-col-date">'+p.date+'<small>'+p.time+'</small></td>';
}
function ovMachineCell(t) {
  const ref   = t.reference || t.instance_id || '—';
  const ur    = t.usage_readings;
  const usage = (ur && ur.length) ? '<span class="ov-col-usage">'+xe(ur[0].value)+' '+xe(ur[0].unit)+'</span>' : '';
  return '<td><span class="ov-col-mono">'+xe(ref)+'</span>'+usage+'</td>';
}
function ovActionCell() {
  return '<td style="width:48px;text-align:right;padding-right:16px"><button class="ov-btn-icon" title="Voir le ticket">'+OV_EYE+'</button></td>';
}
function ovWireRows(tbody) {
  tbody.querySelectorAll('tr[data-id]').forEach(tr => {
    tr.addEventListener('click', e => {
      if (e.target.closest('button')) return;
      TicketDetail.open(tr.dataset.id, { role:'manager' });
    });
    const btn = tr.querySelector('button');
    if (btn) btn.addEventListener('click', () => TicketDetail.open(tr.dataset.id, { role:'manager' }));
  });
}

/* --- Section 2a: Evaluations --- */
function renderOvEval(tickets) {
  const tbody = document.getElementById('ov-eval-tbody');
  if (!tbody) return;
  const rows = tickets
    .filter(t => t.evaluation && t.evaluation.note != null)
    .sort((a,b) => {
      const da = a.evaluation.updated_at || a.created_at;
      const db = b.evaluation.updated_at || b.created_at;
      return da < db ? 1 : -1;
    }).slice(0,5);
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="ov-empty">Aucune évaluation sur cette période</td></tr>';
    return;
  }
  tbody.innerHTML = rows.map(t => {
    const note    = t.evaluation.note;
    const comment = xe(ovTrunc(t.evaluation.commentaire||'',70));
    const client  = xe(ovClientName(t.client_id));
    return '<tr data-id="'+xe(t.id)+'">'+
      '<td class="ov-col-id">'+xe(t.id)+'</td>'+
      '<td style="max-width:130px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+client+'</td>'+
      '<td class="ov-col-note">'+note+'<span style="color:var(--light-slate);font-weight:400">/5</span></td>'+
      '<td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--grey)">'+comment+'</td>'+
      ovActionCell()+
      '</tr>';
  }).join('');
  ovWireRows(tbody);
}

/* --- Section 2b: Annulations --- */
function renderOvAnnul(tickets) {
  const tbody = document.getElementById('ov-annul-tbody');
  if (!tbody) return;
  const rows = tickets
    .filter(t => t.status === 'Annulé' && t.cancellation)
    .sort((a,b) => {
      const da = a.cancellation.at || a.created_at;
      const db = b.cancellation.at || b.created_at;
      return da < db ? 1 : -1;
    }).slice(0,5);
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="ov-empty">Aucune annulation sur cette période</td></tr>';
    return;
  }
  tbody.innerHTML = rows.map(t => {
    const c    = t.cancellation;
    const role = c.by_role ? '<small style="color:var(--light-slate)"> ('+xe(ovRoleLabel(c.by_role))+')</small>' : '';
    return '<tr data-id="'+xe(t.id)+'">'+
      '<td class="ov-col-id">'+xe(t.id)+'</td>'+
      ovDateCell(c.at)+
      '<td style="white-space:nowrap">'+xe(c.by_name||'—')+role+'</td>'+
      '<td style="color:var(--grey)">'+xe(c.raison||'—')+'</td>'+
      ovActionCell()+
      '</tr>';
  }).join('');
  ovWireRows(tbody);
}

/* --- Section 3: Tickets resolus / crees --- */
function renderOvTickets(tickets) {
  const tbody = document.getElementById('ov-tickets-tbody');
  const title = document.getElementById('ov-tickets-title');
  if (!tbody) return;
  let rows;
  const dateTh = document.getElementById('ov-tickets-date-th');
  if (_ovTkMode === 'resolus') {
    if (title) title.textContent = 'Derniers tickets résolus';
    if (dateTh) dateTh.textContent = 'Date de résolution';
    rows = tickets
      .filter(t => t.status === 'Terminé')
      .sort((a,b) => {
        const fa = (a.timeline||[]).slice().reverse().find(e => e.status==='Terminé');
        const fb = (b.timeline||[]).slice().reverse().find(e => e.status==='Terminé');
        return (fa?fa.timestamp:a.created_at) < (fb?fb.timestamp:b.created_at) ? 1 : -1;
      }).slice(0,5);
  } else {
    if (title) title.textContent = 'Derniers tickets créés';
    if (dateTh) dateTh.textContent = 'Date de création';
    rows = [...tickets].sort((a,b) => a.created_at < b.created_at ? 1 : -1).slice(0,5);
  }
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="ov-empty">Aucun ticket sur cette période</td></tr>';
    return;
  }
  tbody.innerHTML = rows.map(t => {
    const iso = _ovTkMode === 'resolus'
      ? (((t.timeline||[]).slice().reverse().find(e=>e.status==='Terminé'))||{}).timestamp || t.created_at
      : t.created_at;
    const client = xe(ovClientName(t.client_id));
    return '<tr data-id="'+xe(t.id)+'">'+
      '<td class="ov-col-id">'+xe(t.id)+'</td>'+
      ovDateCell(iso)+
      '<td style="max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+client+'</td>'+
      ovMachineCell(t)+
      ovActionCell()+
      '</tr>';
  }).join('');
  ovWireRows(tbody);
}

/* --- Section 4: Tech status --- */
function renderOvTech() {
  const techs  = _liveTechs.filter(t => !t.archived);
  const ACTIVE = new Set(['Envoyé','Assigné','Attente pièce','En route','En Réparation','Maintenance à distance']);
  const countMap = {};
  _pipTickets.forEach(tk => {
    if (!ACTIVE.has(tk.status)) return;
    (tk.technicien_ids||[]).forEach(id => { countMap[id] = (countMap[id]||0)+1; });
  });

  const chips = document.getElementById('tech-stat-chips');
  if (chips) {
    const nS = techs.filter(t=>t.disponibilite==='En service').length;
    const nP = techs.filter(t=>t.disponibilite==='En pause').length;
    const nH = techs.filter(t=>t.disponibilite==='Hors service').length;
    chips.innerHTML =
      '<span class="tech-chip chip-service">'+nS+' En service</span>'+
      '<span class="tech-chip chip-pause">'+nP+' En pause</span>'+
      '<span class="tech-chip chip-hors">'+nH+' Hors service</span>';
  }

  const DISPO_RANK = {'En service':0,'En pause':1,'Hors service':2};
  const sorted = [...techs].sort((a,b) => {
    // 1) Disponibilité (En service → En pause → Hors service)
    const ra = DISPO_RANK[a.disponibilite] ?? 3, rb = DISPO_RANK[b.disponibilite] ?? 3;
    if (ra !== rb) return ra - rb;
    // 2) Nombre de tickets actifs (desc)
    const ca = countMap[a.id]||0, cb = countMap[b.id]||0;
    if (cb !== ca) return cb - ca;
    // 3) Ordre alphabétique
    return (a.prenom+a.nom).localeCompare(b.prenom+b.nom);
  });
  const tbody = document.getElementById('tech-roster-tbody');
  if (tbody) {
    tbody.innerHTML = sorted.map(t => {
      const d   = t.disponibilite||'Hors service';
      const cls = d==='En service'?'dispo-service':d==='En pause'?'dispo-pause':'dispo-hors';
      const nb  = countMap[t.id]||0;
      const nbCell = nb>0
        ? '<span style="font-weight:700;color:var(--primary)">'+nb+'</span>'
        : '<span style="color:var(--light-slate)">—</span>';
      return '<tr data-tech-id="'+xe(t.id)+'">'+
        '<td style="font-weight:600">'+xe(t.prenom)+' '+xe(t.nom||'')+'</td>'+
        '<td><span class="dispo-pill '+cls+'">'+xe(d)+'</span></td>'+
        '<td>'+nbCell+'</td>'+
        '</tr>';
    }).join('');
  }

  const feed = document.getElementById('tech-shifts-feed');
  if (feed) {
    const PILL = {'En service':'dispo-service','En pause':'dispo-pause','Hors service':'dispo-hors'};
    const cutoff = new Date(Date.now() - 24*60*60*1000).toISOString();
    const allShifts = [];
    _liveTechs.filter(t => !t.archived).forEach(t => {
      (t.shift_log||[]).forEach(e => {
        if (e.at >= cutoff) allShifts.push({ name: (t.prenom+' '+(t.nom||'')).trim(), techId: t.id, ...e });
      });
    });
    allShifts.sort((a,b) => a.at < b.at ? 1 : -1);
    const visible = allShifts.slice(0,5);
    if (!visible.length) {
      feed.innerHTML = '<p style="color:var(--light-slate);font-size:13px;line-height:1.6;padding:4px 0;">Aucun changement ces dernières 24h.</p>';
    } else {
      feed.innerHTML = visible.map(e => {
        const d = new Date(e.at);
        const hm = d.getHours().toString().padStart(2,'0')+':'+d.getMinutes().toString().padStart(2,'0');
        return '<div class="shift-entry" data-tech-id="'+xe(e.techId)+'" style="cursor:pointer;" title="Voir le technicien">'+
          '<span style="font-weight:600;min-width:110px;white-space:nowrap">'+xe(e.name)+'</span>'+
          '<span class="dispo-pill '+(PILL[e.from]||'dispo-hors')+'">'+xe(e.from)+'</span>'+
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:13px;height:13px;flex-shrink:0"><polyline points="9 18 15 12 9 6"/></svg>'+
          '<span class="dispo-pill '+(PILL[e.to]||'dispo-hors')+'">'+xe(e.to)+'</span>'+
          '<span style="margin-left:auto;color:var(--light-slate);font-size:12px">'+hm+'</span>'+
          '</div>';
      }).join('');
      feed.querySelectorAll('.shift-entry[data-tech-id]').forEach(row => {
        row.addEventListener('click', () => {
          const techId = row.dataset.techId;
          const techRow = document.querySelector('#tech-roster-tbody tr[data-tech-id="'+techId+'"]');
          if (techRow) {
            techRow.scrollIntoView({ behavior:'smooth', block:'center' });
            techRow.style.transition = 'background 0.3s';
            techRow.style.background = 'rgba(74,127,181,0.15)';
            setTimeout(() => { techRow.style.background = ''; }, 1500);
          }
        });
      });
    }
  }
}

/* --- Techniciens tab KPI cards --- */
function renderTechKPIs() {
  const panel = document.getElementById('panel-techniciens');
  if (!panel || !panel.classList.contains('active')) return;

  const ACTIVE_STATUS = new Set(['Envoyé','Assigné','Attente pièce','En route','En Réparation','Maintenance à distance']);

  const allTechs   = _liveTechs.filter(t => !t.archived);
  const archivedN  = _liveTechs.filter(t => t.archived).length;
  const enService  = allTechs.filter(t => t.disponibilite === 'En service');
  const enPause    = allTechs.filter(t => t.disponibilite === 'En pause');
  const horsServ   = allTechs.filter(t => t.disponibilite === 'Hors service');

  // Build set of tech IDs that have ≥1 active ticket
  const busyIds = new Set();
  let activeTicketCount = 0;
  _pipTickets.forEach(tk => {
    if (!ACTIVE_STATUS.has(tk.status)) return;
    activeTicketCount++;
    (tk.technicien_ids || []).forEach(id => busyIds.add(String(id)));
  });

  const nTotal     = allTechs.length;
  const nEnService = enService.length;
  const nBusy      = enService.filter(t => busyIds.has(String(t.id))).length;
  const busyPct    = nEnService > 0 ? Math.round(nBusy / nEnService * 100) : 0;
  const ratio      = nEnService > 0 ? (activeTicketCount / nEnService).toFixed(1) : '—';

  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };

  // Card 1 — Effectif opérationnel
  set('tch-kpi-total', nTotal);
  set('tch-kpi-archived-count', archivedN + ' archivé' + (archivedN !== 1 ? 's' : '') + ' exclus');

  // Card 2 — Disponibles en service
  set('tch-kpi-enservice', nEnService);
  set('tch-kpi-enservice-sub', 'Sur ' + nTotal + ' technicien' + (nTotal !== 1 ? 's' : ''));
  set('tch-chip-pause', enPause.length + ' En pause');
  set('tch-chip-hors',  horsServ.length + ' Hors service');

  // Card 3 — En intervention active
  set('tch-kpi-busy', nBusy);
  set('tch-kpi-busy-pct', busyPct + '% de l\'effectif en service');

  // Card 4 — Charge par technicien
  set('tch-kpi-ratio', nEnService > 0 ? ratio : '—');
  set('tch-kpi-active-total', activeTicketCount + ' ticket' + (activeTicketCount !== 1 ? 's' : '') + ' actif' + (activeTicketCount !== 1 ? 's' : '') + ' au total');
}

/* ============================================================
   TECHNICIENS — CLASSEMENT MULTI-CRITÈRES (sortable table)
   ============================================================ */
const TECH_ACTIVE_STATUS = new Set(['Envoyé','Assigné','Attente pièce','En route','En Réparation','Maintenance à distance']);
let _techSort = { key: 'interv', dir: 'desc' };
let _techModalSearch = '';
let _techMetric = 'mean';   // 'mean' | 'median' | 'trimmed' — pilote la ligne de synthèse

/* Tendance centrale d'un tableau selon le mode actif (moyenne/médiane/tronquée) */
function techCentral(arr) {
  if (!arr || !arr.length) return null;
  const s = [...arr].sort((a,b) => a-b);
  if (_techMetric === 'median') {
    const mid = Math.floor(s.length/2);
    return s.length % 2 ? s[mid] : (s[mid-1]+s[mid])/2;
  }
  if (_techMetric === 'trimmed') {
    const pct = parseInt(document.getElementById('tch-trim-input')?.value || '10', 10) / 100;
    const cut = Math.floor(s.length * pct);
    const sub = cut*2 < s.length ? s.slice(cut, s.length-cut) : s;
    return sub.reduce((a,v)=>a+v,0) / sub.length;
  }
  return s.reduce((a,v)=>a+v,0) / s.length;
}
/* Formatage des moyennes de comptage : entier si rond, sinon 1 décimale */
function techFmtAvg(v) {
  if (v == null || isNaN(v)) return '—';
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

/* HH×60+MM → "08h12" */
function techFmtClock(mins) {
  if (mins == null || isNaN(mins)) return '—';
  const h = Math.floor(mins / 60), m = Math.round(mins % 60);
  return String(h).padStart(2,'0') + 'h' + String(m).padStart(2,'0');
}
function techDayKey(iso) {
  const d = new Date(iso);
  return d.getFullYear() + '-' + (d.getMonth()+1) + '-' + d.getDate();
}
function techMinsOfDay(ms) {
  const d = new Date(ms);
  return d.getHours() * 60 + d.getMinutes();
}

/* Stats de shift : durée nette "En service" moy./jour travaillé + heures début/fin moy.
   Un jour n'est compté que s'il contient une prise de service ("→ En service").
   Les jours sans prise de service (week-end, congé, férié, maladie) sont ignorés. */
function techShiftStats(tech) {
  const log = (tech.shift_log || []).slice().sort((a,b) => a.at < b.at ? -1 : 1);
  if (!log.length) return null;
  const now = Date.now();
  // Segments [start, end, status] entre événements consécutifs (dernier → maintenant)
  const segs = [];
  for (let i = 0; i < log.length; i++) {
    const start = new Date(log[i].at).getTime();
    const end   = i + 1 < log.length ? new Date(log[i+1].at).getTime() : now;
    if (end > start) segs.push({ start, end, status: log[i].to });
  }
  // Jours travaillés = jours avec au moins une transition vers "En service"
  const dayKeys = new Set();
  log.forEach(e => { if (e.to === 'En service') dayKeys.add(techDayKey(e.at)); });
  if (!dayKeys.size) return null;

  let totalNetMs = 0, dayCount = 0;
  const startMins = [], endMins = [];
  dayKeys.forEach(dk => {
    const [y, mo, da] = dk.split('-').map(Number);
    const dayStart = new Date(y, mo-1, da, 0, 0, 0, 0).getTime();
    const dayEnd   = new Date(y, mo-1, da, 23, 59, 59, 999).getTime();
    let net = 0, firstService = null, lastService = null;
    segs.forEach(s => {
      if (s.status !== 'En service') return;
      const a = Math.max(s.start, dayStart);
      const b = Math.min(s.end, dayEnd);
      if (b <= a) return;
      net += b - a;
      if (firstService === null || a < firstService) firstService = a;
      if (lastService  === null || b > lastService)  lastService  = b;
    });
    if (net > 0) {
      totalNetMs += net; dayCount++;
      startMins.push(techMinsOfDay(firstService));
      endMins.push(techMinsOfDay(lastService));
    }
  });
  if (!dayCount) return null;
  const avg = arr => arr.reduce((a,v)=>a+v,0) / arr.length;
  const netMinsArr = [];
  dayKeys.forEach(dk => {
    const [y, mo, da] = dk.split('-').map(Number);
    const dayStart = new Date(y, mo-1, da, 0, 0, 0, 0).getTime();
    const dayEnd   = new Date(y, mo-1, da, 23, 59, 59, 999).getTime();
    let net = 0;
    segs.forEach(s => {
      if (s.status !== 'En service') return;
      const a = Math.max(s.start, dayStart);
      const b = Math.min(s.end, dayEnd);
      if (b > a) net += b - a;
    });
    if (net > 0) netMinsArr.push(net / 60000);
  });
  return {
    avgNetMins: totalNetMs / 60000 / dayCount,
    netMinsArr,
    avgStart:   avg(startMins),
    avgEnd:     avg(endMins),
    days:       dayCount
  };
}

/* Construit les métriques par technicien (non archivés) + le jeu de tickets filtré.
   Tout est calculé sur le jeu FILTRÉ (filtres globaux) — pas en temps réel. */
function computeTechData() {
  const f = pipGetFilters();
  const filtered = _pipTickets.filter(t => pipMatchesFilter(t, f));
  const rows = _liveTechs.filter(t => !t.archived).map(t => {
    const tid  = String(t.id);
    const mine = filtered.filter(tk => (tk.technicien_ids||[]).map(String).includes(tid));
    const done = mine.filter(tk => tk.status === 'Terminé');
    const resArr = done.map(pipTotalTime).filter(v => v != null);
    const resMean = techCentral(resArr);
    const notes  = done.map(tk => tk.evaluation?.note).filter(v => v != null);
    const evalMean = techCentral(notes);
    const active = mine.filter(tk => TECH_ACTIVE_STATUS.has(tk.status)).length;
    const shift = techShiftStats(t);
    const shiftVal = shift ? techCentral(shift.netMinsArr) : null;
    return {
      tech: t,
      interv: mine.length,
      resolus: done.length,
      resMean,
      evalMean,
      active,
      shift,
      shiftVal,
      missingReports: done.filter(tk => !tk.report).length
    };
  });
  return { rows, filtered };
}

function sortTechRows(rows) {
  const { key, dir } = _techSort;
  const get = {
    name:    r => (r.tech.nom + ' ' + r.tech.prenom).toLowerCase(),
    interv:  r => r.interv,
    resolus: r => r.resolus,
    res:     r => r.resMean,
    eval:    r => r.evalMean,
    active:  r => r.active,
    shift:   r => r.shiftVal,
    reports: r => r.missingReports
  }[key] || (r => r.interv);
  const mul = dir === 'asc' ? 1 : -1;
  const isNull = v => v == null || (typeof v === 'number' && isNaN(v));
  return [...rows].sort((a,b) => {
    const va = get(a), vb = get(b);
    const na = isNull(va), nb = isNull(vb);
    if (na && nb) return 0;
    if (na) return 1;        // sans donnée → toujours en bas
    if (nb) return -1;
    if (typeof va === 'string') return va.localeCompare(vb) * mul;
    return (va - vb) * mul;
  });
}

function techDispoDot(d) {
  const c = d === 'En service' ? 'var(--status-success)'
          : d === 'En pause'   ? '#F59E0B'
          : 'var(--light-slate)';
  return '<span class="tch-dot" style="background:'+c+'" title="'+xe(d||'Hors service')+'"></span>';
}

function techRowHtml(r, rank) {
  const t = r.tech;
  const init = ((t.prenom||' ').charAt(0) + (t.nom||' ').charAt(0)).toUpperCase();
  const name = xe((t.prenom + ' ' + (t.nom||'')).trim());
  const rankCls = rank <= 3 ? ' tch-rank-' + rank : '';
  const evalCell   = r.evalMean != null ? r.evalMean.toFixed(1) + '<span class="tch-muted" style="font-weight:400">/5</span>' : '<span class="tch-muted">—</span>';
  const resCell    = r.resMean  != null ? pipFmt(r.resMean) : '<span class="tch-muted">—</span>';
  const activeCell = r.active > 0 ? '<strong style="color:var(--primary)">'+r.active+'</strong>' : '<span class="tch-muted">—</span>';
  const shiftCell  = r.shiftVal != null
    ? '<div class="tch-shift-main">'+pipFmt(r.shiftVal)+'</div><div class="tch-shift-sub">'+techFmtClock(r.shift.avgStart)+' → '+techFmtClock(r.shift.avgEnd)+'</div>'
    : '<span class="tch-muted">—</span>';
  const repCell    = r.missingReports > 0 ? '<span class="tch-rep-warn">'+r.missingReports+'</span>' : '<span class="tch-muted">0</span>';
  return '<tr>'+
    '<td class="tch-c-name"><span class="tch-rank'+rankCls+'">'+rank+'</span>'+
      '<span class="tch-avatar">'+xe(init)+'</span>'+
      '<span class="tch-name">'+name+'</span>'+techDispoDot(t.disponibilite)+'</td>'+
    '<td>'+r.interv+'</td>'+
    '<td>'+r.resolus+'</td>'+
    '<td>'+resCell+'</td>'+
    '<td>'+evalCell+'</td>'+
    '<td>'+activeCell+'</td>'+
    '<td class="tch-c-shift">'+shiftCell+'</td>'+
    '<td>'+repCell+'</td>'+
    '</tr>';
}

/* Ligne de synthèse équipe (tendance centrale par technicien) — au-dessus du 1er tech */
function techSummaryHtml(rows, filtered) {
  const done    = filtered.filter(t => t.status === 'Terminé');
  const resTimes = done.map(pipTotalTime).filter(v => v != null);
  const notes    = done.map(t => t.evaluation?.note).filter(v => v != null);
  const cInterv  = techCentral(rows.map(r => r.interv));
  const cResolus = techCentral(rows.map(r => r.resolus));
  const cTps     = techCentral(resTimes);
  const cEval    = techCentral(notes);
  const cActive  = techCentral(rows.map(r => r.active));
  const cShift   = techCentral(rows.filter(r => r.shift).map(r => r.shift.avgNetMins));
  const cRapp    = techCentral(rows.map(r => r.missingReports));
  const label = _techMetric === 'median' ? 'Médiane' : _techMetric === 'trimmed' ? 'Moy. tronquée' : 'Moyenne';
  const evalTxt = cEval != null ? cEval.toFixed(1) + '<span class="tch-muted" style="font-weight:400">/5</span>' : '—';
  return '<tr class="tch-summary-row">'+
    '<td class="tch-c-name tch-summary-label"><span class="tch-summary-icon">Σ</span>'+
      '<div><span class="tch-summary-title">'+label+' équipe</span>'+
      '<span class="tch-summary-sub">par technicien</span></div></td>'+
    '<td>'+techFmtAvg(cInterv)+'</td>'+
    '<td>'+techFmtAvg(cResolus)+'</td>'+
    '<td>'+(cTps != null ? pipFmt(cTps) : '—')+'</td>'+
    '<td>'+evalTxt+'</td>'+
    '<td>'+techFmtAvg(cActive)+'</td>'+
    '<td class="tch-c-shift">'+(cShift != null ? '<div class="tch-shift-main">'+pipFmt(cShift)+'</div>' : '—')+'</td>'+
    '<td>'+techFmtAvg(cRapp)+'</td>'+
    '</tr>';
}

/* Met à jour les indicateurs de tri ↑/↓ sur une ligne d'en-tête */
function techUpdateArrows(headRow) {
  if (!headRow) return;
  headRow.querySelectorAll('th[data-sort]').forEach(th => {
    const active = th.dataset.sort === _techSort.key;
    th.classList.toggle('is-sorted', active);
    const arrow = th.querySelector('.tch-arrow');
    if (arrow) arrow.textContent = active ? (_techSort.dir === 'asc' ? '↑' : '↓') : '↕';
  });
}

function renderTechTable() {
  const panel = document.getElementById('panel-techniciens');
  if (!panel || !panel.classList.contains('active')) return;
  const tbody = document.getElementById('tch-table-tbody');
  if (!tbody) return;

  const { rows: allRows, filtered } = computeTechData();
  const rows = sortTechRows(allRows);
  const top  = rows.slice(0, 5);
  tbody.innerHTML = allRows.length
    ? techSummaryHtml(allRows, filtered) + top.map((r,i) => techRowHtml(r, i+1)).join('')
    : '<tr><td colspan="8" class="ov-empty" style="text-align:center;padding:24px">Aucun technicien</td></tr>';

  const foot = document.getElementById('tch-table-foot');
  if (foot) foot.textContent = rows.length > 5
    ? 'Top 5 — ' + rows.length + ' techniciens au total'
    : rows.length + ' technicien' + (rows.length !== 1 ? 's' : '');

  techUpdateArrows(document.querySelector('.tch-thead-row:not(.tch-thead-modal)'));

  // Si la modale est ouverte, la garder synchronisée
  if (document.getElementById('tch-modal-overlay')?.classList.contains('open')) renderTechModal();
}

function renderTechModal() {
  const tbody = document.getElementById('tch-modal-tbody');
  if (!tbody) return;
  const { rows: allRows, filtered } = computeTechData();
  let rows = sortTechRows(allRows);
  const q = _techModalSearch.trim().toLowerCase();
  if (q) rows = rows.filter(r => (r.tech.prenom + ' ' + (r.tech.nom||'')).toLowerCase().includes(q));
  const summary = allRows.length ? techSummaryHtml(allRows, filtered) : '';
  tbody.innerHTML = rows.length
    ? summary + rows.map((r,i) => techRowHtml(r, i+1)).join('')
    : summary + '<tr><td colspan="8" class="ov-empty" style="text-align:center;padding:24px">Aucun résultat</td></tr>';
  const foot = document.getElementById('tch-modal-foot');
  if (foot) foot.textContent = rows.length + ' technicien' + (rows.length !== 1 ? 's' : '') + (q ? ' (filtré)' : '');
  techUpdateArrows(document.querySelector('.tch-thead-modal'));
}

function initTechTable() {
  // Tri par clic sur en-tête (tableau principal + modale partagent _techSort)
  document.querySelectorAll('.tch-thead-row th[data-sort]').forEach(th => {
    th.addEventListener('click', e => {
      if (e.target.closest('.tch-info')) return; // l'icône info ne trie pas
      const key = th.dataset.sort;
      if (_techSort.key === key) {
        _techSort.dir = _techSort.dir === 'asc' ? 'desc' : 'asc';
      } else {
        _techSort.key = key;
        _techSort.dir = key === 'name' ? 'asc' : 'desc';
      }
      renderTechTable();
      renderTechModal();
    });
  });
  // L'icône info ne déclenche pas le tri
  document.querySelectorAll('.tch-info').forEach(el =>
    el.addEventListener('click', e => e.stopPropagation()));

  // Toggle moyenne / médiane / tronquée (ligne de synthèse) — même logique que les autres onglets
  document.querySelectorAll('#tch-metric-toggle button').forEach(btn => {
    btn.addEventListener('click', e => {
      document.querySelectorAll('#tch-metric-toggle button').forEach(b => b.classList.remove('active'));
      e.target.classList.add('active');
      _techMetric = e.target.dataset.metric;
      document.getElementById('tch-trim-wrap')?.classList.toggle('pip-hidden', _techMetric !== 'trimmed');
      renderTechTable(); renderTechModal();
    });
  });
  document.getElementById('tch-trim-input')?.addEventListener('input', () => { renderTechTable(); renderTechModal(); });

  // Modale
  const overlay = document.getElementById('tch-modal-overlay');
  const open  = () => { _techModalSearch=''; const s=document.getElementById('tch-modal-search'); if(s) s.value=''; overlay.classList.add('open'); document.body.style.overflow='hidden'; renderTechModal(); };
  const close = () => { overlay.classList.remove('open'); document.body.style.overflow=''; };
  document.getElementById('tch-voir-tous')?.addEventListener('click', open);
  document.getElementById('tch-modal-close')?.addEventListener('click', close);
  overlay?.addEventListener('click', e => { if (e.target === overlay) close(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && overlay?.classList.contains('open')) close(); });
  document.getElementById('tch-modal-search')?.addEventListener('input', e => {
    _techModalSearch = e.target.value; renderTechModal();
  });
}

/* --- Master dispatch --- */
function renderOverviewSections() {
  const panel = document.getElementById('panel-overview');
  if (!panel || !panel.classList.contains('active')) return;
  if (!_pipTickets._loaded) return;
  const f        = pipGetFilters();
  const filtered = _pipTickets.filter(t => pipMatchesFilter(t, f));
  renderOvEval(filtered);
  renderOvAnnul(filtered);
  renderOvTickets(filtered);
  renderOvTech();
}

/* --- Toggle init --- */
function initOvToggles() {
  document.querySelectorAll('#toggle-ea button').forEach(btn => {
    btn.addEventListener('click', () => {
      _ovEAMode = btn.dataset.mode;
      document.querySelectorAll('#toggle-ea button').forEach(b => b.classList.toggle('active', b===btn));
      document.getElementById('ov-eval-table').style.display  = _ovEAMode==='eval'  ? '' : 'none';
      document.getElementById('ov-annul-table').style.display = _ovEAMode==='annul' ? '' : 'none';
      const eaTitle = document.getElementById('ov-ea-title');
      if (eaTitle) eaTitle.textContent = _ovEAMode==='eval' ? 'Derniers tickets évalué' : 'Derniers tickets annulé';
    });
  });
  document.querySelectorAll('#toggle-tickets button').forEach(btn => {
    btn.addEventListener('click', () => {
      _ovTkMode = btn.dataset.mode;
      document.querySelectorAll('#toggle-tickets button').forEach(b => b.classList.toggle('active', b===btn));
      if (_pipTickets._loaded) {
        const f = pipGetFilters();
        renderOvTickets(_pipTickets.filter(t => pipMatchesFilter(t, f)));
      }
    });
  });
}


/* ============================================================
   10. BOOT
   ============================================================ */
(async function boot() {
  const s = Session.require('manager');
  if (!s) return;

  const name = s.user_name || 'Manager';
  document.getElementById('topbar-avatar').textContent = name.charAt(0).toUpperCase();
  document.getElementById('sb-user-name').textContent  = name;
  document.getElementById('sb-logout').addEventListener('click', e => {
    e.preventDefault(); Session.clear(); window.location.href = '/';
  });

  let data = { clients:[], techniciens:[], parc:[], catalogue:{nodes:{}}, tickets:[] };
  try { data = await API.bootstrap(); }
  catch (err) { showToast('Erreur de chargement : ' + err.message, 'error'); }

  _liveClients = data.clients     || [];
  _liveTechs   = data.techniciens || [];
  _liveParc    = data.parc        || [];

  initFilters(data);
  initDatePicker();
  initPipeline();
  initOvToggles();
  initTechTable();

  // Seed pipeline with bootstrap tickets right away
  _pipTickets         = data.tickets || [];
  _pipTickets._loaded = true;
  pipRefresh();

  // Live polling every 5 s — re-compute on each tick
  API.poll(tickets => {
    _pipTickets         = tickets;
    _pipTickets._loaded = true;
    pipRefresh();
    renderTechKPIs();
  }, 5000);

  // Live tech availability polling every 5 s
  (function pollTechs() {
    async function tick() {
      try {
        _liveTechs = await API.techniciens();
        renderOvTech();
        renderTechKPIs();
      } catch(e) {}
      setTimeout(tick, 5000);
    }
    setTimeout(tick, 5000);
  })();

  // Re-compute when any filter changes (period or multi-select)
  document.getElementById('period-select')?.addEventListener('change', pipRefresh);
  document.getElementById('date-start')?.addEventListener('change', pipRefresh);
  document.getElementById('date-end')?.addEventListener('change', pipRefresh);
  // onChange callbacks include pipRefresh() + updateGlobalTags() directly — no post-init patching needed.

  // Restore tab from URL hash
  const hash = window.location.hash.replace('#','');
  activateTab(TABS.includes(hash) ? hash : 'overview');
  pipHandleResize();
})();

/* ============================================================
   MODAL HISTORIQUE COMPLET
   ============================================================ */
let _ovModalMode = null;
let _ovModalTab  = { eval: 'eval', tickets: 'resolus', top_tickets: 'long' };

function ovOpenModal(mode) {
  _ovModalMode = mode;
  document.getElementById('ov-modal-overlay').classList.add('open');
  document.body.style.overflow = 'hidden';
  _ovModalBuild();
}
function _ovModalBuild() {
  const mode = _ovModalMode;
  document.getElementById('ov-modal-title').textContent = _ovModalTitle();
  const tabsEl = document.getElementById('ov-modal-tabs');
  if (mode==='eval' || mode==='tickets' || mode==='top_tickets') {
    const defs = mode==='eval'
      ? [['eval','Évaluations'],['annul','Annulations']]
      : mode === 'top_tickets'
      ? [['long','Plus longs'],['short','Plus courts']]
      : [['resolus','Résolus'],['crees','Créés']];
    const active = _ovModalTab[mode];
    tabsEl.innerHTML = defs.map(([v,l])=>
      '<button class="ov-modal-tab-btn'+(v===active?' active':'')+'" data-tab="'+v+'">'+l+'</button>'
    ).join('');
    tabsEl.querySelectorAll('.ov-modal-tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        _ovModalTab[mode] = btn.dataset.tab;
        tabsEl.querySelectorAll('.ov-modal-tab-btn').forEach(b=>b.classList.toggle('active',b===btn));
        document.getElementById('ov-modal-title').textContent = _ovModalTitle();
        _ovBuildFilters();
        _ovModalRefresh();
      });
    });
  } else {
    tabsEl.innerHTML = '';
  }
  _ovBuildFilters();
  _ovModalRefresh();
}
function _ovBuildFilters() {
  const mode = _ovModalMode, tab = _ovModalTab[mode];
  const fil  = document.getElementById('ov-modal-filters');
  fil.innerHTML = '';
  _ovMF = {};
  _ovModalSelects = [];

  if (mode === 'eval') {
    fil.appendChild(_ovGroup('Rechercher',
      _ovSearchInput('mf-ea-q', tab==='eval' ? 'ID, client, commentaire…' : 'ID, client, raison…'), {grow:true}));
    _ovMF.client = new OvSearchSelect('Tous les clients', _ovClientOptions(), _ovModalRefresh);
    fil.appendChild(_ovGroup('Client', _ovMF.client.el, {width:'190px'}));
    if (tab === 'eval') {
      _ovMF.note = new OvSearchSelect('Toutes notes', _ovNoteOptions(), _ovModalRefresh);
      fil.appendChild(_ovGroup('Note', _ovMF.note.el, {width:'150px'}));
    } else {
      _ovMF.raison = new OvSearchSelect('Toutes raisons', _ovRaisonOptions(), _ovModalRefresh);
      fil.appendChild(_ovGroup('Raison', _ovMF.raison.el, {width:'190px'}));
    }
    _ovMF.range = new OvDateRange(_ovModalRefresh);
    fil.appendChild(_ovGroup('Période', _ovMF.range.el));

  } else if (mode === 'tickets') {
    fil.appendChild(_ovGroup('Rechercher', _ovSearchInput('mf-tk-q', 'ID, client…'), {grow:true}));
    _ovMF.client = new OvSearchSelect('Tous les clients', _ovClientOptions(), _ovModalRefresh);
    fil.appendChild(_ovGroup('Client', _ovMF.client.el, {width:'190px'}));
    _ovMF.range = new OvDateRange(_ovModalRefresh);
    fil.appendChild(_ovGroup('Période', _ovMF.range.el));

  } else if (mode === 'top_tickets') {
    fil.appendChild(_ovGroup('Rechercher', _ovSearchInput('mf-tt-q', 'ID, titre, client…'), {grow:true}));
    _ovMF.client = new OvSearchSelect('Tous les clients', _ovClientOptions(), _ovModalRefresh);
    fil.appendChild(_ovGroup('Client', _ovMF.client.el, {width:'190px'}));
    _ovMF.tech = new OvSearchSelect('Tous les techniciens', _ovTechOptions(), _ovModalRefresh);
    fil.appendChild(_ovGroup('Technicien', _ovMF.tech.el, {width:'190px'}));
    
    const refs = Array.from(new Set(_pipTickets.map(t=>t.reference).filter(Boolean))).sort();
    const refOpts = [{value:'',label:'Toutes références'}].concat(refs.map(r=>({value:r,label:r})));
    _ovMF.ref = new OvSearchSelect('Toutes références', refOpts, _ovModalRefresh);
    fil.appendChild(_ovGroup('Réf. machine', _ovMF.ref.el, {width:'190px'}));

  } else { // shifts
    fil.appendChild(_ovGroup('Rechercher', _ovSearchInput('mf-sh-q', 'Nom du technicien…'), {grow:true}));
    _ovMF.tech = new OvSearchSelect('Tous les techniciens', _ovTechOptions(), _ovModalRefresh);
    fil.appendChild(_ovGroup('Technicien', _ovMF.tech.el, {width:'210px'}));
    _ovMF.range = new OvDateRange(_ovModalRefresh);
    fil.appendChild(_ovGroup('Période', _ovMF.range.el));
  }
}
function ovCloseModal() {
  document.getElementById('ov-modal-overlay').classList.remove('open');
  document.body.style.overflow = '';
}
function _ovModalRefresh() {
  if (_ovModalMode==='eval')         _ovModalRenderEval();
  else if (_ovModalMode==='tickets') _ovModalRenderTickets();
  else if (_ovModalMode==='shifts')  _ovModalRenderShifts();
  else if (_ovModalMode==='top_tickets') _ovModalRenderTopTickets();
}
document.getElementById('ov-modal-close').addEventListener('click', ovCloseModal);
document.getElementById('ov-modal-overlay').addEventListener('click', function(e){ if(e.target===this) ovCloseModal(); });
document.addEventListener('keydown', function(e){ if(e.key==='Escape') ovCloseModal(); });

/* ============================================================
   MODAL — shared state, searchable select & date-range pickers
   ============================================================ */
const OV_SORT_HINT  = '• Tri disponible sur toutes les colonnes via un clic sur l’en-tête (indicateur de tri visuel ↑/↓).';
const OV_DISPO_PILL = {'En service':'dispo-service','En pause':'dispo-pause','Hors service':'dispo-hors','Archivé':'dispo-hors'};
let _ovMF          = {};   // active modal filter controls (name -> instance with getValue/getRange)
let _ovModalSelects = [];  // OvSearchSelect instances currently mounted (for outside-click close)
let _ovSortByView  = {};   // viewKey -> { key, dir } remembered column sort

/* Resolve a period preset value (same vocabulary as the main filter) into a
   {start,end} ISO date range. Returns null for "custom". */
function periodRange(v) {
  const fmt = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  if (v === 'custom') return null;
  const today = new Date();
  let s = new Date(today), e = new Date(today);
  if (v === '7days') { s.setDate(today.getDate()-6); }
  else if (v === 'week') { const d = today.getDate()-today.getDay()+(today.getDay()===0?-6:1); s.setDate(d); e = new Date(s); e.setDate(s.getDate()+6); }
  else if (v === 'month') { s = new Date(today.getFullYear(),today.getMonth(),1); e = new Date(today.getFullYear(),today.getMonth()+1,0); }
  else if (v === 'quarter') { const q = Math.floor(today.getMonth()/3); s = new Date(today.getFullYear(),q*3,1); e = new Date(today.getFullYear(),q*3+3,0); }
  else if (v === 'year') { s = new Date(today.getFullYear(),0,1); e = new Date(today.getFullYear(),11,31); }
  return { start: fmt(s), end: fmt(e) };
}

/* Searchable single-select reusing the dashboard's .ms-* design system. */
class OvSearchSelect {
  constructor(placeholder, options, onChange) {
    this.placeholder = placeholder; this.options = options; this.onChange = onChange;
    this.value = ''; this.searchQuery = '';
    this.el = document.createElement('div');
    this.el.className = 'ms-wrap ov-ss';
    this.el.innerHTML =
      '<input type="text" class="ms-input" placeholder="'+xe(placeholder)+'" autocomplete="off">'+
      '<svg class="ms-chevron" viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9"/></svg>'+
      '<div class="ms-dropdown"><div class="ms-options"></div></div>';
    this.input     = this.el.querySelector('.ms-input');
    this.optionsEl = this.el.querySelector('.ms-options');
    this.el.querySelector('.ms-dropdown').addEventListener('click', e => e.stopPropagation());
    this.input.addEventListener('focus', () => this.open());
    this.input.addEventListener('click', () => this.open());
    this.input.addEventListener('input', e => { this.searchQuery = e.target.value.toLowerCase(); this._renderOpts(); });
    this._renderOpts(); this._sync();
    _ovModalSelects.push(this);
  }
  open() {
    _ovModalSelects.forEach(s => { if (s !== this) s.close(); });
    this.el.classList.add('open');
    this.input.value = ''; this.searchQuery = '';
    this.input.placeholder = 'Taper pour chercher...';
    this._renderOpts();
  }
  close() { this.el.classList.remove('open'); this.input.value = ''; this.searchQuery = ''; this._sync(); }
  getValue() { return this.value; }
  _renderOpts() {
    const f = this.options.filter(o => o.label.toLowerCase().includes(this.searchQuery));
    if (!f.length) { this.optionsEl.innerHTML = '<div style="padding:10px 16px;font-size:12px;color:var(--light-slate);">Aucun résultat</div>'; return; }
    this.optionsEl.innerHTML = f.map(o =>
      '<div class="ms-opt ov-ss-opt'+(o.value===this.value?' is-active':'')+'" data-val="'+xe(o.value)+'">'+
      (o.htmlLabel || ('<span>'+xe(o.label)+'</span>'))+'</div>').join('');
    this.optionsEl.querySelectorAll('.ov-ss-opt').forEach(el =>
      el.addEventListener('click', () => { this.value = el.dataset.val; this.close(); if (this.onChange) this.onChange(this.value); }));
  }
  _sync() {
    const it = this.options.find(o => o.value === this.value);
    if (this.value && it) { this.input.placeholder = it.label; this.input.classList.add('has-selection'); }
    else { this.input.placeholder = this.placeholder; this.input.classList.remove('has-selection'); }
  }
}

/* Date-range picker mirroring the main filter bar; initialises from (follows)
   the main filter's current period and can be changed inside the popup. */
class OvDateRange {
  constructor(onChange) {
    this.onChange = onChange;
    this.el = document.createElement('div');
    this.el.className = 'date-range-picker ov-dr';
    this.el.innerHTML =
      '<select class="ov-dr-sel">'+
        '<option value="today">Aujourd\'hui</option>'+
        '<option value="7days">7 derniers jours</option>'+
        '<option value="week">Cette semaine</option>'+
        '<option value="month">Ce mois</option>'+
        '<option value="quarter">Ce trimestre</option>'+
        '<option value="year">Cette année</option>'+
        '<option value="custom">Personnalisé</option>'+
      '</select>'+
      '<input type="date" class="ov-dr-start">'+
      '<span class="date-separator">→</span>'+
      '<input type="date" class="ov-dr-end">';
    this.sel   = this.el.querySelector('.ov-dr-sel');
    this.start = this.el.querySelector('.ov-dr-start');
    this.end   = this.el.querySelector('.ov-dr-end');
    // Follow the main filter's current value
    this.sel.value   = document.getElementById('period-select')?.value || 'year';
    this.start.value = document.getElementById('date-start')?.value || '';
    this.end.value   = document.getElementById('date-end')?.value || '';
    this.sel.addEventListener('change',  () => { this._preset(); if (this.onChange) this.onChange(); });
    this.start.addEventListener('change', () => { this.sel.value = 'custom'; if (this.onChange) this.onChange(); });
    this.end.addEventListener('change',   () => { this.sel.value = 'custom'; if (this.onChange) this.onChange(); });
  }
  _preset() { const r = periodRange(this.sel.value); if (r) { this.start.value = r.start; this.end.value = r.end; } }
  getRange() { return { start: this.start.value || null, end: this.end.value || null }; }
}

/* Close any open modal search-select when clicking elsewhere */
document.addEventListener('click', e => {
  _ovModalSelects.forEach(s => { if (!s.el.contains(e.target) && s.el.classList.contains('open')) s.close(); });
});

/* --- Option list builders --- */
function _ovClientOptions() {
  return [{value:'',label:'Tous les clients'}].concat(
    [..._liveClients].sort((a,b)=>(a.raison_sociale||'').localeCompare(b.raison_sociale||''))
      .map(c=>({value:String(c.id), label:c.raison_sociale||String(c.id)})));
}
function _ovTechOptions() {
  return [{value:'',label:'Tous les techniciens'}].concat(
    _liveTechs.filter(t=>!t.archived).sort((a,b)=>(a.prenom+a.nom).localeCompare(b.prenom+b.nom))
      .map(t=>({value:t.id, label:(t.prenom+' '+(t.nom||'')).trim()})));
}
function _ovNoteOptions() {
  const star = n => '<span style="color:#F59E0B;letter-spacing:1px">'+'★'.repeat(n)+'</span><span style="color:var(--light-grey)">'+'★'.repeat(5-n)+'</span>';
  return [{value:'',label:'Toutes notes'}].concat([5,4,3,2,1].map(n=>({value:String(n), label:n+'/5', htmlLabel:star(n)})));
}
function _ovRaisonOptions() {
  return [{value:'',label:'Toutes raisons'}].concat(
    ['Doublon','Problème résolu','Envoi par erreur','Autre raison'].map(r=>({value:r, label:r})));
}

/* --- Filter-bar builders --- */
function _ovGroup(label, node, opts) {
  opts = opts || {};
  const g = document.createElement('div');
  g.className = 'ov-mf-group' + (opts.grow ? ' grow' : '');
  if (opts.width) g.style.width = opts.width;
  g.innerHTML = '<label class="filter-label">'+label+'</label>';
  g.appendChild(node);
  return g;
}
function _ovSearchInput(id, placeholder) {
  const i = document.createElement('input');
  i.className = 'ov-mf-search'; i.id = id; i.placeholder = placeholder; i.autocomplete = 'off';
  i.addEventListener('input', _ovModalRefresh);
  return i;
}

/* --- Modal title (follows mode + active tab) --- */
function _ovModalTitle() {
  const mode = _ovModalMode, tab = _ovModalTab[mode];
  if (mode === 'eval')    return tab === 'eval' ? 'Tickets évalués' : 'Tickets annulés';
  if (mode === 'tickets') return 'Tickets';
  if (mode === 'top_tickets') return 'Classement des tickets par durée';
  return 'Disponibilités — Historique';
}

/* --- Range test on an ISO date against the popup period --- */
function _ovWithinRange(iso, r) {
  if (!iso) return true;
  const d = iso.slice(0,10);
  if (r.start && d < r.start) return false;
  if (r.end   && d > r.end)   return false;
  return true;
}

/* --- Generic sortable-table renderer for the modal ---
   cols: [{ key, label, get?, align? }]  (a column without `get` is not sortable)
   rows: already filtered + default-sorted; re-sorted here if a header is active.
   rowHtml(row) -> <tr>…</tr> string. */
function _ovRenderTable(viewKey, cols, rows, rowHtml) {
  const thead  = document.getElementById('ov-modal-thead');
  const tbody  = document.getElementById('ov-modal-tbody');
  const footer = document.getElementById('ov-modal-footer');
  const sort   = _ovSortByView[viewKey] || { key:null, dir:1 };

  if (sort.key) {
    const col = cols.find(c => c.key === sort.key);
    if (col && col.get) rows = rows.slice().sort((a,b) => {
      const va = col.get(a), vb = col.get(b);
      let r;
      if (typeof va === 'number' && typeof vb === 'number') r = va - vb;
      else r = String(va==null?'':va).localeCompare(String(vb==null?'':vb), 'fr', {numeric:true});
      return r * sort.dir;
    });
  }

  thead.innerHTML = '<tr>'+cols.map(c => {
    if (!c.get) return '<th'+(c.align?' style="text-align:'+c.align+'"':'')+'>'+(c.label||'')+'</th>';
    const active = sort.key === c.key;
    const arrow  = active ? (sort.dir>0?'↑':'↓') : '';
    return '<th class="ov-th-sort'+(active?' is-active':'')+'" data-key="'+c.key+'">'+c.label+'<span class="ov-th-arrow">'+arrow+'</span></th>';
  }).join('')+'</tr>';

  thead.querySelectorAll('th[data-key]').forEach(th => th.addEventListener('click', () => {
    const k = th.dataset.key;
    const cur = _ovSortByView[viewKey] || { key:null, dir:1 };
    if (cur.key === k) cur.dir = -cur.dir; else { cur.key = k; cur.dir = 1; }
    _ovSortByView[viewKey] = cur;
    _ovModalRefresh();
  }));

  const n = rows.length;
  tbody.innerHTML = n
    ? rows.map(rowHtml).join('')
    : '<tr><td colspan="'+cols.length+'" class="ov-empty">Aucun résultat pour ces filtres.</td></tr>';
  footer.innerHTML =
    '<span class="ov-foot-hint">'+OV_SORT_HINT+'</span>'+
    '<span class="ov-foot-count">'+(n ? n+' entrée'+(n>1?'s':'') : '0 entrée')+'</span>';
  ovWireRows(tbody);
}

/* --- MODAL A : Évaluations & Annulations (tab-aware) --- */
function _ovModalRenderEval() {
  const tab    = _ovModalTab.eval;
  const q      = (document.getElementById('mf-ea-q')?.value||'').toLowerCase();
  const client = _ovMF.client?.getValue()||'';
  const range  = _ovMF.range?.getRange()||{start:null,end:null};
  const STARS  = n => '<span style="color:#F59E0B;letter-spacing:1px">'+'★'.repeat(n)+'</span><span style="color:var(--light-grey)">'+'★'.repeat(5-n)+'</span>';

  if (tab==='eval') {
    const note = _ovMF.note?.getValue()||'';
    const rows = _pipTickets.filter(t => {
      if (!t.evaluation||t.evaluation.note==null) return false;
      if (client && String(t.client_id)!==client) return false;
      if (note && String(t.evaluation.note)!==note) return false;
      if (!_ovWithinRange(t.evaluation.updated_at||t.created_at, range)) return false;
      if (q) {
        const c2=ovClientName(t.client_id).toLowerCase(), co=(t.evaluation.commentaire||'').toLowerCase();
        if (!t.id.toLowerCase().includes(q)&&!c2.includes(q)&&!co.includes(q)) return false;
      }
      return true;
    }).sort((a,b)=>(a.evaluation.updated_at||a.created_at)<(b.evaluation.updated_at||b.created_at)?1:-1);
    const cols = [
      { key:'id',      label:'ID',                  get:t=>t.id },
      { key:'date',    label:"Date d'évaluation",   get:t=>t.evaluation.updated_at||t.created_at },
      { key:'client',  label:'Client',              get:t=>ovClientName(t.client_id) },
      { key:'note',    label:'Note',                get:t=>Number(t.evaluation.note) },
      { key:'comment', label:'Commentaire',         get:t=>t.evaluation.commentaire||'' },
      { key:'_a',      label:'' }
    ];
    _ovRenderTable('eval:eval', cols, rows, t => {
      const iso=t.evaluation.updated_at||t.created_at;
      return '<tr data-id="'+xe(t.id)+'">'+
        '<td class="ov-col-id">'+xe(t.id)+'</td>'+ovDateCell(iso)+
        '<td>'+xe(ovClientName(t.client_id))+'</td>'+
        '<td style="white-space:nowrap;font-size:15px">'+STARS(t.evaluation.note)+'</td>'+
        '<td style="color:var(--grey);max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+xe(t.evaluation.commentaire||'—')+'</td>'+
        ovActionCell()+'</tr>';
    });
  } else {
    const raison = _ovMF.raison?.getValue()||'';
    const rows = _pipTickets.filter(t => {
      if (t.status!=='Annulé'||!t.cancellation) return false;
      if (client && String(t.client_id)!==client) return false;
      if (raison && t.cancellation.raison!==raison) return false;
      if (!_ovWithinRange(t.cancellation.at||t.created_at, range)) return false;
      if (q) {
        const c2=(ovClientName(t.client_id)||'').toLowerCase(), r2=(t.cancellation.raison||'').toLowerCase();
        if (!t.id.toLowerCase().includes(q)&&!c2.includes(q)&&!r2.includes(q)) return false;
      }
      return true;
    }).sort((a,b)=>(a.cancellation.at||a.created_at)<(b.cancellation.at||b.created_at)?1:-1);
    const cols = [
      { key:'id',      label:'ID',                  get:t=>t.id },
      { key:'date',    label:"Date d'annulation",   get:t=>t.cancellation.at||t.created_at },
      { key:'client',  label:'Client',              get:t=>ovClientName(t.client_id) },
      { key:'by',      label:'Annulé par',          get:t=>t.cancellation.by_name||'' },
      { key:'raison',  label:'Raison',              get:t=>t.cancellation.raison||'' },
      { key:'comment', label:'Commentaire',         get:t=>t.cancellation.commentaire||'' },
      { key:'_a',      label:'' }
    ];
    _ovRenderTable('eval:annul', cols, rows, t => {
      const c=t.cancellation;
      const role=c.by_role?'<small style="color:var(--light-slate)"> ('+xe(ovRoleLabel(c.by_role))+')</small>':'';
      return '<tr data-id="'+xe(t.id)+'">'+
        '<td class="ov-col-id">'+xe(t.id)+'</td>'+ovDateCell(c.at||t.created_at)+
        '<td>'+xe(ovClientName(t.client_id))+'</td>'+
        '<td style="white-space:nowrap">'+xe(c.by_name||'—')+role+'</td>'+
        '<td>'+xe(c.raison||'—')+'</td>'+
        '<td style="color:var(--grey);max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+xe(ovTrunc(c.commentaire||'',50))+'</td>'+
        ovActionCell()+'</tr>';
    });
  }
}

/* --- MODAL Top Tickets --- */
function _ovModalRenderTopTickets() {
  const tab    = _ovModalTab.top_tickets; // 'long' or 'short'
  const q      = (document.getElementById('mf-tt-q')?.value||'').toLowerCase();
  const client = _ovMF.client?.getValue()||'';
  const tech   = _ovMF.tech?.getValue()||'';
  const ref    = _ovMF.ref?.getValue()||'';

  let done = _pipTickets.filter(t => t.status === 'Terminé');
  let rows = [];
  done.forEach(t => {
    const dur = pipTotalTime(t);
    if (dur != null) rows.push({ t: t, v: dur });
  });

  rows = rows.filter(o => {
    const tk = o.t;
    if (client && String(tk.client_id) !== client) return false;
    if (tech && !(tk.technicien_ids||[]).map(String).includes(tech)) return false;
    if (ref && tk.reference !== ref) return false;
    if (q) {
      const c2 = (ovClientName(tk.client_id)||'').toLowerCase();
      const d2 = (tk.description||'').toLowerCase();
      if (!tk.id.toLowerCase().includes(q) && !c2.includes(q) && !d2.includes(q)) return false;
    }
    return true;
  });

  rows.sort((a,b) => tab === 'long' ? (b.v - a.v) : (a.v - b.v));

  const cols = [
    { key:'_rank',  label:'#',            align:'center' },
    { key:'id',     label:'ID',           get: o => o.t.id },
    { key:'title',  label:'Titre',        get: o => (o.t.description||'') },
    { key:'client', label:'Client',       get: o => ovClientName(o.t.client_id) },
    { key:'tech',   label:'Technicien',   get: o => ovTechName(o.t.technicien_ids) },
    { key:'ref',    label:'Réf. machine', get: o => o.t.reference || o.t.instance_id || '' },
    { key:'dur',    label:'Durée', align:'right', get: o => o.v }
  ];

  _ovRenderTable('top_tickets_'+tab, cols, rows, (o, i) => {
    const tk = o.t;
    return '<tr data-id="'+xe(tk.id)+'">'+
      '<td style="text-align:center;"><span class="tk-list-rank" style="margin:0">'+(i+1)+'</span></td>'+
      '<td class="ov-col-id">'+xe(tk.id)+'</td>'+
      '<td style="max-width:200px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="'+xe(tk.description||'')+'">'+xe(tk.description||'—')+'</td>'+
      '<td>'+xe(ovClientName(tk.client_id))+'</td>'+
      '<td>'+xe(ovTechName(tk.technicien_ids))+'</td>'+
      '<td>'+xe(tk.reference||tk.instance_id||'—')+'</td>'+
      '<td class="tk-num" style="text-align:right;font-weight:700;color:var(--steel-blue);">'+pipFmt(o.v)+'</td>'+
      '</tr>';
  });
}

/* --- MODAL B : Tickets résolus & créés --- */
function _ovModalRenderTickets() {
  const tab    = _ovModalTab.tickets;
  const q      = (document.getElementById('mf-tk-q')?.value||'').toLowerCase();
  const client = _ovMF.client?.getValue()||'';
  const range  = _ovMF.range?.getRange()||{start:null,end:null};

  const getTermineTs = t => (((t.timeline||[]).slice().reverse().find(e=>e.status==='Terminé'))||{}).timestamp||null;

  const rows = _pipTickets.filter(t => {
    if (tab==='resolus' && t.status!=='Terminé') return false;
    // 'crees' : tous les tickets, sans exclusion de statut
    if (client && String(t.client_id)!==client) return false;
    // Filtre date : pour résolus on utilise la date de résolution, pour créés la date de création
    const dateRef = tab==='resolus' ? (getTermineTs(t)||t.created_at) : t.created_at;
    if (!_ovWithinRange(dateRef, range)) return false;
    if (q) {
      const c2=ovClientName(t.client_id).toLowerCase();
      const r2=(t.reference||'').toLowerCase();
      if (!t.id.toLowerCase().includes(q)&&!c2.includes(q)&&!r2.includes(q)) return false;
    }
    return true;
  }).sort((a,b) => {
    const da = tab==='resolus' ? (getTermineTs(a)||a.created_at) : a.created_at;
    const db = tab==='resolus' ? (getTermineTs(b)||b.created_at) : b.created_at;
    return da < db ? 1 : -1;
  });

  const dateLabel = tab === 'resolus' ? 'Date de résolution' : 'Date de création';
  const cols = [
    { key:'id',      label:'ID',           get:t=>t.id },
    { key:'date',    label:dateLabel,      get:t=> tab==='resolus' ? (getTermineTs(t)||t.created_at) : t.created_at },
    { key:'client',  label:'Client',       get:t=>ovClientName(t.client_id) },
    { key:'machine', label:'Réf. machine', get:t=>t.reference||'' },
    { key:'tech',    label:'Technicien',   get:t=>ovTechName(t.technicien_ids) },
    { key:'_a',      label:'' }
  ];
  _ovRenderTable('tickets:'+tab, cols, rows, t => {
    const iso = tab==='resolus' ? (getTermineTs(t)||t.created_at) : t.created_at;
    return '<tr data-id="'+xe(t.id)+'">'+'<td class="ov-col-id">'+xe(t.id)+'</td>'+ovDateCell(iso)+
      '<td>'+xe(ovClientName(t.client_id))+'</td>'+
      ovMachineCell(t)+
      '<td style="white-space:nowrap">'+xe(ovTechName(t.technicien_ids))+'</td>'+
      ovActionCell()+'</tr>';
  });
}

/* --- MODAL C : Disponibilités — état live marqué dans la colonne Technicien --- */
function _ovModalRenderShifts() {
  const q      = (document.getElementById('mf-sh-q')?.value||'').toLowerCase();
  const techId = _ovMF.tech?.getValue()||'';
  const range  = _ovMF.range?.getRange()||{start:null,end:null};
  const rows = [];
  _liveTechs.filter(t=>!t.archived).forEach(t => {
    const name = (t.prenom+' '+(t.nom||'')).trim();
    (t.shift_log||[]).forEach(e => {
      if (techId && t.id!==techId) return;
      if (!_ovWithinRange(e.at, range)) return;
      if (q && !name.toLowerCase().includes(q)) return;
      rows.push({ name, cur:t.disponibilite||'Hors service', ...e });
    });
  });
  rows.sort((a,b)=>a.at<b.at?1:-1);
  const cols = [
    { key:'tech', label:'Technicien',   get:r=>r.name },
    { key:'date', label:'Date / heure', get:r=>r.at },
    { key:'from', label:'De',           get:r=>r.from },
    { key:'to',   label:'Vers',         get:r=>r.to }
  ];
  _ovRenderTable('shifts', cols, rows, e => {
    const d  = new Date(e.at);
    const hm = d.getHours().toString().padStart(2,'0')+':'+d.getMinutes().toString().padStart(2,'0');
    const ds = d.toLocaleDateString('fr-FR',{day:'2-digit',month:'2-digit',year:'numeric'});
    const curCls = OV_DISPO_PILL[e.cur]||'dispo-hors';
    return '<tr>'+
      '<td><div style="font-weight:600">'+xe(e.name)+'</div>'+
        '<div style="margin-top:4px"><span class="dispo-pill '+curCls+'" style="gap:5px"><span class="dispo-live-dot"></span>'+xe(e.cur)+'</span></div></td>'+
      '<td class="ov-col-date">'+ds+'<small>'+hm+'</small></td>'+
      '<td><span class="dispo-pill '+(OV_DISPO_PILL[e.from]||'dispo-hors')+'">'+xe(e.from)+'</span></td>'+
      '<td><span class="dispo-pill '+(OV_DISPO_PILL[e.to]||'dispo-hors')+'">'+xe(e.to)+'</span></td>'+
      '</tr>';
  });
}
