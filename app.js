// 해외학회 & 가족여행 플래너 — 정적 PWA, 모든 개인 데이터는 localStorage에 저장
'use strict';

const LS_KEY = 'confplanner.v1';
const DEFAULT_CHECKLIST = [
  '초록 제출', '출장/연가 승인', '학회 등록·결제', '항공권 예약',
  '숙소 예약', '비자/ESTA', '발표자료 준비', '여행자보험'
];

let DATA = { fields: [], conferences: [] };
let FIELD_MAP = {};
let store = load();

function load() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) { const s = JSON.parse(raw); if (!Array.isArray(s.custom)) s.custom = []; return s; }
  } catch (e) { /* ignore */ }
  return { conf: {}, family: '', savedAt: null, custom: [] };
}
// 시드 학회(conferences.json) + 사용자가 직접 추가한 학회
function allConfs() { return DATA.conferences.concat(store.custom || []); }
function save() {
  store.savedAt = new Date().toISOString();
  localStorage.setItem(LS_KEY, JSON.stringify(store));
}
// 학회별 개인 데이터 접근 (없으면 생성)
function cs(id) {
  if (!store.conf[id]) {
    store.conf[id] = {
      interest: 0, attending: false,
      checklist: {}, notes: '', budget: '',
      travel: { enabled: false, from: '', to: '', members: '', todos: '', budget: '', notes: '' }
    };
  }
  return store.conf[id];
}

/* ---------- 날짜/상태 유틸 ---------- */
function today() { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }
function parse(d) { return d ? new Date(d + 'T00:00:00') : null; }
function fmt(d) {
  const dt = parse(d); if (!dt) return '';
  return `${dt.getFullYear()}.${String(dt.getMonth() + 1).padStart(2, '0')}.${String(dt.getDate()).padStart(2, '0')}`;
}
function daysUntil(d) {
  const dt = parse(d); if (!dt) return null;
  return Math.round((dt - today()) / 86400000);
}
function ddayLabel(d) {
  const n = daysUntil(d);
  if (n === null) return '';
  if (n === 0) return 'D-DAY';
  return n > 0 ? `D-${n}` : `D+${-n}`;
}
function confStatus(c) {
  const endDays = daysUntil(c.end);
  if (endDays !== null && endDays < 0) return 'done';
  const startDays = daysUntil(c.start);
  if (startDays !== null && startDays <= 90) return 'soon';
  return 'upcoming';
}
function statusText(s) { return { done: '종료', soon: '임박', upcoming: '예정' }[s] || ''; }

/* ---------- 초기화 ---------- */
async function init() {
  try {
    const res = await fetch('data/conferences.json?' + Date.now());
    DATA = await res.json();
  } catch (e) {
    document.getElementById('listWrap').innerHTML = '<p class="empty">학회 데이터를 불러오지 못했습니다.</p>';
    return;
  }
  DATA.fields.forEach(f => FIELD_MAP[f.key] = f);
  buildFilters();
  document.getElementById('familyMembers').value = store.family || '';
  initTheme();
  bindEvents();
  renderAll();
}

/* ---------- 테마(라이트/다크) ---------- */
const THEME_KEY = 'confplanner.theme';
function resolvedTheme() {
  const t = document.documentElement.getAttribute('data-theme');
  if (t === 'light' || t === 'dark') return t;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}
function updateThemeBtn() {
  const btn = document.getElementById('btnTheme');
  if (!btn) return;
  const cur = resolvedTheme();
  btn.textContent = cur === 'dark' ? '☀️' : '🌙';
  btn.title = cur === 'dark' ? '라이트 모드로 전환' : '다크 모드로 전환';
}
function initTheme() {
  updateThemeBtn();
  // 사용자가 명시적으로 고르지 않았을 땐 시스템 설정 변화를 따라 아이콘만 갱신
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    let saved = null;
    try { saved = localStorage.getItem(THEME_KEY); } catch (e) { /* ignore */ }
    if (saved !== 'light' && saved !== 'dark') updateThemeBtn();
  });
}
function toggleTheme() {
  const next = resolvedTheme() === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  try { localStorage.setItem(THEME_KEY, next); } catch (e) { /* ignore */ }
  updateThemeBtn();
}

