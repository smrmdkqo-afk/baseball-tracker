import {openDB,getAll,getOne,putOne,putMany,deleteOne,getMeta,setMeta,snapshot,replaceSnapshot,ensureInitialData,migrateV5LocalIfNeeded,uuid,iso,todayKey,stamp} from './storage.js?v=6.5.2';
import {gamePitchingSummary,battingSummary,defenseSummary,baserunningSummary,trainingSummary,workloadSummary,todaySummary,totalTLU,analysisSnapshot,analysisMetricValue,analysisSeries,localDate,dateShift,OFFICIAL_PITCH_TYPES,STRIKE_PITCH_TYPES,GAME_TLU,round2,canonicalGameEvents,gameEventIntegrity} from './analytics.js?v=6.5.2';

const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const storeNames=['athletes','gameDays','batterFaced','plateAppearances','gameEvents','trainingSets'];
let data={athletes:[],gameDays:[],batterFaced:[],plateAppearances:[],gameEvents:[],trainingSets:[]};
let ui={view:'home',inputDate:todayKey(),inputMode:'game',domain:'pitching',historyDate:'all',historyMode:'all',historyDomain:'all',analysisSource:'game',analysisPeriod:'30',analysisFrom:dateShift(todayKey(),-29),analysisTo:todayKey(),analysisView:'game',analysisDomain:'pitching',analysisMetric:'strikePct',ownSide:'all',oppSide:'all',pendingBatterSide:null,pendingOwnPitchSide:null,pendingBatSide:null,pendingOppPitcherSide:null,inPlayContext:null,quantity:10};
let activeAthleteId=null,toastTimer=null,undoTimer=null,lastDeleted=null,deferredInstallPrompt=null,syncTimer=null,staticEventsBound=false;
let expandedBF=new Set(),expandedPA=new Set(),resumeContext=null,pitchEditId=null,pitchEditType=null,pitchEditResult=null,analysisDetailSeries=[];
const cloud={client:null,session:null,configured:false,syncing:false,lastSync:Number(localStorage.getItem('btV6LastSync')||0)};

const LABELS={
  ball:'BALL',called:'루킹',swinging:'헛스윙',foul:'파울',inplay:'IN PLAY',hbp:'HBP',pickoff_normal:'견제 정상',pickoff_error:'견제 악송구',game_warmup:'연습투구',
  taken_ball:'볼 지켜봄',taken_strike:'스트라이크 지켜봄',swinging_strike:'헛스윙',in_play:'IN PLAY',
  fielding_play:'수비 플레이',steal_attempt:'도루 시도',advancement:'추가 진루',
  throwing:'투구',DRY_SWING:'빈스윙',TEE:'티',TOSS:'토스',BP:'배팅볼',MACHINE:'머신',LIVE:'라이브',FIELDING:'포구',THROWING:'송구',GROUND_BALL:'땅볼',FLY_BALL:'플라이',DOUBLE_PLAY:'병살',RELAY:'중계플레이',FOOTWORK:'풋워크',OTHER:'기타',STEAL_START:'도루 스타트',LEAD_REACTION:'리드/반응',BASE_RUNNING:'베이스러닝',SLIDING:'슬라이딩',SPRINT:'스프린트'
};
const DOMAIN_LABEL={pitching:'투구',hitting:'타격',defense:'수비',baserunning:'주루'};
const UNKNOWN_RESULT='UNKNOWN';

