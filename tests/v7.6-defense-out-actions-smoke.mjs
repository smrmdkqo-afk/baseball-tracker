import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname,join} from 'node:path';
import vm from 'node:vm';
import {
  DEFENSE_VERSION,
  DEFENSE_ACTION_TYPES,
  newDefenseAction,
  newDefenseDraft,
  normalizeDefenseMetadata,
  serializeDefenseDraft,
  defenseMissingFields,
  defenseFlowWarnings,
  defenseActionLabel,
  defenseActionStatus,
  defenseOfficialRecommendation,
  defenseThrowQuality
} from '../js/defense.js';
import {defenseSummary,analysisSnapshot,analysisMetricValue} from '../js/analytics.js';

const root=join(dirname(fileURLToPath(import.meta.url)),'..');
const read=path=>readFileSync(join(root,path),'utf8');
const app=read('js/app.js'),css=read('styles.css'),html=read('index.html'),sw=read('sw.js');

function extractFunction(source,name){
  const start=source.indexOf(`function ${name}(`);assert.notEqual(start,-1,`${name} 함수가 있어야 합니다.`);
  const bodyStart=source.indexOf('{',start);let depth=0,quote=null,escaped=false;
  for(let i=bodyStart;i<source.length;i++){
    const char=source[i];
    if(quote){if(escaped)escaped=false;else if(char==='\\')escaped=true;else if(char===quote)quote=null;continue;}
    if(char==='\''||char==='"'||char==='`'){quote=char;continue;}
    if(char==='{')depth++;else if(char==='}'&&--depth===0)return source.slice(start,i+1);
  }
  throw new Error(`${name} 함수 끝을 찾지 못했습니다.`);
}

assert.equal(DEFENSE_VERSION,5);
assert.deepEqual(DEFENSE_ACTION_TYPES,['field','receive','tag','base','throw','cover']);
assert.equal(defenseActionLabel('tag'),'주자 태그');
assert.equal(defenseActionLabel('base'),'베이스 터치');

const makeDraft=({misses=false}={})=>{
  const draft=newDefenseDraft({position:'2B',throwSide:'R'});
  const field=newDefenseAction('field',`field-${misses?'b':'a'}`);Object.assign(field,{battedBall:'GB',direction:'C',speed:'medium',fieldingType:'FRONT',result:'clean'});
  const tag=newDefenseAction('tag',`tag-${misses?'b':'a'}`);Object.assign(tag,{targetRunner:'R1',execution:misses?'missed':'clean',timing:misses?'late':'early',call:misses?'safe':'out'});
  const throwing=newDefenseAction('throw',`throw-${misses?'b':'a'}`);Object.assign(throwing,{target:'2B',accuracy:'accurate',tlu:.85});
  const receive=newDefenseAction('receive',`receive-${misses?'b':'a'}`);Object.assign(receive,{target:'2B',sourcePosition:'SS',incoming:'on_target',technique:'normal',result:'clean'});
  const base=newDefenseAction('base',`base-${misses?'b':'a'}`);Object.assign(base,{base:'2B',purpose:'force',execution:misses?'off_base':'secure',timing:misses?'late':'close',call:misses?'safe':'out'});
  draft.situation={outs:misses?2:1,runners:misses?['2B']:['1B']};draft.actions=[field,tag,throwing,receive,base];draft.flowEnded=true;draft.outsRecorded=misses?0:2;draft.runnersAfter=misses?['1B']:[];draft.official=misses?{status:'entered',po:false,a:false,e:true,dp:false}:{status:'entered',po:true,a:true,e:false,dp:true};
  return serializeDefenseDraft(draft);
};

const directOut=makeDraft();
assert.deepEqual(directOut.actions.map(action=>action.type),['field','tag','throw','receive','base']);
assert.equal(defenseMissingFields(directOut).length,0,'직접 아웃 동작이 있으면 별도 대표 아웃 방식 없이 완료할 수 있어야 합니다.');
assert.deepEqual(defenseFlowWarnings(directOut),[],'공을 확보한 뒤 태그·송구·재수신·베이스 터치가 이어지는 흐름은 정상이어야 합니다.');
assert.equal(defenseActionStatus(directOut.actions[1]).label,'태그 아웃');
assert.equal(defenseActionStatus(directOut.actions[4]).label,'베이스 아웃');
assert.match(defenseOfficialRecommendation(directOut),/PO/);
assert.match(defenseOfficialRecommendation(directOut),/DP/);

