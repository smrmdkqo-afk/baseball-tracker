import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname,join} from 'node:path';
import vm from 'node:vm';

const root=join(dirname(fileURLToPath(import.meta.url)),'..');
const read=path=>readFileSync(join(root,path),'utf8');
const app=read('js/app.js'),analysisScope=read('js/analysis-scope.js'),css=read('styles.css'),html=read('index.html'),sw=read('sw.js');

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

const parentContext={
  resumeContext:null,
  todayKey:()=> '2026-08-20',
  currentBF:()=>parentContext.liveBF,
  currentPA:()=>parentContext.livePA,
  isUnknownParent:p=>p?.result==='UNKNOWN',
  isRelievedParent:p=>p?.result==='RELIEVED'
};
vm.runInNewContext(extractFunction(app,'parentIsCurrent'),parentContext);
const past={id:'past',activityDate:'2026-08-19',completed:false,result:null};
parentContext.liveBF=past;
assert.equal(parentContext.parentIsCurrent('bf',past),false,'과거 미완료 BF는 현재 타자가 아니어야 합니다.');
const today={id:'today',activityDate:'2026-08-20',completed:false,result:null};
parentContext.liveBF=today;
assert.equal(parentContext.parentIsCurrent('bf',today),true,'오늘의 마지막 미완료 BF는 현재 타자여야 합니다.');
const todayPA={id:'today-pa',activityDate:'2026-08-20',completed:false,result:null};parentContext.livePA=todayPA;
assert.equal(parentContext.parentIsCurrent('pa',todayPA),true,'오늘의 마지막 미완료 PA는 현재 타석이어야 합니다.');
parentContext.resumeContext={kind:'bf',id:'today'};
assert.equal(parentContext.parentIsCurrent('bf',today),false,'명시적으로 재개한 BF는 현재가 아니라 수정 중이어야 합니다.');
parentContext.resumeContext=null;parentContext.liveBF={id:'newer'};
assert.equal(parentContext.parentIsCurrent('bf',today),false,'오늘 기록이어도 마지막 미완료 BF가 아니면 현재 타자가 아니어야 합니다.');
assert.equal(parentContext.parentIsCurrent('bf',{...today,result:'UNKNOWN'}),false,'결과 미상 BF는 현재 타자가 아니어야 합니다.');
assert.equal(parentContext.parentIsCurrent('bf',{...today,result:'RELIEVED'}),false,'강판 중단 BF는 현재 타자가 아니어야 합니다.');

const inputContext={
  ui:{inputDate:'2026-08-19'},todayKey:()=> '2026-08-20',resumed:null,current:{id:'latest'},
  resumedParent:()=>inputContext.resumed,currentBF:()=>inputContext.current,currentPA:()=>inputContext.current
};
vm.runInNewContext(`${extractFunction(app,'inputBF')}\n${extractFunction(app,'inputPA')}`,inputContext);
assert.equal(inputContext.inputBF(),null,'과거 미완료 BF는 명시적 재개 없이 자동 연결하지 않아야 합니다.');
assert.equal(inputContext.inputPA(),null,'과거 미완료 PA는 명시적 재개 없이 자동 연결하지 않아야 합니다.');
inputContext.resumed={id:'past'};assert.equal(inputContext.inputBF().id,'past','계속 입력으로 재개한 과거 BF는 입력 대상으로 사용해야 합니다.');
assert.equal(inputContext.inputPA().id,'past','계속 입력으로 재개한 과거 PA는 입력 대상으로 사용해야 합니다.');

