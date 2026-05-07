const SUPABASE_URL = 'https://tswciotezqiuvmcglcdk.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRzd2Npb3RlenFpdXZtY2dsY2RrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgwNjkyMjIsImV4cCI6MjA5MzY0NTIyMn0.2GHTBj2bm3yzRifIJQRZrSdxY4Gr_sktjcnZL7m7Nlk';

const { createClient } = supabase;
const db = createClient(SUPABASE_URL, SUPABASE_KEY);

let allRezepte = [];
let currentView = 'grid';
let currentFilter = 'alle';
let currentSearch = '';
let activeTags = new Set();
let activeZutaten = new Set();
let zutatenChipFilter = '';
let currentRatingFilter = 0;
let ratingPending = false;

// ── Sicherheit: HTML-Escape & URL-Validation ──────────────────
function esc(v) {
  if (v == null) return '';
  return String(v)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function safeUrl(url) {
  if (!url) return null;
  try {
    const u = new URL(url);
    return (u.protocol === 'http:' || u.protocol === 'https:') ? url : null;
  } catch { return null; }
}

// ── Init ──────────────────────────────────────────────────────
async function init() {
  const { data, error } = await db.from('rezepte').select('*').order('erstellt', { ascending: false });
  document.getElementById('loading').classList.add('hidden');
  if (error) { document.getElementById('loading').textContent = 'Fehler beim Laden.'; return; }
  allRezepte = data || [];
  renderTagFilter();
  renderZutatenFilter();
  render();
}

// ── Tag-Filter rendern ────────────────────────────────────────
function renderTagFilter() {
  const bar = document.getElementById('tag-filter-bar');
  const allTags = [...new Set(allRezepte.flatMap(r => r.tags || []))].sort();
  if (!allTags.length) { bar.classList.add('hidden'); return; }
  bar.innerHTML = allTags.map(t => `
    <button class="chip tag-chip${activeTags.has(t) ? ' active' : ''}" data-tag="${esc(t)}">${esc(t)}</button>
  `).join('');
  bar.querySelectorAll('.tag-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      const tag = btn.dataset.tag;
      activeTags.has(tag) ? activeTags.delete(tag) : activeTags.add(tag);
      btn.classList.toggle('active');
      render();
    });
  });
}

// ── Zutaten-Filter rendern ────────────────────────────────────
function renderZutatenFilter() {
  const wrap = document.getElementById('zutaten-filter-bar');
  const chipsEl = document.getElementById('zutaten-chips');
  const searchEl = document.getElementById('zutaten-search');

  // Map: lowercase+trim -> erste gefundene Original-Schreibweise
  const zutatenMap = new Map();
  for (const r of allRezepte) {
    for (const z of (r.zutaten || [])) {
      if (!z || !z.name) continue;
      const key = z.name.toLowerCase().trim();
      if (!key) continue;
      if (!zutatenMap.has(key)) zutatenMap.set(key, z.name.trim());
    }
  }
  const entries = [...zutatenMap.entries()].sort((a, b) => a[0].localeCompare(b[0], 'de'));
  if (!entries.length) { wrap.classList.add('hidden'); return; }

  // Suchfeld nur ab > 30 Chips zeigen
  if (entries.length > 30) searchEl.classList.remove('hidden');
  else searchEl.classList.add('hidden');

  const q = zutatenChipFilter.toLowerCase().trim();
  const visible = q ? entries.filter(([k]) => k.includes(q)) : entries;

  chipsEl.innerHTML = visible.map(([key, label]) => `
    <button class="chip zutat-chip${activeZutaten.has(key) ? ' active' : ''}" data-zutat="${esc(key)}">${esc(label)}</button>
  `).join('');
  chipsEl.querySelectorAll('.zutat-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      const z = btn.dataset.zutat;
      activeZutaten.has(z) ? activeZutaten.delete(z) : activeZutaten.add(z);
      btn.classList.toggle('active');
      updateZutatenButtonLabel();
      render();
    });
  });
  updateZutatenButtonLabel();
}

function updateZutatenButtonLabel() {
  const btn = document.getElementById('btn-zutaten');
  if (!btn) return;
  btn.textContent = activeZutaten.size > 0 ? `Zutaten (${activeZutaten.size})` : 'Zutaten';
}