const noCall={...newDefenseDraft(),actions:[{...newDefenseAction('tag','tag-no-call'),targetRunner:'R1',execution:'clean',timing:'na',call:'no_call'}],flowEnded:true,outsRecorded:0,runnersAfter:[],official:{status:'none',po:false,a:false,e:false,dp:false}};
assert.equal(defenseMissingFields(noCall).length,0,'판정 없음은 미입력과 별도 완료 상태여야 합니다.');
assert.equal(defenseActionStatus(noCall.actions[0]).tone,'none');
const noCallSummary=defenseSummary({gameEvents:[{id:'no-call-event',athleteId:'a',domain:'defense',eventType:'fielding_play',activityDate:'2026-08-23',parentType:null,parentId:null,deletedAt:null,metadata:serializeDefenseDraft(noCall)}],batterFaced:[],plateAppearances:[],athletes:[{id:'a',throws:'R'}],gameDays:[],trainingSets:[]},{athleteId:'a'});
assert.equal(noCallSummary.tagOutPct,null,'판정 없음은 태그 아웃률 분모에 포함하면 안 됩니다.');
assert.equal(noCallSummary.tagContactPct,1,'판정 없음이어도 입력된 태그 실행은 기술 지표에 포함해야 합니다.');

const brokenFlow={...newDefenseDraft(),actions:[{...newDefenseAction('throw','throw-first'),target:'1B',accuracy:'accurate'},{...newDefenseAction('tag','tag-after-throw'),targetRunner:'R1',execution:'clean',timing:'close',call:'out'}],flowEnded:true,outsRecorded:1,runnersAfter:[],official:{status:'none'}};
assert.ok(defenseFlowWarnings(brokenFlow).some(item=>item.actionId==='tag-after-throw'),'송구 후 재수신 없이 태그하면 연결 경고를 표시해야 합니다.');
const droppedFlow={...newDefenseDraft(),actions:[{...newDefenseAction('tag','tag-dropped'),targetRunner:'R1',execution:'dropped',timing:'close',call:'safe'},{...newDefenseAction('throw','throw-after-drop'),target:'1B',accuracy:'high'}],flowEnded:true,outsRecorded:0,runnersAfter:['1B'],official:{status:'none'}};
assert.ok(defenseFlowWarnings(droppedFlow).some(item=>item.actionId==='throw-after-drop'),'태그 중 공이 빠진 뒤에는 다시 확보하기 전 송구할 수 없음을 알려야 합니다.');
const firstTag={...newDefenseDraft(),actions:[{...newDefenseAction('tag','tag-first'),targetRunner:'R1',execution:'clean',timing:'close',call:'out'}],flowEnded:true,outsRecorded:1,runnersAfter:[],official:{status:'none'}};
assert.ok(!defenseFlowWarnings(firstTag).some(item=>item.actionId),'플레이 시작 전에 이미 공을 가진 태그는 허용해야 합니다.');
const outcomeConflict={...firstTag,outsRecorded:0};
assert.ok(defenseFlowWarnings(outcomeConflict).some(item=>item.field==='outsRecorded'),'직접 아웃 수보다 전체 아웃 수가 적으면 확인 경고를 표시해야 합니다.');

const v2=normalizeDefenseMetadata({defenseVersion:2,position:'SS',actions:[{id:'field-v2',type:'field',battedBall:'GB',difficulty:'routine',reach:'easy',result:'clean'}],flowEnded:true,outcome:'out',outMethod:'base',outsRecorded:1,official:{status:'missing'}});
assert.equal(v2.legacy,false,'V7.5 순차 기록은 기존 형식으로 되돌리면 안 됩니다.');
assert.equal(v2.defenseVersion,5,'읽을 때 현재 수비 버전으로 정규화해야 합니다.');
assert.equal(v2.previousFormat,true,'이전 순차 기록은 기존 형식으로 구분해야 합니다.');
const v3Situation=normalizeDefenseMetadata({defenseVersion:3,position:'SS',situation:{outs:2,runners:['1B','3B']},actions:[],flowEnded:true,official:{status:'missing'}});
assert.deepEqual(v3Situation.situation,{outs:2,runners:['1B','3B']},'이전에 저장된 플레이 시작 상황을 그대로 복구해야 합니다.');
const v4NoSituation=normalizeDefenseMetadata({defenseVersion:4,position:'SS',actions:[],flowEnded:true,official:{status:'missing'}});
assert.deepEqual(v4NoSituation.situation,{outs:null,runners:null});assert.equal(v4NoSituation.previousFormat,false,'V7.8 기록은 시작 상황이 없어도 기존 형식으로 강등하면 안 됩니다.');
assert.equal(normalizeDefenseMetadata({position:'SS',fieldingResult:'success'}).legacy,true,'고정형 옛 기록은 기존 형식으로 유지해야 합니다.');

