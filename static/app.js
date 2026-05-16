// ── 상태 ──────────────────────────────────────────────
let user         = null;
let names        = { me: '남자친구', her: '여자친구' };
let section      = null;
let entries      = [];
let currentEntry = null;
let editingEntry = null;
let pendingPhoto = null;
let calYear      = new Date().getFullYear();
let calMonth     = new Date().getMonth();
let selectedDate = null;

let activePage   = null;

// ── 초기화 ────────────────────────────────────────────
window.onload = () => {
  const sn = localStorage.getItem('diaryNames');
  if (sn) names = JSON.parse(sn);
  const su = localStorage.getItem('diaryUser');
  if (su) user = JSON.parse(su);
};

// ── 페이지 전환 ───────────────────────────────────────
function showPage(id) {
  const next = document.getElementById(id);
  if (activePage) {
    activePage.classList.remove('active');
    activePage.classList.add('exit');
    setTimeout(() => activePage && activePage.classList.remove('exit'), 350);
  }
  next.classList.remove('from-back');
  next.classList.add('active');
  activePage = next;
}

function goBack(targetId) {
  const next = document.getElementById(targetId);
  if (activePage) {
    activePage.classList.remove('active');
    const old = activePage;
    setTimeout(() => old.classList.remove('exit'), 350);
  }
  next.style.transition = 'none';
  next.classList.add('from-back');
  next.classList.remove('exit');
  requestAnimationFrame(() => {
    next.style.transition = '';
    requestAnimationFrame(() => {
      next.classList.remove('from-back');
      next.classList.add('active');
    });
  });
  activePage = next;
}

// ── 다이어리 열기 ─────────────────────────────────────
function openDiary() {
  const book = document.getElementById('diary-book');
  book.classList.add('open');

  setTimeout(() => {
    document.getElementById('cover-screen').classList.add('hidden');
    document.getElementById('diary-app').classList.add('visible');

    if (!user) {
      document.getElementById('input-me').value  = names.me;
      document.getElementById('input-her').value = names.her;
      showPage('page-name');
    } else {
      goToSection();
    }
  }, 800);
}

// ── 이름 / 사용자 설정 ────────────────────────────────
function setUser(role) {
  const me  = document.getElementById('input-me').value.trim()  || '남자친구';
  const her = document.getElementById('input-her').value.trim() || '여자친구';
  names = { me, her };
  localStorage.setItem('diaryNames', JSON.stringify(names));
  user = { role, name: names[role] };
  localStorage.setItem('diaryUser', JSON.stringify(user));
  goToSection();
}

function switchUser() {
  localStorage.removeItem('diaryUser');
  user = null;
  document.getElementById('input-me').value  = names.me;
  document.getElementById('input-her').value = names.her;
  showPage('page-name');
}

// ── 섹션 화면 ─────────────────────────────────────────
function goToSection() {
  document.getElementById('greeting-text').textContent = `${user.name}님 ♡`;
  document.getElementById('sec-me-name').textContent   = `${names.me}의 다이어리`;
  document.getElementById('sec-her-name').textContent  = `${names.her}의 다이어리`;
  showPage('page-section');
}

// ── 캘린더 ────────────────────────────────────────────
async function selectSection(sec) {
  section = sec;
  const titles = { me: `${names.me}의 다이어리`, her: `${names.her}의 다이어리`, us: '우리 다이어리' };
  document.getElementById('cal-title').textContent = titles[sec];

  const canWrite = sec === 'us' || sec === user.role;
  document.getElementById('cal-write-btn').style.visibility = canWrite ? 'visible' : 'hidden';

  selectedDate = null;
  calYear  = new Date().getFullYear();
  calMonth = new Date().getMonth();

  await loadEntries();
  renderCalendar();
  showPage('page-calendar');
}

async function loadEntries() {
  const res = await fetch(`/entries?section=${section}`);
  entries = await res.json();
}

