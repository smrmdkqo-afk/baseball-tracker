import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname,join} from 'node:path';
import vm from 'node:vm';
import {battingSummary,trainingSummary,analysisSnapshot,analysisMetricValue} from '../js/analytics.js';
import {defenseTrainingStats} from '../js/defense-training.js';

const root=join(dirname(fileURLToPath(import.meta.url)),'..');
const read=path=>readFileSync(join(root,path),'utf8');
const app=read('js/app.js'),analytics=read('js/analytics.js'),analysisScope=read('js/analysis-scope.js'),css=read('styles.css'),html=read('index.html'),sw=read('sw.js');

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

const baseData=()=>({athletes:[{id:'a',throws:'R',bats:'R'}],gameDays:[],gameEvents:[],batterFaced:[],plateAppearances:[],trainingSets:[]});
const battingData=(...results)=>{const data=baseData();data.plateAppearances=results.map((result,index)=>({id:`pa-${index}`,athleteId:'a',activityDate:'2026-08-23',completed:true,result,deletedAt:null}));return data;};

const empty=battingSummary(baseData(),{athleteId:'a'});
assert.equal(empty.PA,0);assert.equal(empty.SLG,null);assert.equal(empty.OPS,null,'타석이 전혀 없으면 OPS는 0이 아니라 미산출이어야 합니다.');

const walk=battingSummary(battingData('BB'),{athleteId:'a'});
assert.equal(walk.PA,1);assert.equal(walk.AB,0);assert.equal(walk.BB,1);assert.equal(walk.AVG,null);
assert.equal(walk.OBP,1);assert.equal(walk.SLG,0);assert.equal(walk.OPS,1,'1타석 1볼넷은 OPS 1.000이어야 합니다.');
const walkSnapshot=analysisSnapshot(battingData('BB'),{athleteId:'a',source:'game',domain:'hitting',date:'2026-08-23'});
assert.equal(analysisMetricValue(walkSnapshot,'OPS'),1,'분석 카드가 사용하는 지표 경로에도 볼넷 OPS가 반영되어야 합니다.');
const formatContext={};vm.runInNewContext(extractFunction(app,'formatMetricValue'),formatContext);
assert.equal(formatContext.formatMetricValue(analysisMetricValue(walkSnapshot,'OPS'),{format:'dec'}),'1.000','분석 화면에는 OPS 1.000으로 표시해야 합니다.');

const hbp=battingSummary(battingData('HBP'),{athleteId:'a'});
assert.equal(hbp.OBP,1);assert.equal(hbp.SLG,0);assert.equal(hbp.OPS,1,'1사구도 타수 없이 OPS 1.000이어야 합니다.');

const single=battingSummary(battingData('1B'),{athleteId:'a'});
assert.equal(single.AVG,1);assert.equal(single.OBP,1);assert.equal(single.SLG,1);assert.equal(single.OPS,2,'일반 타수의 기존 OPS 계산은 유지해야 합니다.');

const sacrificeFly=battingSummary(battingData('SF'),{athleteId:'a'});
assert.equal(sacrificeFly.AB,0);assert.equal(sacrificeFly.OBP,0);assert.equal(sacrificeFly.SLG,0);assert.equal(sacrificeFly.OPS,0);

const tossData=baseData();tossData.trainingSets=[{id:'toss',athleteId:'a',activityDate:'2026-08-23',domain:'defense',trainingType:'THROWING',quantity:20,unit:'reps',tluTotal:0,metadata:{area:'IF',throwCount:12,throwIntensity:0},deletedAt:null}];
const toss=trainingSummary(tossData,{athleteId:'a',domain:'defense'});
assert.equal(toss.defenseThrowCount,12,'가벼운 토스도 실제 송구 횟수에는 포함해야 합니다.');
assert.equal(toss.byDomain.defense.volume,20);assert.equal(toss.byDomain.defense.tlu,0,'0.00 토스는 TLU를 더하지 않아야 합니다.');

