import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname,join} from 'node:path';
import vm from 'node:vm';

const root=join(dirname(fileURLToPath(import.meta.url)),'..');
const read=path=>readFileSync(join(root,path),'utf8');
const app=read('js/app.js'),css=read('styles.css'),html=read('index.html'),sw=read('sw.js');

function extractFunction(source,name){
  const start=source.indexOf(`function ${name}(`);assert.notEqual(start,-1,`${name} 함수를 찾을 수 없습니다.`);
  const bodyStart=source.indexOf('{',start);let depth=0,quote=null,escaped=false;
  for(let index=bodyStart;index<source.length;index++){
    const char=source[index];
    if(quote){if(escaped)escaped=false;else if(char==='\\')escaped=true;else if(char===quote)quote=null;continue;}
    if(char==='"'||char==="'"||char==='`'){quote=char;continue;}
    if(char==='{')depth++;else if(char==='}'&&--depth===0)return source.slice(start,index+1);
  }
  throw new Error(`${name} 함수 경계를 찾을 수 없습니다.`);
}

const context={};
vm.runInNewContext(`
  const PITCHING_OUT_RESULTS=new Set(['K','OUT','SH','SF']);
  function normalizeGameSituation(raw={}){
    const rawOuts=raw?.outs,outs=rawOuts===null||rawOuts===undefined||rawOuts===''?null:Number(rawOuts);
    const runners=Array.isArray(raw?.runners)?['1B','2B','3B'].filter(base=>raw.runners.includes(base)):null;
    return {outs:[0,1,2].includes(outs)?outs:null,runners};
  }
  function cloneGameSituation(raw){const situation=normalizeGameSituation(raw);return {outs:situation.outs,runners:situation.runners===null?null:[...situation.runners]};}
  ${extractFunction(app,'pitchingOutTransition')}
  this.transition=pitchingOutTransition;
`,context);
const transition=(result,situation)=>JSON.parse(JSON.stringify(context.transition(result,situation)));

assert.deepEqual(transition('K',{outs:0,runners:['1B']}),{previous:{outs:0,runners:['1B']},next:{outs:1,runners:['1B']},inningEnded:false});
assert.deepEqual(transition('OUT',{outs:1,runners:['1B','3B']}),{previous:{outs:1,runners:['1B','3B']},next:{outs:2,runners:['1B','3B']},inningEnded:false});
assert.deepEqual(transition('SH',{outs:1,runners:[]}),{previous:{outs:1,runners:[]},next:{outs:2,runners:[]},inningEnded:false});
assert.deepEqual(transition('SF',{outs:2,runners:['3B']}),{previous:{outs:2,runners:['3B']},next:{outs:0,runners:[]},inningEnded:true},'세 번째 아웃 뒤에는 다음 이닝 0아웃·주자 없음이어야 합니다.');
assert.equal(transition('1B',{outs:1,runners:[]}),null,'안타는 아웃 카운트를 바꾸면 안 됩니다.');
assert.equal(transition('BB',{outs:1,runners:[]}),null,'볼넷은 아웃 카운트를 바꾸면 안 됩니다.');
assert.equal(transition('K',{outs:null,runners:[]}),null,'아웃 카운트 미입력은 추측해서 변경하면 안 됩니다.');

const completeSource=extractFunction(app,'notifyPitchingCompletion');
const undoSource=extractFunction(app,'undoPitchingSituationAdvance');
assert.match(completeSource,/terminal\?\.metadata\?\.situation/,'마지막 공의 저장된 시작 상황을 기준으로 계산해야 합니다.');
assert.match(completeSource,/sameGameSituation\(currentGameSituation\(date\),transition\.previous\)/,'사용자가 이미 상황을 바꿨다면 자동 변경으로 덮어쓰면 안 됩니다.');
assert.match(completeSource,/rememberGameSituation\(transition\.next,date\)/,'자동 결과는 다음 투구 초안에만 반영해야 합니다.');
assert.match(completeSource,/아웃 카운트 미입력이라 자동 변경 없음/);
assert.match(completeSource,/3아웃 · 이닝 종료/);
assert.match(completeSource,/label:'되돌리기'/);
assert.match(undoSource,/latest\?\.id!==advance\.eventId/,'다음 기록이 생긴 뒤에는 이전 자동 변경을 되돌리면 안 됩니다.');
assert.match(undoSource,/sameGameSituation\(current,advance\.next\)/,'직접 수정한 상황을 되돌리기로 덮어쓰면 안 됩니다.');
assert.match(app,/async function maybeCompleteBF[\s\S]*?notifyPitchingCompletion\(bf,result,ev\)/);
assert.match(app,/async function recordPitch\(type\)[\s\S]*?dismissToastAction\(\);const bf=/,'다음 투구를 실제 저장할 때 이전 되돌리기를 닫아야 합니다.');
assert.match(app,/function handleGameSituationChoice[\s\S]*?scope==='shared'\)\{dismissToastAction\(\)/,'상황을 직접 바꾸면 이전 자동 변경 액션을 종료해야 합니다.');
assert.match(app,/function matchupGameSituationHtml[\s\S]*?타자 아웃은 다음 아웃 카운트에 자동 반영됩니다\. 병살·주루사는 직접 조정하세요\./);
assert.match(app,/data-toast-action/);
assert.match(css,/\.toast\.actionable\{[^}]*pointer-events:auto/);
assert.match(css,/\.situation-auto-note\{/);

assert.equal(read('VERSION').trim(),'7.10.0');
assert.match(app,/appVersion:'7\.10\.0'/);
assert.match(html,/야구일기 V7\.10\.0/);
assert.match(sw,/baseball-diary-v7\.10\.0/);

console.log('V7.9.1 pitching out-count auto advance tests: PASS');
