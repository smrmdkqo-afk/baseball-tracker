import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname,join} from 'node:path';
import {analysisMetricValue,analysisSnapshot,trainingSummary,workloadSummary} from '../js/analytics.js';
import {DEFENSE_TRAINING_ACTION_TYPES,defenseTrainingOutcomeError,defenseTrainingStats,newDefenseTrainingAction,newDefenseTrainingDraft,normalizeDefenseTrainingRecord,serializeDefenseTrainingDraft} from '../js/defense-training.js';

const root=join(dirname(fileURLToPath(import.meta.url)),'..'),read=path=>readFileSync(join(root,path),'utf8');
const app=read('js/app.js'),analytics=read('js/analytics.js'),css=read('styles.css'),html=read('index.html'),sw=read('sw.js');
const trainingUi=app.slice(app.indexOf('function defenseTrainingActionCard'),app.indexOf('function trainingBaserunningForm'));

assert.deepEqual(DEFENSE_TRAINING_ACTION_TYPES,['field','receive','tag','base','throw','cover']);

const legacy={id:'legacy',athleteId:'a',activityDate:'2026-08-23',domain:'defense',trainingType:'THROWING',quantity:20,unit:'reps',tluTotal:0,metadata:{area:'IF',throwCount:12,throwIntensity:0},deletedAt:null};
const legacyDraft=normalizeDefenseTrainingRecord(legacy),legacyStats=defenseTrainingStats(legacy);
assert.equal(legacyDraft.trainingMode,'simple');assert.equal(legacyDraft.legacy,true,'기존 수비 훈련은 강제 변환하지 않고 간단 기록으로 해석해야 합니다.');
assert.equal(legacyStats.throwCount,12);assert.equal(legacyStats.throwTLU,0);assert.equal(legacyStats.actionReps,0,'기존·간단 기록을 시나리오 동작량으로 추정하면 안 됩니다.');

const previousScenarioDraft=normalizeDefenseTrainingRecord({domain:'defense',trainingType:'SCENARIO',quantity:5,metadata:{defenseTrainingVersion:1,trainingMode:'scenario',position:'SS',actions:[{id:'old-field',type:'field',battedBall:'GB'}]}});
assert.equal(previousScenarioDraft.flowEnded,true,'종료 상태가 없던 V1 시나리오는 이미 저장된 완료 기록으로 해석해야 합니다.');
const unfinishedScenarioDraft=normalizeDefenseTrainingRecord({domain:'defense',trainingType:'SCENARIO',quantity:5,metadata:{defenseTrainingVersion:2,trainingMode:'scenario',position:'SS',flowEnded:false,actions:[{id:'new-field',type:'field',battedBall:'GB'}]}});
assert.equal(unfinishedScenarioDraft.flowEnded,false,'V2 시나리오는 명시한 종료 상태를 보존해야 합니다.');

const draft=newDefenseTrainingDraft({mode:'scenario',area:'IF',position:'SS',quantity:10});
assert.equal(draft.flowEnded,false,'새 시나리오는 플레이 종료 전 상태로 시작해야 합니다.');
draft.actions=[
  newDefenseTrainingAction('field','field-1'),newDefenseTrainingAction('receive','receive-1'),newDefenseTrainingAction('tag','tag-1'),newDefenseTrainingAction('base','base-1'),newDefenseTrainingAction('throw','throw-1'),newDefenseTrainingAction('cover','cover-1'),newDefenseTrainingAction('throw','throw-2')
];
draft.actions[0].battedBall='GB';draft.actions[0].difficulty='normal';draft.actions[1].target='2B';draft.actions[2].countOverride=3;draft.actions[3].base='2B';draft.actions[4].target='1B';draft.actions[4].countOverride=8;draft.actions[4].tlu=.85;draft.actions[5].role='backup';draft.actions[6].target='OTHER';draft.actions[6].countOverride=4;draft.actions[6].tlu=0;
draft.flowEnded=true;draft.outcomes={target:6,adjust:2,failed:1};draft.note='병살 피벗과 백업';
const metadata=serializeDefenseTrainingDraft({...draft,unexpected:'drop-me'}),scenario={id:'scenario',athleteId:'a',activityDate:'2026-08-23',domain:'defense',trainingType:'SCENARIO',quantity:10,unit:'reps',tluPerRep:.68,tluTotal:6.8,metadata,deletedAt:null};
assert.equal(metadata.defenseTrainingVersion,2);assert.equal(metadata.trainingMode,'scenario');assert.equal(metadata.flowEnded,true);assert.equal(metadata.unexpected,undefined,'허용하지 않은 필드는 저장하면 안 됩니다.');assert.equal(metadata.throwCount,12);
const stats=defenseTrainingStats(scenario);
assert.equal(stats.actionReps,55);assert.deepEqual(stats.actionRepsByType,{field:10,receive:10,tag:3,base:10,throw:12,cover:10});assert.equal(stats.throwCount,12);assert.equal(stats.throwTLU,6.8);assert.equal(stats.throwLoads['0'],4);assert.equal(stats.throwLoads['0.85'],8);assert.equal(stats.outcomes.evaluated,9);assert.equal(stats.outcomes.unassessed,1);
assert.match(stats.flow,/처리 → 수신 → 태그 → 베이스 → 송구 → 커버 → 송구/,'중복 송구를 포함한 순서를 그대로 보존해야 합니다.');
assert.equal(defenseTrainingOutcomeError({...draft,outcomes:{target:8,adjust:3,failed:1}},10),'평가 결과 합계는 전체 reps를 넘을 수 없습니다.');