function esc(v){return String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));}
function fmtDate(k){if(!k)return '';const [y,m,d]=k.split('-');return `${y}.${m}.${d}`;}
function fmtShort(k){if(!k)return '';const [,m,d]=k.split('-');return `${Number(m)}/${Number(d)}`;}
function fmtTime(v){try{return new Date(v).toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit'});}catch{return '';}}
function pct(v,d=1){return v==null||Number.isNaN(v)?'—':`${(v*100).toFixed(d)}%`;}
function dec(v){return v==null||Number.isNaN(v)?'—':Number(v).toFixed(3).replace(/^0/,'');}
function n2(v){const x=round2(v);return Number.isInteger(x)?String(x):x.toFixed(2).replace(/0$/,'');}
function active(list){return (list||[]).filter(x=>!x.deletedAt);}
function athlete(){return active(data.athletes).find(a=>a.id===activeAthleteId)||active(data.athletes)[0];}
function refreshDataStore(store,items){data[store]=items;}
async function reloadData(){for(const s of storeNames)refreshDataStore(s,await getAll(s));activeAthleteId=await getMeta('activeAthleteId',active(data.athletes)[0]?.id||null);}
function markLocal(obj){return stamp(obj,{dirty:true});}
async function save(store,obj,{render=true,sync=true}={}){markLocal(obj);await putOne(store,obj);const i=data[store].findIndex(x=>x.id===obj.id);if(i>=0)data[store][i]=obj;else data[store].push(obj);if(render)renderAll();if(sync)scheduleSync();return obj;}
function recordsFor(store){if(store==='gameEvents')return canonicalGameEvents(data,{athleteId:activeAthleteId});return active(data[store]).filter(x=>x.athleteId===activeAthleteId);}
function logIntegrity(context='runtime'){if(!activeAthleteId)return;const q=gameEventIntegrity(data,{athleteId:activeAthleteId});if(q.total)console.warn(`[야구일기] ${context}: 분석/기록에서 제외된 비정상 game event ${q.total}건 (orphan pitching ${q.orphanPitching}, orphan hitting ${q.orphanHitting})`,q.invalid);}
function getGameDay(date=ui.inputDate){return recordsFor('gameDays').find(x=>x.activityDate===date);}
async function ensureGameDay(date=ui.inputDate){let x=getGameDay(date);if(x)return x;x={id:uuid(),athleteId:activeAthleteId,activityDate:date,ownerId:cloud.session?.user?.id||null,deletedAt:null,createdAt:iso(),updatedAt:iso(),clientUpdatedAt:Date.now(),dirty:true};await save('gameDays',x,{render:false});return x;}
function isUnknownParent(p){return !!p&&!p.completed&&p.result===UNKNOWN_RESULT;}
function currentBF(date=ui.inputDate){const list=recordsFor('batterFaced').filter(x=>x.activityDate===date).sort((a,b)=>b.sequenceNo-a.sequenceNo);const p=list[0];return p&&!p.completed&&!isUnknownParent(p)?p:null;}
function currentPA(date=ui.inputDate){const list=recordsFor('plateAppearances').filter(x=>x.activityDate===date).sort((a,b)=>b.sequenceNo-a.sequenceNo);const p=list[0];return p&&!p.completed&&!isUnknownParent(p)?p:null;}
function resumedParent(kind){if(!resumeContext||resumeContext.kind!==kind)return null;const store=kind==='bf'?'batterFaced':'plateAppearances';const p=recordsFor(store).find(x=>x.id===resumeContext.id&&x.activityDate===ui.inputDate&&!x.completed);if(!p)resumeContext=null;return p||null;}
function inputBF(){return resumedParent('bf')||currentBF();}
function inputPA(){return resumedParent('pa')||currentPA();}
function bfEvents(id){return recordsFor('gameEvents').filter(e=>e.parentType==='batter_faced'&&e.parentId===id).sort((a,b)=>new Date(a.recordedAt)-new Date(b.recordedAt));}
function paEvents(id){return recordsFor('gameEvents').filter(e=>e.parentType==='plate_appearance'&&e.parentId===id).sort((a,b)=>new Date(a.recordedAt)-new Date(b.recordedAt));}
function countBS(events,type='pitching'){
  let b=0,s=0;for(const e of events){if(type==='pitching'){if(e.eventType==='ball')b++;else if(['called','swinging','foul','inplay'].includes(e.eventType)){if(!(e.eventType==='foul'&&s>=2))s++;}}else{if(e.eventType==='taken_ball')b++;else if(['taken_strike','swinging_strike','foul','in_play'].includes(e.eventType)){if(!(e.eventType==='foul'&&s>=2))s++;}}}return {b,s};
}
function lastCompleted(kind,date=ui.inputDate){const list=kind==='bf'?recordsFor('batterFaced'):recordsFor('plateAppearances');return list.filter(x=>x.activityDate===date&&x.completed).sort((a,b)=>b.sequenceNo-a.sequenceNo)[0]||null;}
function lastParent(kind,date=ui.inputDate){const list=kind==='bf'?recordsFor('batterFaced'):recordsFor('plateAppearances');return list.filter(x=>x.activityDate===date).sort((a,b)=>b.sequenceNo-a.sequenceNo)[0]||null;}
function nextSequence(store,date){return Math.max(0,...data[store].filter(x=>x.athleteId===activeAthleteId&&x.activityDate===date).map(x=>Number(x.sequenceNo)||0))+1;}

function withTimeout(promise,ms,label){return Promise.race([promise,new Promise((_,reject)=>setTimeout(()=>reject(new Error(`${label} 시간이 초과되었습니다.`)),ms))]);}
async function init(){
  // Bind navigation first so a slow local DB can never leave a completely dead screen.
  bindStaticEvents();registerPWA();
  $('#todayLabel').textContent=fmtDate(todayKey());
  await withTimeout(openDB(),6000,'로컬 데이터베이스 열기');
  await withTimeout(migrateV5LocalIfNeeded(),12000,'기존 데이터 변환');
  await withTimeout(ensureInitialData(),6000,'초기 데이터 준비');
  await withTimeout(reloadData(),8000,'기록 불러오기');
  logIntegrity('startup');
  ui.inputDate=todayKey();ui.analysisTo=todayKey();ui.analysisFrom=dateShift(todayKey(),-29);
  renderAll();
  window.__BT_APP_READY__=true;
  const boot=$('#bootError');if(boot)boot.hidden=true;
  initCloud().catch(err=>{console.error('Cloud init failed',err);renderCloudStatus('error','동기화 초기화 실패');});
}

function setView(v){ui.view=v;$$('.view').forEach(x=>x.classList.toggle('active',x.dataset.view===v));$$('.bottom-nav button').forEach(x=>x.classList.toggle('active',x.dataset.nav===v));const titles={home:'오늘의 기록',input:'한 공 기록하기',history:'차곡차곡 기록',analysis:'성장 보기',settings:'야구일기 설정'};$('#pageTitle').textContent=titles[v]||'';if(v==='history')renderHistory();if(v==='analysis')renderAnalysis();window.scrollTo({top:0,behavior:'smooth'});}
function renderAll(){renderHeader();renderHome();renderInput();renderHistory();if(ui.view==='analysis')renderAnalysis();renderSettings();}
function renderHeader(){const a=athlete();$('#activeAthleteName').textContent=a?.name||'선수';$('#athleteInitial').textContent=(a?.name||'P').slice(0,1);$('#todayLabel').textContent=fmtDate(todayKey());}
function showToast(title,message='',type=''){const el=$('#toast');el.className=`toast show ${type}`;el.innerHTML=`<b>${esc(title)}</b>${message?`<span>${esc(message)}</span>`:''}`;if(type==='complete'){const panel=$('.entry-panel');panel?.classList.add('completion-flash');setTimeout(()=>panel?.classList.remove('completion-flash'),360);}clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('show'),1200);}
function showModal(id){$('#'+id).hidden=false;}function hideModal(id){$('#'+id).hidden=true;}

function renderHome(){
  const a=athlete();if(!a)return;const date=todayKey();const s=todaySummary(data,{athleteId:a.id,date});
  $('#homeDateCaption').textContent=`${fmtDate(date)} · ${a.name}`;$('#homeTotalTLU').textContent=n2(s.totalTLU);$('#homeGameTLU').textContent=n2(s.gameTLU);$('#homeTrainingTLU').textContent=n2(s.training.tlu);$('#homeOfficialPitches').textContent=s.game.pitching.officialPitches;const defenseTrainingThrows=active(data.trainingSets).filter(x=>x.athleteId===a.id&&x.activityDate===date&&x.domain==='defense').reduce((sum,x)=>sum+Number(x.metadata?.throwCount||0),0);$('#homeTotalThrows').textContent=s.game.pitching.totalGameThrows+s.game.defense.throwAttempts+(s.training.byDomain.pitching?.volume||0)+defenseTrainingThrows;
  const p=s.game.pitching,h=s.game.hitting,d=s.game.defense,b=s.game.baserunning;
  $('#homeGameSummary').innerHTML=[
    ['투구',`${p.officialPitches} pitches · Strike ${pct(p.strikePct,0)}`],['타격',`${h.PA} PA · ${h.H} H · OPS ${h.PA?dec(h.OPS):'—'}`],['수비',`${d.plays} plays · 포구 ${pct(d.fieldingSuccessPct,0)}`],['주루',`SB ${b.sb} · CS ${b.cs}`]
  ].map(x=>`<div class="summary-row"><span>${x[0]}</span><b>${x[1]}</b></div>`).join('');
  const t=s.training.byDomain;$('#homeTrainingSummary').innerHTML=[
    ['투구',`${t.pitching.volume||0} throws · ${n2(t.pitching.tlu||0)} TLU`],['타격',`${t.hitting.volume||0} swings`],['수비',`${t.defense.volume||0} reps · ${n2(t.defense.tlu||0)} TLU`],['주루',`${t.baserunning.volume||0} reps`]
  ].map(x=>`<div class="summary-row"><span>${x[0]}</span><b>${x[1]}</b></div>`).join('');
}

function renderInput(){
  $('#activityDateInput').value=ui.inputDate;$$('#inputModeTabs button').forEach(b=>b.classList.toggle('active',b.dataset.mode===ui.inputMode));$$('#domainTabs button').forEach(b=>b.classList.toggle('active',b.dataset.domain===ui.domain));
  renderInputSummary();renderInputForm();renderRecent();
}

function renderInputSummary(){
  const el=$('#inputSummary'),a=athlete();if(!a)return;
  const total=totalTLU(data,{athleteId:a.id,date:ui.inputDate});
  if(ui.inputMode==='game'&&ui.domain==='pitching'){
    const s=gamePitchingSummary(data,{athleteId:a.id,date:ui.inputDate}),bf=inputBF(),prev=lastCompleted('bf');
    el.innerHTML=`<div class="performance-title"><div><p class="section-kicker">PITCHING</p><h2>${fmtDate(ui.inputDate)}</h2></div></div>
    ${sideButtonsPitching(bf)}
    <div class="big-stat"><strong>${s.officialPitches}</strong><span>OFFICIAL PITCHES</span></div><div class="big-stat"><strong>${n2(s.gameTLU)}</strong><span>GAME TLU · TODAY TOTAL ${n2(total)}</span></div>
    ${perfRows([['STRIKE',pct(s.strikePct,0)],['1ST STRIKE',pct(s.firstPitchStrikePct,0)],['BF',s.bf],['K',s.k],['BB',s.bb],['HBP',s.hbp],['P / BF',s.pitchesPerBatter?Number(s.pitchesPerBatter).toFixed(2):'—'],['PICKOFF',`${s.pickoffs} / ERR ${s.pickoffErrors}`],['WARM-UP',s.warmups]])}
    ${prev?`<div class="prev-result"><span>직전 타자</span><b>#${prev.sequenceNo} · ${bfEvents(prev.id).length}구 · ${esc(prev.result||'완료')}</b></div>`:''}`;
  } else if(ui.inputMode==='game'&&ui.domain==='hitting'){
    const s=battingSummary(data,{athleteId:a.id,date:ui.inputDate}),pa=inputPA(),prev=lastCompleted('pa');
    el.innerHTML=`<div class="performance-title"><div><p class="section-kicker">BATTING</p><h2>${fmtDate(ui.inputDate)}</h2></div></div>${sideButtonsBatting(pa)}
    <div class="big-stat"><strong>${s.PA}</strong><span>PLATE APPEARANCES</span></div><div class="big-stat"><strong>${s.H}</strong><span>HITS</span></div>
    ${perfRows([['AVG',dec(s.AVG)],['OBP',dec(s.OBP)],['SLG',dec(s.SLG)],['OPS',s.PA?dec(s.OPS):'—'],['SWINGS',s.swings],['WHIFF',s.whiffs],['CONTACT',pct(s.contactPct,0)],['SO',s.SO]])}
    ${prev?`<div class="prev-result"><span>직전 타석</span><b>#${prev.sequenceNo} · ${paEvents(prev.id).length}구 · ${esc(prev.result||'완료')}</b></div>`:''}`;
  } else if(ui.inputMode==='game'&&ui.domain==='defense'){
    const s=defenseSummary(data,{athleteId:a.id,date:ui.inputDate});el.innerHTML=`<div class="performance-title"><div><p class="section-kicker">DEFENSE</p><h2>${fmtDate(ui.inputDate)}</h2></div></div><div class="big-stat"><strong>${s.plays}</strong><span>DEFENSIVE PLAYS</span></div>${perfRows([['포구 성공',pct(s.fieldingSuccessPct,0)],['송구 성공',pct(s.throwSuccessPct,0)],['포구 실패',s.field.failed||0],['악송구',s.throws.error||0],['수비 송구 TLU',n2(s.throwTLU)]])}`;
  } else if(ui.inputMode==='game'&&ui.domain==='baserunning'){
    const s=baserunningSummary(data,{athleteId:a.id,date:ui.inputDate});el.innerHTML=`<div class="performance-title"><div><p class="section-kicker">BASERUNNING</p><h2>${fmtDate(ui.inputDate)}</h2></div></div><div class="big-stat"><strong>${pct(s.sbPct,0)}</strong><span>SB SUCCESS</span></div>${perfRows([['SB',s.sb],['CS',s.cs],['ATTEMPTS',s.attempts]])}`;
  } else {
    const s=trainingSummary(data,{athleteId:a.id,date:ui.inputDate,domain:ui.domain}),all=trainingSummary(data,{athleteId:a.id,date:ui.inputDate});const d=s.byDomain[ui.domain]||{volume:0,tlu:0};
    el.innerHTML=`<div class="performance-title"><div><p class="section-kicker">TRAINING · ${DOMAIN_LABEL[ui.domain].toUpperCase()}</p><h2>${fmtDate(ui.inputDate)}</h2></div></div><div class="big-stat"><strong>${d.volume||0}</strong><span>${trainingUnitLabel(ui.domain)}</span></div><div class="big-stat"><strong>${n2(d.tlu||0)}</strong><span>${DOMAIN_LABEL[ui.domain]} TLU · SELECTED DATE TOTAL ${n2(total)}</span></div>${trainingBreakdownHtml(s)}`;
  }
}
function perfRows(rows){return rows.map(([k,v])=>`<div class="perf-row"><span>${k}</span><b>${v}</b></div>`).join('');}
function trainingUnitLabel(d){return d==='pitching'?'THROWS':d==='hitting'?'SWINGS':'REPS';}
function trainingBreakdownHtml(s){const entries=Object.entries(s.byType).sort((a,b)=>b[1]-a[1]).slice(0,8);return entries.length?entries.map(([k,v])=>`<div class="perf-row"><span>${esc(LABELS[k]||k)}</span><b>${v}</b></div>`).join(''):'<div class="prev-result"><span>아직 기록 없음</span><b>오른쪽에서 훈련 세트를 추가하세요.</b></div>';}
function sideButtonsPitching(bf){const a=athlete();const own=bf?.pitcherSide||ui.pendingOwnPitchSide||(a?.throws==='S'?null:a?.throws);const opp=bf?.batterSide||ui.pendingBatterSide;return `<div class="field-group"><span>내 투구</span><div class="side-context">${sideBtn('pitcher','R','우투',own)}${sideBtn('pitcher','L','좌투',own)}</div></div><div class="field-group"><span>현재 상대 타자</span><div class="side-context">${sideBtn('batter','', '? 미입력',opp)}${sideBtn('batter','R','우타',opp)}${sideBtn('batter','L','좌타',opp)}</div></div>`;}
function sideButtonsBatting(pa){const a=athlete();const own=pa?.batterSide||ui.pendingBatSide||(a?.bats==='S'?null:a?.bats);const opp=pa?.pitcherSide||ui.pendingOppPitcherSide;return `<div class="field-group"><span>내 타격</span><div class="side-context">${sideBtn('bat','R','우타',own)}${sideBtn('bat','L','좌타',own)}</div></div><div class="field-group"><span>현재 상대 투수</span><div class="side-context">${sideBtn('oppPitcher','', '? 미입력',opp)}${sideBtn('oppPitcher','R','우투',opp)}${sideBtn('oppPitcher','L','좌투',opp)}</div></div>`;}
function sideBtn(kind,val,label,current){return `<button type="button" data-side-kind="${kind}" data-side-value="${val}" class="${(current||'')===val?'active':''}">${label}</button>`;}

function renderInputForm(){const el=$('#inputForm');if(ui.inputMode==='game'){if(ui.domain==='pitching')el.innerHTML=gamePitchingForm();else if(ui.domain==='hitting')el.innerHTML=gameBattingForm();else if(ui.domain==='defense')el.innerHTML=gameDefenseForm();else el.innerHTML=gameBaserunningForm();}else{el.innerHTML=trainingForm(ui.domain);}bindDynamicFormEvents();}
function countDisplay(bs){return `<div class="count-balls"><span class="count-label ball-label">B</span>${[1,2,3,4].map(i=>`<i class="count-dot ball-dot ${i<=bs.b?'on':''}">${i}</i>`).join('')}<span class="count-label strike-label">S</span>${[1,2].map(i=>`<i class="count-dot strike-dot ${i<=bs.s?'on':''}">${i}</i>`).join('')}</div>${bs.s>=2?'<div class="count-hint">2 STRIKES · 파울은 스트라이크 카운트 유지</div>':''}`;}
function gamePitchingForm(){const bf=inputBF(),bs=bf?countBS(bfEvents(bf.id),'pitching'):{b:0,s:0},resuming=!!(resumeContext?.kind==='bf'&&bf?.id===resumeContext.id);return `<div class="entry-title"><div><p class="section-kicker">OFFICIAL PITCH</p><h2>PITCHING</h2><p>${resuming?`타자 #${bf.sequenceNo} 기록을 이어서 입력 중입니다.`:'타자에게 던진 공은 1구 = 1.00 TLU'}</p></div><span class="microcopy ${resuming?'editing-copy':''}">${bf?`타자 #${bf.sequenceNo}${resuming?' · 수정 중':''}`:'새 타자'}</span></div>${countDisplay(bs)}<button class="pitch-main ball-action press-action" data-pitch="ball"><b>BALL</b><span>Official pitch +1</span></button><div class="strike-grid"><button class="action-btn strike press-action" data-pitch="called"><b>루킹</b><span>CALLED</span></button><button class="action-btn strike press-action" data-pitch="swinging"><b>헛스윙</b><span>SWINGING</span></button><button class="action-btn strike press-action" data-pitch="foul"><b>파울</b><span>FOUL</span></button></div><div class="terminal-grid"><button class="action-btn inplay press-action" data-pitch="inplay"><b>IN PLAY</b><span>결과 선택</span></button><button class="action-btn hbp press-action" data-pitch="hbp"><b>HBP</b><span>타자 종료</span></button></div>${bf?`<button type="button" class="unknown-next-btn" data-close-parent-unknown="bf:${bf.id}"><b>? 결과 미상으로 다음 타자</b><span>현재까지 입력한 투구는 보존됩니다.</span></button>`:''}<div class="arm-load-panel"><div class="section-divider"><span>ARM LOAD · 타자 상대 투구와 별도</span></div><div class="load-actions"><button class="press-action" data-game-throw="pickoff_normal"><b>견제 정상</b><span>+0.85 TLU</span></button><button class="press-action" data-game-throw="pickoff_error"><b>견제 악송구</b><span>+0.85 TLU</span></button><button class="press-action" data-game-throw="game_warmup"><b>연습투구</b><span>+1.00 TLU</span></button></div></div>`;}
function gameBattingForm(){const pa=inputPA(),bs=pa?countBS(paEvents(pa.id),'batting'):{b:0,s:0},resuming=!!(resumeContext?.kind==='pa'&&pa?.id===resumeContext.id);return `<div class="entry-title"><div><p class="section-kicker">PLATE APPEARANCE</p><h2>BATTING</h2><p>${resuming?`타석 #${pa.sequenceNo} 기록을 이어서 입력 중입니다.`:'매 구 반응은 빠르게 기록하고 영상에서 세부정보를 보완할 수 있습니다.'}</p></div><span class="microcopy ${resuming?'editing-copy':''}">${pa?`타석 #${pa.sequenceNo}${resuming?' · 수정 중':''}`:'새 타석'}</span></div>${countDisplay(bs)}<button class="pitch-main ball-action press-action" data-bat-pitch="taken_ball"><b>볼 지켜봄</b><span>TAKEN BALL</span></button><div class="strike-grid"><button class="action-btn strike press-action" data-bat-pitch="taken_strike"><b>스트라이크 지켜봄</b><span>CALLED</span></button><button class="action-btn strike press-action" data-bat-pitch="swinging_strike"><b>헛스윙</b><span>WHIFF</span></button><button class="action-btn strike press-action" data-bat-pitch="foul"><b>파울</b><span>FOUL</span></button></div><div class="terminal-grid"><button class="action-btn inplay press-action" data-bat-pitch="in_play"><b>IN PLAY</b><span>결과 선택</span></button><button class="action-btn hbp press-action" data-bat-pitch="hbp"><b>HBP</b><span>타석 종료</span></button></div>${pa?`<button type="button" class="unknown-next-btn" data-close-parent-unknown="pa:${pa.id}"><b>? 결과 미상으로 다음 타석</b><span>현재까지 입력한 투구 반응은 보존됩니다.</span></button>`:''}`;}
function gameDefenseForm(){return `<div class="entry-title"><div><p class="section-kicker">DEFENSIVE PLAY</p><h2>DEFENSE</h2><p>포구 결과와 송구 품질을 빠르게 기록합니다. 포구 형태는 포지션에 따라 자동으로 바뀝니다.</p></div></div><div class="form-grid"><label>포지션<select id="defPosition"><option>SS</option><option>2B</option><option>3B</option><option>1B</option><option>C</option><option>P</option><option>LF</option><option>CF</option><option>RF</option></select></label><label>타구<select id="defBall"><option value="GB">GB · 땅볼</option><option value="LD">LD · 라인드라이브</option><option value="FB">FB · 뜬공</option><option value="BUNT">번트</option></select></label><label>포구 결과<select id="defFieldResult"><option value="success">성공</option><option value="unstable">불안정</option><option value="failed">실패</option></select></label></div><div class="field-group"><span>포구 형태 (선택)</span><div id="defFieldType" class="chip-grid"></div></div><div class="form-grid"><label>송구<select id="defThrowResult"><option value="none">없음</option><option value="success">정상 송구</option><option value="error">악송구</option></select></label><label>송구 목적지<select id="defThrowTarget"><option value="">선택 안 함</option><option value="1B">1루</option><option value="2B">2루</option><option value="3B">3루</option><option value="HOME">홈</option><option value="RELAY">중계</option></select></label><label>송구 부하<select id="defThrowTLU"><option value="0.75">가벼움 · 0.75</option><option value="0.85" selected>중간 · 0.85</option><option value="1">전력 · 1.00</option></select></label></div><p class="microcopy">송구 없음이면 TLU는 추가되지 않습니다. 정상 송구는 상대 포구 실책과 관계없이 받을 수 있는 위치에 보낸 송구를 뜻합니다.</p><button id="saveDefense" class="save-set">수비 플레이 저장</button>`;}
function gameBaserunningForm(){return `<div class="entry-title"><div><p class="section-kicker">BASERUNNING EVENT</p><h2>BASERUNNING</h2><p>도루는 한 베이스 단위 시도로만 기록합니다.</p></div></div><div class="form-grid" style="margin-top:14px"><label>출발<select id="runFrom"><option value="1B">1루</option><option value="2B">2루</option><option value="3B">3루</option></select></label><label>목표<select id="runTo"><option value="2B">2루</option><option value="3B">3루</option><option value="HOME">홈</option></select></label></div><div id="stealResultGroup" class="field-group"><span>결과</span><div class="chip-grid"><button type="button" class="active" data-steal-result="SUCCESS">성공</button><button type="button" data-steal-result="FAILED">실패</button></div></div><button id="saveBaserunning" class="save-set">도루 기록 저장</button>`;}
function trainingForm(domain){if(domain==='pitching')return trainingPitchingForm();if(domain==='hitting')return trainingHittingForm();if(domain==='defense')return trainingDefenseForm();return trainingBaserunningForm();}
function quantityHtml(value=ui.quantity){return `<div class="quantity-box"><div class="quantity-main"><button type="button" data-qty-delta="-1">−</button><input id="trainingQty" type="number" min="0" step="1" value="${value}" /><button type="button" data-qty-delta="1">＋</button></div><div class="quantity-quick"><button type="button" data-qty-delta="5">+5</button><button type="button" data-qty-delta="10">+10</button><button type="button" data-qty-set="0">초기화</button></div></div>`;}
function trainingPitchingForm(){const a=athlete(),side=a?.throws==='S'?'R':a?.throws||'R';return `<div class="entry-title"><div><p class="section-kicker">THROWING VOLUME</p><h2>투구 훈련</h2><p>훈련 명칭보다 실제 투구 강도와 총량을 기록합니다.</p></div></div><div class="form-grid"><label>투구 방향<select id="trPitchSide"><option value="R" ${side==='R'?'selected':''}>우투</option><option value="L" ${side==='L'?'selected':''}>좌투</option></select></label><label>강도<select id="trPitchIntensity"><option value="light">가벼운 · 0.75 TLU</option><option value="medium">중간 · 0.85 TLU</option><option value="max">전력 · 1.00 TLU</option></select></label></div><div class="field-group"><span>투구 횟수</span>${quantityHtml()}</div><button class="save-set" data-save-training="pitching">훈련 세트 저장</button>`;}
function trainingHittingForm(){const a=athlete(),side=a?.bats==='S'?'R':a?.bats||'R';return `<div class="entry-title"><div><p class="section-kicker">HITTING VOLUME</p><h2>타격 훈련</h2><p>좌·우 타격, 훈련 종류, 필요 시 구속과 스윙량을 기록합니다.</p></div></div><div class="form-grid"><label>타격 방향<select id="trHitSide"><option value="R" ${side==='R'?'selected':''}>우타</option><option value="L" ${side==='L'?'selected':''}>좌타</option></select></label><label>훈련 종류<select id="trHitType"><option value="DRY_SWING">빈스윙</option><option value="TEE">티</option><option value="TOSS">토스</option><option value="BP">배팅볼</option><option value="MACHINE">머신</option><option value="LIVE">라이브</option></select></label><label>구속 km/h (선택)<input id="trHitVelocity" type="number" min="0" max="200" placeholder="예: 90" /></label></div><div class="field-group"><span>스윙 횟수</span>${quantityHtml()}</div><button class="save-set" data-save-training="hitting">훈련 세트 저장</button>`;}
function trainingDefenseForm(){return `<div class="entry-title"><div><p class="section-kicker">DEFENSE VOLUME</p><h2>수비 훈련</h2><p>수비 reps와 실제 송구 횟수를 분리해 TLU 중복을 방지합니다.</p></div></div><div class="form-grid"><label>영역<select id="trDefArea"><option value="IF">내야</option><option value="OF">외야</option></select></label><label>훈련 종류<select id="trDefType"><option value="FIELDING">포구</option><option value="THROWING">송구</option><option value="GROUND_BALL">땅볼</option><option value="FLY_BALL">플라이</option><option value="DOUBLE_PLAY">병살</option><option value="RELAY">중계플레이</option><option value="FOOTWORK">풋워크</option><option value="OTHER">기타</option></select></label></div><div class="field-group"><span>훈련 Reps</span>${quantityHtml()}</div><div class="form-grid"><label>실제 송구 횟수<input id="trDefThrowCount" type="number" min="0" value="0" /></label><label>송구 부하<select id="trDefThrowIntensity"><option value="0.75">근거리 · 0.75</option><option value="0.85">중거리 · 0.85</option><option value="1">장거리/전력 · 1.00</option></select></label></div><button class="save-set" data-save-training="defense">훈련 세트 저장</button>`;}
function trainingBaserunningForm(){return `<div class="entry-title"><div><p class="section-kicker">RUNNING VOLUME</p><h2>주루 훈련</h2><p>도루 스타트·리드·슬라이딩·스프린트 등 훈련량을 세트로 기록합니다.</p></div></div><div class="form-grid"><label>훈련 종류<select id="trRunType"><option value="STEAL_START">도루 스타트</option><option value="LEAD_REACTION">리드/반응</option><option value="BASE_RUNNING">베이스러닝</option><option value="SLIDING">슬라이딩</option><option value="SPRINT">스프린트</option><option value="OTHER">기타</option></select></label><label>거리 m (선택)<input id="trRunDistance" type="number" min="0" /></label><label>최고 기록 sec (선택)<input id="trRunBest" type="number" min="0" step="0.01" /></label></div><div class="field-group"><span>횟수</span>${quantityHtml()}</div><button class="save-set" data-save-training="baserunning">훈련 세트 저장</button>`;}

function parentEvents(kind,id){return kind==='bf'?bfEvents(id):paEvents(id);}
function parentStore(kind){return kind==='bf'?'batterFaced':'plateAppearances';}
function parentTypeName(kind){return kind==='bf'?'타자':'타석';}
function parentSideLine(kind,p){return kind==='bf'?`내 ${sideThrow(p.pitcherSide)} · 상대 ${sideBat(p.batterSide)}`:`${sideBat(p.batterSide)} · vs ${sideThrow(p.pitcherSide)}`;}
function resultTone(result){if(result===UNKNOWN_RESULT)return '';if(['K','SO'].includes(result))return 'strike';if(result==='BB')return 'ball';if(result==='HBP')return 'hbp';if(result)return 'inplay';return '';}
function parentResultLabel(p){return isUnknownParent(p)?'결과 미상':(p.result||'미완료');}
function pitchTone(kind,e){if(kind==='bf'){if(e.eventType==='ball')return 'ball';if(['called','swinging','foul'].includes(e.eventType))return 'strike';if(e.eventType==='inplay')return 'inplay';if(e.eventType==='hbp')return 'hbp';}else{if(e.eventType==='taken_ball')return 'ball';if(['taken_strike','swinging_strike','foul'].includes(e.eventType))return 'strike';if(e.eventType==='in_play')return 'inplay';if(e.eventType==='hbp')return 'hbp';}return '';}
function pitchCardLabel(kind,e){let text=LABELS[e.eventType]||e.eventType;if((e.eventType==='inplay'||e.eventType==='in_play')&&e.metadata?.result)text+=` · ${e.metadata.result}`;return text;}
function parentIsCurrent(kind,p){const resumed=resumedParent(kind);if(resumed?.id===p.id)return true;const live=kind==='bf'?currentBF(p.activityDate):currentPA(p.activityDate);return !resumeContext&&live?.id===p.id;}
function parentCardHtml(kind,p,{forceExpanded=false}={}){
  const events=parentEvents(kind,p.id),bs=countBS(events,kind==='bf'?'pitching':'batting'),set=kind==='bf'?expandedBF:expandedPA;
  const resumed=resumeContext?.kind===kind&&resumeContext.id===p.id,current=parentIsCurrent(kind,p),unknown=isUnknownParent(p),pastIncomplete=!p.completed&&!unknown&&!current;
  const expanded=forceExpanded||current||pastIncomplete||set.has(p.id),tone=`tone-${Number(p.sequenceNo||0)%3}`;
  const status=current?(resumed?'수정 중':(kind==='bf'?'현재 타자':'현재 타석')):unknown?'결과 미상':pastIncomplete?'미완료 기록':parentResultLabel(p);
  const statusClass=current?'current':unknown?'unknown':pastIncomplete?'incomplete':`complete ${resultTone(p.result)}`;
  let summary='';
  if(p.completed)summary=`${events.length}구 · ${parentResultLabel(p)}`;
  else if(unknown)summary=events.length?`${events.length}구 · 결과 미상`:'세부 투구 기록 없음 · 결과 미상';
  else if(!events.length)summary='세부 투구 기록 없음';
  else summary=`B${bs.b} · S${bs.s}`;
  const eventHtml=events.map((e,i)=>`<button type="button" class="pitch-log-row ${pitchTone(kind,e)}" data-edit-pitch="${e.id}"><span class="pitch-no">${i+1}구</span><b>${esc(pitchCardLabel(kind,e))}</b><small>${e.metadata?.battedBall?`${esc(e.metadata.battedBall)}${e.metadata?.direction?` · ${{L:'좌',C:'중',R:'우'}[e.metadata.direction]||e.metadata.direction}`:''}`:''}</small><i>수정</i></button>`).join('');
  const continueBtn=(pastIncomplete||unknown)?`<button type="button" class="parent-action primary" data-resume-parent="${kind}:${p.id}">계속 입력</button>`:'';
  const deleteBtn=`<button type="button" class="parent-action danger" data-delete-parent="${kind}:${p.id}">${kind==='bf'?'타자':'타석'} 기록 삭제</button>`;
  const stateClass=`${current?' is-current':''}${pastIncomplete?' is-incomplete':''}${unknown?' is-unknown':''}`;
  return `<article class="parent-card ${tone}${stateClass}"><div class="parent-card-head"><button type="button" class="parent-toggle" data-toggle-parent="${kind}:${p.id}"><span class="seq-badge">${kind==='bf'?'#':''}${p.sequenceNo}${kind==='pa'?' PA':''}</span><span class="parent-ident"><b>${parentSideLine(kind,p)}</b><small>${summary}</small></span><span class="parent-status ${statusClass}">${current&&!resumed?'● ':unknown?'? ':pastIncomplete?'⚠ ':resumed?'✎ ':''}${esc(status)}</span><span class="chev">${expanded?'⌃':'⌄'}</span></button></div>${expanded?`<div class="parent-card-body">${events.length?`<div class="pitch-log-list">${eventHtml}</div>`:'<div class="scope-note compact">세부 투구 기록이 없습니다. 부모 기록은 직접 삭제하기 전까지 유지됩니다.</div>'}<div class="parent-card-foot"><span class="count-mini"><em class="b">B ${bs.b}</em><em class="s">S ${bs.s}</em></span><span class="parent-actions"><button type="button" class="parent-action" data-edit-parent="${kind}:${p.id}">${kind==='bf'?'타자':'타석'} 정보 수정</button>${continueBtn}${deleteBtn}</span></div></div>`:''}</article>`;
}
function parentsFor(kind,date){return recordsFor(parentStore(kind)).filter(x=>x.activityDate===date).sort((a,b)=>b.sequenceNo-a.sequenceNo);}
function renderRecent(){
  const el=$('#recentInputList');
  if(ui.inputMode==='game'&&['pitching','hitting'].includes(ui.domain)){
    const kind=ui.domain==='pitching'?'bf':'pa',parents=parentsFor(kind,ui.inputDate);let html=parents.map(p=>parentCardHtml(kind,p)).join('');
    if(ui.domain==='pitching'){
      const aux=recordsFor('gameEvents').filter(e=>e.activityDate===ui.inputDate&&e.domain==='pitching'&&!e.parentId).sort((a,b)=>new Date(b.recordedAt)-new Date(a.recordedAt));
      if(aux.length)html+=`<div class="aux-log"><b>견제 · 연습투구</b>${aux.map(e=>recordRowHtml({store:'gameEvents',id:e.id,activityDate:e.activityDate,recordedAt:e.recordedAt,mode:'game',domain:e.domain,label:gameEventLabel(e),sub:gameEventSub(e)})).join('')}</div>`;
    }
    el.innerHTML=html||'<div class="scope-note">아직 입력된 기록이 없습니다.</div>';return;
  }
  const records=collectTimeline({date:ui.inputDate,mode:ui.inputMode,domain:ui.domain});if(!records.length){el.innerHTML='<div class="scope-note">아직 입력된 기록이 없습니다.</div>';return;}el.innerHTML=records.map(recordRowHtml).join('');
}
function collectTimeline({date='all',mode='all',domain='all'}={}){
  const out=[];
  for(const e of recordsFor('gameEvents')){
    if(e.parentId&&['pitching','hitting','batting'].includes(e.domain))continue;
    if(date!=='all'&&e.activityDate!==date)continue;if(mode==='training')continue;if(domain!=='all'&&e.domain!==domain)continue;out.push({store:'gameEvents',id:e.id,activityDate:e.activityDate,recordedAt:e.recordedAt,mode:'game',domain:e.domain,label:gameEventLabel(e),sub:gameEventSub(e)});
  }
  for(const s of active(data.trainingSets).filter(x=>x.athleteId===activeAthleteId)){
    if(date!=='all'&&s.activityDate!==date)continue;if(mode==='game')continue;if(domain!=='all'&&s.domain!==domain)continue;out.push({store:'trainingSets',id:s.id,activityDate:s.activityDate,recordedAt:s.recordedAt,mode:'training',domain:s.domain,label:trainingSetLabel(s),sub:trainingSetSub(s)});
  }
  return out.sort((a,b)=>b.activityDate.localeCompare(a.activityDate)||new Date(b.recordedAt)-new Date(a.recordedAt));
}
function sideThrow(v){return v==='R'?'우투':v==='L'?'좌투':'미입력';}function sideBat(v){return v==='R'?'우타':v==='L'?'좌타':'미입력';}
function gameEventLabel(e){
  if(e.domain==='pitching'){if(e.eventType==='inplay')return `투구 · IN PLAY · ${e.metadata?.result||''}`;return `투구 · ${LABELS[e.eventType]||e.eventType}`;}
  if(['hitting','batting'].includes(e.domain)){if(e.eventType==='in_play')return `타격 · IN PLAY · ${e.metadata?.result||''}`;return `타격 · ${LABELS[e.eventType]||e.eventType}`;}
  if(e.domain==='defense')return `수비 · ${fieldResultLabel(e.metadata?.fieldingResult)} / ${throwResultLabel(e.metadata?.throwResult)}`;
  if(e.domain==='baserunning')return `도루 ${e.metadata?.from||''}→${e.metadata?.to||''} · ${e.metadata?.result==='SUCCESS'?'성공':'실패'}`;
  return e.eventType;
}
function gameEventSub(e){const pieces=[`${fmtDate(e.activityDate)} 경기`];if(e.domain==='pitching')pieces.push(`TLU ${n2(GAME_TLU[e.eventType]||e.metadata?.tlu||0)}`);if(e.metadata?.battedBall)pieces.push(e.metadata.battedBall);if(e.metadata?.direction)pieces.push({L:'좌',C:'중',R:'우'}[e.metadata.direction]||e.metadata.direction);return pieces.join(' · ');}
function trainingSetLabel(s){return `${DOMAIN_LABEL[s.domain]} 훈련 · ${LABELS[s.trainingType]||s.trainingType}`;}
function trainingSetSub(s){const bits=[`${s.quantity} ${s.unit==='throws'?'throws':s.unit==='swings'?'swings':'reps'}`];if(s.side)bits.push(s.domain==='pitching'?sideThrow(s.side):sideBat(s.side));if(s.metadata?.velocity)bits.push(`${s.metadata.velocity} km/h`);if(Number(s.tluTotal))bits.push(`${n2(s.tluTotal)} TLU`);return bits.join(' · ');}
function fieldResultLabel(v){return v==='success'?'포구 성공':v==='unstable'?'포구 불안정':'포구 실패';}function throwResultLabel(v){return v==='success'?'송구 성공':v==='error'?'악송구':'송구 없음';}
function recordRowHtml(r){return `<div class="recent-item"><span class="record-time">${fmtTime(r.recordedAt)}</span><span class="record-icon">${r.mode==='game'?'G':'T'}</span><span class="record-copy"><b>${esc(r.label)}</b><small>${esc(r.sub||'')}</small></span><span class="record-actions"><button data-edit-store="${r.store}" data-edit-id="${r.id}">수정</button><button data-delete-store="${r.store}" data-delete-id="${r.id}">삭제</button></span></div>`;}
function historySection(title,content,count){return content?`<div class="history-subsection"><h4>${title}<span>${count}</span></h4>${content}</div>`:'';}
function renderHistory(){
  const allDates=[...new Set([...recordsFor('gameEvents'),...recordsFor('trainingSets'),...recordsFor('batterFaced'),...recordsFor('plateAppearances')].map(x=>x.activityDate))].sort().reverse();
  const sel=$('#historyDate'),old=ui.historyDate;sel.innerHTML='<option value="all">모든 날짜</option>'+allDates.map(d=>`<option value="${d}">${fmtDate(d)}</option>`).join('');sel.value=allDates.includes(old)?old:'all';ui.historyDate=sel.value;
  $$('#historyMode button').forEach(b=>b.classList.toggle('active',b.dataset.historyMode===ui.historyMode));$$('#historyDomain button').forEach(b=>b.classList.toggle('active',b.dataset.historyDomain===ui.historyDomain));
  const dates=(ui.historyDate==='all'?allDates:[ui.historyDate]).filter(Boolean);let grand=0,html='';
  for(const date of dates){let body='',count=0;
    if(ui.historyMode!=='training'){
      if(ui.historyDomain==='all'||ui.historyDomain==='pitching'){const ps=parentsFor('bf',date),aux=recordsFor('gameEvents').filter(e=>e.activityDate===date&&e.domain==='pitching'&&!e.parentId).sort((a,b)=>new Date(b.recordedAt)-new Date(a.recordedAt));const c=ps.map(p=>parentCardHtml('bf',p)).join('')+(aux.length?`<div class="aux-log">${aux.map(e=>recordRowHtml({store:'gameEvents',id:e.id,activityDate:e.activityDate,recordedAt:e.recordedAt,mode:'game',domain:'pitching',label:gameEventLabel(e),sub:gameEventSub(e)})).join('')}</div>`:'');body+=historySection('경기 · 투구',c,ps.length+aux.length);count+=ps.length+aux.length;}
      if(ui.historyDomain==='all'||ui.historyDomain==='hitting'){const ps=parentsFor('pa',date),c=ps.map(p=>parentCardHtml('pa',p)).join('');body+=historySection('경기 · 타격',c,ps.length);count+=ps.length;}
      for(const d of ['defense','baserunning'])if(ui.historyDomain==='all'||ui.historyDomain===d){const rs=collectTimeline({date,mode:'game',domain:d});body+=historySection(`경기 · ${DOMAIN_LABEL[d]}`,rs.map(recordRowHtml).join(''),rs.length);count+=rs.length;}
    }
    if(ui.historyMode!=='game'){
      const domains=ui.historyDomain==='all'?['pitching','hitting','defense','baserunning']:[ui.historyDomain];for(const d of domains){const rs=collectTimeline({date,mode:'training',domain:d});body+=historySection(`훈련 · ${DOMAIN_LABEL[d]}`,rs.map(recordRowHtml).join(''),rs.length);count+=rs.length;}
    }
    if(count){grand+=count;html+=`<section class="history-date-group"><div class="history-date-head"><h3>${fmtDate(date)}</h3><span>${count} records</span></div>${body}</section>`;}
  }
  $('#historyCount').textContent=`${grand} records`;$('#historyList').innerHTML=html||'<div class="scope-note">조건에 맞는 기록이 없습니다.</div>';
}
function analysisRange(){
  const today=todayKey();
  if(ui.analysisPeriod==='7')return {from:dateShift(today,-6),to:today,label:'최근 7일'};
  if(ui.analysisPeriod==='30')return {from:dateShift(today,-29),to:today,label:'최근 30일'};
  if(ui.analysisPeriod==='90')return {from:dateShift(today,-89),to:today,label:'최근 90일'};
  if(ui.analysisPeriod==='season')return {from:`${today.slice(0,4)}-01-01`,to:`${today.slice(0,4)}-12-31`,label:`${today.slice(0,4)} 시즌`};
  if(ui.analysisPeriod==='custom'){
    let from=ui.analysisFrom||dateShift(today,-29),to=ui.analysisTo||today;if(from>to)[from,to]=[to,from];
    return {from,to,label:`${fmtDate(from)} ~ ${fmtDate(to)}`};
  }
  const dates=[...recordsFor('gameEvents'),...recordsFor('trainingSets'),...recordsFor('batterFaced'),...recordsFor('plateAppearances'),...recordsFor('gameDays')].map(x=>x.activityDate).filter(Boolean).sort();
  return {from:dates[0]||today,to:dates.at(-1)||today,label:'전체'};
}

const ANALYSIS_METRICS={
  pitching:{
    officialPitches:{name:'Pitches',ko:'공식 투구수',full:'Official Pitches',desc:'타자를 상대로 기록된 공식 투구의 총 개수입니다.',formula:'공식 pitch 이벤트 합계',format:'count'},
    gameTLU:{name:'Game TLU',ko:'경기 투구 부하',full:'Game Throwing Load',desc:'공식 투구, 견제, 연습투구와 수비 송구까지 합산한 경기 Throwing Load입니다. 상대 타자 좌우 필터를 선택하면 그 타자에게 던진 공식 투구만 반영합니다.',formula:'공식투구 + 견제 + 연습투구 + 수비송구 TLU',format:'tlu'},
    bf:{name:'BF',ko:'완료 타자',full:'Batters Faced',desc:'결과가 정상적으로 완료된 타자 상대 수입니다.',formula:'완료 BF 합계',format:'count'},
    strikePct:{name:'Strike%',ko:'스트라이크 비율',full:'Strike Percentage',desc:'공식 투구 중 루킹, 헛스윙, 파울, 인플레이로 기록된 스트라이크 비율입니다.',formula:'Strikes / Official Pitches',format:'pct'},
    firstPitchStrikePct:{name:'1st Strike%',ko:'초구 스트라이크',full:'First-Pitch Strike Percentage',desc:'각 타자의 첫 공이 스트라이크였던 비율입니다.',formula:'First-Pitch Strikes / BF with a first pitch',format:'pct'},
    ballPct:{name:'Ball%',ko:'볼 비율',full:'Ball Percentage',desc:'공식 투구 중 BALL로 기록된 비율입니다.',formula:'Balls / Official Pitches',format:'pct'},
    bbPct:{name:'BB%',ko:'볼넷 비율',full:'Walk Percentage',desc:'완료된 타자 상대 중 볼넷으로 끝난 비율입니다.',formula:'BB / Completed BF',format:'pct'},
    pitchesPerBatter:{name:'P/BF',ko:'타자당 투구수',full:'Pitches per Batter Faced',desc:'정상 완료된 타자 한 명을 상대하는 데 사용한 평균 공식 투구수입니다.',formula:'Pitches in completed BF / Completed BF',format:'ratio'},
    cswPct:{name:'CSW%',ko:'루킹+헛스윙',full:'Called Strikes + Whiffs',desc:'루킹 스트라이크와 헛스윙을 합친 비율입니다. 타자를 얼마나 자주 방망이를 못 내거나 헛돌게 했는지 보는 과정 지표입니다.',formula:'(Called Strikes + Swinging Strikes) / Official Pitches',format:'pct'},
    swStrPct:{name:'SwStr%',ko:'헛스윙 비율',full:'Swinging Strike Percentage',desc:'공식 투구 중 헛스윙이 나온 비율입니다.',formula:'Swinging Strikes / Official Pitches',format:'pct'},
    calledStrikePct:{name:'Called Strike%',ko:'루킹 비율',full:'Called Strike Percentage',desc:'공식 투구 중 타자가 지켜본 스트라이크 비율입니다.',formula:'Called Strikes / Official Pitches',format:'pct'},
    kPct:{name:'K%',ko:'삼진 비율',full:'Strikeout Percentage',desc:'완료된 타자 상대 중 삼진으로 끝낸 비율입니다.',formula:'K / Completed BF',format:'pct'},
    kMinusBbPct:{name:'K-BB%',ko:'삼진-볼넷',full:'Strikeout Minus Walk Percentage',desc:'삼진율에서 볼넷율을 뺀 값입니다. 삼진과 볼넷 제어를 한 숫자로 비교하는 지표입니다.',formula:'K% - BB%',format:'pct'},
    foulPct:{name:'Foul%',ko:'파울 비율',full:'Foul Percentage',desc:'공식 투구 중 파울이 된 비율입니다.',formula:'Fouls / Official Pitches',format:'pct'},
    inPlayPct:{name:'In Play%',ko:'인플레이 비율',full:'Ball In Play Percentage',desc:'공식 투구 중 타구가 인플레이가 된 비율입니다.',formula:'In Play / Official Pitches',format:'pct'},
    hbpPitchPct:{name:'HBP%',ko:'사구 투구 비율',full:'Hit by Pitch Rate',desc:'공식 투구 중 HBP로 기록된 비율입니다.',formula:'HBP / Official Pitches',format:'pct'},
    gbPct:{name:'GB%',ko:'땅볼 비율',full:'Ground Ball Percentage',desc:'타구 형태가 입력된 인플레이 타구 중 땅볼 비율입니다.',formula:'GB / BIP with batted-ball type',format:'pct'},
    ldPct:{name:'LD%',ko:'라인드라이브',full:'Line Drive Percentage',desc:'타구 형태가 입력된 인플레이 타구 중 라인드라이브 비율입니다.',formula:'LD / BIP with batted-ball type',format:'pct'},
    fbPct:{name:'FB%',ko:'뜬공 비율',full:'Fly Ball Percentage',desc:'타구 형태가 입력된 인플레이 타구 중 뜬공 비율입니다.',formula:'FB / BIP with batted-ball type',format:'pct'}
  },
  hitting:{
    PA:{name:'PA',ko:'완료 타석',full:'Plate Appearances',desc:'결과가 정상 완료된 타석 수입니다.',formula:'Completed PA',format:'count'},
    H:{name:'H',ko:'안타',full:'Hits',desc:'1루타, 2루타, 3루타, 홈런의 합계입니다.',formula:'1B + 2B + 3B + HR',format:'count'},
    AVG:{name:'AVG',ko:'타율',full:'Batting Average',desc:'공식 타수 중 안타가 된 비율입니다.',formula:'H / AB',format:'dec'},
    OBP:{name:'OBP',ko:'출루율',full:'On-Base Percentage',desc:'안타, 볼넷, 사구를 포함해 타자가 출루한 비율입니다.',formula:'(H + BB + HBP) / (AB + BB + HBP + SF)',format:'dec'},
    SLG:{name:'SLG',ko:'장타율',full:'Slugging Percentage',desc:'타수당 획득한 총 루타를 나타냅니다.',formula:'Total Bases / AB',format:'dec'},
    OPS:{name:'OPS',ko:'출루율+장타율',full:'On-Base Plus Slugging',desc:'출루율과 장타율을 더한 공격 결과 지표입니다.',formula:'OBP + SLG',format:'dec'},
    ISO:{name:'ISO',ko:'순장타율',full:'Isolated Power',desc:'타율의 영향을 빼고 장타 생산만 분리해서 보는 지표입니다.',formula:'SLG - AVG',format:'dec'},
    BABIP:{name:'BABIP',ko:'인플레이 타율',full:'Batting Average on Balls in Play',desc:'홈런을 제외하고 타구가 경기장 안으로 들어갔을 때 안타가 된 비율입니다.',formula:'(H - HR) / (AB - SO - HR + SF)',format:'dec'},
    pitchesPerPA:{name:'P/PA',ko:'타석당 투구수',full:'Pitches per Plate Appearance',desc:'정상 완료된 한 타석에서 본 평균 투구수입니다.',formula:'Pitches in completed PA / Completed PA',format:'ratio'},
    swingPct:{name:'Swing%',ko:'스윙 비율',full:'Swing Percentage',desc:'기록된 투구 중 타자가 스윙한 비율입니다.',formula:'Swings / Recorded Pitches',format:'pct'},
    whiffPct:{name:'Whiff%',ko:'헛스윙 비율',full:'Whiff Percentage',desc:'스윙한 횟수 중 공을 맞히지 못한 비율입니다.',formula:'Whiffs / Swings',format:'pct'},
    contactPct:{name:'Contact%',ko:'컨택 비율',full:'Contact Percentage',desc:'스윙한 횟수 중 파울 또는 인플레이 타구로 공을 맞힌 비율입니다.',formula:'Contacts / Swings',format:'pct'},
    calledStrikePct:{name:'Called Strike%',ko:'루킹 비율',full:'Called Strike Percentage',desc:'기록된 투구 중 스트라이크를 지켜본 비율입니다.',formula:'Taken Strikes / Recorded Pitches',format:'pct'},
    kPct:{name:'K%',ko:'삼진 비율',full:'Strikeout Percentage',desc:'완료 타석 중 삼진으로 끝난 비율입니다.',formula:'SO / Completed PA',format:'pct'},
    bbPct:{name:'BB%',ko:'볼넷 비율',full:'Walk Percentage',desc:'완료 타석 중 볼넷으로 끝난 비율입니다.',formula:'BB / Completed PA',format:'pct'},
    bbPerK:{name:'BB/K',ko:'볼넷/삼진',full:'Walk-to-Strikeout Ratio',desc:'삼진 한 번당 볼넷을 얼마나 얻었는지 보는 비율입니다.',formula:'BB / SO',format:'ratio'},
    gbPct:{name:'GB%',ko:'땅볼 비율',full:'Ground Ball Percentage',desc:'타구 형태가 입력된 인플레이 타구 중 땅볼 비율입니다.',formula:'GB / BIP with batted-ball type',format:'pct'},
    ldPct:{name:'LD%',ko:'라인드라이브',full:'Line Drive Percentage',desc:'타구 형태가 입력된 인플레이 타구 중 라인드라이브 비율입니다.',formula:'LD / BIP with batted-ball type',format:'pct'},
    fbPct:{name:'FB%',ko:'뜬공 비율',full:'Fly Ball Percentage',desc:'타구 형태가 입력된 인플레이 타구 중 뜬공 비율입니다.',formula:'FB / BIP with batted-ball type',format:'pct'}
  },
  defense:{
    fieldingSuccessPct:{name:'Fielding%',ko:'포구 성공률',full:'Fielding Success Percentage',desc:'기록된 포구 기회 중 성공으로 처리한 비율입니다.',formula:'Successful Fields / Fielding Attempts',format:'pct'},
    throwSuccessPct:{name:'Throw Accuracy%',ko:'정상 송구율',full:'Throw Accuracy Percentage',desc:'송구 시도 중 정상 송구로 기록된 비율입니다. 받는 선수의 포구 실책과는 분리합니다.',formula:'Successful Throws / Throw Attempts',format:'pct'},
    plays:{name:'Chances',ko:'수비 기회',full:'Defensive Chances',desc:'기록된 수비 플레이 수입니다.',formula:'Fielding Plays',format:'count'},
    throwAttempts:{name:'Throws',ko:'송구 수',full:'Defensive Throws',desc:'정상 송구 또는 악송구로 기록된 송구 시도 수입니다.',formula:'Successful + Error Throws',format:'count'},
    throwTLU:{name:'Throw TLU',ko:'수비 송구 부하',full:'Defensive Throwing Load',desc:'경기 수비 송구에서 발생한 Throwing Load 합계입니다.',formula:'Sum of defensive throw TLU',format:'tlu'}
  },
  baserunning:{
    sb:{name:'SB',ko:'도루 성공',full:'Stolen Bases',desc:'도루 시도에서 성공으로 기록된 횟수입니다.',formula:'Successful steal attempts',format:'count'},
    cs:{name:'CS',ko:'도루 실패',full:'Caught Stealing',desc:'도루 시도에서 실패로 기록된 횟수입니다.',formula:'Failed steal attempts',format:'count'},
    attempts:{name:'Attempts',ko:'도루 시도',full:'Steal Attempts',desc:'성공과 실패를 합친 전체 도루 시도 수입니다.',formula:'SB + CS',format:'count'},
    sbPct:{name:'SB%',ko:'도루 성공률',full:'Stolen Base Percentage',desc:'전체 도루 시도 중 성공한 비율입니다.',formula:'SB / (SB + CS)',format:'pct'}
  },
  training:{
    total_tlu:{name:'Total TLU',ko:'전체 투구 부하',full:'Total Throwing Load',desc:'경기와 훈련에서 기록된 모든 Throwing Load의 합계입니다.',formula:'Game + Training Throwing Load',format:'tlu'},
    throws:{name:'Throws',ko:'훈련 송구량',full:'Training Throws',desc:'투구 훈련 throws와 수비 훈련에서 기록한 송구 횟수를 합친 값입니다.',formula:'Pitching training throws + Defense training throws',format:'count'},
    swings:{name:'Swings',ko:'타격 훈련량',full:'Training Swings',desc:'훈련에서 기록한 전체 스윙 수입니다.',formula:'Hitting training volume',format:'count'},
    defenseReps:{name:'Defense Reps',ko:'수비 훈련량',full:'Defense Repetitions',desc:'수비 훈련에서 기록한 전체 repetitions입니다.',formula:'Defense training volume',format:'count'},
    baserunningReps:{name:'Baserunning',ko:'주루 훈련량',full:'Baserunning Repetitions',desc:'주루 훈련에서 기록한 전체 repetitions입니다.',formula:'Baserunning training volume',format:'count'},
    volume:{name:'Volume',ko:'훈련량',full:'Training Volume',desc:'선택한 종목의 훈련량 합계입니다.',formula:'Quantity sum',format:'count'},
    tlu:{name:'TLU',ko:'종목 투구 부하',full:'Domain Throwing Load',desc:'선택한 훈련 종목에서 발생한 Throwing Load 합계입니다.',formula:'Training TLU sum',format:'tlu'},
    sets:{name:'Sets',ko:'훈련 세트',full:'Training Sets',desc:'선택한 종목에서 저장한 훈련 세트 수입니다.',formula:'Training set count',format:'count'},
    throwCount:{name:'Throws',ko:'수비 송구량',full:'Defense Training Throws',desc:'수비 훈련에서 실제 송구한 횟수의 합계입니다.',formula:'Defense throw count',format:'count'},
    light:{name:'Light',ko:'가벼운 투구',full:'Light Throwing Volume',desc:'0.75 TLU 강도로 기록한 투구 훈련 횟수입니다.',formula:'Light throws',format:'count'},
    medium:{name:'Medium',ko:'중간 투구',full:'Medium Throwing Volume',desc:'0.85 TLU 강도로 기록한 투구 훈련 횟수입니다.',formula:'Medium throws',format:'count'},
    max:{name:'Max',ko:'전력 투구',full:'Max Throwing Volume',desc:'1.00 TLU 강도로 기록한 투구 훈련 횟수입니다.',formula:'Max throws',format:'count'}
  }
};

function metricConfig(id,domain=ui.analysisDomain,source=ui.analysisSource){
  if(source==='training')return ANALYSIS_METRICS.training[id]||{name:LABELS[id]||id,ko:'훈련 세부량',full:LABELS[id]||id,desc:'선택한 훈련 유형의 기록량입니다.',formula:'Training quantity',format:'count'};
  return ANALYSIS_METRICS[domain]?.[id]||{name:id,ko:'',full:id,desc:'',formula:'',format:'count'};
}
function analysisMetricGroups(snapshot){
  if(ui.analysisSource==='game'){
    if(ui.analysisDomain==='pitching')return [
      {title:'투구량',ids:['officialPitches','gameTLU','bf']},
      {title:'제구',ids:['strikePct','firstPitchStrikePct','ballPct','bbPct','pitchesPerBatter']},
      {title:'위력',ids:['cswPct','swStrPct','calledStrikePct','kPct','kMinusBbPct']},
      {title:'투구 결과',ids:['foulPct','inPlayPct','hbpPitchPct']},
      {title:'타구 프로필',ids:['gbPct','ldPct','fbPct']}
    ];
    if(ui.analysisDomain==='hitting')return [
      {title:'결과',ids:['PA','H','AVG','OBP','SLG','OPS','ISO','BABIP']},
      {title:'선구 · 컨택',ids:['pitchesPerPA','swingPct','whiffPct','contactPct','calledStrikePct','kPct','bbPct','bbPerK']},
      {title:'타구 프로필',ids:['gbPct','ldPct','fbPct']}
    ];
    if(ui.analysisDomain==='defense')return [{title:'수비 핵심',ids:['fieldingSuccessPct','throwSuccessPct','plays','throwAttempts','throwTLU']}];
    return [{title:'주루 핵심',ids:['sb','cs','attempts','sbPct']}];
  }
  if(ui.analysisDomain==='all')return [{title:'워크로드 · 훈련량',ids:['total_tlu','throws','swings','defenseReps','baserunningReps']}];
  if(ui.analysisDomain==='pitching')return [{title:'투구 훈련',ids:['volume','tlu','total_tlu','light','medium','max']}];
  if(ui.analysisDomain==='hitting'){const types=Object.keys(snapshot.summary.byType||{}).slice(0,6);return [{title:'타격 훈련',ids:['volume','sets',...types]}];}
  if(ui.analysisDomain==='defense'){const types=Object.keys(snapshot.summary.byType||{}).slice(0,6);return [{title:'수비 훈련',ids:['volume','throwCount','tlu','total_tlu',...types]}];}
  const types=Object.keys(snapshot.summary.byType||{}).slice(0,6);return [{title:'주루 훈련',ids:['volume','sets',...types]}];
}
function formatMetricValue(value,cfg){
  if(value==null||!Number.isFinite(Number(value)))return '—';const v=Number(value);
  if(cfg.format==='pct')return `${v.toFixed(1)}%`;
  if(cfg.format==='dec')return v.toFixed(3).replace(/^0/,'');
  if(cfg.format==='ratio')return v.toFixed(2);
  if(cfg.format==='tlu')return n2(v);
  return Number.isInteger(v)?String(v):(Math.abs(v)>=100?Math.round(v).toLocaleString():Number(v.toFixed(1)).toString());
}
function analysisViewOptions(){return ui.analysisSource==='game'?[['game','경기별'],['week','주간'],['month','월간'],['year','연간']]:[['day','일별'],['week','주간'],['month','월간'],['year','연간']];}
function ensureAnalysisState(groups){
  const ids=groups.flatMap(g=>g.ids);if(!ids.includes(ui.analysisMetric))ui.analysisMetric=ids[0]||null;
  const views=analysisViewOptions().map(x=>x[0]);if(!views.includes(ui.analysisView))ui.analysisView=ui.analysisSource==='game'?'game':'day';
}
function analysisOpts(range){return {athleteId:activeAthleteId,source:ui.analysisSource,domain:ui.analysisDomain,from:range.from,to:range.to,ownSide:ui.ownSide==='all'?null:ui.ownSide,oppSide:ui.oppSide==='all'?null:ui.oppSide};}
function sparklineSvg(series){
  if(!series.length)return '<span class="spark-empty">기록 없음</span>';if(series.length===1)return `<svg class="metric-spark" viewBox="0 0 120 34"><circle cx="60" cy="17" r="4"/></svg>`;
  const W=120,H=34,p=3,vals=series.map(x=>x.value),max=Math.max(...vals),min=Math.min(...vals),span=max-min||1,pts=series.map((x,i)=>({x:p+(W-p*2)*i/(series.length-1),y:p+(H-p*2)*(1-(x.value-min)/span)})),path=pts.map((q,i)=>`${i?'L':'M'}${q.x.toFixed(1)},${q.y.toFixed(1)}`).join(' ');
  return `<svg class="metric-spark" viewBox="0 0 ${W} ${H}" aria-hidden="true"><path d="${path}"/><circle cx="${pts.at(-1).x}" cy="${pts.at(-1).y}" r="3"/></svg>`;
}
function metricCardHtml(id,snapshot,range){
  const cfg=metricConfig(id),value=analysisMetricValue(snapshot,id),series=analysisSeries(data,{...analysisOpts(range),metric:id,viewUnit:ui.analysisView}),selected=id===ui.analysisMetric;
  return `<button type="button" class="analysis-metric-card ${selected?'selected':''}" data-analysis-metric="${esc(id)}"><span class="metric-name">${esc(cfg.name)}</span><b>${formatMetricValue(value,cfg)}</b>${cfg.ko?`<small>${esc(cfg.ko)}</small>`:''}${sparklineSvg(series)}</button>`;
}
function renderAnalysisControls(){
  $$('#analysisSourceTabs button').forEach(b=>b.classList.toggle('active',b.dataset.analysisSource===ui.analysisSource));
  $$('#analysisPeriodTabs button').forEach(b=>b.classList.toggle('active',b.dataset.period===ui.analysisPeriod));
  const custom=ui.analysisPeriod==='custom';$('#analysisCustomRange').hidden=!custom;$('#analysisFrom').value=ui.analysisFrom||'';$('#analysisTo').value=ui.analysisTo||'';
  const allBtn=$('#analysisDomainTabs [data-analysis-domain="all"]');allBtn.hidden=ui.analysisSource!=='training';
  if(ui.analysisSource==='game'&&ui.analysisDomain==='all')ui.analysisDomain='pitching';
  $$('#analysisDomainTabs button').forEach(b=>b.classList.toggle('active',b.dataset.analysisDomain===ui.analysisDomain));
  $('#analysisViewTabs').innerHTML=analysisViewOptions().map(([v,l])=>`<button type="button" data-analysis-view="${v}" class="${v===ui.analysisView?'active':''}">${l}</button>`).join('');
  renderSideFilters();
}
function renderAnalysis(){
  const a=athlete();if(!a)return;renderAnalysisControls();const r=analysisRange(),snapshot=analysisSnapshot(data,{...analysisOpts(r)}),groups=analysisMetricGroups(snapshot);ensureAnalysisState(groups);renderAnalysisControls();
  $('#analysisMetrics').innerHTML=groups.map(g=>`<section class="metric-group"><div class="metric-group-head"><h3>${esc(g.title)}</h3><span>${esc(r.label)} · ${esc(analysisViewOptions().find(x=>x[0]===ui.analysisView)?.[1]||'')}</span></div><div class="analysis-metric-grid">${g.ids.map(id=>metricCardHtml(id,snapshot,r)).join('')}</div></section>`).join('');
  renderAnalysisDetail(snapshot,r);renderAnalysisBreakdown(snapshot,r);
}
function metricSample(snapshot){
  if(snapshot.source==='game'){
    const s=snapshot.summary;if(snapshot.domain==='pitching')return `${s.officialPitches} Pitches · ${s.bf} 완료 BF${s.unknownBF?` · ${s.unknownBF} 결과 미상`:''}`;
    if(snapshot.domain==='hitting')return `${s.PA} 완료 PA · ${s.totalPitches} Pitches${s.unknownPA?` · ${s.unknownPA} 결과 미상`:''}`;
    if(snapshot.domain==='defense')return `${s.plays} Chances · ${s.throwAttempts} Throws`;
    return `${s.attempts} Attempts · SB ${s.sb} / CS ${s.cs}`;
  }
  const s=snapshot.summary;return `${s.sets.length} Sets · ${n2(snapshot.workload.total)} Total TLU`;
}
function renderAnalysisDetail(snapshot,range){
  const id=ui.analysisMetric,cfg=metricConfig(id),value=analysisMetricValue(snapshot,id),series=analysisSeries(data,{...analysisOpts(range),metric:id,viewUnit:ui.analysisView});analysisDetailSeries=series;
  const latest=series.at(-1),maxPoint=series.length?series.reduce((a,b)=>b.value>a.value?b:a):null,viewLabel=analysisViewOptions().find(x=>x[0]===ui.analysisView)?.[1]||'';
  $('#analysisDetail').innerHTML=`<div class="detail-head"><div><span class="detail-eyebrow">선택 지표 · ${esc(viewLabel)}</span><h2>${esc(cfg.name)} <strong>${formatMetricValue(value,cfg)}</strong></h2><p class="metric-full-name">${esc(cfg.full)}${cfg.ko?` · ${esc(cfg.ko)}`:''}</p></div><div class="detail-stat-strip"><div><span>기간 전체</span><b>${formatMetricValue(value,cfg)}</b></div><div><span>최근 구간</span><b>${latest?formatMetricValue(latest.value,cfg):'—'}</b></div><div><span>최대값</span><b>${maxPoint?formatMetricValue(maxPoint.value,cfg):'—'}</b></div></div></div><p class="metric-description">${esc(cfg.desc)}</p><div class="metric-formula"><span>계산</span><code>${esc(cfg.formula)}</code></div><div class="detail-chart-wrap">${detailChartSvg(series,cfg)}</div><div id="analysisPointInfo" class="chart-point-info">${latest?pointInfoHtml(latest,cfg):'선택한 조건에 표시할 추이 데이터가 없습니다.'}</div><div class="detail-sample"><span>표본</span><b>${esc(metricSample(snapshot))}</b></div>`;
}
function detailChartSvg(series,cfg){
  if(!series.length)return '<div class="chart-empty">표시할 데이터가 없습니다.</div>';
  const W=920,H=300,pad={l:58,r:22,t:22,b:50},vals=series.map(x=>x.value),maxVal=Math.max(...vals),top=maxVal===0?1:maxVal*1.15,pts=series.map((x,i)=>{const px=pad.l+(W-pad.l-pad.r)*(series.length===1?.5:i/(series.length-1)),py=pad.t+(H-pad.t-pad.b)*(1-x.value/top);return {...x,x:px,y:py};}),path=pts.map((p,i)=>`${i?'L':'M'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' '),every=Math.max(1,Math.ceil(series.length/6));
  const grid=[0,.25,.5,.75,1].map(t=>{const y=pad.t+(H-pad.t-pad.b)*(1-t),v=top*t;return `<line x1="${pad.l}" y1="${y}" x2="${W-pad.r}" y2="${y}" class="chart-grid-line"/><text x="${pad.l-10}" y="${y+4}" text-anchor="end" class="chart-axis-text">${esc(formatMetricValue(v,cfg))}</text>`;}).join('');
  return `<svg class="detail-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(cfg.name)} 추이">${grid}<path d="${path}" class="detail-chart-line"/>${pts.map((p,i)=>`<circle class="detail-chart-point" data-chart-point="${i}" cx="${p.x}" cy="${p.y}" r="6"/>${i%every===0||i===pts.length-1?`<text x="${p.x}" y="${H-16}" text-anchor="middle" class="chart-axis-text">${esc(p.label)}</text>`:''}`).join('')}</svg>`;
}
function pointInfoHtml(point,cfg){return `<b>${esc(point.label)}</b><span>${esc(cfg.name)} ${formatMetricValue(point.value,cfg)}</span><small>${esc(metricSample(point.snapshot))}</small>`;}
function renderChartPoint(index){const p=analysisDetailSeries[Number(index)],el=$('#analysisPointInfo');if(!p||!el)return;el.innerHTML=pointInfoHtml(p,metricConfig(ui.analysisMetric));$$('.detail-chart-point').forEach((x,i)=>x.classList.toggle('selected',i===Number(index)));}
function breakdownHtml(title,obj){const entries=Object.entries(obj||{}).filter(([,v])=>Number(v)>0);if(!entries.length)return '';return `<section class="breakdown-section"><h3>${esc(title)}</h3><div class="breakdown-grid">${entries.map(([k,v])=>`<div class="breakdown-item"><span>${esc(k)}</span><b>${v}</b></div>`).join('')}</div></section>`;}
function breakdownBarsHtml(title,obj,labelMap={}){const entries=Object.entries(obj||{}).filter(([,v])=>Number(v)>0),total=entries.reduce((a,[,v])=>a+Number(v),0);if(!entries.length||!total)return '';return `<section class="breakdown-section"><h3>${esc(title)}</h3><div class="breakdown-bars">${entries.map(([k,v])=>{const per=Number(v)/total*100;return `<div class="breakdown-bar-row"><div><span>${esc(labelMap[k]||k)}</span><b>${typeof v==='number'&&!Number.isInteger(v)?n2(v):v} · ${per.toFixed(1)}%</b></div><div class="breakdown-track"><i style="width:${Math.max(2,per)}%"></i></div></div>`;}).join('')}</div></section>`;}
function defenseThrowTargetTable(stats){const labels={'1B':'1루','2B':'2루','3B':'3루',HOME:'홈',RELAY:'중계'};const rows=Object.entries(stats||{}).filter(([,x])=>x.attempts>0);if(!rows.length)return '';return `<section class="breakdown-section"><h3>송구 목적지별</h3><div class="analysis-table-wrap"><table class="analysis-table"><thead><tr><th>목적지</th><th>시도</th><th>정상</th><th>악송구</th><th>성공률</th></tr></thead><tbody>${rows.map(([k,x])=>`<tr><td>${labels[k]||esc(k)}</td><td>${x.attempts}</td><td>${x.success}</td><td>${x.error}</td><td>${pct(x.successPct,1)}</td></tr>`).join('')}</tbody></table></div></section>`;}
function defenseFieldTypeThrowTable(stats){const labels={FRONT:'정면',FOREHAND:'포핸드',BACKHAND:'백핸드',CHARGE:'전진',FORWARD:'앞으로',STRAIGHT:'정면',LATERAL:'좌우',BACK:'뒤로'};const rows=Object.entries(stats||{}).filter(([,x])=>x.attempts>0);if(!rows.length)return '';return `<section class="breakdown-section"><h3>포구 형태 후 송구</h3><div class="analysis-table-wrap"><table class="analysis-table"><thead><tr><th>포구 형태</th><th>시도</th><th>정상</th><th>악송구</th><th>성공률</th></tr></thead><tbody>${rows.map(([k,x])=>`<tr><td>${labels[k]||esc(k)}</td><td>${x.attempts}</td><td>${x.success}</td><td>${x.error}</td><td>${pct(x.successPct,1)}</td></tr>`).join('')}</tbody></table></div></section>`;}
function pitchingSplitTable(range){
  const own=ui.ownSide==='all'?null:ui.ownSide,rows=[['R','우타'],['L','좌타']].map(([side,label])=>[label,gamePitchingSummary(data,{athleteId:activeAthleteId,from:range.from,to:range.to,pitcherSide:own,batterSide:side})]).filter(([,s])=>s.events.length||s.bf);
  if(!rows.length)return '';return `<section class="breakdown-section"><h3>상대 타자 좌우 스플릿</h3><div class="analysis-table-wrap"><table class="analysis-table"><thead><tr><th>상대</th><th>BF</th><th>Strike%</th><th>CSW%</th><th>K%</th><th>BB%</th></tr></thead><tbody>${rows.map(([l,s])=>`<tr><td>${l}</td><td>${s.bf}</td><td>${pct(s.strikePct,1)}</td><td>${pct(s.cswPct,1)}</td><td>${pct(s.kPct,1)}</td><td>${pct(s.bbPct,1)}</td></tr>`).join('')}</tbody></table></div></section>`;}
function hittingSplitTable(range){
  const own=ui.ownSide==='all'?null:ui.ownSide,rows=[['R','우투'],['L','좌투']].map(([side,label])=>[label,battingSummary(data,{athleteId:activeAthleteId,from:range.from,to:range.to,batterSide:own,pitcherSide:side})]).filter(([,s])=>s.events.length||s.PA);
  if(!rows.length)return '';return `<section class="breakdown-section"><h3>상대 투수 좌우 스플릿</h3><div class="analysis-table-wrap"><table class="analysis-table"><thead><tr><th>상대</th><th>PA</th><th>AVG</th><th>OPS</th><th>Contact%</th><th>Whiff%</th></tr></thead><tbody>${rows.map(([l,s])=>`<tr><td>${l}</td><td>${s.PA}</td><td>${dec(s.AVG)}</td><td>${dec(s.OPS)}</td><td>${pct(s.contactPct,1)}</td><td>${pct(s.whiffPct,1)}</td></tr>`).join('')}</tbody></table></div></section>`;}
function baserunningRouteTable(routes){const labels={'1B>2B':'1루 → 2루','2B>3B':'2루 → 3루','3B>HOME':'3루 → 홈'},rows=Object.entries(routes||{}).filter(([,x])=>x.attempts);if(!rows.length)return '';return `<section class="breakdown-section"><h3>구간별 도루</h3><div class="analysis-table-wrap"><table class="analysis-table"><thead><tr><th>구간</th><th>시도</th><th>성공</th><th>실패</th><th>성공률</th></tr></thead><tbody>${rows.map(([k,x])=>`<tr><td>${labels[k]||esc(k)}</td><td>${x.attempts}</td><td>${x.success}</td><td>${x.failed}</td><td>${pct(x.successPct,1)}</td></tr>`).join('')}</tbody></table></div></section>`;}
function renderAnalysisBreakdown(snapshot,range){
  let html='';const s=snapshot.summary;
  if(ui.analysisSource==='game'&&ui.analysisDomain==='pitching')html=breakdownHtml('데이터 상태',{'완료 BF':s.bf,'결과 미상':s.unknownBF,'미완료':s.incompleteBF})+breakdownBarsHtml('타구 형태',s.battedTypes,{GB:'GB · 땅볼',LD:'LD · 라인드라이브',FB:'FB · 뜬공'})+breakdownBarsHtml('타구 방향',s.directions,{L:'좌',C:'중',R:'우'})+breakdownHtml('타구 결과',s.battedResults)+pitchingSplitTable(range);
  else if(ui.analysisSource==='game'&&ui.analysisDomain==='hitting')html=breakdownHtml('데이터 상태',{'완료 PA':s.PA,'결과 미상':s.unknownPA,'미완료':s.incompletePA})+breakdownBarsHtml('타구 형태',s.battedTypes,{GB:'GB · 땅볼',LD:'LD · 라인드라이브',FB:'FB · 뜬공'})+breakdownBarsHtml('타구 방향',s.directions,{L:'좌',C:'중',R:'우'})+breakdownHtml('타격 결과',s.counts)+hittingSplitTable(range);
  else if(ui.analysisSource==='game'&&ui.analysisDomain==='defense')html=breakdownBarsHtml('내야 포구 형태',s.ifTypes,{FRONT:'정면',FOREHAND:'포핸드',BACKHAND:'백핸드',CHARGE:'전진'})+breakdownBarsHtml('외야 접근',s.ofTypes,{FORWARD:'앞으로',STRAIGHT:'정면',LATERAL:'좌우',BACK:'뒤로'})+defenseThrowTargetTable(s.targetStats)+defenseFieldTypeThrowTable(s.fieldTypeThrowStats);
  else if(ui.analysisSource==='game')html=baserunningRouteTable(s.routes);
  else {
    const t=snapshot.summary,w=snapshot.workload;
    if(ui.analysisDomain==='all')html=breakdownBarsHtml('TLU 원천',{'경기 공식투구':w.officialPitchTLU,'견제':w.pickoffTLU,'경기 연습투구':w.warmupTLU,'경기 수비송구':w.gameDefenseThrowing,'투구 훈련':w.pitchingTraining,'훈련 수비송구':w.defenseThrowing})+breakdownBarsHtml('훈련량 구성',{'투구':t.byDomain.pitching.volume,'타격':t.byDomain.hitting.volume,'수비':t.byDomain.defense.volume,'주루':t.byDomain.baserunning.volume});
    else {html=breakdownBarsHtml('훈련 종류',Object.fromEntries(Object.entries(t.byType).map(([k,v])=>[LABELS[k]||k,v])));if(['pitching','hitting'].includes(ui.analysisDomain))html+=breakdownBarsHtml('좌우 비중',{'우':t.bySide.R||0,'좌':t.bySide.L||0});if(ui.analysisDomain==='pitching')html+=breakdownBarsHtml('투구 강도',{'가벼움':t.byIntensity.light||0,'중간':t.byIntensity.medium||0,'전력':t.byIntensity.max||0})+breakdownBarsHtml('전체 TLU 원천',{'경기 공식투구':w.officialPitchTLU,'견제':w.pickoffTLU,'경기 연습투구':w.warmupTLU,'경기 수비송구':w.gameDefenseThrowing,'투구 훈련':w.pitchingTraining,'훈련 수비송구':w.defenseThrowing});if(ui.analysisDomain==='defense')html+=breakdownBarsHtml('내야 / 외야',{'내야':t.byArea.IF||0,'외야':t.byArea.OF||0});}
  }
  $('#analysisBreakdown').innerHTML=html||'<p class="scope-note">선택한 조건에 추가 분해 데이터가 없습니다.</p>';
}
function renderSideFilters(){const el=$('#sideFilters');if(ui.analysisSource==='game'&&ui.analysisDomain==='pitching'){el.innerHTML=sideFilterHtml('내 투구','own','throw')+sideFilterHtml('상대 타자','opp','bat');}else if(ui.analysisSource==='game'&&ui.analysisDomain==='hitting'){el.innerHTML=sideFilterHtml('내 타격','own','bat')+sideFilterHtml('상대 투수','opp','throw');}else if(ui.analysisSource==='training'&&['pitching','hitting'].includes(ui.analysisDomain)){el.innerHTML=sideFilterHtml(ui.analysisDomain==='pitching'?'투구 방향':'타격 방향','own',ui.analysisDomain==='pitching'?'throw':'bat');ui.oppSide='all';}else{el.innerHTML='';ui.ownSide='all';ui.oppSide='all';}}
function sideFilterHtml(label,key,type){const cur=key==='own'?ui.ownSide:ui.oppSide;return `<div class="side-filter-block"><span>${label}</span><button data-analysis-side="${key}:all" class="${cur==='all'?'active':''}">전체</button><button data-analysis-side="${key}:R" class="${cur==='R'?'active':''}">${type==='throw'?'우투':'우타'}</button><button data-analysis-side="${key}:L" class="${cur==='L'?'active':''}">${type==='throw'?'좌투':'좌타'}</button></div>`;}

function renderSettings(){
  const ats=active(data.athletes);$('#athleteCount').textContent=`${ats.length}명`;$('#athleteList').innerHTML=ats.map(a=>athleteRow(a)).join('');$('#athletePickerList').innerHTML=ats.map(a=>athleteRow(a,true)).join('');renderCloudUI();
}
function athleteRow(a,picker=false){return `<div class="athlete-row ${a.id===activeAthleteId?'active':''}"><span class="athlete-avatar">${esc(a.name.slice(0,1))}</span><span class="copy"><b>${esc(a.name)}</b><small>${a.number?`#${esc(a.number)} · `:''}${esc(a.team||'팀 미입력')} · ${sideThrow(a.throws)}/${sideBat(a.bats)}</small></span>${picker?`<button data-pick-athlete="${a.id}">선택</button>`:`<button data-edit-athlete="${a.id}">수정</button>`}</div>`;}

function bindStaticEvents(){
  if(staticEventsBound)return;staticEventsBound=true;
  $$('.bottom-nav button').forEach(b=>b.addEventListener('click',()=>setView(b.dataset.nav)));$$('[data-quick]').forEach(b=>b.addEventListener('click',()=>{ui.inputMode=b.dataset.quick;ui.inputDate=todayKey();setView('input');renderInput();}));
  $('#activityDateInput').addEventListener('change',e=>{resumeContext=null;ui.inputDate=e.target.value||todayKey();renderInput();});
  $$('#inputModeTabs button').forEach(b=>b.addEventListener('click',()=>{resumeContext=null;ui.inputMode=b.dataset.mode;renderInput();}));
  $$('#domainTabs button').forEach(b=>b.addEventListener('click',()=>{resumeContext=null;ui.domain=b.dataset.domain;renderInput();}));
  $('#openDateLogs').addEventListener('click',()=>{ui.historyDate=ui.inputDate;ui.historyMode=ui.inputMode;ui.historyDomain=ui.domain;setView('history');});
  $('#historyDate').addEventListener('change',e=>{ui.historyDate=e.target.value;renderHistory();});$$('#historyMode button').forEach(b=>b.addEventListener('click',()=>{ui.historyMode=b.dataset.historyMode;renderHistory();}));$$('#historyDomain button').forEach(b=>b.addEventListener('click',()=>{ui.historyDomain=b.dataset.historyDomain;renderHistory();}));
  $$('#analysisSourceTabs button').forEach(b=>b.addEventListener('click',()=>{ui.analysisSource=b.dataset.analysisSource;if(ui.analysisSource==='training'){ui.analysisDomain='all';ui.analysisView='day';ui.analysisMetric='total_tlu';}else{if(ui.analysisDomain==='all')ui.analysisDomain='pitching';ui.analysisView='game';ui.analysisMetric=ui.analysisDomain==='hitting'?'OPS':ui.analysisDomain==='defense'?'fieldingSuccessPct':ui.analysisDomain==='baserunning'?'sbPct':'strikePct';}ui.ownSide='all';ui.oppSide='all';renderAnalysis();}));
  $$('#analysisPeriodTabs button').forEach(b=>b.addEventListener('click',()=>{ui.analysisPeriod=b.dataset.period;if(ui.analysisPeriod==='custom'){ui.analysisFrom=ui.analysisFrom||dateShift(todayKey(),-29);ui.analysisTo=ui.analysisTo||todayKey();}renderAnalysis();}));
  $('#analysisFrom').addEventListener('change',e=>{ui.analysisFrom=e.target.value||ui.analysisFrom;ui.analysisPeriod='custom';renderAnalysis();});$('#analysisTo').addEventListener('change',e=>{ui.analysisTo=e.target.value||ui.analysisTo;ui.analysisPeriod='custom';renderAnalysis();});
  $$('#analysisDomainTabs button').forEach(b=>b.addEventListener('click',()=>{if(b.hidden)return;ui.analysisDomain=b.dataset.analysisDomain;ui.ownSide='all';ui.oppSide='all';ui.analysisMetric=ui.analysisSource==='training'?(ui.analysisDomain==='all'?'total_tlu':'volume'):(ui.analysisDomain==='hitting'?'OPS':ui.analysisDomain==='defense'?'fieldingSuccessPct':ui.analysisDomain==='baserunning'?'sbPct':'strikePct');renderAnalysis();}));
  $('#athleteSwitcher').addEventListener('click',()=>showModal('athletePicker'));$('#addAthleteBtn').addEventListener('click',()=>openAthleteModal());$('#pickerAddAthlete').addEventListener('click',()=>{hideModal('athletePicker');openAthleteModal();});$('#athleteForm').addEventListener('submit',saveAthleteForm);$('#deleteAthleteBtn').addEventListener('click',deleteAthleteFromModal);
  $$('[data-close]').forEach(b=>b.addEventListener('click',()=>hideModal(b.dataset.close)));document.querySelectorAll('.modal-backdrop').forEach(m=>m.addEventListener('click',e=>{if(e.target===m)m.hidden=true;}));
  $('#inPlayResults').addEventListener('click',e=>{const b=e.target.closest('[data-result]');if(b)completeInPlay(b.dataset.result);});
  $('#recordEditForm').addEventListener('submit',saveEditedRecord);$('#pitchEditForm').addEventListener('submit',savePitchEdit);$('#deletePitchBtn').addEventListener('click',deletePitchFromEdit);
  $('#undoDeleteBtn').addEventListener('click',undoDelete);
  document.body.addEventListener('click',delegatedClick);
  $('#exportData').addEventListener('click',exportBackup);$('#importData').addEventListener('change',importBackup);
  $('#signInBtn').addEventListener('click',signIn);$('#signUpBtn').addEventListener('click',signUp);$('#signOutBtn').addEventListener('click',signOut);$('#syncNowBtn').addEventListener('click',()=>syncCloud(true));$('#cloudPill').addEventListener('click',()=>setView('settings'));
  $('#installApp').addEventListener('click',promptInstall);$('#installMini').addEventListener('click',promptInstall);
  window.addEventListener('online',()=>{renderCloudStatus();scheduleSync(100);});window.addEventListener('offline',renderCloudStatus);
}
function delegatedClick(e){
  const pick=e.target.closest('[data-pick-athlete]');if(pick)return pickAthlete(pick.dataset.pickAthlete);
  const editA=e.target.closest('[data-edit-athlete]');if(editA)return openAthleteModal(editA.dataset.editAthlete);
  const side=e.target.closest('[data-side-kind]');if(side)return setCurrentSide(side.dataset.sideKind,side.dataset.sideValue||null);
  const as=e.target.closest('[data-analysis-side]');if(as){const [k,v]=as.dataset.analysisSide.split(':');if(k==='own')ui.ownSide=v;else ui.oppSide=v;return renderAnalysis();}
  const av=e.target.closest('[data-analysis-view]');if(av){ui.analysisView=av.dataset.analysisView;return renderAnalysis();}
  const am=e.target.closest('[data-analysis-metric]');if(am){ui.analysisMetric=am.dataset.analysisMetric;renderAnalysis();const detail=$('#analysisDetail');if(detail&&window.innerWidth<700)detail.scrollIntoView({behavior:'smooth',block:'start'});return;}
  const cp=e.target.closest('[data-chart-point]');if(cp)return renderChartPoint(cp.dataset.chartPoint);
  const pitch=e.target.closest('[data-edit-pitch]');if(pitch)return openPitchEdit(pitch.dataset.editPitch);
  const resume=e.target.closest('[data-resume-parent]');if(resume){const [kind,id]=resume.dataset.resumeParent.split(':');return resumeParentInput(kind,id);}
  const closeUnknown=e.target.closest('[data-close-parent-unknown]');if(closeUnknown){const [kind,id]=closeUnknown.dataset.closeParentUnknown.split(':');return closeParentUnknown(kind,id);}
  const deleteParent=e.target.closest('[data-delete-parent]');if(deleteParent){const [kind,id]=deleteParent.dataset.deleteParent.split(':');return softDeleteParent(kind,id);}
  const ep=e.target.closest('[data-edit-parent]');if(ep){const [kind,id]=ep.dataset.editParent.split(':');return openRecordEdit(parentStore(kind),id);}
  const toggle=e.target.closest('[data-toggle-parent]');if(toggle){const [kind,id]=toggle.dataset.toggleParent.split(':');const set=kind==='bf'?expandedBF:expandedPA;set.has(id)?set.delete(id):set.add(id);renderInput();if(ui.view==='history')renderHistory();return;}
  const edit=e.target.closest('[data-edit-store]');if(edit)return openRecordEdit(edit.dataset.editStore,edit.dataset.editId);
  const del=e.target.closest('[data-delete-store]');if(del)return softDeleteRecord(del.dataset.deleteStore,del.dataset.deleteId);
  const pet=e.target.closest('[data-pitch-edit-type]');if(pet){pitchEditType=pet.dataset.pitchEditType;renderPitchEditSelections();return;}
  const per=e.target.closest('[data-pitch-edit-result]');if(per){pitchEditResult=per.dataset.pitchEditResult;renderPitchEditSelections();return;}
}function bindDynamicFormEvents(){
  $$('[data-pitch]').forEach(b=>b.addEventListener('click',()=>recordPitch(b.dataset.pitch)));$$('[data-game-throw]').forEach(b=>b.addEventListener('click',()=>recordGameThrow(b.dataset.gameThrow)));$$('[data-bat-pitch]').forEach(b=>b.addEventListener('click',()=>recordBatPitch(b.dataset.batPitch)));
  $('#defPosition')?.addEventListener('change',renderDefenseFieldTypes);renderDefenseFieldTypes();$('#saveDefense')?.addEventListener('click',saveDefensePlay);
  $$('[data-steal-result]').forEach(b=>b.addEventListener('click',()=>{$$('[data-steal-result]').forEach(x=>x.classList.remove('active'));b.classList.add('active');}));$('#runFrom')?.addEventListener('change',syncRunTarget);$('#saveBaserunning')?.addEventListener('click',saveBaserunning);
  $$('[data-qty-delta]').forEach(b=>b.addEventListener('click',()=>changeQty(Number(b.dataset.qtyDelta))));$$('[data-qty-set]').forEach(b=>b.addEventListener('click',()=>setQty(Number(b.dataset.qtySet))));$('#trainingQty')?.addEventListener('input',e=>ui.quantity=Math.max(0,Number(e.target.value)||0));$$('[data-save-training]').forEach(b=>b.addEventListener('click',()=>saveTrainingSet(b.dataset.saveTraining)));
}
function renderDefenseFieldTypes(){const el=$('#defFieldType');if(!el)return;const position=$('#defPosition')?.value||'SS',group=['LF','CF','RF'].includes(position)?'OF':'IF';const vals=group==='IF'?[['FRONT','정면'],['FOREHAND','포핸드'],['BACKHAND','백핸드'],['CHARGE','전진']]:[['FORWARD','앞으로'],['STRAIGHT','정면'],['LATERAL','좌우'],['BACK','뒤로']];el.innerHTML='<button type="button" data-def-field-type="" class="active">미입력</button>'+vals.map(([v,l])=>`<button type="button" data-def-field-type="${v}">${l}</button>`).join('');$$('[data-def-field-type]').forEach(b=>b.addEventListener('click',()=>{$$('[data-def-field-type]').forEach(x=>x.classList.remove('active'));b.classList.add('active');}));}
function changeQty(delta){setQty(Math.max(0,(Number($('#trainingQty')?.value)||0)+delta));}function setQty(v){ui.quantity=v;if($('#trainingQty'))$('#trainingQty').value=v;}
function syncRunTarget(){const v=$('#runFrom')?.value;if(!v)return;$('#runTo').value=v==='1B'?'2B':v==='2B'?'3B':'HOME';}

async function setCurrentSide(kind,value){
  if(ui.inputMode!=='game')return;
  if(ui.domain==='pitching'){
    let bf=inputBF();
    if(kind==='batter')ui.pendingBatterSide=value;if(kind==='pitcher')ui.pendingOwnPitchSide=value;
    if(bf){if(kind==='batter')bf.batterSide=value;if(kind==='pitcher')bf.pitcherSide=value;await save('batterFaced',bf,{render:false});}
  } else if(ui.domain==='hitting'){
    let pa=inputPA();
    if(kind==='bat')ui.pendingBatSide=value;if(kind==='oppPitcher')ui.pendingOppPitcherSide=value;
    if(pa){if(kind==='bat')pa.batterSide=value;if(kind==='oppPitcher')pa.pitcherSide=value;await save('plateAppearances',pa,{render:false});}
  }
  renderInput();
}
async function ensureBF(){
  let bf=inputBF();if(bf)return bf;const gd=await ensureGameDay();const a=athlete();bf={id:uuid(),athleteId:activeAthleteId,gameDayId:gd.id,sequenceNo:nextSequence('batterFaced',ui.inputDate),pitcherSide:ui.pendingOwnPitchSide||(a?.throws==='S'?null:a?.throws),batterSide:ui.pendingBatterSide||null,result:null,completed:false,activityDate:ui.inputDate,recordedAt:iso(),ownerId:cloud.session?.user?.id||null,deletedAt:null};await save('batterFaced',bf,{render:false});ui.pendingBatterSide=null;return bf;
}async function ensurePA(){
  let pa=inputPA();if(pa)return pa;const gd=await ensureGameDay();const a=athlete(),prev=lastParent('pa');pa={id:uuid(),athleteId:activeAthleteId,gameDayId:gd.id,sequenceNo:nextSequence('plateAppearances',ui.inputDate),batterSide:ui.pendingBatSide||(a?.bats==='S'?null:a?.bats),pitcherSide:ui.pendingOppPitcherSide??prev?.pitcherSide??null,result:null,completed:false,activityDate:ui.inputDate,recordedAt:iso(),ownerId:cloud.session?.user?.id||null,deletedAt:null};await save('plateAppearances',pa,{render:false});ui.pendingBatSide=null;return pa;
}async function recordPitch(type){
  if(type==='inplay'){ui.inPlayContext='pitching';$('#inPlayTitle').textContent='투구 · 타구 결과';$('#inPlayBallType').value='';$('#inPlayDirection').value='';showModal('inPlayModal');return;}
  const bf=await ensureBF(),gd=await ensureGameDay();const e={id:uuid(),athleteId:activeAthleteId,gameDayId:gd.id,domain:'pitching',parentType:'batter_faced',parentId:bf.id,eventType:type,activityDate:ui.inputDate,recordedAt:iso(),metadata:{tlu:1},ownerId:cloud.session?.user?.id||null,deletedAt:null};await save('gameEvents',e,{render:false});await maybeCompleteBF(bf);renderAll();
}
async function maybeCompleteBF(bf,forcedResult=null){const ev=bfEvents(bf.id),c=countBS(ev,'pitching');let result=forcedResult;if(!result){if(ev.at(-1)?.eventType==='hbp')result='HBP';else if(c.b>=4)result='BB';else if(c.s>=3)result='K';}if(result){bf.result=result;bf.completed=true;await save('batterFaced',bf,{render:false});if(resumeContext?.kind==='bf'&&resumeContext.id===bf.id)resumeContext=null;showToast('타자 종료',`${ev.length}구 · ${result}`,'complete');}return !!result;}
async function recordGameThrow(type){const gd=await ensureGameDay(),a=athlete(),bf=inputBF();const throwSide=bf?.pitcherSide||ui.pendingOwnPitchSide||(a?.throws==='S'?null:a?.throws)||null;const e={id:uuid(),athleteId:activeAthleteId,gameDayId:gd.id,domain:'pitching',parentType:null,parentId:null,eventType:type,activityDate:ui.inputDate,recordedAt:iso(),metadata:{tlu:GAME_TLU[type],throwSide},ownerId:cloud.session?.user?.id||null,deletedAt:null};await save('gameEvents',e);}
async function recordBatPitch(type){
  if(type==='in_play'){ui.inPlayContext='batting';$('#inPlayTitle').textContent='타격 · 타구 결과';$('#inPlayBallType').value='';$('#inPlayDirection').value='';showModal('inPlayModal');return;}
  const pa=await ensurePA(),gd=await ensureGameDay();const e={id:uuid(),athleteId:activeAthleteId,gameDayId:gd.id,domain:'hitting',parentType:'plate_appearance',parentId:pa.id,eventType:type,activityDate:ui.inputDate,recordedAt:iso(),metadata:{},ownerId:cloud.session?.user?.id||null,deletedAt:null};await save('gameEvents',e,{render:false});await maybeCompletePA(pa);renderAll();
}
async function maybeCompletePA(pa,forcedResult=null){const ev=paEvents(pa.id),c=countBS(ev,'batting');let result=forcedResult;if(!result){if(ev.at(-1)?.eventType==='hbp')result='HBP';else if(c.b>=4)result='BB';else if(c.s>=3)result='SO';}if(result){pa.result=result;pa.completed=true;await save('plateAppearances',pa,{render:false});if(resumeContext?.kind==='pa'&&resumeContext.id===pa.id)resumeContext=null;showToast('타석 종료',`${ev.length}구 · ${result}`,'complete');}return !!result;}
async function completeInPlay(result){hideModal('inPlayModal');const bt=$('#inPlayBallType').value,dir=$('#inPlayDirection').value;if(ui.inPlayContext==='pitching'){const bf=await ensureBF(),gd=await ensureGameDay();const e={id:uuid(),athleteId:activeAthleteId,gameDayId:gd.id,domain:'pitching',parentType:'batter_faced',parentId:bf.id,eventType:'inplay',activityDate:ui.inputDate,recordedAt:iso(),metadata:{result,battedBall:bt||null,direction:dir||null,tlu:1},ownerId:cloud.session?.user?.id||null,deletedAt:null};await save('gameEvents',e,{render:false});await maybeCompleteBF(bf,result);}else{const pa=await ensurePA(),gd=await ensureGameDay();const e={id:uuid(),athleteId:activeAthleteId,gameDayId:gd.id,domain:'hitting',parentType:'plate_appearance',parentId:pa.id,eventType:'in_play',activityDate:ui.inputDate,recordedAt:iso(),metadata:{result,battedBall:bt||null,direction:dir||null},ownerId:cloud.session?.user?.id||null,deletedAt:null};await save('gameEvents',e,{render:false});await maybeCompletePA(pa,result);}ui.inPlayContext=null;renderAll();}

async function saveDefensePlay(){const gd=await ensureGameDay(),a=athlete(),fieldType=$('[data-def-field-type].active')?.dataset.defFieldType||null,throwResult=$('#defThrowResult').value,hasThrow=['success','error'].includes(throwResult),throwTLU=hasThrow?Number($('#defThrowTLU').value)||0:0,throwSide=a?.throws==='S'?null:(a?.throws||null);const e={id:uuid(),athleteId:activeAthleteId,gameDayId:gd.id,domain:'defense',parentType:null,parentId:null,eventType:'fielding_play',activityDate:ui.inputDate,recordedAt:iso(),metadata:{position:$('#defPosition').value,battedBall:$('#defBall').value,fieldingResult:$('#defFieldResult').value,fieldingType:fieldType,throwResult,throwTarget:hasThrow?($('#defThrowTarget').value||null):null,throwTLU,throwSide},ownerId:cloud.session?.user?.id||null,deletedAt:null};await save('gameEvents',e);showToast('수비 기록 저장',hasThrow?`플레이 1건 · +${n2(throwTLU)} TLU`:'플레이 1건');}
async function saveBaserunning(){const gd=await ensureGameDay(),from=$('#runFrom').value,to=$('#runTo').value,result=$('[data-steal-result].active')?.dataset.stealResult||'SUCCESS';if(from===to){showToast('베이스를 확인하세요','출발과 목표가 같습니다.');return;}const e={id:uuid(),athleteId:activeAthleteId,gameDayId:gd.id,domain:'baserunning',parentType:null,parentId:null,eventType:'steal_attempt',activityDate:ui.inputDate,recordedAt:iso(),metadata:{from,to,result},ownerId:cloud.session?.user?.id||null,deletedAt:null};await save('gameEvents',e);showToast('도루 기록',`${from}→${to} · ${result==='SUCCESS'?'성공':'실패'}`);}

async function saveTrainingSet(domain){const q=Math.max(0,Number($('#trainingQty')?.value)||0);if(!q){showToast('횟수를 입력하세요');return;}let rec={id:uuid(),athleteId:activeAthleteId,activityDate:ui.inputDate,domain,trainingType:'OTHER',side:null,quantity:q,unit:'reps',tluPerRep:0,tluTotal:0,metadata:{},recordedAt:iso(),ownerId:cloud.session?.user?.id||null,deletedAt:null};
  if(domain==='pitching'){const intensity=$('#trPitchIntensity').value,weights={light:.75,medium:.85,max:1};rec.trainingType='throwing';rec.side=$('#trPitchSide').value;rec.unit='throws';rec.metadata.intensity=intensity;rec.tluPerRep=weights[intensity];rec.tluTotal=round2(q*rec.tluPerRep);}
  else if(domain==='hitting'){rec.trainingType=$('#trHitType').value;rec.side=$('#trHitSide').value;rec.unit='swings';rec.metadata.velocity=Number($('#trHitVelocity').value)||null;}
  else if(domain==='defense'){rec.trainingType=$('#trDefType').value;rec.unit='reps';const throwCount=Math.max(0,Number($('#trDefThrowCount').value)||0),intensity=Number($('#trDefThrowIntensity').value)||0;rec.metadata={area:$('#trDefArea').value,throwCount,throwIntensity:intensity};rec.tluPerRep=0;rec.tluTotal=round2(throwCount*intensity);}
  else {rec.trainingType=$('#trRunType').value;rec.unit='reps';rec.metadata={distanceM:Number($('#trRunDistance').value)||null,bestTime:Number($('#trRunBest').value)||null};}
  await save('trainingSets',rec);showToast('훈련 세트 저장',trainingSetSub(rec));setQty(q);}

function openAthleteModal(id=null){const a=id?data.athletes.find(x=>x.id===id):null;$('#athleteModalTitle').textContent=a?'선수 수정':'선수 추가';$('#athleteId').value=a?.id||'';$('#athleteName').value=a?.name||'';$('#athleteNumber').value=a?.number||'';$('#athleteBirthDate').value=a?.birthDate||'';$('#athleteTeam').value=a?.team||'';$('#athletePosition').value=a?.position||'';$('#athleteThrows').value=a?.throws||'R';$('#athleteBats').value=a?.bats||'R';$('#deleteAthleteBtn').style.visibility=a?'visible':'hidden';showModal('athleteModal');}
async function saveAthleteForm(e){e.preventDefault();const id=$('#athleteId').value||uuid(),old=data.athletes.find(x=>x.id===id);const rec={...(old||{}),id,name:$('#athleteName').value.trim()||'선수',number:$('#athleteNumber').value.trim(),birthDate:$('#athleteBirthDate').value,team:$('#athleteTeam').value.trim(),position:$('#athletePosition').value.trim(),throws:$('#athleteThrows').value,bats:$('#athleteBats').value,ownerId:old?.ownerId||cloud.session?.user?.id||null,deletedAt:null};await save('athletes',rec,{render:false});if(!activeAthleteId){activeAthleteId=id;await setMeta('activeAthleteId',id);}hideModal('athleteModal');renderAll();}
async function deleteAthleteFromModal(){const id=$('#athleteId').value;if(!id)return;const activeA=active(data.athletes);if(activeA.length<=1){showToast('선수는 최소 1명 필요합니다');return;}if(!confirm('이 선수를 삭제할까요? 기록은 복구를 위해 soft-delete 됩니다.'))return;const a=data.athletes.find(x=>x.id===id);a.deletedAt=iso();await save('athletes',a,{render:false});if(activeAthleteId===id){activeAthleteId=active(data.athletes).find(x=>x.id!==id)?.id;await setMeta('activeAthleteId',activeAthleteId);}hideModal('athleteModal');renderAll();}
async function pickAthlete(id){activeAthleteId=id;await setMeta('activeAthleteId',id);hideModal('athletePicker');renderAll();}

function rawParentEvents(parentType,parentId){
  return active(data.gameEvents).filter(e=>e.parentType===parentType&&e.parentId===parentId).sort((a,b)=>new Date(a.recordedAt)-new Date(b.recordedAt));
}
async function recomputeParent(parentType,parentId){
  if(parentType==='batter_faced'){
    const bf=data.batterFaced.find(x=>x.id===parentId);if(!bf)return null;const was=!!bf.completed,wasUnknown=isUnknownParent(bf);
    const ev=rawParentEvents(parentType,parentId),c=countBS(ev,'pitching');let result=null,last=ev.at(-1);if(last?.eventType==='hbp')result='HBP';else if(last?.eventType==='inplay')result=last.metadata?.result||'IN_PLAY';else if(c.b>=4)result='BB';else if(c.s>=3)result='K';
    const nextResult=result||(wasUnknown&&ev.length?UNKNOWN_RESULT:null),nextCompleted=!!result,changed=bf.result!==nextResult||!!bf.completed!==nextCompleted;
    bf.result=nextResult;bf.completed=nextCompleted;if(changed)await save('batterFaced',bf,{render:false,sync:false});return {parent:bf,wasCompleted:was,completed:bf.completed,changed};
  }
  if(parentType==='plate_appearance'){
    const pa=data.plateAppearances.find(x=>x.id===parentId);if(!pa)return null;const was=!!pa.completed,wasUnknown=isUnknownParent(pa);
    const ev=rawParentEvents(parentType,parentId),c=countBS(ev,'batting');let result=null,last=ev.at(-1);if(last?.eventType==='hbp')result='HBP';else if(last?.eventType==='in_play')result=last.metadata?.result||'IN_PLAY';else if(c.b>=4)result='BB';else if(c.s>=3)result='SO';
    const nextResult=result||(wasUnknown&&ev.length?UNKNOWN_RESULT:null),nextCompleted=!!result,changed=pa.result!==nextResult||!!pa.completed!==nextCompleted;
    pa.result=nextResult;pa.completed=nextCompleted;if(changed)await save('plateAppearances',pa,{render:false,sync:false});return {parent:pa,wasCompleted:was,completed:pa.completed,changed};
  }
  return null;
}
async function closeParentUnknown(kind,id){
  const store=parentStore(kind),p=recordsFor(store).find(x=>x.id===id);if(!p||p.completed)return;
  p.result=UNKNOWN_RESULT;p.completed=false;await save(store,p,{render:false});
  if(resumeContext?.kind===kind&&resumeContext.id===id)resumeContext=null;
  (kind==='bf'?expandedBF:expandedPA).delete(id);
  renderAll();showToast(`${parentTypeName(kind)} #${p.sequenceNo} 결과 미상`,'현재까지 입력한 기록을 보존하고 다음으로 넘어갑니다.');
}
async function resumeParentInput(kind,id){
  const store=parentStore(kind),p=recordsFor(store).find(x=>x.id===id);if(!p||p.completed)return;
  if(isUnknownParent(p)){p.result=null;await save(store,p,{render:false});}
  resumeContext={kind,id};ui.inputDate=p.activityDate;ui.inputMode='game';ui.domain=kind==='bf'?'pitching':'hitting';(kind==='bf'?expandedBF:expandedPA).add(id);setView('input');renderInput();showToast(`${parentTypeName(kind)} #${p.sequenceNo} 수정 중`,'남은 공을 이어서 입력하세요.');
}

function pitchEditOptions(kind){return kind==='bf'?[['ball','BALL'],['called','루킹'],['swinging','헛스윙'],['foul','파울'],['inplay','IN PLAY'],['hbp','HBP']]:[['taken_ball','볼 지켜봄'],['taken_strike','스트라이크 지켜봄'],['swinging_strike','헛스윙'],['foul','파울'],['in_play','IN PLAY'],['hbp','HBP']];}
function openPitchEdit(id){const e=recordsFor('gameEvents').find(x=>x.id===id);if(!e||!e.parentId)return;pitchEditId=id;pitchEditType=e.eventType;pitchEditResult=e.metadata?.result||'OUT';const kind=e.parentType==='batter_faced'?'bf':'pa',p=recordsFor(parentStore(kind)).find(x=>x.id===e.parentId),events=parentEvents(kind,e.parentId),idx=events.findIndex(x=>x.id===id);$('#pitchEditTitle').textContent=`${parentTypeName(kind)} #${p?.sequenceNo||''} · ${idx+1}구 수정`;$('#pitchEditId').value=id;$('#pitchEditKind').value=kind;$('#pitchEditTypeButtons').innerHTML=pitchEditOptions(kind).map(([v,l])=>`<button type="button" data-pitch-edit-type="${v}">${l}</button>`).join('');$('#pitchEditResultButtons').innerHTML=['OUT','1B','2B','3B','HR','ROE','SH','SF'].map(v=>`<button type="button" data-pitch-edit-result="${v}">${v}</button>`).join('');$('#pitchEditBallType').value=e.metadata?.battedBall||'';$('#pitchEditDirection').value=e.metadata?.direction||'';$('#pitchEditPitchType').value=e.metadata?.pitchType||'';$('#pitchEditVelocity').value=e.metadata?.velocity||'';$('#pitchEditZone').value=e.metadata?.zone||'';$('#pitchEditNote').value=e.metadata?.note||'';renderPitchEditSelections();showModal('pitchEditModal');}
function renderPitchEditSelections(){const kind=$('#pitchEditKind')?.value||'bf';$$('#pitchEditTypeButtons [data-pitch-edit-type]').forEach(b=>{b.classList.toggle('selected',b.dataset.pitchEditType===pitchEditType);const tone=pitchTone(kind,{eventType:b.dataset.pitchEditType});b.classList.remove('ball','strike','inplay','hbp');if(tone)b.classList.add(tone);});const isInPlay=pitchEditType===(kind==='bf'?'inplay':'in_play');$('#pitchEditInPlayFields').hidden=!isInPlay;$$('#pitchEditResultButtons [data-pitch-edit-result]').forEach(b=>b.classList.toggle('selected',b.dataset.pitchEditResult===pitchEditResult));}
function completionIndexAfterEdit(kind,events,editedId,newType){let b=0,s=0;for(let i=0;i<events.length;i++){const t=events[i].id===editedId?newType:events[i].eventType;if(kind==='bf'){if(t==='ball')b++;else if(['called','swinging','foul','inplay'].includes(t)){if(!(t==='foul'&&s>=2))s++;}if(t==='hbp'||t==='inplay'||b>=4||s>=3)return i;}else{if(t==='taken_ball')b++;else if(['taken_strike','swinging_strike','foul','in_play'].includes(t)){if(!(t==='foul'&&s>=2))s++;}if(t==='hbp'||t==='in_play'||b>=4||s>=3)return i;}}return -1;}
async function savePitchEdit(ev){ev.preventDefault();const e=recordsFor('gameEvents').find(x=>x.id===pitchEditId);if(!e)return;const kind=$('#pitchEditKind').value;const events=parentEvents(kind,e.parentId),terminalIndex=completionIndexAfterEdit(kind,events,e.id,pitchEditType);if(terminalIndex>=0&&terminalIndex<events.length-1){showToast('수정할 수 없습니다','이 공에서 타자/타석이 끝나면 뒤의 투구 기록과 충돌합니다. 뒤 기록을 먼저 수정하거나 삭제하세요.');return;}e.eventType=pitchEditType;e.metadata=e.metadata||{};if(e.domain==='pitching')e.metadata.tlu=1;const isInPlay=pitchEditType===(kind==='bf'?'inplay':'in_play');if(isInPlay){e.metadata.result=pitchEditResult||'OUT';e.metadata.battedBall=$('#pitchEditBallType').value||null;e.metadata.direction=$('#pitchEditDirection').value||null;}else{e.metadata.result=null;e.metadata.battedBall=null;e.metadata.direction=null;}e.metadata.pitchType=$('#pitchEditPitchType').value.trim()||null;e.metadata.velocity=Number($('#pitchEditVelocity').value)||null;e.metadata.zone=$('#pitchEditZone').value.trim()||null;e.metadata.note=$('#pitchEditNote').value.trim()||null;await save('gameEvents',e,{render:false});const state=await recomputeParent(e.parentType,e.parentId);hideModal('pitchEditModal');renderAll();const p=state?.parent;showToast(`${parentTypeName(kind)} #${p?.sequenceNo||''} 수정됨`,p?.completed?`${parentEvents(kind,p.id).length}구 · ${p.result}`:'미완료 상태로 재계산되었습니다.');}
async function deletePitchFromEdit(){const id=pitchEditId;if(!id)return;hideModal('pitchEditModal');await softDeleteRecord('gameEvents',id);}
function pushUndo(items,message='기록을 삭제했습니다.'){lastDeleted={items};$('#undoText').textContent=message;$('#undoBar').hidden=false;clearTimeout(undoTimer);undoTimer=setTimeout(()=>{$('#undoBar').hidden=true;lastDeleted=null;},5000);}
async function softDeleteRecord(store,id){
  const rec=data[store]?.find(x=>x.id===id);if(!rec||rec.deletedAt)return;const backup=JSON.parse(JSON.stringify(rec));rec.deletedAt=iso();await save(store,rec,{render:false});
  if(store==='gameEvents'&&rec.parentType&&rec.parentId)await recomputeParent(rec.parentType,rec.parentId);
  pushUndo([{store,record:backup}]);renderAll();
}
async function softDeleteParent(kind,id){
  const store=parentStore(kind),parent=data[store]?.find(x=>x.id===id);if(!parent||parent.deletedAt)return;
  const parentType=kind==='bf'?'batter_faced':'plate_appearance';
  const children=data.gameEvents.filter(x=>!x.deletedAt&&x.parentId===id&&x.parentType===parentType);
  const items=[{store,record:JSON.parse(JSON.stringify(parent))},...children.map(record=>({store:'gameEvents',record:JSON.parse(JSON.stringify(record))}))];
  const deletedAt=iso();parent.deletedAt=deletedAt;await save(store,parent,{render:false,sync:false});
  for(const child of children){child.deletedAt=deletedAt;await save('gameEvents',child,{render:false,sync:false});}
  if(resumeContext?.kind===kind&&resumeContext.id===id)resumeContext=null;
  (kind==='bf'?expandedBF:expandedPA).delete(id);scheduleSync();
  pushUndo(items,`${parentTypeName(kind)} #${parent.sequenceNo} 기록을 삭제했습니다.`);renderAll();
}
async function undoDelete(){
  if(!lastDeleted?.items?.length)return;const items=lastDeleted.items;
  for(const item of items){const rec=JSON.parse(JSON.stringify(item.record));rec.deletedAt=null;await save(item.store,rec,{render:false,sync:false});}
  if(items.length===1&&items[0].store==='gameEvents'){const rec=items[0].record;if(rec.parentType&&rec.parentId)await recomputeParent(rec.parentType,rec.parentId);}
  scheduleSync();lastDeleted=null;$('#undoBar').hidden=true;renderAll();showToast('삭제 취소','기록을 복원했습니다.');
}

function openRecordEdit(store,id){const rec=data[store]?.find(x=>x.id===id);if(!rec)return;$('#editRecordStore').value=store;$('#editRecordId').value=id;let html=`<label>활동 날짜<input name="activityDate" type="date" value="${rec.activityDate||todayKey()}" /></label>`;
  if(store==='batterFaced')html+=`<label>내 투구<select name="pitcherSide"><option value="">미입력</option><option value="R" ${rec.pitcherSide==='R'?'selected':''}>우투</option><option value="L" ${rec.pitcherSide==='L'?'selected':''}>좌투</option></select></label><label>상대 타자<select name="batterSide"><option value="">미입력</option><option value="R" ${rec.batterSide==='R'?'selected':''}>우타</option><option value="L" ${rec.batterSide==='L'?'selected':''}>좌타</option></select></label><div class="derived-field"><span>결과</span><b>${esc(isUnknownParent(rec)?'결과 미상':(rec.result||'미완료'))}</b><small>투구 기록에서 자동 계산</small></div>`;
  else if(store==='plateAppearances')html+=`<label>내 타격<select name="batterSide"><option value="">미입력</option><option value="R" ${rec.batterSide==='R'?'selected':''}>우타</option><option value="L" ${rec.batterSide==='L'?'selected':''}>좌타</option></select></label><label>상대 투수<select name="pitcherSide"><option value="">미입력</option><option value="R" ${rec.pitcherSide==='R'?'selected':''}>우투</option><option value="L" ${rec.pitcherSide==='L'?'selected':''}>좌투</option></select></label><div class="derived-field"><span>결과</span><b>${esc(isUnknownParent(rec)?'결과 미상':(rec.result||'미완료'))}</b><small>투구 기록에서 자동 계산</small></div>`;
  else if(store==='trainingSets'){
    html+=`<label>횟수<input name="quantity" type="number" min="0" value="${rec.quantity}" /></label><label>훈련 종류<input name="trainingType" value="${esc(rec.trainingType)}" /></label>`;
    if(['pitching','hitting'].includes(rec.domain))html+=`<label>좌/우<select name="side"><option value="">미입력</option><option value="R" ${rec.side==='R'?'selected':''}>${rec.domain==='pitching'?'우투':'우타'}</option><option value="L" ${rec.side==='L'?'selected':''}>${rec.domain==='pitching'?'좌투':'좌타'}</option></select></label>`;
    if(rec.domain==='pitching')html+=`<label>TLU/회<input name="tluPerRep" type="number" min="0" step="0.05" value="${rec.tluPerRep||0}" /></label>`;
    if(rec.domain==='hitting')html+=`<label>구속 km/h<input name="velocity" type="number" value="${rec.metadata?.velocity||''}" /></label>`;
    if(rec.domain==='defense')html+=`<label>실제 송구 횟수<input name="throwCount" type="number" min="0" value="${rec.metadata?.throwCount||0}" /></label><label>송구 TLU/회<select name="throwIntensity"><option value="0.75" ${Number(rec.metadata?.throwIntensity)===.75?'selected':''}>0.75</option><option value="0.85" ${Number(rec.metadata?.throwIntensity)===.85?'selected':''}>0.85</option><option value="1" ${Number(rec.metadata?.throwIntensity)===1?'selected':''}>1.00</option></select></label>`;
  }
  else if(store==='gameEvents'){html+=`<label>이벤트<input name="eventType" value="${esc(rec.eventType)}" /></label><label class="span-2">메모<input name="note" value="${esc(rec.metadata?.note||'')}" placeholder="영상 분석 메모" /></label>`;if(rec.domain==='pitching'||['hitting','batting'].includes(rec.domain))html+=`<label>타구 결과<input name="result" value="${esc(rec.metadata?.result||'')}" /></label><label>타구 형태<select name="battedBall"><option value="">미입력</option>${['GB','LD','FB'].map(v=>`<option ${rec.metadata?.battedBall===v?'selected':''}>${v}</option>`).join('')}</select></label><label>타구 방향<select name="direction"><option value="">미입력</option>${[['L','좌'],['C','중'],['R','우']].map(([v,l])=>`<option value="${v}" ${rec.metadata?.direction===v?'selected':''}>${l}</option>`).join('')}</select></label><label>구종 (선택)<input name="pitchType" value="${esc(rec.metadata?.pitchType||'')}" /></label><label>구속 km/h (선택)<input name="velocity" type="number" value="${rec.metadata?.velocity||''}" /></label><label>위치 (선택)<input name="zone" value="${esc(rec.metadata?.zone||'')}" /></label>`;if(rec.domain==='pitching'&&!rec.parentId)html+=`<label>투구 방향<select name="throwSide"><option value="">미입력</option><option value="R" ${rec.metadata?.throwSide==='R'?'selected':''}>우투</option><option value="L" ${rec.metadata?.throwSide==='L'?'selected':''}>좌투</option></select></label>`;if(rec.domain==='defense')html+=`<label>포지션<select name="position">${['SS','2B','3B','1B','C','P','LF','CF','RF'].map(v=>`<option ${rec.metadata?.position===v?'selected':''}>${v}</option>`).join('')}</select></label><label>포구 결과<select name="fieldingResult">${[['success','성공'],['unstable','불안정'],['failed','실패']].map(([v,l])=>`<option value="${v}" ${rec.metadata?.fieldingResult===v?'selected':''}>${l}</option>`).join('')}</select></label><label>포구 형태<select name="fieldingType"><option value="">미입력</option>${[['FRONT','정면'],['FOREHAND','포핸드'],['BACKHAND','백핸드'],['CHARGE','전진'],['FORWARD','앞으로'],['STRAIGHT','정면(외야)'],['LATERAL','좌우'],['BACK','뒤로']].map(([v,l])=>`<option value="${v}" ${rec.metadata?.fieldingType===v?'selected':''}>${l}</option>`).join('')}</select></label><label>송구<select name="throwResult">${[['none','없음'],['success','정상 송구'],['error','악송구']].map(([v,l])=>`<option value="${v}" ${rec.metadata?.throwResult===v?'selected':''}>${l}</option>`).join('')}</select></label><label>송구 목적지<select name="throwTarget"><option value="">미입력</option>${[['1B','1루'],['2B','2루'],['3B','3루'],['HOME','홈'],['RELAY','중계']].map(([v,l])=>`<option value="${v}" ${rec.metadata?.throwTarget===v?'selected':''}>${l}</option>`).join('')}</select></label><label>송구 부하<select name="throwTLU">${[['0.75','0.75'],['0.85','0.85'],['1','1.00']].map(([v,l])=>`<option value="${v}" ${Number(rec.metadata?.throwTLU)===Number(v)?'selected':''}>${l}</option>`).join('')}</select></label>`;}
  $('#recordEditFields').innerHTML=html;showModal('recordEditModal');
}
async function saveEditedRecord(e){e.preventDefault();const store=$('#editRecordStore').value,id=$('#editRecordId').value,rec=data[store].find(x=>x.id===id);if(!rec)return;const fd=new FormData(e.currentTarget),oldDate=rec.activityDate;rec.activityDate=fd.get('activityDate')||rec.activityDate;if(store==='batterFaced'){rec.pitcherSide=fd.get('pitcherSide')||null;rec.batterSide=fd.get('batterSide')||null;/* result is derived from child pitches */}else if(store==='plateAppearances'){rec.batterSide=fd.get('batterSide')||null;rec.pitcherSide=fd.get('pitcherSide')||null;/* result is derived from child pitches */}else if(store==='trainingSets'){rec.quantity=Math.max(0,Number(fd.get('quantity'))||0);rec.trainingType=fd.get('trainingType')||rec.trainingType;rec.metadata=rec.metadata||{};if(fd.has('side'))rec.side=fd.get('side')||null;if(rec.domain==='pitching'){rec.tluPerRep=Math.max(0,Number(fd.get('tluPerRep'))||0);rec.tluTotal=round2(rec.quantity*rec.tluPerRep);}else if(rec.domain==='hitting'){rec.metadata.velocity=Number(fd.get('velocity'))||null;rec.tluTotal=0;}else if(rec.domain==='defense'){rec.metadata.throwCount=Math.max(0,Number(fd.get('throwCount'))||0);rec.metadata.throwIntensity=Number(fd.get('throwIntensity'))||0;rec.tluTotal=round2(rec.metadata.throwCount*rec.metadata.throwIntensity);}else rec.tluTotal=0;}else{rec.eventType=fd.get('eventType')||rec.eventType;rec.metadata=rec.metadata||{};for(const k of ['note','result','battedBall','direction','pitchType','zone','throwSide','position','fieldingResult','fieldingType','throwResult','throwTarget']){const v=fd.get(k);if(v!==null)rec.metadata[k]=v||null;}const vel=fd.get('velocity');if(vel!==null)rec.metadata.velocity=vel?Number(vel):null;const throwTLU=fd.get('throwTLU');if(throwTLU!==null)rec.metadata.throwTLU=['success','error'].includes(rec.metadata.throwResult)?Number(throwTLU)||0:0;if(rec.metadata.throwResult==='none')rec.metadata.throwTarget=null;}
  if(oldDate!==rec.activityDate&&['gameEvents','batterFaced','plateAppearances'].includes(store)){const gd=await ensureGameDay(rec.activityDate);rec.gameDayId=gd.id;}
  await save(store,rec,{render:false});
  if(store==='gameEvents'&&rec.parentType&&rec.parentId){
    if(oldDate!==rec.activityDate){const parentStore=rec.parentType==='batter_faced'?'batterFaced':'plateAppearances',parent=data[parentStore].find(x=>x.id===rec.parentId);const gd=await ensureGameDay(rec.activityDate);if(parent){parent.activityDate=rec.activityDate;parent.gameDayId=gd.id;await save(parentStore,parent,{render:false});}for(const sibling of data.gameEvents.filter(x=>x.parentType===rec.parentType&&x.parentId===rec.parentId&&!x.deletedAt)){if(sibling.id!==rec.id){sibling.activityDate=rec.activityDate;sibling.gameDayId=gd.id;await save('gameEvents',sibling,{render:false});}}}
    await recomputeParent(rec.parentType,rec.parentId);
  }
  if(oldDate!==rec.activityDate&&['batterFaced','plateAppearances'].includes(store)){const gd=await ensureGameDay(rec.activityDate);for(const child of data.gameEvents.filter(x=>x.parentId===rec.id&&!x.deletedAt)){child.activityDate=rec.activityDate;child.gameDayId=gd.id;await save('gameEvents',child,{render:false});}}
  hideModal('recordEditModal');renderAll();showToast('기록 수정 완료');}

async function exportBackup(){const out=await snapshot();out.exportedAt=iso();out.version=6;const blob=new Blob([JSON.stringify(out,null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`야구일기-${todayKey()}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);}
async function importBackup(e){const f=e.target.files?.[0];if(!f)return;try{const raw=JSON.parse(await f.text());if(Number(raw.version||0)!==6&&!raw.athletes)throw new Error('V6 백업 형식이 아닙니다.');if(!confirm('현재 로컬 데이터를 백업 파일로 교체할까요?'))return;await replaceSnapshot(raw);await reloadData();logIntegrity('backup restore');renderAll();showToast('백업 복원 완료');}catch(err){console.error(err);showToast('백업 복원 실패',err.message||'파일을 확인하세요.');}finally{e.target.value='';}}

function cloudConfig(){const c=window.BASEBALL_SUPABASE_CONFIG||{},url=String(c.url||''),key=String(c.publishableKey||'');return {url,key,valid:url.startsWith('https://')&&!url.includes('YOUR-PROJECT')&&key.startsWith('sb_publishable_')};}
function ensureSupabaseSdk(){if(window.supabase?.createClient)return Promise.resolve(true);return new Promise(resolve=>{const s=document.createElement('script');s.src='https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';s.async=true;s.onload=()=>resolve(!!window.supabase?.createClient);s.onerror=()=>resolve(false);document.head.appendChild(s);setTimeout(()=>resolve(!!window.supabase?.createClient),8000);});}
async function initCloud(){const cfg=cloudConfig();if(!cfg.valid){cloud.configured=false;renderCloudUI();return;}const ok=await ensureSupabaseSdk();if(!ok){cloud.configured=false;renderCloudStatus('error','Supabase SDK 로드 실패');return;}cloud.configured=true;cloud.client=window.supabase.createClient(cfg.url,cfg.key,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});const {data:d}=await cloud.client.auth.getSession();cloud.session=d.session||null;cloud.client.auth.onAuthStateChange((event,session)=>{cloud.session=session||null;renderCloudUI();if(session&&['SIGNED_IN','INITIAL_SESSION','USER_UPDATED'].includes(event))scheduleSync(300);});renderCloudUI();if(cloud.session&&navigator.onLine)scheduleSync(300);}
function renderCloudStatus(forceStatus=null,forceText=null){const pill=$('#cloudPill'),badge=$('#cloudBadge');let status=forceStatus,text=forceText;if(!status){if(!cloud.configured){status='local';text='로컬';}else if(!cloud.session){status='local';text='로그인 필요';}else if(!navigator.onLine){status='offline';text='오프라인';}else if(cloud.syncing){status='syncing';text='동기화 중';}else{status='synced';text='동기화됨';}}pill.className=`cloud-pill ${status}`;pill.textContent=text;badge.className=`cloud-badge ${status}`;badge.textContent=text;}
function renderCloudUI(){const cfg=cloudConfig();$('#cloudNotConfigured').hidden=cfg.valid;$('#cloudLoggedOut').hidden=!cfg.valid||!!cloud.session;$('#cloudLoggedIn').hidden=!cloud.session;if(cloud.session)$('#cloudUserEmail').textContent=cloud.session.user.email||'로그인됨';$('#cloudStatusText').textContent=!cfg.valid?'Project URL을 설정하세요.':cloud.session?'여러 기기와 자동 동기화 중':'로그인하면 클라우드 동기화를 사용할 수 있습니다.';$('#cloudLastSync').textContent=cloud.lastSync?`마지막 동기화: ${new Date(cloud.lastSync).toLocaleString('ko-KR')}`:'';renderCloudStatus();}
async function signIn(){if(!cloud.client)return;const email=$('#authEmail').value.trim(),password=$('#authPassword').value;const {error}=await cloud.client.auth.signInWithPassword({email,password});if(error)showToast('로그인 실패',error.message);}
async function signUp(){if(!cloud.client)return;const email=$('#authEmail').value.trim(),password=$('#authPassword').value;const {error}=await cloud.client.auth.signUp({email,password});if(error)showToast('계정 생성 실패',error.message);else showToast('계정 생성 완료','이메일 확인 설정에 따라 즉시 로그인됩니다.');}
async function signOut(){if(cloud.client)await cloud.client.auth.signOut();cloud.session=null;renderCloudUI();}
function scheduleSync(delay=700){if(!cloud.configured||!cloud.session||!navigator.onLine)return;clearTimeout(syncTimer);syncTimer=setTimeout(()=>syncCloud(false),delay);}

const cloudDefs={
  athletes:{table:'athletes',to:r=>({id:r.id,owner_id:r.ownerId,name:r.name,number:r.number||null,birth_date:r.birthDate||null,team:r.team||null,position:r.position||null,throws:r.throws||'R',bats:r.bats||'R',client_updated_at:r.clientUpdatedAt||0,deleted_at:r.deletedAt||null}),from:r=>({id:r.id,ownerId:r.owner_id,name:r.name,number:r.number||'',birthDate:r.birth_date||'',team:r.team||'',position:r.position||'',throws:r.throws||'R',bats:r.bats||'R',clientUpdatedAt:Number(r.client_updated_at||0),updatedAt:r.updated_at,deletedAt:r.deleted_at,dirty:false})},
  gameDays:{table:'game_days_v6',to:r=>({id:r.id,owner_id:r.ownerId,athlete_id:r.athleteId,activity_date:r.activityDate,client_updated_at:r.clientUpdatedAt||0,deleted_at:r.deletedAt||null}),from:r=>({id:r.id,ownerId:r.owner_id,athleteId:r.athlete_id,activityDate:r.activity_date,clientUpdatedAt:Number(r.client_updated_at||0),updatedAt:r.updated_at,deletedAt:r.deleted_at,dirty:false})},
  batterFaced:{table:'batter_faced_v6',to:r=>({id:r.id,owner_id:r.ownerId,athlete_id:r.athleteId,game_day_id:r.gameDayId,activity_date:r.activityDate,sequence_no:r.sequenceNo,pitcher_side:r.pitcherSide||null,batter_side:r.batterSide||null,result:r.result||null,completed:!!r.completed,recorded_at:r.recordedAt||r.updatedAt||iso(),client_updated_at:r.clientUpdatedAt||0,deleted_at:r.deletedAt||null}),from:r=>({id:r.id,ownerId:r.owner_id,athleteId:r.athlete_id,gameDayId:r.game_day_id,activityDate:r.activity_date,sequenceNo:r.sequence_no,pitcherSide:r.pitcher_side,batterSide:r.batter_side,result:r.result,completed:r.completed,recordedAt:r.recorded_at,clientUpdatedAt:Number(r.client_updated_at||0),updatedAt:r.updated_at,deletedAt:r.deleted_at,dirty:false})},
  plateAppearances:{table:'plate_appearances_v6',to:r=>({id:r.id,owner_id:r.ownerId,athlete_id:r.athleteId,game_day_id:r.gameDayId,activity_date:r.activityDate,sequence_no:r.sequenceNo,batter_side:r.batterSide||null,pitcher_side:r.pitcherSide||null,result:r.result||null,completed:!!r.completed,recorded_at:r.recordedAt||r.updatedAt||iso(),client_updated_at:r.clientUpdatedAt||0,deleted_at:r.deletedAt||null}),from:r=>({id:r.id,ownerId:r.owner_id,athleteId:r.athlete_id,gameDayId:r.game_day_id,activityDate:r.activity_date,sequenceNo:r.sequence_no,batterSide:r.batter_side,pitcherSide:r.pitcher_side,result:r.result,completed:r.completed,recordedAt:r.recorded_at,clientUpdatedAt:Number(r.client_updated_at||0),updatedAt:r.updated_at,deletedAt:r.deleted_at,dirty:false})},
  gameEvents:{table:'game_events_v6',to:r=>({id:r.id,owner_id:r.ownerId,athlete_id:r.athleteId,game_day_id:r.gameDayId,activity_date:r.activityDate,domain:r.domain,parent_type:r.parentType||null,parent_id:r.parentId||null,event_type:r.eventType,recorded_at:r.recordedAt,metadata:r.metadata||{},client_updated_at:r.clientUpdatedAt||0,deleted_at:r.deletedAt||null}),from:r=>({id:r.id,ownerId:r.owner_id,athleteId:r.athlete_id,gameDayId:r.game_day_id,activityDate:r.activity_date,domain:r.domain,parentType:r.parent_type,parentId:r.parent_id,eventType:r.event_type,recordedAt:r.recorded_at,metadata:r.metadata||{},clientUpdatedAt:Number(r.client_updated_at||0),updatedAt:r.updated_at,deletedAt:r.deleted_at,dirty:false})},
  trainingSets:{table:'training_sets_v6',to:r=>({id:r.id,owner_id:r.ownerId,athlete_id:r.athleteId,activity_date:r.activityDate,domain:r.domain,training_type:r.trainingType,side:r.side||null,quantity:r.quantity,unit:r.unit,intensity:r.metadata?.intensity||null,tlu_per_rep:r.tluPerRep||0,tlu_total:r.tluTotal||0,metadata:r.metadata||{},recorded_at:r.recordedAt,client_updated_at:r.clientUpdatedAt||0,deleted_at:r.deletedAt||null}),from:r=>({id:r.id,ownerId:r.owner_id,athleteId:r.athlete_id,activityDate:r.activity_date,domain:r.domain,trainingType:r.training_type,side:r.side,quantity:Number(r.quantity||0),unit:r.unit,intensity:r.intensity,tluPerRep:Number(r.tlu_per_rep||0),tluTotal:Number(r.tlu_total||0),metadata:r.metadata||{},recordedAt:r.recorded_at,clientUpdatedAt:Number(r.client_updated_at||0),updatedAt:r.updated_at,deletedAt:r.deleted_at,dirty:false})}
};
async function syncCloud(manual=false){if(cloud.syncing||!cloud.client||!cloud.session||!navigator.onLine)return;cloud.syncing=true;renderCloudStatus();try{const uid=cloud.session.user.id;
  // On a fresh device, do not upload the auto-created placeholder if the account already has athletes.
  const remoteAth=await cloud.client.from('athletes').select('*').eq('owner_id',uid);if(remoteAth.error)throw remoteAth.error;
  const noActivity=storeNames.slice(1).every(s=>data[s].filter(x=>!x.deletedAt).length===0),localActive=active(data.athletes);
  if((remoteAth.data||[]).length&&noActivity&&localActive.length===1&&localActive[0].name==='선수 1'&&!localActive[0].ownerId){
    await deleteOne('athletes',localActive[0].id);data.athletes=(remoteAth.data||[]).map(cloudDefs.athletes.from);await putMany('athletes',data.athletes);activeAthleteId=data.athletes.find(x=>!x.deletedAt)?.id||null;await setMeta('activeAthleteId',activeAthleteId);
  }
  // Claim local records for the current account.
  for(const store of storeNames){for(const rec of data[store].filter(x=>!x.ownerId)){rec.ownerId=uid;rec.dirty=true;rec.clientUpdatedAt=Date.now();await putOne(store,rec);}}
  // Upload in FK order.
  for(const store of storeNames){const def=cloudDefs[store],dirty=data[store].filter(x=>x.ownerId===uid&&x.dirty);if(!dirty.length)continue;for(let i=0;i<dirty.length;i+=100){const chunk=dirty.slice(i,i+100),{error}=await cloud.client.from(def.table).upsert(chunk.map(def.to),{onConflict:'id'});if(error)throw error;for(const rec of chunk){rec.dirty=false;await putOne(store,rec);}}}
  // Pull and merge by client timestamp.
  for(const store of storeNames){const def=cloudDefs[store],{data:rows,error}=await cloud.client.from(def.table).select('*').eq('owner_id',uid);if(error)throw error;const localMap=new Map(data[store].map(x=>[x.id,x]));for(const row of rows||[]){const remote=def.from(row),local=localMap.get(remote.id);if(!local||Number(remote.clientUpdatedAt)>=Number(local.clientUpdatedAt||0)){await putOne(store,remote);localMap.set(remote.id,remote);}}data[store]=[...localMap.values()];}
  cloud.lastSync=Date.now();localStorage.setItem('btV6LastSync',cloud.lastSync);logIntegrity('cloud sync');renderAll();renderCloudUI();if(manual)showToast('동기화 완료','클라우드와 기록을 맞췄습니다.');
 }catch(err){console.error(err);renderCloudStatus('error','동기화 실패');$('#cloudStatusText').textContent=`동기화 실패: ${err.message||err}`;if(manual)showToast('동기화 실패',err.message||'Supabase 설정을 확인하세요.');}finally{cloud.syncing=false;renderCloudStatus();}}

function registerPWA(){if('serviceWorker'in navigator)window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(console.error));window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferredInstallPrompt=e;$('#installMini').style.display='inline-block';});}
async function promptInstall(){if(deferredInstallPrompt){deferredInstallPrompt.prompt();await deferredInstallPrompt.userChoice;deferredInstallPrompt=null;return;}showToast('홈 화면에 추가','브라우저 메뉴의 앱 설치/홈 화면에 추가를 사용하세요.');}

init().catch(err=>{
  console.error('App init failed',err);
  window.__BT_BOOT_ERROR__=err;
  const box=$('#bootError');if(box){box.hidden=false;const span=box.querySelector('span');if(span)span.textContent=`초기화 오류: ${err.message||err}`;}
  try{renderCloudStatus('error','초기화 실패');}catch{}
});