// ── Render ────────────────────────────────────────────────────
function filtered() {
  return allRezepte.filter(r => {
    const matchFilter = currentFilter === 'alle' || r.plattform === currentFilter;
    const q = currentSearch.toLowerCase();
    const matchSearch = !q ||
      r.titel.toLowerCase().includes(q) ||
      (r.tags || []).some(t => t.toLowerCase().includes(q)) ||
      (r.zutaten || []).some(z => z.name && z.name.toLowerCase().includes(q));
    const matchTags = activeTags.size === 0 ||
      [...activeTags].every(t => (r.tags || []).includes(t));
    const matchZutaten = activeZutaten.size === 0 ||
      [...activeZutaten].every(z =>
        (r.zutaten || []).some(zr => zr.name && zr.name.toLowerCase().trim() === z)
      );
    const matchRating = currentRatingFilter === 0 ||
      (r.bewertung != null && r.bewertung >= currentRatingFilter);
    return matchFilter && matchSearch && matchTags && matchZutaten && matchRating;
  });
}

function render() {
  const list = filtered();
  if (currentView === 'grid') renderGrid(list);
  else renderTable(list);
}

function renderGrid(list) {
  document.getElementById('grid-view').classList.remove('hidden');
  document.getElementById('table-view').classList.add('hidden');
  const el = document.getElementById('grid-view');
  if (!list.length) { el.innerHTML = '<p style="color:var(--text-muted)">Keine Rezepte gefunden.</p>'; return; }
  el.innerHTML = list.map(r => `
    <div class="card" data-id="${+r.id}">
      ${r.bild_url ? `<img class="card-image" src="${esc(r.bild_url)}" alt="${esc(r.titel)}" loading="lazy" />` : '<div class="card-image-placeholder"></div>'}
      <div class="card-body">
        <div class="card-header">
          <div class="card-title">${esc(r.titel)}</div>
          <span class="badge badge-${esc(r.plattform)}">${esc(r.plattform)}</span>
        </div>
        <div class="card-meta">
          ${r.portionen ? `<span>${+r.portionen} Portionen</span>` : ''}
          ${r.kalorien_pro_portion ? `<span>${+r.kalorien_pro_portion} kcal</span>` : ''}
        </div>
        <div class="card-stars">${renderStars(r.bewertung)}</div>
        ${(r.tags || []).length ? `<div class="tags">${r.tags.map(t => `<span class="tag">${esc(t)}</span>`).join('')}</div>` : ''}
      </div>
    </div>
  `).join('');
  el.querySelectorAll('.card').forEach(c => c.addEventListener('click', () => openModal(+c.dataset.id)));
}

function renderTable(list) {
  document.getElementById('table-view').classList.remove('hidden');
  document.getElementById('grid-view').classList.add('hidden');
  const tbody = document.getElementById('table-body');
  if (!list.length) { tbody.innerHTML = '<tr><td colspan="5" style="color:var(--text-muted);padding:40px;text-align:center">Keine Rezepte gefunden.</td></tr>'; return; }
  tbody.innerHTML = list.map(r => `
    <tr data-id="${+r.id}">
      <td>${esc(r.titel)}</td>
      <td><span class="badge badge-${esc(r.plattform)}">${esc(r.plattform)}</span></td>
      <td>${r.kalorien_pro_portion != null ? +r.kalorien_pro_portion : '—'}</td>
      <td>${renderStars(r.bewertung)}</td>
      <td>${(r.tags || []).slice(0, 3).map(t => `<span class="tag">${esc(t)}</span>`).join(' ')}</td>
    </tr>
  `).join('');
  tbody.querySelectorAll('tr').forEach(row => row.addEventListener('click', () => openModal(+row.dataset.id)));
}

// ── Modal ─────────────────────────────────────────────────────
function openModal(id) {
  const r = allRezepte.find(x => x.id === id);
  if (!r) return;
  const origPortionen = r.portionen || 1;
  document.getElementById('modal-content').innerHTML = buildModal(r);
  document.getElementById('modal-overlay').classList.remove('hidden');

  const input = document.getElementById('portion-input');
  if (input) {
    updatePortions(r, 1, origPortionen);
    input.addEventListener('input', () => {
      const n = Math.max(1, parseInt(input.value) || 1);
      updatePortions(r, n, origPortionen);
    });
  }

  document.querySelectorAll('.star-btn').forEach(btn => {
    btn.addEventListener('click', () => setRating(+btn.dataset.id, +btn.dataset.rating));
  });
}

