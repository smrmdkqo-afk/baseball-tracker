import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname,join} from 'node:path';
import vm from 'node:vm';
import {newDefenseAction,newDefenseDraft,normalizeDefenseMetadata,serializeDefenseDraft,defenseMissingFields,defenseFlowWarnings,defenseActionLabel,defenseActionStatus,defenseCardStatuses,defenseOverallTone,defenseThrowTLU,defenseOfficialText,defenseOfficialRecommendation} from '../js/defense.js';
import {defenseSummary,analysisSnapshot,analysisMetricValue} from '../js/analytics.js';

const root=join(dirname(fileURLToPath(import.meta.url)),'..');
const read=path=>readFileSync(join(root,path),'utf8');
const app=read('js/app.js'),css=read('styles.css'),html=read('index.html'),sw=read('sw.js');

function extractFunction(source,name){
  const start=source.indexOf(`function ${name}(`);assert.notEqual(start,-1,`${name} 함수가 있어야 합니다.`);
  const paramsStart=source.indexOf('(',start);let paramDepth=0,paramQuote=null,paramEscaped=false,bodyStart=-1;
  for(let i=paramsStart;i<source.length;i++){
    const char=source[i];
    if(paramQuote){if(paramEscaped)paramEscaped=false;else if(char==='\\')paramEscaped=true;else if(char===paramQuote)paramQuote=null;continue;}
    if(char==='\''||char==='"'||char==='`'){paramQuote=char;continue;}
    if(char==='(')paramDepth++;else if(char===')'&&--paramDepth===0){bodyStart=source.indexOf('{',i);break;}
  }
  assert.notEqual(bodyStart,-1,`${name} 함수 본문이 있어야 합니다.`);let depth=0,quote=null,escaped=false;
  for(let i=bodyStart;i<source.length;i++){
    const char=source[i];
    if(quote){if(escaped)escaped=false;else if(char==='\\')escaped=true;else if(char===quote)quote=null;continue;}
    if(char==='\''||char==='"'||char==='`'){quote=char;continue;}
    if(char==='{')depth++;else if(char==='}'&&--depth===0)return source.slice(start,i+1);
  }
  throw new Error(`${name} 함수 끝을 찾지 못했습니다.`);
}

const draft=newDefenseDraft({position:'SS',throwSide:'R'});
const field=newDefenseAction('field','field-1');Object.assign(field,{battedBall:'GB',difficulty:'normal',reach:'effort',result:'clean',fieldingType:'BACKHAND'});Object.assign(field.judgment,{rating:'best',source:'video',reaction:'good',route:'direct',note:'빠른 첫발'});
const firstThrow=newDefenseAction('throw','throw-1');Object.assign(firstThrow,{target:'1B',quality:'accurate',timing:'on_time',tlu:.85});firstThrow.judgment.rating='acceptable';
const receive=newDefenseAction('receive','receive-1');Object.assign(receive,{target:'2B',incoming:'uncatchable',result:'failed'});
const secondThrow=newDefenseAction('throw','throw-2');Object.assign(secondThrow,{target:'HOME',quality:'catchable',timing:'late',tlu:1});
draft.actions=[field,firstThrow,receive,secondThrow];draft.flowEnded=true;draft.outcome='out';draft.outMethod='throw';draft.outsRecorded=2;draft.official={status:'entered',po:true,a:true,e:false,dp:true};

const stored=serializeDefenseDraft(draft);
assert.deepEqual(stored.actions.map(x=>x.type),['field','throw','receive','throw'],'중복 동작과 선택 순서를 그대로 저장해야 합니다.');
assert.equal(stored.actions[2].result,'excluded','받을 수 없는 송구는 수신 실패가 아니라 평가 제외여야 합니다.');
assert.equal(defenseThrowTLU(stored),1.85,'여러 송구의 TLU를 모두 합산해야 합니다.');
assert.equal(defenseMissingFields(stored).length,0,'필수 항목이 채워진 복합 플레이는 완료 상태여야 합니다.');
assert.equal(defenseActionStatus(firstThrow).tone,'success');assert.equal(defenseActionStatus(secondThrow).tone,'unstable','받을 수 있지만 정확하지 않은 송구는 입력 화면과 같은 보완 색상이어야 합니다.');
assert.equal(defenseOverallTone(stored),'unstable','받을 수 있지만 정확하지 않은 송구가 포함되면 보완 톤이어야 합니다.');
assert.match(defenseOfficialRecommendation(stored),/PO/);assert.match(defenseOfficialRecommendation(stored),/A/);assert.match(defenseOfficialRecommendation(stored),/DP/);