const rolloverContext={
  calendarDate:'2026-08-19',ui:{inputDate:'2026-08-19',historyAnchor:'2026-08-19',analysisAnchor:'2026-08-19'},resumeContext:null,
  todayKey:()=> '2026-08-20',renders:0,renderAll:()=>{rolloverContext.renders++;}
};
vm.runInNewContext(extractFunction(app,'handleDayRollover'),rolloverContext);
rolloverContext.handleDayRollover();
assert.equal(rolloverContext.ui.inputDate,'2026-08-20','오늘을 따라가던 입력 날짜는 자정 후 새 날짜로 이동해야 합니다.');
assert.equal(rolloverContext.ui.historyAnchor,'2026-08-20','오늘을 따라가던 기록 기준일은 자정 후 새 날짜로 이동해야 합니다.');
assert.equal(rolloverContext.ui.analysisAnchor,'2026-08-20','오늘을 따라가던 분석 기준일은 자정 후 새 날짜로 이동해야 합니다.');
assert.equal(rolloverContext.renders,1,'날짜 변경 시 화면을 한 번 다시 그려야 합니다.');
rolloverContext.calendarDate='2026-08-19';rolloverContext.ui.inputDate='2026-08-19';rolloverContext.ui.historyAnchor='2026-08-17';rolloverContext.ui.analysisAnchor='2026-08-18';rolloverContext.resumeContext={kind:'bf',id:'past'};
rolloverContext.handleDayRollover();
assert.equal(rolloverContext.ui.inputDate,'2026-08-19','과거 기록을 수정 중이면 자정 후에도 입력 날짜를 유지해야 합니다.');
assert.equal(rolloverContext.ui.historyAnchor,'2026-08-17','사용자가 고른 과거 기록 기준일은 바꾸지 않아야 합니다.');
assert.equal(rolloverContext.ui.analysisAnchor,'2026-08-18','사용자가 고른 과거 분석 기준일은 바꾸지 않아야 합니다.');

const responsiveContext={window:{innerWidth:390,innerHeight:844,matchMedia:query=>({matches:query.includes('max-width: 900px')})}};
vm.runInNewContext(extractFunction(app,'defaultInputSummaryCollapsed'),responsiveContext);
assert.equal(responsiveContext.defaultInputSummaryCollapsed(),true,'모바일 세로에서는 핵심 지표만 기본 표시해야 합니다.');
responsiveContext.window.matchMedia=query=>({matches:query.includes('orientation: landscape')});
assert.equal(responsiveContext.defaultInputSummaryCollapsed(),false,'720px 이상 낮은 가로 화면에서는 전체 지표를 기본 표시해야 합니다.');

const stateContext={resumeContext:null,todayKey:()=> '2026-08-20',currentBF:()=>null,currentPA:()=>null,isUnknownParent:p=>p?.result==='UNKNOWN',isRelievedParent:p=>p?.result==='RELIEVED',parentResultLabel:p=>p.result||'미완료',resultTone:()=> 'strike'};
vm.runInNewContext(`${extractFunction(app,'parentIsCurrent')}\n${extractFunction(app,'parentVisualState')}`,stateContext);
assert.equal(stateContext.parentVisualState('bf',{id:'past',activityDate:'2026-08-19',completed:false,result:null}).key,'incomplete','과거 미완료 기록은 검색 가능한 미완료 상태여야 합니다.');
assert.equal(stateContext.parentVisualState('bf',{id:'done',activityDate:'2026-08-19',completed:true,result:'K'}).label,'K','완료 카드의 왼쪽에는 순번이 아니라 결과를 표시해야 합니다.');
assert.match(app,/\(incomplete\|\|unknown\)&&!editing/,'미완료 기록에 계속 입력 버튼을 제공해야 합니다.');
assert.match(app,/data-toggle-input-summary/,'지표 접기 버튼을 제공해야 합니다.');
assert.match(app,/baseball-diary:input-summary-mode/,'지표 표시 선택을 브라우저에 저장해야 합니다.');
assert.match(app,/class="result-badge \$\{state\.statusClass\}"/,'투구·타격 카드에는 결과 배지가 있어야 합니다.');
assert.doesNotMatch(app,/class="seq-badge"/,'투구·타격 카드에 #/PA 순번 배지를 렌더링하면 안 됩니다.');
assert.match(app,/function defenseCardHtml/,'포구·송구 2단 결과 수비 카드가 있어야 합니다.');
assert.match(app,/defense-result-stack/,'수비 결과는 포구와 송구를 독립된 두 줄로 표시해야 합니다.');
assert.doesNotMatch(extractFunction(app,'defenseCardHtml'),/fmtTime/,'수비 카드에 입력 시각을 표시하면 안 됩니다.');
assert.doesNotMatch(extractFunction(app,'baserunningRowHtml'),/fmtTime/,'도루 카드에 입력 시각을 표시하면 안 됩니다.');
assert.match(extractFunction(app,'baserunningRowHtml'),/data-edit-store/,'도루 카드는 수정 버튼을 바로 제공해야 합니다.');
const cardContext={expandedDefense:new Set(),esc:value=>String(value??''),n2:value=>String(value)};
for(const name of ['fieldTypeLabel','throwTargetLabel','fieldResultTone','throwResultTone','fieldResultLabel','throwResultLabel','defenseCardHtml','baserunningRowHtml'])vm.runInNewContext(extractFunction(app,name),cardContext);
const defenseHtml=cardContext.defenseCardHtml({id:'d1',metadata:{position:'SS',fieldingType:'BACKHAND',fieldingResult:'success',throwResult:'error',throwTarget:'1B',throwTLU:.85}});
assert.match(defenseHtml,/포구 성공/);assert.match(defenseHtml,/악송구/);assert.match(defenseHtml,/SS · 백핸드 \/ 1루 송구/);assert.match(defenseHtml,/data-toggle-defense="d1"/);
const runHtml=cardContext.baserunningRowHtml({id:'r1',metadata:{from:'1B',to:'2B',result:'SUCCESS'}});assert.match(runHtml,/성공/);assert.match(runHtml,/도루 · 1루 → 2루/);assert.match(runHtml,/수정/);assert.match(runHtml,/삭제/);