function buildModal(r) {
  const portionen = 1;
  const hasKcal = r.kalorien_pro_portion != null;
  const hasMakros = r.makros && (r.makros.fett || r.makros.kh || r.makros.eiweiss);
  const url = safeUrl(r.quelle_url);

  return `
    ${r.bild_url ? `<img class="modal-image" src="${esc(r.bild_url)}" alt="${esc(r.titel)}" />` : ''}
    <div class="modal-title">${esc(r.titel)}</div>
    <div class="modal-meta">
      <span class="badge badge-${esc(r.plattform)}">${esc(r.plattform)}</span>
      ${url ? `<a class="modal-link" href="${esc(url)}" target="_blank" rel="noopener noreferrer">Quelle ansehen ↗</a>` : ''}
    </div>
    <div class="modal-stars">
      ${Array.from({length: 5}, (_, i) =>
        `<button class="star-btn${r.bewertung && i < r.bewertung ? ' filled' : ''}" data-rating="${i+1}" data-id="${+r.id}">★</button>`
      ).join('')}
    </div>

    <div class="section-label">Portionsrechner</div>
    <div class="portion-row">
      <label>Portionen</label>
      <input id="portion-input" class="portion-input" type="number" min="1" value="${portionen}" />
      ${hasKcal ? `<div class="kcal-display"><strong id="kcal-total">${+r.kalorien_pro_portion * portionen}</strong> kcal gesamt</div>` : ''}
    </div>

    ${hasMakros ? `
    <div class="makros-row">
      <div class="makro-box"><div class="makro-val" id="m-fett">${(+r.makros.fett * portionen) || '—'}</div><div class="makro-label">Fett (g)</div></div>
      <div class="makro-box"><div class="makro-val" id="m-kh">${(+r.makros.kh * portionen) || '—'}</div><div class="makro-label">Kohlenhydrate (g)</div></div>
      <div class="makro-box"><div class="makro-val" id="m-eiweiss">${(+r.makros.eiweiss * portionen) || '—'}</div><div class="makro-label">Eiweiß (g)</div></div>
    </div>` : (!hasKcal ? `<p class="hint">Keine Nährwertangaben vorhanden.</p>` : '')}

    ${(r.zutaten || []).length ? `
    <div class="section-label">Zutaten <span id="zutaten-label" style="font-weight:400;text-transform:none;font-size:12px">(für ${portionen} Portionen)</span></div>
    <ul class="zutaten-list" id="zutaten-list">
      ${r.zutaten.map((z, i) => `
        <li>
          <span class="zutat-name">${esc(z.name)}</span>
          <span class="zutat-menge" data-orig="${esc(String(z.menge ?? ''))}" data-index="${i}">${esc(String(z.menge ?? ''))}</span>
        </li>`).join('')}
    </ul>` : ''}

    ${r.zubereitung ? `
    <div class="section-label">Zubereitung</div>
    <ol class="zubereitung-list">${formatZubereitung(r.zubereitung)}</ol>` : ''}
  `;
}

function updatePortions(r, newPortionen, origPortionen) {
  origPortionen = origPortionen || r.portionen || 1;
  const factor = newPortionen / origPortionen;

  const kcalEl = document.getElementById('kcal-total');
  if (kcalEl && r.kalorien_pro_portion) {
    kcalEl.textContent = Math.round(r.kalorien_pro_portion * newPortionen);
  }

  const makroIds = ['fett', 'kh', 'eiweiss'];
  if (r.makros) {
    makroIds.forEach(key => {
      const el = document.getElementById(`m-${key}`);
      if (el && r.makros[key]) el.textContent = Math.round(r.makros[key] * newPortionen * 10) / 10;
    });
  }

  const label = document.getElementById('zutaten-label');
  if (label) label.textContent = `(für ${newPortionen} Portionen)`;

  const modalContent = document.getElementById('modal-content');
  modalContent.querySelectorAll('[data-orig]').forEach(el => {
    el.textContent = scaleAmount(el.dataset.orig, factor);
  });
}

function formatZubereitung(text) {
  // Aufteilen nach "Schritt N:" oder "1." / "1)" Mustern
  const steps = text
    .split(/(?:Schritt\s*\d+[:.]?\s*|(?<!\d)(\d+)[.)]\s+)/i)
    .map(s => s && s.trim())
    .filter(s => s && s.length > 4 && !/^\d+$/.test(s));
  if (steps.length <= 1) {
    const sentences = text.split(/(?<=[.!?])\s+(?=[A-ZÄÖÜ])/);
    return sentences.map(s => `<li>${esc(s.trim())}</li>`).join('');
  }
  return steps.map(s => `<li>${esc(s)}</li>`).join('');
}