const missingThrow=newDefenseAction('throw','missing-throw');
const incomplete={...newDefenseDraft({position:'CF'}),actions:[missingThrow],flowEnded:true,outcome:null};
const missingLabels=defenseMissingFields(incomplete).map(x=>x.label);
assert.ok(missingLabels.includes('1단계 송구 품질'));assert.ok(missingLabels.includes('플레이 결과'));
assert.equal(defenseActionStatus(missingThrow).label,'송구 미입력');
assert.equal(defenseOverallTone(incomplete),'unstable');

const notReached=newDefenseAction('field','range');Object.assign(notReached,{battedBall:'LD',difficulty:'difficult',reach:'not_reached',result:null});
const rangeDraft={...newDefenseDraft(),actions:[notReached],flowEnded:true,outcome:'safe'};
assert.ok(!defenseMissingFields(rangeDraft).some(x=>x.field==='result'),'타구 미도달은 처리 결과를 추가로 요구하면 안 됩니다.');
const excludedOnly={...newDefenseDraft({position:'1B'}),actions:[{...newDefenseAction('receive','excluded-only'),target:'1B',incoming:'uncatchable',result:'excluded'}],flowEnded:true,outcome:'safe'};
assert.equal(defenseOverallTone(excludedOnly),'none','평가 제외만 있는 플레이를 성공 색상으로 표시하면 안 됩니다.');
const correctedReceive=normalizeDefenseMetadata({defenseVersion:2,position:'1B',actions:[{id:'receive-corrected',type:'receive',target:'1B',incoming:'low',result:'excluded'}],flowEnded:true,outcome:'safe',official:{status:'missing'}});
assert.equal(correctedReceive.actions[0].result,null,'받을 수 있는 송구로 바뀐 수신은 이전 평가 제외 값을 유지하면 안 됩니다.');
assert.ok(defenseMissingFields(correctedReceive).some(x=>x.field==='result'),'받을 수 있는 송구의 수신 결과는 다시 입력 대상으로 표시해야 합니다.');
const malformed=normalizeDefenseMetadata({defenseVersion:2,position:'<script>',actions:[{id:'"><img src=x>',type:'throw',quality:'__proto__',distance:'bad'},{id:'same',type:'throw'},{id:'same',type:'receive'}],flowEnded:true,outcome:'safe',outMethod:'catch',outsRecorded:3,official:{status:'missing',e:true},situation:{outs:9,runners:['1B','1B','HOME']}});
assert.equal(malformed.position,'SS');assert.equal(new Set(malformed.actions.map(x=>x.id)).size,3,'중복 단계 ID를 고유하게 정리해야 합니다.');assert.ok(malformed.actions.every(x=>/^[A-Za-z0-9_-]+$/.test(x.id)),'단계 ID는 안전한 문자만 유지해야 합니다.');assert.equal(malformed.actions[0].quality,null);assert.equal(malformed.actions[0].distance,null);assert.equal(malformed.outMethod,null);assert.equal(malformed.outsRecorded,null);assert.deepEqual(malformed.situation.runners,['1B']);assert.equal(malformed.situation.outs,null);assert.equal(malformed.official.e,false,'공식 미입력 상태의 숨은 플래그를 집계하면 안 됩니다.');
const unknownField=normalizeDefenseMetadata({defenseVersion:2,actions:[{id:'safe',type:'throw',target:'1B',unexpected:'discard-me'}],flowEnded:true,outcome:'safe'});assert.equal('unexpected' in unknownField.actions[0],false,'허용하지 않은 동작 필드는 저장 모델에서 제거해야 합니다.');