// 필터 드롭다운을 (재)구성 — 직접 추가로 국가·연도가 늘면 다시 호출. 선택값은 유지.
function buildFilters() {
  const list = allConfs();

  const ff = document.getElementById('fField');
  const ffPrev = ff.value; ff.length = 1;
  DATA.fields.forEach(f => {
    const o = document.createElement('option'); o.value = f.key; o.textContent = f.label; ff.appendChild(o);
  });
  ff.value = ffPrev;

  const fc = document.getElementById('fCountry');
  const fcPrev = fc.value; fc.length = 1;
  const counts = {};
  list.forEach(c => { counts[c.country] = (counts[c.country] || 0) + 1; });
  [...new Set(list.map(c => c.country))]
    .sort((a, b) => a.localeCompare(b, 'ko'))
    .forEach(ct => {
      const o = document.createElement('option'); o.value = ct;
      o.textContent = `${ct} (${counts[ct]})`; fc.appendChild(o);
    });
  fc.value = fcPrev;

  const fy = document.getElementById('fYear');
  const fyPrev = fy.value; fy.length = 1;
  [...new Set(list.map(c => c.year))].sort()
    .forEach(y => { const o = document.createElement('option'); o.value = y; o.textContent = y + '년'; fy.appendChild(o); });
  fy.value = fyPrev;
}

function bindEvents() {
  document.getElementById('tabs').addEventListener('click', e => {
    const t = e.target.closest('.tab'); if (!t) return;
    document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
    document.querySelectorAll('.tabpane').forEach(x => x.classList.remove('active'));
    t.classList.add('active');
    document.getElementById('tab-' + t.dataset.tab).classList.add('active');
    renderAll();
  });
  ['q', 'fField', 'fCountry', 'fYear', 'fStatus', 'sort'].forEach(id =>
    document.getElementById(id).addEventListener('input', renderList));
  document.getElementById('familyMembers').addEventListener('input', e => {
    store.family = e.target.value; save();
  });
  document.getElementById('btnTheme').addEventListener('click', toggleTheme);
  document.getElementById('btnAddConf').addEventListener('click', () => openConfModal());
  document.getElementById('btnSync').addEventListener('click', async () => {
    try {
      const res = await fetch('data/conferences.json?' + Date.now(), { cache: 'no-store' });
      DATA = await res.json(); FIELD_MAP = {}; DATA.fields.forEach(f => FIELD_MAP[f.key] = f);
      buildFilters(); renderAll(); toast('학회 데이터를 새로고침했습니다');
    } catch (e) { toast('새로고침 실패'); }
  });
  document.getElementById('btnExport').addEventListener('click', exportData);
  document.getElementById('btnImport').addEventListener('click', () => document.getElementById('importFile').click());
  document.getElementById('importFile').addEventListener('change', importData);
  document.getElementById('modalClose').addEventListener('click', closeModal);
  document.getElementById('modal').addEventListener('click', e => { if (e.target.id === 'modal') closeModal(); });
}

function renderAll() { renderList(); renderPlan(); renderTravel(); renderTimeline(); }

/* ---------- 학회 리스트 ---------- */
function renderList() {
  const q = document.getElementById('q').value.trim().toLowerCase();
  const ff = document.getElementById('fField').value;
  const fc = document.getElementById('fCountry').value;
  const fy = document.getElementById('fYear').value;
  const fs = document.getElementById('fStatus').value;
  const sort = document.getElementById('sort').value;

  let list = allConfs().filter(c => {
    if (ff && c.field !== ff) return false;
    if (fc && c.country !== fc) return false;
    if (fy && String(c.year) !== fy) return false;
    if (q) {
      const hay = (c.name + ' ' + c.abbr + ' ' + c.city + ' ' + c.country).toLowerCase();
      if (!hay.includes(q)) return false;
    }
    const st = confStatus(c);
    if (fs === 'upcoming' && st === 'done') return false;
    if (fs === 'interested' && cs(c.id).interest < 1) return false;
    return true;
  });

  list.sort((a, b) => {
    if (sort === 'interest') {
      const d = cs(b.id).interest - cs(a.id).interest;
      if (d !== 0) return d;
    }
    if (sort === 'country') {
      const d = a.country.localeCompare(b.country, 'ko');
      if (d !== 0) return d;
    }
    return (a.start || '').localeCompare(b.start || '');
  });

  const wrap = document.getElementById('listWrap');
  if (!list.length) { wrap.innerHTML = '<p class="empty">조건에 맞는 학회가 없습니다.</p>'; return; }
  wrap.innerHTML = list.map(cardHTML).join('');
  wrap.querySelectorAll('.card').forEach(bindCard);
}