function renderStars(n) {
  return Array.from({length: 5}, (_, i) =>
    `<span class="star${n && i < n ? ' filled' : ''}">★</span>`
  ).join('');
}

async function setRating(id, n) {
  if (ratingPending) return;
  ratingPending = true;
  try {
    const r = allRezepte.find(x => x.id === id);
    // Klick auf bereits aktive Bewertung → unrate
    const newVal = (r && r.bewertung === n) ? null : n;
    await db.from('rezepte').update({ bewertung: newVal }).eq('id', id);
    if (r) r.bewertung = newVal;
    document.querySelectorAll('.star-btn').forEach((btn, i) => {
      btn.classList.toggle('filled', newVal != null && i < newVal);
    });
    render();
  } finally {
    ratingPending = false;
  }
}

function scaleAmount(menge, factor) {
  const match = menge.match(/^(\d+(?:[.,]\d+)?)(.*)/);
  if (!match) return menge;
  const num = parseFloat(match[1].replace(',', '.'));
  const unit = match[2];
  const scaled = Math.round(num * factor * 10) / 10;
  return `${scaled}${unit}`;
}

// ── Events ────────────────────────────────────────────────────
document.getElementById('modal-close').addEventListener('click', () => {
  document.getElementById('modal-overlay').classList.add('hidden');
});
document.getElementById('modal-overlay').addEventListener('click', e => {
  if (e.target === e.currentTarget) document.getElementById('modal-overlay').classList.add('hidden');
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    const overlay = document.getElementById('modal-overlay');
    if (!overlay.classList.contains('hidden')) overlay.classList.add('hidden');
  }
});

document.getElementById('btn-grid').addEventListener('click', () => {
  currentView = 'grid';
  document.getElementById('btn-grid').classList.add('active');
  document.getElementById('btn-table').classList.remove('active');
  render();
});
document.getElementById('btn-table').addEventListener('click', () => {
  currentView = 'table';
  document.getElementById('btn-table').classList.add('active');
  document.getElementById('btn-grid').classList.remove('active');
  render();
});

document.querySelectorAll('.chip[data-filter]').forEach(chip => {
  chip.addEventListener('click', () => {
    document.querySelectorAll('.chip[data-filter]').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    currentFilter = chip.dataset.filter;
    render();
  });
});

document.getElementById('btn-tags').addEventListener('click', () => {
  const bar = document.getElementById('tag-filter-bar');
  const btn = document.getElementById('btn-tags');
  const isOpen = !bar.classList.contains('hidden');
  if (isOpen) {
    activeTags.clear();
    bar.querySelectorAll('.tag-chip').forEach(c => c.classList.remove('active'));
    render();
  }
  bar.classList.toggle('hidden');
  btn.classList.toggle('active');
});

document.getElementById('btn-zutaten').addEventListener('click', () => {
  const bar = document.getElementById('zutaten-filter-bar');
  const btn = document.getElementById('btn-zutaten');
  const searchEl = document.getElementById('zutaten-search');
  const isOpen = !bar.classList.contains('hidden');
  if (isOpen) {
    activeZutaten.clear();
    zutatenChipFilter = '';
    if (searchEl) searchEl.value = '';
    renderZutatenFilter();
    render();
  }
  bar.classList.toggle('hidden');
  btn.classList.toggle('active');
  updateZutatenButtonLabel();
});

document.getElementById('zutaten-search').addEventListener('input', e => {
  zutatenChipFilter = e.target.value;
  renderZutatenFilter();
});

document.querySelectorAll('.chip[data-rating]').forEach(chip => {
  chip.addEventListener('click', () => {
    const val = +chip.dataset.rating;
    if (currentRatingFilter === val) {
      currentRatingFilter = 0;
      chip.classList.remove('active');
    } else {
      document.querySelectorAll('.chip[data-rating]').forEach(c => c.classList.remove('active'));
      currentRatingFilter = val;
      chip.classList.add('active');
    }
    render();
  });
});

let searchTimeout;
document.getElementById('search').addEventListener('input', e => {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(() => { currentSearch = e.target.value; render(); }, 200);
});

init();
