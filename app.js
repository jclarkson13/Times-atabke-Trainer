(() => {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  // ---- state (in memory only) ----
  const stats = new Map();           // "a,b" (a<=b) -> {right, wrong, last}
  let selected = new Set([2, 3, 4, 5]);
  let session = null;
  let lastView = 'home';
  const ROUND_LEN = 20, SPRINT_SECS = 60;

  const key = (a, b) => a <= b ? `${a},${b}` : `${b},${a}`;
  const rand = n => Math.floor(Math.random() * n);

  // ---- views ----
  const views = ['home', 'quiz', 'results', 'map'];
  function show(name) {
    views.forEach(v => { $('#view-' + v).hidden = v !== name; });
    if (name !== 'map') lastView = name;
    $('#main').focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }

  // ---- home ----
  function buildChips() {
    const box = $('#chips');
    for (let n = 0; n <= 12; n++) {
      const l = document.createElement('label');
      l.className = 'chip';
      l.innerHTML = `<input type="checkbox" value="${n}" aria-label="${n} times table"><span>${n}</span>`;
      box.appendChild(l);
    }
    box.addEventListener('change', e => {
      const n = +e.target.value;
      e.target.checked ? selected.add(n) : selected.delete(n);
      $('#startHint').textContent = '';
    });
    syncChips();
  }
  function syncChips() { $$('#chips input').forEach(i => i.checked = selected.has(+i.value)); }
  $$('[data-quick]').forEach(b => b.addEventListener('click', () => {
    const q = b.dataset.quick;
    selected = new Set(q === 'all' ? range(0, 12) : q === 'easy' ? range(0, 5) : q === 'hard' ? range(6, 12) : []);
    syncChips(); $('#startHint').textContent = '';
  }));
  function range(a, b) { const r = []; for (let i = a; i <= b; i++) r.push(i); return r; }

  // ---- question picking ----
  function poolFor(tables) {
    const seen = new Set(), pool = [];
    tables.forEach(a => { for (let b = 0; b <= 12; b++) {
      const k = key(a, b);
      if (!seen.has(k)) { seen.add(k); pool.push({ a, b }); }
    }});
    return pool;
  }
  function weight(f) {
    const s = stats.get(key(f.a, f.b));
    if (!s) return 3;                       // never seen
    if (s.last === 'wrong') return 7;       // needs work
    return 1;
  }
  function pickFact() {
    const s = session;
    let cand = s.pool.filter(f => !s.asked.has(key(f.a, f.b)) && key(f.a, f.b) !== s.lastKey);
    if (!cand.length) { s.asked.clear(); cand = s.pool.filter(f => key(f.a, f.b) !== s.lastKey); }
    if (!cand.length) cand = s.pool;
    const total = cand.reduce((t, f) => t + weight(f), 0);
    let r = Math.random() * total;
    for (const f of cand) { r -= weight(f); if (r <= 0) return f; }
    return cand[cand.length - 1];
  }

  // ---- start ----
  function start(tables, mode) {
    session = {
      mode, pool: poolFor(tables), asked: new Set(), lastKey: null, tables: [...tables],
      n: 0, correct: 0, streak: 0, best: 0, missed: new Map(), startedAt: Date.now(),
      timeLeft: SPRINT_SECS, timer: null, locked: false, current: null, advance: null, ended: false
    };
    const prog = $('#progress');
    prog.classList.toggle('timer', mode === 'sprint');
    prog.classList.remove('low');
    $('#progressFill').style.width = mode === 'sprint' ? '100%' : '0';
    if (mode === 'sprint') {
      session.deadline = Date.now() + SPRINT_SECS * 1000;
      session.timer = setInterval(tick, 200);
      tick();
    }
    setStreak(0);
    show('quiz');
    nextQuestion();
  }
  function tick() {
    const s = session; if (!s || s.ended) return;
    const left = Math.max(0, (s.deadline - Date.now()) / 1000);
    s.timeLeft = left;
    $('#progressFill').style.width = (left / SPRINT_SECS * 100) + '%';
    $('#progress').classList.toggle('low', left <= 10);
    $('#progress').setAttribute('aria-valuenow', Math.round(left / SPRINT_SECS * 100));
    $('#progressLabel').textContent = `${Math.ceil(left)}s left · ${s.correct} correct`;
    if (left <= 0) finish();
  }

  function nextQuestion() {
    const s = session; if (!s || s.ended) return;
    clearTimeout(s.advance);
    if (s.mode === 'round' && s.n >= ROUND_LEN) return finish();
    const f = pickFact();
    // random order of factors so kids see both 3x7 and 7x3
    const flip = Math.random() < 0.5;
    const a = flip ? f.b : f.a, b = flip ? f.a : f.b;
    s.current = { a, b, ans: a * b, k: key(a, b) };
    s.asked.add(s.current.k); s.lastKey = s.current.k; s.locked = false;
    $('#qa').textContent = a; $('#qb').textContent = b;
    const inp = $('#answer'); inp.value = ''; inp.disabled = false;
    $('#qCard').className = 'question-card';
    $('#feedback').className = 'feedback'; $('#feedback').textContent = '';
    setKeypad(false);
    if (s.mode === 'round') {
      $('#progressFill').style.width = (s.n / ROUND_LEN * 100) + '%';
      $('#progress').setAttribute('aria-valuenow', Math.round(s.n / ROUND_LEN * 100));
      $('#progressLabel').textContent = `Question ${s.n + 1} of ${ROUND_LEN}`;
    } else if (s.mode === 'practice') {
      $('#progressFill').style.width = '0';
      $('#progressLabel').textContent = `${s.correct} correct so far`;
    }
    inp.focus({ preventScroll: true });
  }

  function setStreak(n) {
    $('#streakNum').textContent = n;
    const el = $('#streak');
    el.classList.toggle('on', n >= 2);
    if (n >= 2) { el.classList.add('pop'); setTimeout(() => el.classList.remove('pop'), 180); }
  }

  const CHEERS = ['Yes!', 'Correct!', 'Nice one!', 'You got it!', 'Great!', 'Awesome!', 'Boom!'];
  const STREAK_CHEERS = { 3: 'Three in a row!', 5: 'Five in a row!', 8: 'On fire!', 10: 'Ten in a row!', 15: 'Unstoppable!' };

  function submit() {
    const s = session; if (!s || s.ended) return;
    if (s.locked) { if (s.waitingNext) { s.waitingNext = false; nextQuestion(); } return; }
    const inp = $('#answer');
    if (inp.value === '') return;
    const val = parseInt(inp.value, 10), c = s.current;
    s.locked = true; s.n++;
    const rec = stats.get(c.k) || { right: 0, wrong: 0, last: null };
    const fb = $('#feedback'), card = $('#qCard');
    if (val === c.ans) {
      s.correct++; s.streak++; s.best = Math.max(s.best, s.streak);
      rec.right++; rec.last = 'right'; stats.set(c.k, rec);
      card.classList.add('right'); fb.className = 'feedback right';
      fb.textContent = STREAK_CHEERS[s.streak] || CHEERS[rand(CHEERS.length)];
      setStreak(s.streak);
      inp.disabled = true; setKeypad(true);
      if (s.mode === 'sprint') tick();
      s.advance = setTimeout(nextQuestion, s.mode === 'sprint' ? 350 : 800);
    } else {
      s.streak = 0; rec.wrong++; rec.last = 'wrong'; stats.set(c.k, rec);
      s.missed.set(c.k, `${c.a} × ${c.b} = ${c.ans}`);
      card.classList.add('wrong'); fb.className = 'feedback wrong';
      fb.innerHTML = `<span>Not quite.</span><span class="ans">${c.a} × ${c.b} = ${c.ans}</span>`;
      setStreak(0);
      inp.disabled = true; setKeypad(true, 'Next');
      s.waitingNext = true;
      // sprint: keep moving quickly; others wait for the learner
      if (s.mode === 'sprint') { s.waitingNext = false; s.advance = setTimeout(nextQuestion, 1500); }
    }
  }

  // ---- finish ----
  function finish() {
    const s = session; if (!s || s.ended) return;
    s.ended = true; clearInterval(s.timer); clearTimeout(s.advance);
    const secs = Math.round((Date.now() - s.startedAt) / 1000);
    const pct = s.n ? Math.round(s.correct / s.n * 100) : 0;
    const title = $('#resTitle'), sub = $('#resSub'), box = $('#resStats');
    let cells;
    if (s.mode === 'sprint') {
      title.textContent = s.correct >= 25 ? 'Lightning fast!' : s.correct >= 12 ? 'Great speed round!' : 'Time\u2019s up!';
      sub.textContent = `You answered ${s.correct} correct in one minute.`;
      cells = [[s.correct, 'Correct'], [s.n ? pct + '%' : '–', 'Accuracy'], [s.best, 'Best streak']];
    } else if (s.mode === 'round') {
      title.textContent = pct === 100 ? 'Perfect score!' : pct >= 85 ? 'Excellent!' : pct >= 60 ? 'Nice work!' : 'Good practice!';
      sub.textContent = s.missed.size ? 'Look over the facts below, then try again.' : 'Every single one right. Try more tables!';
      cells = [[`${s.correct}/${s.n}`, 'Correct'], [pct + '%', 'Accuracy'], [fmt(secs), 'Time'], [s.best, 'Best streak']];
    } else {
      title.textContent = 'Nice practice!';
      sub.textContent = s.n ? 'Every question you answer makes the next one easier.' : 'Come back any time.';
      cells = [[s.correct, 'Correct'], [s.n, 'Tried'], [s.best, 'Best streak']];
    }
    box.innerHTML = cells.map(([v, l]) => `<div class="stat"><b>${v}</b><span>${l}</span></div>`).join('');
    $('#missedCard').hidden = !s.missed.size;
    $('#missedList').innerHTML = [...s.missed.values()].map(t => `<li>${t}</li>`).join('');
    $('#missedBtn').hidden = !s.missed.size;
    show('results');
    $('#againBtn').focus({ preventScroll: true });
  }
  const fmt = t => `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;

  function quit() {
    if (session) { clearInterval(session.timer); clearTimeout(session.advance); session.ended = true; }
    if (session && session.mode === 'practice' && session.n) return finish();
    show('home');
  }

  // ---- keypad ----
  function buildKeypad() {
    const kp = $('#keypad');
    const keys = ['1','2','3','4','5','6','7','8','9','⌫','0','Enter'];
    kp.innerHTML = keys.map(k => {
      if (k === '⌫') return `<button class="key fn" data-k="back" aria-label="Delete">⌫</button>`;
      if (k === 'Enter') return `<button class="key go" data-k="go" id="goKey">Check</button>`;
      return `<button class="key" data-k="${k}">${k}</button>`;
    }).join('');
    kp.addEventListener('pointerdown', e => { if (e.target.closest('.key')) e.preventDefault(); });
    kp.addEventListener('click', e => {
      const b = e.target.closest('.key'); if (!b || !session || session.ended) return;
      const inp = $('#answer'), k = b.dataset.k;
      if (k === 'go') return submit();
      if (session.locked) return;
      if (k === 'back') inp.value = inp.value.slice(0, -1);
      else if (inp.value.length < 3) inp.value += k;
    });
  }
  // after answering, keypad digits are disabled; the go key becomes "Next" on a miss
  function setKeypad(locked, goLabel) {
    $$('#keypad .key').forEach(b => { if (b.dataset.k !== 'go') b.disabled = locked; });
    $('#goKey').textContent = goLabel || 'Check';
  }

  // ---- keyboard ----
  document.addEventListener('keydown', e => {
    if ($('#view-quiz').hidden || !session || session.ended) return;
    if (e.key === 'Enter') { e.preventDefault(); submit(); }
    else if (!session.locked) {
      const inp = $('#answer');
      if (/^\d$/.test(e.key) && document.activeElement !== inp && inp.value.length < 3) inp.value += e.key;
      else if (e.key === 'Backspace' && document.activeElement !== inp) inp.value = inp.value.slice(0, -1);
    }
  });
  $('#answer').addEventListener('input', e => { e.target.value = e.target.value.replace(/\D/g, '').slice(0, 3); });

  // ---- map ----
  function buildMap() {
    const m = $('#map'); m.innerHTML = '';
    const cell = (cls, txt, label) => { const d = document.createElement('div'); d.className = cls; d.textContent = txt; if (label) d.setAttribute('aria-label', label); return d; };
    m.appendChild(cell('h corner', '×'));
    for (let b = 0; b <= 12; b++) m.appendChild(cell('h', b));
    for (let a = 0; a <= 12; a++) {
      m.appendChild(cell('h', a));
      for (let b = 0; b <= 12; b++) {
        const s = stats.get(key(a, b));
        const cls = !s ? '' : s.last === 'right' ? 's-good' : 's-shaky';
        const d = cell(cls, a * b, `${a} times ${b} is ${a * b}, ${!s ? 'not tried' : s.last === 'right' ? 'got it' : 'needs work'}`);
        m.appendChild(d);
      }
    }
  }
  function shakyTables() {
    const t = new Set();
    stats.forEach((s, k) => { if (s.last === 'wrong') { const [a, b] = k.split(',').map(Number); t.add(a); t.add(b); } });
    return t;
  }
  function openMap() { buildMap(); $('#mapHint').textContent = ''; show('map'); }

  // ---- wire up ----
  buildChips(); buildKeypad();
  $('#startBtn').addEventListener('click', () => {
    if (!selected.size) { $('#startHint').textContent = 'Pick at least one table first.'; return; }
    start([...selected].sort((a, b) => a - b), $('input[name=mode]:checked').value);
  });
  $('#quitBtn').addEventListener('click', quit);
  $('#homeBtn').addEventListener('click', () => { if (session) { clearInterval(session.timer); clearTimeout(session.advance); session.ended = true; } show('home'); });
  $('#mapBtn').addEventListener('click', () => { if (session && !session.ended) { clearInterval(session.timer); clearTimeout(session.advance); session.ended = true; } openMap(); });
  $('#mapBackBtn').addEventListener('click', () => show(lastView === 'quiz' ? 'home' : lastView));
  $('#againBtn').addEventListener('click', () => start(session.tables, session.mode));
  $('#changeBtn').addEventListener('click', () => { syncChips(); show('home'); });
  $('#missedBtn').addEventListener('click', () => {
    // practice every table involved in the missed facts, weighted toward the misses
    const t = new Set(); stats.forEach((s, k) => { if (s.last === 'wrong') k.split(',').forEach(n => t.add(+n)); });
    start([...t].length ? [...t].sort((a, b) => a - b) : session.tables, 'practice');
  });
  $('#mapPracticeBtn').addEventListener('click', () => {
    const t = shakyTables();
    if (!t.size) { $('#mapHint').textContent = stats.size ? 'Nothing needs work right now. Great job!' : 'Play a round first and your map will fill in.'; $('#mapHint').style.color = 'var(--muted)'; return; }
    start([...t].sort((a, b) => a - b), 'practice');
  });
})();