function cardHTML(c) {
  const f = FIELD_MAP[c.field] || { label: c.field, color: '#64748b' };
  const st = confStatus(c);
  const s = cs(c.id);
  const dd = ddayLabel(c.start);
  const ddCls = st === 'done' ? 'past' : (st === 'soon' ? 'soon' : '');
  const stars = [1, 2, 3, 4, 5].map(n =>
    `<span class="star ${n <= s.interest ? 'on' : ''}" data-star="${n}">★</span>`).join('');
  const abDl = c.abstractDeadline
    ? `<div class="meta">📝 초록마감 <strong>${fmt(c.abstractDeadline)}</strong> <span class="dday ${daysUntil(c.abstractDeadline) < 0 ? 'past' : (daysUntil(c.abstractDeadline) <= 30 ? 'soon' : '')}">${ddayLabel(c.abstractDeadline)}</span></div>`
    : '';
  const erDl = c.earlyDeadline
    ? `<div class="meta">💳 얼리버드 <strong>${fmt(c.earlyDeadline)}</strong> <span class="dday ${daysUntil(c.earlyDeadline) < 0 ? 'past' : (daysUntil(c.earlyDeadline) <= 30 ? 'soon' : '')}">${ddayLabel(c.earlyDeadline)}</span></div>`
    : '';
  return `
  <div class="card" data-id="${c.id}" style="border-left-color:${f.color}">
    <div class="badge-row">
      <span class="field-badge" style="background:${f.color}">${f.label}</span>
      <span class="status-badge status-${st}">${statusText(st)}</span>
      ${!c.official ? '<span class="est-badge">추정/미확정</span>' : ''}
      ${c.custom ? '<span class="custom-badge">직접추가</span>' : ''}
      <span class="spacer"></span>
      <span class="dday ${ddCls}">${dd}</span>
    </div>
    <div class="abbr">${c.abbr}</div>
    <h3>${c.name}</h3>
    <div class="meta">📍 <strong>${c.city}</strong>, ${c.country} · ${c.region}</div>
    <div class="meta">🗓 <strong>${fmt(c.start)} – ${fmt(c.end)}</strong></div>
    ${abDl}${erDl}
    ${c.note ? `<div class="note">${c.note}</div>` : ''}
    <div class="card-actions">
      <div class="stars" title="관심도">${stars}</div>
      <span class="spacer"></span>
      ${c.custom ? '<button class="mini edit-conf">수정</button>' : ''}
      <button class="mini attend ${s.attending ? 'on' : ''}">${s.attending ? '✔ 방문 예정' : '방문 예정'}</button>
      ${c.url ? `<a class="mini link" href="${c.url}" target="_blank" rel="noopener">🔗</a>` : ''}
    </div>
  </div>`;
}

function bindCard(card) {
  const id = card.dataset.id;
  card.querySelectorAll('.star').forEach(st => {
    st.addEventListener('click', () => {
      const n = +st.dataset.star;
      const cur = cs(id);
      cur.interest = (cur.interest === n) ? 0 : n; // 같은 별 다시 누르면 해제
      save(); renderList();
    });
  });
  const editBtn = card.querySelector('.edit-conf');
  if (editBtn) editBtn.addEventListener('click', () => openConfModal(id));
  card.querySelector('.attend').addEventListener('click', () => {
    const cur = cs(id);
    cur.attending = !cur.attending;
    if (cur.attending && Object.keys(cur.checklist).length === 0) {
      DEFAULT_CHECKLIST.forEach(item => cur.checklist[item] = false);
    }
    save(); renderList(); renderPlan(); renderTravel();
    toast(cur.attending ? '방문 예정에 추가했습니다' : '방문 예정에서 제외했습니다');
  });
}

/* ---------- 방문 준비 ---------- */
function attendingConfs() {
  return allConfs()
    .filter(c => cs(c.id).attending)
    .sort((a, b) => (a.start || '').localeCompare(b.start || ''));
}

function renderPlan() {
  const wrap = document.getElementById('planWrap');
  const list = attendingConfs();
  if (!list.length) {
    wrap.innerHTML = '<p class="empty">아직 방문 예정 학회가 없습니다.<br>「학회」탭에서 <b>방문 예정</b>을 눌러 추가하세요.</p>';
    return;
  }
  wrap.innerHTML = list.map(planCardHTML).join('');
  list.forEach(c => bindPlanCard(c.id));
}