const historyFilterContext={
  ui:{historyStatus:'incomplete',historyOwnSide:'R',historyOppSide:'L'},
  parentsFor:()=>[
    {id:'mixed',activityDate:'2026-08-15',completed:false,result:null,pitcherSide:'R',batterSide:'L'},
    {id:'left-only',activityDate:'2026-08-15',completed:false,result:null,pitcherSide:'L',batterSide:'L'},
    {id:'done',activityDate:'2026-08-15',completed:true,result:'K',pitcherSide:'R',batterSide:'L'}
  ],
  parentEvents:(kind,id)=>id==='mixed'?[{id:'match',metadata:{pitcherSide:'R',batterSide:'L'}},{id:'dim',metadata:{pitcherSide:'R',batterSide:'R'}}]:[],
  parentVisualState:(kind,parent)=>({key:parent.completed?'complete':'incomplete'}),
  eventMatchup:(kind,event,parent)=>({pitcherSide:event?.metadata?.pitcherSide||parent?.pitcherSide||null,batterSide:event?.metadata?.batterSide||parent?.batterSide||null})
};
for(const name of ['historyParentMatchesStatus','historyEventMatchesSides','historyParentEntries'])vm.runInNewContext(extractFunction(app,name),historyFilterContext);
const filteredParents=historyFilterContext.historyParentEntries('bf','2026-08-15');
assert.equal(filteredParents.length,1,'기록 검색은 상태와 공별 투타 방향이 모두 맞는 부모 기록만 남겨야 합니다.');
assert.equal(filteredParents[0].parent.id,'mixed');
assert.deepEqual(Array.from(filteredParents[0].matchingEventIds),['match'],'같은 BF 안에서도 상세 조건과 일치하는 공만 따로 표시해야 합니다.');

const analysisDateContext={
  ui:{analysisSource:'game',analysisDomain:'pitching'},
  recordsFor:store=>store==='batterFaced'?[{activityDate:'2026-08-10'}]:store==='plateAppearances'?[{activityDate:'2026-08-11'}]:store==='gameEvents'?[{activityDate:'2026-08-12',domain:'defense'}]:[],
  analysisDateSnapshot:date=>({date}),analysisSnapshotHasData:s=>s.date!=='2026-08-09'
};
vm.runInNewContext(extractFunction(app,'analysisNavigationDates'),analysisDateContext);
assert.deepEqual(Array.from(analysisDateContext.analysisNavigationDates()),['2026-08-10'],'투구 날짜 이동은 투구 기록일만 사용해야 합니다.');
assert.doesNotMatch(extractFunction(app,'analysisNavigationDates'),/gameDays/,'빈 gameDays를 분석 날짜 후보로 사용하면 안 됩니다.');
const historyDateContext={recordsFor:store=>store==='gameEvents'?[{activityDate:'2026-08-01'},{activityDate:'2026-08-02'}]:store==='trainingSets'?[{activityDate:'2026-08-03'}]:[],historyDateRecordCount:date=>date!=='2026-08-02'};
vm.runInNewContext(extractFunction(app,'historyNavigationDates'),historyDateContext);assert.deepEqual(Array.from(historyDateContext.historyNavigationDates()),['2026-08-01','2026-08-03'],'기록 날짜 이동은 현재 조건에 맞는 날짜만 사용해야 합니다.');

