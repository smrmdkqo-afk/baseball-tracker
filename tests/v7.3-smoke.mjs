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
  calendarDate:'2026-08-19',ui:{inputDate:'2026-08-19',analysisAnchor:'2026-08-19'},resumeContext:null,
  todayKey:()=> '2026-08-20',renders:0,renderAll:()=>{rolloverContext.renders++;}
};
vm.runInNewContext(extractFunction(app,'handleDayRollover'),rolloverContext);
rolloverContext.handleDayRollover();
assert.equal(rolloverContext.ui.inputDate,'2026-08-20','오늘을 따라가던 입력 날짜는 자정 후 새 날짜로 이동해야 합니다.');
assert.equal(rolloverContext.ui.analysisAnchor,'2026-08-20','오늘을 따라가던 분석 기준일은 자정 후 새 날짜로 이동해야 합니다.');
assert.equal(rolloverContext.renders,1,'날짜 변경 시 화면을 한 번 다시 그려야 합니다.');
rolloverContext.calendarDate='2026-08-19';rolloverContext.ui.inputDate='2026-08-19';rolloverContext.ui.analysisAnchor='2026-08-18';rolloverContext.resumeContext={kind:'bf',id:'past'};
rolloverContext.handleDayRollover();
assert.equal(rolloverContext.ui.inputDate,'2026-08-19','과거 기록을 수정 중이면 자정 후에도 입력 날짜를 유지해야 합니다.');
assert.equal(rolloverContext.ui.analysisAnchor,'2026-08-18','사용자가 고른 과거 분석 기준일은 바꾸지 않아야 합니다.');

const responsiveContext={window:{innerWidth:390,innerHeight:844,matchMedia:query=>({matches:query.includes('max-width: 900px')})}};
vm.runInNewContext(extractFunction(app,'defaultInputSummaryCollapsed'),responsiveContext);
assert.equal(responsiveContext.defaultInputSummaryCollapsed(),true,'모바일 세로에서는 핵심 지표만 기본 표시해야 합니다.');
responsiveContext.window.matchMedia=query=>({matches:query.includes('orientation: landscape')});
assert.equal(responsiveContext.defaultInputSummaryCollapsed(),false,'720px 이상 낮은 가로 화면에서는 전체 지표를 기본 표시해야 합니다.');

assert.match(app,/status=editing\?'수정 중':current\?/,'수정 중과 현재 상태를 분리해야 합니다.');
assert.match(app,/incomplete\?'미완료 기록'/,'미완료 기록 상태가 있어야 합니다.');
assert.match(app,/\(incomplete\|\|unknown\)&&!editing/,'미완료 기록에 계속 입력 버튼을 제공해야 합니다.');
assert.match(app,/data-toggle-input-summary/,'지표 접기 버튼을 제공해야 합니다.');
assert.match(app,/baseball-diary:input-summary-mode/,'지표 표시 선택을 브라우저에 저장해야 합니다.');

assert.ok(html.indexOf('id="inputSummary"')<html.indexOf('id="inputForm"'),'DOM 순서는 지표가 입력보다 앞이어야 합니다.');
assert.doesNotMatch(css,/\.input-workspace>\.entry-panel\{order:1\}/,'단일 열에서 입력을 강제로 위로 올리면 안 됩니다.');
assert.doesNotMatch(css,/\.input-workspace>\.performance-panel\{order:2\}/,'단일 열에서 지표를 강제로 아래로 내리면 안 됩니다.');
assert.match(css,/@media\(max-width:900px\)\{[\s\S]*?\.input-workspace\{grid-template-columns:1fr\}/,'900px 이하에서는 입력 작업 공간이 한 열이어야 합니다.');
assert.match(css,/@media\(orientation:landscape\) and \(max-height:520px\) and \(max-width:950px\)\{[\s\S]*?\.input-workspace\{grid-template-columns:minmax\(235px,280px\) minmax\(0,1fr\)/,'720px 이상 낮은 가로 화면은 지표/입력 2열을 유지해야 합니다.');
assert.match(css,/\.performance-compact\{display:grid/,'접힌 핵심 지표 그리드가 있어야 합니다.');
assert.match(css,/\.input-summary-toggle\{[^}]*min-height:44px/,'지표 토글은 충분한 터치 높이를 가져야 합니다.');

assert.equal(read('VERSION').trim(),'7.3.0');
assert.match(app,/appVersion:'7\.3\.0'/);
assert.match(sw,/baseball-diary-v7\.3\.0/);
assert.match(html,/js\/app\.js\?v=7\.3\.0/);
assert.doesNotMatch([app,analysisScope,html,sw].join('\n'),/[?&]v=7\.2\.0/,'실행 파일에 V7.2 캐시 쿼리가 남으면 안 됩니다.');

console.log('V7.3 smoke tests: PASS');
