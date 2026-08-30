import {configureAccountDB,closeDB,deleteAccountDatabase,getAll,putOne,putMany,getMeta,setMeta,snapshot,replaceSnapshot,mergeSnapshot,ensureInitialData,inspectLegacyData,snapshotOwnerIds,previewSnapshot,uuid,iso,todayKey,stamp} from './storage.js?v=7.10.0';
import {gamePitchingSummary,battingSummary,defenseSummary,baserunningSummary,trainingSummary,workloadSummary,todaySummary,totalTLU,analysisSnapshot,analysisMetricValue,analysisSeries,localDate,dateShift,OFFICIAL_PITCH_TYPES,STRIKE_PITCH_TYPES,GAME_TLU,round2,canonicalGameEvents,gameEventIntegrity} from './analytics.js?v=7.10.0';
import {anchoredAnalysisRange,activityDateNavigation,activityDatesInRange} from './analysis-scope.js?v=7.10.0';
import {newDefenseAction,newDefenseDraft,normalizeDefenseMetadata,serializeDefenseDraft,defenseMissingFields,defenseFlowWarnings,defenseActionLabel,defenseActionShortLabel,defenseActionStatus,defenseCardStatuses,defenseOverallTone,defenseThrowTLU,defenseOfficialText,defenseOutcomeText,defenseJudgmentSummary,defenseOfficialRecommendation,defenseThrowQuality} from './defense.js?v=7.10.0';
import {newDefenseTrainingAction,newDefenseTrainingDraft,normalizeDefenseTrainingRecord,serializeDefenseTrainingDraft,defenseTrainingActionCount,defenseTrainingActionLabel,defenseTrainingActionShortLabel,defenseTrainingModeLabel,defenseTrainingOutcomeError,defenseTrainingStats} from './defense-training.js?v=7.10.0';

const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const storeNames=['athletes','gameDays','batterFaced','plateAppearances','gameEvents','trainingSets'];
let data={athletes:[],gameDays:[],batterFaced:[],plateAppearances:[],gameEvents:[],trainingSets:[]};
let ui={view:'home',inputDate:todayKey(),inputMode:'game',domain:'pitching',historyAnchor:todayKey(),historyPeriod:'all',historyMode:'all',historyDomain:'all',historyStatus:'all',historyOwnSide:'all',historyOppSide:'all',historyDefenseStatus:'all',historyDefenseAction:'all',historyFieldResult:'all',historyThrowResult:'all',historyReceiveResult:'all',historyTagResult:'all',historyBaseResult:'all',historyOfficial:'all',historyRunResult:'all',analysisSource:'game',analysisAnchor:todayKey(),analysisPeriod:'1',analysisView:'game',analysisDomain:'pitching',analysisMetric:'strikePct',ownSide:'all',oppSide:'all',pendingBatterSide:null,pendingOwnPitchSide:null,pendingBatSide:null,pendingOppPitcherSide:null,inPlayContext:null,quantity:10,defenseTrainingMode:'simple',inputSummaryCollapsed:null};
let activeAthleteId=null,toastTimer=null,toastAction=null,undoTimer=null,lastDeleted=null,deferredInstallPrompt=null,syncTimer=null,staticEventsBound=false,pendingRestore=null,dayRolloverTimer=null,inputSummaryResizeTimer=null,calendarDate=todayKey();
let expandedBF=new Set(),expandedPA=new Set(),expandedDefense=new Set(),expandedBaserunning=new Set(),expandedTraining=new Set(),resumeContext=null,pitchEditId=null,pitchEditType=null,pitchEditResult=null,analysisDetailSeries=[],analysisConditionsInitialized=false,historyConditionsInitialized=false;
let defenseCreateDraft=null,defenseEditDraft=null,defenseEditId=null,defenseEditDirty=false;
let pitchEditSituation=null,recordEditSituation=null;
const gameSituationDrafts=new Map();
const defenseEditorState={create:{openActionId:null,chooseAfter:null,detailsOpen:new Set(),judgmentOpen:new Set()},edit:{openActionId:null,chooseAfter:null,detailsOpen:new Set(),judgmentOpen:new Set()}};
let defenseTrainingCreateDraft=null,defenseTrainingEditDraft=null,trainingEditRecord=null,trainingEditDirty=false;
const defenseTrainingEditorState={create:{openActionId:null,chooseAfter:null,outcomesOpen:false},edit:{openActionId:null,chooseAfter:null,outcomesOpen:false}};
const cloud={client:null,session:null,configured:false,syncing:false,syncPromise:null,lastSync:0,lastError:null,localOnlyCount:0,accountUid:null,activation:0,authLinkType:null,activationPromise:null};

const LABELS={
  ball:'BALL',called:'루킹',swinging:'헛스윙',foul:'파울',inplay:'IN PLAY',hbp:'HBP',pickoff_normal:'견제 정상',pickoff_error:'견제 악송구',game_warmup:'연습투구',pitching_exit:'강판',
  taken_ball:'볼 지켜봄',taken_strike:'스트라이크 지켜봄',swinging_strike:'헛스윙',in_play:'IN PLAY',
  fielding_play:'수비 플레이',steal_attempt:'도루 시도',advancement:'추가 진루',
  throwing:'투구',DRY_SWING:'빈스윙',TEE:'티',TOSS:'토스',BP:'배팅볼',MACHINE:'머신',LIVE:'라이브',FIELDING:'포구',THROWING:'송구',GROUND_BALL:'땅볼',FLY_BALL:'플라이',DOUBLE_PLAY:'병살',RELAY:'중계플레이',FOOTWORK:'풋워크',SCENARIO:'시나리오',OTHER:'기타',STEAL_START:'도루 스타트',LEAD_REACTION:'리드/반응',BASE_RUNNING:'베이스러닝',SLIDING:'슬라이딩',SPRINT:'스프린트'
};
const DOMAIN_LABEL={pitching:'투구',hitting:'타격',defense:'수비',baserunning:'주루'};
const BASERUNNING_NEXT_BASE={'1B':'2B','2B':'3B','3B':'HOME'};
const GAME_BASES=['1B','2B','3B'];
const PITCHING_OUT_RESULTS=new Set(['K','OUT','SH','SF']);
const UNKNOWN_RESULT='UNKNOWN';
const RELIEVED_RESULT='RELIEVED';
const INPUT_SUMMARY_MODE_KEY='baseball-diary:input-summary-mode';

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
function accountOwnerId(){const uid=cloud.accountUid||cloud.session?.user?.id;if(!uid)throw new Error('로그인이 필요합니다.');return uid;}
function ownsCurrentAccount(record){return !!record&&record.ownerId===cloud.accountUid;}
async function reloadData(){const uid=accountOwnerId();for(const s of storeNames){const rows=await getAll(s),foreign=rows.filter(row=>row.ownerId!==uid);if(foreign.length)console.error(`[야구일기] ${s}에서 현재 계정과 다른 로컬 기록 ${foreign.length}건을 격리했습니다.`);refreshDataStore(s,rows.filter(row=>row.ownerId===uid));}activeAthleteId=await getMeta('activeAthleteId',active(data.athletes)[0]?.id||null);if(!active(data.athletes).some(item=>item.id===activeAthleteId))activeAthleteId=active(data.athletes)[0]?.id||null;}
function markLocal(obj){return stamp(obj,{dirty:true});}
async function save(store,obj,{render=true,sync=true}={}){const uid=accountOwnerId();if(obj.ownerId&&obj.ownerId!==uid)throw new Error('다른 계정의 기록은 수정할 수 없습니다.');obj.ownerId=uid;markLocal(obj);await putOne(store,obj);const i=data[store].findIndex(x=>x.id===obj.id);if(i>=0)data[store][i]=obj;else data[store].push(obj);if(render)renderAll();if(sync)scheduleSync();return obj;}
function recordsFor(store){const own=active(data[store]).filter(ownsCurrentAccount);if(store==='gameEvents')return canonicalGameEvents({...data,gameEvents:own},{athleteId:activeAthleteId});return own.filter(x=>x.athleteId===activeAthleteId);}
function logIntegrity(context='runtime'){if(!activeAthleteId)return;const q=gameEventIntegrity(data,{athleteId:activeAthleteId});if(q.total)console.warn(`[야구일기] ${context}: 분석/기록에서 제외된 비정상 game event ${q.total}건 (orphan pitching ${q.orphanPitching}, orphan hitting ${q.orphanHitting})`,q.invalid);}
function getGameDay(date=ui.inputDate){return recordsFor('gameDays').find(x=>x.activityDate===date);}
async function ensureGameDay(date=ui.inputDate){let x=getGameDay(date);if(x)return x;x={id:uuid(),athleteId:activeAthleteId,activityDate:date,ownerId:accountOwnerId(),deletedAt:null,createdAt:iso(),updatedAt:iso(),clientUpdatedAt:Date.now(),dirty:true};await save('gameDays',x,{render:false});return x;}
function isUnknownParent(p){return !!p&&!p.completed&&p.result===UNKNOWN_RESULT;}
function isRelievedParent(p){return !!p&&!p.completed&&p.result===RELIEVED_RESULT;}
function currentBF(date=ui.inputDate){const list=recordsFor('batterFaced').filter(x=>x.activityDate===date).sort((a,b)=>b.sequenceNo-a.sequenceNo);const p=list[0];return p&&!p.completed&&!isUnknownParent(p)&&!isRelievedParent(p)?p:null;}
function currentPA(date=ui.inputDate){const list=recordsFor('plateAppearances').filter(x=>x.activityDate===date).sort((a,b)=>b.sequenceNo-a.sequenceNo);const p=list[0];return p&&!p.completed&&!isUnknownParent(p)?p:null;}
function resumedParent(kind){if(!resumeContext||resumeContext.kind!==kind)return null;const store=kind==='bf'?'batterFaced':'plateAppearances';const p=recordsFor(store).find(x=>x.id===resumeContext.id&&x.activityDate===ui.inputDate&&!x.completed);if(!p)resumeContext=null;return p||null;}
function inputBF(){return resumedParent('bf')||(ui.inputDate===todayKey()?currentBF():null);}
function inputPA(){return resumedParent('pa')||(ui.inputDate===todayKey()?currentPA():null);}
function bfEvents(id){return recordsFor('gameEvents').filter(e=>e.parentType==='batter_faced'&&e.parentId===id).sort((a,b)=>new Date(a.recordedAt)-new Date(b.recordedAt));}
function paEvents(id){return recordsFor('gameEvents').filter(e=>e.parentType==='plate_appearance'&&e.parentId===id).sort((a,b)=>new Date(a.recordedAt)-new Date(b.recordedAt));}
function validSide(value){return value==='R'||value==='L'?value:null;}
function hasPendingSide(value){return value!==null&&value!==undefined;}
function storedSide(metadata,key,fallback){return Object.prototype.hasOwnProperty.call(metadata||{},key)?validSide(metadata[key]):validSide(fallback);}
function eventMatchup(kind,event,parent){
  const metadata=event?.metadata||{};
  if(kind==='bf')return {pitcherSide:storedSide(metadata,'pitcherSide',parent?.pitcherSide),batterSide:storedSide(metadata,'batterSide',parent?.batterSide)};
  return {batterSide:storedSide(metadata,'batterSide',parent?.batterSide),pitcherSide:storedSide(metadata,'pitcherSide',parent?.pitcherSide)};
}
function currentPitchingMatchup(bf=inputBF()){
  const a=athlete(),last=bf?bfEvents(bf.id).at(-1):null,fallback=eventMatchup('bf',last,bf);
  return {
    pitcherSide:hasPendingSide(ui.pendingOwnPitchSide)?validSide(ui.pendingOwnPitchSide):(bf?fallback.pitcherSide:validSide(a?.throws)),
    batterSide:hasPendingSide(ui.pendingBatterSide)?validSide(ui.pendingBatterSide):(bf?fallback.batterSide:null)
  };
}
function currentBattingMatchup(pa=inputPA()){
  const a=athlete(),last=pa?paEvents(pa.id).at(-1):null,prev=lastParent('pa'),fallback=eventMatchup('pa',last,pa);
  return {
    batterSide:hasPendingSide(ui.pendingBatSide)?validSide(ui.pendingBatSide):(pa?fallback.batterSide:validSide(a?.bats)),
    pitcherSide:hasPendingSide(ui.pendingOppPitcherSide)?validSide(ui.pendingOppPitcherSide):(pa?fallback.pitcherSide:validSide(prev?.pitcherSide))
  };
}
function normalizeGameSituation(raw={}){
  const rawOuts=raw?.outs,outs=rawOuts===null||rawOuts===undefined||rawOuts===''?null:Number(rawOuts);
  const runners=Array.isArray(raw?.runners)?GAME_BASES.filter(base=>raw.runners.includes(base)):null;
  return {outs:[0,1,2].includes(outs)?outs:null,runners};
}
function cloneGameSituation(raw){const situation=normalizeGameSituation(raw);return {outs:situation.outs,runners:situation.runners===null?null:[...situation.runners]};}
function situationDraftKey(date=ui.inputDate){return `${activeAthleteId||''}:${date||''}`;}
function latestRecordedSituationEvent(date=ui.inputDate){return recordsFor('gameEvents').filter(event=>event.activityDate===date&&Object.prototype.hasOwnProperty.call(event.metadata||{},'situation')).sort((a,b)=>new Date(b.recordedAt)-new Date(a.recordedAt))[0]||null;}
function latestRecordedSituation(date=ui.inputDate){const latest=latestRecordedSituationEvent(date);return latest?cloneGameSituation(latest.metadata.situation):{outs:null,runners:null};}
function currentGameSituation(date=ui.inputDate){const key=situationDraftKey(date);if(!gameSituationDrafts.has(key))gameSituationDrafts.set(key,latestRecordedSituation(date));return gameSituationDrafts.get(key);}
function rememberGameSituation(raw,date=ui.inputDate){const situation=cloneGameSituation(raw);gameSituationDrafts.set(situationDraftKey(date),situation);return situation;}
function sameGameSituation(a,b){const left=normalizeGameSituation(a),right=normalizeGameSituation(b);return left.outs===right.outs&&JSON.stringify(left.runners)===JSON.stringify(right.runners);}
function pitchingOutTransition(result,raw){
  const previous=cloneGameSituation(raw);if(!PITCHING_OUT_RESULTS.has(result)||previous.outs===null)return null;
  const inningEnded=previous.outs===2,next=inningEnded?{outs:0,runners:[]}:{outs:previous.outs+1,runners:previous.runners===null?null:[...previous.runners]};
  return {previous,next,inningEnded};
}
function gameSituationSummary(raw){const situation=normalizeGameSituation(raw),outs=situation.outs===null?'아웃 미입력':`${situation.outs}아웃`,runners=situation.runners===null?'주자 미입력':situation.runners.length?situation.runners.map(base=>({'1B':'1루','2B':'2루','3B':'3루'}[base])).join('·'):'주자 없음';return `${outs} · ${runners}`;}
function gameSituationFieldsHtml(raw,{scope='shared',outsLabel='아웃 카운트',runnersLabel='주자 상황'}={}){
  const situation=normalizeGameSituation(raw),runners=situation.runners;
  const choice=(attribute,value,label,selected)=>`<button type="button" class="situation-choice ${selected?'active':''}" ${attribute}="${value}" data-situation-scope="${scope}" aria-pressed="${selected}"><b>${label}</b></button>`;
  return `<div class="game-situation-fields" data-game-situation-controls="${scope}"><div class="situation-field"><span>${outsLabel}</span><div class="situation-choice-row situation-outs">${choice('data-situation-outs','', '미입력',situation.outs===null)}${[0,1,2].map(value=>choice('data-situation-outs',String(value),`${value}아웃`,situation.outs===value)).join('')}</div></div><div class="situation-field"><span>${runnersLabel}</span><div class="situation-runner-choices"><div class="situation-choice-row situation-runner-state">${choice('data-situation-runner-state','missing','미입력',runners===null)}${choice('data-situation-runner-state','none','주자 없음',runners?.length===0)}</div><div class="situation-choice-row situation-runner-bases" aria-label="점유 베이스">${GAME_BASES.map(base=>choice('data-situation-runner-base',base,{'1B':'1루','2B':'2루','3B':'3루'}[base],!!runners?.includes(base))).join('')}</div></div></div></div>`;
}
function changedGameSituation(raw,button){
  const situation=cloneGameSituation(raw);
  if(button.hasAttribute('data-situation-outs')){const value=button.dataset.situationOuts;situation.outs=value===''?null:Number(value);}
  else if(button.dataset.situationRunnerState==='missing')situation.runners=null;
  else if(button.dataset.situationRunnerState==='none')situation.runners=[];
  else if(button.dataset.situationRunnerBase){const set=new Set(Array.isArray(situation.runners)?situation.runners:[]),base=button.dataset.situationRunnerBase;set.has(base)?set.delete(base):set.add(base);situation.runners=GAME_BASES.filter(value=>set.has(value));}
  return situation;
}
function refreshSituationControls(scope,raw){
  const situation=normalizeGameSituation(raw),root=document.querySelector(`[data-game-situation-controls="${scope}"]`);if(!root)return;
  root.querySelectorAll('[data-situation-outs]').forEach(button=>{const value=button.dataset.situationOuts,selected=value===''?situation.outs===null:situation.outs===Number(value);button.classList.toggle('active',selected);button.setAttribute('aria-pressed',String(selected));});
  root.querySelectorAll('[data-situation-runner-state]').forEach(button=>{const selected=button.dataset.situationRunnerState==='missing'?situation.runners===null:situation.runners?.length===0;button.classList.toggle('active',selected);button.setAttribute('aria-pressed',String(selected));});
  root.querySelectorAll('[data-situation-runner-base]').forEach(button=>{const selected=!!situation.runners?.includes(button.dataset.situationRunnerBase);button.classList.toggle('active',selected);button.setAttribute('aria-pressed',String(selected));});
}
function handleGameSituationChoice(button){
  const scope=button.dataset.situationScope;if(scope==='shared'){dismissToastAction();const situation=rememberGameSituation(changedGameSituation(currentGameSituation(),button));if(defenseCreateDraft&&defenseCreateDraft._context===situationDraftKey()&&!defenseCreateDraft.actions.length&&!defenseCreateDraft.flowEnded)defenseCreateDraft.situation=cloneGameSituation(situation);refreshSituationControls(scope,situation);return true;}
  if(scope==='pitch-edit'&&pitchEditSituation){pitchEditSituation=changedGameSituation(pitchEditSituation,button);refreshSituationControls(scope,pitchEditSituation);return true;}
  if(scope==='record-edit'&&recordEditSituation){recordEditSituation=changedGameSituation(recordEditSituation,button);refreshSituationControls(scope,recordEditSituation);return true;}
  return false;
}
function standaloneGameSituationHtml(){const situation=currentGameSituation();return `<section class="game-situation-card" aria-label="현재 경기 상황"><div class="game-situation-head"><span>현재 경기 상황</span><small>다음 기록에 적용</small></div>${gameSituationFieldsHtml(situation)}<p>상황이 바뀌면 다음 기록 전에 선택만 바꾸세요.</p></section>`;}
function matchupGameSituationHtml(kind=''){return `<div class="matchup-situation"><div class="game-situation-head"><span>현재 경기 상황</span><small>다음 공에 적용</small></div>${gameSituationFieldsHtml(currentGameSituation())}${kind==='pitching'?'<p class="situation-auto-note">타자 아웃은 다음 아웃 카운트에 자동 반영됩니다. 병살·주루사는 직접 조정하세요.</p>':''}</div>`;}
function requireOwnSide(matchup,kind){
  const side=kind==='bf'?matchup.pitcherSide:matchup.batterSide;if(side)return true;
  showToast(kind==='bf'?'투구 방향을 선택하세요':'타격 방향을 선택하세요','다음 공을 기록하기 전에 우·좌 방향을 선택해야 합니다.');return false;
}
function countBS(events,type='pitching'){
  let b=0,s=0;for(const e of events){if(type==='pitching'){if(e.eventType==='ball')b++;else if(['called','swinging','foul','inplay'].includes(e.eventType)){if(!(e.eventType==='foul'&&s>=2))s++;}}else{if(e.eventType==='taken_ball')b++;else if(['taken_strike','swinging_strike','foul','in_play'].includes(e.eventType)){if(!(e.eventType==='foul'&&s>=2))s++;}}}return {b,s};
}
function lastCompleted(kind,date=ui.inputDate){const list=kind==='bf'?recordsFor('batterFaced'):recordsFor('plateAppearances');return list.filter(x=>x.activityDate===date&&x.completed).sort((a,b)=>b.sequenceNo-a.sequenceNo)[0]||null;}
function lastParent(kind,date=ui.inputDate){const list=kind==='bf'?recordsFor('batterFaced'):recordsFor('plateAppearances');return list.filter(x=>x.activityDate===date).sort((a,b)=>b.sequenceNo-a.sequenceNo)[0]||null;}
function nextSequence(store,date){return Math.max(0,...data[store].filter(x=>x.athleteId===activeAthleteId&&x.activityDate===date).map(x=>Number(x.sequenceNo)||0))+1;}

async function init(){
  loadInputSummaryPreference();
  bindStaticEvents();registerPWA();
  $('#todayLabel').textContent=fmtDate(todayKey());
  calendarDate=todayKey();ui.inputDate=calendarDate;ui.analysisAnchor=calendarDate;ui.analysisPeriod='1';scheduleDayRollover();
  window.__BT_APP_READY__=true;
  const boot=$('#bootError');if(boot)boot.hidden=true;
  await initCloud();
}

function loadInputSummaryPreference(){
  try{const saved=localStorage.getItem(INPUT_SUMMARY_MODE_KEY);ui.inputSummaryCollapsed=saved==='collapsed'?true:saved==='expanded'?false:null;}catch{ui.inputSummaryCollapsed=null;}
}
function defaultInputSummaryCollapsed(){
  const canMatch=typeof window.matchMedia==='function',narrow=canMatch?window.matchMedia('(max-width: 900px)').matches:window.innerWidth<=900,compactLandscape=canMatch?window.matchMedia('(orientation: landscape) and (max-height: 520px) and (min-width: 720px)').matches:window.innerWidth>=720&&window.innerHeight<=520&&window.innerWidth>window.innerHeight;
  return narrow&&!compactLandscape;
}
function inputSummaryIsCollapsed(){return ui.inputSummaryCollapsed===null?defaultInputSummaryCollapsed():ui.inputSummaryCollapsed;}
function toggleInputSummary(){
  ui.inputSummaryCollapsed=!inputSummaryIsCollapsed();
  try{localStorage.setItem(INPUT_SUMMARY_MODE_KEY,ui.inputSummaryCollapsed?'collapsed':'expanded');}catch{}
  renderInputSummary();
}
function renderResponsiveInputSummary(){
  if(ui.inputSummaryCollapsed!==null)return;clearTimeout(inputSummaryResizeTimer);inputSummaryResizeTimer=setTimeout(renderInputSummary,120);
}
function handleDayRollover(){
  const nextDate=todayKey();if(nextDate===calendarDate)return;
  const previousDate=calendarDate,followedInputDate=ui.inputDate===previousDate&&!resumeContext,followedHistoryDate=ui.historyAnchor===previousDate,followedAnalysisDate=ui.analysisAnchor===previousDate;
  calendarDate=nextDate;if(followedInputDate)ui.inputDate=nextDate;if(followedHistoryDate)ui.historyAnchor=nextDate;if(followedAnalysisDate)ui.analysisAnchor=nextDate;renderAll();
}
function scheduleDayRollover(){
  clearTimeout(dayRolloverTimer);const now=new Date(),next=new Date(now);next.setDate(next.getDate()+1);next.setHours(0,0,1,0);
  dayRolloverTimer=setTimeout(()=>{handleDayRollover();scheduleDayRollover();},Math.max(1000,next.getTime()-now.getTime()));
}

function setView(v){ui.view=v;$$('.view').forEach(x=>x.classList.toggle('active',x.dataset.view===v));$$('.bottom-nav button').forEach(x=>x.classList.toggle('active',x.dataset.nav===v));const titles={home:'오늘의 기록',input:'한 공 기록하기',history:'차곡차곡 기록',analysis:'성장 보기',settings:'야구일기 설정'};$('#pageTitle').textContent=titles[v]||'';if(v==='history')renderHistory();if(v==='analysis')renderAnalysis();window.scrollTo({top:0,behavior:'smooth'});}
function renderAll(){renderHeader();renderHome();renderInput();renderHistory();if(ui.view==='analysis')renderAnalysis();renderSettings();}
function renderHeader(){const a=athlete();$('#activeAthleteName').textContent=a?.name||'선수';$('#athleteInitial').textContent=(a?.name||'P').slice(0,1);$('#todayLabel').textContent=fmtDate(todayKey());}
function dismissToastAction({hide=true}={}){if(!toastAction)return;toastAction=null;clearTimeout(toastTimer);const el=$('#toast');el?.classList.remove('actionable');if(hide)el?.classList.remove('show');}
function showToast(title,message='',type='',action=null){
  const el=$('#toast'),nextAction=action&&typeof action.run==='function'?action:null;toastAction=nextAction;el.className=`toast show ${type} ${nextAction?'actionable':''}`;el.innerHTML=`<div class="toast-copy"><b>${esc(title)}</b>${message?`<span>${esc(message)}</span>`:''}</div>${nextAction?`<button type="button" data-toast-action>${esc(nextAction.label||'확인')}</button>`:''}`;
  if(type==='complete'){const panel=$('.entry-panel');panel?.classList.add('completion-flash');setTimeout(()=>panel?.classList.remove('completion-flash'),360);}clearTimeout(toastTimer);toastTimer=setTimeout(()=>{el.classList.remove('show','actionable');if(toastAction===nextAction)toastAction=null;},nextAction?4500:1200);
}
function runToastAction(){const action=toastAction;if(!action)return;toastAction=null;clearTimeout(toastTimer);$('#toast')?.classList.remove('show','actionable');action.run();}
function showModal(id){$('#'+id).hidden=false;}function hideModal(id){$('#'+id).hidden=true;}

