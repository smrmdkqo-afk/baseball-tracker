import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname,join} from 'node:path';
import {normalizeGameSituation,gamePitchingSummary,battingSummary,baserunningSummary} from '../js/analytics.js';

const root=join(dirname(fileURLToPath(import.meta.url)),'..');
const read=path=>readFileSync(join(root,path),'utf8');
const app=read('js/app.js'),css=read('styles.css'),html=read('index.html'),sw=read('sw.js');
const date='2026-08-25',athleteId='a';
const event=(id,domain,parentType,parentId,eventType,metadata,minute)=>({id,athleteId,domain,parentType,parentId,eventType,activityDate:date,recordedAt:`2026-08-25T10:${String(minute).padStart(2,'0')}:00Z`,metadata,deletedAt:null});
const data={
  athletes:[{id:athleteId,throws:'R',bats:'R'}],gameDays:[],trainingSets:[],
  batterFaced:[{id:'bf',athleteId,activityDate:date,completed:true,result:'K',pitcherSide:'R',batterSide:'R',deletedAt:null}],
  plateAppearances:[{id:'pa',athleteId,activityDate:date,completed:true,result:'BB',batterSide:'R',pitcherSide:'R',deletedAt:null}],
  gameEvents:[]
};

data.gameEvents.push(
  event('p1','pitching','batter_faced','bf','ball',{pitcherSide:'R',batterSide:'R',situation:{outs:0,runners:['1B']}},1),
  event('p2','pitching','batter_faced','bf','called',{pitcherSide:'R',batterSide:'R',situation:{outs:1,runners:[]}},2),
  event('p3','pitching','batter_faced','bf','called',{pitcherSide:'R',batterSide:'R',situation:{outs:1,runners:[]}},3),
  event('p4','pitching','batter_faced','bf','swinging',{pitcherSide:'R',batterSide:'R',situation:{outs:1,runners:[]}},4),
  ...[1,2,3,4].map((n,index)=>event(`h${n}`,'hitting','plate_appearance','pa','taken_ball',{batterSide:'R',pitcherSide:'R',situation:index<2?{outs:0,runners:['1B']}:{outs:1,runners:['2B']}},10+index)),
  event('r1','baserunning',null,null,'steal_attempt',{from:'1B',to:'2B',result:'SUCCESS',situation:{outs:0,runners:['1B']}},20),
  event('r2','baserunning',null,null,'steal_attempt',{from:'2B',to:'3B',result:'FAILED',situation:{outs:2,runners:['2B']}},21)
);

assert.deepEqual(normalizeGameSituation({outs:0,runners:[]}),{outs:0,runners:[]},'0아웃과 주자 없음은 미입력과 구분해야 합니다.');
assert.deepEqual(normalizeGameSituation({outs:null,runners:null}),{outs:null,runners:null});
assert.deepEqual(normalizeGameSituation({outs:2,runners:['3B','1B','BAD']}),{outs:2,runners:['1B','3B']});

const pitching=gamePitchingSummary(data,{athleteId,date});
assert.equal(pitching.situationStats.outs['0'].pitches,1);
assert.equal(pitching.situationStats.outs['1'].pitches,3);
assert.equal(pitching.situationStats.outs['1'].strikePct,1);
assert.equal(pitching.situationStats.outs['1'].bf,1);
assert.equal(pitching.situationStats.outs['1'].kPct,1,'타자 결과는 마지막 공의 상황에 귀속해야 합니다.');
assert.equal(pitching.situationStats.runners.first.pitches,1);
assert.equal(pitching.situationStats.runners.none.pitches,3);

const hitting=battingSummary(data,{athleteId,date});
assert.equal(hitting.situationStats.outs['0'].pitches,2);
assert.equal(hitting.situationStats.outs['1'].pitches,2);
assert.equal(hitting.situationStats.runners.scoring.pa,1);
assert.equal(hitting.situationStats.runners.scoring.obp,1);
assert.equal(hitting.situationStats.runners.scoring.ops,1,'볼넷 OPS는 상황별 타격 분석에도 1.000으로 반영해야 합니다.');

const running=baserunningSummary(data,{athleteId,date});
assert.equal(running.situationStats.outs['0'].successPct,1);
assert.equal(running.situationStats.outs['2'].successPct,0);
assert.equal(running.situationStats.runners.first.attempts,1);
assert.equal(running.situationStats.runners.scoring.failed,1);

for(const token of ['현재 경기 상황','다음 공에 적용','다음 기록에 적용',"'data-situation-runner-state','missing'","'data-situation-runner-state','none'",'data-situation-runner-base','아웃 카운트별 투구','주자 상황별 타격','아웃 카운트별 주루'])assert.match(app,new RegExp(token));
assert.doesNotMatch(app,/상황 변경|변경 사유/,'별도 상황 변경 버튼이나 분석 불필요 사유를 입력받으면 안 됩니다.');
assert.match(app,/metadata:\{tlu:1,pitcherSide:matchup\.pitcherSide,batterSide:matchup\.batterSide,situation\}/,'투구 이벤트에 당시 상황을 저장해야 합니다.');
assert.match(app,/metadata:\{from,to,result,situation:cloneGameSituation\(currentGameSituation\(\)\)\}/,'주루 이벤트에 당시 상황을 저장해야 합니다.');
assert.match(app,/gameSituationFieldsHtml\(situation,\{scope:`defense-\$\{mode\}`/,'수비도 공통 상황 선택 UI를 사용해야 합니다.');
assert.match(css,/\.situation-runner-bases\{grid-template-columns:repeat\(3,minmax\(0,1fr\)\)\}/,'1루·2루·3루는 한 줄 3열이어야 합니다.');
assert.match(css,/@media\(max-width:599px\)[\s\S]*?\.situation-runner-bases\{grid-template-columns:repeat\(3,minmax\(0,1fr\)\)\}/,'모바일에서도 베이스 3개를 한 줄로 유지해야 합니다.');
assert.match(html,/id="pitchEditSituation"/,'한 공 수정에서도 경기 상황을 바꿀 수 있어야 합니다.');
const reloadSource=app.slice(app.indexOf('async function reloadData()'),app.indexOf('function markLocal'));
assert.doesNotMatch(reloadSource,/gameSituationDrafts\.clear/,'동기화 재조회가 아직 저장하지 않은 다음 기록 상황을 지우면 안 됩니다.');
assert.match(app,/function resetAccountMemory\(\)[\s\S]*?gameSituationDrafts\.clear\(\)/,'계정 전환 때는 이전 계정의 상황 초안을 제거해야 합니다.');
assert.equal(read('VERSION').trim(),'7.9.1');assert.match(app,/appVersion:'7\.9\.1'/);assert.match(sw,/baseball-diary-v7\.9\.1/);

console.log('V7.9 shared game situation tests: PASS');