const legacy=normalizeDefenseMetadata({position:'SS',battedBall:'GB',fieldingResult:'unstable',fieldingType:'FOREHAND',throwResult:'success',throwTarget:'1B',throwTLU:.85});
assert.equal(legacy.legacy,true);assert.deepEqual(legacy.actions.map(x=>x.type),['field','throw']);assert.equal(legacy.actions[0].result,'recovered');assert.equal(legacy.actions[1].quality,'catchable','기존 정상 송구를 과장해 정확 송구로 바꾸면 안 됩니다.');
assert.equal(defenseOverallTone(legacy),'legacy','정규화된 기존 기록도 회색 기존 형식 톤을 유지해야 합니다.');
assert.equal(defenseCardStatuses(legacy).length,2,'기존 수비 결과도 현재 카드에서 두 개 이하 대표 배지로 읽어야 합니다.');

const events=[
  {id:'new',athleteId:'a',domain:'defense',eventType:'fielding_play',activityDate:'2026-08-20',parentType:null,parentId:null,deletedAt:null,metadata:stored},
  {id:'partial',athleteId:'a',domain:'defense',eventType:'fielding_play',activityDate:'2026-08-20',parentType:null,parentId:null,deletedAt:null,metadata:serializeDefenseDraft(incomplete)},
  {id:'legacy',athleteId:'a',domain:'defense',eventType:'fielding_play',activityDate:'2026-08-20',parentType:null,parentId:null,deletedAt:null,metadata:{position:'SS',battedBall:'GB',fieldingResult:'unstable',fieldingType:'FOREHAND',throwResult:'error',throwTarget:'1B',throwTLU:.75}}
];
const data={gameEvents:events,batterFaced:[],plateAppearances:[],athletes:[{id:'a',throws:'R'}],gameDays:[],trainingSets:[]},summary=defenseSummary(data,{athleteId:'a'});
assert.equal(summary.plays,3);assert.equal(summary.throwAttempts,4,'품질 미입력 송구도 실제 송구 수와 TLU에 포함해야 합니다.');assert.equal(summary.throwQualityAttempts,3,'송구 품질 비율의 분모에서는 미입력 송구를 제외해야 합니다.');assert.equal(summary.throwTLU,3.45);assert.equal(summary.receives.excluded,1);assert.equal(summary.dataStatus.incomplete,1);assert.equal(summary.dataStatus.legacy,1);assert.equal(summary.official.po,1);assert.equal(summary.official.a,1);assert.equal(summary.official.dp,1);assert.equal(summary.judgmentAppropriatePct,1);
assert.equal(summary.totalChances,2);assert.equal(summary.fieldingPct,1);assert.equal(summary.onTimePct,.5);assert.equal(summary.receivePct,null,'받기 불가 송구는 수신 성공률 분모에서 제외해야 합니다.');
assert.equal(summary.fieldTypeThrowStats.BACKHAND.attempts,1,'타구 처리 후 송구는 실제로 바로 이어진 송구만 연결해야 합니다.');
const receiveMissingDraft={...newDefenseDraft({position:'1B'}),actions:[{...newDefenseAction('receive','receive-missing'),target:'1B',incoming:'low'}],flowEnded:true,outcome:'safe'};
const receiveMissingSummary=defenseSummary({gameEvents:[{id:'receive-missing-event',athleteId:'a',domain:'defense',eventType:'fielding_play',activityDate:'2026-08-20',parentType:null,parentId:null,deletedAt:null,metadata:receiveMissingDraft}],batterFaced:[],plateAppearances:[],athletes:[{id:'a',throws:'R'}],gameDays:[],trainingSets:[]},{athleteId:'a'});
assert.equal(receiveMissingSummary.savePct,null,'결과 미입력 수신을 빗나간 송구 보완율의 실패로 계산하면 안 됩니다.');
const snapshot=analysisSnapshot(data,{athleteId:'a',source:'game',domain:'defense',date:'2026-08-20'});
assert.equal(analysisMetricValue(snapshot,'PO'),1);assert.ok(Math.abs(analysisMetricValue(snapshot,'onTargetPct')-100/3)<1e-9);assert.equal(analysisMetricValue(snapshot,'throwTLU'),3.45);

