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
  persist();
  scheduleSync();
}
function persist() { localStorage.setItem(LS_KEY, JSON.stringify(store)); }
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
  updateSyncBtn();
  if (syncCfg().githubToken) syncNow(true); // 앱 열 때 최신본 받아오기
}

function updateSyncBtn() {
  const btn = document.getElementById('btnSyncCloud');
  if (btn) btn.title = syncCfg().githubToken ? '기기 간 동기화' : '기기 간 동기화 설정';
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
  document.getElementById('btnSyncCloud').addEventListener('click', () => openSyncModal());
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
    <div class="abbr">${esc(c.abbr)}</div>
    <h3>${esc(c.name)}</h3>
    <div class="meta">📍 <strong>${esc(c.city)}</strong>, ${esc(c.country)} · ${esc(c.region)}</div>
    <div class="meta">🗓 <strong>${fmt(c.start)} – ${fmt(c.end)}</strong></div>
    ${abDl}${erDl}
    ${c.note ? `<div class="note">${esc(c.note)}</div>` : ''}
    <div class="card-actions">
      <div class="stars" title="관심도">${stars}</div>
      <span class="spacer"></span>
      ${c.custom ? '<button class="mini edit-conf">수정</button>' : ''}
      <button class="mini attend ${s.attending ? 'on' : ''}">${s.attending ? '✔ 방문 예정' : '방문 예정'}</button>
      ${c.url ? `<a class="mini link" href="${esc(c.url)}" target="_blank" rel="noopener">🔗</a>` : ''}
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
      <span class="abbr">${esc(c.abbr)}</span>
      <span class="spacer"></span>
      <span class="dday ${daysUntil(c.start) < 0 ? 'past' : (daysUntil(c.start) <= 90 ? 'soon' : '')}">${ddayLabel(c.start)}</span>
    </div>
    <div class="meta">📍 ${esc(c.city)}, ${esc(c.country)} · 🗓 ${fmt(c.start)}–${fmt(c.end)}</div>
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
      <span class="abbr">${esc(c.abbr)}</span> — <span style="font-size:12px;color:var(--txt2)">${esc(c.city)}, ${esc(c.country)}</span>
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
        ${esc(e.label)}<span class="tl-tag ${e.type === 'deadline' ? 'tag-deadline' : 'tag-event'}">${e.type === 'deadline' ? '마감' : '학회'}</span>
        ${e.sub ? `<div style="font-size:11px;color:var(--txt2)">${esc(e.sub)}</div>` : ''}
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
    <label class="small">공식 URL</label>
    <div class="cf-url-row">
      <input class="field-input" id="cfUrl" value="${esc(c && c.url)}" placeholder="https://학회-공식사이트..." inputmode="url">
      <button type="button" class="btn-fetch" id="cfFetch">정보 가져오기</button>
    </div>
    <p class="cf-fetch-status" id="cfFetchStatus">공식 링크를 붙여넣으면 아래 항목을 자동으로 채웁니다.</p>
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
    <label class="small">메모</label>
    <textarea class="field-textarea" id="cfNote" placeholder="장소·세부 일정·비고">${esc(c && c.note)}</textarea>
    <button class="btn-primary" id="cfSave">${c ? '수정 저장' : '추가'}</button>
    ${c ? '<button class="btn-danger" id="cfDelete">이 학회 삭제</button>' : ''}
  `;
  document.getElementById('modal').classList.remove('hidden');
  document.getElementById('cfSave').addEventListener('click', () => saveConf(editId));
  document.getElementById('cfFetch').addEventListener('click', fetchConferenceInfo);
  document.getElementById('cfUrl').addEventListener('paste', () => setTimeout(() => {
    if (!document.getElementById('cfName').value.trim()) fetchConferenceInfo();
  }, 0));
  const del = document.getElementById('cfDelete');
  if (del) del.addEventListener('click', () => deleteConf(editId));
}

async function fetchConferenceInfo() {
  const urlInput = document.getElementById('cfUrl');
  const status = document.getElementById('cfFetchStatus');
  const button = document.getElementById('cfFetch');
  let url = urlInput.value.trim();
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  try { url = new URL(url).href; } catch (_) {
    status.textContent = '올바른 웹 주소를 입력해 주세요.';
    status.className = 'cf-fetch-status error';
    return;
  }
  urlInput.value = url;
  button.disabled = true;
  button.textContent = '읽는 중…';
  status.textContent = '공식 페이지에서 학회 정보를 확인하고 있습니다.';
  status.className = 'cf-fetch-status loading';
  try {
    const page = await readConferencePage(url);
    const info = parseConferencePage(page, url);
    const filled = applyConferenceInfo(info);
    if (!filled) throw new Error('recognition');
    status.textContent = `${filled}개 항목을 채웠습니다. 날짜와 장소를 확인한 뒤 저장해 주세요.`;
    status.className = 'cf-fetch-status success';
  } catch (_) {
    status.textContent = '이 사이트에서는 정보를 자동으로 읽지 못했습니다. URL은 유지되므로 나머지만 입력해 주세요.';
    status.className = 'cf-fetch-status error';
  } finally {
    button.disabled = false;
    button.textContent = '정보 가져오기';
  }
}

async function readConferencePage(url) {
  try {
    const direct = await fetch(url, { mode: 'cors' });
    if (direct.ok) return { text: await direct.text(), html: true };
  } catch (_) {}
  const readerUrl = 'https://api.microlink.io/?url=' + encodeURIComponent(url);
  const res = await fetch(readerUrl, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error('fetch');
  const payload = await res.json();
  if (payload.status !== 'success' || !payload.data) throw new Error('metadata');
  const d = payload.data;
  return {
    text: `Title: ${d.title || ''}\nDescription: ${d.description || ''}\n${d.publisher || ''}\n${d.url || url}`,
    html: false
  };
}

function parseConferencePage(page, url) {
  let title = '', description = '', text = page.text;
  if (page.html) {
    const doc = new DOMParser().parseFromString(page.text, 'text/html');
    title = doc.querySelector('meta[property="og:title"]')?.content || doc.title || '';
    description = doc.querySelector('meta[property="og:description"],meta[name="description"]')?.content || '';
    text = doc.body?.innerText || text;
  } else {
    title = (text.match(/^Title:\s*(.+)$/mi) || text.match(/^#\s+(.+)$/m) || [])[1] || '';
    description = (text.match(/^Description:\s*(.+)$/mi) || [])[1] || '';
  }
  const compact = (title + '\n' + description + '\n' + text).replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ');
  const dates = extractConferenceDates(compact);
  const place = extractConferencePlace(compact);
  const cleanTitle = cleanConferenceTitle(title || new URL(url).hostname.replace(/^www\./, ''));
  return {
    name: cleanTitle,
    abbr: inferAbbr(cleanTitle, dates.start),
    start: dates.start,
    end: dates.end,
    city: place.city,
    country: place.country,
    region: regionForCountry(place.country),
    field: inferField(compact),
    note: description.slice(0, 300)
  };
}

function extractConferenceDates(text) {
  const iso = [...text.matchAll(/\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/g)]
    .map(m => `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`);
  if (iso.length) return { start: iso[0], end: iso[1] || iso[0] };
  const months = { january:1,february:2,march:3,april:4,may:5,june:6,july:7,august:8,september:9,october:10,november:11,december:12,
    jan:1,feb:2,mar:3,apr:4,jun:6,jul:7,aug:8,sep:9,sept:9,oct:10,nov:11,dec:12 };
  const monthRange = text.match(/\b(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\.?\s+(\d{1,2})(?:\s*[-–—]\s*(?:(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\.?\s*)?(\d{1,2}))?,?\s+(20\d{2})/i);
  if (monthRange) {
    const sm = months[monthRange[1].toLowerCase()], em = months[(monthRange[3] || monthRange[1]).toLowerCase()];
    const start = `${monthRange[5]}-${String(sm).padStart(2,'0')}-${monthRange[2].padStart(2,'0')}`;
    const end = `${monthRange[5]}-${String(em).padStart(2,'0')}-${(monthRange[4] || monthRange[2]).padStart(2,'0')}`;
    return { start, end };
  }
  const dayFirst = text.match(/\b(\d{1,2})\s*[-–—]\s*(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(20\d{2})/i);
  if (dayFirst) {
    const m = months[dayFirst[3].toLowerCase()], prefix = `${dayFirst[4]}-${String(m).padStart(2,'0')}-`;
    return { start: prefix + dayFirst[1].padStart(2,'0'), end: prefix + dayFirst[2].padStart(2,'0') };
  }
  return { start: '', end: '' };
}

const COUNTRY_HINTS = [
  ['미국','USA|United States|U\\.S\\.A'],['캐나다','Canada'],['영국','United Kingdom|UK|England|Scotland|Wales'],
  ['스페인','Spain'],['프랑스','France'],['독일','Germany'],['이탈리아','Italy'],['스웨덴','Sweden'],['덴마크','Denmark'],
  ['네덜란드','Netherlands'],['포르투갈','Portugal'],['스위스','Switzerland'],['오스트리아','Austria'],
  ['일본','Japan'],['대만','Taiwan'],['중국','China'],['홍콩','Hong Kong'],['싱가포르','Singapore'],['인도','India'],
  ['말레이시아','Malaysia'],['필리핀','Philippines'],['태국','Thailand'],['한국','Korea|Seoul|Busan'],
  ['호주','Australia'],['뉴질랜드','New Zealand'],['브라질','Brazil'],['멕시코','Mexico'],['아랍에미리트','United Arab Emirates|UAE|Dubai']
];
function extractConferencePlace(text) {
  let country = '';
  for (const [ko, pattern] of COUNTRY_HINTS) if (new RegExp(`\\b(?:${pattern})\\b`, 'i').test(text)) { country = ko; break; }
  const locationLine = text.match(/(?:location|venue|place|held in|개최지|장소)\s*[:：-]?\s*([^\n|]{2,100})/i);
  let city = '';
  if (locationLine) city = locationLine[1].split(/,|\s[-–—]\s/)[0].replace(/[*#_[\]()]/g, '').trim();
  return { city, country };
}

function cleanConferenceTitle(title) {
  return title.replace(/^Title:\s*/i, '').replace(/\s*[|–—-]\s*(Home|Official Site|Welcome).*$/i, '').trim().slice(0, 180);
}
function inferAbbr(name, start) {
  const known = name.match(/\b[A-Z][A-Z0-9]{2,9}\b/);
  const year = (start || name).match(/20\d{2}/)?.[0] || '';
  return known ? `${known[0]}${year && !name.includes(year) ? ' ' + year : ''}` : '';
}
function inferField(text) {
  const s = text.toLowerCase();
  const rules = [['thromb',/thrombo|hemosta|haemosta|hemophil/],['lab-heme',/laboratory hematology|haematology analyzer/],
    ['heme',/hematol|haematol|myeloma|leukemia|lymphoma|transplant/],['molpath',/molecular path|human genetic|genomic/],
    ['path',/pathology|clinical pathology/],['micro',/microbio|infectious|infection/],['poct',/point.of.care|poct|automation/],
    ['chem',/clinical chem|laboratory medicine|diagnostic/],['cancer-res',/cancer research|immunology/],['onco',/oncology|cancer/]];
  return (rules.find(([, re]) => re.test(s)) || [DATA.fields[0]?.key || 'chem'])[0];
}
function regionForCountry(country) {
  if (['일본','대만','중국','홍콩','싱가포르','인도','말레이시아','필리핀','태국','한국'].includes(country)) return '아시아';
  if (['미국','캐나다','멕시코'].includes(country)) return '북미';
  if (['영국','스페인','프랑스','독일','이탈리아','스웨덴','덴마크','네덜란드','포르투갈','스위스','오스트리아'].includes(country)) return '유럽';
  if (['호주','뉴질랜드'].includes(country)) return '오세아니아';
  if (['브라질'].includes(country)) return '남미';
  if (['아랍에미리트'].includes(country)) return '중동';
  return '기타';
}
function applyConferenceInfo(info) {
  const map = { cfName:'name', cfAbbr:'abbr', cfField:'field', cfCity:'city', cfCountry:'country', cfRegion:'region', cfStart:'start', cfEnd:'end', cfNote:'note' };
  let count = 0;
  Object.entries(map).forEach(([id, key]) => {
    const el = document.getElementById(id), value = info[key];
    if (el && value && !el.value.trim()) { el.value = value; count++; }
  });
  return count;
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

/* ================================================================
   ☁️ 기기 간 동기화 — GitHub 비공개 Gist
   개인 데이터(store: conf·family·custom)만 오간다. 학회 시드 데이터는 대상 아님.
   전략: 전역 최신본 우선(LWW by savedAt) — 앱 열 때 받아오고, 편집하면 자동 업로드.
   ================================================================ */
const SYNC_KEY = 'confplanner.sync';
const GIST_DESC = 'confplanner-sync';
let syncTimer = null;

function syncCfg() { try { return JSON.parse(localStorage.getItem(SYNC_KEY) || '{}'); } catch (e) { return {}; } }
function saveSyncCfg(c) { localStorage.setItem(SYNC_KEY, JSON.stringify(c)); }
function ghHeaders(tok) { return { 'Authorization': 'token ' + tok, 'Accept': 'application/vnd.github+json' }; }

async function gistLocate(tok) {
  const cfg = syncCfg();
  if (cfg.gistId) return cfg.gistId;
  const r = await fetch('https://api.github.com/gists?per_page=100', { headers: ghHeaders(tok) });
  if (r.status === 401) throw new Error('GitHub 토큰이 유효하지 않습니다');
  if (!r.ok) throw new Error('GitHub 연결 실패 (HTTP ' + r.status + ')');
  const found = (await r.json()).find(g => g.description === GIST_DESC);
  let id;
  if (found) {
    id = found.id;
  } else {
    const c = await fetch('https://api.github.com/gists', {
      method: 'POST', headers: ghHeaders(tok),
      body: JSON.stringify({ description: GIST_DESC, public: false, files: { 'data.json': { content: '{}' } } })
    });
    if (!c.ok) throw new Error('동기화 저장소 생성 실패 (토큰에 gist 권한이 있는지 확인)');
    id = (await c.json()).id;
  }
  cfg.gistId = id; saveSyncCfg(cfg);
  return id;
}

function syncSet(msg, cls) {
  const el = document.getElementById('syncStatus');
  if (el) { el.textContent = msg; el.className = 'sync-status ' + (cls || ''); }
}

function reflectStore() {
  const fm = document.getElementById('familyMembers');
  if (fm) fm.value = store.family || '';
  buildFilters(); renderAll();
}

/* ---- 3-way 필드 병합 (공통 조상 baseline 기준) ---- */
const BASE_KEY = 'confplanner.base';
function loadBaseline() { try { const b = JSON.parse(localStorage.getItem(BASE_KEY)); return b || null; } catch (e) { return null; } }
function saveBaseline(s) { localStorage.setItem(BASE_KEY, JSON.stringify({ conf: s.conf || {}, family: s.family || '', custom: s.custom || [], savedAt: s.savedAt || '' })); }

const TRAVEL_KEYS = ['enabled', 'from', 'to', 'members', 'todos', 'budget', 'notes'];
function blankConf() { return { interest: 0, attending: false, checklist: {}, notes: '', budget: '', travel: { enabled: false, from: '', to: '', members: '', todos: '', budget: '', notes: '' } }; }
function isBlankConf(m) {
  if (!m) return true;
  if ((m.interest || 0) !== 0 || m.attending || (m.notes || '') || (m.budget || '')) return false;
  if (Object.keys(m.checklist || {}).length) return false;
  const t = m.travel || {};
  if (t.enabled) return false;
  return !(t.from || t.to || t.members || t.todos || t.budget || t.notes);
}

// base=공통조상, a=로컬, c=클라우드. 한쪽만 바뀌면 그쪽 채택, 둘 다 바뀌면 preferA(최신 저장분).
function pick3(base, a, c, preferA) {
  const S = v => JSON.stringify(v === undefined ? null : v);
  if (S(a) === S(c)) return a;
  if (S(a) === S(base)) return c;   // 로컬 미변경 → 클라우드 채택
  if (S(c) === S(base)) return a;   // 클라우드 미변경 → 로컬 채택
  return preferA ? a : c;           // 둘 다 변경 → 최신 저장분
}

function mergeStores(base, local, cloud, preferLocal) {
  base = base || { conf: {}, family: '', custom: [] };
  const merged = { conf: {}, custom: [], savedAt: (preferLocal ? local.savedAt : cloud.savedAt) || local.savedAt || cloud.savedAt || '' };
  merged.family = pick3(base.family || '', local.family || '', cloud.family || '', preferLocal);

  // conf: 학회 id 합집합, 각 필드를 3-way
  const ids = new Set([...Object.keys(base.conf || {}), ...Object.keys(local.conf || {}), ...Object.keys(cloud.conf || {})]);
  for (const id of ids) {
    const B = (base.conf || {})[id] || {}, L = (local.conf || {})[id] || blankConf(), C = (cloud.conf || {})[id] || blankConf();
    const m = {};
    m.interest = pick3(B.interest || 0, L.interest || 0, C.interest || 0, preferLocal);
    m.attending = pick3(B.attending || false, L.attending || false, C.attending || false, preferLocal);
    m.notes = pick3(B.notes || '', L.notes || '', C.notes || '', preferLocal);
    m.budget = pick3(B.budget || '', L.budget || '', C.budget || '', preferLocal);
    m.checklist = {};
    const items = new Set([...Object.keys(B.checklist || {}), ...Object.keys(L.checklist || {}), ...Object.keys(C.checklist || {})]);
    for (const it of items) {
      const bv = (B.checklist || {}).hasOwnProperty(it) ? B.checklist[it] : undefined;
      const lv = (L.checklist || {}).hasOwnProperty(it) ? L.checklist[it] : undefined;
      const cv = (C.checklist || {}).hasOwnProperty(it) ? C.checklist[it] : undefined;
      const r = pick3(bv, lv, cv, preferLocal);
      if (r !== undefined) m.checklist[it] = r;   // 양쪽에서 삭제되면 drop
    }
    const bt = B.travel || {}, lt = L.travel || {}, ct = C.travel || {};
    m.travel = {};
    TRAVEL_KEYS.forEach(k => {
      const def = k === 'enabled' ? false : '';
      m.travel[k] = pick3(bt[k] === undefined ? def : bt[k], lt[k] === undefined ? def : lt[k], ct[k] === undefined ? def : ct[k], preferLocal);
    });
    if (!isBlankConf(m)) merged.conf[id] = m;   // 개인데이터 없는 stub은 저장 안 함
  }

  // custom: id 합집합, 레코드 단위 3-way(추가/삭제/수정 반영)
  const byId = (arr, id) => (arr || []).find(x => x && x.id === id);
  const custIds = new Set([...(base.custom || []), ...(local.custom || []), ...(cloud.custom || [])].filter(Boolean).map(x => x.id));
  for (const id of custIds) {
    const r = pick3(byId(base.custom, id) || null, byId(local.custom, id) || null, byId(cloud.custom, id) || null, preferLocal);
    if (r) merged.custom.push(r);
  }
  return merged;
}

async function syncNow(silent) {
  const cfg = syncCfg();
  const tok = cfg.githubToken;
  const btn = document.getElementById('btnSyncCloud');
  if (!tok) { if (!silent) openSyncModal(); return; }
  try {
    syncSet('동기화 중…', 'loading');
    if (btn) { btn.classList.add('spin'); }
    const id = await gistLocate(tok);
    const g = await fetch('https://api.github.com/gists/' + id, { headers: ghHeaders(tok), cache: 'no-store' });
    if (!g.ok) throw new Error('다운로드 실패 (HTTP ' + g.status + ')');
    let cloud = {};
    try { const f = (await g.json()).files['data.json']; cloud = JSON.parse(f && f.content ? f.content : '{}'); } catch (e) { cloud = {}; }
    if (!cloud || !cloud.conf) cloud = { conf: {}, family: '', custom: [] };
    // 3-way 필드 병합: baseline(공통 조상) 기준으로 로컬·클라우드 변경을 각각 반영
    const base = loadBaseline();
    const preferLocal = (store.savedAt || '') >= (cloud.savedAt || '');
    const merged = mergeStores(base, store, cloud, preferLocal);
    store = merged;
    if (!store.conf) store.conf = {};
    if (!Array.isArray(store.custom)) store.custom = [];
    persist(); reflectStore();
    // 병합 결과를 업로드해 다른 기기가 받아가게
    const up = await fetch('https://api.github.com/gists/' + id, {
      method: 'PATCH', headers: ghHeaders(tok),
      body: JSON.stringify({ files: { 'data.json': { content: JSON.stringify(store) } } })
    });
    if (!up.ok) throw new Error('업로드 실패 (HTTP ' + up.status + ')');
    saveBaseline(merged); // 업로드 성공 후에만 공통 조상 갱신(실패 시 다음 동기화가 재병합)
    const cfg2 = syncCfg(); cfg2.lastSync = Date.now(); saveSyncCfg(cfg2); // gistLocate가 저장한 gistId 보존
    syncSet('✅ 동기화됨 ' + new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }), 'ok');
    if (btn) { btn.classList.remove('spin'); btn.textContent = '☁️'; btn.title = '기기 간 동기화'; }
  } catch (e) {
    syncSet('❌ ' + e.message, 'fail');
    if (btn) { btn.classList.remove('spin'); btn.textContent = '⚠️'; btn.title = '동기화 실패: ' + e.message; }
    if (!silent) openSyncModal();
    console.warn('sync failed:', e);
  }
}

function scheduleSync() {
  if (!syncCfg().githubToken) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => { syncTimer = null; syncNow(true); }, 4000);
}

function openSyncModal() {
  const cfg = syncCfg();
  const on = !!cfg.githubToken;
  document.getElementById('modalBody').innerHTML = `
    <h2>☁️ 기기 간 동기화</h2>
    <p class="sync-help">GitHub <b>비공개 Gist</b>에 내가 입력한 데이터(관심도·방문 예정·체크리스트·가족여행·직접 추가한 학회)를 저장해 PC와 휴대폰이 같은 내용을 보게 합니다. 학회 일정 자체가 아니라 <b>내 개인 데이터만</b> 오갑니다.</p>
    <label class="small">GitHub Personal Access Token</label>
    <input class="field-input" id="syncTok" type="password" autocomplete="off" placeholder="${on ? '저장됨 · 바꿀 때만 입력' : 'ghp_...'}">
    <p class="sync-help">github.com → Settings → Developer settings → Personal access tokens에서 <b>gist</b> 권한만 체크해 발급. 토큰은 이 기기에만 저장되고 GitHub에만 전송됩니다.${on && cfg.lastSync ? '<br>마지막 동기화: ' + new Date(cfg.lastSync).toLocaleString('ko-KR') : ''}</p>
    <div id="syncStatus" class="sync-status"></div>
    <button class="btn-primary" id="syncSave">${on ? '지금 동기화' : '저장하고 동기화'}</button>
    ${on ? '<button class="btn-danger" id="syncOff">이 기기에서 동기화 끄기</button>' : ''}
  `;
  document.getElementById('modal').classList.remove('hidden');
  document.getElementById('syncSave').addEventListener('click', () => {
    const v = document.getElementById('syncTok').value.trim();
    const c = syncCfg();
    if (v) c.githubToken = v;
    saveSyncCfg(c);
    if (!c.githubToken) { syncSet('토큰을 입력해 주세요', 'fail'); return; }
    syncNow(false);
  });
  const off = document.getElementById('syncOff');
  if (off) off.addEventListener('click', () => {
    const c = syncCfg(); delete c.githubToken; delete c.gistId; saveSyncCfg(c);
    closeModal(); toast('이 기기에서 동기화를 껐습니다');
    const btn = document.getElementById('btnSyncCloud'); if (btn) { btn.textContent = '☁️'; btn.title = '기기 간 동기화'; }
  });
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
      store = obj;
      localStorage.removeItem(BASE_KEY); // 복원본은 새 로컬 변경으로 취급 → 다음 동기화에서 병합
      save();
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