function renderCalendar() {
  document.getElementById('cal-month-label').textContent = `${calYear}년 ${calMonth + 1}월`;

  const firstDay    = new Date(calYear, calMonth, 1).getDay();
  const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
  const today       = new Date().toISOString().slice(0, 10);

  const hasMap = {};
  entries.forEach(e => { hasMap[e.created_at.slice(0, 10)] = true; });

  let html = '';
  for (let i = 0; i < firstDay; i++) html += `<div class="cal-cell empty"></div>`;

  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${calYear}-${String(calMonth+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const dow = new Date(calYear, calMonth, d).getDay();
    const cls = [
      'cal-cell',
      dow === 0 ? 'sun' : dow === 6 ? 'sat' : '',
      dateStr === today ? 'today' : '',
      dateStr === selectedDate ? 'selected' : '',
    ].filter(Boolean).join(' ');

    html += `<div class="${cls}" onclick="selectDate('${dateStr}')">
      ${d}
      ${hasMap[dateStr] ? '<span class="dot"></span>' : ''}
    </div>`;
  }

  document.getElementById('cal-grid').innerHTML = html;
  document.getElementById('cal-hint').style.display = selectedDate ? 'none' : 'block';
}

function changeMonth(dir) {
  calMonth += dir;
  if (calMonth < 0)  { calMonth = 11; calYear--; }
  if (calMonth > 11) { calMonth = 0;  calYear++; }
  selectedDate = null;
  renderCalendar();
}

// ── 날짜 선택 → 목록 페이지 ──────────────────────────
function selectDate(dateStr) {
  selectedDate = dateStr;
  renderCalendar();

  const d = new Date(dateStr);
  document.getElementById('entries-date-title').textContent =
    `${d.getMonth()+1}월 ${d.getDate()}일`;

  const canWrite = section === 'us' || section === user.role;
  document.getElementById('entries-write-btn').style.visibility = canWrite ? 'visible' : 'hidden';

  const dayEntries = entries.filter(e => e.created_at.startsWith(dateStr));
  const list = document.getElementById('entries-list');

  if (dayEntries.length === 0) {
    list.innerHTML = `<p class="empty-msg">이 날의 기록이 없어요</p>`;
  } else {
    list.innerHTML = dayEntries.map(e => `
      <div class="entry-card sec-${e.section}" onclick="showEntry(${e.id})">
        <div class="entry-card-title">${e.title}</div>
        <div class="entry-card-meta">${e.author} · ${e.created_at.slice(11,16)}${e.location ? ' · ' + e.location : ''}</div>
        ${e.photo   ? `<img class="entry-card-thumb" src="/uploads/${e.photo}">` : ''}
        ${e.content ? `<div class="entry-card-preview">${e.content}</div>` : ''}
      </div>
    `).join('');
  }

  showPage('page-entries');
}

// ── 글 상세 ───────────────────────────────────────────
async function showEntry(id) {
  currentEntry = entries.find(e => e.id === id);
  if (!currentEntry) return;

  const canEdit = currentEntry.author === user.name;
  document.getElementById('edit-btn').style.visibility = canEdit ? 'visible' : 'hidden';

  document.getElementById('entry-detail').innerHTML = `
    <div class="detail-title">${currentEntry.title}</div>
    <div class="detail-meta">
      <span>${formatFullDate(currentEntry.created_at)}</span>
      ${currentEntry.location ? `<span>${currentEntry.location}</span>` : ''}
      <span class="detail-badge">${currentEntry.author}</span>
    </div>
    ${currentEntry.photo   ? `<img class="detail-photo" src="/uploads/${currentEntry.photo}">` : ''}
    ${currentEntry.content ? `<div class="detail-text">${currentEntry.content}</div>` : ''}
  `;

  await loadComments(id);
  showPage('page-detail');
}

// ── 댓글 ──────────────────────────────────────────────
async function loadComments(entryId) {
  const res  = await fetch(`/entries/${entryId}/comments`);
  const list = await res.json();
  const el   = document.getElementById('comments-list');

  if (!list.length) {
    el.innerHTML = '<p style="font-size:0.78rem;color:#c8a8b8;margin-bottom:8px">아직 댓글이 없어요</p>';
    return;
  }

  el.innerHTML = list.map(c => {
    const isMe = c.author === names.me;
    return `<div class="comment-item">
      <div class="c-avatar ${isMe ? 'avatar-me' : 'avatar-her'}">${c.author.slice(0,1)}</div>
      <div class="c-bubble">
        <div class="c-author">${c.author} · ${c.created_at.slice(5,16)}</div>
        <div class="c-text">${c.content}</div>
      </div>
    </div>`;
  }).join('');
}

async function submitComment() {
  const input   = document.getElementById('comment-input');
  const content = input.value.trim();
  if (!content || !currentEntry) return;
  await fetch(`/entries/${currentEntry.id}/comments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ author: user.name, content })
  });
  input.value = '';
  await loadComments(currentEntry.id);
}

// ── 글쓰기 / 편집 ─────────────────────────────────────
function showWrite(entry) {
  editingEntry = entry;
  pendingPhoto = null;

  document.getElementById('write-title').textContent = entry ? '편집' : '새 기록';
  document.getElementById('w-title').value    = entry?.title    || '';
  document.getElementById('w-content').value  = entry?.content  || '';
  document.getElementById('w-location').value = entry?.location || '';
  document.getElementById('del-btn').style.display = entry ? 'block' : 'none';

  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  document.getElementById('w-date').value = entry?.created_at
    ? new Date(entry.created_at).toISOString().slice(0,16)
    : now.toISOString().slice(0,16);

  const pa = document.getElementById('photo-area');
  if (entry?.photo) {
    pa.innerHTML = `<div id="photo-preview"><img src="/uploads/${entry.photo}"></div><input type="file" id="w-photo" accept="image/*" style="display:none" onchange="previewPhoto(this)">`;
  } else {
    pa.innerHTML = `<div id="photo-preview"><span class="photo-plus">+</span><span>사진 추가</span></div><input type="file" id="w-photo" accept="image/*" style="display:none" onchange="previewPhoto(this)">`;
  }

  showPage('page-write');
}

function editCurrentEntry() { showWrite(currentEntry); }

function cancelWrite() {
  if (editingEntry) goBack('page-detail');
  else goBack('page-entries');
}

function previewPhoto(input) {
  if (!input.files?.[0]) return;
  pendingPhoto = input.files[0];
  const reader = new FileReader();
  reader.onload = e => {
    document.getElementById('photo-preview').innerHTML = `<img src="${e.target.result}">`;
  };
  reader.readAsDataURL(pendingPhoto);
}

async function saveEntry() {
  const title    = document.getElementById('w-title').value.trim();
  const content  = document.getElementById('w-content').value.trim();
  const location = document.getElementById('w-location').value.trim();
  const date     = document.getElementById('w-date').value;
  if (!title) { showToast('제목을 입력해주세요'); return; }

  const fd = new FormData();
  fd.append('title', title);
  fd.append('content', content);
  fd.append('location', location);
  fd.append('created_at', date);
  fd.append('section', section);
  fd.append('author', user.name);
  if (pendingPhoto) fd.append('photo', pendingPhoto);

  const url    = editingEntry ? `/entries/${editingEntry.id}` : '/entries';
  const method = editingEntry ? 'PUT' : 'POST';
  const res    = await fetch(url, { method, body: fd });
  const data   = await res.json();

  if (data.ok) {
    await loadEntries();
    renderCalendar();
    showToast('저장됐어요 ♡');
    if (editingEntry) {
      currentEntry = entries.find(e => e.id === editingEntry.id);
      editingEntry = null;
      await showEntry(currentEntry.id);
    } else {
      selectedDate = date.slice(0, 10);
      selectDate(selectedDate);
    }
  } else {
    showToast(data.message);
  }
}

async function deleteCurrentEntry() {
  if (!confirm('이 기록을 삭제할까요?')) return;
  await fetch(`/entries/${editingEntry.id}`, { method: 'DELETE' });
  await loadEntries();
  renderCalendar();
  editingEntry = null;
  currentEntry = null;
  selectDate(selectedDate);
}

// ── 유틸 ──────────────────────────────────────────────
function formatFullDate(str) {
  const d = new Date(str);
  return `${d.getFullYear()}년 ${d.getMonth()+1}월 ${d.getDate()}일 ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}

function showToast(msg) {
  const t = document.createElement('div');
  t.textContent = msg;
  t.style.cssText = 'position:fixed;bottom:30px;left:50%;transform:translateX(-50%);background:rgba(106,58,74,0.88);color:white;padding:9px 22px;border-radius:20px;font-size:0.85rem;z-index:999;animation:fadeInOut 2s ease forwards;white-space:nowrap';
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2000);
}