const data={athletes:[{id:'a',throws:'R'}],gameDays:[],gameEvents:[],batterFaced:[],plateAppearances:[],trainingSets:[legacy,scenario]};
const summary=trainingSummary(data,{athleteId:'a',domain:'defense'});
assert.equal(summary.byDomain.defense.sets,2);assert.equal(summary.byDomain.defense.volume,30);assert.equal(summary.defenseSimpleSets,1);assert.equal(summary.defenseScenarioSets,1);assert.equal(summary.defenseActionReps,55);assert.equal(summary.defenseThrowCount,24);assert.equal(summary.byDomain.defense.tlu,6.8);assert.equal(summary.defenseTluPerRep,.23);
assert.equal(summary.byDefenseLoad['0'],16);assert.equal(summary.byDefenseLoad['0.85'],8);assert.equal(summary.byDefenseTarget['1B'],8);assert.equal(summary.byDefenseTarget.OTHER,4);assert.equal(summary.byDefenseBall.GB,10);assert.equal(summary.defenseOutcomes.evaluated,9);assert.equal(summary.defenseOutcomes.unassessed,21,'평가하지 않은 reps는 실패와 분리해야 합니다.');
const workload=workloadSummary(data,{athleteId:'a'});assert.equal(workload.defenseThrowing,6.8,'워크로드도 시나리오 동작 TLU와 같은 계산을 사용해야 합니다.');
const snapshot=analysisSnapshot(data,{athleteId:'a',source:'training',domain:'defense'});
assert.equal(analysisMetricValue(snapshot,'actionReps'),55);assert.equal(analysisMetricValue(snapshot,'throwCount'),24);assert.equal(analysisMetricValue(snapshot,'tagReps'),3);assert.equal(analysisMetricValue(snapshot,'targetPct'),6/9*100);assert.equal(analysisMetricValue(snapshot,'failurePct'),1/9*100);

for(const text of ['간단 기록','시나리오 기록','타구 처리','송구 받기','주자 태그','베이스 터치','송구','커버·백업'])assert.ok(app.includes(text),`${text} UI가 있어야 합니다.`);
for(const token of ['data-dt-mode','data-dt-action-count','data-dt-open-add','data-dt-end-play','data-dt-reopen-flow','data-dt-move','data-dt-outcome','data-toggle-record="training:','trainingRecordActionsHtml','openTrainingEdit','saveTrainingEdit'])assert.ok(app.includes(token),`${token} 연결이 있어야 합니다.`);
assert.ok(!app.includes('training-add-action'),'시나리오 마지막의 별도 다음 동작 버튼은 경기 수비와 같은 종료/계속 분기로 대체해야 합니다.');
for(const token of ['defense-flow-actions','defense-outcome training-scenario-outcome','defense-completeness complete','defense-continue-play'])assert.ok(trainingUi.includes(token),`훈련 종료 UI가 경기 수비의 ${token} 스타일을 재사용해야 합니다.`);
assert.match(trainingUi,/여기서 플레이 종료/);assert.match(trainingUi,/이어짐 · 다음 동작/);assert.match(trainingUi,/if\(!draft\.flowEnded\)return ''/);assert.match(trainingUi,/시나리오 구성이 완료되었습니다/);
assert.match(app,/trainingMode==='scenario'&&!defenseDraft\.flowEnded/,'새 수비 훈련 저장은 플레이 종료 전 차단해야 합니다.');
assert.match(app,/trainingMode==='scenario'&&!draft\.flowEnded/,'수비 훈련 수정도 플레이 종료 전 저장을 차단해야 합니다.');
assert.match(html,/id="trainingEditModal"[^>]*class="modal-backdrop sheet-backdrop"/);assert.match(html,/id="trainingEditEditor"/);assert.match(css,/\.defense-training-mode-tabs/);assert.match(css,/\.training-volume-preview/);assert.match(css,/\.training-card-outcomes/);assert.match(css,/\.training-volume-badge/);
assert.match(css,/\.training-scenario-outcome/);assert.match(css,/\.training-flow-status\.complete/);
for(const metric of ['actionReps','fieldReps','receiveReps','tagReps','baseReps','throwReps','coverReps','tluPerRep','targetPct','adjustPct','failurePct'])assert.ok(app.includes(`${metric}:`)||app.includes(`'${metric}'`),`${metric} 분석 지표가 있어야 합니다.`);
assert.match(analytics,/defenseTrainingStats/);assert.match(sw,/baseball-diary-v7\.10\.0/);assert.match(sw,/\.\/js\/defense-training\.js\?v=7\.10\.0/);assert.match(html,/js\/app\.js\?v=7\.10\.0/);assert.equal(read('VERSION').trim(),'7.10.0');

console.log('V7.7 defense training scenario tests: PASS');
