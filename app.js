(() => {
'use strict';

const STORAGE_KEY = 'baseballTrackerV1';
const LAST_SYNC_KEY = 'baseballTrackerCloudLastSyncV5';
const WEIGHTS = { light:0.75, moderate:0.85, full:1.0 };
const STRIKE_RESULTS = new Set(['called','swinging','foul','inplay']);
const PITCH_RESULTS = ['ball','called','swinging','foul','inplay','hbp'];
const HIT_RESULTS = ['1B','2B','3B','HR','BB','HBP','SO','OUT','ROE','SF'];
const EVENT_LABELS = {
  ball:'BALL', called:'루킹 스트라이크', swinging:'헛스윙', foul:'파울', inplay:'인플레이', hbp:'사구 HBP',
  '1B':'안타 1B','2B':'2루타','3B':'3루타',HR:'홈런',BB:'볼넷',HBP:'사구',SO:'삼진',OUT:'범타',ROE:'실책 출루',SF:'희생플라이',
  SB:'도루 성공',CS:'도루 실패',SUCCESS:'수비 성공',ERROR:'실책',POSITION_CHANGE:'포지션 변경',MISS:'실수',
  WP:'폭투 WP',PB:'포일 PB',UNCUGHT3:'낫아웃',BALK:'보크',IBB:'무투구 고의4구',PICKOFF:'견제사',IR_SCORED:'승계주자 득점',NEXT_BATTER:'다음 타자',
  light:'가벼운 투구',moderate:'적정 투구',full:'전력 투구',whiff:'헛스윙',weak:'약한 타구',medium:'보통 타구',hard:'강한 타구'
};

let state = loadState();
let currentView = 'home';
let currentTab = 'pitching';
let recordDate = localDateKey();
let sessionType = null;
let toastTimer = null;
let undoDeleteTimer = null;
let lastDeletedEventId = null;
let deferredInstallPrompt = null;

const cloud = {
  client:null, session:null, configured:false, syncing:false, status:'local', message:'로컬 저장',
  lastSync:Number(localStorage.getItem(LAST_SYNC_KEY)||0), timer:null, authInitialized:false
};

function uuid(){
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,c=>{const r=Math.random()*16|0,v=c==='x'?r:(r&3|8);return v.toString(16);});
}
function now(){ return Date.now(); }
function iso(ts=Date.now()){ return new Date(ts).toISOString(); }
function localDateKey(d=new Date()){
  const y=d.getFullYear(),m=String(d.getMonth()+1).padStart(2,'0'),day=String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${day}`;
}
function dateFromIso(value){ return localDateKey(new Date(value)); }
function dateShift(offset){ const d=new Date(); d.setHours(12,0,0,0); d.setDate(d.getDate()+offset); return localDateKey(d); }
function fmtLongDate(key){ if(!key) return ''; const [y,m,d]=key.split('-').map(Number); return `${y}.${String(m).padStart(2,'0')}.${String(d).padStart(2,'0')}`; }
function fmtShortDate(key){ if(!key) return ''; const [,m,d]=key.split('-'); return `${Number(m)}/${Number(d)}`; }
function timeText(value){ return new Date(value).toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit'}); }
function pct(v,d=1){ return v===null||v===undefined||Number.isNaN(v)?'—':`${(v*100).toFixed(d)}%`; }
function decimal(v){ return v===null||v===undefined||Number.isNaN(v)?'—':v.toFixed(3).replace(/^0/,''); }
function one(v){ const x=Math.round(Number(v||0)*10)/10; return Number.isInteger(x)?String(x):x.toFixed(1); }
function esc(v){ return String(v??'').replace(/[&<>'"]/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch])); }
function deepCopy(v){ return JSON.parse(JSON.stringify(v)); }
function mark(obj){ obj._updatedAt=now(); obj._dirty=true; return obj; }
function activeNotDeleted(list){ return list.filter(x=>!x.deletedAt); }
function byTime(a,b){ return new Date(a.occurredAt)-new Date(b.occurredAt) || Number(a.metadata?._seq||0)-Number(b.metadata?._seq||0) || String(a.id).localeCompare(String(b.id)); }

function makeAthlete(name='선수 1'){
  return mark({id:uuid(),name,number:'',birthDate:'',team:'',position:'',throws:'R',bats:'R',deletedAt:null});
}
function initialState(){
  const a=makeAthlete('선수 1');
  return {version:5,athletes:[a],activeAthleteId:a.id,games:[],trainingSessions:[],appearances:[],events:[],eventSeq:0,activeSession:{type:null,id:null},cloudOwnerId:null};
}
function normalizeEntity(x){
  x._updatedAt=Number(x._updatedAt||0); x._dirty=!!x._dirty; x.deletedAt=x.deletedAt||null; return x;
}
function normalizeV5(raw){
  raw.version=5; raw.athletes=Array.isArray(raw.athletes)?raw.athletes.map(normalizeEntity):[];
  raw.games=Array.isArray(raw.games)?raw.games.map(normalizeEntity):[];
  raw.trainingSessions=Array.isArray(raw.trainingSessions)?raw.trainingSessions.map(normalizeEntity):[];
  raw.appearances=Array.isArray(raw.appearances)?raw.appearances.map(normalizeEntity):[];
  raw.events=Array.isArray(raw.events)?raw.events.map(normalizeEntity):[];
  raw.eventSeq=Number(raw.eventSeq||0);
  for(const e of [...raw.events].sort((a,b)=>new Date(a.occurredAt)-new Date(b.occurredAt))){e.metadata=e.metadata||{};if(!Number(e.metadata._seq)){raw.eventSeq++;e.metadata._seq=raw.eventSeq;}else raw.eventSeq=Math.max(raw.eventSeq,Number(e.metadata._seq));}
  raw.activeSession=raw.activeSession||{type:null,id:null};
  if(!raw.athletes.some(a=>!a.deletedAt)){ const a=makeAthlete('선수 1'); raw.athletes.push(a); raw.activeAthleteId=a.id; }
  if(!raw.athletes.some(a=>a.id===raw.activeAthleteId&&!a.deletedAt)) raw.activeAthleteId=raw.athletes.find(a=>!a.deletedAt)?.id||null;
  return raw;
}

function migrateV4Local(raw){
  const out={version:5,athletes:[],activeAthleteId:null,games:[],trainingSessions:[],appearances:[],events:[],eventSeq:0,activeSession:{type:null,id:null},cloudOwnerId:raw?.cloudOwnerId||null};
  const athletes=Array.isArray(raw?.athletes)&&raw.athletes.length?raw.athletes:[makeAthlete('선수 1')];
  for(const old of athletes){
    out.athletes.push(mark({id:old.id||uuid(),name:old.name||'선수',number:old.number||'',birthDate:old.birthDate||'',team:old.team||'',position:old.position||'',throws:old.throws||'R',bats:old.bats||'R',deletedAt:null}));
  }
  out.activeAthleteId=out.athletes.some(a=>a.id===raw.activeAthleteId)?raw.activeAthleteId:out.athletes[0].id;
  const allDays=raw?.athleteDays || (raw?.days?{[out.activeAthleteId]:raw.days}:{});
  for(const athlete of out.athletes){
    const days=allDays[athlete.id]||{};
    for(const [dayKey,day] of Object.entries(days)) migrateV4Day(out,athlete.id,dayKey,day||{});
  }
  return out;
}
function migrateV4Day(out,athleteId,dayKey,day){
  const tr=day.trainingThrows||[], sw=day.trainingSwings||[];
  if(tr.length||sw.length){
    const s=mark({id:uuid(),athleteId,date:dayKey,title:'V4 가져오기',status:'completed',startedAt:`${dayKey}T09:00:00`,endedAt:`${dayKey}T20:00:00`,legacySource:`v4:${athleteId}:${dayKey}:training`,deletedAt:null});
    out.trainingSessions.push(s);
    tr.forEach((x,i)=>out.events.push(mark({id:uuid(),athleteId,gameId:null,trainingSessionId:s.id,appearanceId:null,category:'training_throw',eventType:x.intensity||'light',occurredAt:iso(Number(x.ts)||Date.parse(`${dayKey}T09:00:00`)+i),metadata:{intensity:x.intensity||'light',context:x.context||'other',legacy:true},legacySource:`v4:${athleteId}:${dayKey}:training_throw:${i+1}`,deletedAt:null})));
    sw.forEach((x,i)=>out.events.push(mark({id:uuid(),athleteId,gameId:null,trainingSessionId:s.id,appearanceId:null,category:'training_hit',eventType:x.quality||'medium',occurredAt:iso(Number(x.ts)||Date.parse(`${dayKey}T11:00:00`)+i),metadata:{quality:x.quality||'medium',type:x.type||'other',legacy:true},legacySource:`v4:${athleteId}:${dayKey}:training_hit:${i+1}`,deletedAt:null})));
  }
  const gp=day.gamePitching||{}; const pitches=gp.pitches||[], ge=gp.events||[], hits=day.gameHitting||[], bases=day.baserunning||[];
  if(pitches.length||ge.length||hits.length||bases.length){
    const g=mark({id:uuid(),athleteId,date:dayKey,opponent:'상대팀 미입력',venue:'',competition:'',ourScore:null,opponentScore:null,status:'completed',startedAt:`${dayKey}T13:00:00`,endedAt:`${dayKey}T21:00:00`,legacySource:`v4:${athleteId}:${dayKey}:game`,deletedAt:null});
    out.games.push(g);
    let ap=null;
    if(pitches.length||ge.length){
      ap=mark({id:uuid(),athleteId,gameId:g.id,type:'pitching',inning:1,half:'top',outs:0,runner1:false,runner2:false,runner3:false,ourScore:0,opponentScore:0,status:'completed',startedAt:pitches[0]?.ts?iso(Number(pitches[0].ts)):`${dayKey}T13:00:00`,endedAt:pitches.at(-1)?.ts?iso(Number(pitches.at(-1).ts)):`${dayKey}T15:00:00`,legacySource:`v4:${athleteId}:${dayKey}:appearance`,deletedAt:null});
      out.appearances.push(ap);
    }
    const inplay=gp.inplayResults||{};
    pitches.forEach((p,i)=>{
      const pe=mark({id:uuid(),athleteId,gameId:g.id,trainingSessionId:null,appearanceId:ap?.id||null,category:'pitch',eventType:p.result||'ball',occurredAt:iso(Number(p.ts)||Date.parse(`${dayKey}T13:00:00`)+i),metadata:{inplayResult:inplay[p.id]||null,legacy:true},legacySource:`v4:${athleteId}:${dayKey}:pitch:${i+1}`,deletedAt:null}); out.events.push(pe);
      (p.secondary||[]).forEach((tag,j)=>out.events.push(mark({id:uuid(),athleteId,gameId:g.id,trainingSessionId:null,appearanceId:ap?.id||null,category:'pitch_tag',eventType:tag,occurredAt:iso((Number(p.ts)||Date.parse(`${dayKey}T13:00:00`)+i)+j+1),metadata:{pitchEventId:pe.id,legacy:true},legacySource:`v4:${athleteId}:${dayKey}:pitch_tag:${i+1}:${j+1}`,deletedAt:null})));
    });
    ge.forEach((x,i)=>{const type=x.type==='PO'?'PICKOFF':(x.type||'OTHER');const category=['SB','CS'].includes(type)?'baserunning':'game_event';out.events.push(mark({id:uuid(),athleteId,gameId:g.id,trainingSessionId:null,appearanceId:ap?.id||null,category,eventType:type,occurredAt:iso(Number(x.ts)||Date.parse(`${dayKey}T16:00:00`)+i),metadata:{legacy:true},legacySource:`v4:${athleteId}:${dayKey}:game_event:${i+1}`,deletedAt:null}));});
    hits.forEach((x,i)=>out.events.push(mark({id:uuid(),athleteId,gameId:g.id,trainingSessionId:null,appearanceId:null,category:'batting',eventType:x.result||'OUT',occurredAt:iso(Number(x.ts)||Date.parse(`${dayKey}T17:00:00`)+i),metadata:{legacy:true},legacySource:`v4:${athleteId}:${dayKey}:batting:${i+1}`,deletedAt:null})));
    bases.forEach((x,i)=>out.events.push(mark({id:uuid(),athleteId,gameId:g.id,trainingSessionId:null,appearanceId:null,category:'baserunning',eventType:x.type||'SB',occurredAt:iso(Number(x.ts)||Date.parse(`${dayKey}T18:00:00`)+i),metadata:{from:null,to:null,legacy:true},legacySource:`v4:${athleteId}:${dayKey}:baserunning:${i+1}`,deletedAt:null})));
  }
}
function loadState(){
  try{
    const raw=JSON.parse(localStorage.getItem(STORAGE_KEY));
    if(raw?.version>=5&&raw.events) return normalizeV5(raw);
    if(raw?.version>=4||raw?.athleteDays||raw?.days){ const migrated=normalizeV5(migrateV4Local(raw)); localStorage.setItem(`${STORAGE_KEY}-v4-backup-${Date.now()}`,JSON.stringify(raw)); localStorage.setItem(STORAGE_KEY,JSON.stringify(migrated)); return migrated; }
  }catch(err){ console.warn('local load failed',err); }
  return initialState();
}
function saveState(schedule=true){
  state.version=5; localStorage.setItem(STORAGE_KEY,JSON.stringify(state)); if(schedule) scheduleCloudSync();
}
function activeAthlete(){ return state.athletes.find(a=>a.id===state.activeAthleteId&&!a.deletedAt)||state.athletes.find(a=>!a.deletedAt); }
function athleteEvents(athleteId=state.activeAthleteId){ return activeNotDeleted(state.events).filter(e=>e.athleteId===athleteId); }
function athleteGames(){ return activeNotDeleted(state.games).filter(g=>g.athleteId===state.activeAthleteId); }
function athleteTrainings(){ return activeNotDeleted(state.trainingSessions).filter(s=>s.athleteId===state.activeAthleteId); }
function findGame(id){ return state.games.find(x=>x.id===id&&!x.deletedAt); }
function findTraining(id){ return state.trainingSessions.find(x=>x.id===id&&!x.deletedAt); }
function findAppearance(id){ return state.appearances.find(x=>x.id===id&&!x.deletedAt); }
function sessionForEvent(e){ return e.gameId?findGame(e.gameId):e.trainingSessionId?findTraining(e.trainingSessionId):null; }
function activeSession(){
  const a=state.activeSession||{}; if(a.type==='game'){const g=findGame(a.id);if(g&&g.athleteId===state.activeAthleteId)return {type:'game',item:g};}
  if(a.type==='training'){const s=findTraining(a.id);if(s&&s.athleteId===state.activeAthleteId)return {type:'training',item:s};}
  const liveGame=athleteGames().filter(g=>g.status==='live').sort((a,b)=>b._updatedAt-a._updatedAt)[0]; if(liveGame){state.activeSession={type:'game',id:liveGame.id};return {type:'game',item:liveGame};}
  const liveTraining=athleteTrainings().filter(s=>s.status==='live').sort((a,b)=>b._updatedAt-a._updatedAt)[0]; if(liveTraining){state.activeSession={type:'training',id:liveTraining.id};return {type:'training',item:liveTraining};}
  return null;
}
function activePitchingAppearance(gameId){ return activeNotDeleted(state.appearances).filter(a=>a.athleteId===state.activeAthleteId&&a.gameId===gameId&&a.type==='pitching'&&a.status==='live').sort((a,b)=>new Date(b.startedAt)-new Date(a.startedAt))[0]||null; }

function newEvent({category,eventType,gameId=null,trainingSessionId=null,appearanceId=null,metadata={}}){
  state.eventSeq=Number(state.eventSeq||0)+1;metadata={...metadata,_seq:state.eventSeq};
  const e=mark({id:uuid(),athleteId:state.activeAthleteId,gameId,trainingSessionId,appearanceId,category,eventType,occurredAt:iso(),metadata,deletedAt:null});
  state.events.push(e); saveState(); return e;
}
function softDeleteEvent(id,showUndo=true){
  const e=state.events.find(x=>x.id===id&&!x.deletedAt); if(!e) return;
  const deletedAt=iso();e.deletedAt=deletedAt;mark(e);
  if(e.category==='pitch')for(const tag of state.events.filter(x=>!x.deletedAt&&x.category==='pitch_tag'&&x.metadata?.pitchEventId===e.id)){tag.deletedAt=deletedAt;tag.metadata={...(tag.metadata||{}),_parentDeletedBy:e.id};mark(tag);}
  saveState();if(showUndo){lastDeletedEventId=id;showUndoBar('기록을 삭제했습니다');}render();
}
function restoreDeletedEvent(id){ const e=state.events.find(x=>x.id===id); if(!e)return;e.deletedAt=null;mark(e);for(const tag of state.events.filter(x=>x.deletedAt&&x.metadata?._parentDeletedBy===id)){tag.deletedAt=null;const m={...(tag.metadata||{})};delete m._parentDeletedBy;tag.metadata=m;mark(tag);}saveState();render();showToast('삭제를 취소했습니다'); }
function undoLastEvent(){
  const s=activeSession(); if(!s)return showToast('활성 세션이 없습니다');
  const arr=athleteEvents().filter(e=>s.type==='game'?e.gameId===s.item.id:e.trainingSessionId===s.item.id).sort(byTime);
  const last=arr.at(-1); if(!last)return showToast('취소할 입력이 없습니다'); softDeleteEvent(last.id,false); showToast('마지막 입력을 취소했습니다');
}

function derivePitching(events){
  const ev=activeNotDeleted(events).sort(byTime); const pitches=ev.filter(e=>e.category==='pitch'); const tags=ev.filter(e=>e.category==='pitch_tag'); const gameEvents=ev.filter(e=>e.category==='game_event');
  let balls=0,strikes=0,batterNo=1,k=0,bb=0,hbp=0,firstPitchSamples=[],first=true,strikePitches=0,ballPitches=0;
  for(const e of ev){
    if(e.category==='pitch'){
      const r=e.eventType; if(STRIKE_RESULTS.has(r)) strikePitches++; else if(r==='ball') ballPitches++;
      if(first){ firstPitchSamples.push(STRIKE_RESULTS.has(r)); first=false; }
      let end=false;
      if(r==='ball'){ if(balls>=3){bb++;end=true;} else balls++; }
      else if(r==='called'||r==='swinging'){ if(strikes>=2){k++;end=true;} else strikes++; }
      else if(r==='foul'){ if(strikes<2) strikes++; }
      else if(r==='inplay'){ end=true; }
      else if(r==='hbp'){ hbp++;end=true; }
      if(end){balls=0;strikes=0;batterNo++;first=true;}
    }else if(e.category==='game_event'){
      if(e.eventType==='IBB'){bb++;balls=0;strikes=0;batterNo++;first=true;}
      if(e.eventType==='NEXT_BATTER'){balls=0;strikes=0;batterNo++;first=true;}
    }
  }
  const pitchIds=new Set(pitches.map(p=>p.id));
  const validTags=tags.filter(t=>!t.metadata?.pitchEventId||pitchIds.has(t.metadata.pitchEventId));
  const irScored=gameEvents.filter(e=>e.eventType==='IR_SCORED').length;
  return {pitches,total:pitches.length,balls,strikes,batterNo,k,bb,hbp,strikePitches,ballPitches,strikePct:(strikePitches+ballPitches)?strikePitches/(strikePitches+ballPitches):null,firstPitchCount:firstPitchSamples.length,firstPitchStrikes:firstPitchSamples.filter(Boolean).length,firstPitchPct:firstPitchSamples.length?firstPitchSamples.filter(Boolean).length/firstPitchSamples.length:null,wp:validTags.filter(e=>e.eventType==='WP').length,pb:validTags.filter(e=>e.eventType==='PB').length,balk:gameEvents.filter(e=>e.eventType==='BALK').length,irScored};
}
function derivePitchingAggregate(events){
  const relevant=activeNotDeleted(events).filter(e=>['pitch','pitch_tag','game_event'].includes(e.category));const groups=new Map();
  for(const e of relevant){const key=e.appearanceId||e.gameId||'loose';if(!groups.has(key))groups.set(key,[]);groups.get(key).push(e);}
  const out={total:0,k:0,bb:0,hbp:0,strikePitches:0,ballPitches:0,firstPitchCount:0,firstPitchStrikes:0,wp:0,pb:0,balk:0,irScored:0};
  for(const arr of groups.values()){const d=derivePitching(arr);for(const k of Object.keys(out))out[k]+=Number(d[k]||0);}
  out.strikePct=(out.strikePitches+out.ballPitches)?out.strikePitches/(out.strikePitches+out.ballPitches):null;out.firstPitchPct=out.firstPitchCount?out.firstPitchStrikes/out.firstPitchCount:null;return out;
}
function calcHitting(events){
  const items=activeNotDeleted(events).filter(e=>e.category==='batting'); const c=Object.fromEntries(HIT_RESULTS.map(k=>[k,0]));
  items.forEach(e=>{if(c[e.eventType]!==undefined)c[e.eventType]++;}); const H=c['1B']+c['2B']+c['3B']+c.HR; const AB=H+c.SO+c.OUT+c.ROE; const PA=AB+c.BB+c.HBP+c.SF; const TB=c['1B']+2*c['2B']+3*c['3B']+4*c.HR; const avg=AB?H/AB:null; const den=AB+c.BB+c.HBP+c.SF; const obp=den?(H+c.BB+c.HBP)/den:null; const slg=AB?TB/AB:null; const ops=obp!==null&&slg!==null?obp+slg:null;
  const contactItems=items.filter(e=>['1B','2B','3B','HR','OUT','ROE','SF'].includes(e.eventType)&&e.metadata?.contact); const hard=contactItems.filter(e=>e.metadata.contact==='hard').length;
  return {...c,H,AB,PA,TB,avg,obp,slg,ops,kPct:PA?c.SO/PA:null,bbPct:PA?c.BB/PA:null,hardPct:contactItems.length?hard/contactItems.length:null};
}
function calcTrainingHits(events){ const a=activeNotDeleted(events).filter(e=>e.category==='training_hit'); const whiff=a.filter(e=>e.eventType==='whiff').length,hard=a.filter(e=>e.eventType==='hard').length,contact=a.length-whiff; return {total:a.length,whiff,hard,contact,contactPct:a.length?contact/a.length:null,hardPct:contact?hard/contact:null}; }
function calcThrowing(events){
  const a=activeNotDeleted(events); const training=a.filter(e=>e.category==='training_throw'), game=a.filter(e=>e.category==='pitch'); let tlu=game.length;
  const c={light:0,moderate:0,full:0}; training.forEach(e=>{const i=e.metadata?.intensity||e.eventType;c[i]=(c[i]||0)+1;tlu+=WEIGHTS[i]||0;});
  return {training:training.length,game:game.length,total:training.length+game.length,tlu,counts:c,trainingTLU:training.reduce((n,e)=>n+(WEIGHTS[e.metadata?.intensity||e.eventType]||0),0)};
}
function calcBase(events){ const a=activeNotDeleted(events).filter(e=>e.category==='baserunning'),sb=a.filter(e=>e.eventType==='SB').length,cs=a.filter(e=>e.eventType==='CS').length; return {sb,cs,pct:sb+cs?sb/(sb+cs):null}; }
function calcDefense(events){ const a=activeNotDeleted(events).filter(e=>e.category==='defense'),success=a.filter(e=>e.eventType==='SUCCESS').length,error=a.filter(e=>e.eventType==='ERROR').length; const tr=activeNotDeleted(events).filter(e=>e.category==='training_defense');return {game:a.length,success,error,training:tr.length,trainingSuccess:tr.filter(e=>e.eventType==='SUCCESS').length}; }
function rollingTLU(days){
  const start=new Date();start.setHours(0,0,0,0);start.setDate(start.getDate()-(days-1)); return calcThrowing(athleteEvents().filter(e=>new Date(e.occurredAt)>=start)).tlu;
}

function sessionEvents(session){ return athleteEvents().filter(e=>session.type==='game'?e.gameId===session.item.id:e.trainingSessionId===session.item.id); }
function appearanceEvents(appearance){ return athleteEvents().filter(e=>e.appearanceId===appearance.id); }
function inheritedRunners(a){ return [a.runner1,a.runner2,a.runner3].filter(Boolean).length; }
function showToast(msg){ const el=document.getElementById('toast');el.textContent=msg;el.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('show'),1400); }
function showUndoBar(msg){ const bar=document.getElementById('undoBar');document.getElementById('undoText').textContent=msg;bar.hidden=false;clearTimeout(undoDeleteTimer);undoDeleteTimer=setTimeout(()=>{bar.hidden=true;lastDeletedEventId=null;},5000); }
function go(view){ currentView=view;document.querySelectorAll('.view').forEach(v=>v.classList.toggle('active',v.dataset.view===view));document.querySelectorAll('[data-nav]').forEach(b=>b.classList.toggle('active',b.dataset.nav===view));const titles={home:'홈',record:'기록',logs:'상세 로그',analysis:'분석',settings:'설정'};document.getElementById('pageTitle').textContent=titles[view]||'Baseball Tracker';render();window.scrollTo({top:0,behavior:'smooth'}); }
function openModal(id){ document.getElementById(id).hidden=false; }
function closeModal(id){ document.getElementById(id).hidden=true; }

function athleteMeta(a){ const bits=[];if(a.number)bits.push(`#${a.number}`);if(a.team)bits.push(a.team);if(a.position)bits.push(a.position);if(!bits.length)bits.push(`${a.throws==='L'?'좌':'우'}투 · ${a.bats==='L'?'좌':a.bats==='S'?'양':'우'}타`);return bits.join(' · '); }
function athleteRowHtml(a){ const active=a.id===state.activeAthleteId;const initial=(a.name||'선').trim().slice(0,1).toUpperCase();return `<button class="athlete-row ${active?'active':''}" data-athlete-select="${esc(a.id)}" type="button"><span class="athlete-row-avatar">${esc(initial)}</span><span class="athlete-row-copy"><strong>${esc(a.name)}</strong><small>${esc(athleteMeta(a))}</small></span><span class="athlete-row-check">${active?'✓':'›'}</span></button>`; }
function renderAthletes(){
  const a=activeAthlete();if(!a)return;document.getElementById('activeAthleteName').textContent=a.name;document.getElementById('athleteInitial').textContent=(a.name||'선').trim().slice(0,1).toUpperCase();const list=activeNotDeleted(state.athletes);document.getElementById('athleteCount').textContent=`${list.length}명`;const html=list.map(athleteRowHtml).join('');document.getElementById('athleteList').innerHTML=html;document.getElementById('athletePickerList').innerHTML=html;
}
function switchAthlete(id){ if(!state.athletes.some(a=>a.id===id&&!a.deletedAt))return;state.activeAthleteId=id;state.activeSession={type:null,id:null};saveState(false);closeModal('athletePickerModal');render();showToast(`${activeAthlete().name} 선수로 전환`); }
function openAthleteEditor(id=null){ const a=id?state.athletes.find(x=>x.id===id):null;document.getElementById('athleteModalTitle').textContent=a?'선수 정보 수정':'선수 추가';document.getElementById('athleteId').value=a?.id||'';document.getElementById('athleteName').value=a?.name||'';document.getElementById('athleteNumber').value=a?.number||'';document.getElementById('athleteBirthDate').value=a?.birthDate||'';document.getElementById('athleteTeam').value=a?.team||'';document.getElementById('athletePosition').value=a?.position||'';document.getElementById('athleteThrows').value=a?.throws||'R';document.getElementById('athleteBats').value=a?.bats||'R';document.getElementById('deleteAthleteBtn').hidden=!a;openModal('athleteModal'); }
function saveAthleteForm(e){ e.preventDefault();const id=document.getElementById('athleteId').value;const name=document.getElementById('athleteName').value.trim();if(!name)return showToast('선수 이름을 입력하세요');let a=id?state.athletes.find(x=>x.id===id):null;if(!a){a=makeAthlete(name);state.athletes.push(a);state.activeAthleteId=a.id;}Object.assign(a,{name,number:document.getElementById('athleteNumber').value.trim(),birthDate:document.getElementById('athleteBirthDate').value,team:document.getElementById('athleteTeam').value.trim(),position:document.getElementById('athletePosition').value.trim(),throws:document.getElementById('athleteThrows').value,bats:document.getElementById('athleteBats').value});mark(a);saveState();closeModal('athleteModal');render();showToast('선수 정보를 저장했습니다'); }
function deleteAthlete(){ const id=document.getElementById('athleteId').value;const a=state.athletes.find(x=>x.id===id&&!x.deletedAt);if(!a)return;if(activeNotDeleted(state.athletes).length<=1)return showToast('최소 한 명의 선수는 필요합니다');if(!confirm(`${a.name} 선수와 연결된 기록을 삭제할까요?`))return;a.deletedAt=iso();mark(a);for(const arr of [state.games,state.trainingSessions,state.appearances,state.events])for(const x of arr)if(x.athleteId===id&&!x.deletedAt){x.deletedAt=iso();mark(x);}if(state.activeAthleteId===id)state.activeAthleteId=activeNotDeleted(state.athletes)[0]?.id;state.activeSession={type:null,id:null};saveState();closeModal('athleteModal');render();showToast('선수를 삭제했습니다'); }

function renderHome(){
  const ev=athleteEvents(),today=localDateKey(),todayEv=ev.filter(e=>dateFromIso(e.occurredAt)===today),thr=calcThrowing(todayEv),hit=calcHitting(todayEv),base=calcBase(todayEv),pitch=derivePitchingAggregate(todayEv);
  document.getElementById('homeThrows').textContent=thr.total;
  document.getElementById('homeTLU').textContent=one(thr.tlu);
  document.getElementById('homePA').textContent=hit.PA;
  document.getElementById('homeSwings').textContent=calcTrainingHits(todayEv).total;
  renderSessionList('homeRecentSessions',4);
}
function sessionListData(){ const games=athleteGames().map(item=>({type:'game',item,date:item.date,ts:item.startedAt||`${item.date}T12:00:00`}));const training=athleteTrainings().map(item=>({type:'training',item,date:item.date,ts:item.startedAt||`${item.date}T12:00:00`}));return [...games,...training].sort((a,b)=>new Date(b.ts)-new Date(a.ts)); }
function renderSessionList(id,limit=20){ const arr=sessionListData().slice(0,limit),el=document.getElementById(id);if(!arr.length){el.innerHTML='<div class="session-item"><div class="session-copy"><b>아직 기록이 없습니다</b><small>경기 또는 훈련을 시작해보세요.</small></div></div>';return;}el.innerHTML=arr.map(s=>{const game=s.type==='game',item=s.item,events=athleteEvents().filter(e=>game?e.gameId===item.id:e.trainingSessionId===item.id),summary=game?`${calcThrowing(events).game} pitches · ${calcHitting(events).PA} PA`:`${calcThrowing(events).training} throws · ${calcTrainingHits(events).total} swings`;return `<article class="session-item ${s.type}"><span class="session-type">${game?'G':'T'}</span><span class="session-copy"><b>${game?`vs ${esc(item.opponent||'상대팀 미입력')}`:esc(item.title||'훈련')}</b><small>${fmtLongDate(item.date)} · ${summary}${item.status==='live'?' · 진행 중':''}</small></span><button data-open-session="${s.type}:${item.id}" type="button">열기</button></article>`;}).join(''); }
function renderRecord(){
  // 날짜 선택
  const dateInput=document.getElementById('recordDate');
  if(dateInput) dateInput.value=recordDate;

  // 경기/훈련 선택
  const gameRadio=document.getElementById('sessionTypeGame');
  const trainingRadio=document.getElementById('sessionTypeTraining');
  if(gameRadio) gameRadio.checked=(sessionType==='game');
  if(trainingRadio) trainingRadio.checked=(sessionType==='training');

  // recordDate와 sessionType이 모두 설정되었는지 확인
  const hasSelection = recordDate && sessionType;
  
  if(!hasSelection){
    document.getElementById('recordContent').hidden=true;
    document.getElementById('recordEmpty').hidden=false;
    return;
  }

  document.getElementById('recordContent').hidden=false;
  document.getElementById('recordEmpty').hidden=true;

  // 날짜 + 타입에 맞는 세션 찾기
  let session=null;
  if(sessionType==='game'){
    session=athleteGames().find(g=>g.date===recordDate);
  } else {
    session=athleteTrainings().find(s=>s.date===recordDate);
  }

  // 헤더 업데이트
  const isGame=sessionType==='game';
  document.getElementById('workspaceKicker').textContent=isGame?'GAME':'TRAINING';
  if(session){
    document.getElementById('workspaceTitle').textContent=isGame?`vs ${session.opponent||'상대팀 미입력'}`:session.title||'훈련';
    document.getElementById('workspaceMeta').textContent=fmtLongDate(recordDate);
  } else {
    document.getElementById('workspaceTitle').textContent=isGame?'경기':'훈련';
    document.getElementById('workspaceMeta').textContent=fmtLongDate(recordDate);
  }

  // 탭 업데이트
  document.querySelectorAll('.tab-button').forEach(btn=>{
    btn.classList.toggle('active', btn.dataset.tab===currentTab);
  });

  // 로그 렌더링
  renderRecordLog(session);
}

function renderRecordLog(session){
  const el=document.getElementById('recordLogList');
  if(!el) return;

  if(!session){
    el.innerHTML='<div class="log-item empty"><small>기록이 없습니다</small></div>';
    document.getElementById('recordLogCount').textContent='0 events';
    return;
  }

  const isGame=sessionType==='game';
  const events=athleteEvents().filter(e=>
    isGame ? e.gameId===session.id : e.trainingSessionId===session.id
  ).sort((a,b)=>new Date(b.occurredAt)-new Date(a.occurredAt));

  document.getElementById('recordLogCount').textContent=`${events.length} events`;

  if(!events.length){
    el.innerHTML='<div class="log-item empty"><small>아직 기록이 없습니다</small></div>';
    return;
  }

  const html=events.map(e=>{
    const label=EVENT_LABELS[e.eventType]||e.eventType;
    return `<article class="log-item" data-event-id="${e.id}"><span class="log-time">${timeText(e.occurredAt)}</span><span class="log-label">${esc(label)}</span><button class="log-edit" data-edit-event="${e.id}" type="button">수정</button></article>`;
  }).join('');
  el.innerHTML=html;
}
function applyPitchDraftToForm(patch={}){
  const next={...pitchDraft,...patch};
  pitchDraft=next;
  const balls=document.getElementById('pitchBalls'); const strikes=document.getElementById('pitchStrikes'); if(balls) balls.value=next.balls; if(strikes) strikes.value=next.strikes;
  const fields={pitchInning:next.inning,pitchHalf:next.half,pitchOuts:next.outs,pitchOurScore:next.ourScore,pitchOppScore:next.opponentScore,pitchRunner1:!!next.runners[1],pitchRunner2:!!next.runners[2],pitchRunner3:!!next.runners[3]};
  for(const [id,value] of Object.entries(fields)){ const el=document.getElementById(id); if(!el) continue; if(id.startsWith('pitchRunner')) el.checked=Boolean(value); else el.value=value; }
  const resultButtons=document.querySelectorAll('[data-pitch-select]'); resultButtons.forEach(btn=>btn.classList.toggle('selected',btn.dataset.pitchSelect===next.result));
  const inplayWrap=document.getElementById('pitchInplayWrap'); const inplaySelect=document.getElementById('pitchInplayResult'); if(inplayWrap) inplayWrap.style.display = next.result === 'inplay' ? '' : 'none'; if(inplaySelect){ inplaySelect.hidden = next.result !== 'inplay'; if(next.inplayResult) inplaySelect.value = next.inplayResult; }
  const saveBtn=document.getElementById('pitchDraftSave'); if(saveBtn) saveBtn.disabled=!next.result;
}
function resetPitchDraft(){
  const s=activeSession(); if(!s||s.type!=='game'){ pitchDraft={...pitchDraft,result:null,inplayResult:'',inning:1,half:'top',outs:0,balls:0,strikes:0,ourScore:0,opponentScore:0,runners:{1:false,2:false,3:false},editingEventId:null}; return; }
  const a=activePitchingAppearance(s.item.id); if(a){
    pitchDraft={...pitchDraft,result:null,inplayResult:'',inning:Number(a.inning||1),half:a.half||'top',outs:Number(a.outs||0),balls:0,strikes:0,ourScore:Number(a.ourScore||0),opponentScore:Number(a.opponentScore||0),runners:{1:!!a.runner1,2:!!a.runner2,3:!!a.runner3},editingEventId:null};
  } else {
    pitchDraft={...pitchDraft,result:null,inplayResult:'',inning:1,half:'top',outs:0,balls:0,strikes:0,ourScore:0,opponentScore:0,runners:{1:false,2:false,3:false},editingEventId:null};
  }
  applyPitchDraftToForm();
  const saveBtn=document.getElementById('pitchDraftSave'); if(saveBtn) saveBtn.textContent='저장';
  document.querySelectorAll('[data-pitch-select]').forEach(btn=>btn.classList.remove('selected'));
  const inplayWrap=document.getElementById('pitchInplayWrap'); if(inplayWrap) inplayWrap.style.display='none';
}
function loadPitchDraftFromEvent(eventId){
  const ev=state.events.find(x=>x.id===eventId&&!x.deletedAt); if(!ev||ev.category!=='pitch') return;
  const s=activeSession(); if(!s||s.type!=='game') return;
  const a=activePitchingAppearance(s.item.id) || findAppearance(ev.appearanceId) || null;
  const metadata=ev.metadata||{};
  pitchDraft={
    result:ev.eventType,
    inplayResult: metadata.inplayResult || '',
    inning:Number(metadata.inning ?? a?.inning ?? 1),
    half: metadata.half ?? a?.half ?? 'top',
    outs:Number(metadata.outs ?? a?.outs ?? 0),
    balls:Number(metadata.balls ?? 0),
    strikes:Number(metadata.strikes ?? 0),
    ourScore:Number(metadata.ourScore ?? a?.ourScore ?? 0),
    opponentScore:Number(metadata.opponentScore ?? a?.opponentScore ?? 0),
    runners:{1:!!(metadata.runners&&metadata.runners[1]),2:!!(metadata.runners&&metadata.runners[2]),3:!!(metadata.runners&&metadata.runners[3])},
    editingEventId: ev.id
  };
  applyPitchDraftToForm();
  const saveBtn=document.getElementById('pitchDraftSave'); if(saveBtn) saveBtn.textContent='수정 저장';
  showToast('기록을 불러왔습니다');
}
function renderGameWorkspace(game){
  const events=athleteEvents().filter(e=>e.gameId===game.id),hit=calcHitting(events),base=calcBase(events),def=calcDefense(events);document.getElementById('gameHitSummary').textContent=`${hit.PA} PA · AVG ${decimal(hit.avg)} · OPS ${decimal(hit.ops)}`;document.getElementById('gameBaseSummary').textContent=`SB ${base.sb} / CS ${base.cs} · ${pct(base.pct)}`;document.getElementById('gameDefenseSummary').textContent=`${def.game} events · E ${def.error}`;
  const ap=activePitchingAppearance(game.id);document.getElementById('noAppearanceCard').hidden=!!ap;document.getElementById('appearanceWorkspace').hidden=!ap;if(ap){const pe=appearanceEvents(ap),p=derivePitching(pe),runners=[ap.runner1?'1루':null,ap.runner2?'2루':null,ap.runner3?'3루':null].filter(Boolean);document.getElementById('appearanceSituation').textContent=`${ap.inning}회${ap.half==='top'?'초':'말'} · ${ap.outs} OUT`;document.getElementById('appearanceRunnerText').textContent=runners.length?runners.join(' · '):'주자 없음';document.getElementById('liveBalls').textContent=p.balls;document.getElementById('liveStrikes').textContent=p.strikes;document.getElementById('livePitchCount').textContent=p.total;document.getElementById('liveStrikePct').textContent=pct(p.strikePct);document.getElementById('liveFirstPitchPct').textContent=pct(p.firstPitchPct);document.getElementById('liveK').textContent=p.k;document.getElementById('liveBB').textContent=p.bb;document.getElementById('liveHBP').textContent=p.hbp;document.getElementById('liveIR').textContent=`${inheritedRunners(ap)} / ${p.irScored}`;syncPitchDraftFromAppearance(ap);} else {syncPitchDraftFromAppearance(null);} 
}
function renderTrainingWorkspace(session){ const events=athleteEvents().filter(e=>e.trainingSessionId===session.id),thr=calcThrowing(events),hit=calcTrainingHits(events),def=calcDefense(events);document.getElementById('trainingThrowSummary').textContent=`${thr.training} throws · ${one(thr.trainingTLU)} TLU`;document.getElementById('trainingHitSummary').textContent=`${hit.total} swings · Contact ${pct(hit.contactPct)} · Hard ${pct(hit.hardPct)}`;document.getElementById('trainingDefenseSummary').textContent=`${def.training} reps`;
}

function eventFilterMatch(e){ if(logFilter==='all')return true;if(logFilter==='pitch')return ['pitch','pitch_tag'].includes(e.category);if(logFilter==='training')return e.category.startsWith('training_');return e.category===logFilter; }
function sessionOptionValue(e){ return e.gameId?`game:${e.gameId}`:e.trainingSessionId?`training:${e.trainingSessionId}`:'other'; }
function categoryLabel(c){ return ({pitch:'투구',pitch_tag:'투구',batting:'타격',baserunning:'주루',defense:'수비',training_throw:'훈련 투구',training_hit:'훈련 타격',training_defense:'훈련 수비',game_event:'예외'})[c]||c; }
function eventDetail(e){ const m=e.metadata||{};if(e.category==='training_throw')return `${contextLabel(m.context)} · ${one(WEIGHTS[m.intensity||e.eventType]||0)} TLU`;if(e.category==='training_hit')return `${trainingHitTypeLabel(m.type)} · ${EVENT_LABELS[e.eventType]||e.eventType}`;if(e.category==='training_defense')return `${drillLabel(m.drill)} · ${EVENT_LABELS[e.eventType]||e.eventType}`;if(e.category==='baserunning')return `${m.from?`${m.from}루`:''}${m.from?' → ':''}${m.to?Number(m.to)===4?'홈':`${m.to}루`:''}`;if(e.category==='defense')return `${m.position||''}${m.battedBall?` · ${m.battedBall}`:''}`;if(e.category==='pitch'&&e.eventType==='inplay'&&m.inplayResult)return `타구 결과 ${m.inplayResult}`;if(e.category==='pitch_tag')return '직전 투구에 연결';if(e.category==='game_event'&&e.eventType==='IR_SCORED')return '승계주자 1명 득점';if(e.category==='batting'){const bits=[];if(m.contact)bits.push(`타구 ${contactLabel(m.contact)}`);if(m.battedBall)bits.push(m.battedBall);return bits.join(' · ');}return ''; }
function renderLogs(){
  const select=document.getElementById('logSessionFilter'),sessions=sessionListData();select.innerHTML='<option value="all">모든 경기/훈련</option>'+sessions.map(s=>`<option value="${s.type}:${s.item.id}">${fmtShortDate(s.item.date)} · ${s.type==='game'?`vs ${esc(s.item.opponent||'상대팀')}`:esc(s.item.title||'훈련')}</option>`).join('');select.value=logSessionFilter;
  document.querySelectorAll('[data-log-filter]').forEach(b=>b.classList.toggle('active',b.dataset.logFilter===logFilter));let ev=athleteEvents().filter(eventFilterMatch);if(logSessionFilter!=='all')ev=ev.filter(e=>sessionOptionValue(e)===logSessionFilter);ev.sort((a,b)=>new Date(b.occurredAt)-new Date(a.occurredAt));document.getElementById('logCount').textContent=`${ev.length} events`;const el=document.getElementById('logList');if(!ev.length){el.innerHTML='<div class="session-item"><div class="session-copy"><b>표시할 기록이 없습니다</b><small>필터를 바꾸거나 새 기록을 입력하세요.</small></div></div>';return;}
  let lastDate='';let html='';for(const e of ev){const d=dateFromIso(e.occurredAt);if(d!==lastDate){html+=`<div class="log-date">${fmtLongDate(d)}</div>`;lastDate=d;}const s=sessionForEvent(e);html+=`<article class="log-item"><span class="log-time">${timeText(e.occurredAt)}</span><span class="log-badge ${e.category}">${categoryLabel(e.category)}</span><span class="log-copy"><b>${esc(EVENT_LABELS[e.eventType]||e.eventType)}</b><small>${esc(s?(e.gameId?`vs ${s.opponent||'상대팀'}`:(s.title||'훈련')):'')}${eventDetail(e)?` · ${esc(eventDetail(e))}`:''}</small></span><span class="log-actions"><button data-edit-event="${e.id}" type="button">수정</button><button class="delete" data-delete-event="${e.id}" type="button">삭제</button></span></article>`;}
  el.innerHTML=html;
}
function renderAnalysis(){
  const ev=athleteEvents(),pitch=derivePitchingAggregate(ev),hit=calcHitting(ev),base=calcBase(ev),def=calcDefense(ev);document.getElementById('analysis7TLU').textContent=one(rollingTLU(7));document.getElementById('analysis28TLU').textContent=one(rollingTLU(28));
  const appearances=activeNotDeleted(state.appearances).filter(a=>a.athleteId===state.activeAthleteId&&a.type==='pitching');const ir=appearances.reduce((n,a)=>n+inheritedRunners(a),0),irs=ev.filter(e=>e.category==='game_event'&&e.eventType==='IR_SCORED').length;
  document.getElementById('analysisPitching').innerHTML=metricHtml([['PITCHES',pitch.total],['STRIKE%',pct(pitch.strikePct)],['1ST PITCH',pct(pitch.firstPitchPct)],['K',pitch.k],['BB',pitch.bb],['HBP',pitch.hbp],['APP',appearances.length],['IR / IRS',`${ir} / ${irs}`],['WP / BALK',`${pitch.wp} / ${pitch.balk}`]]);
  document.getElementById('analysisHitting').innerHTML=metricHtml([['PA',hit.PA],['AVG',decimal(hit.avg)],['OBP',decimal(hit.obp)],['SLG',decimal(hit.slg)],['OPS',decimal(hit.ops)],['K%',pct(hit.kPct)],['BB%',pct(hit.bbPct)],['HARD',pct(hit.hardPct)],['H',hit.H]]);
  document.getElementById('analysisBaserunning').innerHTML=metricHtml([['SB',base.sb],['CS',base.cs],['SB%',pct(base.pct)]]);document.getElementById('analysisDefense').innerHTML=metricHtml([['GAME EVENTS',def.game],['SUCCESS',def.success],['ERROR',def.error],['TRAINING REPS',def.training],['TRAINING OK',def.trainingSuccess]]);
  const rows=[];for(let i=13;i>=0;i--){const key=dateShift(-i),dayEv=ev.filter(e=>dateFromIso(e.occurredAt)===key);rows.push({key,tlu:calcThrowing(dayEv).tlu});}const max=Math.max(1,...rows.map(x=>x.tlu));document.getElementById('tluChart').innerHTML=rows.map(x=>`<div class="bar-item"><div class="bar-shell"><div class="bar" style="height:${Math.max(2,x.tlu/max*100)}%"></div></div><b>${one(x.tlu)}</b><small>${fmtShortDate(x.key)}</small></div>`).join('');
}
function metricHtml(items){ return items.map(([l,v])=>`<div><span>${l}</span><strong>${v}</strong></div>`).join(''); }
function contextLabel(v){ return ({warmup:'몸풀기',catchplay:'캐치볼',defense:'수비송구',bullpen:'불펜',other:'기타'})[v]||v||'기타'; }
function trainingHitTypeLabel(v){ return ({tee:'티',toss:'토스',bp:'배팅볼',live:'라이브',other:'기타'})[v]||v||'기타'; }
function drillLabel(v){ return ({infield:'내야',outfield:'외야',throwing:'송구',catching:'캐치',footwork:'풋워크',other:'기타'})[v]||v||'기타'; }
function contactLabel(v){ return ({weak:'약',medium:'보통',hard:'강'})[v]||v||''; }
function render(){document.getElementById('todayLabel').textContent=fmtLongDate(localDateKey());renderAthletes();renderHome();renderRecord();renderAnalysis();renderCloudAuth();renderCloudStatus();refreshInstallUI();}
function openNewGame(){document.getElementById('gameEditId').value='';document.getElementById('gameDate').value=localDateKey();document.getElementById('gameOpponent').value='';document.getElementById('gameVenue').value='';document.getElementById('gameCompetition').value='';document.getElementById('gameOurScore').value='';document.getElementById('gameOppScore').value='';openModal('gameModal');}
function createGame(e){e.preventDefault();const id=document.getElementById('gameEditId').value,date=document.getElementById('gameDate').value||localDateKey();let g=id?state.games.find(x=>x.id===id&&!x.deletedAt):null;if(g){Object.assign(g,{date,opponent:document.getElementById('gameOpponent').value.trim(),venue:document.getElementById('gameVenue').value.trim(),competition:document.getElementById('gameCompetition').value.trim(),ourScore:numOrNull(document.getElementById('gameOurScore').value),opponentScore:numOrNull(document.getElementById('gameOppScore').value)});mark(g);saveState();closeModal('gameModal');render();showToast('경기 정보를 수정했습니다');return;}g=mark({id:uuid(),athleteId:state.activeAthleteId,date,opponent:document.getElementById('gameOpponent').value.trim(),venue:document.getElementById('gameVenue').value.trim(),competition:document.getElementById('gameCompetition').value.trim(),ourScore:numOrNull(document.getElementById('gameOurScore').value),opponentScore:numOrNull(document.getElementById('gameOppScore').value),status:'live',startedAt:iso(),endedAt:null,legacySource:null,deletedAt:null});state.games.push(g);state.activeSession={type:'game',id:g.id};gameTab='pitching';saveState();closeModal('gameModal');go('record');showToast('경기를 시작했습니다');}
function openNewTraining(){document.getElementById('trainingEditId').value='';document.getElementById('trainingDate').value=localDateKey();document.getElementById('trainingTitle').value='';openModal('trainingModal');}
function createTraining(e){e.preventDefault();const id=document.getElementById('trainingEditId').value;let s=id?state.trainingSessions.find(x=>x.id===id&&!x.deletedAt):null;if(s){s.date=document.getElementById('trainingDate').value||localDateKey();s.title=document.getElementById('trainingTitle').value.trim()||'훈련';mark(s);saveState();closeModal('trainingModal');render();showToast('훈련 정보를 수정했습니다');return;}s=mark({id:uuid(),athleteId:state.activeAthleteId,date:document.getElementById('trainingDate').value||localDateKey(),title:document.getElementById('trainingTitle').value.trim()||'훈련',status:'live',startedAt:iso(),endedAt:null,legacySource:null,deletedAt:null});state.trainingSessions.push(s);state.activeSession={type:'training',id:s.id};trainingTab='throwing';saveState();closeModal('trainingModal');go('record');showToast('훈련을 시작했습니다');}
function openSessionEditor(){const s=activeSession();if(!s)return;if(s.type==='game'){const g=s.item;document.getElementById('gameEditId').value=g.id;document.getElementById('gameDate').value=g.date;document.getElementById('gameOpponent').value=g.opponent||'';document.getElementById('gameVenue').value=g.venue||'';document.getElementById('gameCompetition').value=g.competition||'';document.getElementById('gameOurScore').value=g.ourScore??'';document.getElementById('gameOppScore').value=g.opponentScore??'';openModal('gameModal');}else{const x=s.item;document.getElementById('trainingEditId').value=x.id;document.getElementById('trainingDate').value=x.date;document.getElementById('trainingTitle').value=x.title||'';openModal('trainingModal');}}
function numOrNull(v){return v===''||v===null?null:Number(v);}
function openSessionToken(token){const [type,id]=token.split(':');state.activeSession={type,id};saveState(false);go('record');}
function toggleSessionStatus(){const s=activeSession();if(!s)return;if(s.item.status==='live'){s.item.status='completed';s.item.endedAt=iso();mark(s.item);if(s.type==='game'){for(const a of state.appearances.filter(a=>a.gameId===s.item.id&&a.status==='live'&&!a.deletedAt)){a.status='completed';a.endedAt=iso();mark(a);}}showToast('세션을 종료했습니다');}else{s.item.status='live';s.item.endedAt=null;mark(s.item);showToast('세션을 다시 열었습니다');}saveState();render();}
function openSessionLogs(){const s=activeSession();if(!s)return;logSessionFilter=`${s.type}:${s.item.id}`;logFilter='all';go('logs');}

function openAppearance(){const s=activeSession();if(!s||s.type!=='game')return;const a=activePitchingAppearance(s.item.id);document.getElementById('appearanceInning').value=(a?.inning||1);document.getElementById('appearanceHalf').value=(a?.half||'top');document.getElementById('appearanceOuts').value=String(a?.outs??0);document.getElementById('runner1').checked=!!a?.runner1;document.getElementById('runner2').checked=!!a?.runner2;document.getElementById('runner3').checked=!!a?.runner3;document.getElementById('appearanceOurScore').value=String(a?.ourScore??s.item.ourScore??0);document.getElementById('appearanceOppScore').value=String(a?.opponentScore??s.item.opponentScore??0);openModal('appearanceModal');}
function startAppearance(e){e.preventDefault();const s=activeSession();if(!s||s.type!=='game')return;const a=mark({id:uuid(),athleteId:state.activeAthleteId,gameId:s.item.id,type:'pitching',inning:Number(document.getElementById('appearanceInning').value||1),half:document.getElementById('appearanceHalf').value,outs:Number(document.getElementById('appearanceOuts').value||0),runner1:document.getElementById('runner1').checked,runner2:document.getElementById('runner2').checked,runner3:document.getElementById('runner3').checked,ourScore:Number(document.getElementById('appearanceOurScore').value||0),opponentScore:Number(document.getElementById('appearanceOppScore').value||0),status:'live',startedAt:iso(),endedAt:null,legacySource:null,deletedAt:null});state.appearances.push(a);s.item.ourScore=Number(document.getElementById('appearanceOurScore').value||s.item.ourScore||0);s.item.opponentScore=Number(document.getElementById('appearanceOppScore').value||s.item.opponentScore||0);mark(s.item);saveState();closeModal('appearanceModal');render();showToast('등판 기록을 시작했습니다');}
function endAppearance(){const s=activeSession();if(!s||s.type!=='game')return;const a=activePitchingAppearance(s.item.id);if(!a)return;a.status='completed';a.endedAt=iso();mark(a);saveState();render();showToast('등판을 종료했습니다');}
function selectPitchDraft(result){const s=activeSession();if(!s||s.type!=='game')return showToast('경기를 먼저 선택하세요');const a=activePitchingAppearance(s.item.id);if(!a)return showToast('등판을 먼저 시작하세요');pitchDraft.result=result;pitchDraft.inplayResult = result==='inplay' ? (pitchDraft.inplayResult || 'OUT') : '';pitchDraft.editingEventId = pitchDraft.editingEventId || null;
  const resultButtons=document.querySelectorAll('[data-pitch-select]'); resultButtons.forEach(btn=>btn.classList.toggle('selected',btn.dataset.pitchSelect===result));
  const inplayWrap=document.getElementById('pitchInplayWrap'); const inplaySelect=document.getElementById('pitchInplayResult'); if(inplayWrap) inplayWrap.style.display = result === 'inplay' ? '' : 'none'; if(inplaySelect) inplaySelect.hidden = result !== 'inplay';
  const saveBtn=document.getElementById('pitchDraftSave'); if(saveBtn) saveBtn.disabled=false; showToast(result==='hbp'?'사구 선택':'투구를 저장할 준비');
}
function savePitchDraft(){const s=activeSession();if(!s||s.type!=='game')return showToast('경기를 먼저 선택하세요');const a=activePitchingAppearance(s.item.id);if(!a)return showToast('등판을 먼저 시작하세요');const result = pitchDraft.result; if(!result) return showToast('결과를 먼저 선택하세요');
  a.inning = Number(document.getElementById('pitchInning').value || a.inning || 1); a.half = document.getElementById('pitchHalf').value || a.half || 'top'; a.outs = Number(document.getElementById('pitchOuts').value || a.outs || 0); a.runner1 = document.getElementById('pitchRunner1').checked; a.runner2 = document.getElementById('pitchRunner2').checked; a.runner3 = document.getElementById('pitchRunner3').checked; a.ourScore = Number(document.getElementById('pitchOurScore').value || 0); a.opponentScore = Number(document.getElementById('pitchOppScore').value || 0); s.item.ourScore = a.ourScore; s.item.opponentScore = a.opponentScore; mark(a); mark(s.item);
  const metadata={
    inning:a.inning, half:a.half, outs:a.outs, balls:Number(document.getElementById('pitchBalls').value||0), strikes:Number(document.getElementById('pitchStrikes').value||0),
    runners:{1:a.runner1,2:a.runner2,3:a.runner3},
    ourScore:a.ourScore, opponentScore:a.opponentScore, selectedResult: result
  };
  if(result==='inplay') metadata.inplayResult = document.getElementById('pitchInplayResult').value || 'OUT';
  const targetId = pitchDraft.editingEventId;
  let e = targetId ? state.events.find(x=>x.id===targetId&&!x.deletedAt) : null;
  if(e){
    e.eventType = result;
    e.metadata = {...(e.metadata||{}), ...metadata};
    e.occurredAt = e.occurredAt || iso();
    if(result==='inplay'&&metadata.inplayResult){ e.metadata.inplayResult = metadata.inplayResult; }
    mark(e);
    showToast('투구 기록을 수정했습니다');
  } else {
    e=newEvent({category:'pitch',eventType:result,gameId:s.item.id,appearanceId:a.id,metadata});
    if(result==='inplay'&&metadata.inplayResult){ e.metadata = {...e.metadata, inplayResult: metadata.inplayResult}; mark(e); }
    showToast(result==='hbp'?'사구 기록':'투구 저장');
  }
  pitchDraft = {...pitchDraft, result:null, inplayResult:'', balls:Number(document.getElementById('pitchBalls').value||0), strikes:Number(document.getElementById('pitchStrikes').value||0), editingEventId:null};
  const saveBtn=document.getElementById('pitchDraftSave'); if(saveBtn){ saveBtn.disabled=true; saveBtn.textContent='저장'; }
  document.querySelectorAll('[data-pitch-select]').forEach(btn=>btn.classList.remove('selected'));
  const inplayWrap=document.getElementById('pitchInplayWrap'); const inplaySelect=document.getElementById('pitchInplayResult'); if(inplayWrap) inplayWrap.style.display='none'; if(inplaySelect) inplaySelect.hidden=true; 
  saveState(); render();
}
function recordPitchTag(tag){const s=activeSession();if(!s||s.type!=='game')return;const a=activePitchingAppearance(s.item.id);if(!a)return showToast('등판을 먼저 시작하세요');const last=appearanceEvents(a).filter(e=>e.category==='pitch').sort(byTime).at(-1);if(!last)return showToast('먼저 실제 투구를 기록하세요');newEvent({category:'pitch_tag',eventType:tag,gameId:s.item.id,appearanceId:a.id,metadata:{pitchEventId:last.id}});render();showToast(`${EVENT_LABELS[tag]||tag} 기록`);}
function recordGameEvent(type){const s=activeSession();if(!s||s.type!=='game')return;const a=activePitchingAppearance(s.item.id);if(['BALK','IBB','PICKOFF','IR_SCORED','NEXT_BATTER'].includes(type)&&!a)return showToast('등판을 먼저 시작하세요');if(type==='IR_SCORED'&&derivePitching(appearanceEvents(a)).irScored>=inheritedRunners(a))return showToast('승계주자 수보다 많이 기록할 수 없습니다');newEvent({category:'game_event',eventType:type,gameId:s.item.id,appearanceId:a?.id||null,metadata:{}});render();showToast(EVENT_LABELS[type]||type);}
function setInplay(result){const e=state.events.find(x=>x.id===pendingInplayEventId&&!x.deletedAt);if(e){e.metadata={...(e.metadata||{}),inplayResult:result};mark(e);saveState();}pendingInplayEventId=null;closeModal('inplayModal');render();showToast(`인플레이 ${result}`);}
function recordHit(result){const s=activeSession();if(!s||s.type!=='game')return;const contact=document.getElementById('hitContact').value,battedBall=document.getElementById('hitBattedBall').value;newEvent({category:'batting',eventType:result,gameId:s.item.id,metadata:{contact:contact||null,battedBall:battedBall||null}});render();showToast(`${EVENT_LABELS[result]||result} 기록`);}
function recordDefense(result){const s=activeSession();if(!s||s.type!=='game')return;newEvent({category:'defense',eventType:result,gameId:s.item.id,metadata:{position:document.getElementById('defensePosition').value,battedBall:document.getElementById('defenseBallType').value}});render();showToast(EVENT_LABELS[result]||result);}
function recordBase(result){const s=activeSession();if(!s||s.type!=='game')return;let from=Number(document.getElementById('baseFrom').value),to=Number(document.getElementById('baseTo').value);if(to<=from)to=Math.min(4,from+1);newEvent({category:'baserunning',eventType:result,gameId:s.item.id,metadata:{from,to}});render();showToast(EVENT_LABELS[result]||result);}
function recordTrainingThrow(intensity){const s=activeSession();if(!s||s.type!=='training')return;newEvent({category:'training_throw',eventType:intensity,trainingSessionId:s.item.id,metadata:{intensity,context:throwContext}});render();showToast(`${EVENT_LABELS[intensity]} +1`);}
function recordTrainingHit(quality){const s=activeSession();if(!s||s.type!=='training')return;newEvent({category:'training_hit',eventType:quality,trainingSessionId:s.item.id,metadata:{quality,type:trainingHitType}});render();showToast('스윙 +1');}
function recordTrainingDefense(result){const s=activeSession();if(!s||s.type!=='training')return;newEvent({category:'training_defense',eventType:result,trainingSessionId:s.item.id,metadata:{drill:document.getElementById('trainingDefenseDrill').value}});render();showToast('수비 훈련 +1');}

function editField(label,name,type,options,value){if(type==='select')return `<label>${label}<select name="${name}">${options.map(([v,l])=>`<option value="${esc(v)}" ${String(value)===String(v)?'selected':''}>${esc(l)}</option>`).join('')}</select></label>`;return `<label>${label}<input name="${name}" type="${type||'text'}" value="${esc(value??'')}" /></label>`;}
function openEventEdit(id){const e=state.events.find(x=>x.id===id&&!x.deletedAt);if(!e)return;document.getElementById('editEventId').value=id;let html='';if(e.category==='pitch')html=editField('투구 결과','eventType','select',PITCH_RESULTS.map(v=>[v,EVENT_LABELS[v]]),e.eventType)+(e.eventType==='inplay'?editField('인플레이 결과','inplayResult','select',[['','선택 안 함'],['OUT','OUT'],['1B','1B'],['2B','2B'],['3B','3B'],['HR','HR'],['ROE','ROE']],e.metadata?.inplayResult||''):'');
else if(e.category==='pitch_tag')html=editField('예외 태그','eventType','select',[['WP','WP'],['PB','PB'],['UNCUGHT3','낫아웃']],e.eventType);
else if(e.category==='game_event')html=editField('경기 이벤트','eventType','select',[['BALK','보크'],['IBB','무투구 IBB'],['PICKOFF','견제사'],['IR_SCORED','승계주자 득점'],['NEXT_BATTER','다음 타자']],e.eventType);
else if(e.category==='batting')html=editField('타석 결과','eventType','select',HIT_RESULTS.map(v=>[v,EVENT_LABELS[v]]),e.eventType)+editField('타구 강도','contact','select',[['','선택 안 함'],['weak','약'],['medium','보통'],['hard','강']],e.metadata?.contact||'')+editField('타구 형태','battedBall','select',[['','선택 안 함'],['GB','GB'],['LD','LD'],['FB','FB']],e.metadata?.battedBall||'');
else if(e.category==='baserunning')html=editField('결과','eventType','select',[['SB','도루 성공'],['CS','도루 실패']],e.eventType)+editField('출발 베이스','from','select',[['1','1루'],['2','2루'],['3','3루']],e.metadata?.from||1)+editField('도착 베이스','to','select',[['2','2루'],['3','3루'],['4','홈']],e.metadata?.to||2);
else if(e.category==='defense')html=editField('결과','eventType','select',[['SUCCESS','수비 성공'],['ERROR','실책'],['POSITION_CHANGE','포지션 변경']],e.eventType)+editField('포지션','position','select',['P','C','1B','2B','3B','SS','LF','CF','RF'].map(v=>[v,v]),e.metadata?.position||'SS')+editField('타구 형태','battedBall','select',[['GB','땅볼'],['FB','뜬공'],['LD','라인드라이브'],['OTHER','기타']],e.metadata?.battedBall||'GB');
else if(e.category==='training_throw')html=editField('강도','eventType','select',[['light','가벼운'],['moderate','적정'],['full','전력']],e.eventType)+editField('훈련 구분','context','select',[['warmup','몸풀기'],['catchplay','캐치볼'],['defense','수비송구'],['bullpen','불펜'],['other','기타']],e.metadata?.context||'other');
else if(e.category==='training_hit')html=editField('타구 결과','eventType','select',[['whiff','헛스윙'],['weak','약한 타구'],['medium','보통 타구'],['hard','강한 타구']],e.eventType)+editField('훈련 종류','type','select',[['tee','티'],['toss','토스'],['bp','배팅볼'],['live','라이브'],['other','기타']],e.metadata?.type||'other');
else if(e.category==='training_defense')html=editField('결과','eventType','select',[['SUCCESS','성공'],['MISS','실수']],e.eventType)+editField('훈련 종류','drill','select',[['infield','내야'],['outfield','외야'],['throwing','송구'],['catching','캐치'],['footwork','풋워크'],['other','기타']],e.metadata?.drill||'other');
html+=editField('기록 시간','occurredAt','datetime-local',[],toLocalInput(e.occurredAt));document.getElementById('eventEditFields').innerHTML=html;openModal('eventEditModal');}
function toLocalInput(v){const d=new Date(v);const p=n=>String(n).padStart(2,'0');return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;}
function saveEventEdit(e){e.preventDefault();const id=document.getElementById('editEventId').value,ev=state.events.find(x=>x.id===id&&!x.deletedAt);if(!ev)return;const f=new FormData(e.target);ev.eventType=f.get('eventType')||ev.eventType;for(const k of ['inplayResult','contact','battedBall','from','to','position','context','type','drill'])if(f.has(k)){let v=f.get(k);if(['from','to'].includes(k)&&v)v=Number(v);ev.metadata={...(ev.metadata||{}),[k]:v||null};}if(ev.category==='training_throw')ev.metadata.intensity=ev.eventType;if(ev.category==='training_hit')ev.metadata.quality=ev.eventType;const t=f.get('occurredAt');if(t)ev.occurredAt=new Date(t).toISOString();mark(ev);saveState();closeModal('eventEditModal');render();showToast('기록을 수정했습니다');}
function getCloudConfig(){const c=window.BASEBALL_SUPABASE_CONFIG||{},url=String(c.url||'').trim(),key=String(c.publishableKey||'').trim();return {url,key,valid:!!url&&!!key&&!url.includes('YOUR-PROJECT')&&!key.includes('YOUR_PUBLISHABLE')&&/^https:\/\//i.test(url)};}
function ensureSupabaseSdk(){if(window.supabase?.createClient)return Promise.resolve(true);return new Promise(resolve=>{const existing=document.querySelector('script[data-supabase-sdk]');if(existing){existing.addEventListener('load',()=>resolve(!!window.supabase?.createClient),{once:true});setTimeout(()=>resolve(!!window.supabase?.createClient),8000);return;}const script=document.createElement('script');script.src='https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';script.async=true;script.dataset.supabaseSdk='1';script.onload=()=>resolve(!!window.supabase?.createClient);script.onerror=()=>resolve(false);document.head.appendChild(script);setTimeout(()=>resolve(!!window.supabase?.createClient),8000);});}
function setCloudStatus(status,message){cloud.status=status;cloud.message=message;renderCloudStatus();}
function isPristineLocal(){const aa=activeNotDeleted(state.athletes);return aa.length===1&&aa[0].name==='선수 1'&&!aa[0].number&&!aa[0].team&&!aa[0].position&&!state.games.length&&!state.trainingSessions.length&&!state.appearances.length&&!state.events.length;}
function hasDirtyCloudWork(){return [state.athletes,state.games,state.trainingSessions,state.appearances,state.events].some(arr=>arr.some(x=>x._dirty));}
function scheduleCloudSync(delay=700,forcePull=false){if(forcePull)cloud.forcePull=true;clearTimeout(cloud.timer);if(!cloud.configured||!cloud.session||cloud.syncing||!navigator.onLine){renderCloudStatus();return;}if(!hasDirtyCloudWork()&&!cloud.forcePull)return;cloud.timer=setTimeout(()=>syncCloud(false),delay);}
function athleteToCloud(a,u){return {id:a.id,owner_id:u,name:a.name||'선수',number:a.number||null,birth_date:a.birthDate||null,team:a.team||null,position:a.position||null,throws:a.throws||'R',bats:a.bats||'R',client_updated_at:Number(a._updatedAt||0),deleted_at:a.deletedAt||null};}
function athleteFromCloud(r){return normalizeEntity({id:r.id,name:r.name||'선수',number:r.number||'',birthDate:r.birth_date||'',team:r.team||'',position:r.position||'',throws:r.throws||'R',bats:r.bats||'R',deletedAt:r.deleted_at||null,_updatedAt:Number(r.client_updated_at||0),_dirty:false});}
function gameToCloud(x,u){return {id:x.id,owner_id:u,athlete_id:x.athleteId,game_date:x.date,opponent:x.opponent||'',venue:x.venue||null,competition:x.competition||null,our_score:x.ourScore,opponent_score:x.opponentScore,status:x.status||'completed',started_at:x.startedAt||null,ended_at:x.endedAt||null,client_updated_at:Number(x._updatedAt||0),deleted_at:x.deletedAt||null,legacy_source:x.legacySource||null};}
function gameFromCloud(r){return normalizeEntity({id:r.id,athleteId:r.athlete_id,date:r.game_date,opponent:r.opponent||'',venue:r.venue||'',competition:r.competition||'',ourScore:r.our_score,opponentScore:r.opponent_score,status:r.status||'completed',startedAt:r.started_at,endedAt:r.ended_at,legacySource:r.legacy_source||null,deletedAt:r.deleted_at||null,_updatedAt:Number(r.client_updated_at||0),_dirty:false});}
function trainingToCloud(x,u){return {id:x.id,owner_id:u,athlete_id:x.athleteId,session_date:x.date,title:x.title||'훈련',status:x.status||'completed',started_at:x.startedAt||null,ended_at:x.endedAt||null,client_updated_at:Number(x._updatedAt||0),deleted_at:x.deletedAt||null,legacy_source:x.legacySource||null};}
function trainingFromCloud(r){return normalizeEntity({id:r.id,athleteId:r.athlete_id,date:r.session_date,title:r.title||'훈련',status:r.status||'completed',startedAt:r.started_at,endedAt:r.ended_at,legacySource:r.legacy_source||null,deletedAt:r.deleted_at||null,_updatedAt:Number(r.client_updated_at||0),_dirty:false});}
function appearanceToCloud(x,u){return {id:x.id,owner_id:u,athlete_id:x.athleteId,game_id:x.gameId,type:x.type||'pitching',inning:x.inning,half:x.half,outs:x.outs,runner_1:!!x.runner1,runner_2:!!x.runner2,runner_3:!!x.runner3,our_score:x.ourScore||0,opponent_score:x.opponentScore||0,status:x.status||'completed',started_at:x.startedAt||null,ended_at:x.endedAt||null,client_updated_at:Number(x._updatedAt||0),deleted_at:x.deletedAt||null,legacy_source:x.legacySource||null};}
function appearanceFromCloud(r){return normalizeEntity({id:r.id,athleteId:r.athlete_id,gameId:r.game_id,type:r.type||'pitching',inning:Number(r.inning||1),half:r.half||'top',outs:Number(r.outs||0),runner1:!!r.runner_1,runner2:!!r.runner_2,runner3:!!r.runner_3,ourScore:Number(r.our_score||0),opponentScore:Number(r.opponent_score||0),status:r.status||'completed',startedAt:r.started_at,endedAt:r.ended_at,legacySource:r.legacy_source||null,deletedAt:r.deleted_at||null,_updatedAt:Number(r.client_updated_at||0),_dirty:false});}
function eventToCloud(x,u){return {id:x.id,owner_id:u,athlete_id:x.athleteId,game_id:x.gameId||null,training_session_id:x.trainingSessionId||null,appearance_id:x.appearanceId||null,category:x.category,event_type:x.eventType,occurred_at:x.occurredAt,metadata:x.metadata||{},client_updated_at:Number(x._updatedAt||0),deleted_at:x.deletedAt||null,legacy_source:x.legacySource||null};}
function eventFromCloud(r){return normalizeEntity({id:r.id,athleteId:r.athlete_id,gameId:r.game_id||null,trainingSessionId:r.training_session_id||null,appearanceId:r.appearance_id||null,category:r.category,eventType:r.event_type,occurredAt:r.occurred_at,metadata:r.metadata||{},legacySource:r.legacy_source||null,deletedAt:r.deleted_at||null,_updatedAt:Number(r.client_updated_at||0),_dirty:false});}
const CLOUD_TABLES=[
  {table:'athletes',arr:()=>state.athletes,to:athleteToCloud,from:athleteFromCloud},
  {table:'games',arr:()=>state.games,to:gameToCloud,from:gameFromCloud},
  {table:'training_sessions',arr:()=>state.trainingSessions,to:trainingToCloud,from:trainingFromCloud},
  {table:'appearances',arr:()=>state.appearances,to:appearanceToCloud,from:appearanceFromCloud},
  {table:'events',arr:()=>state.events,to:eventToCloud,from:eventFromCloud}
];
function remapLegacyReference(table,oldId,newId){if(oldId===newId)return;if(table==='games'){for(const a of state.appearances)if(a.gameId===oldId)a.gameId=newId;for(const e of state.events)if(e.gameId===oldId)e.gameId=newId;if(state.activeSession?.type==='game'&&state.activeSession.id===oldId)state.activeSession.id=newId;}else if(table==='training_sessions'){for(const e of state.events)if(e.trainingSessionId===oldId)e.trainingSessionId=newId;if(state.activeSession?.type==='training'&&state.activeSession.id===oldId)state.activeSession.id=newId;}else if(table==='appearances'){for(const e of state.events)if(e.appearanceId===oldId)e.appearanceId=newId;}else if(table==='events'){for(const e of state.events)if(e.category==='pitch_tag'&&e.metadata?.pitchEventId===oldId)e.metadata.pitchEventId=newId;}}
async function pullTable(cfg,userId){const {data,error}=await cloud.client.from(cfg.table).select('*').eq('owner_id',userId);if(error)throw error;const arr=cfg.arr(),remoteMap=new Map();for(const row of data||[]){remoteMap.set(row.id,row);const remote=cfg.from(row);let idx=arr.findIndex(x=>x.id===remote.id);if(idx<0&&remote.legacySource){idx=arr.findIndex(x=>x.legacySource&&x.legacySource===remote.legacySource);if(idx>=0&&arr[idx].id!==remote.id){remapLegacyReference(cfg.table,arr[idx].id,remote.id);arr[idx]=remote;continue;}}if(idx<0)arr.push(remote);else if(Number(remote._updatedAt||0)>Number(arr[idx]._updatedAt||0))arr[idx]=remote;}return remoteMap;}
async function pushTable(cfg,userId,remoteMap){const arr=cfg.arr(),push=[];for(const x of arr){const r=remoteMap.get(x.id),rt=Number(r?.client_updated_at||0),lt=Number(x._updatedAt||0);if(!r||lt>rt||(x._dirty&&lt>=rt))push.push(cfg.to(x,userId));}if(push.length){const {error}=await cloud.client.from(cfg.table).upsert(push,{onConflict:'id'});if(error)throw error;for(const row of push){const x=arr.find(y=>y.id===row.id);if(x&&Number(x._updatedAt)===Number(row.client_updated_at))x._dirty=false;}}}
async function initCloud(){const cfg=getCloudConfig();if(!cfg.valid){cloud.configured=false;setCloudStatus('local','Supabase 미설정 · 이 기기에만 저장');renderCloudAuth();return;}const sdkReady=await ensureSupabaseSdk();cloud.configured=cfg.valid&&sdkReady;if(!cloud.configured){setCloudStatus('error','Supabase SDK를 불러오지 못했습니다 · 인터넷 연결을 확인하세요');renderCloudAuth();return;}try{cloud.client=window.supabase.createClient(cfg.url,cfg.key,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});const {data,error}=await cloud.client.auth.getSession();if(error)throw error;cloud.session=data.session||null;cloud.client.auth.onAuthStateChange((event,session)=>{cloud.session=session||null;renderCloudAuth();renderCloudStatus();if(session&&['SIGNED_IN','INITIAL_SESSION','USER_UPDATED'].includes(event))scheduleCloudSync(120,true);if(!session)setCloudStatus('local','로그아웃됨 · 로컬 기록은 유지됩니다');});cloud.authInitialized=true;renderCloudAuth();if(cloud.session){setCloudStatus(navigator.onLine?'syncing':'offline',navigator.onLine?'클라우드 확인 중':'오프라인 · 로컬 저장 중');if(navigator.onLine)scheduleCloudSync(120,true);}else setCloudStatus('local','로그인하면 여러 기기에서 기록을 동기화합니다');}catch(err){console.error(err);setCloudStatus('error','Supabase 연결 실패 · 설정을 확인하세요');renderCloudAuth();}}
async function syncCloud(manual=false){if(!cloud.configured||!cloud.client||!cloud.session){if(manual)showToast('먼저 클라우드에 로그인하세요');return;}if(!navigator.onLine){setCloudStatus('offline','오프라인 · 기록은 이 기기에 저장됩니다');if(manual)showToast('온라인이 되면 자동 동기화됩니다');return;}if(cloud.syncing)return;cloud.syncing=true;cloud.forcePull=false;setCloudStatus('syncing','동기화 중');try{const userId=cloud.session.user.id;if(state.cloudOwnerId&&state.cloudOwnerId!==userId&&!isPristineLocal())throw new Error('이 기기의 로컬 데이터가 다른 계정과 연결되어 있습니다. 먼저 JSON 백업을 내보내세요.');
    // 새 기기에서는 서버 선수 목록을 먼저 확인해 기본 placeholder가 올라가지 않게 합니다.
    const {data:remoteAthletes,error:raErr}=await cloud.client.from('athletes').select('*').eq('owner_id',userId);if(raErr)throw raErr;if((remoteAthletes||[]).length&&isPristineLocal()){state.athletes=[];state.games=[];state.trainingSessions=[];state.appearances=[];state.events=[];state.activeAthleteId=null;}
    state.cloudOwnerId=userId;
    const remoteMaps=[];for(const cfg of CLOUD_TABLES){if(cfg.table==='athletes'){const map=new Map();for(const row of remoteAthletes||[]){map.set(row.id,row);const remote=cfg.from(row),idx=state.athletes.findIndex(x=>x.id===remote.id);if(idx<0)state.athletes.push(remote);else if(remote._updatedAt>Number(state.athletes[idx]._updatedAt||0))state.athletes[idx]=remote;}remoteMaps.push(map);}else remoteMaps.push(await pullTable(cfg,userId));}
    if(!activeNotDeleted(state.athletes).length){const a=makeAthlete('선수 1');state.athletes.push(a);state.activeAthleteId=a.id;}if(!state.activeAthleteId||!state.athletes.some(a=>a.id===state.activeAthleteId&&!a.deletedAt))state.activeAthleteId=activeNotDeleted(state.athletes)[0]?.id;
    for(let i=0;i<CLOUD_TABLES.length;i++)await pushTable(CLOUD_TABLES[i],userId,remoteMaps[i]);
    cloud.lastSync=Date.now();localStorage.setItem(LAST_SYNC_KEY,String(cloud.lastSync));saveState(false);setCloudStatus('synced','동기화됨');render();if(manual)showToast('클라우드 동기화 완료');
  }catch(err){console.error('Cloud sync failed',err);setCloudStatus('error',`동기화 실패 · ${err?.message||'연결을 확인하세요'}`);if(manual)showToast('동기화에 실패했습니다');}finally{cloud.syncing=false;renderCloudStatus();if(hasDirtyCloudWork()&&cloud.status!=='error')scheduleCloudSync(600);}}
function renderCloudStatus(){const pill=document.getElementById('cloudPill'),badge=document.getElementById('cloudBadge'),text=document.getElementById('cloudStatusText'),last=document.getElementById('cloudLastSync');if(!pill||!badge||!text||!last)return;let status=cloud.status,label='로컬';if(cloud.configured&&cloud.session){if(!navigator.onLine)status='offline';label=status==='syncing'?'동기화 중':status==='synced'?'☁ 동기화됨':status==='offline'?'오프라인':status==='error'?'오류':'클라우드';}else if(cloud.configured)label='로그인';pill.className=`cloud-pill ${status}`;pill.textContent=label;badge.className=`cloud-badge ${status}`;badge.textContent=label;text.textContent=!navigator.onLine&&cloud.session?'오프라인 · 기록은 로컬에 저장되고 연결 후 자동 동기화됩니다':cloud.message;last.textContent=cloud.lastSync?`마지막 ${new Date(cloud.lastSync).toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit'})}`:'';}
function renderCloudAuth(){const nc=document.getElementById('cloudNotConfigured'),lo=document.getElementById('cloudLoggedOut'),li=document.getElementById('cloudLoggedIn');if(!nc||!lo||!li)return;nc.hidden=cloud.configured;lo.hidden=!cloud.configured||!!cloud.session;li.hidden=!cloud.configured||!cloud.session;document.getElementById('cloudUserEmail').textContent=cloud.session?.user?.email||'로그인됨';}
async function signInCloud(){if(!cloud.client)return showToast('Supabase 설정이 필요합니다');const email=document.getElementById('authEmail').value.trim(),password=document.getElementById('authPassword').value;if(!email||!password)return showToast('이메일과 비밀번호를 입력하세요');setCloudStatus('syncing','로그인 중');const {error}=await cloud.client.auth.signInWithPassword({email,password});if(error){setCloudStatus('error',`로그인 실패 · ${error.message}`);return showToast('로그인에 실패했습니다');}document.getElementById('authPassword').value='';showToast('로그인되었습니다');scheduleCloudSync(80,true);}
async function signUpCloud(){if(!cloud.client)return showToast('Supabase 설정이 필요합니다');const email=document.getElementById('authEmail').value.trim(),password=document.getElementById('authPassword').value;if(!email||password.length<6)return showToast('이메일과 6자 이상 비밀번호를 입력하세요');setCloudStatus('syncing','계정 생성 중');const redirectTo=new URL('./',location.href).href;const {data,error}=await cloud.client.auth.signUp({email,password,options:{emailRedirectTo:redirectTo}});if(error){setCloudStatus('error',`가입 실패 · ${error.message}`);return showToast(error.message);}document.getElementById('authPassword').value='';if(data.session){showToast('계정 생성 및 로그인 완료');scheduleCloudSync(80,true);}else{setCloudStatus('local','가입 완료 · 이메일 확인 후 로그인하세요');showToast('확인 이메일을 확인하세요');}}
async function signOutCloud(){if(!cloud.client)return;const {error}=await cloud.client.auth.signOut({scope:'local'});if(error)return showToast('로그아웃 실패');cloud.session=null;setCloudStatus('local','로그아웃됨 · 로컬 기록은 유지됩니다');renderCloudAuth();showToast('로그아웃했습니다');}

function exportData(){const payload={...state,exportedAt:iso(),schemaVersion:5};const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`baseball-tracker-v5-${localDateKey()}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);showToast('백업을 내보냈습니다');}
function importData(file){const r=new FileReader();r.onload=()=>{try{const data=JSON.parse(r.result);let incoming;if(data?.version>=5&&data.events)incoming=normalizeV5(data);else if(data?.version>=4||data?.athleteDays||data?.days)incoming=migrateV4Local(data);else throw new Error('invalid');state=incoming;const t=now();for(const arr of [state.athletes,state.games,state.trainingSessions,state.appearances,state.events])arr.forEach((x,i)=>{x._updatedAt=t+i;x._dirty=true;});saveState();render();showToast('백업을 불러왔습니다');}catch(err){console.error(err);showToast('올바른 백업 파일이 아닙니다');}};r.readAsText(file);}
function isStandaloneMode(){return window.matchMedia('(display-mode: standalone)').matches||window.navigator.standalone===true;}
function refreshInstallUI(){const installed=isStandaloneMode(),mini=document.getElementById('installMini'),btn=document.getElementById('installApp'),hint=document.getElementById('installHint');if(mini)mini.hidden=installed;if(btn){btn.disabled=installed;btn.textContent=installed?'설치됨':'이 기기에 앱 설치';}if(hint&&installed)hint.textContent='현재 홈 화면 앱으로 실행 중입니다.';}
async function installApp(){if(isStandaloneMode())return showToast('이미 앱으로 실행 중입니다');if(deferredInstallPrompt){deferredInstallPrompt.prompt();await deferredInstallPrompt.userChoice;deferredInstallPrompt=null;refreshInstallUI();return;}showToast('브라우저 메뉴에서 홈 화면에 추가를 선택하세요');}

function handleAction(action){if(action==='new-game')return openNewGame();if(action==='new-training')return openNewTraining();}

// Record view 이벤트 리스너
document.addEventListener('change',e=>{
  if(e.target.id==='recordDate'){
    recordDate=e.target.value;
    render();
  }
  if(e.target.name==='sessionType'){
    sessionType=e.target.value;
    render();
  }
});

// 탭 네비게이션
document.addEventListener('click',e=>{
  if(e.target.classList.contains('tab-button')){
    currentTab=e.target.dataset.tab;
    render();
  }
});

document.addEventListener('click',e=>{
  const t=e.target.closest('button');if(!t)return;
  if(t.dataset.nav)return go(t.dataset.nav);
  if(t.dataset.action)return handleAction(t.dataset.action);
  if(t.dataset.closeModal)return closeModal(t.dataset.closeModal);
  if(t.dataset.athleteSelect)return switchAthlete(t.dataset.athleteSelect);
  if(t.dataset.editEvent)return openEventEdit(t.dataset.editEvent);
  if(t.dataset.deleteEvent)return softDeleteEvent(t.dataset.deleteEvent,true);
});

document.getElementById('athleteSwitcher').addEventListener('click',()=>{renderAthletes();openModal('athletePickerModal');});
document.getElementById('closeAthletePicker').addEventListener('click',()=>closeModal('athletePickerModal'));
document.getElementById('pickerAddAthlete').addEventListener('click',()=>{closeModal('athletePickerModal');openAthleteEditor();});
document.getElementById('addAthleteBtn').addEventListener('click',()=>openAthleteEditor());
document.getElementById('closeAthleteModal').addEventListener('click',()=>closeModal('athleteModal'));
document.getElementById('cancelAthleteBtn').addEventListener('click',()=>closeModal('athleteModal'));
document.getElementById('athleteForm').addEventListener('submit',saveAthleteForm);
document.getElementById('deleteAthleteBtn').addEventListener('click',deleteAthlete);
document.getElementById('gameForm').addEventListener('submit',createGame);
document.getElementById('trainingForm').addEventListener('submit',createTraining);
document.getElementById('recordSessionPicker').addEventListener('change',e=>{const value=e.target.value;if(!value)return; if(value==='new-game'){openNewGame();return;} if(value==='new-training'){openNewTraining();return;} const [type,id]=value.split(':'); state.activeSession={type,id}; saveState(false); render();});
document.getElementById('endSessionBtn').addEventListener('click',toggleSessionStatus);
document.getElementById('workspaceEditBtn').addEventListener('click',openSessionEditor);
document.getElementById('workspaceLogsBtn').addEventListener('click',openSessionLogs);
document.getElementById('logSessionFilter').addEventListener('change',e=>{logSessionFilter=e.target.value;renderLogs();});
document.getElementById('eventEditForm').addEventListener('submit',saveEventEdit);
document.getElementById('undoDeleteBtn').addEventListener('click',()=>{if(lastDeletedEventId)restoreDeletedEvent(lastDeletedEventId);document.getElementById('undoBar').hidden=true;lastDeletedEventId=null;});
document.getElementById('exportData').addEventListener('click',exportData);
document.getElementById('importData').addEventListener('change',e=>{if(e.target.files?.[0])importData(e.target.files[0]);e.target.value='';});
document.getElementById('signInBtn').addEventListener('click',signInCloud);
document.getElementById('signUpBtn').addEventListener('click',signUpCloud);
document.getElementById('signOutBtn').addEventListener('click',signOutCloud);
document.getElementById('syncNowBtn').addEventListener('click',()=>syncCloud(true));
document.getElementById('cloudPill').addEventListener('click',()=>go('settings'));
document.getElementById('installMini').addEventListener('click',installApp);
document.getElementById('installApp').addEventListener('click',installApp);
window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferredInstallPrompt=e;refreshInstallUI();});
window.addEventListener('appinstalled',()=>{deferredInstallPrompt=null;refreshInstallUI();showToast('앱이 설치되었습니다');});
window.addEventListener('online',()=>{setCloudStatus(cloud.session?'syncing':'local',cloud.session?'인터넷 연결 복구 · 동기화 준비':'온라인');scheduleCloudSync(120,true);});
window.addEventListener('offline',()=>setCloudStatus('offline','오프라인 · 로컬 저장 중'));
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&cloud.session&&Date.now()-cloud.lastSync>60000)scheduleCloudSync(200,true);});

for(const modal of document.querySelectorAll('.modal-backdrop'))modal.addEventListener('click',e=>{if(e.target===modal)modal.hidden=true;});

if('serviceWorker' in navigator)window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(err=>console.warn('SW register failed',err)));
render();initCloud();
})();