assert.ok(html.indexOf('id="inputSummary"')<html.indexOf('id="inputForm"'),'DOM 순서는 지표가 입력보다 앞이어야 합니다.');
assert.doesNotMatch(css,/\.input-workspace>\.entry-panel\{order:1\}/,'단일 열에서 입력을 강제로 위로 올리면 안 됩니다.');
assert.doesNotMatch(css,/\.input-workspace>\.performance-panel\{order:2\}/,'단일 열에서 지표를 강제로 아래로 내리면 안 됩니다.');
assert.match(css,/@media\(max-width:900px\)\{[\s\S]*?\.input-workspace\{grid-template-columns:1fr\}/,'900px 이하에서는 입력 작업 공간이 한 열이어야 합니다.');
assert.match(css,/@media\(orientation:landscape\) and \(max-height:520px\) and \(max-width:950px\)\{[\s\S]*?\.input-workspace\{grid-template-columns:minmax\(235px,280px\) minmax\(0,1fr\)/,'720px 이상 낮은 가로 화면은 지표/입력 2열을 유지해야 합니다.');
assert.match(css,/\.performance-compact\{display:grid/,'접힌 핵심 지표 그리드가 있어야 합니다.');
assert.match(css,/\.input-summary-toggle\{[^}]*min-height:44px/,'지표 토글은 충분한 터치 높이를 가져야 합니다.');
assert.match(css,/\.parent-toggle\{grid-template-columns:80px minmax\(0,1fr\) auto\}/,'모든 화면에서 결과-내용-화살표 순서여야 합니다.');
assert.match(css,/\.defense-card-toggle\{[^}]*grid-template-columns:94px minmax\(0,1fr\) auto/,'수비 카드는 2단 결과와 상세 펼치기를 제공해야 합니다.');
assert.match(css,/\.result-event-row\{[^}]*grid-template-columns:80px minmax\(0,1fr\) auto/,'도루 카드는 결과와 수정·삭제를 한 카드에 배치해야 합니다.');

for(const id of ['historyAnchorDate','historyPrevDate','historyNextDate','historyPeriodTabs','historyConditions','historyConditionFields'])assert.match(html,new RegExp(`id="${id}"`),`기록 검색에 ${id}가 있어야 합니다.`);
assert.doesNotMatch(html,/id="historyDate"/,'기존 단일 날짜 드롭다운은 제거해야 합니다.');
assert.match(app,/historyStatus:'all'/,'기록 상태 상세 조건이 있어야 합니다.');
assert.match(app,/historyOwnSide:'all'/,'본인 우·좌 상세 조건이 있어야 합니다.');
assert.match(app,/historyOppSide:'all'/,'상대 우·좌 상세 조건이 있어야 합니다.');
assert.match(app,/조건 일치 \$\{matchingEventIds\.size\}\/\$\{events\.length\}구/,'공별 좌우 검색 일치 개수를 표시해야 합니다.');

assert.equal(read('VERSION').trim(),'7.4.0');
assert.match(app,/appVersion:'7\.4\.0'/);
assert.match(sw,/baseball-diary-v7\.4\.0/);
assert.match(html,/js\/app\.js\?v=7\.4\.0/);
assert.doesNotMatch([app,analysisScope,html,sw].join('\n'),/[?&]v=7\.3\.0/,'실행 파일에 V7.3 캐시 쿼리가 남으면 안 됩니다.');

console.log('V7.4 smoke tests: PASS');