function planCardHTML(c) {
  const f = FIELD_MAP[c.field] || { color: '#64748b' };
  const s = cs(c.id);
  const items = Object.keys(s.checklist).length ? Object.keys(s.checklist) : DEFAULT_CHECKLIST;
  const doneN = items.filter(i => s.checklist[i]).length;
  const pct = Math.round(doneN / items.length * 100);
  const lis = items.map((item, i) =>
    `<li class="${s.checklist[item] ? 'done' : ''}">
       <input type="checkbox" id="ck-${c.id}-${i}" data-item="${encodeURIComponent(item)}" ${s.checklist[item] ? 'checked' : ''}>
       <label for="ck-${c.id}-${i}">${item}</label>
     </li>`).join('');
  return `
  <div class="card" data-id="${c.id}" style="border-left-color:${f.color}">
    <div class="badge-row">
      <span class="abbr">${c.abbr}</span>
      <span class="spacer"></span>
      <span class="dday ${daysUntil(c.start) < 0 ? 'past' : (daysUntil(c.start) <= 90 ? 'soon' : '')}">${ddayLabel(c.start)}</span>
    </div>
    <div class="meta">📍 ${c.city}, ${c.country} · 🗓 ${fmt(c.start)}–${fmt(c.end)}</div>
    <div class="progress"><span style="width:${pct}%"></span></div>
    <div class="meta">준비 ${doneN}/${items.length} (${pct}%)</div>
    <ul class="checklist">${lis}</ul>
    <label class="small">➕ 항목 추가</label>
    <div style="display:flex;gap:6px">
      <input class="field-input add-item" placeholder="예: 학회 만찬 예약" style="margin-top:6px">
      <button class="mini add-item-btn" style="margin-top:6px">추가</button>
    </div>
    <label class="small">💰 예산 메모</label>
    <input class="field-input budget" value="${esc(s.budget)}" placeholder="예: 등록 $700 / 항공 180만 / 호텔 5박">
    <label class="small">📝 메모</label>
    <textarea class="field-textarea notes" placeholder="세션, 미팅, 준비 메모">${esc(s.notes)}</textarea>
  </div>`;
}

function bindPlanCard(id) {
  const card = document.querySelector(`#planWrap .card[data-id="${id}"]`);
  if (!card) return;
  const s = cs(id);
  card.querySelectorAll('.checklist input').forEach(ck => {
    ck.addEventListener('change', () => {
      const item = decodeURIComponent(ck.dataset.item);
      s.checklist[item] = ck.checked; save(); renderPlan();
    });
  });
  const addBtn = card.querySelector('.add-item-btn');
  const addInput = card.querySelector('.add-item');
  const doAdd = () => {
    const v = addInput.value.trim(); if (!v) return;
    s.checklist[v] = false; save(); renderPlan();
  };
  addBtn.addEventListener('click', doAdd);
  addInput.addEventListener('keydown', e => { if (e.key === 'Enter') doAdd(); });
  card.querySelector('.budget').addEventListener('input', e => { s.budget = e.target.value; save(); });
  card.querySelector('.notes').addEventListener('input', e => { s.notes = e.target.value; save(); });
}

/* ---------- 가족여행 ---------- */
function renderTravel() {
  const wrap = document.getElementById('travelWrap');
  const list = attendingConfs();
  if (!list.length) {
    wrap.innerHTML = '<p class="empty">방문 예정 학회를 먼저 정하면<br>학회별 가족여행을 계획할 수 있습니다.</p>';
    return;
  }
  wrap.innerHTML = list.map(travelCardHTML).join('');
  list.forEach(c => bindTravelCard(c.id));
}

function travelCardHTML(c) {
  const f = FIELD_MAP[c.field] || { color: '#64748b' };
  const s = cs(c.id);
  const t = s.travel;
  const on = t.enabled;
  return `
  <div class="card" data-id="${c.id}" style="border-left-color:${f.color}">
    <div class="badge-row">
      <span class="abbr">${c.abbr}</span> — <span style="font-size:12px;color:var(--txt2)">${c.city}, ${c.country}</span>
      <span class="spacer"></span>
      <button class="mini travel-toggle ${on ? 'on' : ''}">${on ? '✔ 여행 계획' : '여행 붙이기'}</button>
    </div>
    <div class="meta">학회 🗓 ${fmt(c.start)}–${fmt(c.end)}</div>
    ${on ? `
    <label class="small">✈ 여행 기간</label>
    <div style="display:flex;gap:6px">
      <input type="date" class="field-input tfrom" value="${esc(t.from)}">
      <input type="date" class="field-input tto" value="${esc(t.to)}">
    </div>
    <label class="small">👨‍👩‍👧‍👦 동행 (비우면 상단 기본값)</label>
    <input class="field-input tmembers" value="${esc(t.members)}" placeholder="${esc(store.family) || '동행 가족'}">
    <label class="small">✅ 여행 할 일 (한 줄에 하나)</label>
    <textarea class="field-textarea ttodos" placeholder="숙소 예약&#10;아이 여권 확인&#10;디즈니랜드 티켓&#10;렌터카">${esc(t.todos)}</textarea>
    <label class="small">💰 여행 예산</label>
    <input class="field-input tbudget" value="${esc(t.budget)}" placeholder="예: 항공 5인 / 호텔 / 관광 총 ○○만원">
    <label class="small">📝 메모</label>
    <textarea class="field-textarea tnotes" placeholder="아이 학교 일정, 시차, 맛집 등">${esc(t.notes)}</textarea>
    ` : '<div class="note">「여행 붙이기」를 누르면 이 학회 일정에 맞춘 가족여행을 계획합니다.</div>'}
  </div>`;
}

