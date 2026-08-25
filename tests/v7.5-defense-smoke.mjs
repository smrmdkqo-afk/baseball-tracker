import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname,join} from 'node:path';
import {
  DEFENSE_VERSION,
  newDefenseAction,
  newDefenseDraft,
  normalizeDefenseMetadata,
  serializeDefenseDraft,
  defenseMissingFields,
  defenseActionStatus,
  defenseOverallTone,
  defenseThrowTLU,
  defenseThrowQuality
} from '../js/defense.js';
import {defenseSummary,analysisSnapshot,analysisMetricValue} from '../js/analytics.js';

const root=join(dirname(fileURLToPath(import.meta.url)),'..');
const read=path=>readFileSync(join(root,path),'utf8');
const app=read('js/app.js'),css=read('styles.css'),html=read('index.html'),sw=read('sw.js');

assert.equal(DEFENSE_VERSION,5);
assert.equal(newDefenseDraft({position:'P'}).position,'P');
assert.equal(newDefenseDraft({position:'C'}).position,'C');

const draft=newDefenseDraft({position:'SS',throwSide:'R'});
const field=newDefenseAction('field','field-1');Object.assign(field,{battedBall:'GB',direction:'L',speed:'fast',fieldingType:'BACKHAND',result:'clean'});
const throwing=newDefenseAction('throw','throw-1');Object.assign(throwing,{target:'1B',accuracy:'high',tlu:0,distance:8,velocity:35});
const receive=newDefenseAction('receive','receive-1');Object.assign(receive,{target:'1B',sourcePosition:'SS',incoming:'low',technique:'scoop',result:'recovered',baseHold:'success'});
const tag=newDefenseAction('tag','tag-1');Object.assign(tag,{targetRunner:'R1',execution:'clean',timing:'close',call:'out'});
const base=newDefenseAction('base','base-1');Object.assign(base,{base:'2B',execution:'secure',timing:'early',call:'out'});
const cover=newDefenseAction('cover','cover-1');Object.assign(cover,{role:'backup',timing:'on_time',result:'correct'});
draft.actions=[field,throwing,receive,tag,base,cover];draft.flowEnded=true;draft.outsRecorded=2;draft.runnersAfter=['1B'];draft.official={status:'entered',po:true,a:true,e:false,dp:true};

const stored=serializeDefenseDraft(draft);
assert.equal(defenseMissingFields(stored).length,0);
assert.equal(defenseThrowTLU(stored),0,'매우 가벼운 토스는 0 TLU여야 합니다.');
assert.equal(defenseThrowQuality(stored.actions[1]),'catchable');
assert.equal(defenseActionStatus(stored.actions[1]).tone,'unstable');
assert.equal(defenseOverallTone(stored),'unstable');
assert.equal('difficulty' in stored.actions[0],false);assert.equal('reach' in stored.actions[0],false);
assert.equal('quality' in stored.actions[1],false);assert.equal('timing' in stored.actions[1],false);assert.equal('purpose' in stored.actions[4],false);

const fly=newDefenseAction('field','fly');Object.assign(fly,{battedBall:'FB',direction:'C',speed:'medium',fieldingType:'BACKHAND',result:'clean'});
const flyStored=serializeDefenseDraft({...newDefenseDraft(),actions:[fly],flowEnded:true,outsRecorded:1,runnersAfter:[],official:{status:'none'}});
assert.equal(flyStored.actions[0].fieldingType,null,'포핸드·백핸드는 땅볼과 번트에만 저장해야 합니다.');