assert.match(app,/data-dt-simple="throwIntensity"><option value="0"[\s\S]*?매우 가벼운 토스 · 0\.00/,'수비 훈련 입력·수정 공용 편집기에 0.00 토스가 있어야 합니다.');
assert.match(app,/<option value="0\.75"[^>]*>근거리 · 0\.75<\/option>/,'기존 근거리 0.75를 기본 부하로 유지해야 합니다.');
const tossStats=defenseTrainingStats(tossData.trainingSets[0]);
assert.equal(tossStats.throwCount,12);assert.equal(tossStats.throwTLU,0,'0부하 토스의 통합 카드·분석 계산도 0.00 TLU여야 합니다.');
assert.match(app,/bits\.push\(`\$\{n2\(stats\.throwTLU\)\} TLU`\)/,'0부하 토스도 기록 카드 요약에 TLU를 표시해야 합니다.');

const formContext={
  resumeContext:null,
  inputBF:()=>({id:'bf-1',sequenceNo:1}),inputPA:()=>({id:'pa-1',sequenceNo:1}),
  bfEvents:()=>[],paEvents:()=>[],countBS:()=>({b:2,s:1}),
  sideButtonsPitching:()=>'<div class="matchup-context">투수 방향</div>',
  sideButtonsBatting:()=>'<div class="matchup-context">타자 방향</div>'
};
for(const name of ['countDisplay','gamePitchingForm','gameBattingForm'])vm.runInNewContext(extractFunction(app,name),formContext);

const countHtml=formContext.countDisplay({b:2,s:1});
assert.match(countHtml,/class="pitch-count-area"/);assert.match(countHtml,/ball-label">B/);assert.match(countHtml,/strike-label">S/);

for(const [label,markup,actionToken,afterToken] of [
  ['투구',formContext.gamePitchingForm(),'data-pitch="ball"','data-pitching-exit'],
  ['타격',formContext.gameBattingForm(),'data-bat-pitch="taken_ball"','data-close-parent-unknown="pa:pa-1"']
]){
  const start=markup.indexOf('<section class="pitch-entry-card"'),end=markup.indexOf('</section>',start);
  assert.ok(start>=0&&end>start,`${label} 입력에 결과 카드가 있어야 합니다.`);
  for(const token of ['pitch-count-area',actionToken,'strike-grid','terminal-grid']){const at=markup.indexOf(token);assert.ok(at>start&&at<end,`${label} ${token}은 결과 카드 안에 있어야 합니다.`);}
  assert.ok(markup.indexOf(afterToken)>end,`${label} 보조 동작은 결과 카드 밖에 있어야 합니다.`);
}

assert.match(html,/<p class="kicker">ANALYSIS DASHBOARD<\/p><h2>분석<\/h2>/);
assert.match(css,/\.history-controls\{padding:18px;background:#fff;border:1px solid var\(--line\);border-radius:var\(--radius\);box-shadow:var\(--shadow\)/,'기록 검색 조건은 분석과 같은 외곽 카드여야 합니다.');
assert.match(css,/\.pitch-entry-card\{border:1px solid #d7e5f1/);
assert.match(css,/\.pitch-count-area\{[^}]*border-bottom:1px solid #e4ebf1/);
assert.match(css,/@media\(max-width:599px\)\{\.history-controls\{padding:12px[\s\S]*?\.pitch-entry-card\{padding:12px/,'검색·입력 카드는 모바일 여백도 함께 줄여야 합니다.');
assert.match(css,/\.pitch-entry-card \.count-balls\{gap:5px;flex-wrap:nowrap\}/,'모바일에서도 B 1 2 3 4 S 1 2가 한 줄에 들어가야 합니다.');

assert.equal(read('VERSION').trim(),'7.10.0');assert.match(app,/appVersion:'7\.10\.0'/);assert.match(html,/야구일기 V7\.10\.0/);assert.match(sw,/baseball-diary-v7\.10\.0/);
assert.doesNotMatch([app,analytics,analysisScope,html,sw].join('\n'),/[?&]v=7\.6\.0/,'실행 파일에 이전 캐시 쿼리가 남으면 안 됩니다.');

console.log('V7.10.0 OPS and UI consistency smoke tests: PASS');