function bindTravelCard(id) {
  const card = document.querySelector(`#travelWrap .card[data-id="${id}"]`);
  if (!card) return;
  const s = cs(id);
  card.querySelector('.travel-toggle').addEventListener('click', () => {
    s.travel.enabled = !s.travel.enabled;
    // 여행 기간 기본값: 학회 종료 다음날부터
    if (s.travel.enabled && !s.travel.from) {
      const c = allConfs().find(x => x.id === id);
      if (c) { s.travel.from = c.start; s.travel.to = c.end; }
    }
    save(); renderTravel();
  });
  const map = { '.tfrom': 'from', '.tto': 'to', '.tmembers': 'members', '.ttodos': 'todos', '.tbudget': 'budget', '.tnotes': 'notes' };
  Object.entries(map).forEach(([sel, key]) => {
    const el = card.querySelector(sel);
    if (el) el.addEventListener('input', e => { s.travel[key] = e.target.value; save(); });
  });
}

/* ---------- 타임라인 ---------- */
function renderTimeline() {
  const wrap = document.getElementById('calWrap');
  const events = [];
  allConfs().forEach(c => {
    if (confStatus(c) === 'done') return;
    events.push({ date: c.start, type: 'event', label: `${c.abbr} 개막`, sub: `${c.city}, ${c.country}` });
    if (c.abstractDeadline && daysUntil(c.abstractDeadline) >= 0)
      events.push({ date: c.abstractDeadline, type: 'deadline', label: `${c.abbr} 초록 마감`, sub: '' });
    if (c.earlyDeadline && daysUntil(c.earlyDeadline) >= 0)
      events.push({ date: c.earlyDeadline, type: 'deadline', label: `${c.abbr} 얼리버드 마감`, sub: '' });
  });
  events.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  if (!events.length) { wrap.innerHTML = '<p class="empty">다가오는 일정이 없습니다.</p>'; return; }
  wrap.innerHTML = events.map(e => `
    <div class="tl-item ${e.type === 'deadline' ? 'deadline' : ''}">
      <div class="tl-date">${fmt(e.date)}<br><span style="font-size:11px">${ddayLabel(e.date)}</span></div>
      <div class="tl-body">
        ${e.label}<span class="tl-tag ${e.type === 'deadline' ? 'tag-deadline' : 'tag-event'}">${e.type === 'deadline' ? '마감' : '학회'}</span>
        ${e.sub ? `<div style="font-size:11px;color:var(--txt2)">${e.sub}</div>` : ''}
      </div>
    </div>`).join('');
}