const misses=makeDraft({misses:true}),events=[directOut,misses].map((metadata,index)=>({id:`event-${index}`,athleteId:'a',domain:'defense',eventType:'fielding_play',activityDate:'2026-08-23',parentType:null,parentId:null,deletedAt:null,metadata}));
const data={gameEvents:events,batterFaced:[],plateAppearances:[],athletes:[{id:'a',throws:'R'}],gameDays:[],trainingSets:[]};
const summary=defenseSummary(data,{athleteId:'a'});
assert.equal(summary.tagAttempts,2);assert.equal(summary.baseTouchAttempts,2);
assert.equal(summary.tagContactPct,.5);assert.equal(summary.tagOutPct,.5);assert.equal(summary.baseTouchPct,.5);assert.equal(summary.outOnTimePct,.5);assert.equal(summary.outMissPct,.5);
assert.deepEqual(summary.tags,{clean:1,recovered:0,missed:1,dropped:0,missing:0});
assert.deepEqual(summary.baseTouches,{secure:1,off_base:1,missed:0,missing:0});
assert.deepEqual(summary.startOuts,{0:0,1:1,2:1,missing:0});assert.deepEqual(summary.runnersBefore,{none:0,'1B':1,'2B':1,'3B':0,missing:0});assert.deepEqual(summary.scoringPosition,{yes:1,no:1,missing:0});
assert.equal(summary.situationStats.outs['1'].fieldSecurePct,1);assert.equal(summary.situationStats.outs['1'].throwSuccessPct,1);assert.equal(summary.situationStats.outs['2'].errors,1);assert.equal(summary.situationStats.runners.scoring.plays,1);
const snapshot=analysisSnapshot(data,{athleteId:'a',source:'game',domain:'defense',date:'2026-08-23'});
for(const metric of ['tagContactPct','tagOutPct','baseTouchPct','outOnTimePct','outMissPct'])assert.equal(analysisMetricValue(snapshot,metric),50,`${metric} 분석 값은 50%여야 합니다.`);

const filterContext={
  ui:{historyStatus:'all',historyDefenseStatus:'all',historyDefenseAction:'all',historyFieldResult:'all',historyThrowResult:'all',historyReceiveResult:'all',historyTagResult:'all',historyBaseResult:'all',historyOfficial:'all'},
  recordsFor:()=>events.map((event,index)=>({...event,recordedAt:`2026-08-23T10:0${index}:00Z`})),normalizeDefenseMetadata,defenseMissingFields,defenseThrowQuality
};
vm.runInNewContext(extractFunction(app,'historyDefenseEvents'),filterContext);
filterContext.ui.historyTagResult='safe';assert.deepEqual(Array.from(filterContext.historyDefenseEvents('2026-08-23'),event=>event.id),['event-1']);
filterContext.ui.historyTagResult='all';filterContext.ui.historyBaseResult='out';assert.deepEqual(Array.from(filterContext.historyDefenseEvents('2026-08-23'),event=>event.id),['event-0']);

for(const [type,label] of [['field','타구 처리'],['receive','송구 받기'],['tag','주자 태그'],['base','베이스 터치'],['throw','송구'],['cover','커버·백업']])assert.match(app,new RegExp(`\\['${type}','${label}'`));
for(const token of ['주자 태그','베이스 터치','태그 실행','베이스 접촉','심판 판정','플레이 시작 상황','플레이 시작 전 아웃 카운트','플레이 시작 전 주자 상황','아웃 카운트별 개인 수행','주자 상황별 개인 수행','historyTagResult','historyBaseResult','tagContactPct','baseTouchPct','outOnTimePct'])assert.match(app,new RegExp(token));
assert.match(app,/if\(action\.type==='tag'\)return \[\['태그 대상'/,'기록 상세에 태그 동작을 표시해야 합니다.');
assert.match(app,/if\(action\.type==='base'\)return \[\['터치 베이스'/,'기록 상세에 베이스 터치 동작을 표시해야 합니다.');
assert.match(css,/\.defense-action-type-grid\{grid-template-columns:repeat\(3,minmax\(0,1fr\)\)\}/);
assert.match(css,/@media\(max-width:780px\)\{\.defense-action-type-grid\{grid-template-columns:1fr 1fr\}\}/);
assert.match(css,/\.defense-connection-warning/);assert.match(css,/\.defense-derived\.out-summary/);
assert.equal(read('VERSION').trim(),'7.9.0');assert.match(html,/야구일기 V7\.9\.0/);assert.match(sw,/baseball-diary-v7\.9\.0/);

console.log('V7.6 direct-out defense regression tests on V7.9.0: PASS');
