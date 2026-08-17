(() => {
'use strict';

const STORAGE_KEY = 'baseballTrackerV1';
const LAST_SYNC_KEY = 'baseballTrackerCloudLastSyncV5_2';
const WEIGHTS = { light:0.75, moderate:0.85, full:1.0 };
const GAME_THROW_WEIGHTS = { pickoff_normal:0.85, pickoff_error:0.85, game_warmup:1.0 };
const STRIKE_RESULTS = new Set(['called','swinging','foul','inplay']);
const PITCH_RESULTS = ['ball','called','swinging','foul','inplay','hbp'];
const HIT_RESULTS = ['1B','2B','3B','HR','BB','HBP','SO','OUT','ROE','SF'];
const INPLAY_RESULTS = ['OUT','1B','2B','3B','HR','ROE','SH','SF'];
const EVENT_LABELS = {
  ball:'BALL', called:'루킹 스트라이크', swinging:'헛스윙', foul:'파울', inplay:'인플레이', hbp:'사구 HBP',
  '1B':'안타 1B','2B':'2루타','3B':'3루타',HR:'홈런',BB:'볼넷',HBP:'사구',SO:'삼진',OUT:'범타',ROE:'실책 출루',SF:'희생플라이',
  SB:'도루 성공',CS:'도루 실패',SUCCESS:'수비 성공',ERROR:'실책',POSITION_CHANGE:'포지션 변경',MISS:'실수',
  WP:'폭투 WP',PB:'포일 PB',UNCUGHT3:'낫아웃',BALK:'보크',IBB:'무투구 고의4구',PICKOFF:'견제사',IR_SCORED:'승계주자 득점',NEXT_BATTER:'다음 타자',
  pickoff_normal:'견제 정상',pickoff_error:'견제 악송구',game_warmup:'연습투구',SH:'희생번트',
  light:'가벼운 투구',moderate:'적정 투구',full:'전력 투구',whiff:'헛스윙',weak:'약한 타구',medium:'보통 타구',hard:'강한 타구'
};

let state = loadState();
let currentView = 'home';
let gameTab = 'pitching';
let trainingTab = 'throwing';
let throwContext = 'warmup';
let trainingHitType = 'tee';
let logFilter = 'all';
let logDateFilter = 'all';
let selectedActivityDate = localDateKey();
let recordMode = 'game';
let analysisPeriod = '30';
let toastTimer = null;
let undoDeleteTimer = null;
let lastDeletedEventId = null;
let pendingInplay = false;
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
function eventActivityDate(e){
  const explicit=e?.metadata?.activityDate;if(explicit)return explicit;
  if(e?.gameId){const g=state?.games?.find(x=>x.id===e.gameId&&!x.deletedAt);if(g?.date)return g.date;}
  if(e?.trainingSessionId){const t=state?.trainingSessions?.find(x=>x.id===e.trainingSessionId&&!x.deletedAt);if(t?.date)return t.date;}
  return dateFromIso(e?.occurredAt||iso());
}
function isTrainingEvent(e){return String(e?.category||'').startsWith('training_');}
function eventMode(e){return isTrainingEvent(e)?'training':'game';}
function eventsForActivityDate(date,mode=null){return athleteEvents().filter(e=>eventActivityDate(e)===date&&(!mode||eventMode(e)===mode));}
function activityDateRangeStart(days){const d=new Date();d.setHours(12,0,0,0);d.setDate(d.getDate()-(days-1));return localDateKey(d);}
function dateShift(offset){ const d=new Date(); d.setHours(12,0,0,0); d.setDate(d.getDate()+offset); return localDateKey(d); }
function fmtLongDate(key){ if(!key) return ''; const [y,m,d]=key.split('-').map(Number); return `${y}.${String(m).padStart(2,'0')}.${String(d).padStart(2,'0')}`; }
function fmtShortDate(key){ if(!key) return ''; const [,m,d]=key.split('-'); return `${Number(m)}/${Number(d)}`; }
function timeText(value){ return new Date(value).toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit'}); }
function pct(v,d=1){ return v===null||v===undefined||Number.isNaN(v)?'—':`${(v*100).toFixed(d)}%`; }
function decimal(v){ return v===null||v===undefined||Number.isNaN(v)?'—':v.toFixed(3).replace(/^0/,''); }
function one(v){ const x=Math.round(Number(v||0)*100)/100; if(Number.isInteger(x))return String(x); return x.toFixed(2).replace(/0$/,''); }
function esc(v){ return String(v??'').replace(/[&<>'"]/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch])); }
function deepCopy(v){ return JSON.parse(JSON.stringify(v)); }
function mark(obj){ obj._updatedAt=now(); obj._dirty=true; return obj; }
function activeNotDeleted(list){ return list.filter(x=>!x.deletedAt); }
function byTime(a,b){ return eventActivityDate(a).localeCompare(eventActivityDate(b)) || new Date(a.occurredAt)-new Date(b.occurredAt) || Number(a.metadata?._seq||0)-Number(b.metadata?._seq||0) || String(a.id).localeCompare(String(b.id)); }

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
  const gameDateMap=new Map(raw.games.filter(x=>!x.deletedAt).map(x=>[x.id,x.date]));
  const trainingDateMap=new Map(raw.trainingSessions.filter(x=>!x.deletedAt).map(x=>[x.id,x.date]));
  for(const e of raw.events){
    e.metadata=e.metadata||{};
    if(!e.metadata.activityDate){
      e.metadata.activityDate=(e.gameId&&gameDateMap.get(e.gameId))||(e.trainingSessionId&&trainingDateMap.get(e.trainingSessionId))||dateFromIso(e.occurredAt);
      e._updatedAt=Math.max(Number(e._updatedAt||0),now());e._dirty=true;
    }
    if(!e.metadata.recordedAt)e.metadata.recordedAt=e.occurredAt;
  }
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

function newEvent({category,eventType,gameId=null,trainingSessionId=null,appearanceId=null,metadata={},activityDate=selectedActivityDate}){
  state.eventSeq=Number(state.eventSeq||0)+1;
  const recordedAt=iso();
  metadata={...metadata,activityDate,recordedAt,_seq:state.eventSeq};
  const e=mark({id:uuid(),athleteId:state.activeAthleteId,gameId,trainingSessionId,appearanceId,category,eventType,occurredAt:recordedAt,metadata,deletedAt:null});
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
  const arr=eventsForActivityDate(selectedActivityDate,recordMode).sort(byTime);
  const last=arr.at(-1); if(!last)return showToast('취소할 입력이 없습니다');
  softDeleteEvent(last.id,false); showToast('마지막 입력을 취소했습니다');
}

function derivePitching(events){
  const ev=activeNotDeleted(events).sort(byTime);
  const pitches=ev.filter(e=>e.category==='pitch');
  const tags=ev.filter(e=>e.category==='pitch_tag');
  const gameEvents=ev.filter(e=>e.category==='game_event');
  const gameThrows=ev.filter(e=>e.category==='game_throw');
  let balls=0,strikes=0,k=0,bb=0,hbp=0,battersFaced=0,firstPitchSamples=[],first=true,strikePitches=0,ballPitches=0;
  const inplayCounts={OUT:0,'1B':0,'2B':0,'3B':0,HR:0,ROE:0,SH:0,SF:0};
  const battedBallCounts={GB:0,LD:0,FB:0};
  const directionCounts={L:0,C:0,R:0};
  for(const e of ev){
    if(e.category==='pitch'){
      const r=e.eventType;
      if(STRIKE_RESULTS.has(r)) strikePitches++;
      else if(r==='ball') ballPitches++;
      if(first){ firstPitchSamples.push(STRIKE_RESULTS.has(r)); first=false; }
      let end=false;
      if(r==='ball'){ if(balls>=3){bb++;end=true;} else balls++; }
      else if(r==='called'||r==='swinging'){ if(strikes>=2){k++;end=true;} else strikes++; }
      else if(r==='foul'){ if(strikes<2) strikes++; }
      else if(r==='inplay'){
        end=true;
        const result=e.metadata?.inplayResult;
        if(result && inplayCounts[result]!==undefined) inplayCounts[result]++;
        const b=e.metadata?.battedBall;if(battedBallCounts[b]!==undefined)battedBallCounts[b]++;
        const d=e.metadata?.direction;if(directionCounts[d]!==undefined)directionCounts[d]++;
      }
      else if(r==='hbp'){ hbp++;end=true; }
      if(end){battersFaced++;balls=0;strikes=0;first=true;}
    }else if(e.category==='game_event'){
      // Legacy data remains readable. Quick mode no longer creates detailed game-state events.
      if(e.eventType==='IBB'){bb++;battersFaced++;balls=0;strikes=0;first=true;}
      if(e.eventType==='NEXT_BATTER'){battersFaced++;balls=0;strikes=0;first=true;}
    }
  }
  const pitchIds=new Set(pitches.map(p=>p.id));
  const validTags=tags.filter(t=>!t.metadata?.pitchEventId||pitchIds.has(t.metadata.pitchEventId));
  const pickoffNormal=gameThrows.filter(e=>e.eventType==='pickoff_normal').length;
  const pickoffErrors=gameThrows.filter(e=>e.eventType==='pickoff_error').length;
  const warmupThrows=gameThrows.filter(e=>e.eventType==='game_warmup').length;
  const gameThrowTLU=gameThrows.reduce((n,e)=>n+(GAME_THROW_WEIGHTS[e.eventType]||0),0);
  const gameTLU=pitches.length+gameThrowTLU;
  const hits=inplayCounts['1B']+inplayCounts['2B']+inplayCounts['3B']+inplayCounts.HR;
  const inPlay=Object.values(inplayCounts).reduce((a,b)=>a+b,0);
  const outs=inplayCounts.OUT+inplayCounts.SH+inplayCounts.SF;
  return {
    pitches,total:pitches.length,balls,strikes,k,bb,hbp,battersFaced,
    pitchesPerBatter:battersFaced?pitches.length/battersFaced:null,
    strikePitches,ballPitches,
    strikePct:pitches.length?strikePitches/pitches.length:null,
    firstPitchCount:firstPitchSamples.length,
    firstPitchStrikes:firstPitchSamples.filter(Boolean).length,
    firstPitchPct:firstPitchSamples.length?firstPitchSamples.filter(Boolean).length/firstPitchSamples.length:null,
    wp:validTags.filter(e=>e.eventType==='WP').length,pb:validTags.filter(e=>e.eventType==='PB').length,
    pickoffNormal,pickoffErrors,warmupThrows,gameThrowTLU,gameTLU,totalGameThrows:pitches.length+gameThrows.length,
    inplayCounts,battedBallCounts,directionCounts,hits,inPlay,outs,roe:inplayCounts.ROE
  };
}
function derivePitchingAggregate(events){
  const relevant=activeNotDeleted(events).filter(e=>['pitch','pitch_tag','game_event','game_throw'].includes(e.category));
  const groups=new Map();
  for(const e of relevant){const key=e.gameId||e.appearanceId||'loose';if(!groups.has(key))groups.set(key,[]);groups.get(key).push(e);}
  const out={
    total:0,k:0,bb:0,hbp:0,battersFaced:0,strikePitches:0,ballPitches:0,firstPitchCount:0,firstPitchStrikes:0,
    pickoffNormal:0,pickoffErrors:0,warmupThrows:0,gameThrowTLU:0,gameTLU:0,totalGameThrows:0,hits:0,inPlay:0,outs:0,roe:0,
    inplayCounts:{OUT:0,'1B':0,'2B':0,'3B':0,HR:0,ROE:0,SH:0,SF:0},
    battedBallCounts:{GB:0,LD:0,FB:0},directionCounts:{L:0,C:0,R:0}
  };
  for(const arr of groups.values()){
    const d=derivePitching(arr);
    for(const key of ['total','k','bb','hbp','battersFaced','strikePitches','ballPitches','firstPitchCount','firstPitchStrikes','pickoffNormal','pickoffErrors','warmupThrows','gameThrowTLU','gameTLU','totalGameThrows','hits','inPlay','outs','roe']) out[key]+=Number(d[key]||0);
    for(const key of Object.keys(out.inplayCounts))out.inplayCounts[key]+=Number(d.inplayCounts[key]||0);
    for(const key of Object.keys(out.battedBallCounts))out.battedBallCounts[key]+=Number(d.battedBallCounts[key]||0);
    for(const key of Object.keys(out.directionCounts))out.directionCounts[key]+=Number(d.directionCounts[key]||0);
  }
  out.strikePct=out.total?out.strikePitches/out.total:null;
  out.firstPitchPct=out.firstPitchCount?out.firstPitchStrikes/out.firstPitchCount:null;
  out.pitchesPerBatter=out.battersFaced?out.total/out.battersFaced:null;
  return out;
}
function calcHitting(events){
  const items=activeNotDeleted(events).filter(e=>e.category==='batting'); const c=Object.fromEntries(HIT_RESULTS.map(k=>[k,0]));
  items.forEach(e=>{if(c[e.eventType]!==undefined)c[e.eventType]++;}); const H=c['1B']+c['2B']+c['3B']+c.HR; const AB=H+c.SO+c.OUT+c.ROE; const PA=AB+c.BB+c.HBP+c.SF; const TB=c['1B']+2*c['2B']+3*c['3B']+4*c.HR; const avg=AB?H/AB:null; const den=AB+c.BB+c.HBP+c.SF; const obp=den?(H+c.BB+c.HBP)/den:null; const slg=AB?TB/AB:null; const ops=obp!==null&&slg!==null?obp+slg:null;
  const contactItems=items.filter(e=>['1B','2B','3B','HR','OUT','ROE','SF'].includes(e.eventType)&&e.metadata?.contact); const hard=contactItems.filter(e=>e.metadata.contact==='hard').length;
  return {...c,H,AB,PA,TB,avg,obp,slg,ops,kPct:PA?c.SO/PA:null,bbPct:PA?c.BB/PA:null,hardPct:contactItems.length?hard/contactItems.length:null};
}
function calcTrainingHits(events){ const a=activeNotDeleted(events).filter(e=>e.category==='training_hit'); const whiff=a.filter(e=>e.eventType==='whiff').length,hard=a.filter(e=>e.eventType==='hard').length,contact=a.length-whiff; return {total:a.length,whiff,hard,contact,contactPct:a.length?contact/a.length:null,hardPct:contact?hard/contact:null}; }
function calcThrowing(events){
  const a=activeNotDeleted(events);
  const training=a.filter(e=>e.category==='training_throw');
  const official=a.filter(e=>e.category==='pitch');
  const gameThrows=a.filter(e=>e.category==='game_throw');
  const c={light:0,moderate:0,full:0};
  let trainingTLU=0;
  training.forEach(e=>{const i=e.metadata?.intensity||e.eventType;c[i]=(c[i]||0)+1;trainingTLU+=WEIGHTS[i]||0;});
  const gameThrowTLU=gameThrows.reduce((n,e)=>n+(GAME_THROW_WEIGHTS[e.eventType]||0),0);
  const gameTLU=official.length+gameThrowTLU;
  const pickoffNormal=gameThrows.filter(e=>e.eventType==='pickoff_normal').length;
  const pickoffErrors=gameThrows.filter(e=>e.eventType==='pickoff_error').length;
  const warmupThrows=gameThrows.filter(e=>e.eventType==='game_warmup').length;
  return {
    training:training.length,game:official.length,officialPitches:official.length,gameThrows:gameThrows.length,
    total:training.length+official.length+gameThrows.length,
    tlu:trainingTLU+gameTLU,counts:c,trainingTLU,gameTLU,gameThrowTLU,pickoffNormal,pickoffErrors,warmupThrows
  };
}
function calcBase(events){ const a=activeNotDeleted(events).filter(e=>e.category==='baserunning'),sb=a.filter(e=>e.eventType==='SB').length,cs=a.filter(e=>e.eventType==='CS').length; return {sb,cs,pct:sb+cs?sb/(sb+cs):null}; }
function calcDefense(events){ const a=activeNotDeleted(events).filter(e=>e.category==='defense'),success=a.filter(e=>e.eventType==='SUCCESS').length,error=a.filter(e=>e.eventType==='ERROR').length; const tr=activeNotDeleted(events).filter(e=>e.category==='training_defense');return {game:a.length,success,error,training:tr.length,trainingSuccess:tr.filter(e=>e.eventType==='SUCCESS').length}; }
function rollingTLU(days){
  const start=activityDateRangeStart(days),end=localDateKey();
  return calcThrowing(athleteEvents().filter(e=>{const d=eventActivityDate(e);return d>=start&&d<=end;})).tlu;
}

function sessionEvents(session){ return athleteEvents().filter(e=>session.type==='game'?e.gameId===session.item.id:e.trainingSessionId===session.item.id); }
function appearanceEvents(appearance){ return athleteEvents().filter(e=>e.appearanceId===appearance.id); }
function inheritedRunners(a){ return [a.runner1,a.runner2,a.runner3].filter(Boolean).length; }
function showToast(msg){ const el=document.getElementById('toast');el.textContent=msg;el.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('show'),1400); }
function showUndoBar(msg){ const bar=document.getElementById('undoBar');document.getElementById('undoText').textContent=msg;bar.hidden=false;clearTimeout(undoDeleteTimer);undoDeleteTimer=setTimeout(()=>{bar.hidden=true;lastDeletedEventId=null;},5000); }
function go(view){ currentView=view;document.querySelectorAll('.view').forEach(v=>v.classList.toggle('active',v.dataset.view===view));document.querySelectorAll('[data-nav]').forEach(b=>b.classList.toggle('active',b.dataset.nav===view));const titles={home:'홈',record:'입력',logs:'기록',analysis:'분석',settings:'설정'};document.getElementById('pageTitle').textContent=titles[view]||'Baseball Tracker';render();window.scrollTo({top:0,behavior:'smooth'}); }
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

function ensureActivityContainer(type,date){
  if(type==='game'){
    let g=athleteGames().filter(x=>x.date===date).sort((a,b)=>Number(b._updatedAt||0)-Number(a._updatedAt||0))[0];
    if(!g){g=mark({id:uuid(),athleteId:state.activeAthleteId,date,opponent:'',venue:'',competition:'',ourScore:null,opponentScore:null,status:'completed',startedAt:iso(),endedAt:iso(),legacySource:null,deletedAt:null});state.games.push(g);}
    return g;
  }
  let t=athleteTrainings().filter(x=>x.date===date).sort((a,b)=>Number(b._updatedAt||0)-Number(a._updatedAt||0))[0];
  if(!t){t=mark({id:uuid(),athleteId:state.activeAthleteId,date,title:'훈련',status:'completed',startedAt:iso(),endedAt:iso(),legacySource:null,deletedAt:null});state.trainingSessions.push(t);}
  return t;
}
function renderHome(){
  const today=localDateKey(),todayEv=eventsForActivityDate(today),thr=calcThrowing(todayEv),hit=calcHitting(todayEv),base=calcBase(todayEv),def=calcDefense(todayEv),trainingHit=calcTrainingHits(todayEv);
  document.getElementById('homeThrows').textContent=thr.total;
  document.getElementById('homeTLU').textContent=one(thr.tlu);
  document.getElementById('homeGamePitches').textContent=thr.officialPitches;
  document.getElementById('homeTrainingThrows').textContent=thr.training;
  document.getElementById('homeGameTLU').textContent=one(thr.gameTLU);
  document.getElementById('homeTrainingTLU').textContent=one(thr.trainingTLU);
  document.getElementById('homePA').textContent=hit.PA;
  document.getElementById('homeTrainingSwings').textContent=trainingHit.total;
  document.getElementById('homeDefense').textContent=def.game+def.training;
  document.getElementById('homeSB').textContent=base.sb;
  const cap=document.getElementById('homeDateCaption');if(cap)cap.textContent=`${fmtLongDate(today)} · 실제 오늘 날짜 기준`;
}
function renderRecord(){
  const dateInput=document.getElementById('activityDateInput');if(dateInput&&dateInput.value!==selectedActivityDate)dateInput.value=selectedActivityDate;
  document.querySelectorAll('[data-record-mode]').forEach(b=>b.classList.toggle('active',b.dataset.recordMode===recordMode));
  renderWorkspace();
}
function renderWorkspace(){
  const game=recordMode==='game';
  document.getElementById('workspaceKicker').textContent=game?'GAME':'TRAINING';
  document.getElementById('workspaceTitle').textContent=game?'경기 기록':'훈련 기록';
  document.getElementById('workspaceMeta').textContent=`${fmtLongDate(selectedActivityDate)} · 선택 날짜에 저장`;
  document.getElementById('gameTabs').hidden=!game;document.getElementById('trainingTabs').hidden=game;
  const pitchBadge=document.getElementById('pitchDateBadge');if(pitchBadge)pitchBadge.textContent=fmtShortDate(selectedActivityDate);
  ['gamePitchPanel','gameHitPanel','gameDefensePanel','gameBasePanel','trainingThrowPanel','trainingHitPanel','trainingDefensePanel'].forEach(id=>document.getElementById(id).hidden=true);
  if(game){
    document.querySelectorAll('[data-game-tab]').forEach(b=>b.classList.toggle('active',b.dataset.gameTab===gameTab));
    const map={pitching:'gamePitchPanel',hitting:'gameHitPanel',baserunning:'gameBasePanel',defense:'gameDefensePanel'};document.getElementById(map[gameTab]).hidden=false;
    renderGameWorkspace(selectedActivityDate);
  }else{
    document.querySelectorAll('[data-training-tab]').forEach(b=>b.classList.toggle('active',b.dataset.trainingTab===trainingTab));
    const map={throwing:'trainingThrowPanel',hitting:'trainingHitPanel',defense:'trainingDefensePanel'};document.getElementById(map[trainingTab]).hidden=false;
    renderTrainingWorkspace(selectedActivityDate);
  }
}
function renderGameWorkspace(date){
  const events=eventsForActivityDate(date,'game'),hit=calcHitting(events),base=calcBase(events),def=calcDefense(events),p=derivePitching(events);
  document.getElementById('gameHitSummary').textContent=`${hit.PA} PA · AVG ${decimal(hit.avg)} · OPS ${decimal(hit.ops)}`;
  document.getElementById('gameBaseSummary').textContent=`SB ${base.sb} / CS ${base.cs} · ${pct(base.pct)}`;
  document.getElementById('gameDefenseSummary').textContent=`${def.game} events · E ${def.error}`;
  document.getElementById('liveBalls').textContent=p.balls??0;
  document.getElementById('liveStrikes').textContent=p.strikes??0;
  document.getElementById('livePitchCount').textContent=p.total;
  document.getElementById('liveGameTLU').textContent=one(p.gameTLU);
  document.getElementById('liveStrikePct').textContent=pct(p.strikePct);
  document.getElementById('liveFirstPitchPct').textContent=pct(p.firstPitchPct);
  document.getElementById('liveBF').textContent=p.battersFaced;
  document.getElementById('livePitchesPerBatter').textContent=p.pitchesPerBatter===null?'—':p.pitchesPerBatter.toFixed(2);
  document.getElementById('liveK').textContent=p.k;document.getElementById('liveBB').textContent=p.bb;document.getElementById('liveHBP').textContent=p.hbp;
  document.getElementById('livePickoffs').textContent=p.pickoffNormal;document.getElementById('livePickoffErrors').textContent=p.pickoffErrors;document.getElementById('liveWarmups').textContent=p.warmupThrows;
}
function renderTrainingWorkspace(date){
  const events=eventsForActivityDate(date,'training'),thr=calcThrowing(events),hit=calcTrainingHits(events),def=calcDefense(events);
  document.getElementById('trainingThrowSummary').textContent=`${thr.training} throws · ${one(thr.trainingTLU)} TLU`;
  document.getElementById('trainingHitSummary').textContent=`${hit.total} swings · Contact ${pct(hit.contactPct)} · Hard ${pct(hit.hardPct)}`;
  document.getElementById('trainingDefenseSummary').textContent=`${def.training} reps`;
}

function eventFilterMatch(e){
  if(logFilter==='all')return true;
  if(logFilter==='game')return eventMode(e)==='game';
  if(logFilter==='training')return eventMode(e)==='training';
  if(logFilter==='pitch')return ['pitch','pitch_tag','game_throw','training_throw'].includes(e.category);
  return e.category===logFilter;
}
function categoryLabel(c){ return ({pitch:'경기 투구',pitch_tag:'투구 태그',batting:'경기 타격',baserunning:'주루',defense:'경기 수비',training_throw:'훈련 투구',training_hit:'훈련 타격',training_defense:'훈련 수비',game_event:'이전 예외',game_throw:'견제·연습'})[c]||c; }
function eventDetail(e){
  const m=e.metadata||{};
  if(e.category==='training_throw')return `${contextLabel(m.context)} · ${one(WEIGHTS[m.intensity||e.eventType]||0)} TLU`;
  if(e.category==='game_throw')return `${one(GAME_THROW_WEIGHTS[e.eventType]||0)} TLU · Official Pitch 제외`;
  if(e.category==='training_hit')return `${trainingHitTypeLabel(m.type)} · ${EVENT_LABELS[e.eventType]||e.eventType}`;
  if(e.category==='training_defense')return `${drillLabel(m.drill)} · ${EVENT_LABELS[e.eventType]||e.eventType}`;
  if(e.category==='pitch'&&e.eventType==='inplay'){const bits=[m.inplayResult||''];if(m.battedBall)bits.push(m.battedBall);if(m.direction)bits.push(directionLabel(m.direction));return bits.filter(Boolean).join(' · ');}
  if(e.category==='pitch_tag')return '직전 투구에 연결';
  if(e.category==='batting'){const bits=[];if(m.contact)bits.push(`타구 ${contactLabel(m.contact)}`);if(m.battedBall)bits.push(m.battedBall);return bits.join(' · ');}
  if(e.category==='baserunning'&&m.from&&m.to)return `${m.from}루 → ${m.to===4?'홈':`${m.to}루`}`;
  return '';
}
function renderLogs(){
  const all=athleteEvents();
  const dates=[...new Set(all.map(eventActivityDate))].sort().reverse();
  const select=document.getElementById('logDateFilter');
  select.innerHTML='<option value="all">모든 날짜</option>'+dates.map(d=>`<option value="${d}">${fmtLongDate(d)}</option>`).join('');
  if(logDateFilter!=='all'&&!dates.includes(logDateFilter))logDateFilter='all';select.value=logDateFilter;
  document.querySelectorAll('[data-log-filter]').forEach(b=>b.classList.toggle('active',b.dataset.logFilter===logFilter));
  let ev=all.filter(eventFilterMatch);if(logDateFilter!=='all')ev=ev.filter(e=>eventActivityDate(e)===logDateFilter);
  ev.sort((a,b)=>eventActivityDate(b).localeCompare(eventActivityDate(a))||new Date(b.occurredAt)-new Date(a.occurredAt)||Number(b.metadata?._seq||0)-Number(a.metadata?._seq||0));
  document.getElementById('logCount').textContent=`${ev.length} events`;
  const el=document.getElementById('logList');if(!ev.length){el.innerHTML='<div class="session-item"><div class="session-copy"><b>표시할 기록이 없습니다</b><small>날짜나 필터를 바꾸거나 새 기록을 입력하세요.</small></div></div>';return;}
  let lastDate='',html='';
  for(const e of ev){
    const d=eventActivityDate(e);if(d!==lastDate){html+=`<div class="log-date">${fmtLongDate(d)}</div>`;lastDate=d;}
    const recordedDate=dateFromIso(e.occurredAt),audit=recordedDate===d?`입력 ${timeText(e.occurredAt)}`:`입력 ${fmtShortDate(recordedDate)} ${timeText(e.occurredAt)}`;
    html+=`<article class="log-item"><span class="log-time">${eventMode(e)==='game'?'경기':'훈련'}</span><span class="log-badge ${e.category}">${categoryLabel(e.category)}</span><span class="log-copy"><b>${esc(EVENT_LABELS[e.eventType]||e.eventType)}</b><small>${eventDetail(e)?esc(eventDetail(e)):''}</small><span class="log-recorded">${audit}</span></span><span class="log-actions"><button data-edit-event="${e.id}" type="button">수정</button><button class="delete" data-delete-event="${e.id}" type="button">삭제</button></span></article>`;
  }
  el.innerHTML=html;
}
function analysisEvents(){
  const ev=athleteEvents(),today=localDateKey();
  if(analysisPeriod==='all')return ev;
  if(analysisPeriod==='season'){const year=today.slice(0,4);return ev.filter(e=>eventActivityDate(e).startsWith(year));}
  const days=Number(analysisPeriod||30),start=activityDateRangeStart(days);return ev.filter(e=>{const d=eventActivityDate(e);return d>=start&&d<=today;});
}
function renderAnalysis(){
  document.querySelectorAll('[data-analysis-period]').forEach(b=>b.classList.toggle('active',b.dataset.analysisPeriod===analysisPeriod));
  const ev=analysisEvents(),pitch=derivePitchingAggregate(ev),hit=calcHitting(ev),base=calcBase(ev),def=calcDefense(ev),thr=calcThrowing(ev);
  const label=analysisPeriod==='season'?'SEASON TLU':analysisPeriod==='all'?'ALL-TIME TLU':`${analysisPeriod}-DAY TLU`;
  document.getElementById('analysisTLULabel').textContent=label;document.getElementById('analysisPeriodTLU').textContent=one(thr.tlu);document.getElementById('analysisPeriodThrows').textContent=thr.total;
  document.getElementById('analysisPitching').innerHTML=metricHtml([
    ['OFFICIAL PITCHES',pitch.total],['GAME TLU',one(pitch.gameTLU)],['BATTERS FACED',pitch.battersFaced],['P / BF',pitch.pitchesPerBatter===null?'—':pitch.pitchesPerBatter.toFixed(2)],['STRIKE%',pct(pitch.strikePct)],['1ST PITCH',pct(pitch.firstPitchPct)],['K',pitch.k],['BB',pitch.bb],['HBP',pitch.hbp],['HITS',pitch.hits],['PICKOFF',pitch.pickoffNormal],['PICKOFF ERR',pitch.pickoffErrors],['WARM-UP',pitch.warmupThrows]
  ]);
  document.getElementById('analysisHitting').innerHTML=metricHtml([['PA',hit.PA],['AVG',decimal(hit.avg)],['OBP',decimal(hit.obp)],['SLG',decimal(hit.slg)],['OPS',decimal(hit.ops)],['K%',pct(hit.kPct)],['BB%',pct(hit.bbPct)],['HARD',pct(hit.hardPct)],['H',hit.H]]);
  document.getElementById('analysisBaserunning').innerHTML=metricHtml([['SB',base.sb],['CS',base.cs],['SB%',pct(base.pct)]]);
  document.getElementById('analysisDefense').innerHTML=metricHtml([['GAME EVENTS',def.game],['SUCCESS',def.success],['ERROR',def.error],['TRAINING REPS',def.training],['TRAINING OK',def.trainingSuccess]]);
  renderTLUChart(ev);
}
function renderTLUChart(ev){
  const chart=document.getElementById('tluChart'),title=document.getElementById('analysisChartTitle'),today=localDateKey();
  let rows=[],monthly=false;
  if(analysisPeriod==='7'||analysisPeriod==='30'){
    const days=Number(analysisPeriod);for(let i=days-1;i>=0;i--){const key=dateShift(-i),dayEv=ev.filter(e=>eventActivityDate(e)===key);rows.push({key,tlu:calcThrowing(dayEv).tlu,label:fmtShortDate(key)});}title.textContent=`최근 ${days}일 TLU`;
  }else{
    monthly=true;const groups=new Map();for(const e of ev){const m=eventActivityDate(e).slice(0,7);if(!groups.has(m))groups.set(m,[]);groups.get(m).push(e);}rows=[...groups.entries()].sort((a,b)=>a[0].localeCompare(b[0])).slice(-18).map(([key,arr])=>({key,tlu:calcThrowing(arr).tlu,label:key.slice(2).replace('-','/')}));title.textContent=analysisPeriod==='season'?'시즌 월별 TLU':'월별 TLU';
  }
  const max=Math.max(1,...rows.map(x=>x.tlu));chart.classList.toggle('monthly',monthly);chart.innerHTML=rows.map(x=>`<div class="bar-item"><div class="bar-shell"><div class="bar" style="height:${Math.max(2,x.tlu/max*100)}%"></div></div><b>${one(x.tlu)}</b><small>${x.label}</small></div>`).join('')||'<div class="session-item"><div class="session-copy"><b>분석할 기록이 없습니다</b></div></div>';
}
function metricHtml(items){ return items.map(([l,v])=>`<div><span>${l}</span><strong>${v}</strong></div>`).join(''); }
function contextLabel(v){ return ({warmup:'몸풀기',catchplay:'캐치볼',defense:'수비송구',bullpen:'불펜',other:'기타'})[v]||v||'기타'; }
function trainingHitTypeLabel(v){ return ({tee:'티',toss:'토스',bp:'배팅볼',live:'라이브',other:'기타'})[v]||v||'기타'; }
function drillLabel(v){ return ({infield:'내야',outfield:'외야',throwing:'송구',catching:'캐치',footwork:'풋워크',other:'기타'})[v]||v||'기타'; }
function contactLabel(v){ return ({weak:'약',medium:'보통',hard:'강'})[v]||v||''; }
function directionLabel(v){ return ({L:'좌',C:'중',R:'우'})[v]||v||''; }
function render(){document.getElementById('todayLabel').textContent=fmtLongDate(localDateKey());renderAthletes();renderHome();renderRecord();renderLogs();renderAnalysis();renderCloudAuth();renderCloudStatus();refreshInstallUI();}
function recordPitch(result){
  if(recordMode!=='game')return;
  if(result==='inplay'){
    pendingInplay=true;document.getElementById('inplayBattedBall').value='';document.getElementById('inplayDirection').value='';openModal('inplayModal');return;
  }
  const g=ensureActivityContainer('game',selectedActivityDate);
  newEvent({category:'pitch',eventType:result,gameId:g.id,metadata:{},activityDate:selectedActivityDate});
  render();showToast(result==='hbp'?'사구 기록':'공식 투구 +1');
}
function recordGameThrow(type){
  if(recordMode!=='game'||!GAME_THROW_WEIGHTS[type])return;
  const g=ensureActivityContainer('game',selectedActivityDate);
  newEvent({category:'game_throw',eventType:type,gameId:g.id,metadata:{tlu:GAME_THROW_WEIGHTS[type]},activityDate:selectedActivityDate});
  render();showToast(`${EVENT_LABELS[type]||type} +${one(GAME_THROW_WEIGHTS[type])} TLU`);
}
function setInplay(result){
  if(!pendingInplay||recordMode!=='game'||!INPLAY_RESULTS.includes(result))return;
  const battedBall=document.getElementById('inplayBattedBall').value||null,direction=document.getElementById('inplayDirection').value||null,g=ensureActivityContainer('game',selectedActivityDate);
  newEvent({category:'pitch',eventType:'inplay',gameId:g.id,metadata:{inplayResult:result,battedBall,direction},activityDate:selectedActivityDate});
  pendingInplay=false;closeModal('inplayModal');render();showToast(`IN PLAY · ${result}`);
}
function recordHit(result){
  if(recordMode!=='game')return;const g=ensureActivityContainer('game',selectedActivityDate),contact=document.getElementById('hitContact').value,battedBall=document.getElementById('hitBattedBall').value;
  newEvent({category:'batting',eventType:result,gameId:g.id,metadata:{contact:contact||null,battedBall:battedBall||null},activityDate:selectedActivityDate});render();showToast(`${EVENT_LABELS[result]||result} 기록`);
}
function recordDefense(result){
  if(recordMode!=='game')return;const g=ensureActivityContainer('game',selectedActivityDate);
  newEvent({category:'defense',eventType:result,gameId:g.id,metadata:{position:document.getElementById('defensePosition').value,battedBall:document.getElementById('defenseBallType').value},activityDate:selectedActivityDate});render();showToast(EVENT_LABELS[result]||result);
}
function recordBase(result){
  if(recordMode!=='game')return;const g=ensureActivityContainer('game',selectedActivityDate);let from=Number(document.getElementById('baseFrom').value),to=Number(document.getElementById('baseTo').value);if(to<=from)to=Math.min(4,from+1);
  newEvent({category:'baserunning',eventType:result,gameId:g.id,metadata:{from,to},activityDate:selectedActivityDate});render();showToast(EVENT_LABELS[result]||result);
}
function recordTrainingThrow(intensity){
  if(recordMode!=='training')return;const t=ensureActivityContainer('training',selectedActivityDate);
  newEvent({category:'training_throw',eventType:intensity,trainingSessionId:t.id,metadata:{intensity,context:throwContext},activityDate:selectedActivityDate});render();showToast(`${EVENT_LABELS[intensity]} +1`);
}
function recordTrainingHit(quality){
  if(recordMode!=='training')return;const t=ensureActivityContainer('training',selectedActivityDate);
  newEvent({category:'training_hit',eventType:quality,trainingSessionId:t.id,metadata:{quality,type:trainingHitType},activityDate:selectedActivityDate});render();showToast('스윙 +1');
}
function recordTrainingDefense(result){
  if(recordMode!=='training')return;const t=ensureActivityContainer('training',selectedActivityDate);
  newEvent({category:'training_defense',eventType:result,trainingSessionId:t.id,metadata:{drill:document.getElementById('trainingDefenseDrill').value},activityDate:selectedActivityDate});render();showToast('수비 훈련 +1');
}

function editField(label,name,type,options,value){if(type==='select')return `<label>${label}<select name="${name}">${options.map(([v,l])=>`<option value="${esc(v)}" ${String(value)===String(v)?'selected':''}>${esc(l)}</option>`).join('')}</select></label>`;return `<label>${label}<input name="${name}" type="${type||'text'}" value="${esc(value??'')}" /></label>`;}
function openEventEdit(id){const e=state.events.find(x=>x.id===id&&!x.deletedAt);if(!e)return;document.getElementById('editEventId').value=id;let html='';if(e.category==='pitch')html=
  editField('투구 결과','eventType','select',PITCH_RESULTS.map(v=>[v,EVENT_LABELS[v]]),e.eventType)+
  editField('IN PLAY 결과','inplayResult','select',[['','해당 없음'],...INPLAY_RESULTS.map(v=>[v,EVENT_LABELS[v]||v])],e.metadata?.inplayResult||'')+
  editField('타구 형태','battedBall','select',[['','선택 안 함'],['GB','GB · 땅볼'],['LD','LD · 라인드라이브'],['FB','FB · 뜬공']],e.metadata?.battedBall||'')+
  editField('타구 방향','direction','select',[['','선택 안 함'],['L','좌'],['C','중'],['R','우']],e.metadata?.direction||'');
else if(e.category==='game_throw')html=editField('경기 부하 투구','eventType','select',[['pickoff_normal','견제 정상 · 0.85 TLU'],['pickoff_error','견제 악송구 · 0.85 TLU'],['game_warmup','연습투구 · 1.00 TLU']],e.eventType);
else if(e.category==='pitch_tag')html=editField('예외 태그','eventType','select',[['WP','WP'],['PB','PB'],['UNCUGHT3','낫아웃']],e.eventType);
else if(e.category==='game_event')html=editField('경기 이벤트','eventType','select',[['BALK','보크'],['IBB','무투구 IBB'],['PICKOFF','견제사'],['IR_SCORED','승계주자 득점'],['NEXT_BATTER','다음 타자']],e.eventType);
else if(e.category==='batting')html=editField('타석 결과','eventType','select',HIT_RESULTS.map(v=>[v,EVENT_LABELS[v]]),e.eventType)+editField('타구 강도','contact','select',[['','선택 안 함'],['weak','약'],['medium','보통'],['hard','강']],e.metadata?.contact||'')+editField('타구 형태','battedBall','select',[['','선택 안 함'],['GB','GB'],['LD','LD'],['FB','FB']],e.metadata?.battedBall||'');
else if(e.category==='baserunning')html=editField('결과','eventType','select',[['SB','도루 성공'],['CS','도루 실패']],e.eventType)+editField('출발 베이스','from','select',[['1','1루'],['2','2루'],['3','3루']],e.metadata?.from||1)+editField('도착 베이스','to','select',[['2','2루'],['3','3루'],['4','홈']],e.metadata?.to||2);
else if(e.category==='defense')html=editField('결과','eventType','select',[['SUCCESS','수비 성공'],['ERROR','실책'],['POSITION_CHANGE','포지션 변경']],e.eventType)+editField('포지션','position','select',['P','C','1B','2B','3B','SS','LF','CF','RF'].map(v=>[v,v]),e.metadata?.position||'SS')+editField('타구 형태','battedBall','select',[['GB','땅볼'],['FB','뜬공'],['LD','라인드라이브'],['OTHER','기타']],e.metadata?.battedBall||'GB');
else if(e.category==='training_throw')html=editField('강도','eventType','select',[['light','가벼운'],['moderate','적정'],['full','전력']],e.eventType)+editField('훈련 구분','context','select',[['warmup','몸풀기'],['catchplay','캐치볼'],['defense','수비송구'],['bullpen','불펜'],['other','기타']],e.metadata?.context||'other');
else if(e.category==='training_hit')html=editField('타구 결과','eventType','select',[['whiff','헛스윙'],['weak','약한 타구'],['medium','보통 타구'],['hard','강한 타구']],e.eventType)+editField('훈련 종류','type','select',[['tee','티'],['toss','토스'],['bp','배팅볼'],['live','라이브'],['other','기타']],e.metadata?.type||'other');
else if(e.category==='training_defense')html=editField('결과','eventType','select',[['SUCCESS','성공'],['MISS','실수']],e.eventType)+editField('훈련 종류','drill','select',[['infield','내야'],['outfield','외야'],['throwing','송구'],['catching','캐치'],['footwork','풋워크'],['other','기타']],e.metadata?.drill||'other');
html+=editField('활동 날짜','activityDate','date',[],eventActivityDate(e));document.getElementById('eventEditFields').innerHTML=html;openModal('eventEditModal');}
function toLocalInput(v){const d=new Date(v);const p=n=>String(n).padStart(2,'0');return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;}
function saveEventEdit(e){e.preventDefault();const id=document.getElementById('editEventId').value,ev=state.events.find(x=>x.id===id&&!x.deletedAt);if(!ev)return;const f=new FormData(e.target),newType=f.get('eventType')||ev.eventType;if(ev.category==='pitch'&&newType==='inplay'&&!f.get('inplayResult'))return showToast('IN PLAY 결과를 선택하세요');ev.eventType=newType;for(const k of ['inplayResult','contact','battedBall','direction','from','to','position','context','type','drill'])if(f.has(k)){let v=f.get(k);if(['from','to'].includes(k)&&v)v=Number(v);ev.metadata={...(ev.metadata||{}),[k]:v||null};}if(ev.category==='training_throw')ev.metadata.intensity=ev.eventType;if(ev.category==='training_hit')ev.metadata.quality=ev.eventType;const d=f.get('activityDate')||eventActivityDate(ev);ev.metadata={...(ev.metadata||{}),activityDate:d,recordedAt:ev.metadata?.recordedAt||ev.occurredAt};if(isTrainingEvent(ev)){const t=ensureActivityContainer('training',d);ev.trainingSessionId=t.id;ev.gameId=null;ev.appearanceId=null;}else{const g=ensureActivityContainer('game',d);ev.gameId=g.id;ev.trainingSessionId=null;}mark(ev);saveState();closeModal('eventEditModal');render();showToast('기록을 수정했습니다');}
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

function handleAction(action){if(action==='quick-game'){selectedActivityDate=localDateKey();recordMode='game';gameTab='pitching';return go('record');}if(action==='quick-training'){selectedActivityDate=localDateKey();recordMode='training';trainingTab='throwing';return go('record');}if(action==='undo-last-event')return undoLastEvent();}
document.addEventListener('click',e=>{
  const t=e.target.closest('button');if(!t)return;
  if(t.dataset.nav)return go(t.dataset.nav);
  if(t.dataset.action)return handleAction(t.dataset.action);
  if(t.dataset.closeModal)return closeModal(t.dataset.closeModal);
  if(t.dataset.recordMode){recordMode=t.dataset.recordMode;if(recordMode==='game'&&!['pitching','hitting','baserunning','defense'].includes(gameTab))gameTab='pitching';if(recordMode==='training'&&!['throwing','hitting','defense'].includes(trainingTab))trainingTab='throwing';renderRecord();return;}
  if(t.dataset.analysisPeriod){analysisPeriod=t.dataset.analysisPeriod;renderAnalysis();return;}
  if(t.dataset.athleteSelect)return switchAthlete(t.dataset.athleteSelect);
  if(t.dataset.gameTab){gameTab=t.dataset.gameTab;renderWorkspace();return;}
  if(t.dataset.trainingTab){trainingTab=t.dataset.trainingTab;renderWorkspace();return;}
  if(t.dataset.context){throwContext=t.dataset.context;document.querySelectorAll('[data-context]').forEach(b=>b.classList.toggle('active',b.dataset.context===throwContext));return;}
  if(t.dataset.trainingHitType){trainingHitType=t.dataset.trainingHitType;document.querySelectorAll('[data-training-hit-type]').forEach(b=>b.classList.toggle('active',b.dataset.trainingHitType===trainingHitType));return;}
  if(t.dataset.pitch)return recordPitch(t.dataset.pitch);
  if(t.dataset.gameThrow)return recordGameThrow(t.dataset.gameThrow);
  if(t.dataset.hit)return recordHit(t.dataset.hit);
  if(t.dataset.defense)return recordDefense(t.dataset.defense);
  if(t.dataset.base)return recordBase(t.dataset.base);
  if(t.dataset.throw)return recordTrainingThrow(t.dataset.throw);
  if(t.dataset.swing)return recordTrainingHit(t.dataset.swing);
  if(t.dataset.trainingDefense)return recordTrainingDefense(t.dataset.trainingDefense);
  if(t.dataset.inplay)return setInplay(t.dataset.inplay);
  if(t.dataset.logFilter){logFilter=t.dataset.logFilter;renderLogs();return;}
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
document.getElementById('workspaceLogsBtn').addEventListener('click',()=>{logDateFilter=selectedActivityDate;logFilter='all';go('logs');});
document.getElementById('activityDateInput').addEventListener('change',e=>{selectedActivityDate=e.target.value||localDateKey();renderRecord();});
document.getElementById('logDateFilter').addEventListener('change',e=>{logDateFilter=e.target.value;renderLogs();});
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
