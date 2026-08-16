(() => {
  'use strict';

  const STORAGE_KEY = 'baseballTrackerV1'; // V1 key 유지: 기존 기기 데이터 자동 마이그레이션
  const LAST_SYNC_KEY = 'baseballTrackerCloudLastSync';
  const WEIGHTS = { light: 0.75, moderate: 0.85, full: 1.0, game: 1.0 };
  const STRIKE_RESULTS = new Set(['called', 'swinging', 'foul', 'inplay']);
  const HIT_RESULTS = ['1B','2B','3B','HR','BB','HBP','SO','OUT','ROE','SF'];

  const state = loadState();
  bindActiveDaysAlias();
  ensureActiveAthlete();
  let currentView = 'today';
  let throwContext = 'warmup';
  let hittingMode = 'game';
  let trainingHitType = 'tee';
  let toastTimer = null;
  let deferredInstallPrompt = null;
  const cloud = {
    client: null,
    session: null,
    configured: false,
    syncing: false,
    status: 'local',
    message: '로컬 저장',
    lastSync: Number(localStorage.getItem(LAST_SYNC_KEY) || 0),
    timer: null
  };

  function localDateKey(d = new Date()) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  function emptyDay() {
    return {
      trainingThrows: [],
      gamePitching: {
        pitches: [],
        events: [],
        actions: [],
        balls: 0,
        strikes: 0,
        batterNo: 1,
        currentPAFirstPitchStrike: null,
        firstPitchSamples: [],
        k: 0,
        bb: 0,
        hbp: 0,
        inplayResults: {}
      },
      gameHitting: [],
      baserunning: [],
      trainingSwings: [],
      hittingActions: []
    };
  }

  function dayHasActivity(day) {
    if (!day) return false;
    const gp=day.gamePitching || {};
    return !!(
      (day.trainingThrows?.length) || (gp.pitches?.length) || (gp.events?.length) ||
      (day.gameHitting?.length) || (day.baserunning?.length) || (day.trainingSwings?.length)
    );
  }

  function uuid() {
    if (crypto?.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.random()*16|0, v = c === 'x' ? r : (r&0x3|0x8);
      return v.toString(16);
    });
  }

  function makeAthlete(name = '선수 1') {
    return {
      id: uuid(), name, number:'', birthDate:'', team:'', position:'', throws:'R', bats:'R',
      _updatedAt: Date.now(), _dirty: true
    };
  }

  function initialState() {
    const athlete = makeAthlete('선수 1');
    return { version:4, athletes:[athlete], activeAthleteId:athlete.id, athleteDays:{[athlete.id]:{}}, deletedAthleteIds:[], cloudOwnerId:null };
  }

  function normalizeV4(raw) {
    raw.version = 4;
    raw.athletes = Array.isArray(raw.athletes) ? raw.athletes : [];
    raw.athleteDays = raw.athleteDays && typeof raw.athleteDays === 'object' ? raw.athleteDays : {};
    raw.deletedAthleteIds = Array.isArray(raw.deletedAthleteIds) ? raw.deletedAthleteIds : [];
    if (!('cloudOwnerId' in raw)) raw.cloudOwnerId = null;
    for (const athlete of raw.athletes) {
      athlete.name ||= '선수'; athlete.number ||= ''; athlete.birthDate ||= ''; athlete.team ||= ''; athlete.position ||= '';
      athlete.throws ||= 'R'; athlete.bats ||= 'R'; athlete._updatedAt = Number(athlete._updatedAt || 0); athlete._dirty = !!athlete._dirty;
      raw.athleteDays[athlete.id] ||= {};
    }
    if (!raw.activeAthleteId || !raw.athletes.some(a => a.id === raw.activeAthleteId)) raw.activeAthleteId = raw.athletes[0]?.id || null;
    return raw;
  }

  function migrateLegacy(raw) {
    const athlete = makeAthlete('선수 1');
    const days = raw?.days && typeof raw.days === 'object' ? raw.days : {};
    const now = Date.now();
    let i = 0;
    for (const day of Object.values(days)) {
      if (!Number(day?._updatedAt)) day._updatedAt = now + i++;
      day._dirty = true;
    }
    return { version:4, athletes:[athlete], activeAthleteId:athlete.id, athleteDays:{[athlete.id]:days}, deletedAthleteIds:[], cloudOwnerId:raw?.cloudOwnerId || null };
  }

  function loadState() {
    try {
      const raw = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (raw?.version >= 4 && raw.athletes && raw.athleteDays) return normalizeV4(raw);
      if (raw?.days) return migrateLegacy(raw);
    } catch (_) {}
    return initialState();
  }

  function bindActiveDaysAlias() {
    Object.defineProperty(state, 'days', {
      configurable:true, enumerable:false,
      get() { return activeDays(); },
      set(value) { if (state.activeAthleteId) state.athleteDays[state.activeAthleteId] = value || {}; }
    });
  }

  function ensureActiveAthlete() {
    if (!state.athletes.length) {
      const athlete = makeAthlete('선수 1');
      state.athletes.push(athlete); state.activeAthleteId = athlete.id; state.athleteDays[athlete.id] = {};
    }
    if (!state.athletes.some(a => a.id === state.activeAthleteId)) state.activeAthleteId = state.athletes[0].id;
    state.athleteDays[state.activeAthleteId] ||= {};
  }

  function activeAthlete() { ensureActiveAthlete(); return state.athletes.find(a => a.id === state.activeAthleteId) || state.athletes[0]; }
  function activeDays() { ensureActiveAthlete(); return state.athleteDays[state.activeAthleteId] ||= {}; }

  function saveState(markToday = true) {
    state.version = 4;
    if (markToday) {
      const key = localDateKey();
      const days = activeDays();
      if (days[key]) { days[key]._updatedAt = Date.now(); days[key]._dirty = true; }
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    if (markToday) scheduleCloudSync();
  }

  function getDay(key = localDateKey()) {
    const days = activeDays();
    if (!days[key]) days[key] = emptyDay();
    const d = days[key];
    d.trainingThrows ||= [];
    d.gamePitching ||= emptyDay().gamePitching;
    d.gamePitching.pitches ||= [];
    d.gamePitching.events ||= [];
    d.gamePitching.actions ||= [];
    d.gamePitching.firstPitchSamples ||= [];
    d.gamePitching.inplayResults ||= {};
    d.gamePitching.balls ||= 0;
    d.gamePitching.strikes ||= 0;
    d.gamePitching.batterNo ||= 1;
    d.gamePitching.k ||= 0;
    d.gamePitching.bb ||= 0;
    d.gamePitching.hbp ||= 0;
    if (d.gamePitching.currentPAFirstPitchStrike === undefined) d.gamePitching.currentPAFirstPitchStrike = null;
    d.gameHitting ||= [];
    d.baserunning ||= [];
    d.trainingSwings ||= [];
    d.hittingActions ||= [];
    if (!Number.isFinite(Number(d._updatedAt))) d._updatedAt = 0;
    if (typeof d._dirty !== 'boolean') d._dirty = false;
    return d;
  }

  function fmtDate(key) {
    const [y,m,d] = key.split('-').map(Number);
    return `${m}/${d}`;
  }

  function fmtLongDate(key) {
    const [y,m,d] = key.split('-').map(Number);
    return `${y}.${String(m).padStart(2,'0')}.${String(d).padStart(2,'0')}`;
  }

  function dateShift(days) {
    const d = new Date();
    d.setHours(12,0,0,0);
    d.setDate(d.getDate() + days);
    return localDateKey(d);
  }

  function getDailyStats(day) {
    const t = { light:0, moderate:0, full:0, game:0, tlu:0, trainingTLU:0 };
    for (const x of day.trainingThrows || []) {
      t[x.intensity] = (t[x.intensity] || 0) + 1;
      t.trainingTLU += WEIGHTS[x.intensity] || 0;
      t.tlu += WEIGHTS[x.intensity] || 0;
    }
    const gamePitches = day.gamePitching?.pitches?.length || 0;
    t.game = gamePitches;
    t.full += gamePitches;
    t.tlu += gamePitches;

    const gp = day.gamePitching || emptyDay().gamePitching;
    const strikes = gp.pitches.filter(p => STRIKE_RESULTS.has(p.result)).length;
    const balls = gp.pitches.filter(p => p.result === 'ball').length;
    const strikePct = strikes + balls ? strikes / (strikes + balls) : null;
    const fp = [...(gp.firstPitchSamples || [])];
    if (gp.currentPAFirstPitchStrike !== null && gp.currentPAFirstPitchStrike !== undefined) fp.push(gp.currentPAFirstPitchStrike);
    const fpPct = fp.length ? fp.filter(Boolean).length / fp.length : null;

    const hs = calcHitting(day.gameHitting || []);
    const sw = calcTrainingSwings(day.trainingSwings || []);
    const sb = (day.baserunning || []).filter(x => x.type === 'SB').length + (gp.events || []).filter(x => x.type === 'SB').length;
    const cs = (day.baserunning || []).filter(x => x.type === 'CS').length + (gp.events || []).filter(x => x.type === 'CS').length;

    return { throws: t, game: { strikes, balls, strikePct, fpPct, k:gp.k||0, bb:gp.bb||0, hbp:gp.hbp||0 }, hitting: hs, swings: sw, sb, cs };
  }

  function calcHitting(items) {
    const c = Object.fromEntries(HIT_RESULTS.map(k => [k,0]));
    for (const x of items) if (c[x.result] !== undefined) c[x.result]++;
    const H = c['1B']+c['2B']+c['3B']+c['HR'];
    const AB = H+c.SO+c.OUT+c.ROE;
    const PA = AB+c.BB+c.HBP+c.SF;
    const TB = c['1B']+2*c['2B']+3*c['3B']+4*c.HR;
    const avg = AB ? H/AB : null;
    const obpDen = AB+c.BB+c.HBP+c.SF;
    const obp = obpDen ? (H+c.BB+c.HBP)/obpDen : null;
    const slg = AB ? TB/AB : null;
    const ops = obp !== null && slg !== null ? obp+slg : null;
    return { ...c, H, AB, PA, TB, avg, obp, slg, ops };
  }

  function calcTrainingSwings(items) {
    const total = items.length;
    const whiff = items.filter(x => x.quality === 'whiff').length;
    const hard = items.filter(x => x.quality === 'hard').length;
    const contact = total - whiff;
    return { total, whiff, hard, contact, contactPct: total ? contact/total : null, hardPct: contact ? hard/contact : null };
  }

  function decimalStat(v) {
    return v === null || Number.isNaN(v) ? '—' : v.toFixed(3).replace(/^0/,'');
  }
  function pct(v, digits = 1) { return v === null || Number.isNaN(v) ? '—' : `${(v*100).toFixed(digits)}%`; }
  function one(v) { return (Math.round(v*10)/10).toFixed(v % 1 ? 1 : 0); }

  function showToast(msg) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 1400);
  }

  function go(view) {
    currentView = view;
    document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.dataset.view === view));
    document.querySelectorAll('[data-nav]').forEach(b => b.classList.toggle('active', b.dataset.nav === view));
    const titles = { today:'오늘', throwing:'훈련 투구', gamePitch:'경기 투구', hitting:'타격 · 주루', history:'기록 · 통계', settings:'설정' };
    document.getElementById('pageTitle').textContent = titles[view] || 'Baseball Tracker';
    render();
    window.scrollTo({top:0,behavior:'smooth'});
  }

  function esc(value) {
    return String(value ?? '').replace(/[&<>'"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch]));
  }

  function athleteMeta(a) {
    const bits = [];
    if (a.number) bits.push(`#${a.number}`);
    if (a.team) bits.push(a.team);
    if (a.position) bits.push(a.position);
    if (!bits.length) bits.push(`${a.throws==='L'?'좌':'우'}투 · ${a.bats==='L'?'좌':a.bats==='S'?'양':'우'}타`);
    return bits.join(' · ');
  }

  function athleteRowHtml(a, picker=false) {
    const active = a.id === state.activeAthleteId;
    const initial = (a.name || '선').trim().slice(0,1).toUpperCase();
    return `<button class="athlete-row ${active?'active':''}" data-athlete-select="${esc(a.id)}" type="button"><span class="athlete-row-avatar">${esc(initial)}</span><span class="athlete-row-copy"><strong>${esc(a.name)}</strong><small>${esc(athleteMeta(a))}</small></span><span class="athlete-row-check">${active?'✓':'›'}</span></button>`;
  }

  function renderAthletes() {
    ensureActiveAthlete();
    const a = activeAthlete();
    const name = document.getElementById('activeAthleteName'); if (name) name.textContent = a.name;
    const initial = document.getElementById('athleteInitial'); if (initial) initial.textContent = (a.name || '선').trim().slice(0,1).toUpperCase();
    const count = document.getElementById('athleteCount'); if (count) count.textContent = `${state.athletes.length}명`;
    const rows = state.athletes.map(x => athleteRowHtml(x)).join('');
    const list = document.getElementById('athleteList'); if (list) list.innerHTML = rows;
    const picker = document.getElementById('athletePickerList'); if (picker) picker.innerHTML = rows;
  }

  function switchAthlete(id) {
    if (!state.athletes.some(a => a.id === id)) return;
    state.activeAthleteId = id;
    state.athleteDays[id] ||= {};
    saveState(false);
    document.getElementById('athletePickerModal').hidden = true;
    render();
    showToast(`${activeAthlete().name} 선수로 전환`);
  }

  function openAthleteModal(id = null) {
    const athlete = id ? state.athletes.find(a => a.id === id) : null;
    document.getElementById('athleteModalTitle').textContent = athlete ? '선수 정보 수정' : '선수 추가';
    document.getElementById('athleteId').value = athlete?.id || '';
    document.getElementById('athleteName').value = athlete?.name || '';
    document.getElementById('athleteNumber').value = athlete?.number || '';
    document.getElementById('athleteBirthDate').value = athlete?.birthDate || '';
    document.getElementById('athleteTeam').value = athlete?.team || '';
    document.getElementById('athletePosition').value = athlete?.position || '';
    document.getElementById('athleteThrows').value = athlete?.throws || 'R';
    document.getElementById('athleteBats').value = athlete?.bats || 'R';
    document.getElementById('deleteAthleteBtn').hidden = !athlete;
    document.getElementById('athleteModal').hidden = false;
    setTimeout(() => document.getElementById('athleteName').focus(), 30);
  }

  function saveAthleteFromForm(event) {
    event.preventDefault();
    const id = document.getElementById('athleteId').value;
    const name = document.getElementById('athleteName').value.trim();
    if (!name) return showToast('선수 이름을 입력하세요');
    let athlete = id ? state.athletes.find(a => a.id === id) : null;
    if (!athlete) {
      athlete = makeAthlete(name);
      state.athletes.push(athlete);
      state.athleteDays[athlete.id] = {};
      state.activeAthleteId = athlete.id;
    }
    Object.assign(athlete, {
      name,
      number:document.getElementById('athleteNumber').value.trim(),
      birthDate:document.getElementById('athleteBirthDate').value || '',
      team:document.getElementById('athleteTeam').value.trim(),
      position:document.getElementById('athletePosition').value.trim(),
      throws:document.getElementById('athleteThrows').value,
      bats:document.getElementById('athleteBats').value,
      _updatedAt:Date.now(), _dirty:true
    });
    saveState(false); scheduleCloudSync(80); render();
    document.getElementById('athleteModal').hidden = true;
    showToast(id ? '선수 정보를 수정했습니다' : '선수를 추가했습니다');
  }

  function deleteCurrentAthlete() {
    const id = document.getElementById('athleteId').value || state.activeAthleteId;
    const athlete = state.athletes.find(a => a.id === id);
    if (!athlete) return;
    if (!confirm(`${athlete.name} 선수와 이 선수의 모든 기록을 삭제할까요?`)) return;
    state.deletedAthleteIds ||= [];
    if (!state.deletedAthleteIds.includes(id)) state.deletedAthleteIds.push(id);
    state.athletes = state.athletes.filter(a => a.id !== id);
    delete state.athleteDays[id];
    if (state.activeAthleteId === id) state.activeAthleteId = state.athletes[0]?.id || null;
    ensureActiveAthlete();
    saveState(false); scheduleCloudSync(50); render();
    document.getElementById('athleteModal').hidden = true;
    showToast('선수를 삭제했습니다');
  }

  function recordTrainingThrow(intensity) {
    const d = getDay();
    d.trainingThrows.push({ ts:Date.now(), intensity, context:throwContext });
    saveState();
    showToast(`${labelIntensity(intensity)} +1`);
    render();
  }

  function labelIntensity(i) { return i==='light'?'가벼운':i==='moderate'?'적정':'전력'; }

  function undoTrainingThrow() {
    const d = getDay();
    if (!d.trainingThrows.length) return showToast('취소할 기록이 없습니다');
    d.trainingThrows.pop(); saveState(); render(); showToast('마지막 훈련 투구 취소');
  }

  function snapshotGame(gp) {
    return JSON.parse(JSON.stringify({
      pitches:gp.pitches, events:gp.events, balls:gp.balls, strikes:gp.strikes,
      batterNo:gp.batterNo, currentPAFirstPitchStrike:gp.currentPAFirstPitchStrike,
      firstPitchSamples:gp.firstPitchSamples, k:gp.k, bb:gp.bb, hbp:gp.hbp,
      inplayResults:gp.inplayResults
    }));
  }

  function restoreGame(gp, snap) {
    Object.assign(gp, JSON.parse(JSON.stringify(snap)));
  }

  function pushGameAction(gp, kind) {
    gp.actions.push({ kind, before:snapshotGame(gp), ts:Date.now() });
  }

  function markFirstPitchIfNeeded(gp, result) {
    if (gp.currentPAFirstPitchStrike !== null) return;
    gp.currentPAFirstPitchStrike = STRIKE_RESULTS.has(result);
  }

  function endPA(gp, reason) {
    if (gp.currentPAFirstPitchStrike !== null) gp.firstPitchSamples.push(gp.currentPAFirstPitchStrike);
    gp.currentPAFirstPitchStrike = null;
    gp.balls = 0;
    gp.strikes = 0;
    gp.batterNo += 1;
    return reason;
  }

  function recordPitch(result) {
    const d = getDay(); const gp = d.gamePitching;
    pushGameAction(gp, 'pitch');
    markFirstPitchIfNeeded(gp, result);
    const p = { id:`p${Date.now()}${Math.random().toString(16).slice(2)}`, ts:Date.now(), result, secondary:[] };
    gp.pitches.push(p);
    let msg = '경기 투구 +1';

    if (result === 'ball') {
      if (gp.balls >= 3) { gp.bb++; endPA(gp,'BB'); msg = '볼넷 · 다음 타자'; }
      else gp.balls++;
    } else if (result === 'called' || result === 'swinging') {
      if (gp.strikes >= 2) { gp.k++; endPA(gp,'K'); msg = '삼진 · 다음 타자'; }
      else gp.strikes++;
    } else if (result === 'foul') {
      if (gp.strikes < 2) gp.strikes++;
    } else if (result === 'inplay') {
      endPA(gp,'INPLAY');
      document.getElementById('inplayModal').hidden = false;
    } else if (result === 'hbp') {
      gp.hbp++;
      endPA(gp,'HBP');
      msg = '사구 · 다음 타자';
    }
    saveState(); render(); showToast(msg);
  }

  function attachSecondary(tag) {
    const gp = getDay().gamePitching;
    if (!gp.pitches.length) return showToast('먼저 실제 투구를 기록하세요');
    pushGameAction(gp, 'secondary');
    const last = gp.pitches[gp.pitches.length-1];
    last.secondary ||= [];
    if (last.secondary.includes(tag)) last.secondary = last.secondary.filter(x => x !== tag);
    else last.secondary.push(tag);
    saveState(); render(); showToast(`${tag} ${last.secondary.includes(tag)?'추가':'해제'}`);
  }

  function recordGameEvent(type) {
    const gp = getDay().gamePitching;
    pushGameAction(gp, 'event');
    gp.events.push({ts:Date.now(), type});
    if (type === 'IBB') {
      gp.bb++;
      if (gp.currentPAFirstPitchStrike !== null) gp.firstPitchSamples.push(gp.currentPAFirstPitchStrike);
      gp.currentPAFirstPitchStrike = null; gp.balls=0; gp.strikes=0; gp.batterNo++;
    }
    saveState(); render(); showToast(type === 'BALK' ? '보크 기록' : `${type} 기록`);
  }

  function manualNextBatter() {
    const gp = getDay().gamePitching;
    pushGameAction(gp, 'next');
    endPA(gp,'MANUAL'); saveState(); render(); showToast('다음 타자');
  }

  function undoGameAction() {
    const gp = getDay().gamePitching;
    const a = gp.actions.pop();
    if (!a) return showToast('취소할 경기 입력이 없습니다');
    const actions = gp.actions;
    restoreGame(gp, a.before);
    gp.actions = actions;
    saveState(); render(); showToast('마지막 경기 입력 취소');
  }

  function setInplayResult(result) {
    const gp = getDay().gamePitching;
    const last = [...gp.pitches].reverse().find(p => p.result === 'inplay' && !gp.inplayResults[p.id]);
    if (last) gp.inplayResults[last.id] = result;
    document.getElementById('inplayModal').hidden = true;
    saveState(); render(); showToast(`인플레이 ${result}`);
  }

  function recordHit(result) {
    const d = getDay();
    d.gameHitting.push({ts:Date.now(), result});
    d.hittingActions.push({kind:'hit'});
    saveState(); render(); showToast(`${result} 기록`);
  }

  function recordBase(type) {
    const d = getDay();
    d.baserunning.push({ts:Date.now(), type});
    d.hittingActions.push({kind:'base'});
    saveState(); render(); showToast(type === 'SB' ? '도루 성공 +1' : '도루 실패 +1');
  }

  function undoHitting() {
    const d = getDay(); const a = d.hittingActions.pop();
    if (!a) return showToast('취소할 타격/주루 기록이 없습니다');
    if (a.kind === 'hit') d.gameHitting.pop(); else d.baserunning.pop();
    saveState(); render(); showToast('마지막 입력 취소');
  }

  function recordSwing(quality) {
    const d = getDay();
    d.trainingSwings.push({ts:Date.now(), type:trainingHitType, quality});
    saveState(); render(); showToast('스윙 +1');
  }

  function undoTrainingSwing() {
    const d = getDay();
    if (!d.trainingSwings.length) return showToast('취소할 스윙이 없습니다');
    d.trainingSwings.pop(); saveState(); render(); showToast('마지막 스윙 취소');
  }

  function rollingTLU(days) {
    let total = 0;
    for (let i=0;i<days;i++) {
      const key = dateShift(-i);
      const d = state.days[key];
      if (d) total += getDailyStats(d).throws.tlu;
    }
    return total;
  }

  function renderToday() {
    const d = getDay(); const s = getDailyStats(d);
    document.getElementById('todayThrows').textContent = s.throws.light+s.throws.moderate+s.throws.full;
    document.getElementById('todayTLU').textContent = one(s.throws.tlu);
    document.getElementById('todaySwings').textContent = s.swings.total;
    document.getElementById('todayLight').textContent = s.throws.light;
    document.getElementById('todayModerate').textContent = s.throws.moderate;
    document.getElementById('todayFull').textContent = s.throws.full;
    document.getElementById('todayGamePitches').textContent = s.throws.game;
    document.getElementById('rolling7').textContent = one(rollingTLU(7));
    document.getElementById('todayStrikePct').textContent = pct(s.game.strikePct);
    document.getElementById('todayFPSPct').textContent = pct(s.game.fpPct);
    document.getElementById('todayKBB').textContent = `${s.game.k} / ${s.game.bb}`;
    document.getElementById('todayAVG').textContent = decimalStat(s.hitting.avg);
    document.getElementById('todayOPS').textContent = decimalStat(s.hitting.ops);
    document.getElementById('todaySBCS').textContent = `${s.sb} / ${s.cs}`;
  }

  function renderThrowing() {
    const d=getDay(); const s=getDailyStats(d);
    document.getElementById('trainingThrowTotal').textContent = d.trainingThrows.length;
    document.getElementById('trainingTLU').textContent = one(s.throws.trainingTLU);
    const contexts = [['warmup','몸풀기'],['defense','수비송구'],['bullpen','불펜'],['other','기타']];
    document.getElementById('throwContextBreakdown').innerHTML = contexts.map(([k,l])=>{
      const arr=d.trainingThrows.filter(x=>x.context===k);
      const t=arr.reduce((a,x)=>a+(WEIGHTS[x.intensity]||0),0);
      return `<div class="breakdown-row"><span>${l}</span><b>${arr.length}구 · ${one(t)} TLU</b></div>`;
    }).join('');
  }

  function renderGame() {
    const gp=getDay().gamePitching; const s=getDailyStats(getDay());
    document.getElementById('ballCount').textContent=gp.balls;
    document.getElementById('strikeCount').textContent=gp.strikes;
    document.getElementById('gamePitchCount').textContent=gp.pitches.length;
    document.getElementById('gameStrikePct').textContent=pct(s.game.strikePct);
    document.getElementById('gameFPSPct').textContent=pct(s.game.fpPct);
    document.getElementById('currentBatterNo').textContent=gp.batterNo;
    const batterMirror=document.getElementById('currentBatterNoMirror'); if (batterMirror) batterMirror.textContent=gp.batterNo;
    document.getElementById('gameK').textContent=gp.k;
    document.getElementById('gameBB').textContent=gp.bb;
    document.getElementById('gameHBP').textContent=gp.hbp;
    document.getElementById('gameWP').textContent=gp.pitches.filter(p=>(p.secondary||[]).includes('WP')).length;
    document.getElementById('gameBalk').textContent=gp.events.filter(e=>e.type==='BALK').length;
  }

  function renderHitting() {
    const d=getDay(); const h=calcHitting(d.gameHitting); const sw=calcTrainingSwings(d.trainingSwings);
    document.getElementById('hittingPA').textContent=`${h.PA} PA`;
    document.getElementById('hittingSlash').textContent=`AVG ${decimalStat(h.avg)} · OBP ${decimalStat(h.obp)} · SLG ${decimalStat(h.slg)}`;
    document.getElementById('trainingSwingTotal').textContent=`${sw.total} swings`;
    document.getElementById('trainingContactPct').textContent=`Contact ${pct(sw.contactPct)} · 강한 타구 ${pct(sw.hardPct)}`;
    document.getElementById('gameHittingPanel').hidden = hittingMode !== 'game';
    document.getElementById('trainingHittingPanel').hidden = hittingMode !== 'training';
  }

  function renderHistory() {
    document.getElementById('history7TLU').textContent=one(rollingTLU(7));
    document.getElementById('history28TLU').textContent=one(rollingTLU(28));
    const seven=[];
    for(let i=6;i>=0;i--) { const key=dateShift(-i); const d=state.days[key]||emptyDay(); seven.push({key,tlu:getDailyStats(d).throws.tlu}); }
    const max=Math.max(1,...seven.map(x=>x.tlu));
    document.getElementById('tluChart').innerHTML=seven.map(x=>`<div class="bar-item"><div class="bar-shell"><div class="bar" style="height:${Math.max(2,(x.tlu/max)*100)}%"></div></div><b>${one(x.tlu)}</b><small>${fmtDate(x.key)}</small></div>`).join('');

    const keys=Object.keys(state.days).filter(key=>dayHasActivity(state.days[key])).sort().reverse();
    const list=document.getElementById('historyList');
    if(!keys.length){ list.innerHTML='<div class="history-item"><div class="history-sub">아직 기록이 없습니다.</div></div>'; return; }
    list.innerHTML=keys.map(key=>{
      const s=getDailyStats(state.days[key]);
      const total=s.throws.light+s.throws.moderate+s.throws.full;
      return `<article class="history-item"><div class="history-main"><strong>${fmtLongDate(key)}</strong><b>${total}구 · ${one(s.throws.tlu)} TLU</b></div><div class="history-sub">가벼운 ${s.throws.light} · 적정 ${s.throws.moderate} · 전력 ${s.throws.full} · 경기 ${s.throws.game}<br>경기 Strike ${pct(s.game.strikePct)} · K ${s.game.k} / BB ${s.game.bb} · AVG ${decimalStat(s.hitting.avg)} · SB ${s.sb} / CS ${s.cs}</div></article>`;
    }).join('');
  }

  function render() {
    document.getElementById('todayLabel').textContent=fmtLongDate(localDateKey());
    renderAthletes(); renderToday(); renderThrowing(); renderGame(); renderHitting(); renderHistory();
  }

  function exportData() {
    const blob=new Blob([JSON.stringify(state,null,2)],{type:'application/json'});
    const a=document.createElement('a');
    a.href=URL.createObjectURL(blob); a.download=`baseball-tracker-${localDateKey()}.json`; a.click();
    setTimeout(()=>URL.revokeObjectURL(a.href),1000); showToast('데이터를 내보냈습니다');
  }

  function importData(file) {
    const r=new FileReader();
    r.onload=()=>{
      try {
        const data=JSON.parse(r.result);
        let incoming;
        if (data?.version >= 4 && Array.isArray(data.athletes) && data.athleteDays) incoming = normalizeV4(data);
        else if (data?.days) incoming = migrateLegacy(data);
        else throw new Error('invalid');
        state.athletes = incoming.athletes;
        state.activeAthleteId = incoming.activeAthleteId;
        state.athleteDays = incoming.athleteDays;
        state.deletedAthleteIds = incoming.deletedAthleteIds || [];
        const now=Date.now();
        state.athletes.forEach((a,i)=>{ a._updatedAt=now+i; a._dirty=true; });
        Object.values(state.athleteDays).forEach(days => Object.values(days).forEach((day,i)=>{ day._updatedAt=now+i+100; day._dirty=true; }));
        ensureActiveAthlete(); saveState(false); scheduleCloudSync(50); render(); showToast('데이터를 불러왔습니다');
      } catch(_) { showToast('올바른 백업 파일이 아닙니다'); }
    };
    r.readAsText(file);
  }


  function getCloudConfig() {
    const cfg = window.BASEBALL_SUPABASE_CONFIG || {};
    const url = String(cfg.url || '').trim();
    const key = String(cfg.publishableKey || '').trim();
    const placeholder = !url || !key || url.includes('YOUR-PROJECT') || key.includes('YOUR_PUBLISHABLE_KEY');
    return { url, key, valid: !placeholder && /^https:\/\//i.test(url) };
  }

  function setCloudStatus(status, message) {
    cloud.status = status;
    cloud.message = message;
    renderCloudStatus();
  }

  function cleanDayForCloud(day) {
    const copy = JSON.parse(JSON.stringify(day || {}));
    delete copy._updatedAt; delete copy._dirty;
    return copy;
  }

  function dayFromCloud(data, updatedAt) {
    const day = data && typeof data === 'object' ? JSON.parse(JSON.stringify(data)) : emptyDay();
    day._updatedAt = Number(updatedAt || 0); day._dirty = false;
    return day;
  }

  function athleteFromCloud(row) {
    return {
      id:row.id, name:row.name || '선수', number:row.number || '', birthDate:row.birth_date || '',
      team:row.team || '', position:row.position || '', throws:row.throws || 'R', bats:row.bats || 'R',
      _updatedAt:Number(row.client_updated_at || 0), _dirty:false
    };
  }

  function athleteToCloud(a, userId) {
    return {
      id:a.id, owner_id:userId, name:a.name || '선수', number:a.number || null,
      birth_date:a.birthDate || null, team:a.team || null, position:a.position || null,
      throws:a.throws || 'R', bats:a.bats || 'R', client_updated_at:Number(a._updatedAt || Date.now())
    };
  }

  function hasMeaningfulLocalData() {
    const dayCount = Object.values(state.athleteDays || {}).reduce((n,days)=>n+Object.values(days || {}).filter(dayHasActivity).length,0);
    if (dayCount) return true;
    if (state.athletes.length > 1) return true;
    const a = state.athletes[0];
    if (!a) return false;
    return a.name !== '선수 1' || !!(a.number || a.birthDate || a.team || a.position);
  }

  function hasDirtyCloudWork() {
    if ((state.deletedAthleteIds || []).length) return true;
    if (state.athletes.some(a => a._dirty)) return true;
    return Object.values(state.athleteDays || {}).some(days => Object.values(days || {}).some(day => day?._dirty));
  }

  function scheduleCloudSync(delay = 800) {
    clearTimeout(cloud.timer);
    if (!cloud.configured || !cloud.session || cloud.syncing || !navigator.onLine) { renderCloudStatus(); return; }
    cloud.timer = setTimeout(() => syncCloud(false), delay);
  }

  async function initCloud() {
    const cfg = getCloudConfig();
    cloud.configured = cfg.valid && !!window.supabase?.createClient;
    if (!cloud.configured) {
      setCloudStatus('local', 'Supabase 미설정 · 이 기기에만 저장'); renderCloudAuth(); return;
    }
    try {
      cloud.client = window.supabase.createClient(cfg.url, cfg.key, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
      });
      const { data, error } = await cloud.client.auth.getSession();
      if (error) throw error;
      cloud.session = data.session || null;
      cloud.client.auth.onAuthStateChange((_event, session) => {
        cloud.session = session || null;
        renderCloudAuth(); renderCloudStatus();
        if (cloud.session) scheduleCloudSync(100);
      });
      renderCloudAuth();
      if (cloud.session) {
        setCloudStatus(navigator.onLine ? 'syncing' : 'offline', navigator.onLine ? '로그인 유지됨 · 동기화 준비' : '오프라인 · 로컬 저장 중');
        if (navigator.onLine) scheduleCloudSync(100);
      } else setCloudStatus('local', '로그인하면 여러 기기에서 선수별 기록을 동기화합니다');
    } catch (err) {
      console.error(err); setCloudStatus('error', 'Supabase 연결 실패 · 설정을 확인하세요'); renderCloudAuth();
    }
  }

  async function syncCloud(manual = false) {
    if (!cloud.configured || !cloud.client || !cloud.session) { if (manual) showToast('먼저 클라우드에 로그인하세요'); return; }
    if (!navigator.onLine) { setCloudStatus('offline', '오프라인 · 기록은 이 기기에 안전하게 저장 중'); if (manual) showToast('인터넷 연결 후 자동 동기화됩니다'); return; }
    if (cloud.syncing) return;
    cloud.syncing = true; setCloudStatus('syncing', '선수와 기록 동기화 중…');
    try {
      const userId = cloud.session.user.id;
      if (state.cloudOwnerId && state.cloudOwnerId !== userId) {
        if (hasMeaningfulLocalData()) throw new Error('이 기기의 기록이 다른 계정에 연결되어 있습니다. 데이터 백업 후 로컬 데이터를 비우고 다시 로그인하세요.');
        state.athletes = []; state.athleteDays = {}; state.activeAthleteId = null; state.deletedAthleteIds = [];
      }
      state.cloudOwnerId = userId;

      // 오프라인에서 삭제한 선수부터 서버에서 제거합니다. athlete_days는 FK cascade로 함께 삭제됩니다.
      if ((state.deletedAthleteIds || []).length) {
        const ids = [...new Set(state.deletedAthleteIds)];
        const { error: delError } = await cloud.client.from('athletes').delete().eq('owner_id', userId).in('id', ids);
        if (delError) throw delError;
        state.deletedAthleteIds = [];
      }

      const { data: remoteAthletes, error: athleteReadError } = await cloud.client
        .from('athletes').select('id,name,number,birth_date,team,position,throws,bats,client_updated_at');
      if (athleteReadError) throw athleteReadError;
      const remoteAthleteMap = new Map((remoteAthletes || []).map(r => [r.id,r]));
      let changed = false;

      // 서버 선수 프로필을 로컬과 timestamp 기준으로 병합합니다.
      for (const row of remoteAthletes || []) {
        const idx = state.athletes.findIndex(a => a.id === row.id);
        const remoteTs = Number(row.client_updated_at || 0);
        const localTs = Number(idx >= 0 ? state.athletes[idx]._updatedAt || 0 : 0);
        if (idx < 0) { state.athletes.push(athleteFromCloud(row)); state.athleteDays[row.id] ||= {}; changed = true; }
        else if (remoteTs > localTs) { state.athletes[idx] = athleteFromCloud(row); state.athleteDays[row.id] ||= {}; changed = true; }
      }

      if (!state.athletes.length) { const a=makeAthlete('선수 1'); state.athletes.push(a); state.activeAthleteId=a.id; state.athleteDays[a.id]={}; changed=true; }
      if (!state.activeAthleteId || !state.athletes.some(a => a.id === state.activeAthleteId)) state.activeAthleteId = state.athletes[0].id;

      const athletePush = [];
      for (const a of state.athletes) {
        const remote = remoteAthleteMap.get(a.id);
        let localTs = Number(a._updatedAt || 0), remoteTs = Number(remote?.client_updated_at || 0);
        if (!remote && localTs === 0) { localTs=Date.now(); a._updatedAt=localTs; a._dirty=true; }
        if (!remote || localTs > remoteTs || (a._dirty && localTs >= remoteTs)) athletePush.push(athleteToCloud(a,userId));
      }
      if (athletePush.length) {
        const { error } = await cloud.client.from('athletes').upsert(athletePush,{onConflict:'id'});
        if (error) throw error;
        for (const pushed of athletePush) {
          const a=state.athletes.find(x=>x.id===pushed.id);
          if (a && Number(a._updatedAt)===Number(pushed.client_updated_at)) a._dirty=false;
        }
        changed=true;
      }

      // 선수별 날짜 데이터를 병합합니다.
      const { data: remoteDays, error: dayReadError } = await cloud.client
        .from('athlete_days').select('athlete_id,day,data,client_updated_at');
      if (dayReadError) throw dayReadError;
      const remoteDayMap = new Map();
      for (const row of remoteDays || []) {
        const key=`${row.athlete_id}|${row.day}`; remoteDayMap.set(key,row);
        state.athleteDays[row.athlete_id] ||= {};
        const local=state.athleteDays[row.athlete_id][row.day];
        const localTs=Number(local?._updatedAt||0), remoteTs=Number(row.client_updated_at||0);
        if (!local || remoteTs>localTs) { state.athleteDays[row.athlete_id][row.day]=dayFromCloud(row.data,remoteTs); changed=true; }
      }

      const dayPush=[];
      for (const a of state.athletes) {
        const days=state.athleteDays[a.id] ||= {};
        for (const [dayKey,day] of Object.entries(days)) {
          const remote=remoteDayMap.get(`${a.id}|${dayKey}`);
          if (!remote && !dayHasActivity(day)) continue;
          let localTs=Number(day?._updatedAt||0), remoteTs=Number(remote?.client_updated_at||0);
          if (!remote && localTs===0) { localTs=Date.now(); day._updatedAt=localTs; day._dirty=true; changed=true; }
          if (!remote || localTs>remoteTs || (day._dirty && localTs>=remoteTs)) {
            dayPush.push({owner_id:userId,athlete_id:a.id,day:dayKey,data:cleanDayForCloud(day),client_updated_at:localTs||Date.now()});
          }
        }
      }
      if (dayPush.length) {
        const { error } = await cloud.client.from('athlete_days').upsert(dayPush,{onConflict:'owner_id,athlete_id,day'});
        if (error) throw error;
        for (const pushed of dayPush) {
          const day=state.athleteDays[pushed.athlete_id]?.[pushed.day];
          if (day && Number(day._updatedAt)===Number(pushed.client_updated_at)) day._dirty=false;
        }
        changed=true;
      }

      if (changed) saveState(false);
      cloud.lastSync=Date.now(); localStorage.setItem(LAST_SYNC_KEY,String(cloud.lastSync));
      setCloudStatus('synced','선수별 기록 동기화 완료'); render();
      if (manual) showToast('클라우드 동기화 완료');
    } catch (err) {
      console.error('Cloud sync failed:',err); setCloudStatus('error',`동기화 실패 · ${err?.message || '연결을 확인하세요'}`);
      if (manual) showToast('동기화에 실패했습니다');
    } finally {
      cloud.syncing=false; renderCloudStatus(); if (cloud.status==='synced' && hasDirtyCloudWork()) scheduleCloudSync(400);
    }
  }

  function renderCloudStatus() {
    const pill = document.getElementById('cloudPill');
    const badge = document.getElementById('cloudBadge');
    const text = document.getElementById('cloudStatusText');
    const last = document.getElementById('cloudLastSync');
    if (!pill || !badge || !text || !last) return;

    let status = cloud.status;
    let label = '로컬';
    if (cloud.configured && cloud.session) {
      if (!navigator.onLine) status = 'offline';
      label = status === 'syncing' ? '동기화' : status === 'synced' ? '☁ 완료' : status === 'offline' ? '오프라인' : status === 'error' ? '오류' : '클라우드';
    } else if (cloud.configured) {
      label = '로그인';
    }
    for (const el of [pill, badge]) {
      el.className = el.id === 'cloudPill' ? `cloud-pill ${status}` : `cloud-badge ${status}`;
      el.textContent = label;
    }
    text.textContent = !navigator.onLine && cloud.session ? '오프라인 · 기록은 로컬에 저장되고 연결 후 자동 동기화됩니다' : cloud.message;
    last.textContent = cloud.lastSync ? `마지막 ${new Date(cloud.lastSync).toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit'})}` : '';
  }

  function renderCloudAuth() {
    const notConfigured = document.getElementById('cloudNotConfigured');
    const loggedOut = document.getElementById('cloudLoggedOut');
    const loggedIn = document.getElementById('cloudLoggedIn');
    const email = document.getElementById('cloudUserEmail');
    if (!notConfigured || !loggedOut || !loggedIn) return;
    notConfigured.hidden = cloud.configured;
    loggedOut.hidden = !cloud.configured || !!cloud.session;
    loggedIn.hidden = !cloud.configured || !cloud.session;
    if (email) email.textContent = cloud.session?.user?.email || '로그인됨';
  }

  async function signInCloud() {
    if (!cloud.client) return showToast('Supabase 설정이 필요합니다');
    const email = document.getElementById('authEmail').value.trim();
    const password = document.getElementById('authPassword').value;
    if (!email || !password) return showToast('이메일과 비밀번호를 입력하세요');
    setCloudStatus('syncing', '로그인 중…');
    const { error } = await cloud.client.auth.signInWithPassword({ email, password });
    if (error) {
      setCloudStatus('error', `로그인 실패 · ${error.message}`);
      return showToast('로그인에 실패했습니다');
    }
    document.getElementById('authPassword').value = '';
    showToast('로그인되었습니다');
    scheduleCloudSync(50);
  }

  async function signUpCloud() {
    if (!cloud.client) return showToast('Supabase 설정이 필요합니다');
    const email = document.getElementById('authEmail').value.trim();
    const password = document.getElementById('authPassword').value;
    if (!email || password.length < 6) return showToast('이메일과 6자 이상 비밀번호를 입력하세요');
    setCloudStatus('syncing', '계정 생성 중…');
    const redirectTo = new URL('./', window.location.href).href;
    const { data, error } = await cloud.client.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: redirectTo }
    });
    if (error) {
      setCloudStatus('error', `가입 실패 · ${error.message}`);
      return showToast('계정 생성에 실패했습니다');
    }
    document.getElementById('authPassword').value = '';
    if (data.session) {
      showToast('계정 생성 및 로그인 완료');
      scheduleCloudSync(50);
    } else {
      setCloudStatus('local', '가입 완료 · 이메일 확인 후 로그인하세요');
      showToast('확인 이메일을 확인하세요');
    }
  }

  async function signOutCloud() {
    if (!cloud.client) return;
    const { error } = await cloud.client.auth.signOut({ scope: 'local' });
    if (error) return showToast('로그아웃에 실패했습니다');
    cloud.session = null;
    setCloudStatus('local', '로그아웃됨 · 로컬 기록은 유지됩니다');
    renderCloudAuth();
    showToast('이 기기에서 로그아웃했습니다');
  }

  async function deleteCloudAndLocal() {
    if (!cloud.session || !cloud.client) return showToast('클라우드에 로그인해야 합니다');
    if (!confirm('이 계정의 모든 선수와 모든 야구 기록을 클라우드와 이 기기에서 삭제할까요? 이 작업은 되돌릴 수 없습니다.')) return;
    const userId=cloud.session.user.id;
    const { error } = await cloud.client.from('athletes').delete().eq('owner_id',userId);
    if (error) return showToast('클라우드 삭제에 실패했습니다');
    // V3 legacy 테이블이 존재하는 경우의 기존 단일선수 데이터도 제거합니다.
    try { await cloud.client.from('tracker_days').delete().eq('user_id',userId); } catch (_) {}
    const fresh=initialState();
    state.athletes=fresh.athletes; state.activeAthleteId=fresh.activeAthleteId; state.athleteDays=fresh.athleteDays;
    state.deletedAthleteIds=[]; state.cloudOwnerId=userId;
    saveState(false);
    cloud.lastSync=Date.now(); localStorage.setItem(LAST_SYNC_KEY,String(cloud.lastSync));
    render(); setCloudStatus('synced','클라우드와 로컬 데이터 초기화 완료'); showToast('모든 선수 기록을 삭제했습니다');
  }


  document.addEventListener('click', e => {
    const t=e.target.closest('button'); if(!t) return;
    if(t.dataset.nav) return go(t.dataset.nav);
    if(t.dataset.go) return go(t.dataset.go);
    if(t.dataset.athleteSelect) return switchAthlete(t.dataset.athleteSelect);
    if(t.dataset.context){ throwContext=t.dataset.context; document.querySelectorAll('#throwContext button').forEach(b=>b.classList.toggle('active',b===t)); return; }
    if(t.dataset.throwIntensity) return recordTrainingThrow(t.dataset.throwIntensity);
    if(t.dataset.pitchResult) return recordPitch(t.dataset.pitchResult);
    if(t.dataset.secondary) return attachSecondary(t.dataset.secondary);
    if(t.dataset.gameEvent) return recordGameEvent(t.dataset.gameEvent);
    if(t.dataset.hit) return recordHit(t.dataset.hit);
    if(t.dataset.baseEvent) return recordBase(t.dataset.baseEvent);
    if(t.dataset.hmode){ hittingMode=t.dataset.hmode; document.querySelectorAll('#hittingMode button').forEach(b=>b.classList.toggle('active',b===t)); renderHitting(); return; }
    if(t.dataset.htype){ trainingHitType=t.dataset.htype; document.querySelectorAll('#trainingHitType button').forEach(b=>b.classList.toggle('active',b===t)); return; }
    if(t.dataset.swingQuality) return recordSwing(t.dataset.swingQuality);
    if(t.dataset.inplay) return setInplayResult(t.dataset.inplay);
  });

  document.getElementById('undoTrainingThrow').addEventListener('click',undoTrainingThrow);
  document.getElementById('undoGameAction').addEventListener('click',undoGameAction);
  document.getElementById('manualNextBatter').addEventListener('click',manualNextBatter);
  document.getElementById('undoHitting').addEventListener('click',undoHitting);
  document.getElementById('undoTrainingSwing').addEventListener('click',undoTrainingSwing);
  document.getElementById('closeInplayModal').addEventListener('click',()=>document.getElementById('inplayModal').hidden=true);
  document.getElementById('exportData').addEventListener('click',exportData);
  document.getElementById('importData').addEventListener('change',e=>{ if(e.target.files?.[0]) importData(e.target.files[0]); e.target.value=''; });
  document.getElementById('resetData').addEventListener('click',()=>{
    const msg = cloud.session
      ? '이 기기의 로컬 선수/기록을 비우고 클라우드에서 다시 내려받을까요?'
      : '이 기기의 모든 선수와 기록을 삭제할까요? 이 작업은 되돌릴 수 없습니다.';
    if (!confirm(msg)) return;
    if (cloud.session) {
      if (!navigator.onLine) return showToast('클라우드 복원은 온라인 상태에서 실행하세요');
      state.athletes=[]; state.activeAthleteId=null; state.athleteDays={}; state.deletedAthleteIds=[]; saveState(false);
      syncCloud(true); return;
    }
    const fresh=initialState(); state.athletes=fresh.athletes; state.activeAthleteId=fresh.activeAthleteId; state.athleteDays=fresh.athleteDays; state.deletedAthleteIds=[]; state.cloudOwnerId=null;
    saveState(false); render(); showToast('이 기기 로컬 데이터를 초기화했습니다');
  });

  document.getElementById('athleteSwitcher').addEventListener('click',()=>{ renderAthletes(); document.getElementById('athletePickerModal').hidden=false; });
  document.getElementById('closeAthletePicker').addEventListener('click',()=>document.getElementById('athletePickerModal').hidden=true);
  document.getElementById('pickerAddAthlete').addEventListener('click',()=>{ document.getElementById('athletePickerModal').hidden=true; openAthleteModal(); });
  document.getElementById('addAthleteBtn').addEventListener('click',()=>openAthleteModal());
  document.getElementById('editAthleteBtn').addEventListener('click',()=>openAthleteModal(state.activeAthleteId));
  document.getElementById('closeAthleteModal').addEventListener('click',()=>document.getElementById('athleteModal').hidden=true);
  document.getElementById('athleteForm').addEventListener('submit',saveAthleteFromForm);
  document.getElementById('deleteAthleteBtn').addEventListener('click',deleteCurrentAthlete);
  document.getElementById('deleteCloudData').addEventListener('click', deleteCloudAndLocal);
  document.getElementById('signInBtn').addEventListener('click', signInCloud);
  document.getElementById('signUpBtn').addEventListener('click', signUpCloud);
  document.getElementById('signOutBtn').addEventListener('click', signOutCloud);
  document.getElementById('syncNowBtn').addEventListener('click', ()=>syncCloud(true));
  document.getElementById('cloudPill').addEventListener('click', ()=>go('settings'));
  window.addEventListener('online', ()=>{ setCloudStatus(cloud.session ? 'syncing' : 'local', cloud.session ? '인터넷 연결 복구 · 동기화 준비' : '온라인'); scheduleCloudSync(100); });
  window.addEventListener('offline', ()=>setCloudStatus('offline', '오프라인 · 로컬 저장 중'));



  function isStandaloneMode() {
    return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  }

  function refreshInstallUI() {
    const installed = isStandaloneMode();
    const mini = document.getElementById('installMini');
    const btn = document.getElementById('installApp');
    const hint = document.getElementById('installHint');
    if (mini) mini.hidden = installed;
    if (btn) { btn.disabled = installed; btn.textContent = installed ? '설치됨' : '이 기기에 앱 설치'; }
    if (hint && installed) hint.textContent = '현재 홈 화면 앱으로 실행 중입니다.';
  }

  function showInstallInstructions() {
    const ua = navigator.userAgent || '';
    const ios = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const p = document.getElementById('installInstructions');
    p.textContent = ios
      ? 'Safari의 공유 버튼을 누른 뒤 “홈 화면에 추가”를 선택하세요. 설치 후 아이콘을 눌러 실행하면 전체 화면 앱처럼 사용할 수 있습니다.'
      : '브라우저 메뉴에서 “앱 설치” 또는 “홈 화면에 추가”를 선택하세요. 설치 메뉴가 보이지 않으면 HTTPS 웹주소로 접속했는지 확인하세요.';
    document.getElementById('installModal').hidden = false;
  }

  async function installApp() {
    if (isStandaloneMode()) return showToast('이미 홈 화면 앱으로 실행 중입니다');
    if (deferredInstallPrompt) {
      deferredInstallPrompt.prompt();
      await deferredInstallPrompt.userChoice.catch(()=>null);
      deferredInstallPrompt = null;
      refreshInstallUI();
      return;
    }
    showInstallInstructions();
  }

  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredInstallPrompt = e; refreshInstallUI(); });
  window.addEventListener('appinstalled', () => { deferredInstallPrompt = null; refreshInstallUI(); showToast('홈 화면에 설치되었습니다'); });
  document.getElementById('installMini').addEventListener('click', installApp);
  document.getElementById('installApp').addEventListener('click', installApp);
  document.getElementById('closeInstallModal').addEventListener('click',()=>document.getElementById('installModal').hidden=true);

  if ('serviceWorker' in navigator) window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(()=>{}));
  refreshInstallUI();
  renderCloudAuth();
  renderCloudStatus();
  render();
  initCloud();
})();