const missingOfficial={...newDefenseDraft(),actions:[field],flowEnded:true,outsRecorded:1,runnersAfter:[]};
assert.ok(defenseMissingFields(missingOfficial).some(item=>item.field==='official'));
const unreachable=newDefenseAction('receive','receive-excluded');Object.assign(unreachable,{target:'1B',sourcePosition:'SS',incoming:'uncatchable',technique:'stretch',result:'failed'});
const excludedStored=serializeDefenseDraft({...newDefenseDraft({position:'1B'}),actions:[unreachable],flowEnded:true,outsRecorded:0,runnersAfter:['1B'],official:{status:'none'}});
assert.equal(excludedStored.actions[0].result,'excluded');
assert.equal(defenseMissingFields(excludedStored).length,0);

const previous=normalizeDefenseMetadata({defenseVersion:3,position:'SS',actions:[{id:'old-field',type:'field',battedBall:'GB',difficulty:'normal',reach:'easy',result:'clean'},{id:'old-throw',type:'throw',target:'1B',quality:'catchable',timing:'on_time',tlu:.85}],flowEnded:true,outcome:'out',outsRecorded:1,official:{status:'entered',a:true}});
assert.equal(previous.previousFormat,true);assert.equal(previous.actions[1].accuracy,'catchable');assert.equal(defenseOverallTone(previous),'legacy');

const events=[stored,previous].map((metadata,index)=>({id:`event-${index}`,athleteId:'a',domain:'defense',eventType:'fielding_play',activityDate:'2026-08-24',parentType:null,parentId:null,deletedAt:null,metadata}));
const data={gameEvents:events,batterFaced:[],plateAppearances:[],athletes:[{id:'a',throws:'R'}],gameDays:[],trainingSets:[]};
const summary=defenseSummary(data,{athleteId:'a'});
assert.equal(summary.dataStatus.complete,1);assert.equal(summary.dataStatus.legacy,1);assert.equal(summary.dataStatus.incomplete,0,'이전 형식 기록을 새 필드 미입력으로 분류하면 안 됩니다.');
assert.equal(summary.fieldDirections.L.attempts,1);assert.equal(summary.fieldSpeeds.fast.attempts,1);assert.equal(summary.fieldMethods.BACKHAND.attempts,1);
assert.equal(summary.receiveSources.SS.attempts,1);assert.equal(summary.receiveForms.low.attempts,1);assert.equal(summary.receiveMethods.scoop.attempts,1);
assert.equal(summary.tagTargets.R1.attempts,1);assert.equal(summary.baseTargets['2B'].attempts,1);assert.equal(summary.coverRoles.backup.attempts,1);
assert.equal(summary.throwLoadStats['0'].attempts,1);assert.equal(summary.throwTLU,.85);
const snapshot=analysisSnapshot(data,{athleteId:'a',source:'game',domain:'defense',date:'2026-08-24'});
assert.equal(analysisMetricValue(snapshot,'PO'),1);assert.equal(analysisMetricValue(snapshot,'DP'),1);assert.equal(analysisMetricValue(snapshot,'coverAttempts'),1);

assert.match(app,/\['P','C','1B','2B','3B','SS','LF','CF','RF'\]\.map/);
for(const token of ['타구 방향 · 선수 기준','타구 속도','송구 정확도','송구를 보낸 위치','송구 받기 방법','플레이 후 주자','공식 기록 · 필수','공식 기록 없음'])assert.match(app,new RegExp(token));
assert.match(app,/\['0','매우 가벼움','0\.00 TLU'\]/);
assert.match(app,/if\(draft\.official\?\.status==='missing'\)/);
assert.match(css,/\.defense-official-required\{display:flex/);
assert.match(css,/\.defense-choice-grid\.after-play\{grid-template-columns:repeat\(4,minmax\(0,1fr\)\)\}/);
assert.equal(read('VERSION').trim(),'7.9.0');assert.match(app,/appVersion:'7\.9\.0'/);assert.match(sw,/baseball-diary-v7\.9\.0/);assert.match(sw,/\.\/js\/defense\.js\?v=7\.9\.0/);assert.match(html,/js\/app\.js\?v=7\.9\.0/);

console.log('V7.8 defense input refinement tests: PASS');