function renderHome(){
  const a=athlete();if(!a)return;const date=todayKey();const s=todaySummary(data,{athleteId:a.id,date});
  $('#homeDateCaption').textContent=`${fmtDate(date)} · ${a.name}`;$('#homeTotalTLU').textContent=n2(s.totalTLU);$('#homeGameTLU').textContent=n2(s.gameTLU);$('#homeTrainingTLU').textContent=n2(s.training.tlu);$('#homeOfficialPitches').textContent=s.game.pitching.officialPitches;const defenseTrainingThrows=s.training.defenseThrowCount||0;$('#homeTotalThrows').textContent=s.game.pitching.totalGameThrows+s.game.defense.throwAttempts+(s.training.byDomain.pitching?.volume||0)+defenseTrainingThrows;
  const p=s.game.pitching,h=s.game.hitting,d=s.game.defense,b=s.game.baserunning;
  $('#homeGameSummary').innerHTML=[
    ['투구',`${p.officialPitches} pitches · Strike ${pct(p.strikePct,0)}`],['타격',`${h.PA} PA · ${h.H} H · OPS ${h.PA?dec(h.OPS):'—'}`],['수비',`${d.plays} plays · Secure ${pct(d.securePct,0)}`],['주루',`SB ${b.sb} · CS ${b.cs}`]
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
  const total=totalTLU(data,{athleteId:a.id,date:ui.inputDate});let kicker='',compact=[],details='';
  if(ui.inputMode==='game'&&ui.domain==='pitching'){
    const s=gamePitchingSummary(data,{athleteId:a.id,date:ui.inputDate}),prev=lastCompleted('bf');kicker='PITCHING';compact=[['투구수',s.officialPitches],['GAME TLU',n2(s.gameTLU)],['STRIKE',pct(s.strikePct,0)],['BF',s.bf]];
    details=`<div class="big-stat"><strong>${s.officialPitches}</strong><span>OFFICIAL PITCHES</span></div><div class="big-stat"><strong>${n2(s.gameTLU)}</strong><span>GAME TLU · SELECTED DATE TOTAL ${n2(total)}</span></div>
    ${perfRows([['STRIKE',pct(s.strikePct,0)],['1ST STRIKE',pct(s.firstPitchStrikePct,0)],['BF',s.bf],['강판 중단',s.relievedBF||0],['K',s.k],['BB',s.bb],['HBP',s.hbp],['P / BF',s.pitchesPerBatter?Number(s.pitchesPerBatter).toFixed(2):'—'],['PICKOFF',`${s.pickoffs} / ERR ${s.pickoffErrors}`],['WARM-UP',s.warmups]])}
    ${prev?`<div class="prev-result"><span>직전 타자</span><b>#${prev.sequenceNo} · ${bfEvents(prev.id).length}구 · ${esc(prev.result||'완료')}</b></div>`:''}`;
  } else if(ui.inputMode==='game'&&ui.domain==='hitting'){
    const s=battingSummary(data,{athleteId:a.id,date:ui.inputDate}),prev=lastCompleted('pa');kicker='BATTING';compact=[['PA',s.PA],['H',s.H],['OPS',s.PA?dec(s.OPS):'—'],['SWINGS',s.swings]];
    details=`<div class="big-stat"><strong>${s.PA}</strong><span>PLATE APPEARANCES</span></div><div class="big-stat"><strong>${s.H}</strong><span>HITS</span></div>
    ${perfRows([['AVG',dec(s.AVG)],['OBP',dec(s.OBP)],['SLG',dec(s.SLG)],['OPS',s.PA?dec(s.OPS):'—'],['SWINGS',s.swings],['WHIFF',s.whiffs],['CONTACT',pct(s.contactPct,0)],['SO',s.SO]])}
    ${prev?`<div class="prev-result"><span>직전 타석</span><b>#${prev.sequenceNo} · ${paEvents(prev.id).length}구 · ${esc(prev.result||'완료')}</b></div>`:''}`;
  } else if(ui.inputMode==='game'&&ui.domain==='defense'){
    const s=defenseSummary(data,{athleteId:a.id,date:ui.inputDate});kicker='DEFENSE';compact=[['PLAYS',s.plays],['SECURE',pct(s.securePct,0)],['THROWS',s.throwAttempts],['THROW TLU',n2(s.throwTLU)]];details=`<div class="big-stat"><strong>${s.plays}</strong><span>DEFENSIVE PLAYS</span></div>${perfRows([['CLEAN',pct(s.cleanPct,0)],['SECURE',pct(s.securePct,0)],['ON-TARGET',pct(s.onTargetPct,0)],['CATCHABLE',pct(s.catchablePct,0)],['RECEIVE',pct(s.receivePct,0)],['COVER',pct(s.coverPct,0)],['DECISION',pct(s.judgmentAppropriatePct,0)],['수비 송구 TLU',n2(s.throwTLU)]])}`;
  } else if(ui.inputMode==='game'&&ui.domain==='baserunning'){
    const s=baserunningSummary(data,{athleteId:a.id,date:ui.inputDate});kicker='BASERUNNING';compact=[['ATTEMPTS',s.attempts],['SB',s.sb],['CS',s.cs],['SUCCESS',pct(s.sbPct,0)]];details=`<div class="big-stat"><strong>${pct(s.sbPct,0)}</strong><span>SB SUCCESS</span></div>${perfRows([['SB',s.sb],['CS',s.cs],['ATTEMPTS',s.attempts]])}`;
  } else {
    const s=trainingSummary(data,{athleteId:a.id,date:ui.inputDate,domain:ui.domain}),d=s.byDomain[ui.domain]||{sets:0,volume:0,tlu:0};
    kicker=`TRAINING · ${DOMAIN_LABEL[ui.domain].toUpperCase()}`;if(ui.domain==='defense'){compact=[['REPS',d.volume||0],['ACTION REPS',s.defenseActionReps||0],['THROWS',s.defenseThrowCount||0],['THROW TLU',n2(d.tlu||0)]];details=`<div class="big-stat"><strong>${d.volume||0}</strong><span>DEFENSE REPS</span></div><div class="big-stat"><strong>${s.defenseActionReps||0}</strong><span>ACTION REPS · 시나리오 동작 반복량</span></div>${perfRows([['SETS',d.sets||0],['간단 / 시나리오',`${s.defenseSimpleSets||0} / ${s.defenseScenarioSets||0}`],['THROWS',s.defenseThrowCount||0],['THROW TLU',n2(d.tlu||0)],['TLU / REP',s.defenseTluPerRep==null?'—':n2(s.defenseTluPerRep)],['평가 REPS',s.defenseOutcomes?.evaluated||0]])}`;}else{compact=[['VOLUME',d.volume||0],[`${DOMAIN_LABEL[ui.domain]} TLU`,n2(d.tlu||0)],['TOTAL TLU',n2(total)],['SETS',d.sets||0]];details=`<div class="big-stat"><strong>${d.volume||0}</strong><span>${trainingUnitLabel(ui.domain)}</span></div><div class="big-stat"><strong>${n2(d.tlu||0)}</strong><span>${DOMAIN_LABEL[ui.domain]} TLU · SELECTED DATE TOTAL ${n2(total)}</span></div>${trainingBreakdownHtml(s)}`;}
  }
  const collapsed=inputSummaryIsCollapsed();el.classList.toggle('is-collapsed',collapsed);el.innerHTML=performanceSummaryHtml({kicker,compact,details,collapsed});
}
function performanceSummaryHtml({kicker,compact,details,collapsed}){return `<div class="performance-title"><div><p class="section-kicker">${esc(kicker)}</p><h2>${fmtDate(ui.inputDate)}</h2></div><button type="button" class="input-summary-toggle" data-toggle-input-summary aria-expanded="${!collapsed}" aria-controls="inputSummaryDetails"><span>${collapsed?'상세 보기':'접기'}</span><i aria-hidden="true">${collapsed?'⌄':'⌃'}</i></button></div><div class="performance-compact" ${collapsed?'':'hidden'}>${compactStats(compact)}</div><div id="inputSummaryDetails" class="performance-details" ${collapsed?'hidden':''}>${details}</div>`;}
function compactStats(rows){return rows.map(([k,v])=>`<div class="compact-stat"><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join('');}
function perfRows(rows){return rows.map(([k,v])=>`<div class="perf-row"><span>${k}</span><b>${v}</b></div>`).join('');}
function trainingUnitLabel(d){return d==='pitching'?'THROWS':d==='hitting'?'SWINGS':'REPS';}
function trainingBreakdownHtml(s){const entries=Object.entries(s.byType).sort((a,b)=>b[1]-a[1]).slice(0,8);return entries.length?entries.map(([k,v])=>`<div class="perf-row"><span>${esc(LABELS[k]||k)}</span><b>${v}</b></div>`).join(''):'<div class="prev-result"><span>아직 기록 없음</span><b>오른쪽에서 훈련 세트를 추가하세요.</b></div>';}
function sideButtonsPitching(bf){const matchup=currentPitchingMatchup(bf);return `<section class="matchup-context" aria-label="다음 공의 경기 조건"><div class="matchup-context-head"><span>현재 투타 조건</span><small>선택한 조건은 다음 공부터 적용됩니다</small></div><div class="matchup-grid"><div class="field-group"><span>투구 방향</span><div class="side-context">${sideBtn('pitcher','R','우투',matchup.pitcherSide)}${sideBtn('pitcher','L','좌투',matchup.pitcherSide)}</div></div><div class="field-group"><span>상대 타자</span><div class="side-context">${sideBtn('batter','','미입력',matchup.batterSide)}${sideBtn('batter','R','우타',matchup.batterSide)}${sideBtn('batter','L','좌타',matchup.batterSide)}</div></div></div>${matchupGameSituationHtml('pitching')}</section>`;}
function sideButtonsBatting(pa){const matchup=currentBattingMatchup(pa);return `<section class="matchup-context" aria-label="다음 공의 경기 조건"><div class="matchup-context-head"><span>현재 투타 조건</span><small>선택한 조건은 다음 공부터 적용됩니다</small></div><div class="matchup-grid"><div class="field-group"><span>타격 방향</span><div class="side-context">${sideBtn('bat','R','우타',matchup.batterSide)}${sideBtn('bat','L','좌타',matchup.batterSide)}</div></div><div class="field-group"><span>상대 투수</span><div class="side-context">${sideBtn('oppPitcher','','미입력',matchup.pitcherSide)}${sideBtn('oppPitcher','R','우투',matchup.pitcherSide)}${sideBtn('oppPitcher','L','좌투',matchup.pitcherSide)}</div></div></div>${matchupGameSituationHtml()}</section>`;}
function sideBtn(kind,val,label,current){const selected=(current||'')===val;return `<button type="button" data-side-kind="${kind}" data-side-value="${val}" class="${selected?'active':''}" aria-pressed="${selected}">${label}</button>`;}

function renderInputForm(){const el=$('#inputForm');if(ui.inputMode==='game'){if(ui.domain==='pitching')el.innerHTML=gamePitchingForm();else if(ui.domain==='hitting')el.innerHTML=gameBattingForm();else if(ui.domain==='defense')el.innerHTML=gameDefenseForm();else el.innerHTML=gameBaserunningForm();}else{el.innerHTML=trainingForm(ui.domain);}bindDynamicFormEvents();}
function countDisplay(bs){return `<div class="pitch-count-area"><div class="count-balls"><span class="count-label ball-label">B</span>${[1,2,3,4].map(i=>`<i class="count-dot ball-dot ${i<=bs.b?'on':''}">${i}</i>`).join('')}<span class="count-label strike-label">S</span>${[1,2].map(i=>`<i class="count-dot strike-dot ${i<=bs.s?'on':''}">${i}</i>`).join('')}</div>${bs.s>=2?'<div class="count-hint">2 STRIKES · 파울은 스트라이크 카운트 유지</div>':''}</div>`;}
function gamePitchingForm(){const bf=inputBF(),bs=bf?countBS(bfEvents(bf.id),'pitching'):{b:0,s:0},resuming=!!(resumeContext?.kind==='bf'&&bf?.id===resumeContext.id);return `<div class="entry-title"><div><p class="section-kicker">OFFICIAL PITCH</p><h2>PITCHING</h2><p>${resuming?`타자 #${bf.sequenceNo} 기록을 이어서 입력 중입니다.`:'타자에게 던진 공은 1구 = 1.00 TLU'}</p></div><span class="microcopy ${resuming?'editing-copy':''}">${bf?`타자 #${bf.sequenceNo}${resuming?' · 수정 중':''}`:'새 타자'}</span></div>${sideButtonsPitching(bf)}<section class="pitch-entry-card" aria-label="투구 결과 입력">${countDisplay(bs)}<button class="pitch-main ball-action press-action" data-pitch="ball"><b>BALL</b><span>Official pitch +1</span></button><div class="strike-grid"><button class="action-btn strike press-action" data-pitch="called"><b>루킹</b><span>CALLED</span></button><button class="action-btn strike press-action" data-pitch="swinging"><b>헛스윙</b><span>SWINGING</span></button><button class="action-btn strike press-action" data-pitch="foul"><b>파울</b><span>FOUL</span></button></div><div class="terminal-grid"><button class="action-btn inplay press-action" data-pitch="inplay"><b>IN PLAY</b><span>결과 선택</span></button><button class="action-btn hbp press-action" data-pitch="hbp"><b>HBP</b><span>타자 종료</span></button></div></section>${bf?`<button type="button" class="unknown-next-btn" data-close-parent-unknown="bf:${bf.id}"><b>? 결과 미상으로 다음 타자</b><span>현재까지 입력한 투구는 보존됩니다.</span></button>`:''}<button type="button" class="pitching-exit-btn" data-pitching-exit><span class="exit-mark" aria-hidden="true">↘</span><span><b>강판 기록</b><small>${bf?'현재 타자까지 입력한 공은 그대로 보존됩니다.':'투구 입력을 종료한 시점을 기록합니다.'}</small></span></button><div class="arm-load-panel"><div class="section-divider"><span>ARM LOAD · 타자 상대 투구와 별도</span></div><div class="load-actions"><button class="press-action" data-game-throw="pickoff_normal"><b>견제 정상</b><span>+0.85 TLU</span></button><button class="press-action" data-game-throw="pickoff_error"><b>견제 악송구</b><span>+0.85 TLU</span></button><button class="press-action" data-game-throw="game_warmup"><b>연습투구</b><span>+1.00 TLU</span></button></div></div>`;}
function gameBattingForm(){const pa=inputPA(),bs=pa?countBS(paEvents(pa.id),'batting'):{b:0,s:0},resuming=!!(resumeContext?.kind==='pa'&&pa?.id===resumeContext.id);return `<div class="entry-title"><div><p class="section-kicker">PLATE APPEARANCE</p><h2>BATTING</h2><p>${resuming?`타석 #${pa.sequenceNo} 기록을 이어서 입력 중입니다.`:'매 구 반응은 빠르게 기록하고 영상에서 세부정보를 보완할 수 있습니다.'}</p></div><span class="microcopy ${resuming?'editing-copy':''}">${pa?`타석 #${pa.sequenceNo}${resuming?' · 수정 중':''}`:'새 타석'}</span></div>${sideButtonsBatting(pa)}<section class="pitch-entry-card" aria-label="타격 투구 결과 입력">${countDisplay(bs)}<button class="pitch-main ball-action press-action" data-bat-pitch="taken_ball"><b>볼 지켜봄</b><span>TAKEN BALL</span></button><div class="strike-grid"><button class="action-btn strike press-action" data-bat-pitch="taken_strike"><b>스트라이크 지켜봄</b><span>CALLED</span></button><button class="action-btn strike press-action" data-bat-pitch="swinging_strike"><b>헛스윙</b><span>WHIFF</span></button><button class="action-btn strike press-action" data-bat-pitch="foul"><b>파울</b><span>FOUL</span></button></div><div class="terminal-grid"><button class="action-btn inplay press-action" data-bat-pitch="in_play"><b>IN PLAY</b><span>결과 선택</span></button><button class="action-btn hbp press-action" data-bat-pitch="hbp"><b>HBP</b><span>타석 종료</span></button></div></section>${pa?`<button type="button" class="unknown-next-btn" data-close-parent-unknown="pa:${pa.id}"><b>? 결과 미상으로 다음 타석</b><span>현재까지 입력한 투구 반응은 보존됩니다.</span></button>`:''}`;}
function defaultDefensePosition(){const value=String(athlete()?.position||'').toUpperCase();return ['P','C','1B','2B','3B','SS','LF','CF','RF'].includes(value)?value:'SS';}
function ensureDefenseCreateDraft(){
  const context=`${activeAthleteId||''}:${ui.inputDate}`;
  if(!defenseCreateDraft||defenseCreateDraft._context!==context){const a=athlete(),side=a?.throws==='S'?null:(a?.throws||null);defenseCreateDraft=newDefenseDraft({position:defaultDefensePosition(),throwSide:side});defenseCreateDraft.situation=cloneGameSituation(currentGameSituation());defenseCreateDraft._context=context;resetDefenseEditorState('create');}
  else if(!defenseCreateDraft.actions.length&&!defenseCreateDraft.flowEnded)defenseCreateDraft.situation=cloneGameSituation(currentGameSituation());
  return defenseCreateDraft;
}
function resetDefenseEditorState(mode){const state=defenseEditorState[mode];state.openActionId=null;state.chooseAfter=null;state.detailsOpen.clear();state.judgmentOpen.clear();}
function defenseDraft(mode){return mode==='edit'?defenseEditDraft:ensureDefenseCreateDraft();}
function defenseRoot(mode){return $(mode==='edit'?'#defenseEditEditor':'#defenseCreateEditor');}
function gameDefenseForm(){const draft=ensureDefenseCreateDraft();return `<div class="entry-title"><div><p class="section-kicker">DEFENSIVE PLAY</p><h2>수비 플레이</h2><p>우리 선수의 동작을 실제 순서대로 하나씩 이어서 기록합니다.</p></div><span class="microcopy">동작 ${draft.actions.length}개</span></div><div id="defenseCreateEditor" class="defense-editor">${defenseEditorHtml('create')}</div>`;}

function defensePositionOptions(current){return ['P','C','1B','2B','3B','SS','LF','CF','RF'].map(value=>`<option value="${value}" ${current===value?'selected':''}>${value}</option>`).join('');}
function defenseChoiceButtons(mode,action,key,options,current,{judgment=false,play=false}={}){
  return `<div class="defense-choice-grid ${options.length>4?'dense':''}">${options.map(([value,label,sub])=>{const selected=String(current??'')===String(value);const attrs=play?`data-defense-play-key="${key}"`:`data-defense-action-id="${action?.id||''}" ${judgment?'data-defense-judgment-key':'data-defense-action-key'}="${key}"`;return `<button type="button" class="defense-choice ${selected?'active':''}" ${attrs} data-defense-value="${esc(value)}" aria-pressed="${selected}"><b>${esc(label)}</b>${sub?`<small>${esc(sub)}</small>`:''}</button>`;}).join('')}</div>`;
}
function defenseFieldGroup(label,content,extra=''){return `<div class="defense-field-group ${extra}"><span>${esc(label)}</span>${content}</div>`;}
function defenseActionSummary(action){
  const status=defenseActionStatus(action),parts=[];
  if(action.type==='field'){if(action.battedBall)parts.push(action.battedBall);if(action.fieldingType)parts.push(fieldTypeLabel(action.fieldingType));}
  if(action.type==='throw'){if(action.target)parts.push(throwTargetLabel(action.target)||action.target);if(action.accuracy)parts.push(defenseValueLabel('throwAccuracy',action.accuracy));}
  if(action.type==='receive'){if(action.target)parts.push(throwTargetLabel(action.target)||action.target);if(action.incoming)parts.push(defenseValueLabel('incoming',action.incoming));}
  if(action.type==='tag'){if(action.targetRunner)parts.push({BR:'타자주자',R1:'1루 주자',R2:'2루 주자',R3:'3루 주자',UNKNOWN:'대상 모름'}[action.targetRunner]);if(action.call)parts.push({out:'아웃',safe:'세이프',no_call:'판정 없음'}[action.call]);}
  if(action.type==='base'){if(action.base)parts.push(throwTargetLabel(action.base)||action.base);if(action.call)parts.push({out:'아웃',safe:'세이프',no_call:'판정 없음'}[action.call]);}
  if(action.type==='cover'){if(action.role)parts.push({base_cover:'베이스 커버',backup:'백업',cutoff:'중계 위치',communication:'콜·의사소통'}[action.role]);if(action.timing)parts.push({on_time:'제시간',late:'늦음',missed:'놓침'}[action.timing]);}
  return {status,text:parts.filter(Boolean).join(' · ')||'세부 미입력'};
}
function defenseActionChooserHtml(mode,after){
  const options=[['field','타구 처리','직접 타구를 처리'],['receive','송구 받기','동료의 송구를 받음'],['tag','주자 태그','공으로 주자를 태그'],['base','베이스 터치','공을 가진 채 베이스 접촉'],['throw','송구','목표로 공을 보냄'],['cover','커버·백업','공 없이 수비에 참여']];
  return `<section class="defense-action-chooser"><div><span>${after<0?'첫 동작 선택':'다음 동작 선택'}</span><small>우리 선수가 직접 한 동작만 선택하세요.</small></div><div class="defense-action-type-grid">${options.map(([value,label,sub])=>`<button type="button" data-defense-add-type="${value}" data-defense-after="${after}"><span aria-hidden="true">${{field:'◆',receive:'⌒',tag:'◎',base:'◈',throw:'➜',cover:'◇'}[value]}</span><b>${label}</b><small>${sub}</small></button>`).join('')}</div>${after>=0?`<button type="button" class="defense-cancel-next" data-defense-cancel-next>다음 동작 추가 취소</button>`:''}</section>`;
}
function defenseOptionalDetailsHtml(mode,action){
  const state=defenseEditorState[mode],open=state.detailsOpen.has(action.id);
  let body='';
  if(action.type==='throw')body=`<div class="form-grid defense-extra-grid"><label>거리 m · 선택<input type="number" min="0" data-defense-action-input="distance" data-defense-action-id="${action.id}" value="${action.distance??''}" /></label><label>구속 km/h · 선택<input type="number" min="0" max="200" data-defense-action-input="velocity" data-defense-action-id="${action.id}" value="${action.velocity??''}" /></label></div>`;
  else if(action.type==='receive'&&['1B','2B','3B','HOME'].includes(action.target))body=defenseFieldGroup('베이스 접촉 유지 · 선택',defenseChoiceButtons(mode,action,'baseHold',[['','미입력'],['success','성공'],['failed','실패'],['na','해당 없음']],action.baseHold));
  else return '';
  return `<details class="defense-optional" data-defense-details-toggle="${action.id}" ${open?'open':''}><summary><span>세부 정보 · 선택</span><i>⌄</i></summary><div class="defense-optional-body">${body}</div></details>`;
}
function defenseJudgmentHtml(mode,action){
  const state=defenseEditorState[mode],j=action.judgment||{},open=state.judgmentOpen.has(action.id),ratingOptions=[['','평가 안 함'],['best','최선'],['acceptable','허용 가능'],['wrong','잘못된 판단']];
  let specific='';
  if(j.rating&&action.type==='field')specific=defenseFieldGroup('첫 반응',defenseChoiceButtons(mode,action,'reaction',[['','미입력'],['good','빠름'],['normal','보통'],['late','늦음'],['wrong','반대 방향']],j.reaction,{judgment:true}))+defenseFieldGroup('이동 경로',defenseChoiceButtons(mode,action,'route',[['','미입력'],['direct','효율적'],['adjusted','수정함'],['inefficient','비효율'],['na','해당 없음']],j.route,{judgment:true}));
  if(j.rating&&action.type==='throw')specific=defenseFieldGroup('더 나은 선택 · 선택',defenseChoiceButtons(mode,action,'bestChoice',[['','없음'],['hold','던지지 않기'],['1B','1루'],['2B','2루'],['3B','3루'],['HOME','홈'],['RELAY','중계']],j.bestChoice,{judgment:true}));
  if(j.rating&&action.type==='receive')specific=defenseFieldGroup('위치 선정',defenseChoiceButtons(mode,action,'positioning',[['','미입력'],['correct','적절'],['late','늦음'],['wrong','잘못됨']],j.positioning,{judgment:true}))+defenseFieldGroup('다음 플레이 준비',defenseChoiceButtons(mode,action,'nextReady',[['','미입력'],['ready','준비됨'],['late','늦음'],['na','해당 없음']],j.nextReady,{judgment:true}));
  if(j.rating&&['tag','base'].includes(action.type))specific=defenseFieldGroup('더 나은 선택 · 선택',defenseChoiceButtons(mode,action,'bestChoice',[['','없음'],['hold','공 보유'],['TAG','주자 태그'],['1B','1루'],['2B','2루'],['3B','3루'],['HOME','홈'],['RELAY','송구·중계']],j.bestChoice,{judgment:true}));
  if(j.rating&&action.type==='cover')specific=defenseFieldGroup('의사소통',defenseChoiceButtons(mode,action,'communication',[['','미입력'],['good','적절'],['late','늦음'],['missed','없었음'],['na','해당 없음']],j.communication,{judgment:true}));
  const details=j.rating?`${specific}<div class="form-grid defense-extra-grid"><label>평가 근거<select data-defense-judgment-input="source" data-defense-action-id="${action.id}"><option value="">미입력</option>${[['self','본인'],['coach','코치'],['video','영상 확인']].map(([v,l])=>`<option value="${v}" ${j.source===v?'selected':''}>${l}</option>`).join('')}</select></label><label>판단 메모 · 선택<input data-defense-judgment-input="note" data-defense-action-id="${action.id}" maxlength="300" value="${esc(j.note||'')}" /></label></div>`:'';
  return `<details class="defense-optional judgment" data-defense-judgment-toggle="${action.id}" ${open?'open':''}><summary><span>판단 평가 · 선택</span><small>${j.rating?{best:'최선',acceptable:'허용 가능',wrong:'잘못된 판단'}[j.rating]:'평가 안 함'}</small><i>⌄</i></summary><div class="defense-optional-body">${defenseFieldGroup('판단 결과',defenseChoiceButtons(mode,action,'rating',ratingOptions,j.rating,{judgment:true}))}${details}</div></details>`;
}
function defenseActionFieldsHtml(mode,action){
  if(action.type==='field'){const method=['GB','BUNT'].includes(action.battedBall)?defenseFieldGroup('타구 처리 방법',defenseChoiceButtons(mode,action,'fieldingType',[['','미입력'],['FRONT','정면'],['FOREHAND','포핸드'],['BACKHAND','백핸드']],action.fieldingType)):'';return defenseFieldGroup('타구',defenseChoiceButtons(mode,action,'battedBall',[['','미입력'],['GB','GB','땅볼'],['LD','LD','라인드라이브'],['FB','FB','뜬공'],['PU','PU','내야 뜬공'],['BUNT','번트']],action.battedBall))+defenseFieldGroup('타구 방향 · 선수 기준',defenseChoiceButtons(mode,action,'direction',[['','미입력'],['L','왼쪽'],['C','정면'],['R','오른쪽']],action.direction))+defenseFieldGroup('타구 속도',defenseChoiceButtons(mode,action,'speed',[['','미입력'],['slow','느림'],['medium','보통'],['fast','빠름']],action.speed))+method+defenseFieldGroup('타구 처리 결과',defenseChoiceButtons(mode,action,'result',[['','미입력'],['clean','깔끔한 처리'],['recovered','불안정 후 보완'],['failed','처리 실패']],action.result))+defenseJudgmentHtml(mode,action);}
  if(action.type==='throw'){const accuracyOptions=[['','미입력'],['accurate','정확'],['high','높음'],['low','낮음'],['bounce','바운드'],['right','오른쪽'],['left','왼쪽'],['uncatchable','벗어남','받기 불가']];if(action.accuracy==='catchable')accuracyOptions.splice(2,0,['catchable','받을 수 있음','기존 형식']);return defenseFieldGroup('송구 목적지',defenseChoiceButtons(mode,action,'target',[['','미입력'],['1B','1루'],['2B','2루'],['3B','3루'],['HOME','홈'],['RELAY','중계'],['OTHER','기타']],action.target))+defenseFieldGroup('송구 정확도',defenseChoiceButtons(mode,action,'accuracy',accuracyOptions,action.accuracy))+defenseFieldGroup('송구 부하',defenseChoiceButtons(mode,action,'tlu',[['0','매우 가벼움','0.00 TLU'],['0.75','가벼움','0.75 TLU'],['0.85','중간','0.85 TLU'],['1','전력','1.00 TLU']],String(action.tlu)))+defenseOptionalDetailsHtml(mode,action)+defenseJudgmentHtml(mode,action);}
  if(action.type==='receive'){const incomingOptions=[['','미입력'],['on_target','정확'],['high','높음'],['low','낮음'],['bounce','바운드'],['right','오른쪽'],['left','왼쪽'],['uncatchable','벗어남','받기 불가']];if(action.incoming==='wide')incomingOptions.splice(2,0,['wide','좌우 벗어남','기존 형식']);const techniques=[['','미입력'],['normal','일반'],['stretch','스트레치'],['scoop','스쿱'],['block','블로킹']];if(action.technique==='tag')techniques.push(['tag','태그 · 기존 방식']);if(action.technique==='base_hold')techniques.push(['base_hold','베이스 유지 · 기존 방식']);return defenseFieldGroup('송구를 받은 위치',defenseChoiceButtons(mode,action,'target',[['','미입력'],['1B','1루'],['2B','2루'],['3B','3루'],['HOME','홈'],['RELAY','중계'],['OTHER','기타']],action.target))+defenseFieldGroup('송구를 보낸 위치',defenseChoiceButtons(mode,action,'sourcePosition',[['','미입력'],['P','투수'],['C','포수'],['1B','1루수'],['2B','2루수'],['3B','3루수'],['SS','유격수'],['LF','LF'],['CF','CF'],['RF','RF'],['RELAY','중계'],['OTHER','기타']],action.sourcePosition))+defenseFieldGroup('송구 형태',defenseChoiceButtons(mode,action,'incoming',incomingOptions,action.incoming))+defenseFieldGroup('송구 받기 방법',defenseChoiceButtons(mode,action,'technique',techniques,action.technique))+(action.incoming==='uncatchable'?'<div class="defense-derived neutral"><span>송구 받기 결과</span><b>평가 제외 · 받을 수 없는 송구</b></div>':defenseFieldGroup('송구 받기 결과',defenseChoiceButtons(mode,action,'result',[['','미입력'],['clean','깔끔한 수신'],['recovered','어려운 공 보완'],['failed','수신 실패']],action.result)))+defenseOptionalDetailsHtml(mode,action)+defenseJudgmentHtml(mode,action);}
  if(action.type==='tag')return defenseFieldGroup('태그 대상',defenseChoiceButtons(mode,action,'targetRunner',[['','미입력'],['BR','타자주자'],['R1','1루 주자'],['R2','2루 주자'],['R3','3루 주자'],['UNKNOWN','대상 모름']],action.targetRunner))+defenseFieldGroup('태그 실행',defenseChoiceButtons(mode,action,'execution',[['','미입력'],['clean','정확한 태그'],['recovered','수습 후 태그'],['missed','태그 빗나감'],['dropped','태그 중 공 빠짐']],action.execution))+defenseFieldGroup('태그 타이밍',defenseChoiceButtons(mode,action,'timing',[['','미입력'],['early','여유'],['close','접전'],['late','늦음'],['na','평가 불가']],action.timing))+defenseFieldGroup('심판 판정',defenseChoiceButtons(mode,action,'call',[['','미입력'],['out','아웃'],['safe','세이프'],['no_call','판정 없음']],action.call))+defenseJudgmentHtml(mode,action);
  if(action.type==='base')return defenseFieldGroup('터치할 베이스',defenseChoiceButtons(mode,action,'base',[['','미입력'],['1B','1루'],['2B','2루'],['3B','3루'],['HOME','홈']],action.base))+defenseFieldGroup('베이스 접촉',defenseChoiceButtons(mode,action,'execution',[['','미입력'],['secure','정상 접촉'],['off_base','접촉 후 이탈'],['missed','미접촉']],action.execution))+defenseFieldGroup('베이스 타이밍',defenseChoiceButtons(mode,action,'timing',[['','미입력'],['early','여유'],['close','접전'],['late','늦음'],['na','평가 불가']],action.timing))+defenseFieldGroup('심판 판정',defenseChoiceButtons(mode,action,'call',[['','미입력'],['out','아웃'],['safe','세이프'],['no_call','판정 없음']],action.call))+defenseJudgmentHtml(mode,action);
  return defenseFieldGroup('수비 역할',defenseChoiceButtons(mode,action,'role',[['','미입력'],['base_cover','베이스 커버'],['backup','백업'],['cutoff','중계 위치'],['communication','콜·의사소통']],action.role))+defenseFieldGroup('도착 시점',defenseChoiceButtons(mode,action,'timing',[['','미입력'],['on_time','제시간'],['late','늦음'],['missed','놓침']],action.timing))+defenseFieldGroup('수행 결과',defenseChoiceButtons(mode,action,'result',[['','미입력'],['correct','정확히 수행'],['recovered','늦었지만 보완'],['failed','수행 실패']],action.result))+defenseJudgmentHtml(mode,action);
}
function defenseActionCardHtml(mode,action,index,total,previous=null,warning=null){
  const state=defenseEditorState[mode],open=state.openActionId===action.id,summary=defenseActionSummary(action),missing=defenseMissingFields({...defenseDraft(mode),actions:[action],flowEnded:true,outcome:'continue'}).filter(x=>x.scope==='action').length;
  const controls=`<div class="defense-step-tools">${total>1?`<button type="button" data-defense-move="up" data-defense-action-id="${action.id}" ${index===0?'disabled':''}>↑ 앞으로</button><button type="button" data-defense-move="down" data-defense-action-id="${action.id}" ${index===total-1?'disabled':''}>↓ 뒤로</button>`:''}<button type="button" class="danger" data-defense-remove-action="${action.id}">이 동작 삭제</button></div>`;
  const flow=index===total-1&&!defenseDraft(mode).flowEnded?`<div class="defense-flow-actions"><button type="button" class="soft" data-defense-end-play>여기서 플레이 종료</button><button type="button" class="primary" data-defense-next-action="${index}">이어짐 · 다음 동작</button></div>`:`${index<total-1?`<button type="button" class="defense-insert-action" data-defense-next-action="${index}">＋ 이 뒤에 동작 삽입</button>`:''}`;
  const typeSelect=`<label class="defense-action-kind">동작 종류<select data-defense-action-type-input data-defense-action-id="${action.id}">${[['field','타구 처리'],['receive','송구 받기'],['tag','주자 태그'],['base','베이스 터치'],['throw','송구'],['cover','커버·백업']].map(([value,label])=>`<option value="${value}" ${action.type===value?'selected':''}>${label}</option>`).join('')}</select></label>`;
  const teammate=previous?.type==='throw'&&action.type==='receive'?'<div class="defense-teammate-bridge"><span>동료 선수 경유</span><small>우리 선수가 다시 플레이에 참여</small></div>':'';
  return `${teammate}<article class="defense-step ${open?'open':''} status-${summary.status.tone}"><button type="button" class="defense-step-head" data-defense-toggle-action="${action.id}" aria-expanded="${open}"><span class="defense-step-number">${index+1}</span><span><b>${defenseActionLabel(action.type)}</b><small>${esc(summary.text)}</small></span><em class="${summary.status.tone}">${esc(summary.status.label)}${missing?` · 미입력 ${missing}`:''}</em><i>${open?'⌃':'⌄'}</i></button>${warning?`<div class="defense-connection-warning"><span aria-hidden="true">!</span><p>${esc(warning.label)}</p></div>`:''}${open?`<div class="defense-step-body">${typeSelect}${defenseActionFieldsHtml(mode,action)}${controls}${flow}</div>`:''}</article>${state.chooseAfter===index?defenseActionChooserHtml(mode,index):''}`;
}
function defenseSituationHtml(mode,draft){
  const state=defenseEditorState[mode],open=state.detailsOpen.has('situation'),situation=normalizeGameSituation(draft.situation);
  return `<details class="defense-situation" data-defense-details-toggle="situation" ${open?'open':''}><summary><span>플레이 시작 상황 · 선택</span><small>${gameSituationSummary(situation)}</small><i>⌄</i></summary><div class="defense-optional-body">${gameSituationFieldsHtml(situation,{scope:`defense-${mode}`,outsLabel:'플레이 시작 전 아웃 카운트',runnersLabel:'플레이 시작 전 주자 상황'})}<p class="defense-helper">상황별 수비 분석에만 사용하며, 선택하지 않아도 기록을 저장할 수 있습니다.</p></div></details>`;
}
function defenseDirectOutLabel(draft){
  const tag=draft.actions.filter(action=>action.type==='tag'&&action.call==='out').length,base=draft.actions.filter(action=>action.type==='base'&&action.call==='out').length,parts=[];
  if(tag)parts.push(`태그 아웃 ${tag}`);if(base)parts.push(`베이스 아웃 ${base}`);return parts.join(' · ');
}
function defenseOutcomeHtml(mode,draft){
  if(!draft.flowEnded)return '';
  const missing=defenseMissingFields(draft),warnings=defenseFlowWarnings(draft),directOut=defenseDirectOutLabel(draft),official=defenseOfficialText(draft),recommendation=defenseOfficialRecommendation(draft);
  const officialButtons=['po','a','e','dp'].map(key=>`<button type="button" class="defense-official-chip ${draft.official?.[key]?'active':''}" data-defense-official="${key}" aria-pressed="${!!draft.official?.[key]}">${key.toUpperCase()}</button>`).join('');
  const needsAttention=missing.length||warnings.length,attentionTitle=missing.length?`미입력 ${missing.length}개 · 기록에서 보완 가능`:warnings.length?`동작 연결 확인 ${warnings.length}개`:'필수 항목 입력 완료',attentionDetail=missing.length?missing.slice(0,3).map(x=>x.label).join(' · '):warnings.length?warnings.slice(0,2).map(x=>x.label).join(' · '):'플레이 결과와 공식 기록까지 입력되었습니다.';
  const runnerOptions=[['1B','1루'],['2B','2루'],['3B','3루']],runners=Array.isArray(draft.runnersAfter)?draft.runnersAfter:null,runnerButtons=`<div class="defense-field-group"><span>플레이 후 주자</span><div class="defense-choice-grid runners after-play"><button type="button" class="defense-choice ${runners?.length===0?'active':''}" data-defense-runners-none aria-pressed="${runners?.length===0}"><b>주자 없음</b></button>${runnerOptions.map(([value,label])=>{const selected=runners?.includes(value);return `<button type="button" class="defense-choice ${selected?'active':''}" data-defense-runner-after="${value}" aria-pressed="${!!selected}"><b>${label}</b></button>`;}).join('')}</div></div>`;
  return `<section class="defense-outcome"><div class="defense-section-title"><span>플레이 종료</span><small>한 플레이에서 잡은 아웃과 플레이 후 주자를 기록합니다.</small></div>${directOut?`<div class="defense-derived out-summary"><span>우리 선수의 직접 아웃</span><b>${esc(directOut)}</b></div>`:''}${defenseFieldGroup('이번 플레이에서 잡은 아웃 수',defenseChoiceButtons(mode,null,'outsRecorded',[['','미입력'],['0','0개'],['1','1개'],['2','2개'],['3','3개']],draft.outsRecorded,{play:true}))}${runnerButtons}<section class="defense-official-required"><div class="defense-required-head"><span>공식 기록 · 필수</span><small>${esc(official)}</small></div><p class="defense-recommendation">${esc(recommendation)} · 추천은 자동 확정되지 않습니다.</p><div class="defense-official-state"><button type="button" data-defense-official-state="missing" class="${draft.official?.status==='missing'?'active':''}">미입력</button><button type="button" data-defense-official-state="none" class="${draft.official?.status==='none'?'active':''}">공식 기록 없음</button></div><div class="defense-official-grid">${officialButtons}</div></section><label class="defense-note-field">플레이 메모 · 선택<input data-defense-play-input="note" maxlength="500" value="${esc(draft.note||'')}" placeholder="영상 확인이나 코치 피드백" /></label><div class="defense-completeness ${needsAttention?'incomplete':'complete'}"><span aria-hidden="true">${needsAttention?'!':'✓'}</span><div><b>${esc(attentionTitle)}</b><small>${esc(attentionDetail)}</small></div></div><button type="button" class="defense-continue-play" data-defense-reopen-flow>＋ 플레이 동작 더 이어가기</button>${mode==='create'?'<button id="saveDefense" type="button" class="save-set defense-save">수비 플레이 저장</button>':''}</section>`;
}
function defenseEditorHtml(mode){
  const draft=defenseDraft(mode);if(!draft)return '';
  const state=defenseEditorState[mode],warningByAction=new Map(defenseFlowWarnings(draft).filter(item=>item.actionId).map(item=>[item.actionId,item])),steps=draft.actions.map((action,index)=>defenseActionCardHtml(mode,action,index,draft.actions.length,draft.actions[index-1]||null,warningByAction.get(action.id)||null)).join('');
  return `<section class="defense-context-card"><label>수비 포지션<select data-defense-play-input="position">${defensePositionOptions(draft.position)}</select></label><p><b>${esc(athlete()?.name||'선수')}</b>의 동작만 기록합니다. 동료의 포구 결과는 우리 선수의 송구 품질과 분리됩니다.</p></section>${defenseSituationHtml(mode,draft)}<div class="defense-flow">${steps||defenseActionChooserHtml(mode,-1)}</div>${defenseOutcomeHtml(mode,draft)}`;
}
function gameBaserunningForm(){return `<div class="entry-title"><div><p class="section-kicker">BASERUNNING EVENT</p><h2>BASERUNNING</h2><p>도루는 한 베이스 단위 시도로만 기록합니다.</p></div></div>${standaloneGameSituationHtml()}<div class="form-grid baserunning-route-grid"><label>출발<select id="runFrom"><option value="1B">1루</option><option value="2B">2루</option><option value="3B">3루</option></select></label><label>목표<select id="runTo"><option value="2B">2루</option><option value="3B">3루</option><option value="HOME">홈</option></select></label></div><div id="stealResultGroup" class="field-group steal-result-group"><span>결과</span><div class="steal-result-grid"><button type="button" class="active success" data-steal-result="SUCCESS"><i aria-hidden="true">✓</i><b>성공</b></button><button type="button" class="failed" data-steal-result="FAILED"><i aria-hidden="true">×</i><b>실패</b></button></div></div><button id="saveBaserunning" class="save-set">도루 기록 저장</button>`;}
function trainingForm(domain){if(domain==='pitching')return trainingPitchingForm();if(domain==='hitting')return trainingHittingForm();if(domain==='defense')return trainingDefenseForm();return trainingBaserunningForm();}
function quantityHtml(value=ui.quantity){return `<div class="quantity-box"><div class="quantity-main"><button type="button" data-qty-delta="-1">−</button><input id="trainingQty" type="number" min="0" step="1" value="${value}" /><button type="button" data-qty-delta="1">＋</button></div><div class="quantity-quick"><button type="button" data-qty-delta="5">+5</button><button type="button" data-qty-delta="10">+10</button><button type="button" data-qty-set="0">초기화</button></div></div>`;}
function trainingPitchingForm(){const a=athlete(),side=a?.throws==='S'?'R':a?.throws||'R';return `<div class="entry-title"><div><p class="section-kicker">THROWING VOLUME</p><h2>투구 훈련</h2><p>훈련 명칭보다 실제 투구 강도와 총량을 기록합니다.</p></div></div><div class="form-grid"><label>투구 방향<select id="trPitchSide"><option value="R" ${side==='R'?'selected':''}>우투</option><option value="L" ${side==='L'?'selected':''}>좌투</option></select></label><label>강도<select id="trPitchIntensity"><option value="light">가벼운 · 0.75 TLU</option><option value="medium">중간 · 0.85 TLU</option><option value="max">전력 · 1.00 TLU</option></select></label></div><div class="field-group"><span>투구 횟수</span>${quantityHtml()}</div><button class="save-set" data-save-training="pitching">훈련 세트 저장</button>`;}
function trainingHittingForm(){const a=athlete(),side=a?.bats==='S'?'R':a?.bats||'R';return `<div class="entry-title"><div><p class="section-kicker">HITTING VOLUME</p><h2>타격 훈련</h2><p>좌·우 타격, 훈련 종류, 필요 시 구속과 스윙량을 기록합니다.</p></div></div><div class="form-grid"><label>타격 방향<select id="trHitSide"><option value="R" ${side==='R'?'selected':''}>우타</option><option value="L" ${side==='L'?'selected':''}>좌타</option></select></label><label>훈련 종류<select id="trHitType"><option value="DRY_SWING">빈스윙</option><option value="TEE">티</option><option value="TOSS">토스</option><option value="BP">배팅볼</option><option value="MACHINE">머신</option><option value="LIVE">라이브</option></select></label><label>구속 km/h (선택)<input id="trHitVelocity" type="number" min="0" max="200" placeholder="예: 90" /></label></div><div class="field-group"><span>스윙 횟수</span>${quantityHtml()}</div><button class="save-set" data-save-training="hitting">훈련 세트 저장</button>`;}
function resetDefenseTrainingEditorState(mode){const state=defenseTrainingEditorState[mode];state.openActionId=null;state.chooseAfter=null;state.outcomesOpen=false;}
function ensureDefenseTrainingCreateDraft(){
  const context=`${activeAthleteId||''}:${ui.inputDate}`;
  if(!defenseTrainingCreateDraft||defenseTrainingCreateDraft._context!==context){defenseTrainingCreateDraft=newDefenseTrainingDraft({mode:ui.defenseTrainingMode,position:defaultDefensePosition(),area:['LF','CF','RF'].includes(defaultDefensePosition())?'OF':'IF',quantity:ui.quantity});defenseTrainingCreateDraft._context=context;resetDefenseTrainingEditorState('create');}
  return defenseTrainingCreateDraft;
}
function defenseTrainingDraft(mode){return mode==='edit'?defenseTrainingEditDraft:ensureDefenseTrainingCreateDraft();}
function defenseTrainingRoot(mode){return $(mode==='edit'?'#trainingEditEditor':'#defenseTrainingCreateEditor');}
function defenseTrainingTypeOptions(current){return [['FIELDING','포구'],['THROWING','송구'],['GROUND_BALL','땅볼'],['FLY_BALL','플라이'],['DOUBLE_PLAY','병살'],['RELAY','중계플레이'],['FOOTWORK','풋워크'],['OTHER','기타']].map(([value,label])=>`<option value="${value}" ${current===value?'selected':''}>${label}</option>`).join('');}
function defenseTrainingPositionOptions(current){return ['P','C','1B','2B','3B','SS','LF','CF','RF'].map(value=>`<option value="${value}" ${current===value?'selected':''}>${value}</option>`).join('');}
function defenseTrainingModeTabs(mode,draft){return `<div class="segmented-control defense-training-mode-tabs" aria-label="수비 훈련 기록 방식"><button type="button" data-dt-mode="simple" class="${draft.trainingMode==='simple'?'active':''}" aria-pressed="${draft.trainingMode==='simple'}"><b>간단 기록</b><small>훈련량만 빠르게</small></button><button type="button" data-dt-mode="scenario" class="${draft.trainingMode==='scenario'?'active':''}" aria-pressed="${draft.trainingMode==='scenario'}"><b>시나리오 기록</b><small>동작 흐름까지</small></button></div>`;}
function defenseTrainingQuantityHtml(mode,draft){return `<div class="quantity-box defense-training-quantity"><div class="quantity-main"><button type="button" data-dt-qty-delta="-1">−</button><input type="number" min="0" step="1" data-dt-quantity value="${draft.quantity}" aria-label="훈련 reps" /><button type="button" data-dt-qty-delta="1">＋</button></div><div class="quantity-quick"><button type="button" data-dt-qty-delta="5">+5</button><button type="button" data-dt-qty-delta="10">+10</button><button type="button" data-dt-qty-set="0">초기화</button></div></div>`;}
function defenseTrainingOutcomeHtml(mode,draft){const state=defenseTrainingEditorState[mode],stats=defenseTrainingStats(draft,draft.quantity),values=draft.outcomes||{};return `<details class="training-outcomes" data-dt-outcomes ${state.outcomesOpen?'open':''}><summary><span><b>훈련 결과 · 선택</b><small>일부 reps만 평가해도 됩니다</small></span><em>${stats.outcomes.evaluated?`${stats.outcomes.evaluated}/${draft.quantity} 평가`:'평가 안 함'}</em><i>⌄</i></summary><div class="training-outcome-body"><p>평가하지 않은 reps는 실패로 계산하지 않습니다.</p><div class="training-outcome-grid"><label class="target"><span>목표대로</span><input type="number" min="0" data-dt-outcome="target" value="${values.target??''}" placeholder="0" /></label><label class="adjust"><span>보완 필요</span><input type="number" min="0" data-dt-outcome="adjust" value="${values.adjust??''}" placeholder="0" /></label><label class="failed"><span>실패·중단</span><input type="number" min="0" data-dt-outcome="failed" value="${values.failed??''}" placeholder="0" /></label></div><div class="training-evaluation-preview"><span>평가 ${stats.outcomes.evaluated} reps</span><b>미평가 ${stats.outcomes.unassessed} reps</b></div></div></details>`;}
function defenseTrainingValueLabel(group,value){const maps={difficulty:{routine:'쉬움',normal:'보통',difficult:'어려움'},fieldingType:{FRONT:'정면',FOREHAND:'포핸드',BACKHAND:'백핸드',CHARGE:'전진',FORWARD:'앞으로',STRAIGHT:'정면',LATERAL:'좌우',BACK:'뒤로'},direction:{L:'좌',C:'중',R:'우'},target:{'1B':'1루','2B':'2루','3B':'3루',HOME:'홈',RELAY:'중계',OTHER:'기타'},incoming:{on_target:'정확',high:'높음',low:'낮음',wide:'벗어남',bounce:'바운드',uncatchable:'받기 불가'},receiveTechnique:{normal:'일반',stretch:'스트레치',scoop:'스쿱',block:'블로킹',tag_ready:'태그 준비',base_hold:'베이스 유지'},runner:{BR:'타자주자',R1:'1루 주자',R2:'2루 주자',R3:'3루 주자',UNKNOWN:'대상 미정'},tagTechnique:{sweep:'스윕 태그',block:'길목 차단',quick:'퀵 태그',other:'기타'},basePurpose:{force:'포스 플레이',appeal:'어필 플레이',cover:'베이스 커버',other:'기타'},cover:{base_cover:'베이스 커버',backup:'백업',cutoff:'중계 위치',communication:'콜·의사소통'}};return maps[group]?.[value]||value||'미입력';}
function defenseTrainingChoice(mode,action,key,options,current){return `<div class="defense-choice-grid">${options.map(([value,label,sub])=>{const selected=String(current??'')===String(value);return `<button type="button" class="defense-choice ${selected?'active':''}" data-dt-action-id="${action.id}" data-dt-action-choice="${key}" data-dt-value="${esc(value)}" aria-pressed="${selected}"><b>${esc(label)}</b>${sub?`<small>${esc(sub)}</small>`:''}</button>`;}).join('')}</div>`;}
function defenseTrainingField(label,content){return `<div class="defense-field-group"><span>${esc(label)}</span>${content}</div>`;}
function defenseTrainingActionSummary(action){const parts=[];if(action.type==='field'){if(action.battedBall)parts.push(action.battedBall);if(action.difficulty)parts.push(defenseTrainingValueLabel('difficulty',action.difficulty));}else if(action.type==='receive'){if(action.target)parts.push(defenseTrainingValueLabel('target',action.target));if(action.technique)parts.push(defenseTrainingValueLabel('receiveTechnique',action.technique));}else if(action.type==='tag'){if(action.targetRunner)parts.push(defenseTrainingValueLabel('runner',action.targetRunner));if(action.technique)parts.push(defenseTrainingValueLabel('tagTechnique',action.technique));}else if(action.type==='base'){if(action.base)parts.push(defenseTrainingValueLabel('target',action.base));if(action.purpose)parts.push(defenseTrainingValueLabel('basePurpose',action.purpose));}else if(action.type==='throw'){if(action.target)parts.push(defenseTrainingValueLabel('target',action.target));parts.push(`${n2(action.tlu)} TLU`);}else if(action.role)parts.push(defenseTrainingValueLabel('cover',action.role));return parts.join(' · ')||'세부 조건 선택';}
function defenseTrainingActionFields(mode,action){
  if(action.type==='field')return defenseTrainingField('타구 종류',defenseTrainingChoice(mode,action,'battedBall',[['GB','GB · 땅볼'],['LD','LD · 라인'],['FB','FB · 뜬공'],['PU','PU · 팝업'],['BUNT','번트']],action.battedBall))+defenseTrainingField('난이도',defenseTrainingChoice(mode,action,'difficulty',[['routine','쉬움'],['normal','보통'],['difficult','어려움']],action.difficulty))+defenseTrainingField('처리 형태 · 선택',defenseTrainingChoice(mode,action,'fieldingType',[['FRONT','정면'],['FOREHAND','포핸드'],['BACKHAND','백핸드'],['CHARGE','전진'],['FORWARD','앞으로'],['LATERAL','좌우'],['BACK','뒤로']],action.fieldingType));
  if(action.type==='receive')return defenseTrainingField('받는 위치',defenseTrainingChoice(mode,action,'target',[['1B','1루'],['2B','2루'],['3B','3루'],['HOME','홈'],['RELAY','중계'],['OTHER','기타']],action.target))+defenseTrainingField('들어오는 송구',defenseTrainingChoice(mode,action,'incoming',[['on_target','정확'],['high','높음'],['low','낮음'],['wide','벗어남'],['bounce','바운드'],['uncatchable','받기 불가']],action.incoming))+defenseTrainingField('받는 기술 · 선택',defenseTrainingChoice(mode,action,'technique',[['normal','일반'],['stretch','스트레치'],['scoop','스쿱'],['block','블로킹'],['tag_ready','태그 준비'],['base_hold','베이스 유지']],action.technique));
  if(action.type==='tag')return defenseTrainingField('태그 대상',defenseTrainingChoice(mode,action,'targetRunner',[['BR','타자주자'],['R1','1루 주자'],['R2','2루 주자'],['R3','3루 주자'],['UNKNOWN','대상 미정']],action.targetRunner))+defenseTrainingField('태그 방식 · 선택',defenseTrainingChoice(mode,action,'technique',[['sweep','스윕 태그'],['block','길목 차단'],['quick','퀵 태그'],['other','기타']],action.technique));
  if(action.type==='base')return defenseTrainingField('터치 베이스',defenseTrainingChoice(mode,action,'base',[['1B','1루'],['2B','2루'],['3B','3루'],['HOME','홈']],action.base))+defenseTrainingField('훈련 목적 · 선택',defenseTrainingChoice(mode,action,'purpose',[['force','포스 플레이'],['appeal','어필 플레이'],['cover','베이스 커버'],['other','기타']],action.purpose));
  if(action.type==='throw')return defenseTrainingField('송구 목적지',defenseTrainingChoice(mode,action,'target',[['1B','1루'],['2B','2루'],['3B','3루'],['HOME','홈'],['RELAY','중계'],['OTHER','기타']],action.target))+defenseTrainingField('송구 부하',defenseTrainingChoice(mode,action,'tlu',[['0','매우 가벼운 토스','0.00 TLU'],['0.75','근거리','0.75 TLU'],['0.85','중거리','0.85 TLU'],['1','장거리·전력','1.00 TLU']],action.tlu));
  return defenseTrainingField('수비 역할',defenseTrainingChoice(mode,action,'role',[['base_cover','베이스 커버'],['backup','백업'],['cutoff','중계 위치'],['communication','콜·의사소통']],action.role));
}
function defenseTrainingActionChooser(mode,after){const options=[['field','타구 처리','직접 타구 처리'],['receive','송구 받기','동료 송구 수신'],['tag','주자 태그','공으로 직접 태그'],['base','베이스 터치','공을 가진 채 접촉'],['throw','송구','목표로 공을 보냄'],['cover','커버·백업','공 없이 수비 참여']];return `<section class="defense-action-chooser training-action-chooser"><div><span>${after<0?'첫 동작 선택':'다음 동작 선택'}</span><small>훈련할 순서대로 추가하세요.</small></div><div class="defense-action-type-grid">${options.map(([value,label,sub])=>`<button type="button" data-dt-add-type="${value}" data-dt-after="${after}"><span aria-hidden="true">${{field:'◆',receive:'⌒',tag:'◎',base:'◈',throw:'➜',cover:'◇'}[value]}</span><b>${label}</b><small>${sub}</small></button>`).join('')}</div>${after>=0?'<button type="button" class="defense-cancel-next" data-dt-cancel-add>동작 추가 취소</button>':''}</section>`;}
function defenseTrainingActionCard(mode,action,index,total){
  const state=defenseTrainingEditorState[mode],draft=defenseTrainingDraft(mode),open=state.openActionId===action.id,count=defenseTrainingActionCount(action,draft.quantity);
  const flow=index===total-1&&!draft.flowEnded?`<div class="defense-flow-actions"><button type="button" class="soft" data-dt-end-play>여기서 플레이 종료</button><button type="button" class="primary" data-dt-open-add="${index}">이어짐 · 다음 동작</button></div>`:`${index<total-1?`<button type="button" class="defense-insert-action training-insert-action" data-dt-open-add="${index}">＋ 이 뒤에 동작 삽입</button>`:''}`;
  return `<section class="defense-step training-step ${open?'open':''}"><button type="button" class="defense-step-head" data-dt-toggle-action="${action.id}" aria-expanded="${open}"><span class="defense-step-number">${index+1}</span><span><b>${esc(defenseTrainingActionLabel(action.type))}</b><small>${esc(defenseTrainingActionSummary(action))}</small></span><em>${count}회</em><i>${open?'⌃':'⌄'}</i></button>${open?`<div class="defense-step-body"><label class="defense-action-kind">동작 종류<select data-dt-action-type data-dt-action-id="${action.id}">${[['field','타구 처리'],['receive','송구 받기'],['tag','주자 태그'],['base','베이스 터치'],['throw','송구'],['cover','커버·백업']].map(([value,label])=>`<option value="${value}" ${action.type===value?'selected':''}>${label}</option>`).join('')}</select></label>${defenseTrainingActionFields(mode,action)}<label class="training-action-count">실제 동작 횟수 · 선택<input type="number" min="0" data-dt-action-count data-dt-action-id="${action.id}" value="${action.countOverride??''}" placeholder="기본 ${draft.quantity}회" /><small>비워 두면 세트 reps와 같은 ${draft.quantity}회로 계산합니다.</small></label><div class="defense-step-tools"><button type="button" data-dt-move="up" data-dt-action-id="${action.id}" ${index===0?'disabled':''}>↑ 앞으로</button><button type="button" data-dt-move="down" data-dt-action-id="${action.id}" ${index===total-1?'disabled':''}>↓ 뒤로</button><button type="button" class="danger" data-dt-remove="${action.id}">이 동작 삭제</button></div>${flow}</div>`:''}</section>`;
}
function defenseTrainingVolumePreviewHtml(draft,stats){return `<div class="training-volume-preview"><div><span>세트 Reps</span><b>${draft.quantity}</b></div><div><span>Action Reps</span><b>${stats.actionReps}</b></div><div><span>Throws</span><b>${stats.throwCount}</b></div><div><span>Throw TLU</span><b>${n2(stats.throwTLU)}</b></div></div>`;}
function defenseTrainingCompletionHtml(mode,draft,{includeSave=false}={}){
  if(!draft.flowEnded)return '';
  const stats=defenseTrainingStats(draft,draft.quantity),flow=draft.actions.map(action=>defenseTrainingActionShortLabel(action.type)).join(' → ')||'동작 없음';
  return `<section class="defense-outcome training-scenario-outcome"><div class="defense-section-title"><span>플레이 종료</span><small>완성한 수비 플레이를 한 세트의 시나리오로 반복합니다.</small></div><div class="training-scenario-summary"><span>완성된 흐름</span><b>${esc(flow)}</b><small>${draft.quantity}회 반복 · 동작 ${draft.actions.length}개</small></div>${defenseTrainingVolumePreviewHtml(draft,stats)}${defenseTrainingOutcomeHtml(mode,draft)}<label class="defense-note-field training-note-field">훈련 메모 · 선택<input data-dt-field="note" value="${esc(draft.note||'')}" placeholder="훈련 목표나 다음 세트 보완점" /></label><div class="defense-completeness complete"><span aria-hidden="true">✓</span><div><b>시나리오 구성이 완료되었습니다</b><small>훈련 결과와 메모는 선택 사항이며 저장 후에도 수정할 수 있습니다.</small></div></div><button type="button" class="defense-continue-play" data-dt-reopen-flow>＋ 플레이 동작 더 이어가기</button>${includeSave?'<button class="save-set defense-training-save" type="button" data-save-training="defense">수비 훈련 저장</button>':''}</section>`;
}
function defenseTrainingScenarioHtml(mode,draft,{includeSave=false}={}){const state=defenseTrainingEditorState[mode],steps=draft.actions.map((action,index)=>`${defenseTrainingActionCard(mode,action,index,draft.actions.length)}${state.chooseAfter===index?defenseTrainingActionChooser(mode,index):''}`).join(''),chooser=!draft.actions.length?defenseTrainingActionChooser(mode,-1):'',flow=draft.actions.length?draft.actions.map(action=>defenseTrainingActionShortLabel(action.type)).join(' → '):'동작을 추가하세요';return `<section class="defense-context-card training-scenario-context"><label>수비 포지션<select data-dt-field="position">${defenseTrainingPositionOptions(draft.position)}</select></label><label>영역<select data-dt-field="area"><option value="IF" ${draft.area==='IF'?'selected':''}>내야</option><option value="OF" ${draft.area==='OF'?'selected':''}>외야</option></select></label></section><div class="field-group"><span>시나리오 Reps</span>${defenseTrainingQuantityHtml(mode,draft)}</div><section class="training-flow-head"><div><span>SCENARIO FLOW</span><b>${esc(flow)}</b></div><small class="training-flow-status ${draft.flowEnded?'complete':'building'}">${draft.flowEnded?'플레이 종료':'구성 중'} · 동작 ${draft.actions.length}개</small></section><div class="defense-flow training-flow">${steps}${chooser}</div>${defenseTrainingCompletionHtml(mode,draft,{includeSave})}`;}
function defenseTrainingSimpleHtml(mode,draft){const stats=defenseTrainingStats(draft,draft.quantity);return `<div class="form-grid"><label>영역<select data-dt-field="area"><option value="IF" ${draft.area==='IF'?'selected':''}>내야</option><option value="OF" ${draft.area==='OF'?'selected':''}>외야</option></select></label><label>훈련 종류<select data-dt-field="trainingType">${defenseTrainingTypeOptions(draft.trainingType)}</select></label></div><div class="field-group"><span>훈련 Reps</span>${defenseTrainingQuantityHtml(mode,draft)}</div><div class="form-grid"><label>실제 송구 횟수<input type="number" min="0" data-dt-simple="throwCount" value="${draft.simple.throwCount}" /></label><label>송구 부하<select data-dt-simple="throwIntensity"><option value="0" ${Number(draft.simple.throwIntensity)===0?'selected':''}>매우 가벼운 토스 · 0.00</option><option value="0.75" ${Number(draft.simple.throwIntensity)===.75?'selected':''}>근거리 · 0.75</option><option value="0.85" ${Number(draft.simple.throwIntensity)===.85?'selected':''}>중거리 · 0.85</option><option value="1" ${Number(draft.simple.throwIntensity)===1?'selected':''}>장거리/전력 · 1.00</option></select></label></div><div class="training-inline-summary"><span>송구 ${stats.throwCount}회</span><b>${n2(stats.throwTLU)} TLU</b></div>`;}
function defenseTrainingEditorHtml(mode,{includeSave=false}={}){const draft=defenseTrainingDraft(mode);if(!draft)return '';const header=`${defenseTrainingModeTabs(mode,draft)}<p class="training-mode-help">${draft.trainingMode==='simple'?'훈련 종류와 총량을 빠르게 남깁니다. 기존 수비 훈련 기록도 이 방식으로 표시됩니다.':'경기 수비와 같은 방식으로 동작을 이어가고, 마지막 동작에서 플레이를 종료합니다.'}</p>`;if(draft.trainingMode==='scenario')return `${header}${defenseTrainingScenarioHtml(mode,draft,{includeSave})}`;return `${header}${defenseTrainingSimpleHtml(mode,draft)}${defenseTrainingOutcomeHtml(mode,draft)}<label class="defense-note-field training-note-field">훈련 메모 · 선택<input data-dt-field="note" value="${esc(draft.note||'')}" placeholder="훈련 목표나 다음 세트 보완점" /></label>${includeSave?'<button class="save-set defense-training-save" type="button" data-save-training="defense">수비 훈련 저장</button>':''}`;}
function trainingDefenseForm(){const draft=ensureDefenseTrainingCreateDraft();ui.defenseTrainingMode=draft.trainingMode;return `<div class="entry-title"><div><p class="section-kicker">DEFENSE TRAINING</p><h2>수비 훈련</h2><p>빠른 총량 기록과 동작 흐름 기록 중 필요한 방식을 선택합니다.</p></div><span class="microcopy">${esc(defenseTrainingModeLabel(draft.trainingMode))}</span></div><div id="defenseTrainingCreateEditor" class="defense-editor defense-training-editor">${defenseTrainingEditorHtml('create',{includeSave:true})}</div>`;}
function trainingBaserunningForm(){return `<div class="entry-title"><div><p class="section-kicker">RUNNING VOLUME</p><h2>주루 훈련</h2><p>도루 스타트·리드·슬라이딩·스프린트 등 훈련량을 세트로 기록합니다.</p></div></div><div class="form-grid"><label>훈련 종류<select id="trRunType"><option value="STEAL_START">도루 스타트</option><option value="LEAD_REACTION">리드/반응</option><option value="BASE_RUNNING">베이스러닝</option><option value="SLIDING">슬라이딩</option><option value="SPRINT">스프린트</option><option value="OTHER">기타</option></select></label><label>거리 m (선택)<input id="trRunDistance" type="number" min="0" /></label><label>최고 기록 sec (선택)<input id="trRunBest" type="number" min="0" step="0.01" /></label></div><div class="field-group"><span>횟수</span>${quantityHtml()}</div><button class="save-set" data-save-training="baserunning">훈련 세트 저장</button>`;}

function parentEvents(kind,id){return kind==='bf'?bfEvents(id):paEvents(id);}
function parentStore(kind){return kind==='bf'?'batterFaced':'plateAppearances';}
function parentTypeName(kind){return kind==='bf'?'타자':'타석';}
function sideDistribution(kind,p,events,key,labeler){
  const values=(events.length?events:[null]).map(event=>eventMatchup(kind,event,p)[key]||null),counts=new Map();for(const value of values)counts.set(value,(counts.get(value)||0)+1);
  if(counts.size===1)return labeler(values[0]);
  return ['R','L',null].filter(value=>counts.has(value)).map(value=>`${labeler(value)} ${counts.get(value)}구`).join(' / ');
}
function parentSideLine(kind,p,events=parentEvents(kind,p.id)){
  if(kind==='bf')return `${sideDistribution(kind,p,events,'pitcherSide',sideThrow)} · 상대 ${sideDistribution(kind,p,events,'batterSide',sideBat)}`;
  return `${sideDistribution(kind,p,events,'batterSide',sideBat)} · 상대 ${sideDistribution(kind,p,events,'pitcherSide',sideThrow)}`;
}
function pitchMatchupLine(kind,e,p){const matchup=eventMatchup(kind,e,p);return `${sideThrow(matchup.pitcherSide)} → ${sideBat(matchup.batterSide)}`;}
function resultTone(result){if(result===UNKNOWN_RESULT)return '';if(['K','SO'].includes(result))return 'strike';if(result==='BB')return 'ball';if(result==='HBP')return 'hbp';if(result)return 'inplay';return '';}
function parentResultLabel(p){return isRelievedParent(p)?'강판 중단':isUnknownParent(p)?'결과 미상':(p.result||'미완료');}
function pitchTone(kind,e){if(kind==='bf'){if(e.eventType==='ball')return 'ball';if(['called','swinging','foul'].includes(e.eventType))return 'strike';if(e.eventType==='inplay')return 'inplay';if(e.eventType==='hbp')return 'hbp';}else{if(e.eventType==='taken_ball')return 'ball';if(['taken_strike','swinging_strike','foul'].includes(e.eventType))return 'strike';if(e.eventType==='in_play')return 'inplay';if(e.eventType==='hbp')return 'hbp';}return '';}
function pitchCardLabel(kind,e){let text=LABELS[e.eventType]||e.eventType;if((e.eventType==='inplay'||e.eventType==='in_play')&&e.metadata?.result)text+=` · ${e.metadata.result}`;return text;}
function parentIsCurrent(kind,p){if(resumeContext?.kind===kind||p.activityDate!==todayKey()||p.completed||isUnknownParent(p)||isRelievedParent(p))return false;const live=kind==='bf'?currentBF(p.activityDate):currentPA(p.activityDate);return live?.id===p.id;}
function parentVisualState(kind,p){
  const editing=resumeContext?.kind===kind&&resumeContext.id===p.id&&!p.completed,current=parentIsCurrent(kind,p),unknown=isUnknownParent(p),relieved=kind==='bf'&&isRelievedParent(p),incomplete=!p.completed&&!unknown&&!relieved&&!current&&!editing;
  if(editing)return {key:'progress',label:'수정 중',statusClass:'editing',editing,current,unknown,relieved,incomplete};
  if(current)return {key:'progress',label:kind==='bf'?'현재 타자':'현재 타석',statusClass:'current',editing,current,unknown,relieved,incomplete};
  if(relieved)return {key:'relieved',label:'강판 중단',statusClass:'relieved',editing,current,unknown,relieved,incomplete};
  if(unknown)return {key:'unknown',label:'결과 미상',statusClass:'unknown',editing,current,unknown,relieved,incomplete};
  if(incomplete)return {key:'incomplete',label:'미완료',statusClass:'incomplete',editing,current,unknown,relieved,incomplete};
  return {key:'complete',label:parentResultLabel(p),statusClass:`complete ${resultTone(p.result)}`,editing,current,unknown,relieved,incomplete};
}
function parentCardHtml(kind,p,{forceExpanded=false,matchingEventIds=null}={}){
  const events=parentEvents(kind,p.id),bs=countBS(events,kind==='bf'?'pitching':'batting'),set=kind==='bf'?expandedBF:expandedPA;
  const state=parentVisualState(kind,p),{editing,current,unknown,relieved,incomplete}=state;
  const expanded=forceExpanded||editing||current||incomplete||relieved||set.has(p.id),tone=`tone-${Number(p.sequenceNo||0)%3}`;
  let summary='';
  if(p.completed)summary=`${events.length}구`;
  else if(relieved)summary=events.length?`${events.length}구 · B${bs.b} · S${bs.s}`:'투구 전';
  else if(unknown)summary=events.length?`${events.length}구 · B${bs.b} · S${bs.s}`:'세부 투구 기록 없음';
  else if(!events.length)summary='세부 투구 기록 없음';
  else summary=`B${bs.b} · S${bs.s}`;
  const filtering=matchingEventIds instanceof Set,matchNote=filtering?`조건 일치 ${matchingEventIds.size}/${events.length}구`:'';
  const eventHtml=events.map((e,i)=>{const details=[pitchMatchupLine(kind,e,p),gameSituationSummary(e.metadata?.situation)];if(e.metadata?.battedBall)details.push(`${e.metadata.battedBall}${e.metadata?.direction?` · ${{L:'좌',C:'중',R:'우'}[e.metadata.direction]||e.metadata.direction}`:''}`);const matchClass=filtering?(matchingEventIds.has(e.id)?'filter-match':'filter-muted'):'';return `<button type="button" class="pitch-log-row ${pitchTone(kind,e)} ${matchClass}" data-edit-pitch="${e.id}"><span class="pitch-no">${i+1}구</span><span class="pitch-log-copy"><b>${esc(pitchCardLabel(kind,e))}</b><small>${esc(details.join(' · '))}</small></span><i>수정</i></button>`;}).join('');
  const recordLabel=kind==='bf'?'투구':'타격',continueBtn=(incomplete||unknown)&&!editing?`<button type="button" class="parent-action primary" data-resume-parent="${kind}:${p.id}">계속 입력</button>`:'';
  const deleteBtn=`<button type="button" class="parent-action danger" data-delete-parent="${kind}:${p.id}">${recordLabel} 기록 삭제</button>`;
  const stateClass=`${editing?' is-editing':''}${current?' is-current':''}${incomplete?' is-incomplete':''}${unknown?' is-unknown':''}${relieved?' is-relieved':''}`;
  return `<article class="parent-card ${tone}${stateClass}"><div class="parent-card-head"><button type="button" class="parent-toggle" data-toggle-record="${kind}:${p.id}" aria-expanded="${expanded}"><span class="result-badge ${state.statusClass}">${esc(state.label)}</span><span class="parent-ident"><b>${parentSideLine(kind,p,events)} <em>/ ${esc(summary)}</em></b>${matchNote?`<small>${esc(matchNote)}</small>`:''}</span><span class="chev">${expanded?'⌃':'⌄'}</span></button></div>${expanded?`<div class="parent-card-body">${events.length?`<div class="pitch-log-list">${eventHtml}</div>`:`<div class="scope-note compact">세부 ${recordLabel} 기록이 없습니다. 기록은 직접 삭제하기 전까지 유지됩니다.</div>`}<div class="parent-card-foot"><span class="count-mini"><em class="b">B ${bs.b}</em><em class="s">S ${bs.s}</em></span><span class="parent-actions"><button type="button" class="parent-action" data-edit-parent="${kind}:${p.id}">${recordLabel} 기록 수정</button>${continueBtn}${deleteBtn}</span></div></div>`:''}</article>`;
}
function parentsFor(kind,date){return recordsFor(parentStore(kind)).filter(x=>x.activityDate===date).sort((a,b)=>b.sequenceNo-a.sequenceNo);}
function fieldTypeLabel(v){return {FRONT:'정면',FOREHAND:'포핸드',BACKHAND:'백핸드',CHARGE:'전진',FORWARD:'앞으로',STRAIGHT:'정면',LATERAL:'좌우',BACK:'뒤로'}[v]||'포구 형태 미입력';}
function throwTargetLabel(v){return {'1B':'1루','2B':'2루','3B':'3루',HOME:'홈',RELAY:'중계'}[v]||'';}
function defenseSourcePositionLabel(v){return {P:'투수',C:'포수','1B':'1루수','2B':'2루수','3B':'3루수',SS:'유격수',LF:'LF',CF:'CF',RF:'RF',RELAY:'중계',OTHER:'기타'}[v]||'미입력';}
function eventRecordActionsHtml(e,label){return `<span class="parent-actions"><button type="button" class="parent-action" data-edit-store="gameEvents" data-edit-id="${e.id}">${label} 기록 수정</button><button type="button" class="parent-action danger" data-delete-store="gameEvents" data-delete-id="${e.id}">${label} 기록 삭제</button></span>`;}
function defenseValueLabel(group,value){const maps={fieldDirection:{L:'왼쪽',C:'정면',R:'오른쪽'},fieldSpeed:{slow:'느림',medium:'보통',fast:'빠름'},fieldResult:{clean:'깔끔한 처리',recovered:'불안정 후 보완',failed:'처리 실패'},throwAccuracy:{accurate:'정확',high:'높음',low:'낮음',left:'왼쪽',right:'오른쪽',bounce:'바운드',catchable:'받을 수 있음 · 기존 형식',uncatchable:'벗어남 · 받기 불가'},incoming:{on_target:'정확',high:'높음',low:'낮음',left:'왼쪽',right:'오른쪽',wide:'좌우 벗어남 · 기존 형식',bounce:'바운드',uncatchable:'벗어남 · 받기 불가'},receiveResult:{clean:'깔끔한 수신',recovered:'어려운 공 보완',failed:'수신 실패',excluded:'평가 제외'},technique:{normal:'일반',stretch:'스트레치',scoop:'스쿱',tag:'태그 · 기존 방식',block:'블로킹',base_hold:'베이스 유지 · 기존 방식'},baseHold:{success:'성공',failed:'실패',na:'해당 없음'},tagExecution:{clean:'정확한 태그',recovered:'수습 후 태그',missed:'태그 빗나감',dropped:'태그 중 공 빠짐'},baseExecution:{secure:'정상 접촉',off_base:'접촉 후 이탈',missed:'미접촉'},outTiming:{early:'여유',close:'접전',late:'늦음',na:'평가 불가'},call:{out:'아웃',safe:'세이프',no_call:'판정 없음'},targetRunner:{BR:'타자주자',R1:'1루 주자',R2:'2루 주자',R3:'3루 주자',UNKNOWN:'대상 모름'},coverRole:{base_cover:'베이스 커버',backup:'백업',cutoff:'중계 위치',communication:'콜·의사소통'},coverTiming:{on_time:'제시간',late:'늦음',missed:'놓침'},coverResult:{correct:'정확히 수행',recovered:'늦었지만 보완',failed:'수행 실패'}};return maps[group]?.[value]||'미입력';}
function defenseJudgmentLabel(action){const rating=action.judgment?.rating;if(!rating)return '평가 안 함';const label={best:'최선',acceptable:'허용 가능',wrong:'잘못된 판단'}[rating],source={self:'본인',coach:'코치',video:'영상'}[action.judgment?.source];return `${label}${source?` · ${source}`:''}`;}
function defenseJudgmentDetailRows(action){const j=action.judgment||{},rows=[];if(!j.rating)return rows;if(action.type==='field'){if(j.reaction)rows.push(['첫 반응',{good:'빠름',normal:'보통',late:'늦음',wrong:'반대 방향'}[j.reaction]]);if(j.route)rows.push(['이동 경로',{direct:'효율적',adjusted:'수정함',inefficient:'비효율',na:'해당 없음'}[j.route]]);}else if(['throw','tag','base'].includes(action.type)){if(j.bestChoice)rows.push(['더 나은 선택',{hold:'공 보유',TAG:'주자 태그','1B':'1루','2B':'2루','3B':'3루',HOME:'홈',RELAY:'송구·중계'}[j.bestChoice]]);}else if(action.type==='receive'){if(j.positioning)rows.push(['위치 선정',{correct:'적절',late:'늦음',wrong:'잘못됨'}[j.positioning]]);if(j.nextReady)rows.push(['다음 플레이',{ready:'준비됨',late:'늦음',na:'해당 없음'}[j.nextReady]]);}else if(j.communication)rows.push(['의사소통',{good:'적절',late:'늦음',missed:'없었음',na:'해당 없음'}[j.communication]]);return rows.filter(([,value])=>value);}
function defenseActionDetailRows(action){
  if(action.type==='field'){const rows=[['타구',action.battedBall||'미입력'],['타구 방향',defenseValueLabel('fieldDirection',action.direction)],['타구 속도',defenseValueLabel('fieldSpeed',action.speed)]];if(['GB','BUNT'].includes(action.battedBall)||action.fieldingType)rows.push(['처리 방법',fieldTypeLabel(action.fieldingType)]);rows.push(['처리 결과',defenseValueLabel('fieldResult',action.result)]);return rows;}
  if(action.type==='throw'){const rows=[['목적지',throwTargetLabel(action.target)||action.target||'미입력'],['송구 정확도',defenseValueLabel('throwAccuracy',action.accuracy)],['송구 TLU',n2(action.tlu??0)]];if(action.distance!==null&&action.distance!==undefined)rows.push(['거리',`${action.distance} m`]);if(action.velocity!==null&&action.velocity!==undefined)rows.push(['구속',`${action.velocity} km/h`]);return rows;}
  if(action.type==='receive'){const rows=[['받은 위치',throwTargetLabel(action.target)||action.target||'미입력'],['보낸 위치',defenseSourcePositionLabel(action.sourcePosition)],['송구 형태',defenseValueLabel('incoming',action.incoming)],['받기 방법',defenseValueLabel('technique',action.technique)],['수신 결과',defenseValueLabel('receiveResult',action.result)]];if(action.baseHold)rows.push(['베이스 접촉 유지',defenseValueLabel('baseHold',action.baseHold)]);return rows;}
  if(action.type==='tag')return [['태그 대상',defenseValueLabel('targetRunner',action.targetRunner)],['태그 실행',defenseValueLabel('tagExecution',action.execution)],['타이밍',defenseValueLabel('outTiming',action.timing)],['심판 판정',defenseValueLabel('call',action.call)]];
  if(action.type==='base')return [['터치 베이스',throwTargetLabel(action.base)||action.base||'미입력'],['베이스 접촉',defenseValueLabel('baseExecution',action.execution)],['타이밍',defenseValueLabel('outTiming',action.timing)],['심판 판정',defenseValueLabel('call',action.call)]];
  return [['수비 역할',defenseValueLabel('coverRole',action.role)],['도착 시점',defenseValueLabel('coverTiming',action.timing)],['수행 결과',defenseValueLabel('coverResult',action.result)]];
}
function defenseRecordTimelineHtml(draft){return `<div class="defense-record-timeline">${draft.actions.map((action,index)=>{const status=defenseActionStatus(action),rows=defenseActionDetailRows(action),judgmentRows=defenseJudgmentDetailRows(action),teammate=draft.actions[index-1]?.type==='throw'&&action.type==='receive'?'<div class="defense-record-bridge">동료 선수 경유 후 다시 참여</div>':'';return `${teammate}<section class="defense-record-step status-${status.tone}"><header><span>${index+1}</span><div><b>${esc(defenseActionLabel(action.type))}</b><small>${esc(status.label)}</small></div></header><div class="defense-detail-grid">${rows.map(([label,value])=>`<div><span>${esc(label)}</span><b>${esc(value)}</b></div>`).join('')}</div><div class="defense-judgment-line"><span>판단 평가</span><b>${esc(defenseJudgmentLabel(action))}</b></div>${judgmentRows.length||action.judgment?.note?`<div class="defense-judgment-details">${judgmentRows.map(([label,value])=>`<div><span>${esc(label)}</span><b>${esc(value)}</b></div>`).join('')}${action.judgment?.note?`<p>${esc(action.judgment.note)}</p>`:''}</div>`:''}</section>`;}).join('')}</div>`;}
function defenseCardHtml(e){
  const draft=normalizeDefenseMetadata(e.metadata||{}),expanded=expandedDefense.has(e.id),statuses=defenseCardStatuses(draft),tone=defenseOverallTone(draft),isPrevious=draft.legacy||draft.previousFormat,missing=isPrevious?0:defenseMissingFields(draft).length,flow=draft.actions.map(action=>defenseActionShortLabel(action.type)).join(' → ')||'동작 미입력',headline=`${draft.position||'포지션 미입력'} · ${flow}`,meta=[defenseOutcomeText(draft),defenseOfficialText(draft)];if(isPrevious)meta.push('기존 형식');else if(missing)meta.push(`미입력 ${missing}`);else meta.push(`${draft.actions.length}동작`);
  const runnerLabel=runners=>runners===null?'미입력':runners.length?runners.map(x=>({'1B':'1루','2B':'2루','3B':'3루'}[x])).join(' · '):'주자 없음',runners=runnerLabel(draft.runnersAfter),startRunners=runnerLabel(draft.situation?.runners??null),commonRows=[['포지션',draft.position||'미입력'],['시작 아웃 카운트',draft.situation?.outs===null?'미입력':`${draft.situation.outs}아웃`],['시작 주자 상황',startRunners],['이번 플레이 아웃',draft.outsRecorded===null?'미입력':`${draft.outsRecorded}개`],['플레이 후 주자',runners],['공식 기록',defenseOfficialText(draft)],['송구 TLU',n2(defenseThrowTLU(draft))]],judgment=defenseJudgmentSummary(draft);
  return `<article class="parent-card defense-card field-${tone}"><div class="parent-card-head"><button type="button" class="parent-toggle" data-toggle-record="defense:${e.id}" aria-expanded="${expanded}"><span class="defense-result-stack">${statuses.map(status=>`<b class="defense-result ${status.tone}">${esc(status.label)}</b>`).join('')}</span><span class="parent-ident"><b>${esc(headline)}</b><small>${esc(meta.join(' · '))}</small></span><span class="chev">${expanded?'⌃':'⌄'}</span></button></div>${expanded?`<div class="parent-card-body">${draft.legacy?'<p class="defense-legacy-note">기존 수비 기록입니다. 수정하면 새 순차 동작 형식으로 안전하게 전환됩니다.</p>':draft.previousFormat?'<p class="defense-legacy-note">이전 플레이 결과 형식의 기록입니다. 수정하면 새 결과 형식으로 전환됩니다.</p>':''}${defenseRecordTimelineHtml(draft)}<section class="defense-record-result"><h4>플레이 상황 및 결과</h4><div class="defense-detail-grid">${commonRows.map(([label,value])=>`<div><span>${esc(label)}</span><b>${esc(value)}</b></div>`).join('')}</div>${judgment.evaluated?`<p class="defense-judgment-summary">판단 평가 ${judgment.evaluated}건 · 적절 ${judgment.appropriate} · 잘못된 판단 ${judgment.wrong}</p>`:''}${draft.note?`<p class="defense-note">${esc(draft.note)}</p>`:''}</section><div class="parent-card-foot actions-only">${eventRecordActionsHtml(e,'수비')}</div></div>`:''}</article>`;
}
function baserunningCardHtml(e){const m=e.metadata||{},success=m.result==='SUCCESS',expanded=expandedBaserunning.has(e.id),from={"1B":'1루',"2B":'2루',"3B":'3루'}[m.from]||m.from||'?',to={"2B":'2루',"3B":'3루',HOME:'홈'}[m.to]||m.to||'?',situation=gameSituationSummary(m.situation);return `<article class="parent-card baserunning-card ${success?'run-success':'run-failed'}"><div class="parent-card-head"><button type="button" class="parent-toggle" data-toggle-record="baserunning:${e.id}" aria-expanded="${expanded}"><span class="result-badge ${success?'success':'failed'}">${success?'성공':'실패'}</span><span class="parent-ident"><b>도루 · ${esc(from)} → ${esc(to)}</b><small>${esc(situation)}</small></span><span class="chev">${expanded?'⌃':'⌄'}</span></button></div>${expanded?`<div class="parent-card-body compact-action-body"><section class="defense-record-result baserunning-situation-detail"><h4>도루 시작 상황</h4><div class="defense-detail-grid"><div><span>아웃·주자</span><b>${esc(situation)}</b></div></div></section><div class="parent-card-foot actions-only">${eventRecordActionsHtml(e,'도루')}</div></div>`:''}</article>`;}
function renderRecent(){
  const el=$('#recentInputList');
  if(ui.inputMode==='game'&&['pitching','hitting'].includes(ui.domain)){
    const kind=ui.domain==='pitching'?'bf':'pa',parents=parentsFor(kind,ui.inputDate);let html=parents.map(p=>parentCardHtml(kind,p)).join('');
    if(ui.domain==='pitching'){
      const aux=recordsFor('gameEvents').filter(e=>e.activityDate===ui.inputDate&&e.domain==='pitching'&&!e.parentId).sort((a,b)=>new Date(b.recordedAt)-new Date(a.recordedAt));
      const exits=aux.filter(e=>e.eventType==='pitching_exit'),throws=aux.filter(e=>e.eventType!=='pitching_exit');
      if(exits.length)html+=`<div class="aux-log pitching-exit-log"><b>강판 기록</b>${exits.map(pitchingExitRowHtml).join('')}</div>`;
      if(throws.length)html+=`<div class="aux-log"><b>견제 · 연습투구</b>${throws.map(e=>recordRowHtml({store:'gameEvents',id:e.id,activityDate:e.activityDate,recordedAt:e.recordedAt,mode:'game',domain:e.domain,label:gameEventLabel(e),sub:gameEventSub(e)})).join('')}</div>`;
    }
    el.innerHTML=html||'<div class="scope-note">아직 입력된 기록이 없습니다.</div>';return;
  }
  if(ui.inputMode==='game'&&ui.domain==='defense'){const events=recordsFor('gameEvents').filter(e=>e.activityDate===ui.inputDate&&e.domain==='defense').sort((a,b)=>new Date(b.recordedAt)-new Date(a.recordedAt));el.innerHTML=events.length?events.map(defenseCardHtml).join(''):'<div class="scope-note">아직 입력된 기록이 없습니다.</div>';return;}
  if(ui.inputMode==='game'&&ui.domain==='baserunning'){const events=recordsFor('gameEvents').filter(e=>e.activityDate===ui.inputDate&&e.domain==='baserunning').sort((a,b)=>new Date(b.recordedAt)-new Date(a.recordedAt));el.innerHTML=events.length?events.map(baserunningCardHtml).join(''):'<div class="scope-note">아직 입력된 기록이 없습니다.</div>';return;}
  if(ui.inputMode==='training'){const sets=recordsFor('trainingSets').filter(s=>s.activityDate===ui.inputDate&&(ui.domain==='all'||s.domain===ui.domain)).sort((a,b)=>new Date(b.recordedAt)-new Date(a.recordedAt));el.innerHTML=sets.length?sets.map(trainingCardHtml).join(''):'<div class="scope-note">아직 입력된 기록이 없습니다.</div>';return;}
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
  if(e.domain==='pitching'){if(e.eventType==='pitching_exit')return '투구 · 강판';if(e.eventType==='inplay')return `투구 · IN PLAY · ${e.metadata?.result||''}`;return `투구 · ${LABELS[e.eventType]||e.eventType}`;}
  if(['hitting','batting'].includes(e.domain)){if(e.eventType==='in_play')return `타격 · IN PLAY · ${e.metadata?.result||''}`;return `타격 · ${LABELS[e.eventType]||e.eventType}`;}
  if(e.domain==='defense'){const draft=normalizeDefenseMetadata(e.metadata||{}),flow=draft.actions.map(action=>defenseActionShortLabel(action.type)).join(' → ')||'동작 미입력';return `수비 · ${draft.position||'포지션 미입력'} · ${flow}`;}
  if(e.domain==='baserunning')return `도루 ${e.metadata?.from||''}→${e.metadata?.to||''} · ${e.metadata?.result==='SUCCESS'?'성공':'실패'}`;
  return e.eventType;
}
function gameEventSub(e){const pieces=[`${fmtDate(e.activityDate)} 경기`];if(e.eventType==='pitching_exit'){pieces.push(sideThrow(e.metadata?.pitcherSide));if(e.metadata?.unfinishedBatterFacedId)pieces.push(`${Number(e.metadata?.pitchCount)||0}구 · B${Number(e.metadata?.balls)||0}-S${Number(e.metadata?.strikes)||0}`);}else if(e.domain==='pitching')pieces.push(`TLU ${n2(GAME_TLU[e.eventType]||e.metadata?.tlu||0)}`);if(Object.prototype.hasOwnProperty.call(e.metadata||{},'situation'))pieces.push(gameSituationSummary(e.metadata.situation));if(e.metadata?.battedBall)pieces.push(e.metadata.battedBall);if(e.metadata?.direction)pieces.push({L:'좌',C:'중',R:'우'}[e.metadata.direction]||e.metadata.direction);return pieces.join(' · ');}
function trainingSetLabel(s){return `${DOMAIN_LABEL[s.domain]} 훈련 · ${LABELS[s.trainingType]||s.trainingType}`;}
function trainingSetSub(s){const bits=[`${s.quantity} ${s.unit==='throws'?'throws':s.unit==='swings'?'swings':'reps'}`];if(s.side)bits.push(s.domain==='pitching'?sideThrow(s.side):sideBat(s.side));if(s.metadata?.velocity)bits.push(`${s.metadata.velocity} km/h`);if(s.domain==='defense'){const stats=defenseTrainingStats(s),draft=normalizeDefenseTrainingRecord(s);bits.push(defenseTrainingModeLabel(draft.trainingMode));if(draft.trainingMode==='scenario')bits.push(`동작 ${stats.actionReps} reps`);if(stats.throwCount){bits.push(`송구 ${stats.throwCount}회`);bits.push(`${n2(stats.throwTLU)} TLU`);}}else if(Number(s.tluTotal))bits.push(`${n2(s.tluTotal)} TLU`);return bits.join(' · ');}
function trainingUnitShort(s){return s.unit==='throws'?'THROWS':s.unit==='swings'?'SWINGS':'REPS';}
function trainingOutcomeLine(outcomes){if(!outcomes?.evaluated)return '';return `<div class="training-card-outcomes"><span class="target">목표대로 <b>${outcomes.target||0}</b></span><span class="adjust">보완 필요 <b>${outcomes.adjust||0}</b></span><span class="failed">실패·중단 <b>${outcomes.failed||0}</b></span><small>미평가 ${outcomes.unassessed||0} reps</small></div>`;}
function trainingRecordActionsHtml(s){const label=`${DOMAIN_LABEL[s.domain]} 훈련`;return `<span class="parent-actions"><button type="button" class="parent-action" data-edit-store="trainingSets" data-edit-id="${s.id}">${label} 수정</button><button type="button" class="parent-action danger" data-delete-store="trainingSets" data-delete-id="${s.id}">${label} 삭제</button></span>`;}
function defenseTrainingRecordTimelineHtml(draft,quantity){return `<div class="defense-record-timeline training-record-timeline">${draft.actions.map((action,index)=>{const count=defenseTrainingActionCount(action,quantity),rows=[['실제 동작',`${count}회`]];if(action.type==='field'){rows.push(['타구',action.battedBall||'미입력'],['난이도',defenseTrainingValueLabel('difficulty',action.difficulty)],['처리 형태',defenseTrainingValueLabel('fieldingType',action.fieldingType)]);}else if(action.type==='receive')rows.push(['받는 위치',defenseTrainingValueLabel('target',action.target)],['들어오는 송구',defenseTrainingValueLabel('incoming',action.incoming)],['기술',defenseTrainingValueLabel('receiveTechnique',action.technique)]);else if(action.type==='tag')rows.push(['대상',defenseTrainingValueLabel('runner',action.targetRunner)],['방식',defenseTrainingValueLabel('tagTechnique',action.technique)]);else if(action.type==='base')rows.push(['베이스',defenseTrainingValueLabel('target',action.base)],['목적',defenseTrainingValueLabel('basePurpose',action.purpose)]);else if(action.type==='throw')rows.push(['목적지',defenseTrainingValueLabel('target',action.target)],['부하',`${n2(action.tlu)} TLU / 회`]);else rows.push(['역할',defenseTrainingValueLabel('cover',action.role)]);return `<section class="defense-record-step"><header><span>${index+1}</span><div><b>${esc(defenseTrainingActionLabel(action.type))}</b><small>${count}회 · ${esc(defenseTrainingActionSummary(action))}</small></div></header><div class="defense-detail-grid">${rows.map(([label,value])=>`<div><span>${esc(label)}</span><b>${esc(value)}</b></div>`).join('')}</div></section>`;}).join('')}</div>`;}
function trainingCardHtml(s){
  const expanded=expandedTraining.has(s.id),domain=DOMAIN_LABEL[s.domain]||s.domain,type=LABELS[s.trainingType]||s.trainingType,unit=trainingUnitShort(s);let headline=`${domain} 훈련 · ${type}`,sub=trainingSetSub(s),body='',outcomes=null;
  if(s.domain==='defense'){
    const draft=normalizeDefenseTrainingRecord(s),stats=defenseTrainingStats(s);outcomes=stats.outcomes;headline=draft.trainingMode==='scenario'?`수비 훈련 · ${draft.position} · ${stats.flow||'동작 미입력'}`:`수비 훈련 · 간단 기록 · ${type}`;
    const rows=[['기록 방식',defenseTrainingModeLabel(draft.trainingMode)],['훈련 Reps',stats.reps],['Action Reps',draft.trainingMode==='scenario'?stats.actionReps:'—'],['실제 송구',`${stats.throwCount}회`],['Throw TLU',n2(stats.throwTLU)],['TLU / Rep',stats.tluPerRep==null?'—':n2(stats.tluPerRep)]];
    body=`${draft.legacy?'<p class="defense-legacy-note">기존 수비 훈련 기록입니다. 간단 기록으로 안전하게 표시하며 수정하면 새 형식으로 저장됩니다.</p>':''}${draft.trainingMode==='scenario'?defenseTrainingRecordTimelineHtml(draft,s.quantity):''}<section class="defense-record-result training-record-summary"><h4>훈련량 요약</h4><div class="defense-detail-grid">${rows.map(([label,value])=>`<div><span>${esc(label)}</span><b>${esc(value)}</b></div>`).join('')}</div>${trainingOutcomeLine(outcomes)}${draft.note?`<p class="defense-note">${esc(draft.note)}</p>`:''}</section>`;
  }else{
    const m=s.metadata||{};outcomes=m.outcomes?{...m.outcomes,evaluated:(Number(m.outcomes.target)||0)+(Number(m.outcomes.adjust)||0)+(Number(m.outcomes.failed)||0),unassessed:Math.max(0,Number(s.quantity)-((Number(m.outcomes.target)||0)+(Number(m.outcomes.adjust)||0)+(Number(m.outcomes.failed)||0)))}:null;const rows=[['훈련 종류',type],['훈련량',`${s.quantity} ${unit.toLowerCase()}`]];if(s.side)rows.push(['방향',s.domain==='pitching'?sideThrow(s.side):sideBat(s.side)]);if(s.domain==='pitching')rows.push(['TLU / 회',n2(s.tluPerRep||0)],['훈련 TLU',n2(s.tluTotal||0)]);if(s.domain==='hitting'&&m.velocity)rows.push(['구속',`${m.velocity} km/h`]);if(s.domain==='baserunning'&&m.distanceM)rows.push(['거리',`${m.distanceM} m`]);if(s.domain==='baserunning'&&m.bestTime)rows.push(['최고 기록',`${m.bestTime} sec`]);body=`<section class="defense-record-result training-record-summary"><h4>훈련 세트 상세</h4><div class="defense-detail-grid">${rows.map(([label,value])=>`<div><span>${esc(label)}</span><b>${esc(value)}</b></div>`).join('')}</div>${trainingOutcomeLine(outcomes)}${m.note?`<p class="defense-note">${esc(m.note)}</p>`:''}</section>`;
  }
  return `<article class="parent-card training-card training-${s.domain}"><div class="parent-card-head"><button type="button" class="parent-toggle" data-toggle-record="training:${s.id}" aria-expanded="${expanded}"><span class="result-badge training-volume-badge"><b>${s.quantity}</b><small>${unit}</small></span><span class="parent-ident"><b>${esc(headline)}</b><small>${esc(sub)}</small></span><span class="chev">${expanded?'⌃':'⌄'}</span></button></div>${expanded?`<div class="parent-card-body">${body}<div class="parent-card-foot actions-only">${trainingRecordActionsHtml(s)}</div></div>`:''}</article>`;
}
function recordRowHtml(r){return `<div class="recent-item"><span class="record-time">${fmtTime(r.recordedAt)}</span><span class="record-icon">${r.mode==='game'?'G':'T'}</span><span class="record-copy"><b>${esc(r.label)}</b><small>${esc(r.sub||'')}</small></span><span class="record-actions"><button data-edit-store="${r.store}" data-edit-id="${r.id}">수정</button><button data-delete-store="${r.store}" data-delete-id="${r.id}">삭제</button></span></div>`;}
function pitchingExitRowHtml(e){return `<div class="recent-item pitching-exit-row"><span class="record-time">${fmtTime(e.recordedAt)}</span><span class="record-icon">↘</span><span class="record-copy"><b>${esc(gameEventLabel(e))}</b><small>${esc(gameEventSub(e))}</small></span><span class="record-actions"><button class="cancel-exit-action" data-cancel-pitching-exit="${e.id}">강판 취소</button></span></div>`;}
function historySection(title,content,count){return content?`<div class="history-subsection"><h4>${title}<span>${count}</span></h4>${content}</div>`:'';}
function normalizeHistoryFilters(){
  const gameParents=ui.historyMode!=='training'&&['all','pitching','hitting'].includes(ui.historyDomain);if(!gameParents)ui.historyStatus='all';
  if(ui.historyDomain==='hitting'&&ui.historyStatus==='relieved')ui.historyStatus='all';
  if(!['pitching','hitting'].includes(ui.historyDomain)){ui.historyOwnSide='all';ui.historyOppSide='all';}
  if(ui.historyMode==='training')ui.historyOppSide='all';
  if(ui.historyDomain!=='defense'||ui.historyMode==='training'){ui.historyDefenseStatus='all';ui.historyDefenseAction='all';ui.historyFieldResult='all';ui.historyThrowResult='all';ui.historyReceiveResult='all';ui.historyTagResult='all';ui.historyBaseResult='all';ui.historyOfficial='all';}
  if(ui.historyDomain!=='baserunning'||ui.historyMode==='training')ui.historyRunResult='all';
}
function historyParentMatchesStatus(kind,p){return ui.historyStatus==='all'||parentVisualState(kind,p).key===ui.historyStatus;}
function historyEventMatchesSides(kind,event,parent){const matchup=eventMatchup(kind,event,parent),own=kind==='bf'?matchup.pitcherSide:matchup.batterSide,opp=kind==='bf'?matchup.batterSide:matchup.pitcherSide;return (ui.historyOwnSide==='all'||own===ui.historyOwnSide)&&(ui.historyOppSide==='all'||opp===ui.historyOppSide);}
function historyParentEntries(kind,date){
  const sideFiltering=ui.historyOwnSide!=='all'||ui.historyOppSide!=='all',out=[];
  for(const p of parentsFor(kind,date)){if(!historyParentMatchesStatus(kind,p))continue;const events=parentEvents(kind,p.id),matching=events.filter(e=>historyEventMatchesSides(kind,e,p));if(sideFiltering&&events.length&&!matching.length)continue;if(sideFiltering&&!events.length&&!historyEventMatchesSides(kind,null,p))continue;out.push({parent:p,matchingEventIds:sideFiltering&&events.length?new Set(matching.map(e=>e.id)):null});}
  return out;
}
function historyPitchingAux(date){
  return recordsFor('gameEvents').filter(e=>e.activityDate===date&&e.domain==='pitching'&&!e.parentId).filter(e=>{
    if(ui.historyStatus!=='all'&&!(ui.historyStatus==='relieved'&&e.eventType==='pitching_exit'))return false;
    const own=e.metadata?.throwSide||e.metadata?.pitcherSide||null,opp=e.metadata?.batterSide||null;if(ui.historyOwnSide!=='all'&&own!==ui.historyOwnSide)return false;if(ui.historyOppSide!=='all'&&opp!==ui.historyOppSide)return false;return true;
  }).sort((a,b)=>new Date(b.recordedAt)-new Date(a.recordedAt));
}
function historyDefenseEvents(date){
  if(ui.historyStatus!=='all')return [];
  return recordsFor('gameEvents').filter(e=>{
    if(e.activityDate!==date||e.domain!=='defense')return false;const draft=normalizeDefenseMetadata(e.metadata||{}),isPrevious=draft.legacy||draft.previousFormat,missing=isPrevious?0:defenseMissingFields(draft).length;
    if(ui.historyDefenseStatus==='complete'&&(isPrevious||missing))return false;if(ui.historyDefenseStatus==='incomplete'&&(isPrevious||!missing))return false;if(ui.historyDefenseStatus==='official_missing'&&draft.official.status!=='missing')return false;if(ui.historyDefenseStatus==='legacy'&&!isPrevious)return false;
    if(ui.historyDefenseAction!=='all'&&!draft.actions.some(action=>action.type===ui.historyDefenseAction))return false;
    if(ui.historyFieldResult!=='all'&&!draft.actions.some(action=>action.type==='field'&&(ui.historyFieldResult==='missing'?!action.result:action.result===ui.historyFieldResult)))return false;
    if(ui.historyThrowResult!=='all'&&!draft.actions.some(action=>action.type==='throw'&&(ui.historyThrowResult==='missing'?!action.accuracy:defenseThrowQuality(action)===ui.historyThrowResult)))return false;
    if(ui.historyReceiveResult!=='all'&&!draft.actions.some(action=>action.type==='receive'&&(ui.historyReceiveResult==='missing'?!action.result:action.result===ui.historyReceiveResult)))return false;
    if(ui.historyTagResult!=='all'&&!draft.actions.some(action=>action.type==='tag'&&(ui.historyTagResult==='missing'?(!action.execution||!action.timing||!action.call):['missed','dropped'].includes(ui.historyTagResult)?action.execution===ui.historyTagResult:action.call===ui.historyTagResult)))return false;
    if(ui.historyBaseResult!=='all'&&!draft.actions.some(action=>action.type==='base'&&(ui.historyBaseResult==='missing'?(!action.base||!action.execution||!action.timing||!action.call):['off_base','missed'].includes(ui.historyBaseResult)?action.execution===ui.historyBaseResult:action.call===ui.historyBaseResult)))return false;
    if(ui.historyOfficial!=='all'){if(['po','a','e','dp'].includes(ui.historyOfficial)&&!draft.official[ui.historyOfficial])return false;if(ui.historyOfficial==='none'&&draft.official.status!=='none')return false;if(ui.historyOfficial==='missing'&&draft.official.status!=='missing')return false;}
    return true;
  }).sort((a,b)=>new Date(b.recordedAt)-new Date(a.recordedAt));
}
function historyBaserunningEvents(date){if(ui.historyStatus!=='all')return [];return recordsFor('gameEvents').filter(e=>e.activityDate===date&&e.domain==='baserunning'&&(ui.historyRunResult==='all'||e.metadata?.result===ui.historyRunResult)).sort((a,b)=>new Date(b.recordedAt)-new Date(a.recordedAt));}
function historyTrainingSets(date,domain){
  if(ui.historyStatus!=='all'||ui.historyOppSide!=='all')return [];
  return recordsFor('trainingSets').filter(s=>s.activityDate===date&&s.domain===domain&&(!['pitching','hitting'].includes(domain)||ui.historyOwnSide==='all'||s.side===ui.historyOwnSide)).sort((a,b)=>new Date(b.recordedAt)-new Date(a.recordedAt));
}
function historyDateRecordCount(date){
  let count=0;if(ui.historyMode!=='training'){
    if(['all','pitching'].includes(ui.historyDomain))count+=historyParentEntries('bf',date).length+historyPitchingAux(date).length;
    if(['all','hitting'].includes(ui.historyDomain))count+=historyParentEntries('pa',date).length;
    if(['all','defense'].includes(ui.historyDomain))count+=historyDefenseEvents(date).length;
    if(['all','baserunning'].includes(ui.historyDomain))count+=historyBaserunningEvents(date).length;
  }
  if(ui.historyMode!=='game'){const domains=ui.historyDomain==='all'?['pitching','hitting','defense','baserunning']:[ui.historyDomain];for(const domain of domains)count+=historyTrainingSets(date,domain).length;}
  return count;
}
function historyNavigationDates(){
  const raw=[...recordsFor('gameEvents'),...recordsFor('trainingSets'),...recordsFor('batterFaced'),...recordsFor('plateAppearances')];return [...new Set(raw.map(x=>x.activityDate).filter(Boolean))].filter(historyDateRecordCount).sort();
}
function historyRange(){return anchoredAnalysisRange({anchor:ui.historyAnchor||todayKey(),period:ui.historyPeriod,activityDates:historyNavigationDates()});}
function moveHistoryAnchor(direction){const nav=activityDateNavigation(ui.historyAnchor||todayKey(),historyNavigationDates()),target=direction<0?nav.previous:nav.next;if(!target)return;ui.historyAnchor=target;renderHistory();}
function resetHistoryConditions({render=true}={}){ui.historyStatus='all';ui.historyOwnSide='all';ui.historyOppSide='all';ui.historyDefenseStatus='all';ui.historyDefenseAction='all';ui.historyFieldResult='all';ui.historyThrowResult='all';ui.historyReceiveResult='all';ui.historyTagResult='all';ui.historyBaseResult='all';ui.historyOfficial='all';ui.historyRunResult='all';if(render)renderHistory();}
function historyFilterGroup(label,key,options){const current=ui[key];return `<div class="history-filter-group"><span>${esc(label)}</span><div class="history-filter-options">${options.map(([value,text])=>`<button type="button" data-history-filter="${key}:${value}" class="${current===value?'active':''}">${esc(text)}</button>`).join('')}</div></div>`;}
function historyConditionText(){
  const values=[],statusLabels={complete:'완료',progress:'진행 중',incomplete:'미완료',unknown:'결과 미상',relieved:'강판 중단'};if(ui.historyStatus!=='all')values.push(statusLabels[ui.historyStatus]||ui.historyStatus);
  if(ui.historyOwnSide!=='all')values.push(ui.historyDomain==='pitching'?(ui.historyOwnSide==='R'?'우투':'좌투'):(ui.historyOwnSide==='R'?'우타':'좌타'));
  if(ui.historyOppSide!=='all')values.push(ui.historyDomain==='pitching'?(ui.historyOppSide==='R'?'우타 상대':'좌타 상대'):(ui.historyOppSide==='R'?'우투 상대':'좌투 상대'));
  const fieldLabels={clean:'처리 성공',recovered:'처리 보완',failed:'처리 실패',missing:'처리 미입력'},throwLabels={accurate:'송구 정확',catchable:'송구 가능',uncatchable:'송구 불가',missing:'송구 미입력'},receiveLabels={clean:'수신 성공',recovered:'수신 보완',failed:'수신 실패',excluded:'평가 제외',missing:'수신 미입력'},tagLabels={out:'태그 아웃',safe:'태그 세이프',no_call:'태그 판정 없음',missed:'태그 빗나감',dropped:'태그 중 공 빠짐',missing:'태그 미입력'},baseLabels={out:'베이스 아웃',safe:'베이스 세이프',no_call:'베이스 판정 없음',off_base:'베이스 이탈',missed:'베이스 미접촉',missing:'베이스 미입력'},defenseStatusLabels={complete:'입력 완료',incomplete:'미입력 있음',official_missing:'공식 미입력',legacy:'기존 형식'},officialLabels={po:'공식 PO',a:'공식 A',e:'공식 E',dp:'공식 DP',none:'공식 기록 없음',missing:'공식 기록 미입력'};
  if(ui.historyDefenseStatus!=='all')values.push(defenseStatusLabels[ui.historyDefenseStatus]);if(ui.historyDefenseAction!=='all')values.push(defenseActionLabel(ui.historyDefenseAction));if(ui.historyFieldResult!=='all')values.push(fieldLabels[ui.historyFieldResult]);if(ui.historyThrowResult!=='all')values.push(throwLabels[ui.historyThrowResult]);if(ui.historyReceiveResult!=='all')values.push(receiveLabels[ui.historyReceiveResult]);if(ui.historyTagResult!=='all')values.push(tagLabels[ui.historyTagResult]);if(ui.historyBaseResult!=='all')values.push(baseLabels[ui.historyBaseResult]);if(ui.historyOfficial!=='all')values.push(officialLabels[ui.historyOfficial]);if(ui.historyRunResult!=='all')values.push(ui.historyRunResult==='SUCCESS'?'도루 성공':'도루 실패');return values.length?values.join(' · '):'전체 조건';
}
function renderHistoryConditions(){
  const fields=[];
  if(ui.historyMode!=='training'&&['all','pitching','hitting'].includes(ui.historyDomain)){const options=[['all','전체'],['complete','완료'],['progress','진행 중'],['incomplete','미완료'],['unknown','결과 미상']];if(ui.historyDomain!=='hitting')options.push(['relieved','강판 중단']);fields.push(historyFilterGroup('기록 상태','historyStatus',options));}
  if(['pitching','hitting'].includes(ui.historyDomain)){fields.push(historyFilterGroup(ui.historyDomain==='pitching'?'투구 방향':'타격 방향','historyOwnSide',[['all','전체'],['R',ui.historyDomain==='pitching'?'우투':'우타'],['L',ui.historyDomain==='pitching'?'좌투':'좌타']]));if(ui.historyMode!=='training')fields.push(historyFilterGroup(ui.historyDomain==='pitching'?'상대 타자':'상대 투수','historyOppSide',[['all','전체'],['R',ui.historyDomain==='pitching'?'우타':'우투'],['L',ui.historyDomain==='pitching'?'좌타':'좌투']]));}
  if(ui.historyMode!=='training'&&ui.historyDomain==='defense'){
    fields.push(historyFilterGroup('데이터 상태','historyDefenseStatus',[['all','전체'],['complete','입력 완료'],['incomplete','미입력 있음'],['official_missing','공식 미입력'],['legacy','기존 형식']]));
    fields.push(historyFilterGroup('수비 동작','historyDefenseAction',[['all','전체'],['field','타구 처리'],['receive','송구 받기'],['tag','주자 태그'],['base','베이스 터치'],['throw','송구'],['cover','커버·백업']]));
    fields.push(historyFilterGroup('타구 처리','historyFieldResult',[['all','전체'],['clean','성공'],['recovered','보완'],['failed','실패'],['missing','미입력']]));
    fields.push(historyFilterGroup('송구 정확도','historyThrowResult',[['all','전체'],['accurate','정확'],['catchable','받기 가능'],['uncatchable','받기 불가'],['missing','미입력']]));
    fields.push(historyFilterGroup('송구 받기','historyReceiveResult',[['all','전체'],['clean','성공'],['recovered','보완'],['failed','실패'],['excluded','평가 제외'],['missing','미입력']]));
    fields.push(historyFilterGroup('주자 태그','historyTagResult',[['all','전체'],['out','아웃'],['safe','세이프'],['no_call','판정 없음'],['missed','빗나감'],['dropped','공 빠짐'],['missing','미입력']]));
    fields.push(historyFilterGroup('베이스 터치','historyBaseResult',[['all','전체'],['out','아웃'],['safe','세이프'],['no_call','판정 없음'],['off_base','접촉 후 이탈'],['missed','미접촉'],['missing','미입력']]));
    fields.push(historyFilterGroup('공식 기록','historyOfficial',[['all','전체'],['po','PO'],['a','A'],['e','E'],['dp','DP'],['none','없음'],['missing','미입력']]));
  }
  if(ui.historyMode!=='training'&&ui.historyDomain==='baserunning')fields.push(historyFilterGroup('도루 결과','historyRunResult',[['all','전체'],['SUCCESS','성공'],['FAILED','실패']]));
  $('#historyConditionFields').innerHTML=fields.join('')||'<p class="history-condition-empty">현재 선택에는 적용할 상세 조건이 없습니다.</p>';$('#historyConditionSummary').textContent=historyConditionText();const details=$('#historyConditions');details.hidden=!fields.length;if(fields.length&&!historyConditionsInitialized){details.open=window.innerWidth>=900;historyConditionsInitialized=true;}
}
function renderHistoryControls(range,availableDates,resultDates,recordCount){
  $$('#historyMode button').forEach(b=>b.classList.toggle('active',b.dataset.historyMode===ui.historyMode));$$('#historyDomain button').forEach(b=>b.classList.toggle('active',b.dataset.historyDomain===ui.historyDomain));$$('#historyPeriodTabs button').forEach(b=>b.classList.toggle('active',b.dataset.historyPeriod===ui.historyPeriod));renderHistoryConditions();
  const nav=activityDateNavigation(ui.historyAnchor||todayKey(),availableDates),isToday=ui.historyAnchor===todayKey();$('#historyAnchorDate').value=ui.historyAnchor;$('#historyAnchorBadge').textContent=isToday?'오늘':nav.hasRecord?'기록일':'선택일';$('#historyAnchorBadge').classList.toggle('muted-badge',!isToday&&!nav.hasRecord);$('#historyAnchorMeta').textContent=nav.hasRecord?`${historyDateRecordCount(ui.historyAnchor)} records`:'조건에 맞는 기록 없음';$('#historyPrevDate').disabled=!nav.previous;$('#historyNextDate').disabled=!nav.next;
  const dateText=range.from===range.to?fmtDate(range.to):`${fmtDate(range.from)}–${fmtDate(range.to)}`;$('#historyScopeSummary').innerHTML=`<span aria-hidden="true">◷</span><b>${esc(dateText)}</b><small>${esc(range.label)} · ${resultDates.length}일 · ${recordCount} records</small>`;
}
function renderHistory(){
  normalizeHistoryFilters();const availableDates=historyNavigationDates(),range=historyRange(),dates=activityDatesInRange(availableDates,range).reverse();let grand=0,html='';
  for(const date of dates){let body='',count=0;
    if(ui.historyMode!=='training'){
      if(['all','pitching'].includes(ui.historyDomain)){const parents=historyParentEntries('bf',date),aux=historyPitchingAux(date),content=parents.map(({parent,matchingEventIds})=>parentCardHtml('bf',parent,{matchingEventIds})).join('')+(aux.length?`<div class="aux-log">${aux.map(e=>e.eventType==='pitching_exit'?pitchingExitRowHtml(e):recordRowHtml({store:'gameEvents',id:e.id,activityDate:e.activityDate,recordedAt:e.recordedAt,mode:'game',domain:'pitching',label:gameEventLabel(e),sub:gameEventSub(e)})).join('')}</div>`:'');body+=historySection('경기 · 투구',content,parents.length+aux.length);count+=parents.length+aux.length;}
      if(['all','hitting'].includes(ui.historyDomain)){const parents=historyParentEntries('pa',date),content=parents.map(({parent,matchingEventIds})=>parentCardHtml('pa',parent,{matchingEventIds})).join('');body+=historySection('경기 · 타격',content,parents.length);count+=parents.length;}
      if(['all','defense'].includes(ui.historyDomain)){const events=historyDefenseEvents(date);body+=historySection('경기 · 수비',events.map(defenseCardHtml).join(''),events.length);count+=events.length;}
      if(['all','baserunning'].includes(ui.historyDomain)){const events=historyBaserunningEvents(date);body+=historySection('경기 · 주루',events.map(baserunningCardHtml).join(''),events.length);count+=events.length;}
    }
    if(ui.historyMode!=='game'){const domains=ui.historyDomain==='all'?['pitching','hitting','defense','baserunning']:[ui.historyDomain];for(const domain of domains){const sets=historyTrainingSets(date,domain),rows=sets.map(trainingCardHtml).join('');body+=historySection(`훈련 · ${DOMAIN_LABEL[domain]}`,rows,sets.length);count+=sets.length;}}
    if(count){grand+=count;html+=`<section class="history-date-group"><div class="history-date-head"><h3>${fmtDate(date)}</h3><span>${count} records</span></div>${body}</section>`;}
  }
  renderHistoryControls(range,availableDates,dates,grand);$('#historyCount').textContent=`${grand} records · ${dates.length}일`;$('#historyList').innerHTML=html||'<div class="scope-note history-empty">조건에 맞는 기록이 없습니다.</div>';
}
function analysisNavigationDates(){
  let rows=[];
  if(ui.analysisSource==='game'){
    const events=recordsFor('gameEvents');
    if(ui.analysisDomain==='pitching')rows=[...recordsFor('batterFaced'),...events.filter(e=>e.domain==='pitching')];
    else if(ui.analysisDomain==='hitting')rows=[...recordsFor('plateAppearances'),...events.filter(e=>['hitting','batting'].includes(e.domain))];
    else rows=events.filter(e=>e.domain===ui.analysisDomain);
  }else rows=recordsFor('trainingSets').filter(s=>(ui.analysisDomain==='all'||s.domain===ui.analysisDomain)&&(!['pitching','hitting'].includes(ui.analysisDomain)||ui.ownSide==='all'||s.side===ui.ownSide));
  return [...new Set(rows.map(x=>x.activityDate).filter(Boolean))].filter(date=>analysisSnapshotHasData(analysisDateSnapshot(date))).sort();
}
function analysisRange(){
  const anchor=ui.analysisAnchor||todayKey();
  return anchoredAnalysisRange({anchor,period:ui.analysisPeriod,activityDates:analysisNavigationDates()});
}
function analysisScopeCount(range){
  const dates=activityDatesInRange(analysisNavigationDates(),range);
  return {days:dates.length,label:ui.analysisSource==='game'?`경기일 ${dates.length}일`:`훈련일 ${dates.length}일`};
}
function analysisDateNavigation(){
  return activityDateNavigation(ui.analysisAnchor||todayKey(),analysisNavigationDates());
}
function moveAnalysisAnchor(direction){
  const nav=analysisDateNavigation(),target=direction<0?nav.previous:nav.next;if(!target)return;ui.analysisAnchor=target;renderAnalysis();
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
    plays:{name:'Plays',ko:'수비 플레이',full:'Recorded Defensive Plays',desc:'선택 기간에 기록한 전체 수비 플레이 수입니다.',formula:'Recorded defensive plays',format:'count'},
    cleanPct:{name:'Clean%',ko:'깔끔한 처리율',full:'Clean Fielding Percentage',desc:'실제로 처리한 타구 중 보완 없이 깔끔하게 처리한 비율입니다.',formula:'Clean / Handled fielding attempts',format:'pct'},
    securePct:{name:'Secure%',ko:'최종 처리율',full:'Secured Fielding Percentage',desc:'깔끔한 처리와 불안정 후 보완을 합쳐 최종적으로 공을 확보한 비율입니다.',formula:'(Clean + Recovered) / Handled attempts',format:'pct'},
    fieldingSuccessPct:{name:'Fielding%',ko:'기존 호환 처리율',full:'Compatible Fielding Success Percentage',desc:'기존 기록과 새 기록을 함께 비교하기 위한 타구 처리 성공 비율입니다.',formula:'Clean fields / Evaluated fielding opportunities',format:'pct'},
    onTargetPct:{name:'On-Target%',ko:'정확 송구율',full:'On-target Throw Percentage',desc:'품질을 평가한 송구 중 목표에 정확히 도착한 비율입니다.',formula:'Accurate throws / Evaluated throws',format:'pct'},
    catchablePct:{name:'Catchable%',ko:'수신 가능 송구율',full:'Catchable Throw Percentage',desc:'정확하거나 받을 수 있다고 평가한 송구의 비율입니다.',formula:'(Accurate + Catchable) / Evaluated throws',format:'pct'},
    throwSuccessPct:{name:'Throw%',ko:'기존 호환 송구율',full:'Compatible Throw Success Percentage',desc:'정확 또는 수신 가능으로 평가한 송구 비율입니다.',formula:'Catchable throws / Evaluated throws',format:'pct'},
    throwAttempts:{name:'Throws',ko:'수비 송구 수',full:'Defensive Throws',desc:'수비 플레이 안에 기록한 모든 송구 동작 수입니다. 품질 미입력 송구도 투구 부하에는 포함됩니다.',formula:'Throw actions',format:'count'},
    throwTLU:{name:'Throw TLU',ko:'수비 송구 부하',full:'Defensive Throwing Load',desc:'경기 수비 송구 동작에서 발생한 Throwing Load 합계입니다.',formula:'Sum of throw-action TLU',format:'tlu'},
    receivePct:{name:'Receive%',ko:'수신 성공률',full:'Throw Receiving Percentage',desc:'평가 가능한 송구 받기 중 깔끔하게 받거나 보완해서 받은 비율입니다.',formula:'(Clean + Recovered receives) / Evaluated receives',format:'pct'},
    savePct:{name:'Save%',ko:'빗나간 송구 보완율',full:'Off-target Throw Save Percentage',desc:'높거나 낮거나 벗어나거나 바운드된 송구를 최종적으로 받아낸 비율입니다.',formula:'Saved off-target throws / Receivable off-target throws',format:'pct'},
    scoopPct:{name:'Scoop%',ko:'스쿱 성공률',full:'Scoop Success Percentage',desc:'스쿱 기술로 기록한 수신 기회 중 성공 또는 보완한 비율입니다.',formula:'Successful scoops / Evaluated scoops',format:'pct'},
    receiveMissPct:{name:'Miss%',ko:'수신 실패율',full:'Receiving Miss Percentage',desc:'평가 가능한 송구 받기 중 수신에 실패한 비율입니다.',formula:'Failed receives / Evaluated receives',format:'pct'},
    tagAttempts:{name:'TAG ATT',ko:'주자 태그 시도',full:'Runner Tag Attempts',desc:'주자에게 직접 태그를 시도한 동작 수입니다. 실행 결과 미입력 동작도 시도 수에는 포함됩니다.',formula:'Tag actions',format:'count'},
    tagContactPct:{name:'TAG%',ko:'태그 수행률',full:'Runner Tag Execution Percentage',desc:'실행 결과가 입력된 태그 중 정확히 태그했거나 수습 후 태그한 비율입니다.',formula:'(Clean + Recovered tags) / Evaluated tag executions',format:'pct'},
    tagOutPct:{name:'TAG OUT%',ko:'태그 아웃률',full:'Runner Tag Out Percentage',desc:'아웃 또는 세이프로 판정된 태그 중 아웃 판정을 받은 비율입니다. 판정 없음은 분모에서 제외합니다.',formula:'Out calls / (Out + Safe tag calls)',format:'pct'},
    baseTouchAttempts:{name:'BASE ATT',ko:'베이스 터치 시도',full:'Base Touch Attempts',desc:'공을 가진 채 베이스를 직접 터치한 동작 수입니다.',formula:'Base-touch actions',format:'count'},
    baseTouchPct:{name:'BASE%',ko:'베이스 접촉률',full:'Secure Base Touch Percentage',desc:'접촉 결과가 입력된 베이스 터치 중 정상적으로 접촉을 유지한 비율입니다.',formula:'Secure touches / Evaluated base touches',format:'pct'},
    outOnTimePct:{name:'OUT-TIME%',ko:'직접 아웃 타이밍 적절률',full:'Direct Out Timing Percentage',desc:'태그와 베이스 터치 중 여유 또는 접전 타이밍으로 기록한 비율입니다. 평가 불가는 제외합니다.',formula:'(Early + Close) / Evaluated tag and base timing',format:'pct'},
    outMissPct:{name:'OUT-MISS%',ko:'직접 아웃 실행 실패율',full:'Direct Out Execution Miss Percentage',desc:'태그 빗나감·공 빠짐·베이스 이탈·미접촉이 평가된 직접 아웃 동작에서 차지하는 비율입니다.',formula:'Execution misses / Evaluated tag and base executions',format:'pct'},
    coverAttempts:{name:'COVER ATT',ko:'커버·백업 참여',full:'Cover and Backup Attempts',desc:'커버·백업 동작을 기록한 횟수입니다.',formula:'Cover and backup actions',format:'count'},
    coverPct:{name:'COVER%',ko:'커버·백업 수행률',full:'Cover and Backup Completion Percentage',desc:'수행 결과가 입력된 커버·백업 중 정상 수행 또는 보완한 비율입니다.',formula:'(Correct + Recovered) / Evaluated cover actions',format:'pct'},
    coverOnTimePct:{name:'COVER TIME%',ko:'제시간 커버율',full:'On-time Cover Percentage',desc:'도착 시점이 입력된 커버·백업 중 제시간에 도착한 비율입니다.',formula:'On-time / Evaluated cover timing',format:'pct'},
    judgmentAppropriatePct:{name:'Decision%',ko:'적절 판단률',full:'Appropriate Defensive Decision Percentage',desc:'판단을 평가한 동작 중 최선 또는 허용 가능한 판단으로 기록된 비율입니다. 공식 지표가 아닌 코칭용 자체 지표입니다.',formula:'(Best + Acceptable) / Evaluated decisions',format:'pct'},
    PO:{name:'PO',ko:'자살',full:'Putouts',desc:'공식 기록으로 입력한 자살 수입니다.',formula:'Recorded PO',format:'count'},
    A:{name:'A',ko:'보살',full:'Assists',desc:'공식 기록으로 입력한 보살 수입니다.',formula:'Recorded A',format:'count'},
    E:{name:'E',ko:'실책',full:'Errors',desc:'공식 기록으로 확정해 입력한 실책 수입니다. 기술 실패와 자동으로 연결하지 않습니다.',formula:'Recorded E',format:'count'},
    DP:{name:'DP',ko:'병살 참여',full:'Double Plays',desc:'공식 기록으로 입력한 병살 참여 수입니다.',formula:'Recorded DP',format:'count'},
    TC:{name:'TC',ko:'수비 기회',full:'Total Chances',desc:'공식 PO, A, E를 합한 수비 기회입니다.',formula:'PO + A + E',format:'count'},
    FPCT:{name:'FPCT',ko:'수비율',full:'Fielding Percentage',desc:'공식 수비 기회 중 실책 없이 처리한 비율입니다.',formula:'(PO + A) / (PO + A + E)',format:'dec'}
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
    actionReps:{name:'Action Reps',ko:'동작 반복량',full:'Defense Action Repetitions',desc:'시나리오 기록에서 각 동작의 실제 반복 횟수를 모두 더한 값입니다. 간단 기록은 이 지표에 포함하지 않습니다.',formula:'Sum of scenario action repetitions',format:'count'},
    tluPerRep:{name:'TLU / Rep',ko:'반복당 송구 부하',full:'Throwing Load per Defense Rep',desc:'전체 수비 훈련 reps 한 번당 평균 Throwing Load입니다.',formula:'Defense Throw TLU / Defense Reps',format:'ratio'},
    fieldReps:{name:'FIELD',ko:'타구 처리 reps',full:'Fielding Action Repetitions',desc:'시나리오에서 타구 처리 동작을 반복한 횟수입니다.',formula:'Field action repetitions',format:'count'},
    receiveReps:{name:'RECEIVE',ko:'송구 받기 reps',full:'Receiving Action Repetitions',desc:'시나리오에서 송구 받기 동작을 반복한 횟수입니다.',formula:'Receive action repetitions',format:'count'},
    tagReps:{name:'TAG',ko:'주자 태그 reps',full:'Runner Tag Repetitions',desc:'시나리오에서 주자 태그 동작을 반복한 횟수입니다.',formula:'Tag action repetitions',format:'count'},
    baseReps:{name:'BASE',ko:'베이스 터치 reps',full:'Base Touch Repetitions',desc:'시나리오에서 베이스 터치 동작을 반복한 횟수입니다.',formula:'Base-touch action repetitions',format:'count'},
    throwReps:{name:'THROW',ko:'송구 동작 reps',full:'Throw Action Repetitions',desc:'시나리오 안의 송구 동작 반복 횟수입니다.',formula:'Throw action repetitions',format:'count'},
    coverReps:{name:'COVER',ko:'커버·백업 reps',full:'Cover and Backup Repetitions',desc:'시나리오에서 커버·백업 동작을 반복한 횟수입니다.',formula:'Cover action repetitions',format:'count'},
    simpleSets:{name:'Simple Sets',ko:'간단 기록 세트',full:'Simple Defense Training Sets',desc:'훈련 총량만 남긴 수비 훈련 세트 수입니다. 기존 형식도 포함합니다.',formula:'Simple defense sets',format:'count'},
    scenarioSets:{name:'Scenario Sets',ko:'시나리오 세트',full:'Scenario Defense Training Sets',desc:'수비 동작 흐름을 함께 기록한 훈련 세트 수입니다.',formula:'Scenario defense sets',format:'count'},
    evaluatedReps:{name:'Evaluated',ko:'평가한 reps',full:'Evaluated Defense Training Repetitions',desc:'선택 결과를 입력한 수비 훈련 reps입니다. 미평가 reps는 실패가 아닙니다.',formula:'Target + Adjust + Failed repetitions',format:'count'},
    targetPct:{name:'Target%',ko:'목표 수행률',full:'On-target Training Percentage',desc:'평가한 reps 중 목표대로 수행한 비율입니다.',formula:'Target reps / Evaluated reps',format:'pct'},
    adjustPct:{name:'Adjust%',ko:'보완 필요율',full:'Adjustment-needed Percentage',desc:'평가한 reps 중 보완이 필요했던 비율입니다.',formula:'Adjustment reps / Evaluated reps',format:'pct'},
    failurePct:{name:'Failure%',ko:'실패·중단률',full:'Failed or Stopped Percentage',desc:'평가한 reps 중 실패하거나 중단한 비율입니다.',formula:'Failed reps / Evaluated reps',format:'pct'},
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
    if(ui.analysisDomain==='defense')return [
      {title:'공식 수비 기록',ids:['PO','A','E','TC','FPCT','DP']},
      {title:'타구 처리 · 자체 지표',ids:['plays','cleanPct','securePct']},
      {title:'송구 · 자체 지표',ids:['throwAttempts','onTargetPct','catchablePct','throwTLU']},
      {title:'송구 받기 · 자체 지표',ids:['receivePct','savePct','scoopPct','receiveMissPct']},
      {title:'직접 아웃 · 자체 지표',ids:['tagAttempts','tagContactPct','tagOutPct','baseTouchAttempts','baseTouchPct','outOnTimePct','outMissPct']},
      {title:'커버·백업 · 자체 지표',ids:['coverAttempts','coverPct','coverOnTimePct']},
      {title:'판단 · 자체 지표',ids:['judgmentAppropriatePct']}
    ];
    return [{title:'주루 핵심',ids:['sb','cs','attempts','sbPct']}];
  }
  if(ui.analysisDomain==='all')return [{title:'워크로드 · 훈련량',ids:['total_tlu','throws','swings','defenseReps','baserunningReps']}];
  if(ui.analysisDomain==='pitching')return [{title:'투구 훈련',ids:['volume','tlu','total_tlu','light','medium','max']}];
  if(ui.analysisDomain==='hitting'){const types=Object.keys(snapshot.summary.byType||{}).slice(0,6);return [{title:'타격 훈련',ids:['volume','sets',...types]}];}
  if(ui.analysisDomain==='defense')return [{title:'수비 훈련량',ids:['sets','volume','actionReps','throwCount','tlu','tluPerRep']},{title:'동작별 Reps',ids:['fieldReps','receiveReps','tagReps','baseReps','throwReps','coverReps']},{title:'기록 방식',ids:['simpleSets','scenarioSets']},{title:'선택 평가',ids:['evaluatedReps','targetPct','adjustPct','failurePct']}];
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
  const cfg=metricConfig(id),value=analysisMetricValue(snapshot,id),single=ui.analysisPeriod==='1',series=single?[]:analysisSeries(data,{...analysisOpts(range),metric:id,viewUnit:ui.analysisView}),selected=id===ui.analysisMetric;
  return `<button type="button" class="analysis-metric-card ${selected?'selected':''}" data-analysis-metric="${esc(id)}"><span class="metric-name">${esc(cfg.name)}</span><b>${formatMetricValue(value,cfg)}</b>${cfg.ko?`<small>${esc(cfg.ko)}</small>`:''}${single?'<span class="metric-day-label">선택일 상세</span>':sparklineSvg(series)}</button>`;
}
function analysisSnapshotHasData(snapshot){
  if(!snapshot)return false;const s=snapshot.summary;
  if(snapshot.source==='training'){
    if((s.sets?.length||0)>0)return true;
    return ['all','pitching'].includes(snapshot.domain)&&Number(snapshot.workload?.total)>0;
  }
  if(snapshot.domain==='pitching')return (s.events?.length||0)>0||s.bf+s.unknownBF+s.incompleteBF+(s.relievedBF||0)>0;
  if(snapshot.domain==='hitting')return (s.events?.length||0)>0||s.PA+s.unknownPA+s.incompletePA>0;
  if(snapshot.domain==='defense')return s.plays>0;
  return s.attempts>0;
}
function analysisDateSnapshot(date){
  return analysisSnapshot(data,{athleteId:activeAthleteId,source:ui.analysisSource,domain:ui.analysisDomain,date,ownSide:ui.ownSide==='all'?null:ui.ownSide,oppSide:ui.oppSide==='all'?null:ui.oppSide});
}
function dailyMetricComparison(id){
  const dates=analysisNavigationDates().filter(date=>date<ui.analysisAnchor).reverse(),points=[];
  for(const date of dates){const snapshot=analysisDateSnapshot(date);if(!analysisSnapshotHasData(snapshot))continue;const value=analysisMetricValue(snapshot,id);if(value==null||!Number.isFinite(Number(value)))continue;points.push({date,value:Number(value),snapshot});if(points.length===5)break;}
  return {previous:points[0]||null,recent:points,average:points.length?points.reduce((sum,p)=>sum+p.value,0)/points.length:null};
}
function analysisConditionText(){
  const values=[];
  if(ui.ownSide!=='all')values.push(ui.analysisDomain==='hitting'?(ui.ownSide==='R'?'우타':'좌타'):(ui.ownSide==='R'?'우투':'좌투'));
  if(ui.oppSide!=='all')values.push(ui.analysisDomain==='pitching'?(ui.oppSide==='R'?'우타 상대':'좌타 상대'):(ui.oppSide==='R'?'우투 상대':'좌투 상대'));
  return values.length?values.join(' · '):'전체 조건';
}
function analysisAnchorMeta(snapshot,hasRecord){
  if(!hasRecord)return `${ui.analysisSource==='game'?'경기':'훈련'} 기록 없음`;const s=snapshot.summary;
  if(snapshot.source==='training')return `${s.sets?.length||0}세트 기록`;
  if(snapshot.domain==='pitching')return `${s.officialPitches}구 · BF ${s.bf+s.unknownBF+s.incompleteBF+(s.relievedBF||0)}`;
  if(snapshot.domain==='hitting')return `PA ${s.PA+s.unknownPA+s.incompletePA} · ${s.totalPitches}구`;
  if(snapshot.domain==='defense')return `${s.plays} plays`;
  return `${s.attempts} attempts`;
}
function renderAnalysisScope(range){
  const nav=analysisDateNavigation(),anchor=ui.analysisAnchor||todayKey(),isToday=anchor===todayKey(),sourceWord=ui.analysisSource==='game'?'경기':'훈련';
  $('#analysisAnchorDate').value=anchor;$('#analysisAnchorBadge').textContent=isToday?'오늘':nav.hasRecord?'기록일':'선택일';
  $('#analysisAnchorBadge').classList.toggle('muted-badge',!isToday&&!nav.hasRecord);
  $('#analysisAnchorMeta').textContent=analysisAnchorMeta(analysisDateSnapshot(anchor),nav.hasRecord);
  const prev=$('#analysisPrevDate'),next=$('#analysisNextDate');prev.disabled=!nav.previous;next.disabled=!nav.next;prev.setAttribute('aria-label',`이전 ${sourceWord}`);next.setAttribute('aria-label',`다음 ${sourceWord}`);
  prev.querySelector('b').textContent=`이전 ${sourceWord}`;next.querySelector('b').textContent=`다음 ${sourceWord}`;
  const count=analysisScopeCount(range),dateText=range.from===range.to?fmtDate(range.to):`${fmtDate(range.from)}–${fmtDate(range.to)}`;
  $('#analysisScopeSummary').innerHTML=`<span aria-hidden="true">◷</span><b>${esc(dateText)}</b><small>${esc(range.label)} · ${esc(count.label)}</small>`;
}
function renderAnalysisControls(){
  $$('#analysisSourceTabs button').forEach(b=>b.classList.toggle('active',b.dataset.analysisSource===ui.analysisSource));
  $$('#analysisPeriodTabs button').forEach(b=>b.classList.toggle('active',b.dataset.period===ui.analysisPeriod));
  const allBtn=$('#analysisDomainTabs [data-analysis-domain="all"]');allBtn.hidden=ui.analysisSource!=='training';
  if(ui.analysisSource==='game'&&ui.analysisDomain==='all')ui.analysisDomain='pitching';
  $$('#analysisDomainTabs button').forEach(b=>b.classList.toggle('active',b.dataset.analysisDomain===ui.analysisDomain));
  $('#analysisViewTabs').innerHTML=analysisViewOptions().map(([v,l])=>`<button type="button" data-analysis-view="${v}" class="${v===ui.analysisView?'active':''}">${l}</button>`).join('');$('#analysisViewSelect').innerHTML=analysisViewOptions().map(([v,l])=>`<option value="${v}" ${v===ui.analysisView?'selected':''}>${l}</option>`).join('');
  $('#analysisViewBlock').hidden=ui.analysisPeriod==='1';
  renderSideFilters();
}
function renderAnalysis(){
  const a=athlete();if(!a)return;renderAnalysisControls();const r=analysisRange(),snapshot=analysisSnapshot(data,{...analysisOpts(r)}),groups=analysisMetricGroups(snapshot);ensureAnalysisState(groups);renderAnalysisControls();renderAnalysisScope(r);
  const hasData=analysisSnapshotHasData(snapshot),detail=$('#analysisDetail'),breakdown=$('#analysisBreakdown');
  if(!hasData){const subject=ui.analysisSource==='game'?DOMAIN_LABEL[ui.analysisDomain]||'경기':'훈련',emptyScope=r.from===r.to?fmtDate(r.to):`${fmtDate(r.from)}–${fmtDate(r.to)}`;$('#analysisMetrics').innerHTML=`<section class="analysis-empty-state"><span aria-hidden="true">⌁</span><h3>${esc(emptyScope)} ${esc(subject)} 기록이 없습니다</h3><p>기준일을 이동하거나 조회 기간을 늘려보세요.</p></section>`;detail.hidden=true;breakdown.hidden=true;return;}
  detail.hidden=false;breakdown.hidden=false;const viewSuffix=ui.analysisPeriod==='1'?'선택일 상세':analysisViewOptions().find(x=>x[0]===ui.analysisView)?.[1]||'';
  $('#analysisMetrics').innerHTML=groups.map(g=>`<section class="metric-group"><div class="metric-group-head"><h3>${esc(g.title)}</h3><span>${esc(r.label)} · ${esc(viewSuffix)}</span></div><div class="analysis-metric-grid">${g.ids.map(id=>metricCardHtml(id,snapshot,r)).join('')}</div></section>`).join('');
  renderAnalysisDetail(snapshot,r);renderAnalysisBreakdown(snapshot,r);
}
function metricSample(snapshot){
  if(snapshot.source==='game'){
    const s=snapshot.summary;if(snapshot.domain==='pitching')return `${s.officialPitches} Pitches · ${s.bf} 완료 BF${s.relievedBF?` · ${s.relievedBF} 강판 중단`:''}${s.unknownBF?` · ${s.unknownBF} 결과 미상`:''}`;
    if(snapshot.domain==='hitting')return `${s.PA} 완료 PA · ${s.totalPitches} Pitches${s.unknownPA?` · ${s.unknownPA} 결과 미상`:''}`;
    if(snapshot.domain==='defense')return `${s.plays} Plays · ${s.fieldAttempts} Field chances · ${s.throwAttempts} Throws · ${s.tagAttempts} Tags · ${s.baseTouchAttempts} Base touches${s.dataStatus.incomplete?` · 미입력 ${s.dataStatus.incomplete}건`:''}${s.dataStatus.legacy?` · 기존 형식 ${s.dataStatus.legacy}건`:''}`;
    return `${s.attempts} Attempts · SB ${s.sb} / CS ${s.cs}`;
  }
  const s=snapshot.summary;if(snapshot.domain==='defense')return `${s.sets.length} Sets · 간단 ${s.defenseSimpleSets||0} / 시나리오 ${s.defenseScenarioSets||0} · ${s.byDomain.defense?.volume||0} Reps · ${s.defenseActionReps||0} Action Reps · ${s.defenseThrowCount||0} Throws${s.defenseOutcomes?.evaluated?` · 평가 ${s.defenseOutcomes.evaluated} Reps`:''}`;return `${s.sets.length} Sets · ${n2(snapshot.workload.total)} Total TLU`;
}
function renderAnalysisDetail(snapshot,range){
  const id=ui.analysisMetric,cfg=metricConfig(id),value=analysisMetricValue(snapshot,id);
  if(ui.analysisPeriod==='1'){
    const comparison=dailyMetricComparison(id),previousLabel=ui.analysisSource==='game'?'직전 경기':'직전 훈련',averageLabel=ui.analysisSource==='game'?'최근 5경기 평균':'최근 5훈련일 평균';analysisDetailSeries=[];
    $('#analysisDetail').innerHTML=`<div class="detail-head"><div><span class="detail-eyebrow">선택 날짜 · ${esc(fmtDate(ui.analysisAnchor))}</span><h2>${esc(cfg.name)} <strong>${formatMetricValue(value,cfg)}</strong></h2><p class="metric-full-name">${esc(cfg.full)}${cfg.ko?` · ${esc(cfg.ko)}`:''}</p></div><div class="detail-stat-strip daily-stat-strip"><div><span>선택일</span><b>${formatMetricValue(value,cfg)}</b></div><div><span>${esc(previousLabel)}</span><b>${comparison.previous?formatMetricValue(comparison.previous.value,cfg):'—'}</b></div><div><span>${esc(averageLabel)}</span><b>${comparison.average==null?'—':formatMetricValue(comparison.average,cfg)}</b></div></div></div><p class="metric-description">${esc(cfg.desc)}</p><div class="metric-formula"><span>계산</span><code>${esc(cfg.formula)}</code></div><div class="daily-comparison-note"><span aria-hidden="true">↔</span><p>${comparison.previous?`${fmtDate(comparison.previous.date)} 기록과 최근 ${comparison.recent.length}회 평균을 함께 표시합니다.`:'비교할 이전 기록이 아직 없습니다.'}</p></div><div class="detail-sample"><span>표본</span><b>${esc(metricSample(snapshot))}</b></div>`;
    return;
  }
  const series=analysisSeries(data,{...analysisOpts(range),metric:id,viewUnit:ui.analysisView});analysisDetailSeries=series;
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
function defenseThrowTargetTable(stats){const labels={'1B':'1루','2B':'2루','3B':'3루',HOME:'홈',RELAY:'중계',OTHER:'기타'};const rows=Object.entries(stats||{}).filter(([,x])=>x.attempts>0);if(!rows.length)return '';return `<section class="breakdown-section"><h3>송구 목적지별</h3><div class="analysis-table-wrap"><table class="analysis-table"><thead><tr><th>목적지</th><th>시도</th><th>수신 가능</th><th>받기 불가</th><th>미입력</th><th>성공률</th></tr></thead><tbody>${rows.map(([k,x])=>`<tr><td>${labels[k]||esc(k)}</td><td>${x.attempts}</td><td>${x.success}</td><td>${x.error}</td><td>${x.missing}</td><td>${pct(x.successPct,1)}</td></tr>`).join('')}</tbody></table></div></section>`;}
function defenseFieldTypeThrowTable(stats){const labels={FRONT:'정면',FOREHAND:'포핸드',BACKHAND:'백핸드',CHARGE:'전진',FORWARD:'앞으로',STRAIGHT:'정면',LATERAL:'좌우',BACK:'뒤로'};const rows=Object.entries(stats||{}).filter(([,x])=>x.attempts>0);if(!rows.length)return '';return `<section class="breakdown-section"><h3>타구 처리 후 송구</h3><div class="analysis-table-wrap"><table class="analysis-table"><thead><tr><th>처리 형태</th><th>시도</th><th>수신 가능</th><th>받기 불가</th><th>미입력</th><th>성공률</th></tr></thead><tbody>${rows.map(([k,x])=>`<tr><td>${labels[k]||esc(k)}</td><td>${x.attempts}</td><td>${x.success}</td><td>${x.error}</td><td>${x.missing}</td><td>${pct(x.successPct,1)}</td></tr>`).join('')}</tbody></table></div></section>`;}
function defenseRateSplitTable(title,stats,labels={}){const rows=Object.entries(stats||{}).filter(([,x])=>x.attempts>0);if(!rows.length)return '';return `<section class="breakdown-section"><h3>${esc(title)}</h3><div class="analysis-table-wrap"><table class="analysis-table"><thead><tr><th>구분</th><th>기회</th><th>성공</th><th>실패</th><th>제외</th><th>미입력</th><th>성공률</th></tr></thead><tbody>${rows.map(([k,x])=>`<tr><td>${esc(labels[k]||k)}</td><td>${x.attempts}</td><td>${x.success}</td><td>${x.failed}</td><td>${x.excluded}</td><td>${x.missing}</td><td>${pct(x.successPct,1)}</td></tr>`).join('')}</tbody></table></div></section>`;}
function defenseThrowLoadTable(stats){const labels={'0':'매우 가벼움 · 0','0.75':'가벼움 · 0.75','0.85':'중간 · 0.85','1':'전력 · 1.00'},rows=Object.entries(stats||{}).filter(([,x])=>x.attempts>0).sort((a,b)=>Number(a[0])-Number(b[0]));if(!rows.length)return '';return `<section class="breakdown-section"><h3>송구 부하별</h3><div class="analysis-table-wrap"><table class="analysis-table"><thead><tr><th>부하</th><th>송구</th><th>수신 가능</th><th>받기 불가</th><th>미입력</th><th>성공률</th><th>TLU</th></tr></thead><tbody>${rows.map(([k,x])=>`<tr><td>${labels[k]||esc(k)}</td><td>${x.attempts}</td><td>${x.success}</td><td>${x.error}</td><td>${x.missing}</td><td>${pct(x.successPct,1)}</td><td>${n2(x.tlu)}</td></tr>`).join('')}</tbody></table></div></section>`;}
function defensePositionTable(stats){const order=['P','C','1B','2B','3B','SS','LF','CF','RF'],rows=Object.entries(stats||{}).filter(([,x])=>x.plays>0).sort((a,b)=>order.indexOf(a[0])-order.indexOf(b[0]));if(!rows.length)return '';return `<section class="breakdown-section"><h3>포지션별 수비</h3><div class="analysis-table-wrap"><table class="analysis-table"><thead><tr><th>포지션</th><th>플레이</th><th>타구 처리</th><th>최종 처리율</th><th>PO</th><th>A</th><th>E</th><th>FPCT</th></tr></thead><tbody>${rows.map(([position,x])=>`<tr><td>${esc(position)}</td><td>${x.plays}</td><td>${x.fieldAttempts}</td><td>${pct(x.securePct,1)}</td><td>${x.po}</td><td>${x.a}</td><td>${x.e}</td><td>${x.fieldingPct==null?'—':Number(x.fieldingPct).toFixed(3).replace(/^0/,'')}</td></tr>`).join('')}</tbody></table></div></section>`;}
function defenseSituationPerformanceTable(title,stats,labels={}){const rows=Object.entries(stats||{}).filter(([,x])=>x.plays>0);if(!rows.length)return '';return `<section class="breakdown-section"><h3>${esc(title)}</h3><div class="analysis-table-wrap"><table class="analysis-table"><thead><tr><th>상황</th><th>플레이</th><th>타구 처리</th><th>최종 처리율</th><th>송구</th><th>수신 가능률</th><th>E</th></tr></thead><tbody>${rows.map(([key,x])=>`<tr><td>${esc(labels[key]||key)}</td><td>${x.plays}</td><td>${x.fieldAttempts}</td><td>${pct(x.fieldSecurePct,1)}</td><td>${x.throwAttempts}</td><td>${pct(x.throwSuccessPct,1)}</td><td>${x.errors}</td></tr>`).join('')}</tbody></table></div></section>`;}
function pitchingSplitTable(range){
  const own=ui.ownSide==='all'?null:ui.ownSide,rows=[['R','우타'],['L','좌타']].map(([side,label])=>[label,gamePitchingSummary(data,{athleteId:activeAthleteId,from:range.from,to:range.to,pitcherSide:own,batterSide:side})]).filter(([,s])=>s.events.length||s.bf);
  if(!rows.length)return '';return `<section class="breakdown-section"><h3>상대 타자 좌우 스플릿</h3><div class="analysis-table-wrap"><table class="analysis-table"><thead><tr><th>상대</th><th>BF</th><th>Strike%</th><th>CSW%</th><th>K%</th><th>BB%</th></tr></thead><tbody>${rows.map(([l,s])=>`<tr><td>${l}</td><td>${s.bf}</td><td>${pct(s.strikePct,1)}</td><td>${pct(s.cswPct,1)}</td><td>${pct(s.kPct,1)}</td><td>${pct(s.bbPct,1)}</td></tr>`).join('')}</tbody></table></div></section>`;}
function hittingSplitTable(range){
  const own=ui.ownSide==='all'?null:ui.ownSide,rows=[['R','우투'],['L','좌투']].map(([side,label])=>[label,battingSummary(data,{athleteId:activeAthleteId,from:range.from,to:range.to,batterSide:own,pitcherSide:side})]).filter(([,s])=>s.events.length||s.PA);
  if(!rows.length)return '';return `<section class="breakdown-section"><h3>상대 투수 좌우 스플릿</h3><div class="analysis-table-wrap"><table class="analysis-table"><thead><tr><th>상대</th><th>PA</th><th>AVG</th><th>OPS</th><th>Contact%</th><th>Whiff%</th></tr></thead><tbody>${rows.map(([l,s])=>`<tr><td>${l}</td><td>${s.PA}</td><td>${dec(s.AVG)}</td><td>${dec(s.OPS)}</td><td>${pct(s.contactPct,1)}</td><td>${pct(s.whiffPct,1)}</td></tr>`).join('')}</tbody></table></div></section>`;}
function orderedSituationRows(stats,type){const order=type==='outs'?['0','1','2','missing']:['none','first','scoring','loaded','missing'],labels=type==='outs'?{'0':'0아웃','1':'1아웃','2':'2아웃',missing:'미입력'}:{none:'주자 없음',first:'1루 주자만',scoring:'득점권 주자',loaded:'만루',missing:'미입력'};return order.filter(key=>stats?.[key]).map(key=>[labels[key],stats[key]]);}
function pitchingSituationTable(title,stats,type){const rows=orderedSituationRows(stats,type);if(!rows.length)return '';return `<section class="breakdown-section"><h3>${esc(title)}</h3><div class="analysis-table-wrap"><table class="analysis-table"><thead><tr><th>상황</th><th>공</th><th>Strike%</th><th>CSW%</th><th>BF</th><th>K%</th><th>BB%</th></tr></thead><tbody>${rows.map(([label,x])=>`<tr><td>${label}</td><td>${x.pitches}</td><td>${pct(x.strikePct,1)}</td><td>${pct(x.cswPct,1)}</td><td>${x.bf}</td><td>${pct(x.kPct,1)}</td><td>${pct(x.bbPct,1)}</td></tr>`).join('')}</tbody></table></div></section>`;}
function hittingSituationTable(title,stats,type){const rows=orderedSituationRows(stats,type);if(!rows.length)return '';return `<section class="breakdown-section"><h3>${esc(title)}</h3><div class="analysis-table-wrap"><table class="analysis-table"><thead><tr><th>상황</th><th>PA</th><th>AVG</th><th>OBP</th><th>SLG</th><th>OPS</th><th>Contact%</th></tr></thead><tbody>${rows.map(([label,x])=>`<tr><td>${label}</td><td>${x.pa}</td><td>${dec(x.avg)}</td><td>${dec(x.obp)}</td><td>${dec(x.slg)}</td><td>${dec(x.ops)}</td><td>${pct(x.contactPct,1)}</td></tr>`).join('')}</tbody></table></div></section>`;}
function baserunningSituationTable(title,stats,type){const rows=orderedSituationRows(stats,type);if(!rows.length)return '';return `<section class="breakdown-section"><h3>${esc(title)}</h3><div class="analysis-table-wrap"><table class="analysis-table"><thead><tr><th>상황</th><th>시도</th><th>성공</th><th>실패</th><th>SB%</th></tr></thead><tbody>${rows.map(([label,x])=>`<tr><td>${label}</td><td>${x.attempts}</td><td>${x.success}</td><td>${x.failed}</td><td>${pct(x.successPct,1)}</td></tr>`).join('')}</tbody></table></div></section>`;}
function baserunningRouteTable(routes){const labels={'1B>2B':'1루 → 2루','2B>3B':'2루 → 3루','3B>HOME':'3루 → 홈'},rows=Object.entries(routes||{}).filter(([,x])=>x.attempts);if(!rows.length)return '';return `<section class="breakdown-section"><h3>구간별 도루</h3><div class="analysis-table-wrap"><table class="analysis-table"><thead><tr><th>구간</th><th>시도</th><th>성공</th><th>실패</th><th>성공률</th></tr></thead><tbody>${rows.map(([k,x])=>`<tr><td>${labels[k]||esc(k)}</td><td>${x.attempts}</td><td>${x.success}</td><td>${x.failed}</td><td>${pct(x.successPct,1)}</td></tr>`).join('')}</tbody></table></div></section>`;}
function renderAnalysisBreakdown(snapshot,range){
  let html='';const s=snapshot.summary;
  if(ui.analysisSource==='game'&&ui.analysisDomain==='pitching')html=breakdownHtml('데이터 상태',{'완료 BF':s.bf,'강판 중단':s.relievedBF||0,'결과 미상':s.unknownBF,'미완료':s.incompleteBF,'투구 방향 미입력 공':s.missingPitcherSide||0,'상대 타자 미입력 공':s.missingBatterSide||0})+pitchingSituationTable('아웃 카운트별 투구',s.situationStats?.outs,'outs')+pitchingSituationTable('주자 상황별 투구',s.situationStats?.runners,'runners')+breakdownBarsHtml('타구 형태',s.battedTypes,{GB:'GB · 땅볼',LD:'LD · 라인드라이브',FB:'FB · 뜬공'})+breakdownBarsHtml('타구 방향',s.directions,{L:'좌',C:'중',R:'우'})+breakdownHtml('타구 결과',s.battedResults)+pitchingSplitTable(range);
  else if(ui.analysisSource==='game'&&ui.analysisDomain==='hitting')html=breakdownHtml('데이터 상태',{'완료 PA':s.PA,'결과 미상':s.unknownPA,'미완료':s.incompletePA,'타격 방향 미입력 공':s.missingBatterSide||0,'상대 투수 미입력 공':s.missingPitcherSide||0})+hittingSituationTable('아웃 카운트별 타격',s.situationStats?.outs,'outs')+hittingSituationTable('주자 상황별 타격',s.situationStats?.runners,'runners')+breakdownBarsHtml('타구 형태',s.battedTypes,{GB:'GB · 땅볼',LD:'LD · 라인드라이브',FB:'FB · 뜬공'})+breakdownBarsHtml('타구 방향',s.directions,{L:'좌',C:'중',R:'우'})+breakdownHtml('타격 결과',s.counts)+hittingSplitTable(range);
  else if(ui.analysisSource==='game'&&ui.analysisDomain==='defense'){
    html=breakdownHtml('데이터 상태',{'입력 완료':s.dataStatus.complete,'미입력 있음':s.dataStatus.incomplete,'기존 형식':s.dataStatus.legacy,'공식 기록 미입력':s.official.missing})
      +breakdownBarsHtml('수비 동작',s.actionCounts,{field:'타구 처리',throw:'송구',receive:'송구 받기',tag:'주자 태그',base:'베이스 터치',cover:'커버·백업'})
      +breakdownBarsHtml('플레이 시작 아웃 카운트',s.startOuts,{0:'0아웃',1:'1아웃',2:'2아웃',missing:'미입력'})
      +breakdownBarsHtml('플레이 시작 주자',s.runnersBefore,{none:'주자 없음','1B':'1루','2B':'2루','3B':'3루',missing:'미입력'})
      +breakdownBarsHtml('득점권 상황',s.scoringPosition,{yes:'득점권 주자 있음',no:'득점권 주자 없음',missing:'미입력'})
      +breakdownBarsHtml('이번 플레이 아웃 수',s.playOuts,{0:'0개',1:'1개',2:'2개',3:'3개',missing:'미입력'})
      +breakdownBarsHtml('플레이 후 주자',s.runnersAfter,{none:'주자 없음','1B':'1루','2B':'2루','3B':'3루',missing:'미입력'})
      +breakdownBarsHtml('타구 처리 결과',s.field,{success:'깔끔한 처리',unstable:'불안정 후 보완',failed:'처리 실패',missing:'미입력'})
      +breakdownBarsHtml('송구 정확도',s.throwAccuracy,{accurate:'정확',high:'높음',low:'낮음',left:'왼쪽',right:'오른쪽',bounce:'바운드',catchable:'받을 수 있음 · 기존',uncatchable:'벗어남 · 받기 불가',missing:'미입력'})
      +breakdownBarsHtml('송구 받기',s.receives,{clean:'깔끔한 수신',recovered:'보완 성공',failed:'수신 실패',excluded:'평가 제외',missing:'미입력'})
      +breakdownBarsHtml('주자 태그 실행',s.tags,{clean:'정확한 태그',recovered:'수습 후 태그',missed:'빗나감',dropped:'공 빠짐',missing:'미입력'})
      +breakdownBarsHtml('주자 태그 판정',s.tagCalls,{out:'아웃',safe:'세이프',no_call:'판정 없음',missing:'미입력'})
      +breakdownBarsHtml('베이스 터치 실행',s.baseTouches,{secure:'정상 접촉',off_base:'접촉 후 이탈',missed:'미접촉',missing:'미입력'})
      +breakdownBarsHtml('베이스 터치 판정',s.baseCalls,{out:'아웃',safe:'세이프',no_call:'판정 없음',missing:'미입력'})
      +breakdownBarsHtml('직접 아웃 타이밍',s.outTiming,{early:'여유',close:'접전',late:'늦음',na:'평가 불가',missing:'미입력'})
      +breakdownBarsHtml('커버·백업 결과',s.covers,{correct:'정확히 수행',recovered:'늦었지만 보완',failed:'수행 실패',missing:'미입력'})
      +breakdownBarsHtml('커버·백업 도착',s.coverTiming,{on_time:'제시간',late:'늦음',missed:'놓침',missing:'미입력'})
      +breakdownHtml('판단 평가',{'최선':s.judgment.best,'허용 가능':s.judgment.acceptable,'잘못된 판단':s.judgment.wrong})
      +breakdownHtml('공식 수비 기록',{'PO':s.official.po,'A':s.official.a,'E':s.official.e,'DP':s.official.dp})
      +defenseSituationPerformanceTable('아웃 카운트별 개인 수행',s.situationStats.outs,{0:'0아웃',1:'1아웃',2:'2아웃',missing:'미입력'})
      +defenseSituationPerformanceTable('주자 상황별 개인 수행',s.situationStats.runners,{none:'주자 없음',first:'1루 주자만',scoring:'득점권 주자 있음',missing:'미입력'})
      +defensePositionTable(s.positionStats)
      +defenseRateSplitTable('타구 방향별 처리',s.fieldDirections,{L:'왼쪽',C:'정면',R:'오른쪽'})
      +defenseRateSplitTable('타구 속도별 처리',s.fieldSpeeds,{slow:'느림',medium:'보통',fast:'빠름'})
      +defenseRateSplitTable('타구 처리 방법별',s.fieldMethods,{FRONT:'정면',FOREHAND:'포핸드',BACKHAND:'백핸드'})
      +defenseRateSplitTable('보낸 포지션별 수신',s.receiveSources,{P:'투수',C:'포수','1B':'1루수','2B':'2루수','3B':'3루수',SS:'유격수',LF:'LF',CF:'CF',RF:'RF',RELAY:'중계',OTHER:'기타'})
      +defenseRateSplitTable('받은 위치별 수신',s.receiveLocations,{'1B':'1루','2B':'2루','3B':'3루',HOME:'홈',RELAY:'중계',OTHER:'기타'})
      +defenseRateSplitTable('송구 형태별 수신',s.receiveForms,{on_target:'정확',high:'높음',low:'낮음',left:'왼쪽',right:'오른쪽',wide:'좌우 벗어남 · 기존',bounce:'바운드',uncatchable:'받기 불가'})
      +defenseRateSplitTable('송구 받기 방법별',s.receiveMethods,{normal:'일반',stretch:'스트레치',scoop:'스쿱',block:'블로킹',tag:'태그 · 기존',base_hold:'베이스 유지 · 기존'})
      +defenseRateSplitTable('태그 대상별',s.tagTargets,{BR:'타자주자',R1:'1루 주자',R2:'2루 주자',R3:'3루 주자',UNKNOWN:'대상 모름'})
      +defenseRateSplitTable('베이스별 터치',s.baseTargets,{'1B':'1루','2B':'2루','3B':'3루',HOME:'홈'})
      +defenseRateSplitTable('커버·백업 역할별',s.coverRoles,{base_cover:'베이스 커버',backup:'백업',cutoff:'중계 위치',communication:'콜·의사소통'})
      +defenseThrowTargetTable(s.targetStats)+defenseThrowLoadTable(s.throwLoadStats)+defenseFieldTypeThrowTable(s.fieldTypeThrowStats);
  }
  else if(ui.analysisSource==='game')html=baserunningSituationTable('아웃 카운트별 주루',s.situationStats?.outs,'outs')+baserunningSituationTable('주자 상황별 주루',s.situationStats?.runners,'runners')+baserunningRouteTable(s.routes);
  else {
    const t=snapshot.summary,w=snapshot.workload;
    if(ui.analysisDomain==='all')html=breakdownBarsHtml('TLU 원천',{'경기 공식투구':w.officialPitchTLU,'견제':w.pickoffTLU,'경기 연습투구':w.warmupTLU,'경기 수비송구':w.gameDefenseThrowing,'투구 훈련':w.pitchingTraining,'훈련 수비송구':w.defenseThrowing})+breakdownBarsHtml('훈련량 구성',{'투구':t.byDomain.pitching.volume,'타격':t.byDomain.hitting.volume,'수비':t.byDomain.defense.volume,'주루':t.byDomain.baserunning.volume});
    else if(ui.analysisDomain==='defense'){
      html=breakdownBarsHtml('기록 방식 · Reps',{'간단 기록':t.byDefenseMode.simple||0,'시나리오 기록':t.byDefenseMode.scenario||0})
        +breakdownBarsHtml('수비 동작 · Action Reps',t.defenseActionCounts,{field:'타구 처리',receive:'송구 받기',tag:'주자 태그',base:'베이스 터치',throw:'송구',cover:'커버·백업'})
        +breakdownBarsHtml('포지션 · 시나리오 Reps',t.byDefensePosition)
        +breakdownBarsHtml('시나리오 흐름 · Reps',t.byDefenseFlow)
        +breakdownBarsHtml('타구 종류 · Action Reps',t.byDefenseBall,{GB:'GB · 땅볼',LD:'LD · 라인',FB:'FB · 뜬공',PU:'PU · 팝업',BUNT:'번트'})
        +breakdownBarsHtml('송구 목적지 · Throws',t.byDefenseTarget,{'1B':'1루','2B':'2루','3B':'3루',HOME:'홈',RELAY:'중계',OTHER:'기타'})
        +breakdownBarsHtml('송구 부하 · Throws',t.byDefenseLoad,{'0':'0.00 · 매우 가벼운 토스','0.75':'0.75 · 근거리','0.85':'0.85 · 중거리','1':'1.00 · 장거리·전력'})
        +breakdownBarsHtml('내야 / 외야 · Reps',{'내야':t.byArea.IF||0,'외야':t.byArea.OF||0})
        +breakdownBarsHtml('선택 평가 · Reps',{'목표대로':t.defenseOutcomes.target||0,'보완 필요':t.defenseOutcomes.adjust||0,'실패·중단':t.defenseOutcomes.failed||0,'미평가':t.defenseOutcomes.unassessed||0});
      html+=`<p class="analysis-method-note">간단 기록과 기존 기록은 전체 Reps·Throws·Throw TLU에 포함됩니다. 동작별 Action Reps와 시나리오 흐름은 시나리오 기록만 집계하며, 미평가 reps는 실패율 분모에서 제외합니다.</p>`;
    }else {html=breakdownBarsHtml('훈련 종류',Object.fromEntries(Object.entries(t.byType).map(([k,v])=>[LABELS[k]||k,v])));if(['pitching','hitting'].includes(ui.analysisDomain))html+=breakdownBarsHtml('좌우 비중',{'우':t.bySide.R||0,'좌':t.bySide.L||0});if(ui.analysisDomain==='pitching')html+=breakdownBarsHtml('투구 강도',{'가벼움':t.byIntensity.light||0,'중간':t.byIntensity.medium||0,'전력':t.byIntensity.max||0})+breakdownBarsHtml('전체 TLU 원천',{'경기 공식투구':w.officialPitchTLU,'견제':w.pickoffTLU,'경기 연습투구':w.warmupTLU,'경기 수비송구':w.gameDefenseThrowing,'투구 훈련':w.pitchingTraining,'훈련 수비송구':w.defenseThrowing});}
  }
  if(ui.analysisSource==='game'&&['pitching','hitting'].includes(ui.analysisDomain)&&(ui.ownSide!=='all'||ui.oppSide!=='all'))html+=`<p class="analysis-method-note">공 기반 지표는 각 공에 저장된 투타 방향, ${ui.analysisDomain==='pitching'?'BF':'PA'} 결과 지표는 결과가 확정된 마지막 공의 방향을 기준으로 계산합니다. 방향 미입력 공은 전체 집계에는 포함되지만 좌우 조건 조회에서는 제외됩니다.</p>`;
  $('#analysisBreakdown').innerHTML=html||'<p class="scope-note">선택한 조건에 추가 분해 데이터가 없습니다.</p>';
}
function renderSideFilters(){const el=$('#sideFilters'),conditions=$('#analysisConditions');if(ui.analysisSource==='game'&&ui.analysisDomain==='pitching'){el.innerHTML=sideFilterHtml('투구 방향','own','throw')+sideFilterHtml('상대 타자','opp','bat');}else if(ui.analysisSource==='game'&&ui.analysisDomain==='hitting'){el.innerHTML=sideFilterHtml('타격 방향','own','bat')+sideFilterHtml('상대 투수','opp','throw');}else if(ui.analysisSource==='training'&&['pitching','hitting'].includes(ui.analysisDomain)){el.innerHTML=sideFilterHtml(ui.analysisDomain==='pitching'?'투구 방향':'타격 방향','own',ui.analysisDomain==='pitching'?'throw':'bat');ui.oppSide='all';}else{el.innerHTML='';ui.ownSide='all';ui.oppSide='all';}conditions.hidden=!el.innerHTML;if(!analysisConditionsInitialized){conditions.open=window.innerWidth>=900;analysisConditionsInitialized=true;}$('#analysisConditionSummary').textContent=analysisConditionText();}
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
  $('#openDateLogs').addEventListener('click',()=>{ui.historyAnchor=ui.inputDate;ui.historyPeriod='1';ui.historyMode=ui.inputMode;ui.historyDomain=ui.domain;resetHistoryConditions({render:false});setView('history');});
  $$('#historyMode button').forEach(b=>b.addEventListener('click',()=>{ui.historyMode=b.dataset.historyMode;normalizeHistoryFilters();renderHistory();}));$$('#historyDomain button').forEach(b=>b.addEventListener('click',()=>{ui.historyDomain=b.dataset.historyDomain;normalizeHistoryFilters();renderHistory();}));
  $$('#historyPeriodTabs button').forEach(b=>b.addEventListener('click',()=>{ui.historyPeriod=b.dataset.historyPeriod;renderHistory();}));$('#historyAnchorDate').addEventListener('change',e=>{ui.historyAnchor=e.target.value||todayKey();renderHistory();});$('#historyPrevDate').addEventListener('click',()=>moveHistoryAnchor(-1));$('#historyNextDate').addEventListener('click',()=>moveHistoryAnchor(1));
  $$('#analysisSourceTabs button').forEach(b=>b.addEventListener('click',()=>{ui.analysisSource=b.dataset.analysisSource;if(ui.analysisSource==='training'){ui.analysisDomain='all';ui.analysisView='day';ui.analysisMetric='total_tlu';}else{if(ui.analysisDomain==='all')ui.analysisDomain='pitching';ui.analysisView='game';ui.analysisMetric=ui.analysisDomain==='hitting'?'OPS':ui.analysisDomain==='defense'?'plays':ui.analysisDomain==='baserunning'?'sbPct':'strikePct';}ui.ownSide='all';ui.oppSide='all';renderAnalysis();}));
  $$('#analysisPeriodTabs button').forEach(b=>b.addEventListener('click',()=>{ui.analysisPeriod=b.dataset.period;renderAnalysis();}));
  $('#analysisAnchorDate').addEventListener('change',e=>{ui.analysisAnchor=e.target.value||todayKey();renderAnalysis();});
  $('#analysisPrevDate').addEventListener('click',()=>moveAnalysisAnchor(-1));$('#analysisNextDate').addEventListener('click',()=>moveAnalysisAnchor(1));
  $('#analysisViewSelect').addEventListener('change',e=>{ui.analysisView=e.target.value;renderAnalysis();});
  $$('#analysisDomainTabs button').forEach(b=>b.addEventListener('click',()=>{if(b.hidden)return;ui.analysisDomain=b.dataset.analysisDomain;ui.ownSide='all';ui.oppSide='all';ui.analysisMetric=ui.analysisSource==='training'?(ui.analysisDomain==='all'?'total_tlu':'volume'):(ui.analysisDomain==='hitting'?'OPS':ui.analysisDomain==='defense'?'plays':ui.analysisDomain==='baserunning'?'sbPct':'strikePct');renderAnalysis();}));
  $('#athleteSwitcher').addEventListener('click',()=>showModal('athletePicker'));$('#addAthleteBtn').addEventListener('click',()=>openAthleteModal());$('#pickerAddAthlete').addEventListener('click',()=>{hideModal('athletePicker');openAthleteModal();});$('#athleteForm').addEventListener('submit',saveAthleteForm);$('#deleteAthleteBtn').addEventListener('click',deleteAthleteFromModal);
  $$('[data-close]').forEach(b=>b.addEventListener('click',()=>hideModal(b.dataset.close)));$$('[data-close-defense-edit]').forEach(b=>b.addEventListener('click',requestCloseDefenseEdit));$$('[data-close-training-edit]').forEach(b=>b.addEventListener('click',requestCloseTrainingEdit));document.querySelectorAll('.modal-backdrop').forEach(m=>m.addEventListener('click',e=>{if(e.target!==m)return;if(m.id==='defenseEditModal')requestCloseDefenseEdit();else if(m.id==='trainingEditModal')requestCloseTrainingEdit();else m.hidden=true;}));
  $('#inPlayResults').addEventListener('click',e=>{const b=e.target.closest('[data-result]');if(b)completeInPlay(b.dataset.result);});
  $('#recordEditForm').addEventListener('submit',saveEditedRecord);$('#pitchEditForm').addEventListener('submit',savePitchEdit);$('#deletePitchBtn').addEventListener('click',deletePitchFromEdit);$('#defenseEditForm').addEventListener('submit',saveDefenseEdit);$('#defenseEditDate').addEventListener('change',()=>{defenseEditDirty=true;});$('#trainingEditForm').addEventListener('submit',saveTrainingEdit);$('#trainingEditDate').addEventListener('change',()=>{trainingEditDirty=true;});
  $('#undoDeleteBtn').addEventListener('click',undoDelete);
  $('#toast').addEventListener('click',event=>{if(event.target.closest('[data-toast-action]'))runToastAction();});
  document.body.addEventListener('click',delegatedClick);
  $('#exportData').addEventListener('click',exportBackup);$('#importData').addEventListener('change',importBackup);$('#mergeBackupBtn').addEventListener('click',()=>applyPendingRestore('merge'));$('#replaceBackupBtn').addEventListener('click',()=>applyPendingRestore('replace'));$('#checkLegacyDataBtn').addEventListener('click',recheckLegacyData);
  $('#authLoginPanel').addEventListener('submit',signIn);$('#forgotPasswordBtn').addEventListener('click',requestPasswordReset);$('#authPasswordPanel').addEventListener('submit',completePasswordSetup);$('#signOutBtn').addEventListener('click',()=>signOut());$('#signOutClearBtn').addEventListener('click',()=>signOut({clearCache:true}));$('#syncNowBtn').addEventListener('click',()=>syncCloud(true));$('#cloudPill').addEventListener('click',()=>setView('settings'));
  $('#installApp').addEventListener('click',promptInstall);$('#installMini').addEventListener('click',promptInstall);
  window.addEventListener('online',()=>{cloud.lastError=null;renderCloudStatus();scheduleSync(100);});window.addEventListener('offline',()=>{cloud.lastError=null;renderCloudUI();});
  window.addEventListener('focus',()=>{handleDayRollover();scheduleDayRollover();});window.addEventListener('resize',renderResponsiveInputSummary);document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'){handleDayRollover();scheduleDayRollover();}});
}
function delegatedClick(e){
  const summaryToggle=e.target.closest('[data-toggle-input-summary]');if(summaryToggle){toggleInputSummary();return;}
  const situationChoice=e.target.closest('[data-situation-scope]');if(situationChoice&&handleGameSituationChoice(situationChoice))return;
  const pick=e.target.closest('[data-pick-athlete]');if(pick)return pickAthlete(pick.dataset.pickAthlete);
  const editA=e.target.closest('[data-edit-athlete]');if(editA)return openAthleteModal(editA.dataset.editAthlete);
  const side=e.target.closest('[data-side-kind]');if(side)return setCurrentSide(side.dataset.sideKind,side.dataset.sideValue);
  const as=e.target.closest('[data-analysis-side]');if(as){const [k,v]=as.dataset.analysisSide.split(':');if(k==='own')ui.ownSide=v;else ui.oppSide=v;return renderAnalysis();}
  const hf=e.target.closest('[data-history-filter]');if(hf){const [key,value]=hf.dataset.historyFilter.split(':');if(Object.prototype.hasOwnProperty.call(ui,key))ui[key]=value;return renderHistory();}
  const av=e.target.closest('[data-analysis-view]');if(av){ui.analysisView=av.dataset.analysisView;return renderAnalysis();}
  const am=e.target.closest('[data-analysis-metric]');if(am){ui.analysisMetric=am.dataset.analysisMetric;renderAnalysis();const detail=$('#analysisDetail');if(detail&&window.innerWidth<700)detail.scrollIntoView({behavior:'smooth',block:'start'});return;}
  const cp=e.target.closest('[data-chart-point]');if(cp)return renderChartPoint(cp.dataset.chartPoint);
  const pitch=e.target.closest('[data-edit-pitch]');if(pitch)return openPitchEdit(pitch.dataset.editPitch);
  const resume=e.target.closest('[data-resume-parent]');if(resume){const [kind,id]=resume.dataset.resumeParent.split(':');return resumeParentInput(kind,id);}
  const closeUnknown=e.target.closest('[data-close-parent-unknown]');if(closeUnknown){const [kind,id]=closeUnknown.dataset.closeParentUnknown.split(':');return closeParentUnknown(kind,id);}
  const cancelExit=e.target.closest('[data-cancel-pitching-exit]');if(cancelExit)return cancelPitchingExit(cancelExit.dataset.cancelPitchingExit);
  const deleteParent=e.target.closest('[data-delete-parent]');if(deleteParent){const [kind,id]=deleteParent.dataset.deleteParent.split(':');return softDeleteParent(kind,id);}
  const ep=e.target.closest('[data-edit-parent]');if(ep){const [kind,id]=ep.dataset.editParent.split(':');return openRecordEdit(parentStore(kind),id);}
  const toggle=e.target.closest('[data-toggle-record]');if(toggle){const [kind,id]=toggle.dataset.toggleRecord.split(':'),set=kind==='bf'?expandedBF:kind==='pa'?expandedPA:kind==='defense'?expandedDefense:kind==='baserunning'?expandedBaserunning:kind==='training'?expandedTraining:null;if(!set)return;set.has(id)?set.delete(id):set.add(id);ui.view==='history'?renderHistory():renderRecent();return;}
  const edit=e.target.closest('[data-edit-store]');if(edit)return openRecordEdit(edit.dataset.editStore,edit.dataset.editId);
  const del=e.target.closest('[data-delete-store]');if(del)return softDeleteRecord(del.dataset.deleteStore,del.dataset.deleteId);
  const pet=e.target.closest('[data-pitch-edit-type]');if(pet){pitchEditType=pet.dataset.pitchEditType;renderPitchEditSelections();return;}
  const per=e.target.closest('[data-pitch-edit-result]');if(per){pitchEditResult=per.dataset.pitchEditResult;renderPitchEditSelections();return;}
}function bindDynamicFormEvents(){
  $$('[data-pitch]').forEach(b=>b.addEventListener('click',()=>recordPitch(b.dataset.pitch)));$$('[data-game-throw]').forEach(b=>b.addEventListener('click',()=>recordGameThrow(b.dataset.gameThrow)));$$('[data-bat-pitch]').forEach(b=>b.addEventListener('click',()=>recordBatPitch(b.dataset.batPitch)));
  $('[data-pitching-exit]')?.addEventListener('click',recordPitchingExit);
  bindDefenseEditor('create');bindDefenseTrainingEditor('create');
  $$('[data-steal-result]').forEach(b=>b.addEventListener('click',()=>{$$('[data-steal-result]').forEach(x=>x.classList.remove('active'));b.classList.add('active');}));$('#runFrom')?.addEventListener('change',syncRunTarget);$('#saveBaserunning')?.addEventListener('click',saveBaserunning);
  $$('[data-qty-delta]').forEach(b=>b.addEventListener('click',()=>changeQty(Number(b.dataset.qtyDelta))));$$('[data-qty-set]').forEach(b=>b.addEventListener('click',()=>setQty(Number(b.dataset.qtySet))));$('#trainingQty')?.addEventListener('input',e=>ui.quantity=Math.max(0,Number(e.target.value)||0));$$('[data-save-training]').filter(b=>b.dataset.saveTraining!=='defense').forEach(b=>b.addEventListener('click',()=>saveTrainingSet(b.dataset.saveTraining)));
}
function markDefenseTrainingDirty(mode){if(mode==='edit')trainingEditDirty=true;}
function findDefenseTrainingAction(mode,id){return defenseTrainingDraft(mode)?.actions.find(action=>action.id===id)||null;}
function defenseTrainingActionHasData(action){return Object.entries(action||{}).some(([key,value])=>!['id','type','countOverride','tlu'].includes(key)&&value!==null&&value!==''&&value!==undefined)||action?.countOverride!==null||action?.type==='throw'&&Number(action.tlu)!==.75;}
function renderDefenseTrainingEditor(mode){const root=defenseTrainingRoot(mode);if(!root)return;root.innerHTML=defenseTrainingEditorHtml(mode,{includeSave:mode==='create'});bindDefenseTrainingEditor(mode);}
function setDefenseTrainingQuantity(mode,value){const draft=defenseTrainingDraft(mode);if(!draft)return;draft.quantity=Math.max(0,Math.round(Number(value)||0));if(mode==='create')ui.quantity=draft.quantity;if(draft.trainingMode==='simple'&&draft.trainingType==='THROWING'&&draft.simple.throwCountAuto)draft.simple.throwCount=draft.quantity;markDefenseTrainingDirty(mode);renderDefenseTrainingEditor(mode);}
function bindDefenseTrainingEditor(mode){
  const root=defenseTrainingRoot(mode);if(!root||root.dataset.dtBound==='true')return;root.dataset.dtBound='true';
  root.addEventListener('click',event=>handleDefenseTrainingClick(event,mode));root.addEventListener('change',event=>handleDefenseTrainingChange(event,mode));root.addEventListener('input',event=>handleDefenseTrainingInput(event,mode));
  root.addEventListener('toggle',event=>{if(event.target.matches('[data-dt-outcomes]'))defenseTrainingEditorState[mode].outcomesOpen=event.target.open;},true);
}
function handleDefenseTrainingClick(event,mode){
  const draft=defenseTrainingDraft(mode);if(!draft)return;
  if(mode==='create'&&event.target.closest('[data-save-training="defense"]')){saveTrainingSet('defense');return;}
  const modeButton=event.target.closest('[data-dt-mode]');if(modeButton){const nextMode=modeButton.dataset.dtMode;if(nextMode===draft.trainingMode)return;if(mode==='edit'&&draft.trainingMode==='scenario'&&nextMode==='simple'&&draft.actions.length&&!confirm('간단 기록으로 저장하면 시나리오 동작 정보가 기록에서 제거됩니다. 계속할까요?'))return;draft.trainingMode=nextMode;if(draft.trainingMode==='simple'&&draft.trainingType==='SCENARIO')draft.trainingType='FIELDING';if(mode==='create')ui.defenseTrainingMode=draft.trainingMode;defenseTrainingEditorState[mode].openActionId=draft.actions[0]?.id||null;defenseTrainingEditorState[mode].chooseAfter=null;markDefenseTrainingDirty(mode);renderDefenseTrainingEditor(mode);return;}
  const delta=event.target.closest('[data-dt-qty-delta]');if(delta){setDefenseTrainingQuantity(mode,draft.quantity+Number(delta.dataset.dtQtyDelta));return;}const qtySet=event.target.closest('[data-dt-qty-set]');if(qtySet){setDefenseTrainingQuantity(mode,Number(qtySet.dataset.dtQtySet));return;}
  const toggle=event.target.closest('[data-dt-toggle-action]');if(toggle){const state=defenseTrainingEditorState[mode],id=toggle.dataset.dtToggleAction;state.openActionId=state.openActionId===id?null:id;renderDefenseTrainingEditor(mode);return;}
  if(event.target.closest('[data-dt-end-play]')){draft.flowEnded=true;defenseTrainingEditorState[mode].chooseAfter=null;defenseTrainingEditorState[mode].openActionId=null;markDefenseTrainingDirty(mode);renderDefenseTrainingEditor(mode);return;}
  if(event.target.closest('[data-dt-reopen-flow]')){draft.flowEnded=false;defenseTrainingEditorState[mode].chooseAfter=Math.max(-1,draft.actions.length-1);defenseTrainingEditorState[mode].openActionId=null;markDefenseTrainingDirty(mode);renderDefenseTrainingEditor(mode);return;}
  const openAdd=event.target.closest('[data-dt-open-add]');if(openAdd){defenseTrainingEditorState[mode].chooseAfter=Number(openAdd.dataset.dtOpenAdd);defenseTrainingEditorState[mode].openActionId=null;renderDefenseTrainingEditor(mode);return;}
  const add=event.target.closest('[data-dt-add-type]');if(add){const after=Number(add.dataset.dtAfter),action=newDefenseTrainingAction(add.dataset.dtAddType,uuid());draft.actions.splice(after+1,0,action);defenseTrainingEditorState[mode].openActionId=action.id;defenseTrainingEditorState[mode].chooseAfter=null;markDefenseTrainingDirty(mode);renderDefenseTrainingEditor(mode);return;}
  if(event.target.closest('[data-dt-cancel-add]')){const state=defenseTrainingEditorState[mode],canceledAfter=state.chooseAfter;state.chooseAfter=null;if(canceledAfter===draft.actions.length-1&&draft.actions.length){draft.flowEnded=true;state.openActionId=null;}markDefenseTrainingDirty(mode);renderDefenseTrainingEditor(mode);return;}
  const remove=event.target.closest('[data-dt-remove]');if(remove){const index=draft.actions.findIndex(action=>action.id===remove.dataset.dtRemove);if(index<0)return;const action=draft.actions[index];if(defenseTrainingActionHasData(action)&&!confirm(`${index+1}단계 ${defenseTrainingActionLabel(action.type)}와 입력 내용을 삭제할까요?`))return;draft.actions.splice(index,1);if(!draft.actions.length)draft.flowEnded=false;defenseTrainingEditorState[mode].openActionId=draft.actions[Math.min(index,draft.actions.length-1)]?.id||null;defenseTrainingEditorState[mode].chooseAfter=null;markDefenseTrainingDirty(mode);renderDefenseTrainingEditor(mode);return;}
  const move=event.target.closest('[data-dt-move]');if(move){const index=draft.actions.findIndex(action=>action.id===move.dataset.dtActionId),target=move.dataset.dtMove==='up'?index-1:index+1;if(index<0||target<0||target>=draft.actions.length)return;[draft.actions[index],draft.actions[target]]=[draft.actions[target],draft.actions[index]];defenseTrainingEditorState[mode].chooseAfter=null;markDefenseTrainingDirty(mode);renderDefenseTrainingEditor(mode);return;}
  const choice=event.target.closest('[data-dt-action-choice]');if(choice){const action=findDefenseTrainingAction(mode,choice.dataset.dtActionId);if(!action)return;const key=choice.dataset.dtActionChoice,value=choice.dataset.dtValue;action[key]=key==='tlu'?Number(value):(value||null);markDefenseTrainingDirty(mode);renderDefenseTrainingEditor(mode);return;}
}
function handleDefenseTrainingChange(event,mode){
  const draft=defenseTrainingDraft(mode),target=event.target;if(!draft)return;
  if(target.matches('[data-dt-quantity]')){setDefenseTrainingQuantity(mode,target.value);return;}
  if(target.matches('[data-dt-action-type]')){const index=draft.actions.findIndex(action=>action.id===target.dataset.dtActionId),current=draft.actions[index];if(index<0||!current||current.type===target.value)return;if(defenseTrainingActionHasData(current)&&!confirm(`${defenseTrainingActionLabel(current.type)} 입력 내용을 지우고 ${defenseTrainingActionLabel(target.value)}(으)로 바꿀까요?`)){renderDefenseTrainingEditor(mode);return;}draft.actions[index]=newDefenseTrainingAction(target.value,current.id);markDefenseTrainingDirty(mode);renderDefenseTrainingEditor(mode);return;}
  if(target.matches('[data-dt-action-count]')){const action=findDefenseTrainingAction(mode,target.dataset.dtActionId);if(action){action.countOverride=target.value===''?null:Math.max(0,Math.round(Number(target.value)||0));markDefenseTrainingDirty(mode);renderDefenseTrainingEditor(mode);}return;}
  const field=target.dataset.dtField;if(field){if(field==='note')draft.note=target.value.trim()||null;else{draft[field]=target.value;if(field==='position')draft.area=['LF','CF','RF'].includes(target.value)?'OF':'IF';if(field==='trainingType'){if(target.value==='THROWING'&&(draft.simple.throwCountAuto||draft.simple.throwCount===0)){draft.simple.throwCount=draft.quantity;draft.simple.throwCountAuto=true;}else if(target.value==='FOOTWORK'){draft.simple.throwCount=0;draft.simple.throwCountAuto=true;}else draft.simple.throwCountAuto=false;}}markDefenseTrainingDirty(mode);renderDefenseTrainingEditor(mode);return;}
  const simple=target.dataset.dtSimple;if(simple){draft.simple[simple]=simple==='throwCount'?Math.max(0,Math.round(Number(target.value)||0)):Number(target.value);if(simple==='throwCount')draft.simple.throwCountAuto=false;markDefenseTrainingDirty(mode);renderDefenseTrainingEditor(mode);return;}
  const outcome=target.dataset.dtOutcome;if(outcome){draft.outcomes[outcome]=target.value===''?null:Math.max(0,Math.round(Number(target.value)||0));markDefenseTrainingDirty(mode);renderDefenseTrainingEditor(mode);}
}
function handleDefenseTrainingInput(event,mode){const draft=defenseTrainingDraft(mode),target=event.target;if(!draft)return;if(target.dataset.dtField==='note'){draft.note=target.value||null;markDefenseTrainingDirty(mode);}}
function markDefenseDraftDirty(mode){if(mode==='edit')defenseEditDirty=true;}
function findDefenseAction(mode,id){return defenseDraft(mode)?.actions.find(action=>action.id===id)||null;}
function defenseActionHasUserData(action){const ignored=new Set(['id','type','judgment','tlu']);return Object.entries(action||{}).some(([key,value])=>!ignored.has(key)&&value!==null&&value!==''&&value!==undefined)||Object.values(action?.judgment||{}).some(Boolean);}
function renderDefenseEditor(mode){const root=defenseRoot(mode);if(!root)return;root.innerHTML=defenseEditorHtml(mode);bindDefenseEditor(mode);}
function normalizeDefenseActionDependency(action,key,previous){
  if(action.type==='field'&&key==='battedBall'&&!['GB','BUNT'].includes(action.battedBall))action.fieldingType=null;
  if(action.type==='receive'&&key==='incoming'){if(action.incoming==='uncatchable')action.result='excluded';else if(previous==='uncatchable'&&action.result==='excluded')action.result=null;}
  if(action.type==='receive'&&key==='target'&&!['1B','2B','3B','HOME'].includes(action.target))action.baseHold=null;
}
function setDefenseActionValue(mode,action,key,value){const previous=action[key];action[key]=key==='tlu'?Number(value):(value||null);normalizeDefenseActionDependency(action,key,previous);markDefenseDraftDirty(mode);renderDefenseEditor(mode);}
function setDefenseJudgmentValue(mode,action,key,value){
  action.judgment=action.judgment||{};action.judgment[key]=value||null;
  if(key==='rating'&&!value)action.judgment={rating:null,source:null,note:null,reaction:null,route:null,bestChoice:null,positioning:null,nextReady:null,communication:null};
  markDefenseDraftDirty(mode);renderDefenseEditor(mode);
}
function bindDefenseEditor(mode){
  const root=defenseRoot(mode);if(!root||root.dataset.bound==='true')return;root.dataset.bound='true';
  root.addEventListener('click',event=>handleDefenseEditorClick(event,mode));
  root.addEventListener('change',event=>handleDefenseEditorChange(event,mode));
  root.addEventListener('input',event=>handleDefenseEditorInput(event,mode));
  root.addEventListener('toggle',event=>{const details=event.target;if(!(details instanceof HTMLDetailsElement))return;const state=defenseEditorState[mode],detailKey=details.dataset.defenseDetailsToggle,judgmentKey=details.dataset.defenseJudgmentToggle;if(detailKey){details.open?state.detailsOpen.add(detailKey):state.detailsOpen.delete(detailKey);}if(judgmentKey){details.open?state.judgmentOpen.add(judgmentKey):state.judgmentOpen.delete(judgmentKey);}},true);
}
function handleDefenseEditorClick(event,mode){
  const root=defenseRoot(mode),draft=defenseDraft(mode);if(!root||!draft)return;
  const situationButton=event.target.closest(`[data-situation-scope="defense-${mode}"]`);if(situationButton){draft.situation=changedGameSituation(draft.situation,situationButton);if(mode==='create')rememberGameSituation(draft.situation);markDefenseDraftDirty(mode);renderDefenseEditor(mode);return;}
  const toggle=event.target.closest('[data-defense-toggle-action]');if(toggle){const id=toggle.dataset.defenseToggleAction,state=defenseEditorState[mode];state.openActionId=state.openActionId===id?null:id;renderDefenseEditor(mode);return;}
  const add=event.target.closest('[data-defense-add-type]');if(add){const after=Number(add.dataset.defenseAfter),action=newDefenseAction(add.dataset.defenseAddType,uuid());draft.actions.splice(after+1,0,action);defenseEditorState[mode].openActionId=action.id;defenseEditorState[mode].chooseAfter=null;markDefenseDraftDirty(mode);renderDefenseEditor(mode);return;}
  if(event.target.closest('[data-defense-cancel-next]')){const state=defenseEditorState[mode],canceledAfter=state.chooseAfter;state.chooseAfter=null;if(canceledAfter===draft.actions.length-1&&draft.actions.length)draft.flowEnded=true;markDefenseDraftDirty(mode);renderDefenseEditor(mode);return;}
  const next=event.target.closest('[data-defense-next-action]');if(next){defenseEditorState[mode].chooseAfter=Number(next.dataset.defenseNextAction);defenseEditorState[mode].openActionId=null;renderDefenseEditor(mode);return;}
  if(event.target.closest('[data-defense-end-play]')){draft.flowEnded=true;defenseEditorState[mode].chooseAfter=null;defenseEditorState[mode].openActionId=null;markDefenseDraftDirty(mode);renderDefenseEditor(mode);return;}
  if(event.target.closest('[data-defense-reopen-flow]')){draft.flowEnded=false;defenseEditorState[mode].chooseAfter=Math.max(-1,draft.actions.length-1);markDefenseDraftDirty(mode);renderDefenseEditor(mode);return;}
  const remove=event.target.closest('[data-defense-remove-action]');if(remove){const index=draft.actions.findIndex(action=>action.id===remove.dataset.defenseRemoveAction);if(index<0)return;const action=draft.actions[index];if(defenseActionHasUserData(action)&&!confirm(`${index+1}단계 ${defenseActionLabel(action.type)}와 입력 내용을 삭제할까요?`))return;draft.actions.splice(index,1);if(!draft.actions.length){draft.flowEnded=false;draft.outsRecorded=null;draft.runnersAfter=null;draft.official={status:'missing',po:false,a:false,e:false,dp:false};}defenseEditorState[mode].openActionId=draft.actions[Math.min(index,draft.actions.length-1)]?.id||null;markDefenseDraftDirty(mode);renderDefenseEditor(mode);return;}
  const move=event.target.closest('[data-defense-move]');if(move){const index=draft.actions.findIndex(action=>action.id===move.dataset.defenseActionId),target=move.dataset.defenseMove==='up'?index-1:index+1;if(index<0||target<0||target>=draft.actions.length)return;[draft.actions[index],draft.actions[target]]=[draft.actions[target],draft.actions[index]];markDefenseDraftDirty(mode);renderDefenseEditor(mode);return;}
  const actionButton=event.target.closest('[data-defense-action-key]');if(actionButton){const action=findDefenseAction(mode,actionButton.dataset.defenseActionId);if(action)setDefenseActionValue(mode,action,actionButton.dataset.defenseActionKey,actionButton.dataset.defenseValue);return;}
  const judgmentButton=event.target.closest('[data-defense-judgment-key]');if(judgmentButton){const action=findDefenseAction(mode,judgmentButton.dataset.defenseActionId);if(action)setDefenseJudgmentValue(mode,action,judgmentButton.dataset.defenseJudgmentKey,judgmentButton.dataset.defenseValue);return;}
  const playButton=event.target.closest('[data-defense-play-key]');if(playButton){const key=playButton.dataset.defensePlayKey,value=playButton.dataset.defenseValue||null;if(key==='situation.outs'){draft.situation=draft.situation||{outs:null,runners:null};draft.situation.outs=value===null?null:Number(value);}else draft[key]=key==='outsRecorded'&&value!==null?Number(value):value;markDefenseDraftDirty(mode);renderDefenseEditor(mode);return;}
  if(event.target.closest('[data-defense-runners-before-missing]')){draft.situation=draft.situation||{outs:null,runners:null};draft.situation.runners=null;markDefenseDraftDirty(mode);renderDefenseEditor(mode);return;}
  if(event.target.closest('[data-defense-runners-before-none]')){draft.situation=draft.situation||{outs:null,runners:null};draft.situation.runners=[];markDefenseDraftDirty(mode);renderDefenseEditor(mode);return;}
  const runnerBefore=event.target.closest('[data-defense-runner-before]');if(runnerBefore){draft.situation=draft.situation||{outs:null,runners:null};const value=runnerBefore.dataset.defenseRunnerBefore,set=new Set(Array.isArray(draft.situation.runners)?draft.situation.runners:[]);set.has(value)?set.delete(value):set.add(value);draft.situation.runners=[...set];markDefenseDraftDirty(mode);renderDefenseEditor(mode);return;}
  if(event.target.closest('[data-defense-runners-none]')){draft.runnersAfter=[];markDefenseDraftDirty(mode);renderDefenseEditor(mode);return;}
  const runner=event.target.closest('[data-defense-runner-after]');if(runner){const value=runner.dataset.defenseRunnerAfter,set=new Set(Array.isArray(draft.runnersAfter)?draft.runnersAfter:[]);set.has(value)?set.delete(value):set.add(value);draft.runnersAfter=[...set];markDefenseDraftDirty(mode);renderDefenseEditor(mode);return;}
  const officialState=event.target.closest('[data-defense-official-state]');if(officialState){const status=officialState.dataset.defenseOfficialState;draft.official={status,po:false,a:false,e:false,dp:false};markDefenseDraftDirty(mode);renderDefenseEditor(mode);return;}
  const official=event.target.closest('[data-defense-official]');if(official){const key=official.dataset.defenseOfficial;draft.official=draft.official||{status:'missing',po:false,a:false,e:false,dp:false};draft.official[key]=!draft.official[key];draft.official.status=['po','a','e','dp'].some(name=>draft.official[name])?'entered':'missing';markDefenseDraftDirty(mode);renderDefenseEditor(mode);return;}
  if(event.target.closest('#saveDefense'))saveDefensePlay();
}
function handleDefenseEditorChange(event,mode){
  const draft=defenseDraft(mode),target=event.target;if(!draft)return;
  if(target.matches('[data-defense-action-type-input]')){const index=draft.actions.findIndex(action=>action.id===target.dataset.defenseActionId),current=draft.actions[index];if(index<0||!current||current.type===target.value)return;if(defenseActionHasUserData(current)&&!confirm(`${defenseActionLabel(current.type)} 입력 내용을 지우고 ${defenseActionLabel(target.value)}(으)로 바꿀까요?`)){renderDefenseEditor(mode);return;}draft.actions[index]=newDefenseAction(target.value,current.id);markDefenseDraftDirty(mode);renderDefenseEditor(mode);return;}
  if(target.matches('[data-defense-play-input="position"]')){draft.position=target.value||'SS';markDefenseDraftDirty(mode);renderDefenseEditor(mode);return;}
  const actionInput=target.dataset.defenseActionInput;if(actionInput){const action=findDefenseAction(mode,target.dataset.defenseActionId);if(action){action[actionInput]=target.value===''?null:Number(target.value);markDefenseDraftDirty(mode);}return;}
  const judgmentInput=target.dataset.defenseJudgmentInput;if(judgmentInput){const action=findDefenseAction(mode,target.dataset.defenseActionId);if(action){action.judgment=action.judgment||{};action.judgment[judgmentInput]=target.value||null;markDefenseDraftDirty(mode);}return;}
}
function handleDefenseEditorInput(event,mode){const draft=defenseDraft(mode),target=event.target;if(!draft)return;if(target.matches('[data-defense-play-input="note"]')){draft.note=target.value||null;markDefenseDraftDirty(mode);}else if(target.dataset.defenseJudgmentInput==='note'){const action=findDefenseAction(mode,target.dataset.defenseActionId);if(action){action.judgment.note=target.value||null;markDefenseDraftDirty(mode);}}}
function changeQty(delta){setQty(Math.max(0,(Number($('#trainingQty')?.value)||0)+delta));}function setQty(v){ui.quantity=v;if($('#trainingQty'))$('#trainingQty').value=v;}
function validBaserunningRoute(from,to){return BASERUNNING_NEXT_BASE[from]===to;}
function syncRunTarget(){const v=$('#runFrom')?.value;if(!v)return;$('#runTo').value=BASERUNNING_NEXT_BASE[v]||'';}

async function setCurrentSide(kind,value){
  if(ui.inputMode!=='game')return;
  if(ui.domain==='pitching'){
    if(kind==='batter')ui.pendingBatterSide=value;if(kind==='pitcher')ui.pendingOwnPitchSide=value;
  } else if(ui.domain==='hitting'){
    if(kind==='bat')ui.pendingBatSide=value;if(kind==='oppPitcher')ui.pendingOppPitcherSide=value;
  }
  renderInput();
}
async function ensureBF(){
  let bf=inputBF();if(bf)return bf;const gd=await ensureGameDay(),matchup=currentPitchingMatchup(null);bf={id:uuid(),athleteId:activeAthleteId,gameDayId:gd.id,sequenceNo:nextSequence('batterFaced',ui.inputDate),pitcherSide:matchup.pitcherSide,batterSide:matchup.batterSide,result:null,completed:false,activityDate:ui.inputDate,recordedAt:iso(),ownerId:accountOwnerId(),deletedAt:null};await save('batterFaced',bf,{render:false});return bf;
}async function ensurePA(){
  let pa=inputPA();if(pa)return pa;const gd=await ensureGameDay(),matchup=currentBattingMatchup(null);pa={id:uuid(),athleteId:activeAthleteId,gameDayId:gd.id,sequenceNo:nextSequence('plateAppearances',ui.inputDate),batterSide:matchup.batterSide,pitcherSide:matchup.pitcherSide,result:null,completed:false,activityDate:ui.inputDate,recordedAt:iso(),ownerId:accountOwnerId(),deletedAt:null};await save('plateAppearances',pa,{render:false});return pa;
}
function undoPitchingSituationAdvance(advance){
  const sameContext=advance.athleteId===activeAthleteId&&advance.date===ui.inputDate,latest=sameContext?latestRecordedSituationEvent(advance.date):null,current=sameContext?currentGameSituation(advance.date):null;
  if(!sameContext||latest?.id!==advance.eventId||!sameGameSituation(current,advance.next)){showToast('되돌릴 수 없습니다','다음 기록 또는 직접 변경한 상황이 이미 적용되었습니다.');return;}
  rememberGameSituation(advance.previous,advance.date);renderInput();showToast('자동 변경 취소',`다음 상황 · ${gameSituationSummary(advance.previous)}`);
}
function notifyPitchingCompletion(bf,result,events){
  const terminal=events.at(-1),pitchCount=events.length;if(!PITCHING_OUT_RESULTS.has(result)){showToast('타자 종료',`${pitchCount}구 · ${result} · 아웃 카운트 유지`,'complete');return;}
  const transition=pitchingOutTransition(result,terminal?.metadata?.situation);if(!transition){showToast('타자 아웃',`${pitchCount}구 · ${result} · 아웃 카운트 미입력이라 자동 변경 없음`,'complete');return;}
  const date=terminal?.activityDate||bf.activityDate;if(!sameGameSituation(currentGameSituation(date),transition.previous)){showToast('타자 아웃',`${pitchCount}구 · ${result} · 직접 선택한 현재 상황 유지`,'complete');return;}
  rememberGameSituation(transition.next,date);const advance={athleteId:activeAthleteId,date,eventId:terminal.id,previous:transition.previous,next:transition.next};
  if(transition.inningEnded)showToast('3아웃 · 이닝 종료','다음 상황 · 0아웃 · 주자 없음','complete',{label:'되돌리기',run:()=>undoPitchingSituationAdvance(advance)});
  else showToast(`타자 아웃 · 다음 상황 ${transition.next.outs}아웃`,`${pitchCount}구 · ${result} · 주자 상황 유지`,'complete',{label:'되돌리기',run:()=>undoPitchingSituationAdvance(advance)});
}async function recordPitch(type){
  const matchup=currentPitchingMatchup(),situation=cloneGameSituation(currentGameSituation());if(!requireOwnSide(matchup,'bf'))return;
  if(type==='inplay'){ui.inPlayContext={kind:'bf',matchup,situation};$('#inPlayTitle').textContent='투구 · 타구 결과';$('#inPlayBallType').value='';$('#inPlayDirection').value='';showModal('inPlayModal');return;}
  dismissToastAction();const bf=await ensureBF(),gd=await ensureGameDay();const e={id:uuid(),athleteId:activeAthleteId,gameDayId:gd.id,domain:'pitching',parentType:'batter_faced',parentId:bf.id,eventType:type,activityDate:ui.inputDate,recordedAt:iso(),metadata:{tlu:1,pitcherSide:matchup.pitcherSide,batterSide:matchup.batterSide,situation},ownerId:accountOwnerId(),deletedAt:null};await save('gameEvents',e,{render:false});ui.pendingBatterSide=null;await maybeCompleteBF(bf);renderAll();
}
async function maybeCompleteBF(bf,forcedResult=null){const ev=bfEvents(bf.id),c=countBS(ev,'pitching');let result=forcedResult;if(!result){if(ev.at(-1)?.eventType==='hbp')result='HBP';else if(c.b>=4)result='BB';else if(c.s>=3)result='K';}if(result){bf.result=result;bf.completed=true;await save('batterFaced',bf,{render:false});ui.pendingBatterSide=null;if(resumeContext?.kind==='bf'&&resumeContext.id===bf.id)resumeContext=null;notifyPitchingCompletion(bf,result,ev);}return !!result;}
async function recordGameThrow(type){dismissToastAction();const gd=await ensureGameDay(),throwSide=currentPitchingMatchup().pitcherSide,situation=cloneGameSituation(currentGameSituation());const e={id:uuid(),athleteId:activeAthleteId,gameDayId:gd.id,domain:'pitching',parentType:null,parentId:null,eventType:type,activityDate:ui.inputDate,recordedAt:iso(),metadata:{tlu:GAME_TLU[type],throwSide,situation},ownerId:accountOwnerId(),deletedAt:null};await save('gameEvents',e);}
async function recordBatPitch(type){
  const matchup=currentBattingMatchup(),situation=cloneGameSituation(currentGameSituation());if(!requireOwnSide(matchup,'pa'))return;
  if(type==='in_play'){ui.inPlayContext={kind:'pa',matchup,situation};$('#inPlayTitle').textContent='타격 · 타구 결과';$('#inPlayBallType').value='';$('#inPlayDirection').value='';showModal('inPlayModal');return;}
  const pa=await ensurePA(),gd=await ensureGameDay();const e={id:uuid(),athleteId:activeAthleteId,gameDayId:gd.id,domain:'hitting',parentType:'plate_appearance',parentId:pa.id,eventType:type,activityDate:ui.inputDate,recordedAt:iso(),metadata:{batterSide:matchup.batterSide,pitcherSide:matchup.pitcherSide,situation},ownerId:accountOwnerId(),deletedAt:null};await save('gameEvents',e,{render:false});ui.pendingBatSide=null;await maybeCompletePA(pa);renderAll();
}
async function maybeCompletePA(pa,forcedResult=null){const ev=paEvents(pa.id),c=countBS(ev,'batting');let result=forcedResult;if(!result){if(ev.at(-1)?.eventType==='hbp')result='HBP';else if(c.b>=4)result='BB';else if(c.s>=3)result='SO';}if(result){pa.result=result;pa.completed=true;await save('plateAppearances',pa,{render:false});if(resumeContext?.kind==='pa'&&resumeContext.id===pa.id)resumeContext=null;showToast('타석 종료',`${ev.length}구 · ${result}`,'complete');}return !!result;}
async function completeInPlay(result){hideModal('inPlayModal');const bt=$('#inPlayBallType').value,dir=$('#inPlayDirection').value,context=ui.inPlayContext,situation=cloneGameSituation(context?.situation||currentGameSituation());if(context?.kind==='bf'){const matchup=context.matchup||currentPitchingMatchup();if(!requireOwnSide(matchup,'bf'))return;dismissToastAction();const bf=await ensureBF(),gd=await ensureGameDay();const e={id:uuid(),athleteId:activeAthleteId,gameDayId:gd.id,domain:'pitching',parentType:'batter_faced',parentId:bf.id,eventType:'inplay',activityDate:ui.inputDate,recordedAt:iso(),metadata:{result,battedBall:bt||null,direction:dir||null,tlu:1,pitcherSide:matchup.pitcherSide,batterSide:matchup.batterSide,situation},ownerId:accountOwnerId(),deletedAt:null};await save('gameEvents',e,{render:false});ui.pendingBatterSide=null;await maybeCompleteBF(bf,result);}else if(context?.kind==='pa'){const matchup=context.matchup||currentBattingMatchup();if(!requireOwnSide(matchup,'pa'))return;const pa=await ensurePA(),gd=await ensureGameDay();const e={id:uuid(),athleteId:activeAthleteId,gameDayId:gd.id,domain:'hitting',parentType:'plate_appearance',parentId:pa.id,eventType:'in_play',activityDate:ui.inputDate,recordedAt:iso(),metadata:{result,battedBall:bt||null,direction:dir||null,batterSide:matchup.batterSide,pitcherSide:matchup.pitcherSide,situation},ownerId:accountOwnerId(),deletedAt:null};await save('gameEvents',e,{render:false});ui.pendingBatSide=null;await maybeCompletePA(pa,result);}ui.inPlayContext=null;renderAll();}

async function recordPitchingExit(){
  const bf=inputBF(),events=bf?bfEvents(bf.id):[],count=countBS(events,'pitching'),matchup=bf?eventMatchup('bf',events.at(-1)||null,bf):currentPitchingMatchup(null),detail=bf?`현재 타자 ${events.length}구 · B${count.b}-S${count.s}에서 강판으로 기록합니다. 입력한 공은 투구 분석에 그대로 포함됩니다.`:'현재 시점을 강판으로 기록합니다.';
  if(!confirm(`${detail}\n\n강판 후에도 투구 입력은 계속 사용할 수 있습니다.`))return;
  const gd=await ensureGameDay(),exit={id:uuid(),athleteId:activeAthleteId,gameDayId:gd.id,domain:'pitching',parentType:null,parentId:null,eventType:'pitching_exit',activityDate:ui.inputDate,recordedAt:iso(),metadata:{pitcherSide:matchup.pitcherSide,batterSide:matchup.batterSide,unfinishedBatterFacedId:bf?.id||null,pitchCount:events.length,balls:count.b,strikes:count.s,situation:cloneGameSituation(currentGameSituation())},ownerId:accountOwnerId(),deletedAt:null};
  if(bf){bf.result=RELIEVED_RESULT;bf.completed=false;await save('batterFaced',bf,{render:false,sync:false});if(resumeContext?.kind==='bf'&&resumeContext.id===bf.id)resumeContext=null;expandedBF.add(bf.id);}
  await save('gameEvents',exit,{render:false});ui.pendingBatterSide=null;renderAll();showToast('강판 기록 완료',bf?`${events.length}구 · B${count.b}-S${count.s} · 다음 입력은 새 타자부터 시작합니다.`:'투구 입력은 계속 사용할 수 있습니다.','complete');
}
async function cancelPitchingExit(id){
  const exit=data.gameEvents.find(event=>event.id===id&&!event.deletedAt&&event.eventType==='pitching_exit');if(!exit)return;
  const items=[{store:'gameEvents',record:JSON.parse(JSON.stringify(exit))}],bfId=exit.metadata?.unfinishedBatterFacedId,bf=bfId?data.batterFaced.find(parent=>parent.id===bfId&&!parent.deletedAt):null;
  if(bf&&isRelievedParent(bf)){items.push({store:'batterFaced',record:JSON.parse(JSON.stringify(bf))});bf.result=null;bf.completed=false;await save('batterFaced',bf,{render:false,sync:false});}
  exit.deletedAt=iso();await save('gameEvents',exit,{render:false,sync:false});scheduleSync();pushUndo(items,'강판 기록을 취소했습니다.');renderAll();showToast('강판 취소',bf?'중단했던 타자를 다시 이어서 입력할 수 있습니다.':'강판 기록을 삭제했습니다.');
}

async function saveDefensePlay(){
  const draft=ensureDefenseCreateDraft();if(!draft.actions.length){showToast('수비 동작을 선택하세요','우리 선수가 직접 수행한 첫 동작을 선택하세요.');return;}if(!draft.flowEnded){showToast('플레이를 종료하세요','마지막 동작에서 플레이 종료를 선택한 뒤 저장할 수 있습니다.');return;}if(draft.official?.status==='missing'){showToast('공식 기록을 선택하세요','공식 기록 없음 또는 PO·A·E·DP를 선택해야 저장할 수 있습니다.');return;}
  const gd=await ensureGameDay(),metadata=serializeDefenseDraft(draft),throwTLU=defenseThrowTLU(metadata),missing=defenseMissingFields(metadata).length,e={id:uuid(),athleteId:activeAthleteId,gameDayId:gd.id,domain:'defense',parentType:null,parentId:null,eventType:'fielding_play',activityDate:ui.inputDate,recordedAt:iso(),metadata,ownerId:accountOwnerId(),deletedAt:null};
  await save('gameEvents',e,{render:false});const context=defenseCreateDraft._context;defenseCreateDraft=newDefenseDraft({position:draft.position,throwSide:draft.throwSide});defenseCreateDraft.situation=cloneGameSituation(currentGameSituation());defenseCreateDraft._context=context;resetDefenseEditorState('create');renderAll();showToast('수비 기록 저장',`${metadata.actions.length}동작${throwTLU?` · +${n2(throwTLU)} TLU`:''}${missing?` · 미입력 ${missing}`:''}`,'complete');
}
async function saveBaserunning(){const from=$('#runFrom').value,to=$('#runTo').value,result=$('[data-steal-result].active')?.dataset.stealResult||'SUCCESS';if(!validBaserunningRoute(from,to)){showToast('베이스를 확인하세요','도루는 1루→2루, 2루→3루, 3루→홈만 기록할 수 있습니다.');return;}const gd=await ensureGameDay(),e={id:uuid(),athleteId:activeAthleteId,gameDayId:gd.id,domain:'baserunning',parentType:null,parentId:null,eventType:'steal_attempt',activityDate:ui.inputDate,recordedAt:iso(),metadata:{from,to,result,situation:cloneGameSituation(currentGameSituation())},ownerId:accountOwnerId(),deletedAt:null};await save('gameEvents',e);showToast('도루 기록',`${from}→${to} · ${result==='SUCCESS'?'성공':'실패'}`);}

async function saveTrainingSet(domain){const defenseDraft=domain==='defense'?ensureDefenseTrainingCreateDraft():null,q=domain==='defense'?Math.max(0,Number(defenseDraft.quantity)||0):Math.max(0,Number($('#trainingQty')?.value)||0);if(!q){showToast('횟수를 입력하세요');return;}if(defenseDraft?.trainingMode==='scenario'&&!defenseDraft.actions.length){showToast('시나리오 동작을 추가하세요','첫 수비 동작을 선택한 뒤 저장할 수 있습니다.');return;}if(defenseDraft?.trainingMode==='scenario'&&!defenseDraft.flowEnded){showToast('플레이를 종료하세요','마지막 동작에서 플레이 종료를 선택한 뒤 저장할 수 있습니다.');return;}const outcomeError=defenseDraft?defenseTrainingOutcomeError(defenseDraft,q):null;if(outcomeError){showToast('훈련 결과를 확인하세요',outcomeError);defenseTrainingEditorState.create.outcomesOpen=true;renderDefenseTrainingEditor('create');return;}let rec={id:uuid(),athleteId:activeAthleteId,activityDate:ui.inputDate,domain,trainingType:'OTHER',side:null,quantity:q,unit:'reps',tluPerRep:0,tluTotal:0,metadata:{},recordedAt:iso(),ownerId:accountOwnerId(),deletedAt:null};
  if(domain==='pitching'){const intensity=$('#trPitchIntensity').value,weights={light:.75,medium:.85,max:1};rec.trainingType='throwing';rec.side=$('#trPitchSide').value;rec.unit='throws';rec.metadata.intensity=intensity;rec.tluPerRep=weights[intensity];rec.tluTotal=round2(q*rec.tluPerRep);}
  else if(domain==='hitting'){rec.trainingType=$('#trHitType').value;rec.side=$('#trHitSide').value;rec.unit='swings';rec.metadata.velocity=Number($('#trHitVelocity').value)||null;}
  else if(domain==='defense'){const stats=defenseTrainingStats(defenseDraft,q);rec.trainingType=defenseDraft.trainingMode==='scenario'?'SCENARIO':defenseDraft.trainingType;rec.unit='reps';rec.metadata=serializeDefenseTrainingDraft(defenseDraft);rec.tluPerRep=q?round2(stats.throwTLU/q):0;rec.tluTotal=stats.throwTLU;}
  else {rec.trainingType=$('#trRunType').value;rec.unit='reps';rec.metadata={distanceM:Number($('#trRunDistance').value)||null,bestTime:Number($('#trRunBest').value)||null};}
  await save('trainingSets',rec,{render:false});if(domain==='defense'){defenseDraft.outcomes={target:null,adjust:null,failed:null};defenseDraft.note=null;defenseTrainingEditorState.create.outcomesOpen=false;}renderAll();showToast('훈련 세트 저장',trainingSetSub(rec),'complete');setQty(q);}

function openAthleteModal(id=null){const a=id?data.athletes.find(x=>x.id===id):null;$('#athleteModalTitle').textContent=a?'선수 수정':'선수 추가';$('#athleteId').value=a?.id||'';$('#athleteName').value=a?.name||'';$('#athleteNumber').value=a?.number||'';$('#athleteBirthDate').value=a?.birthDate||'';$('#athleteTeam').value=a?.team||'';$('#athletePosition').value=a?.position||'';$('#athleteThrows').value=a?.throws||'R';$('#athleteBats').value=a?.bats||'R';$('#deleteAthleteBtn').style.visibility=a?'visible':'hidden';showModal('athleteModal');}
async function saveAthleteForm(e){e.preventDefault();const id=$('#athleteId').value||uuid(),old=data.athletes.find(x=>x.id===id);const rec={...(old||{}),id,name:$('#athleteName').value.trim()||'선수',number:$('#athleteNumber').value.trim(),birthDate:$('#athleteBirthDate').value,team:$('#athleteTeam').value.trim(),position:$('#athletePosition').value.trim(),throws:$('#athleteThrows').value,bats:$('#athleteBats').value,ownerId:accountOwnerId(),deletedAt:null};await save('athletes',rec,{render:false});if(!activeAthleteId){activeAthleteId=id;await setMeta('activeAthleteId',id);}hideModal('athleteModal');renderAll();}
async function deleteAthleteFromModal(){const id=$('#athleteId').value;if(!id)return;const activeA=active(data.athletes);if(activeA.length<=1){showToast('선수는 최소 1명 필요합니다');return;}if(!confirm('이 선수를 삭제할까요? 기록은 복구를 위해 soft-delete 됩니다.'))return;const a=data.athletes.find(x=>x.id===id);a.deletedAt=iso();await save('athletes',a,{render:false});if(activeAthleteId===id){activeAthleteId=active(data.athletes).find(x=>x.id!==id)?.id;await setMeta('activeAthleteId',activeAthleteId);}hideModal('athleteModal');renderAll();}
async function pickAthlete(id){activeAthleteId=id;await setMeta('activeAthleteId',id);hideModal('athletePicker');renderAll();}

function rawParentEvents(parentType,parentId){
  return active(data.gameEvents).filter(e=>e.parentType===parentType&&e.parentId===parentId).sort((a,b)=>new Date(a.recordedAt)-new Date(b.recordedAt));
}
async function recomputeParent(parentType,parentId){
  if(parentType==='batter_faced'){
    const bf=data.batterFaced.find(x=>x.id===parentId);if(!bf)return null;const was=!!bf.completed,wasUnknown=isUnknownParent(bf),wasRelieved=isRelievedParent(bf);
    const ev=rawParentEvents(parentType,parentId),c=countBS(ev,'pitching');let result=null,last=ev.at(-1);if(last?.eventType==='hbp')result='HBP';else if(last?.eventType==='inplay')result=last.metadata?.result||'IN_PLAY';else if(c.b>=4)result='BB';else if(c.s>=3)result='K';
    const nextResult=result||(wasRelieved?RELIEVED_RESULT:(wasUnknown&&ev.length?UNKNOWN_RESULT:null)),nextCompleted=!!result,changed=bf.result!==nextResult||!!bf.completed!==nextCompleted;
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
  const store=parentStore(kind),p=recordsFor(store).find(x=>x.id===id);if(!p||p.completed||isRelievedParent(p))return;
  if(isUnknownParent(p)){p.result=null;await save(store,p,{render:false});}
  resumeContext={kind,id};ui.inputDate=p.activityDate;ui.inputMode='game';ui.domain=kind==='bf'?'pitching':'hitting';(kind==='bf'?expandedBF:expandedPA).add(id);setView('input');renderInput();showToast(`${parentTypeName(kind)} #${p.sequenceNo} 수정 중`,'남은 공을 이어서 입력하세요.');
}

function pitchEditOptions(kind){return kind==='bf'?[['ball','BALL'],['called','루킹'],['swinging','헛스윙'],['foul','파울'],['inplay','IN PLAY'],['hbp','HBP']]:[['taken_ball','볼 지켜봄'],['taken_strike','스트라이크 지켜봄'],['swinging_strike','헛스윙'],['foul','파울'],['in_play','IN PLAY'],['hbp','HBP']];}
function pitchEditSideOptions(type,current){const labels=type==='throw'?[['','미입력'],['R','우투'],['L','좌투']]:[['','미입력'],['R','우타'],['L','좌타']];return labels.map(([value,label])=>`<option value="${value}" ${(current||'')===value?'selected':''}>${label}</option>`).join('');}
function openPitchEdit(id){const e=recordsFor('gameEvents').find(x=>x.id===id);if(!e||!e.parentId)return;pitchEditId=id;pitchEditType=e.eventType;pitchEditResult=e.metadata?.result||'OUT';pitchEditSituation=cloneGameSituation(e.metadata?.situation);const kind=e.parentType==='batter_faced'?'bf':'pa',p=recordsFor(parentStore(kind)).find(x=>x.id===e.parentId),events=parentEvents(kind,e.parentId),idx=events.findIndex(x=>x.id===id),matchup=eventMatchup(kind,e,p);$('#pitchEditTitle').textContent=`${parentTypeName(kind)} #${p?.sequenceNo||''} · ${idx+1}구 수정`;$('#pitchEditId').value=id;$('#pitchEditKind').value=kind;$('#pitchEditMatchupFields').innerHTML=kind==='bf'?`<label>투구 방향<select id="pitchEditOwnSide">${pitchEditSideOptions('throw',matchup.pitcherSide)}</select></label><label>상대 타자<select id="pitchEditOppSide">${pitchEditSideOptions('bat',matchup.batterSide)}</select></label>`:`<label>타격 방향<select id="pitchEditOwnSide">${pitchEditSideOptions('bat',matchup.batterSide)}</select></label><label>상대 투수<select id="pitchEditOppSide">${pitchEditSideOptions('throw',matchup.pitcherSide)}</select></label>`;$('#pitchEditSituation').innerHTML=`<span class="edit-label">이 공의 경기 상황</span>${gameSituationFieldsHtml(pitchEditSituation,{scope:'pitch-edit'})}`;$('#pitchEditTypeButtons').innerHTML=pitchEditOptions(kind).map(([v,l])=>`<button type="button" data-pitch-edit-type="${v}">${l}</button>`).join('');$('#pitchEditResultButtons').innerHTML=['OUT','1B','2B','3B','HR','ROE','SH','SF'].map(v=>`<button type="button" data-pitch-edit-result="${v}">${v}</button>`).join('');$('#pitchEditBallType').value=e.metadata?.battedBall||'';$('#pitchEditDirection').value=e.metadata?.direction||'';$('#pitchEditPitchType').value=e.metadata?.pitchType||'';$('#pitchEditVelocity').value=e.metadata?.velocity||'';$('#pitchEditZone').value=e.metadata?.zone||'';$('#pitchEditNote').value=e.metadata?.note||'';renderPitchEditSelections();showModal('pitchEditModal');}
function renderPitchEditSelections(){const kind=$('#pitchEditKind')?.value||'bf';$$('#pitchEditTypeButtons [data-pitch-edit-type]').forEach(b=>{b.classList.toggle('selected',b.dataset.pitchEditType===pitchEditType);const tone=pitchTone(kind,{eventType:b.dataset.pitchEditType});b.classList.remove('ball','strike','inplay','hbp');if(tone)b.classList.add(tone);});const isInPlay=pitchEditType===(kind==='bf'?'inplay':'in_play');$('#pitchEditInPlayFields').hidden=!isInPlay;$$('#pitchEditResultButtons [data-pitch-edit-result]').forEach(b=>b.classList.toggle('selected',b.dataset.pitchEditResult===pitchEditResult));}
function completionIndexAfterEdit(kind,events,editedId,newType){let b=0,s=0;for(let i=0;i<events.length;i++){const t=events[i].id===editedId?newType:events[i].eventType;if(kind==='bf'){if(t==='ball')b++;else if(['called','swinging','foul','inplay'].includes(t)){if(!(t==='foul'&&s>=2))s++;}if(t==='hbp'||t==='inplay'||b>=4||s>=3)return i;}else{if(t==='taken_ball')b++;else if(['taken_strike','swinging_strike','foul','in_play'].includes(t)){if(!(t==='foul'&&s>=2))s++;}if(t==='hbp'||t==='in_play'||b>=4||s>=3)return i;}}return -1;}
async function savePitchEdit(ev){ev.preventDefault();const e=recordsFor('gameEvents').find(x=>x.id===pitchEditId);if(!e)return;const kind=$('#pitchEditKind').value;const events=parentEvents(kind,e.parentId),terminalIndex=completionIndexAfterEdit(kind,events,e.id,pitchEditType);if(terminalIndex>=0&&terminalIndex<events.length-1){showToast('수정할 수 없습니다','이 공에서 타자/타석이 끝나면 뒤의 투구 기록과 충돌합니다. 뒤 기록을 먼저 수정하거나 삭제하세요.');return;}e.eventType=pitchEditType;e.metadata=e.metadata||{};e.metadata.situation=cloneGameSituation(pitchEditSituation);const own=$('#pitchEditOwnSide').value||null,opp=$('#pitchEditOppSide').value||null;if(kind==='bf'){e.metadata.pitcherSide=own;e.metadata.batterSide=opp;}else{e.metadata.batterSide=own;e.metadata.pitcherSide=opp;}if(e.domain==='pitching')e.metadata.tlu=1;const isInPlay=pitchEditType===(kind==='bf'?'inplay':'in_play');if(isInPlay){e.metadata.result=pitchEditResult||'OUT';e.metadata.battedBall=$('#pitchEditBallType').value||null;e.metadata.direction=$('#pitchEditDirection').value||null;}else{e.metadata.result=null;e.metadata.battedBall=null;e.metadata.direction=null;}e.metadata.pitchType=$('#pitchEditPitchType').value.trim()||null;e.metadata.velocity=Number($('#pitchEditVelocity').value)||null;e.metadata.zone=$('#pitchEditZone').value.trim()||null;e.metadata.note=$('#pitchEditNote').value.trim()||null;await save('gameEvents',e,{render:false});const state=await recomputeParent(e.parentType,e.parentId);hideModal('pitchEditModal');renderAll();const p=state?.parent;showToast(`${parentTypeName(kind)} #${p?.sequenceNo||''} 수정됨`,p?.completed?`${parentEvents(kind,p.id).length}구 · ${p.result}`:isRelievedParent(p)?'강판 중단 상태를 유지했습니다.':'미완료 상태로 재계산되었습니다.');}
async function deletePitchFromEdit(){const id=pitchEditId;if(!id)return;hideModal('pitchEditModal');await softDeleteRecord('gameEvents',id);}
function pushUndo(items,message='기록을 삭제했습니다.'){lastDeleted={items};$('#undoText').textContent=message;$('#undoBar').hidden=false;clearTimeout(undoTimer);undoTimer=setTimeout(()=>{$('#undoBar').hidden=true;lastDeleted=null;},5000);}
async function softDeleteRecord(store,id){
  const rec=data[store]?.find(x=>x.id===id);if(!rec||rec.deletedAt)return;const backup=JSON.parse(JSON.stringify(rec));rec.deletedAt=iso();await save(store,rec,{render:false});
  if(store==='gameEvents'&&rec.parentType&&rec.parentId)await recomputeParent(rec.parentType,rec.parentId);
  if(store==='gameEvents'){expandedDefense.delete(id);expandedBaserunning.delete(id);}
  if(store==='trainingSets')expandedTraining.delete(id);
  pushUndo([{store,record:backup}]);renderAll();
}
async function softDeleteParent(kind,id){
  const store=parentStore(kind),parent=data[store]?.find(x=>x.id===id);if(!parent||parent.deletedAt)return;
  const parentType=kind==='bf'?'batter_faced':'plate_appearance';
  const children=data.gameEvents.filter(x=>!x.deletedAt&&((x.parentId===id&&x.parentType===parentType)||(kind==='bf'&&x.eventType==='pitching_exit'&&x.metadata?.unfinishedBatterFacedId===id)));
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

function openDefenseEdit(id){
  const rec=recordsFor('gameEvents').find(item=>item.id===id&&item.domain==='defense');if(!rec)return;defenseEditId=id;defenseEditDraft=normalizeDefenseMetadata(rec.metadata||{});defenseEditDirty=false;resetDefenseEditorState('edit');
  const firstMissing=defenseMissingFields(defenseEditDraft).find(item=>item.actionId);defenseEditorState.edit.openActionId=firstMissing?.actionId||defenseEditDraft.actions[0]?.id||null;$('#defenseEditDate').value=rec.activityDate||todayKey();showModal('defenseEditModal');renderDefenseEditor('edit');
}
function requestCloseDefenseEdit(){if(defenseEditDirty&&!confirm('수정한 내용을 저장하지 않고 닫을까요?'))return;defenseEditDirty=false;defenseEditDraft=null;defenseEditId=null;hideModal('defenseEditModal');}
async function saveDefenseEdit(event){
  event.preventDefault();const rec=data.gameEvents.find(item=>item.id===defenseEditId&&!item.deletedAt);if(!rec||!defenseEditDraft)return;if(!defenseEditDraft.actions.length){showToast('수비 동작이 필요합니다','기록을 유지하려면 수비 동작을 하나 이상 입력하세요.');return;}if(!defenseEditDraft.flowEnded){showToast('플레이를 종료하세요','마지막 동작에서 플레이 종료를 선택한 뒤 저장할 수 있습니다.');return;}if(defenseEditDraft.official?.status==='missing'){showToast('공식 기록을 선택하세요','공식 기록 없음 또는 PO·A·E·DP를 선택해야 저장할 수 있습니다.');return;}
  const oldDate=rec.activityDate,nextDate=$('#defenseEditDate').value||oldDate,metadata=serializeDefenseDraft(defenseEditDraft);rec.activityDate=nextDate;rec.metadata=metadata;if(oldDate!==nextDate){const gd=await ensureGameDay(nextDate);rec.gameDayId=gd.id;}await save('gameEvents',rec,{render:false});const missing=defenseMissingFields(metadata).length,throwTLU=defenseThrowTLU(metadata);defenseEditDirty=false;defenseEditDraft=null;defenseEditId=null;hideModal('defenseEditModal');renderAll();showToast('수비 기록 수정 완료',`${metadata.actions.length}동작${throwTLU?` · ${n2(throwTLU)} TLU`:''}${missing?` · 미입력 ${missing}`:''}`,'complete');
}

function trainingEditTypeOptions(domain,current){const options=domain==='hitting'?[['DRY_SWING','빈스윙'],['TEE','티'],['TOSS','토스'],['BP','배팅볼'],['MACHINE','머신'],['LIVE','라이브']]:domain==='baserunning'?[['STEAL_START','도루 스타트'],['LEAD_REACTION','리드/반응'],['BASE_RUNNING','베이스러닝'],['SLIDING','슬라이딩'],['SPRINT','스프린트'],['OTHER','기타']]:[['throwing','투구']];return options.map(([value,label])=>`<option value="${value}" ${current===value?'selected':''}>${label}</option>`).join('');}
function genericTrainingEditHtml(rec){const m=rec.metadata||{},unit=rec.unit==='throws'?'투구 횟수':rec.unit==='swings'?'스윙 횟수':'훈련 횟수';let html=`<div class="training-generic-editor"><div class="form-grid"><label>${unit}<input name="quantity" type="number" min="1" value="${rec.quantity}" /></label><label>훈련 종류<select name="trainingType">${trainingEditTypeOptions(rec.domain,rec.trainingType)}</select></label>`;if(['pitching','hitting'].includes(rec.domain))html+=`<label>${rec.domain==='pitching'?'투구':'타격'} 방향<select name="side"><option value="R" ${rec.side==='R'?'selected':''}>${rec.domain==='pitching'?'우투':'우타'}</option><option value="L" ${rec.side==='L'?'selected':''}>${rec.domain==='pitching'?'좌투':'좌타'}</option></select></label>`;if(rec.domain==='pitching')html+=`<label>TLU / 회<select name="tluPerRep"><option value="0.75" ${Number(rec.tluPerRep)===.75?'selected':''}>가벼운 · 0.75</option><option value="0.85" ${Number(rec.tluPerRep)===.85?'selected':''}>중간 · 0.85</option><option value="1" ${Number(rec.tluPerRep)===1?'selected':''}>전력 · 1.00</option></select></label>`;if(rec.domain==='hitting')html+=`<label>구속 km/h · 선택<input name="velocity" type="number" min="0" max="200" value="${m.velocity||''}" /></label>`;if(rec.domain==='baserunning')html+=`<label>거리 m · 선택<input name="distanceM" type="number" min="0" value="${m.distanceM||''}" /></label><label>최고 기록 sec · 선택<input name="bestTime" type="number" min="0" step="0.01" value="${m.bestTime||''}" /></label>`;return `${html}<label class="span-2">훈련 메모 · 선택<input name="note" value="${esc(m.note||'')}" /></label></div></div>`;}
function openTrainingEdit(id){const rec=data.trainingSets.find(item=>item.id===id&&!item.deletedAt);if(!rec)return;trainingEditRecord=JSON.parse(JSON.stringify(rec));trainingEditDirty=false;defenseTrainingEditDraft=null;resetDefenseTrainingEditorState('edit');$('#trainingEditTitle').textContent=`${DOMAIN_LABEL[rec.domain]} 훈련 수정`;$('#trainingEditDate').value=rec.activityDate||todayKey();$('#trainingEditForm').scrollTop=0;showModal('trainingEditModal');if(rec.domain==='defense'){defenseTrainingEditDraft=normalizeDefenseTrainingRecord(rec);defenseTrainingEditorState.edit.openActionId=(defenseTrainingEditDraft.flowEnded?defenseTrainingEditDraft.actions[0]:defenseTrainingEditDraft.actions.at(-1))?.id||null;$('#trainingEditEditor').className='defense-editor defense-training-editor training-edit-editor';renderDefenseTrainingEditor('edit');}else{$('#trainingEditEditor').className='training-edit-editor';$('#trainingEditEditor').innerHTML=genericTrainingEditHtml(trainingEditRecord);$('#trainingEditEditor').oninput=()=>{trainingEditDirty=true;};$('#trainingEditEditor').onchange=()=>{trainingEditDirty=true;};}}
function requestCloseTrainingEdit(){if(trainingEditDirty&&!confirm('수정한 내용을 저장하지 않고 닫을까요?'))return;trainingEditDirty=false;trainingEditRecord=null;defenseTrainingEditDraft=null;$('#trainingEditEditor').oninput=null;$('#trainingEditEditor').onchange=null;hideModal('trainingEditModal');}
async function saveTrainingEdit(event){
  event.preventDefault();if(!trainingEditRecord)return;const rec=data.trainingSets.find(item=>item.id===trainingEditRecord.id&&!item.deletedAt);if(!rec)return;const nextDate=$('#trainingEditDate').value||rec.activityDate;
  if(rec.domain==='defense'){
    const draft=defenseTrainingEditDraft;if(!draft.quantity){showToast('횟수를 입력하세요');return;}if(draft.trainingMode==='scenario'&&!draft.actions.length){showToast('시나리오 동작을 추가하세요');return;}if(draft.trainingMode==='scenario'&&!draft.flowEnded){showToast('플레이를 종료하세요','마지막 동작에서 플레이 종료를 선택한 뒤 저장할 수 있습니다.');return;}const error=defenseTrainingOutcomeError(draft,draft.quantity);if(error){showToast('훈련 결과를 확인하세요',error);defenseTrainingEditorState.edit.outcomesOpen=true;renderDefenseTrainingEditor('edit');return;}const stats=defenseTrainingStats(draft,draft.quantity);rec.quantity=draft.quantity;rec.trainingType=draft.trainingMode==='scenario'?'SCENARIO':draft.trainingType;rec.unit='reps';rec.side=null;rec.metadata=serializeDefenseTrainingDraft(draft);rec.tluPerRep=draft.quantity?round2(stats.throwTLU/draft.quantity):0;rec.tluTotal=stats.throwTLU;
  }else{
    const fd=new FormData(event.currentTarget),quantity=Math.max(0,Math.round(Number(fd.get('quantity'))||0));if(!quantity){showToast('횟수를 입력하세요');return;}rec.quantity=quantity;rec.trainingType=fd.get('trainingType')||rec.trainingType;rec.metadata=rec.metadata||{};rec.metadata.note=String(fd.get('note')||'').trim()||null;if(fd.has('side'))rec.side=fd.get('side')||null;if(rec.domain==='pitching'){rec.tluPerRep=Math.max(0,Number(fd.get('tluPerRep'))||0);rec.metadata.intensity=rec.tluPerRep===1?'max':rec.tluPerRep===.85?'medium':'light';rec.tluTotal=round2(quantity*rec.tluPerRep);}else if(rec.domain==='hitting'){rec.metadata.velocity=Number(fd.get('velocity'))||null;rec.tluPerRep=0;rec.tluTotal=0;}else{rec.metadata.distanceM=Number(fd.get('distanceM'))||null;rec.metadata.bestTime=Number(fd.get('bestTime'))||null;rec.tluPerRep=0;rec.tluTotal=0;}
  }
  rec.activityDate=nextDate;await save('trainingSets',rec,{render:false});trainingEditDirty=false;trainingEditRecord=null;defenseTrainingEditDraft=null;hideModal('trainingEditModal');renderAll();showToast('훈련 기록 수정 완료',trainingSetSub(rec),'complete');
}

function openRecordEdit(store,id){const rec=data[store]?.find(x=>x.id===id);if(!rec)return;if(store==='trainingSets'){openTrainingEdit(id);return;}if(store==='gameEvents'&&rec.domain==='defense'){openDefenseEdit(id);return;}recordEditSituation=store==='gameEvents'?cloneGameSituation(rec.metadata?.situation):null;$('#editRecordStore').value=store;$('#editRecordId').value=id;let html=`<label>활동 날짜<input name="activityDate" type="date" value="${rec.activityDate||todayKey()}" /></label>`;
  if(store==='batterFaced')html+=`<label>전체 투구 방향<select name="pitcherSide"><option value="">미입력</option><option value="R" ${rec.pitcherSide==='R'?'selected':''}>우투</option><option value="L" ${rec.pitcherSide==='L'?'selected':''}>좌투</option></select></label><label>전체 상대 타자<select name="batterSide"><option value="">미입력</option><option value="R" ${rec.batterSide==='R'?'selected':''}>우타</option><option value="L" ${rec.batterSide==='L'?'selected':''}>좌타</option></select></label><p class="parent-edit-scope span-2">방향을 바꾸면 이 타자에게 기록한 모든 공에 일괄 적용됩니다. 한 공만 고치려면 펼친 기록에서 해당 공을 선택하세요.</p><div class="derived-field"><span>결과</span><b>${esc(parentResultLabel(rec))}</b><small>투구 기록에서 자동 계산</small></div>`;
  else if(store==='plateAppearances')html+=`<label>전체 타격 방향<select name="batterSide"><option value="">미입력</option><option value="R" ${rec.batterSide==='R'?'selected':''}>우타</option><option value="L" ${rec.batterSide==='L'?'selected':''}>좌타</option></select></label><label>전체 상대 투수<select name="pitcherSide"><option value="">미입력</option><option value="R" ${rec.pitcherSide==='R'?'selected':''}>우투</option><option value="L" ${rec.pitcherSide==='L'?'selected':''}>좌투</option></select></label><p class="parent-edit-scope span-2">방향을 바꾸면 이 타석에 기록한 모든 공에 일괄 적용됩니다. 한 공만 고치려면 펼친 기록에서 해당 공을 선택하세요.</p><div class="derived-field"><span>결과</span><b>${esc(parentResultLabel(rec))}</b><small>투구 기록에서 자동 계산</small></div>`;
  else if(store==='gameEvents'){
    const m=rec.metadata||{};
    html+=`<div class="record-edit-situation span-2"><span class="edit-label">이 기록의 경기 상황</span>${gameSituationFieldsHtml(recordEditSituation,{scope:'record-edit'})}</div>`;
    html+=rec.domain==='baserunning'?`<div class="derived-field"><span>기록 종류</span><b>도루 시도</b><small>출발·도착·결과를 아래에서 수정하세요.</small></div>`:`<label>이벤트<input name="eventType" value="${esc(rec.eventType)}" /></label>`;
    html+=`<label class="span-2">메모<input name="note" value="${esc(m.note||'')}" placeholder="영상 분석 메모" /></label>`;
    if(rec.domain==='pitching'||['hitting','batting'].includes(rec.domain))html+=`<label>타구 결과<input name="result" value="${esc(m.result||'')}" /></label><label>타구 형태<select name="battedBall"><option value="">미입력</option>${['GB','LD','FB'].map(v=>`<option ${m.battedBall===v?'selected':''}>${v}</option>`).join('')}</select></label><label>타구 방향<select name="direction"><option value="">미입력</option>${[['L','좌'],['C','중'],['R','우']].map(([v,l])=>`<option value="${v}" ${m.direction===v?'selected':''}>${l}</option>`).join('')}</select></label><label>구종 (선택)<input name="pitchType" value="${esc(m.pitchType||'')}" /></label><label>구속 km/h (선택)<input name="velocity" type="number" value="${m.velocity||''}" /></label><label>위치 (선택)<input name="zone" value="${esc(m.zone||'')}" /></label>`;
    if(rec.domain==='pitching'&&!rec.parentId)html+=`<label>투구 방향<select name="throwSide"><option value="">미입력</option><option value="R" ${m.throwSide==='R'?'selected':''}>우투</option><option value="L" ${m.throwSide==='L'?'selected':''}>좌투</option></select></label>`;
    if(rec.domain==='baserunning')html+=`<label>출발 베이스<select id="editRunFrom" name="from">${[['1B','1루'],['2B','2루'],['3B','3루']].map(([v,l])=>`<option value="${v}" ${m.from===v?'selected':''}>${l}</option>`).join('')}</select></label><label>도착 베이스<select id="editRunTo" name="to">${[['2B','2루'],['3B','3루'],['HOME','홈']].map(([v,l])=>`<option value="${v}" ${m.to===v?'selected':''}>${l}</option>`).join('')}</select></label><label class="span-2">도루 결과<select name="result">${[['SUCCESS','성공'],['FAILED','실패']].map(([v,l])=>`<option value="${v}" ${m.result===v?'selected':''}>${l}</option>`).join('')}</select></label><p class="parent-edit-scope span-2">도루는 1루→2루, 2루→3루, 3루→홈의 한 베이스 단위로 저장됩니다.</p>`;
  }
  $('#recordEditFields').innerHTML=html;$('#editRunFrom')?.addEventListener('change',e=>{const to=$('#editRunTo');if(to)to.value=BASERUNNING_NEXT_BASE[e.target.value]||'';});showModal('recordEditModal');
}
async function saveEditedRecord(e){e.preventDefault();const store=$('#editRecordStore').value,id=$('#editRecordId').value,rec=data[store].find(x=>x.id===id);if(!rec)return;if(store==='trainingSets'){hideModal('recordEditModal');openTrainingEdit(id);return;}if(store==='gameEvents'&&rec.domain==='defense'){hideModal('recordEditModal');openDefenseEdit(id);return;}const fd=new FormData(e.currentTarget),oldDate=rec.activityDate,oldPitcherSide=rec.pitcherSide||null,oldBatterSide=rec.batterSide||null;if(store==='gameEvents'&&rec.domain==='baserunning'&&!validBaserunningRoute(fd.get('from'),fd.get('to'))){showToast('베이스를 확인하세요','도루는 1루→2루, 2루→3루, 3루→홈만 저장할 수 있습니다.');return;}rec.activityDate=fd.get('activityDate')||rec.activityDate;if(store==='batterFaced'){rec.pitcherSide=fd.get('pitcherSide')||null;rec.batterSide=fd.get('batterSide')||null;/* result is derived from child pitches */}else if(store==='plateAppearances'){rec.batterSide=fd.get('batterSide')||null;rec.pitcherSide=fd.get('pitcherSide')||null;/* result is derived from child pitches */}else{rec.eventType=fd.get('eventType')||rec.eventType;rec.metadata=rec.metadata||{};rec.metadata.situation=cloneGameSituation(recordEditSituation);for(const k of ['note','result','battedBall','direction','pitchType','zone','throwSide','from','to']){const v=fd.get(k);if(v!==null)rec.metadata[k]=v||null;}const vel=fd.get('velocity');if(vel!==null)rec.metadata.velocity=vel?Number(vel):null;}
  const isParent=['batterFaced','plateAppearances'].includes(store),sideChanged=isParent&&(oldPitcherSide!==(rec.pitcherSide||null)||oldBatterSide!==(rec.batterSide||null)),parentChildren=isParent?data.gameEvents.filter(child=>child.parentId===rec.id&&!child.deletedAt):[];
  if(sideChanged&&parentChildren.length&&!confirm(`변경한 투타 방향을 기록된 ${parentChildren.length}개 공에 모두 적용할까요?`)){rec.activityDate=oldDate;rec.pitcherSide=oldPitcherSide;rec.batterSide=oldBatterSide;return;}
  if(oldDate!==rec.activityDate&&['gameEvents','batterFaced','plateAppearances'].includes(store)){const gd=await ensureGameDay(rec.activityDate);rec.gameDayId=gd.id;}
  await save(store,rec,{render:false});
  if(sideChanged){for(const child of parentChildren){child.metadata=child.metadata||{};child.metadata.pitcherSide=rec.pitcherSide||null;child.metadata.batterSide=rec.batterSide||null;await save('gameEvents',child,{render:false,sync:false});}if(store==='batterFaced'){for(const exit of data.gameEvents.filter(item=>!item.deletedAt&&item.eventType==='pitching_exit'&&item.metadata?.unfinishedBatterFacedId===rec.id)){exit.metadata.pitcherSide=rec.pitcherSide||null;exit.metadata.batterSide=rec.batterSide||null;await save('gameEvents',exit,{render:false,sync:false});}}}
  if(store==='gameEvents'&&rec.parentType&&rec.parentId){
    if(oldDate!==rec.activityDate){const parentStore=rec.parentType==='batter_faced'?'batterFaced':'plateAppearances',parent=data[parentStore].find(x=>x.id===rec.parentId);const gd=await ensureGameDay(rec.activityDate);if(parent){parent.activityDate=rec.activityDate;parent.gameDayId=gd.id;await save(parentStore,parent,{render:false});}for(const sibling of data.gameEvents.filter(x=>x.parentType===rec.parentType&&x.parentId===rec.parentId&&!x.deletedAt)){if(sibling.id!==rec.id){sibling.activityDate=rec.activityDate;sibling.gameDayId=gd.id;await save('gameEvents',sibling,{render:false});}}}
    await recomputeParent(rec.parentType,rec.parentId);
  }
  if(oldDate!==rec.activityDate&&['batterFaced','plateAppearances'].includes(store)){const gd=await ensureGameDay(rec.activityDate);for(const child of data.gameEvents.filter(x=>!x.deletedAt&&(x.parentId===rec.id||(store==='batterFaced'&&x.eventType==='pitching_exit'&&x.metadata?.unfinishedBatterFacedId===rec.id)))){child.activityDate=rec.activityDate;child.gameDayId=gd.id;await save('gameEvents',child,{render:false});}}
  hideModal('recordEditModal');renderAll();showToast('기록 수정 완료');}

function maskEmail(email=''){const [name='',domain='']=String(email).split('@');if(!domain)return '';return `${name.slice(0,2)}${name.length>2?'***':''}@${domain}`;}
async function buildBackupPayload(){
  const uid=accountOwnerId(),accountData=await snapshot({ownerId:uid});
  return {version:7,schemaVersion:7,appVersion:'7.10.0',exportOwnerId:uid,exportEmailHint:maskEmail(cloud.session?.user?.email||''),exportedAt:iso(),data:accountData};
}
function downloadBackupFile(payload,suffix='백업'){
  const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}),a=document.createElement('a');
  a.href=URL.createObjectURL(blob);a.download=`야구일기-${todayKey()}-${suffix}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);
}
async function exportBackup(){try{downloadBackupFile(await buildBackupPayload());showToast('현재 계정 백업 완료');}catch(err){console.error(err);showToast('백업 실패',err.message||'기록을 확인하세요.');}}
function backupData(raw){return raw?.data&&typeof raw.data==='object'?raw.data:raw;}
function validateBackupOwner(raw,uid){
  if(Number(raw?.version||0)>=7){if(!raw.exportOwnerId)throw new Error('계정 정보가 없는 V7 백업입니다.');if(raw.exportOwnerId!==uid)throw new Error('다른 계정에서 만든 백업은 불러올 수 없습니다.');}
  const owners=snapshotOwnerIds(backupData(raw));if(owners.some(owner=>owner!==uid))throw new Error('다른 계정 소유 기록이 포함된 백업은 불러올 수 없습니다.');
}
async function importBackup(e){
  const file=e.target.files?.[0];if(!file)return;
  try{
    const raw=JSON.parse(await file.text()),uid=accountOwnerId();
    if(!raw||(!raw.data&&!raw.athletes))throw new Error('야구일기 백업 형식이 아닙니다.');
    validateBackupOwner(raw,uid);
    const content=backupData(raw),preview=previewSnapshot(content);if(!preview.athletes)throw new Error('선수 기록이 없는 백업입니다.');
    pendingRestore={raw,content,preview,fileName:file.name,legacy:Number(raw.version||0)<7};
    $('#restoreAthletes').textContent=`${preview.athletes}명`;$('#restoreGames').textContent=`${preview.gameDays}일`;$('#restoreEvents').textContent=`${preview.gameEvents}건`;$('#restoreTraining').textContent=`${preview.trainingSets}건`;
    $('#restoreRange').textContent=preview.from?`기록 기간 ${fmtDate(preview.from)} ~ ${fmtDate(preview.to)}`:'날짜가 입력된 기록이 없습니다.';
    $('#restoreAccountText').textContent=pendingRestore.legacy?'이전 버전의 소유자 없는 백업입니다. 현재 계정 기록으로만 가져옵니다.':`현재 계정(${maskEmail(cloud.session?.user?.email||'')})에서 만든 백업입니다.`;
    showModal('restorePreviewModal');
  }catch(err){console.error(err);showToast('백업을 열 수 없습니다',err.message||'파일을 확인하세요.');}
  finally{e.target.value='';}
}
async function applyPendingRestore(mode){
  if(!pendingRestore)return;
  if(mode==='replace'&&!confirm('현재 계정의 로컬 기록을 백업 내용으로 교체할까요? 복원 전 현재 기록은 자동으로 내려받습니다.'))return;
  const uid=accountOwnerId();
  try{
    downloadBackupFile(await buildBackupPayload(),'복원전');
    if(mode==='replace')await replaceSnapshot(pendingRestore.content,{ownerId:uid,markDirty:true});
    else await mergeSnapshot(pendingRestore.content,{ownerId:uid,markDirty:true});
    gameSituationDrafts.clear();
    await ensureInitialData(uid);await reloadData();logIntegrity('backup restore');hideModal('restorePreviewModal');pendingRestore=null;renderAll();scheduleSync(100);
    showToast(mode==='replace'?'백업으로 교체했습니다':'백업을 병합했습니다','현재 계정에만 적용되었습니다.');
  }catch(err){console.error(err);showToast('백업 복원 실패',err.message||'파일을 확인하세요.');}
}

function cloudConfig(){const c=window.BASEBALL_SUPABASE_CONFIG||{},url=String(c.url||''),key=String(c.publishableKey||c.anonKey||'');return {url,key,valid:url.startsWith('https://')&&!url.includes('YOUR-PROJECT')&&(key.startsWith('sb_publishable_')||key.startsWith('eyJ'))};}
function authLinkType(){const query=new URLSearchParams(location.search),hash=new URLSearchParams(location.hash.replace(/^#/,''));return hash.get('type')||query.get('type')||null;}
function setAuthMessage(target,text='',kind='error'){const el=$(target);if(!el)return;el.hidden=!text;el.className=`auth-message ${kind}`;el.textContent=text;}
function showAuthPanel(id){
  $('#app').hidden=true;$('#authGate').hidden=false;
  for(const panel of ['authLoadingPanel','authLoginPanel','authPasswordPanel','authConfigPanel','legacyMigrationPanel'])$('#'+panel).hidden=panel!==id;
}
function showLogin(message=''){showAuthPanel('authLoginPanel');setAuthMessage('#authMessage',message,message?'error':'');}
function showPasswordSetup(type='invite'){showAuthPanel('authPasswordPanel');$('#passwordPanelTitle').textContent=type==='recovery'?'새 비밀번호를 설정하세요':'초대를 마무리하세요';$('#passwordPanelCopy').textContent=type==='recovery'?'앞으로 사용할 새 비밀번호를 입력하세요.':'초대받은 계정에서 사용할 비밀번호를 설정하면 야구일기가 열립니다.';setAuthMessage('#passwordMessage','');}
function showAppShell(){$('#authGate').hidden=true;$('#app').hidden=false;}
function resetAccountMemory(){
  data={athletes:[],gameDays:[],batterFaced:[],plateAppearances:[],gameEvents:[],trainingSets:[]};activeAthleteId=null;resumeContext=null;expandedBF.clear();expandedPA.clear();expandedDefense.clear();expandedBaserunning.clear();expandedTraining.clear();gameSituationDrafts.clear();defenseCreateDraft=null;defenseEditDraft=null;defenseEditId=null;defenseEditDirty=false;defenseTrainingCreateDraft=null;defenseTrainingEditDraft=null;trainingEditRecord=null;trainingEditDirty=false;resetDefenseEditorState('create');resetDefenseEditorState('edit');resetDefenseTrainingEditorState('create');resetDefenseTrainingEditorState('edit');lastDeleted=null;toastAction=null;clearTimeout(toastTimer);pendingRestore=null;ui.analysisAnchor=todayKey();ui.analysisPeriod='1';ui.ownSide='all';ui.oppSide='all';analysisConditionsInitialized=false;
  for(const id of ['athleteList','athletePickerList','historyList','recentInputList','analysisMetrics','analysisDetail','analysisBreakdown']){const el=$('#'+id);if(el)el.innerHTML='';}
  $$('.modal-backdrop').forEach(modal=>modal.hidden=true);$('#toast').classList.remove('show','actionable');
}
function assertActivation(uid,token){if(cloud.accountUid!==uid||cloud.activation!==token){const error=new Error('계정 전환으로 작업이 중단되었습니다.');error.code='ACCOUNT_CHANGED';throw error;}}
async function deactivateAccount(){
  cloud.activation++;cloud.activationPromise=null;clearTimeout(syncTimer);cloud.syncing=false;cloud.syncPromise=null;cloud.accountUid=null;cloud.lastError=null;cloud.localOnlyCount=0;cloud.lastSync=0;resetAccountMemory();await closeDB();$('#app').hidden=true;
}
function cleanAuthUrl(){const url=new URL(location.href);url.search='';url.hash='';history.replaceState({},document.title,url.href);}
function authError(err){
  if(!navigator.onLine)return '인터넷 연결을 확인하세요. 이미 로그인된 계정은 오프라인에서도 사용할 수 있습니다.';
  const message=String(err?.message||err||'');
  if(/invalid login credentials/i.test(message))return '이메일 또는 비밀번호가 맞지 않습니다.';
  if(/expired|otp/i.test(message))return '초대 또는 비밀번호 재설정 링크가 만료되었습니다. 새 링크를 요청하세요.';
  if(/email not confirmed/i.test(message))return '이메일 확인이 아직 완료되지 않았습니다.';
  if(/rate limit/i.test(message))return '요청이 너무 많습니다. 잠시 후 다시 시도하세요.';
  return message||'계정 요청을 처리하지 못했습니다.';
}
async function promptLegacyMigration(legacy){
  const p=legacy.preview;$('#migrationAthletes').textContent=`${p.athletes}명`;$('#migrationGames').textContent=`${p.gameDays}일`;$('#migrationEvents').textContent=`${p.gameEvents}건`;$('#migrationTraining').textContent=`${p.trainingSets}건`;$('#migrationRange').textContent=p.from?`기록 기간 ${fmtDate(p.from)} ~ ${fmtDate(p.to)}`:'날짜가 입력된 기록이 없습니다.';$('#migrationIsolationNote').hidden=!legacy.partial;showAuthPanel('legacyMigrationPanel');
  return new Promise(resolve=>{$('#importLegacyBtn').onclick=()=>resolve('import');$('#skipMigrationBtn').onclick=()=>resolve('skip');});
}
async function handleLegacyMigration({force=false}={}){
  const uid=accountOwnerId(),state=await getMeta('legacyMigrationState',null);if(state&&!force)return {status:state.status||state};
  const legacy=await inspectLegacyData(uid);
  if(legacy.blocked){await setMeta('legacyMigrationState',{status:'foreign',checkedAt:iso()});return {status:'foreign'};}
  if(!legacy.available){await setMeta('legacyMigrationState',{status:'none',checkedAt:iso()});return {status:'none'};}
  const decision=await promptLegacyMigration(legacy);showAuthPanel('authLoadingPanel');
  if(decision==='import'){await mergeSnapshot(legacy.data,{ownerId:uid,markDirty:true});await setMeta('legacyMigrationState',{status:'imported',source:legacy.source,importedAt:iso(),preview:legacy.preview});await reloadData();return {status:'imported'};}
  await setMeta('legacyMigrationState',{status:'skipped',source:legacy.source,skippedAt:iso()});return {status:'skipped'};
}
async function activateSession(session){
  const uid=session?.user?.id;if(!uid){showLogin();return;}
  if(cloud.accountUid===uid&&!$('#app').hidden)return;
  if(cloud.activationPromise?.uid===uid)return cloud.activationPromise.promise;
  const promise=(async()=>{
    if(cloud.accountUid&&cloud.accountUid!==uid)await deactivateAccount();
    const token=++cloud.activation;cloud.session=session;cloud.accountUid=uid;cloud.lastError=null;cloud.lastSync=Number(localStorage.getItem(`btV7LastSync:${uid}`)||0);showAuthPanel('authLoadingPanel');
    await configureAccountDB(uid);assertActivation(uid,token);await reloadData();await handleLegacyMigration();assertActivation(uid,token);
    if(navigator.onLine)await syncCloud(false,{render:false,expectedActivation:token});assertActivation(uid,token);
    await reloadData();await ensureInitialData(uid);await reloadData();assertActivation(uid,token);logIntegrity('startup');showAppShell();renderAll();scheduleSync(100);
  })();
  cloud.activationPromise={uid,promise};
  try{await promise;}catch(err){if(err?.code!=='ACCOUNT_CHANGED'&&cloud.accountUid===uid){console.error('Account activation failed',err);showLogin(`계정 기록을 열지 못했습니다: ${err.message||err}`);}}finally{if(cloud.activationPromise?.promise===promise)cloud.activationPromise=null;}
}
async function handleAuthEvent(event,session){
  if(event==='SIGNED_OUT'){
    const current=await cloud.client?.auth.getSession();
    if(current?.data?.session){cloud.session=current.data.session;await activateSession(current.data.session);return;}
    cloud.session=null;await deactivateAccount();showLogin();return;
  }
  cloud.session=session||null;
  if(event==='PASSWORD_RECOVERY'){cloud.authLinkType='recovery';showPasswordSetup('recovery');return;}
  if(session&&['INITIAL_SESSION','SIGNED_IN','USER_UPDATED'].includes(event)){
    if(['invite','recovery'].includes(cloud.authLinkType||'')){showPasswordSetup(cloud.authLinkType);return;}
    await activateSession(session);return;
  }
  if(event==='TOKEN_REFRESHED')renderCloudUI();
}
async function initCloud(){
  const cfg=cloudConfig();cloud.authLinkType=authLinkType();
  if(!cfg.valid){cloud.configured=false;showAuthPanel('authConfigPanel');return;}
  if(!window.supabase?.createClient){cloud.configured=false;showLogin('로그인 모듈을 불러오지 못했습니다. 앱을 다시 열어 주세요.');return;}
  cloud.configured=true;cloud.client=window.supabase.createClient(cfg.url,cfg.key,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
  cloud.client.auth.onAuthStateChange((event,session)=>setTimeout(()=>handleAuthEvent(event,session).catch(err=>console.error('Auth event failed',err)),0));
  const {data:result,error}=await cloud.client.auth.getSession();if(error)throw error;cloud.session=result.session||null;
  if(cloud.session){if(['invite','recovery'].includes(cloud.authLinkType||''))showPasswordSetup(cloud.authLinkType);else await activateSession(cloud.session);}
  else showLogin(cloud.authLinkType?'초대 또는 비밀번호 재설정 링크가 만료되었습니다. 새 링크를 요청하세요.':'');
}
async function signIn(e){
  e?.preventDefault();if(!cloud.client)return;const email=$('#authEmail').value.trim(),password=$('#authPassword').value,button=$('#signInBtn');setAuthMessage('#authMessage','');button.disabled=true;
  try{const {data:result,error}=await cloud.client.auth.signInWithPassword({email,password});if(error)throw error;if(result.session)await activateSession(result.session);}catch(err){setAuthMessage('#authMessage',authError(err));}finally{button.disabled=false;}
}
async function requestPasswordReset(){
  const email=$('#authEmail').value.trim();if(!email){setAuthMessage('#authMessage','먼저 초대받은 이메일을 입력하세요.');return;}
  try{const redirectTo=new URL(location.href);redirectTo.search='';redirectTo.hash='';const {error}=await cloud.client.auth.resetPasswordForEmail(email,{redirectTo:redirectTo.href});if(error)throw error;setAuthMessage('#authMessage','비밀번호 재설정 메일을 보냈습니다. 메일의 새 링크를 Safari에서 여세요.','success');}catch(err){setAuthMessage('#authMessage',authError(err));}
}
async function completePasswordSetup(e){
  e?.preventDefault();const password=$('#newPassword').value,confirmPassword=$('#confirmNewPassword').value;if(password.length<8){setAuthMessage('#passwordMessage','비밀번호는 8자 이상으로 입력하세요.');return;}if(password!==confirmPassword){setAuthMessage('#passwordMessage','두 비밀번호가 서로 다릅니다.');return;}
  const button=$('#setPasswordBtn');button.disabled=true;try{const {data:result,error}=await cloud.client.auth.updateUser({password});if(error)throw error;cloud.authLinkType=null;cleanAuthUrl();setAuthMessage('#passwordMessage','');await activateSession(result.user?{...(cloud.session||{}),user:result.user}:cloud.session);}catch(err){setAuthMessage('#passwordMessage',authError(err));}finally{button.disabled=false;}
}
function pendingSyncCount(){return storeNames.reduce((sum,store)=>sum+data[store].filter(record=>record.ownerId===cloud.accountUid&&record.dirty).length,0);}
function localOnlyRecordCount(){return storeNames.reduce((sum,store)=>sum+data[store].filter(record=>record.ownerId===cloud.accountUid&&record.localOnlyReason).length,0);}
async function signOut({clearCache=false}={}){
  const uid=cloud.accountUid;if(!uid)return;const pending=pendingSyncCount(),localOnly=localOnlyRecordCount();
  if(clearCache&&pending){showToast('캐시를 삭제할 수 없습니다',`아직 동기화되지 않은 기록 ${pending}건이 있습니다.`);return;}
  const message=clearCache?(localOnly?`서버에 올리지 않고 보존 중인 기존 비정상 기록 ${localOnly}건이 있습니다. 현재 계정 전체 백업을 먼저 내려받은 뒤 이 기기 캐시를 삭제할까요?`:'로그아웃하고 이 기기의 현재 계정 캐시를 삭제할까요? 서버 기록은 삭제되지 않습니다.'):pending?`동기화 대기 기록 ${pending}건은 이 계정 전용으로 기기에 남습니다. 로그아웃할까요?`:'로그아웃할까요?';if(!confirm(message))return;
  if(clearCache&&localOnly){try{downloadBackupFile(await buildBackupPayload(),'캐시삭제전');}catch(err){console.error(err);showToast('캐시를 삭제하지 않았습니다','안전 백업을 만들지 못했습니다.');return;}}
  try{await cloud.client?.auth.signOut({scope:'local'});}catch(err){console.warn(err);}cloud.session=null;await deactivateAccount();if(clearCache)await deleteAccountDatabase(uid);showLogin();
}
async function recheckLegacyData(){
  try{const result=await handleLegacyMigration({force:true});showAppShell();await ensureInitialData(accountOwnerId());await reloadData();renderAll();if(result.status==='imported'){scheduleSync(100);showToast('기존 기록을 가져왔습니다');}else if(result.status==='foreign')showToast('가져올 수 없는 기록입니다','다른 계정에 이미 연결된 기기 기록은 표시하거나 이전하지 않습니다.');else if(result.status==='none')showToast('기존 기록이 없습니다');}
  catch(err){console.error(err);showAppShell();renderAll();showToast('기존 기록 확인 실패',err.message||'다시 시도하세요.');}
}
function renderCloudStatus(forceStatus=null,forceText=null){
  const pill=$('#cloudPill'),badge=$('#cloudBadge');if(!pill||!badge)return;let status=forceStatus,text=forceText;
  if(!status){if(cloud.lastError){status='error';text='동기화 오류';}else if(!navigator.onLine){status='offline';text='오프라인';}else if(cloud.syncing){status='syncing';text='동기화 중';}else if(pendingSyncCount()){status='syncing';text='저장 대기';}else{status='synced';text='동기화됨';}}
  pill.className=`cloud-pill ${status}`;pill.textContent=text;badge.className=`cloud-badge ${status}`;badge.textContent=text;const button=$('#syncNowBtn');if(button){button.disabled=cloud.syncing;button.querySelector('b').textContent=cloud.syncing?'동기화 중…':'지금 동기화';}
}
function renderCloudUI(){
  if(!cloud.accountUid)return;const pending=pendingSyncCount();$('#cloudUserEmail').textContent=cloud.session?.user?.email||'로그인됨';$('#cloudStatusText').textContent=cloud.lastError?cloud.lastError:!navigator.onLine?'오프라인 기록은 이 계정 전용으로 기기에 보관됩니다.':'서버와 이 기기의 계정 전용 기록을 자동으로 맞춥니다.';$('#cloudPendingCount').textContent=pending?`동기화 대기 ${pending}건`:cloud.localOnlyCount?`동기화 완료 · 비정상 기존 행 ${cloud.localOnlyCount}건은 로컬 보존`:'모든 변경사항 동기화 완료';$('#cloudLastSync').textContent=cloud.lastSync?`마지막 동기화: ${new Date(cloud.lastSync).toLocaleString('ko-KR')}`:'아직 동기화 기록이 없습니다.';renderCloudStatus();
}
function scheduleSync(delay=700){if(!cloud.configured||!cloud.session||!cloud.accountUid||!navigator.onLine)return;clearTimeout(syncTimer);syncTimer=setTimeout(()=>syncCloud(false),delay);}

const cloudDefs={
  athletes:{table:'athletes',to:r=>({id:r.id,owner_id:r.ownerId,name:r.name,number:r.number||null,birth_date:r.birthDate||null,team:r.team||null,position:r.position||null,throws:r.throws||'R',bats:r.bats||'R',client_updated_at:r.clientUpdatedAt||0,deleted_at:r.deletedAt||null}),from:r=>({id:r.id,ownerId:r.owner_id,name:r.name,number:r.number||'',birthDate:r.birth_date||'',team:r.team||'',position:r.position||'',throws:r.throws||'R',bats:r.bats||'R',clientUpdatedAt:Number(r.client_updated_at||0),updatedAt:r.updated_at,deletedAt:r.deleted_at,dirty:false})},
  gameDays:{table:'game_days_v6',to:r=>({id:r.id,owner_id:r.ownerId,athlete_id:r.athleteId,activity_date:r.activityDate,client_updated_at:r.clientUpdatedAt||0,deleted_at:r.deletedAt||null}),from:r=>({id:r.id,ownerId:r.owner_id,athleteId:r.athlete_id,activityDate:r.activity_date,clientUpdatedAt:Number(r.client_updated_at||0),updatedAt:r.updated_at,deletedAt:r.deleted_at,dirty:false})},
  batterFaced:{table:'batter_faced_v6',to:r=>({id:r.id,owner_id:r.ownerId,athlete_id:r.athleteId,game_day_id:r.gameDayId,activity_date:r.activityDate,sequence_no:r.sequenceNo,pitcher_side:r.pitcherSide||null,batter_side:r.batterSide||null,result:r.result||null,completed:!!r.completed,recorded_at:r.recordedAt||r.updatedAt||iso(),client_updated_at:r.clientUpdatedAt||0,deleted_at:r.deletedAt||null}),from:r=>({id:r.id,ownerId:r.owner_id,athleteId:r.athlete_id,gameDayId:r.game_day_id,activityDate:r.activity_date,sequenceNo:r.sequence_no,pitcherSide:r.pitcher_side,batterSide:r.batter_side,result:r.result,completed:r.completed,recordedAt:r.recorded_at,clientUpdatedAt:Number(r.client_updated_at||0),updatedAt:r.updated_at,deletedAt:r.deleted_at,dirty:false})},
  plateAppearances:{table:'plate_appearances_v6',to:r=>({id:r.id,owner_id:r.ownerId,athlete_id:r.athleteId,game_day_id:r.gameDayId,activity_date:r.activityDate,sequence_no:r.sequenceNo,batter_side:r.batterSide||null,pitcher_side:r.pitcherSide||null,result:r.result||null,completed:!!r.completed,recorded_at:r.recordedAt||r.updatedAt||iso(),client_updated_at:r.clientUpdatedAt||0,deleted_at:r.deletedAt||null}),from:r=>({id:r.id,ownerId:r.owner_id,athleteId:r.athlete_id,gameDayId:r.game_day_id,activityDate:r.activity_date,sequenceNo:r.sequence_no,batterSide:r.batter_side,pitcherSide:r.pitcher_side,result:r.result,completed:r.completed,recordedAt:r.recorded_at,clientUpdatedAt:Number(r.client_updated_at||0),updatedAt:r.updated_at,deletedAt:r.deleted_at,dirty:false})},
  gameEvents:{table:'game_events_v6',to:r=>({id:r.id,owner_id:r.ownerId,athlete_id:r.athleteId,game_day_id:r.gameDayId,activity_date:r.activityDate,domain:r.domain,parent_type:r.parentType||null,parent_id:r.parentId||null,event_type:r.eventType,recorded_at:r.recordedAt,metadata:r.metadata||{},client_updated_at:r.clientUpdatedAt||0,deleted_at:r.deletedAt||null}),from:r=>({id:r.id,ownerId:r.owner_id,athleteId:r.athlete_id,gameDayId:r.game_day_id,activityDate:r.activity_date,domain:r.domain,parentType:r.parent_type,parentId:r.parent_id,eventType:r.event_type,recordedAt:r.recorded_at,metadata:r.metadata||{},clientUpdatedAt:Number(r.client_updated_at||0),updatedAt:r.updated_at,deletedAt:r.deleted_at,dirty:false})},
  trainingSets:{table:'training_sets_v6',to:r=>({id:r.id,owner_id:r.ownerId,athlete_id:r.athleteId,activity_date:r.activityDate,domain:r.domain,training_type:r.trainingType,side:r.side||null,quantity:r.quantity,unit:r.unit,intensity:r.metadata?.intensity||null,tlu_per_rep:r.tluPerRep||0,tlu_total:r.tluTotal||0,metadata:r.metadata||{},recorded_at:r.recordedAt,client_updated_at:r.clientUpdatedAt||0,deleted_at:r.deletedAt||null}),from:r=>({id:r.id,ownerId:r.owner_id,athleteId:r.athlete_id,activityDate:r.activity_date,domain:r.domain,trainingType:r.training_type,side:r.side,quantity:Number(r.quantity||0),unit:r.unit,intensity:r.intensity,tluPerRep:Number(r.tlu_per_rep||0),tluTotal:Number(r.tlu_total||0),metadata:r.metadata||{},recordedAt:r.recorded_at,clientUpdatedAt:Number(r.client_updated_at||0),updatedAt:r.updated_at,deletedAt:r.deleted_at,dirty:false})}
};
function isUploadableRecord(store,record,uid){
  if(record.ownerId!==uid)return false;if(store==='athletes')return true;
  const athlete=data.athletes.find(item=>item.id===record.athleteId&&item.ownerId===uid);if(!athlete)return false;
  if(store==='gameDays'||store==='trainingSets')return true;
  const gameDay=data.gameDays.find(item=>item.id===record.gameDayId&&item.athleteId===record.athleteId&&item.ownerId===uid);if(!gameDay||gameDay.activityDate!==record.activityDate)return false;
  if(['batterFaced','plateAppearances'].includes(store))return true;
  if(store!=='gameEvents')return false;
  if(record.deletedAt)return true;
  if(!record.parentType&&!record.parentId){
    if(record.domain==='pitching')return ['pickoff_normal','pickoff_error','game_warmup','pitching_exit'].includes(record.eventType);
    return ['defense','baserunning'].includes(record.domain);
  }
  if(record.parentType==='batter_faced'&&record.domain==='pitching')return data.batterFaced.some(item=>item.id===record.parentId&&item.athleteId===record.athleteId&&item.gameDayId===record.gameDayId&&item.ownerId===uid&&!item.deletedAt);
  if(record.parentType==='plate_appearance'&&record.domain==='hitting')return data.plateAppearances.some(item=>item.id===record.parentId&&item.athleteId===record.athleteId&&item.gameDayId===record.gameDayId&&item.ownerId===uid&&!item.deletedAt);
  return false;
}
function syncErrorMessage(err){
  if(!navigator.onLine)return '인터넷에 연결되지 않아 계정 전용 로컬 기록에 저장했습니다.';
  const code=String(err?.code||''),message=String(err?.message||err||'');
  if(code==='42P01')return '서버 테이블이 없습니다. migration_v6.sql을 먼저 실행하세요.';
  if(code==='42501'||/row-level security|permission denied/i.test(message))return '서버 권한이 거부되었습니다. RLS와 로그인 계정을 확인하세요.';
  if(/jwt|refresh token|session/i.test(message))return '로그인 세션이 만료되었습니다. 다시 로그인하세요.';
  if(/timeout|timed out/i.test(message))return '서버 응답이 지연되고 있습니다. 기록은 기기에 안전하게 남아 있습니다.';
  if(/failed to fetch|network/i.test(message))return '서버에 연결하지 못했습니다. 기록은 기기에 안전하게 남아 있습니다.';
  return `동기화 실패: ${message||'서버 설정을 확인하세요.'}`;
}
async function syncCloud(manual=false,{render=true,expectedActivation=null}={}){
  if(cloud.syncing)return cloud.syncPromise||false;
  if(!cloud.client||!cloud.session||!cloud.accountUid){if(manual)showToast('로그인이 필요합니다');return false;}
  if(!navigator.onLine){cloud.lastError=null;renderCloudUI();if(manual)showToast('오프라인입니다','기록은 현재 계정 전용으로 기기에 저장됩니다.');return false;}
  const uid=cloud.accountUid,token=expectedActivation??cloud.activation;
  cloud.syncing=true;cloud.lastError=null;renderCloudStatus();
  const task=(async()=>{
    let conflictCount=0,preservedInvalidCount=0;
    try{
      for(const store of storeNames){
        assertActivation(uid,token);
        const def=cloudDefs[store],response=await cloud.client.from(def.table).select('*').eq('owner_id',uid);if(response.error)throw response.error;assertActivation(uid,token);
        const remoteRecords=(response.data||[]).map(def.from),remoteMap=new Map(remoteRecords.map(record=>[record.id,record])),localMap=new Map(data[store].filter(record=>record.ownerId===uid).map(record=>[record.id,record])),localWrites=[],uploads=[];
        for(const local of localMap.values())if(local.localOnlyReason&&isUploadableRecord(store,local,uid)){delete local.localOnlyReason;local.dirty=true;}
        const queueUpload=local=>{if(isUploadableRecord(store,local,uid)){delete local.localOnlyReason;uploads.push(local);}else{local.dirty=false;local.localOnlyReason='invalid_relation_preserved';localWrites.push(local);preservedInvalidCount++;}};
        for(const remote of remoteRecords){
          const local=localMap.get(remote.id);
          if(!local){localWrites.push(remote);localMap.set(remote.id,remote);continue;}
          const remoteTime=Number(remote.clientUpdatedAt||0),localTime=Number(local.clientUpdatedAt||0);
          if(local.dirty){
            if(remoteTime>localTime){localWrites.push(remote);localMap.set(remote.id,remote);conflictCount++;}
            else queueUpload(local);
          }else if(remoteTime>=localTime){localWrites.push(remote);localMap.set(remote.id,remote);}
        }
        for(const local of localMap.values())if(local.dirty&&!remoteMap.has(local.id))queueUpload(local);
        if(localWrites.length){assertActivation(uid,token);await putMany(store,localWrites);}
        for(let index=0;index<uploads.length;index+=100){
          const chunk=uploads.slice(index,index+100),result=await cloud.client.from(def.table).upsert(chunk.map(def.to),{onConflict:'id'});if(result.error)throw result.error;assertActivation(uid,token);
          for(const record of chunk)record.dirty=false;await putMany(store,chunk);
        }
        data[store]=[...localMap.values()];
      }
      assertActivation(uid,token);cloud.lastSync=Date.now();cloud.localOnlyCount=storeNames.reduce((sum,store)=>sum+data[store].filter(record=>record.localOnlyReason).length,0);localStorage.setItem(`btV7LastSync:${uid}`,cloud.lastSync);cloud.lastError=null;await setMeta('lastSyncConflicts',{count:conflictCount,preservedInvalidCount,at:iso()});logIntegrity('cloud sync');if(render&&!$('#app').hidden)renderAll();renderCloudUI();
      if(conflictCount&&!$('#app').hidden)showToast('동기화 충돌을 정리했습니다',`더 최근에 저장된 기록 ${conflictCount}건을 사용했습니다.`);else if(manual)showToast('동기화 완료','클라우드와 현재 계정 기록을 맞췄습니다.');
      return true;
    }catch(err){
      if(err?.code==='ACCOUNT_CHANGED')return false;
      console.error(err);cloud.lastError=syncErrorMessage(err);if(cloud.accountUid===uid){renderCloudUI();if(manual)showToast('동기화 실패',cloud.lastError);}return false;
    }finally{
      if(cloud.accountUid===uid&&cloud.activation===token){cloud.syncing=false;cloud.syncPromise=null;renderCloudStatus();}
    }
  })();
  cloud.syncPromise=task;return task;
}

function registerPWA(){if('serviceWorker'in navigator)window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js?v=7.10.0',{updateViaCache:'none'}).then(reg=>reg.update()).catch(console.error));window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferredInstallPrompt=e;$('#installMini').style.display='inline-block';});}
async function promptInstall(){if(deferredInstallPrompt){deferredInstallPrompt.prompt();await deferredInstallPrompt.userChoice;deferredInstallPrompt=null;return;}showToast('홈 화면에 추가','브라우저 메뉴의 앱 설치/홈 화면에 추가를 사용하세요.');}

init().catch(err=>{
  console.error('App init failed',err);
  window.__BT_BOOT_ERROR__=err;
  const box=$('#bootError');if(box){box.hidden=false;const span=box.querySelector('span');if(span)span.textContent=`초기화 오류: ${err.message||err}`;}
  try{renderCloudStatus('error','초기화 실패');}catch{}
});