/* ---------- 학회 직접 추가/수정/삭제 ---------- */
const REGIONS = ['아시아', '유럽', '북미', '남미', '오세아니아', '아프리카', '중동', '기타'];
function openConfModal(editId) {
  const c = editId ? (store.custom || []).find(x => x.id === editId) : null;
  const fieldOpts = DATA.fields.map(f =>
    `<option value="${f.key}" ${c && c.field === f.key ? 'selected' : ''}>${f.label}</option>`).join('');
  const regionOpts = REGIONS.map(r =>
    `<option value="${r}" ${c && c.region === r ? 'selected' : ''}>${r}</option>`).join('');
  document.getElementById('modalBody').innerHTML = `
    <h2>${c ? '학회 수정' : '학회 직접 추가'}</h2>
    <label class="small">학회명 *</label>
    <input class="field-input" id="cfName" value="${esc(c && c.name)}" placeholder="예: Asian Society of Clinical Pathology and Laboratory Medicine">
    <label class="small">약칭</label>
    <input class="field-input" id="cfAbbr" value="${esc(c && c.abbr)}" placeholder="예: ASCPaLM 2026">
    <label class="small">분야</label>
    <select class="field-input" id="cfField">${fieldOpts}</select>
    <div class="cf-row">
      <div><label class="small">도시</label><input class="field-input" id="cfCity" value="${esc(c && c.city)}" placeholder="예: Taipei"></div>
      <div><label class="small">국가 *</label><input class="field-input" id="cfCountry" value="${esc(c && c.country)}" placeholder="예: 대만"></div>
    </div>
    <label class="small">지역</label>
    <select class="field-input" id="cfRegion">${regionOpts}</select>
    <div class="cf-row">
      <div><label class="small">시작일 *</label><input type="date" class="field-input" id="cfStart" value="${esc(c && c.start)}"></div>
      <div><label class="small">종료일</label><input type="date" class="field-input" id="cfEnd" value="${esc(c && c.end)}"></div>
    </div>
    <div class="cf-row">
      <div><label class="small">초록 마감</label><input type="date" class="field-input" id="cfAbs" value="${esc(c && c.abstractDeadline)}"></div>
      <div><label class="small">얼리버드 마감</label><input type="date" class="field-input" id="cfEarly" value="${esc(c && c.earlyDeadline)}"></div>
    </div>
    <label class="small">공식 URL</label>
    <input class="field-input" id="cfUrl" value="${esc(c && c.url)}" placeholder="https://...">
    <label class="small">메모</label>
    <textarea class="field-textarea" id="cfNote" placeholder="장소·세부 일정·비고">${esc(c && c.note)}</textarea>
    <button class="btn-primary" id="cfSave">${c ? '수정 저장' : '추가'}</button>
    ${c ? '<button class="btn-danger" id="cfDelete">이 학회 삭제</button>' : ''}
  `;
  document.getElementById('modal').classList.remove('hidden');
  document.getElementById('cfSave').addEventListener('click', () => saveConf(editId));
  const del = document.getElementById('cfDelete');
  if (del) del.addEventListener('click', () => deleteConf(editId));
}

function saveConf(editId) {
  const val = id => document.getElementById(id).value.trim();
  const name = val('cfName'), country = val('cfCountry'), start = val('cfStart');
  if (!name || !country || !start) { toast('학회명·국가·시작일은 필수입니다'); return; }
  const obj = {
    id: editId || ('custom-' + Date.now().toString(36)),
    name, abbr: val('cfAbbr') || name, field: val('cfField'),
    city: val('cfCity'), country, region: val('cfRegion'),
    start, end: val('cfEnd') || start, year: +start.slice(0, 4),
    abstractDeadline: val('cfAbs') || null,
    earlyDeadline: val('cfEarly') || null,
    url: val('cfUrl'), note: val('cfNote'),
    official: true, custom: true
  };
  if (!Array.isArray(store.custom)) store.custom = [];
  const idx = store.custom.findIndex(x => x.id === obj.id);
  if (idx >= 0) store.custom[idx] = obj; else store.custom.push(obj);
  save(); buildFilters(); renderAll(); closeModal();
  toast(editId ? '학회를 수정했습니다' : '학회를 추가했습니다');
}

function deleteConf(id) {
  store.custom = (store.custom || []).filter(x => x.id !== id);
  delete store.conf[id];
  save(); buildFilters(); renderAll(); closeModal();
  toast('학회를 삭제했습니다');
}

/* ---------- 백업/복원 ---------- */
function exportData() {
  const blob = new Blob([JSON.stringify(store, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `학회플래너_백업_${fmt(new Date().toISOString().slice(0, 10)).replace(/\./g, '')}.json`;
  a.click();
  toast('백업 파일을 저장했습니다');
}
function importData(e) {
  const file = e.target.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const obj = JSON.parse(reader.result);
      if (!obj.conf) throw new Error('형식 오류');
      if (!Array.isArray(obj.custom)) obj.custom = [];
      store = obj; save();
      document.getElementById('familyMembers').value = store.family || '';
      renderAll(); toast('복원했습니다');
    } catch (err) { toast('복원 실패: 올바른 백업 파일이 아닙니다'); }
  };
  reader.readAsText(file);
  e.target.value = '';
}

/* ---------- 기타 ---------- */
function esc(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function closeModal() { document.getElementById('modal').classList.add('hidden'); }
let toastTimer;
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), 2200);
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
init();
