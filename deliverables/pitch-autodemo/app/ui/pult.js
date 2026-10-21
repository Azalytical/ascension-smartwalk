// The prompter and remote: the same page on the laptop screen (/pult) and on a phone (/phone).
// It reads the speech from the show program, follows its state over server-sent events and sends keys and buttons back.
(() => {
  const qs = new URLSearchParams(location.search);
  const KEY = qs.get('k') || '';
  const PHONE = location.pathname.startsWith('/phone');
  if (PHONE) document.body.classList.add('phone-mode');
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const md = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\*(.+?)\*/g, '<em>$1</em>').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/`([^`]+)`/g, '$1');
  const pad = (n) => String(n).padStart(2, '0');
  const mmss = (sec) => { sec = Math.max(0, Math.round(sec)); return `${Math.floor(sec / 60)}:${pad(sec % 60)}`; };
  let SP = null, st = null, offset = 0, forceStart = false;

  async function post(body) {
    try { await fetch('/cmd?k=' + KEY, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Aidem': KEY }, body: JSON.stringify(body) }); } catch (e) { /* the show is restarting */ }
  }
  document.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.key) { post({ type: 'key', key: b.dataset.key }); return; }
    const cmd = b.dataset.cmd;
    if (!cmd) return;
    if (cmd === 'qa') post({ type: 'key', key: 'q' });
    else if (cmd === 'font+') post({ type: 'key', key: '+' });
    else if (cmd === 'font-') post({ type: 'key', key: '-' });
    else if (cmd === 'idle') { forceStart = !forceStart; render(); }
    else if (cmd === 'tourLoop') { forceStart = false; post({ type: 'tour', loop: true }); }
    else { if (cmd === 'start' || cmd === 'tour') forceStart = false; post({ type: cmd }); }
  });
  // On a phone there is no show program in the page: keys go over the network.
  if (PHONE) addEventListener('keydown', (e) => { if (['ArrowRight', 'ArrowLeft', 'PageDown', 'PageUp', ' ', 'Escape'].includes(e.key)) { e.preventDefault(); post({ type: 'key', key: e.key }); } });

  const isAlt = (who) => /Данияр/.test(who || '');
  function slideNotes(slide) {
    const all = [];
    for (const seg of slide.segs) all.push(...seg.notes);
    if (slide.bonus) for (const seg of slide.bonus.segs) all.push(...seg.notes);
    return all;
  }
  const liveSlide = (slide) => slide.segs.some((s) => s.beat) || (slide.bonus && slide.bonus.segs.some((s) => s.beat));

  function renderStatus() {
    const chips = [];
    const chip = (cls, text) => chips.push(`<span class="chip ${cls}"><i></i>${text}</span>`);
    chip(st.online === null ? '' : st.online ? 'ok' : 'bad', st.online === null ? 'Сайт: проверяю' : st.online ? `Сайт на связи${st.places ? ` · ${Number(st.places).toLocaleString('ru-RU')} мест` : ''}` : `Сайт недоступен`);
    if (st.online) chip(st.gemini ? 'ok' : 'warn', st.gemini ? 'Gemini отвечает' : 'Gemini выключен');
    const sc = st.screens || {};
    chip(sc.count >= 2 ? 'ok' : sc.count === 1 ? 'bad' : '', sc.count >= 2 ? `Проектор ${sc.projector ? sc.projector.w + '×' + sc.projector.h : ''}` : sc.count === 1 ? 'Один экран: суфлёр виден залу' : 'Экраны: проверяю');
    const tabs = st.tabs || {};
    const names = { coffee: 'кофе', tourist: 'турист', agent: 'агент' };
    const tabState = Object.keys(names).filter((k) => tabs[k]).map((k) => `${names[k]} ${tabs[k].state === 'ready' ? '✓' : tabs[k].state === 'loading' ? '…' : '✗'}`);
    if (tabState.length) chip(tabState.every((t) => t.endsWith('✓')) ? 'ok' : tabState.some((t) => t.endsWith('✗')) ? 'bad' : '', 'Вкладки: ' + tabState.join(', '));
    if (!st.captions) chip('', 'Подписи скрыты');
    if (st.blackout) chip('warn', 'Чёрный экран (B)');
    $('status').innerHTML = chips.join('');
    const mode = $('mode');
    mode.className = 'mode ' + (st.paused ? 'paused' : st.mode);
    mode.textContent = st.paused ? 'пауза' : st.mode === 'pitch' ? 'питч' : st.mode === 'tour' ? 'полный тур' : 'ожидание';
  }

  function renderClock() {
    if (!st || !SP) return;
    const clock = $('clock').parentElement;
    if (st.mode === 'pitch' && st.t0) {
      const el = (Date.now() + offset - st.t0) / 1000;
      const slide = SP.slides[st.slide];
      $('clock').textContent = mmss(el);
      const late = slide && el > slide.to + 3;
      clock.className = 'clock ' + (late ? 'late' : 'ok');
      $('plan').textContent = slide ? `по плану ${mmss(slide.from)}–${mmss(slide.to)} из ${mmss(SP.end)}${late ? ` · отстаём на ${mmss(el - slide.to)}` : ''}` : '';
    } else {
      $('clock').textContent = st.mode === 'tour' ? 'тур' : '0:00';
      clock.className = 'clock';
      $('plan').textContent = st.mode === 'pitch' ? `таймер пойдёт с первого → · план ${mmss(SP.end)}` : `план речи ${mmss(SP.end)}`;
    }
  }

  function renderSpeech() {
    const s = SP.slides[st.slide];
    if (!s) return;
    const segs = (st.inBonus && s.bonus ? s.bonus.segs : s.segs) || [];
    const seg = segs[st.seg] || segs[0] || { texts: [], notes: [] };
    $('snum').textContent = pad(s.n);
    $('stitle').textContent = st.inBonus && s.bonus ? `Бонус: ${s.bonus.title.replace(/^Бонус[^·]*·?\s*/i, '')}` : s.title;
    const who = $('who');
    who.textContent = s.speaker; who.className = 'who' + (isAlt(s.speaker) ? ' alt' : '');
    $('swin').textContent = `${mmss(s.from)}–${mmss(s.to)}`;
    $('screen').textContent = s.screen ? `На экране: ${s.screen.replace(/\*/g, '')}` : '';
    const prev = segs[st.seg - 1];
    $('prev').innerHTML = prev && prev.texts.length ? md(prev.texts[prev.texts.length - 1]) : '';
    const beat = $('beat');
    const b = st.beat;
    const showBeat = b && (b.state === 'run' || ((b.state === 'fail' || b.state === 'skipped') && Date.now() + offset - b.at < 60000)) && st.mode === 'pitch';
    beat.hidden = !showBeat;
    if (showBeat) {
      beat.className = 'beat ' + b.state;
      beat.textContent = b.state === 'run' ? `Сейчас на проекторе: ${b.label}${st.queue ? ' · следующий шаг пойдёт сразу после' : ''}` : b.state === 'fail' ? `Шаг не получился, на проекторе слайд: ${b.label}` : `Шаг пропущен: ${b.label}`;
    }
    const carry = (st.carry || []).map((t) => `<p class="carry">${md(t)}</p>`).join('');
    const texts = seg.texts.map((t) => `<p>${md(t)}</p>`).join('');
    $('now').innerHTML = carry + (texts || (seg.dir ? `<p class="dir">[${esc(seg.dir)}]</p>` : '<p class="dir">(пауза, без текста)</p>'));
    // What the next → will do.
    const nx = segs[st.seg + 1];
    let next = '';
    if (nx) next = `<span class="k">→</span><b>${nx.beat ? esc(SP.beats[nx.beat] || nx.dir) : 'дальше по тексту'}</b>${nx.dir ? ` · <span>[${esc(nx.dir)}]</span>` : ''}`;
    else {
      const ns = SP.slides[st.slide + 1];
      next = ns ? `<span class="k">→</span>слайд <b>${pad(ns.n)} · ${esc(ns.title)}</b> · ${esc(ns.speaker)}${ns.speaker !== s.speaker ? ' <b>(передача слова)</b>' : ''}` : '<b>Последний слайд.</b> Дальше вопросы жюри: клавиша Q.';
    }
    if (s.bonus && !st.inBonus) next += `<br><span class="k">4</span><b>бонус: агент вживую</b> · только если вопросы отдельно и утренняя проверка прошла`;
    $('nextstep').innerHTML = next;
    const notes = slideNotes(s);
    const live = [st.note, st.mode === 'pitch' && st.online === false ? 'Сайт недоступен: живые шаги не играют, на проекторе слайды со скриншотами того же сайта. Говорите тот же текст.' : ''].filter(Boolean);
    $('notes').hidden = !notes.length && !live.length;
    $('notes').innerHTML = live.map((t) => `<p class="live">${md(t)}</p>`).join('') + notes.map((t) => `<p>${md(t)}</p>`).join('');
  }

  function renderTour() {
    const t = st.tour || { step: 0, total: SP.tour.length };
    const step = SP.tour[t.step] || {};
    $('snum').textContent = `${t.step + 1}/${t.total}`;
    $('stitle').textContent = step.title || 'Полный тур';
    $('who').textContent = 'тур'; $('who').className = 'who alt';
    $('swin').textContent = t.state === 'done' ? 'тур закончен' : '';
    $('screen').textContent = 'Сайт показывает себя сам, подписи на проекторе. Можно рассказывать своими словами.';
    $('prev').innerHTML = '';
    $('beat').hidden = true;
    $('now').innerHTML = `<p>${md(step.say || '')}</p>`;
    const nx = SP.tour[t.step + 1];
    $('nextstep').innerHTML = nx ? `<span class="k">→</span>пропустить к: <b>${esc(nx.title)}</b> · <span class="k">Esc</span>остановить тур` : '<span class="k">Esc</span>вернуться к колоде';
    $('notes').hidden = !st.note;
    $('notes').innerHTML = st.note ? `<p class="live">${md(st.note)}</p>` : '';
  }

  function renderSide() {
    if (PHONE) return;
    $('slides').innerHTML = SP.slides.map((s, i) => `<li data-i="${i}" class="${i === st.slide && st.mode !== 'tour' ? 'cur' : i < st.slide ? 'done' : ''}${liveSlide(s) ? ' live' : ''}"><b>${pad(s.n)}</b><span>${esc(s.title)}</span><small>${esc((s.speaker || '').slice(0, 1))} ${mmss(s.from)}</small></li>`).join('');
    $('msgs').innerHTML = (st.messages || []).slice().reverse().map((m) => `<p class="${m.kind}">${new Date(m.at).toTimeString().slice(0, 5)} ${esc(m.text)}</p>`).join('');
  }
  $('slides')?.addEventListener('click', (e) => { const li = e.target.closest('li'); if (li) post({ type: 'goto', slide: Number(li.dataset.i) }); });

  function renderStart() {
    const show = forceStart || st.mode === 'idle';
    $('start').hidden = !show;
    if (!show) return;
    const checks = [];
    const add = (cls, text, small) => checks.push(`<div class="check ${cls}"><div>${text}${small ? `<small>${small}</small>` : ''}</div></div>`);
    const sc = st.screens || {};
    if (sc.count >= 2) add('ok', `Проектор найден: ${sc.projector.w}×${sc.projector.h}. Показ на нём на весь экран, это окно на экране ноутбука.`, 'Зал видит только проектор. Суфлёр и пульт видите только вы.');
    else if (sc.count === 1) add('bad', 'Найден один экран: всё, что на ноутбуке, видно в зале.', 'Windows: Win+P → «Расширить». Mac: Системные настройки → Мониторы → «Расширенный рабочий стол» (не «Дублировать»). Окна встанут сами. Если проектор умеет только дублировать: суфлёр на телефоне (кнопка ниже) или распечатанные карточки.');
    else add('', 'Проверяю экраны…');
    if (st.online === null) add('', 'Проверяю сайт…');
    else if (st.online) add(st.gemini ? 'ok' : 'warn', `Сайт на связи${st.places ? `: ${Number(st.places).toLocaleString('ru-RU')} мест` : ''}. ${st.gemini ? 'Gemini отвечает.' : 'Gemini сейчас выключен: подбор работает и без него.'}`, 'Вкладки кофе, турист и агент загружаются за колодой.');
    else add('bad', 'Сайт недоступен: нет интернета или сайт не отвечает.', 'Показ всё равно работает: на живых слайдах останутся скриншоты того же сайта. Проверьте Wi-Fi или раздайте интернет с телефона и нажмите «Проверить сайт».');
    const tabs = st.tabs || {};
    const bad = ['coffee', 'tourist'].filter((k) => tabs[k] && tabs[k].state === 'failed');
    if (bad.length) add('bad', 'Не загрузилась вкладка: ' + bad.map((k) => (k === 'coffee' ? 'кофе' : 'турист')).join(', '), 'Нажмите «Проверить сайт и обновить вкладки».');
    if (st.placement) add(st.mirrored ? 'warn' : 'ok', 'Окна: ' + st.placement);
    $('checks').innerHTML = checks.join('');
    const phone = $('phone');
    phone.hidden = !st.phone;
    if (st.phone && !phone.dataset.done) {
      const url = st.phone.urls[0];
      let img = '';
      try { const q = window.qrcode(0, 'M'); q.addData(url); q.make(); img = `<img alt="QR" src="${q.createDataURL(5, 2)}">`; } catch (e) { /* no QR */ }
      phone.innerHTML = url ? `${img}<div><b>Откройте на телефоне</b> (телефон в той же сети Wi-Fi, что и ноутбук):<br><code>${esc(url)}</code><br><small>${st.phone.urls.slice(1).map(esc).join('<br>')}</small><p>На телефоне тот же текст и кнопки ◀ ⏸ ▶: телефон работает и как кликер.</p></div>` : '<div>У ноутбука нет сети: подключите Wi-Fi или раздачу с телефона.</div>';
      phone.dataset.done = url ? '1' : '';
    }
  }

  function renderQa() {
    $('qa').hidden = !(st.ui && st.ui.qa);
    if ($('qa').hidden || $('qaList').dataset.done) return;
    $('qaList').innerHTML = SP.qa.map((r) => `<div class="qa-item"><b>${md(r.q)}</b><p><span class="${isAlt(r.who) ? 'alt' : ''}">${esc(r.who)}</span>${md(r.a)}</p></div>`).join('');
    $('qaList').dataset.done = '1';
  }

  function render() {
    if (!SP || !st) return;
    document.documentElement.style.setProperty('--fs', `${(PHONE ? 24 : 34) + (st.ui?.font || 0) * 3}px`);
    renderStatus();
    renderClock();
    if (st.mode === 'tour') renderTour(); else renderSpeech();
    renderSide();
    renderStart();
    renderQa();
    $('pauseBtn').textContent = st.paused ? '▶︎ дальше' : '⏸';
  }

  function lists() {
    $('prep').innerHTML = (SP.beforeStage || []).map((t) => `<li>${md(t)}</li>`).join('');
    $('broken').innerHTML = (SP.broken || []).map((t) => `<li>${md(t)}</li>`).join('');
    $('shortIntro').innerHTML = md(SP.short?.intro || '');
    $('short').innerHTML = (SP.short?.items || []).map((t) => `<li>${md(t)}</li>`).join('');
  }

  async function loadSpeech() {
    const r = await fetch('/speech.json?k=' + KEY, { headers: { 'X-Aidem': KEY } });
    SP = await r.json();
    $('qaList').dataset.done = '';
    lists();
    render();
  }
  function connect() {
    const es = new EventSource('/events?k=' + KEY);
    let lastPlanKey = '';
    es.onmessage = (e) => {
      st = JSON.parse(e.data);
      offset = st.now - Date.now();
      // The speech file was re-read: fetch it again.
      const k = st.messages?.filter((m) => /Речь перечитана/.test(m.text)).length || 0;
      if (String(k) !== lastPlanKey) { lastPlanKey = String(k); if (k) loadSpeech(); }
      render();
    };
    es.onerror = () => { $('mode').textContent = 'нет связи с показом'; $('mode').className = 'mode paused'; };
  }
  loadSpeech().then(connect);
  setInterval(renderClock, 500);
})();