const editorContext={
  draft:stored,
  defenseEditorState:{create:{openActionId:'field-1',chooseAfter:null,detailsOpen:new Set(),judgmentOpen:new Set()},edit:{openActionId:null,chooseAfter:null,detailsOpen:new Set(),judgmentOpen:new Set()}},
  defenseDraft:()=>editorContext.draft,
  defenseActionStatus,defenseMissingFields,defenseFlowWarnings,defenseActionLabel,defenseOfficialText,defenseOfficialRecommendation,
  athlete:()=>({name:'테스트 선수'}),esc:value=>String(value??'').replace(/[&<>\'\"]/g,''),n2:value=>String(value),
  throwTargetLabel:value=>({'1B':'1루','2B':'2루','3B':'3루',HOME:'홈',RELAY:'중계'}[value]||'')
};
for(const name of ['defensePositionOptions','defenseChoiceButtons','defenseFieldGroup','defenseActionSummary','defenseActionChooserHtml','defenseFieldDetailOptions','defenseOptionalDetailsHtml','defenseJudgmentHtml','defenseActionFieldsHtml','defenseActionCardHtml','defenseSituationHtml','defenseDirectOutLabel','defenseOutcomeHtml','defenseEditorHtml','defenseJudgmentDetailRows'])vm.runInNewContext(extractFunction(app,name),editorContext);
for(const name of ['fieldTypeLabel','defenseValueLabel','defenseJudgmentLabel','defenseActionDetailRows','defenseRecordTimelineHtml'])vm.runInNewContext(extractFunction(app,name),editorContext);
const editorHtml=editorContext.defenseEditorHtml('create');
assert.match(editorHtml,/테스트 선수/);assert.match(editorHtml,/defense-step-number">1/);assert.match(editorHtml,/타구 처리/);assert.match(editorHtml,/동료 선수 경유/);assert.match(editorHtml,/PO \+ A \+ DP/);assert.match(editorHtml,/수비 플레이 저장/);
assert.equal((editorHtml.match(/class="defense-step /g)||[]).length,4,'선택한 네 동작을 순서대로 모두 렌더링해야 합니다.');
for(const [action,token] of [[field,'타구 도달'],[firstThrow,'송구 타이밍'],[receive,'들어온 송구'],[newDefenseAction('tag','tag-test'),'태그 실행'],[newDefenseAction('base','base-test'),'베이스 접촉'],[newDefenseAction('cover','cover-test'),'수비 역할']])assert.match(editorContext.defenseActionFieldsHtml('create',action),new RegExp(token));
assert.deepEqual(Array.from(editorContext.defenseJudgmentDetailRows(stored.actions[0]),row=>Array.from(row)),[['첫 반응','빠름'],['이동 경로','효율적']]);
const timelineHtml=editorContext.defenseRecordTimelineHtml(stored);assert.match(timelineHtml,/첫 반응/);assert.match(timelineHtml,/이동 경로/);assert.match(timelineHtml,/빠른 첫발/,'판단의 세부값과 메모를 펼친 기록에서 확인할 수 있어야 합니다.');
const firstChooser=editorContext.defenseActionChooserHtml('create',-1);for(const type of ['field','receive','tag','base','throw','cover'])assert.match(firstChooser,new RegExp(`data-defense-add-type="${type}"`));

const dependencyContext={};vm.runInNewContext(extractFunction(app,'normalizeDefenseActionDependency'),dependencyContext);vm.runInNewContext(extractFunction(app,'defenseActionHasUserData'),dependencyContext);
const changedField={type:'field',reach:'not_reached',result:'clean'};dependencyContext.normalizeDefenseActionDependency(changedField,'reach','effort');assert.equal(changedField.result,null);
const changedThrow={type:'throw',quality:'accurate',missDirection:'high'};dependencyContext.normalizeDefenseActionDependency(changedThrow,'quality','catchable');assert.equal(changedThrow.missDirection,null);
const changedReceive={type:'receive',incoming:'low',result:'excluded'};dependencyContext.normalizeDefenseActionDependency(changedReceive,'incoming','uncatchable');assert.equal(changedReceive.result,null);
assert.equal(dependencyContext.defenseActionHasUserData(newDefenseAction('throw','blank')),false,'기본 TLU만 있는 새 송구를 입력 완료로 오인하면 안 됩니다.');

const filterContext={
  ui:{historyStatus:'all',historyDefenseStatus:'all',historyDefenseAction:'all',historyFieldResult:'all',historyThrowResult:'all',historyReceiveResult:'all',historyTagResult:'all',historyBaseResult:'all',historyOfficial:'all'},
  recordsFor:()=>events.map((event,index)=>({...event,recordedAt:`2026-08-20T10:0${index}:00Z`})),normalizeDefenseMetadata,defenseMissingFields
};
vm.runInNewContext(extractFunction(app,'historyDefenseEvents'),filterContext);
filterContext.ui.historyDefenseStatus='incomplete';assert.deepEqual(Array.from(filterContext.historyDefenseEvents('2026-08-20'),x=>x.id),['partial']);
filterContext.ui.historyDefenseStatus='all';filterContext.ui.historyDefenseAction='receive';assert.deepEqual(Array.from(filterContext.historyDefenseEvents('2026-08-20'),x=>x.id),['new']);
filterContext.ui.historyDefenseAction='all';filterContext.ui.historyReceiveResult='excluded';assert.deepEqual(Array.from(filterContext.historyDefenseEvents('2026-08-20'),x=>x.id),['new']);
filterContext.ui.historyReceiveResult='all';filterContext.ui.historyOfficial='a';assert.deepEqual(Array.from(filterContext.historyDefenseEvents('2026-08-20'),x=>x.id),['new']);
filterContext.ui.historyOfficial='all';filterContext.ui.historyDefenseStatus='legacy';assert.deepEqual(Array.from(filterContext.historyDefenseEvents('2026-08-20'),x=>x.id),['legacy']);

for(const token of ['data-defense-add-type','data-defense-next-action','data-defense-end-play','data-defense-action-type-input','data-defense-remove-action','data-defense-move','data-defense-judgment-key','data-defense-official'])assert.match(app,new RegExp(token),`${token} 동작이 있어야 합니다.`);
assert.match(app,/function openDefenseEdit/);assert.match(app,/function saveDefenseEdit/);assert.match(app,/if\(store==='gameEvents'&&rec\.domain==='defense'\)\{openDefenseEdit\(id\);return;\}/,'수비 수정은 공통 팝업 대신 전용 편집기로 열려야 합니다.');
assert.match(extractFunction(app,'saveEditedRecord'),/rec\.domain==='defense'[\s\S]*openDefenseEdit\(id\);return;/,'공통 수정 저장 경로로 들어와도 수비 전용 편집기로 되돌려야 합니다.');
assert.doesNotMatch(app,/id="defFieldResult"|id="defThrowResult"|id="defFieldType"/,'이전 고정형 수비 입력 컨트롤이 남으면 안 됩니다.');
assert.match(html,/id="defenseEditModal"/);assert.match(html,/id="defenseEditEditor"/);assert.match(html,/id="defenseEditForm"/);
assert.match(css,/sequential defense play editor/);assert.match(css,/\.defense-choice-grid\{display:grid;grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/);assert.match(css,/V7\.6\.0 — direct-out actions/);assert.match(css,/\.defense-action-type-grid\{grid-template-columns:repeat\(3,minmax\(0,1fr\)\)\}/);assert.match(css,/@media\(max-width:780px\)\{\.defense-action-type-grid\{grid-template-columns:1fr 1fr\}\}/);assert.match(css,/@media\(max-width:599px\)\{[\s\S]*?\.defense-context-card[\s\S]*?\.defense-choice-grid[\s\S]*?grid-template-columns:1fr 1fr/);assert.match(css,/@media\(pointer:coarse\)\{\.defense-choice[\s\S]*?min-height:48px/);assert.match(css,/\.defense-edit-actions\{position:sticky/);

assert.equal(read('VERSION').trim(),'7.7.0');assert.match(app,/appVersion:'7\.7\.0'/);assert.match(sw,/baseball-diary-v7\.7\.0/);assert.match(sw,/\.\/js\/defense\.js\?v=7\.7\.0/);assert.match(html,/js\/app\.js\?v=7\.7\.0/);assert.doesNotMatch([app,html,sw].join('\n'),/[?&]v=7\.4\.2/,'실행 파일에 이전 V7.4.2 캐시 쿼리가 남으면 안 됩니다.');
console.log('V7.5 defense regression smoke tests on V7.7.0: PASS');
