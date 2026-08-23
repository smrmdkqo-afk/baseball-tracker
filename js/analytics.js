import {normalizeDefenseMetadata,defenseMissingFields,defenseThrowTLU,defenseJudgmentSummary} from './defense.js?v=7.6.1';

export const OFFICIAL_PITCH_TYPES=new Set(['ball','called','swinging','foul','inplay','hbp']);
export const STRIKE_PITCH_TYPES=new Set(['called','swinging','foul','inplay']);
export const HITTING_PITCH_TYPES=new Set(['taken_ball','taken_strike','swinging_strike','foul','in_play','hbp']);
export const GAME_TLU={ball:1,called:1,swinging:1,foul:1,inplay:1,hbp:1,pickoff_normal:.85,pickoff_error:.85,game_warmup:1};

export function active(list){return (list||[]).filter(x=>!x.deletedAt);}
export function round2(v){return Math.round((Number(v)||0)*100)/100;}
export function pct(n,d){return d?n/d:null;}
export function avg(arr){return arr.length?arr.reduce((a,b)=>a+b,0)/arr.length:null;}
export function inDateRange(date,from,to){return (!from||date>=from)&&(!to||date<=to);}
export function dateShift(base,delta){const d=new Date(`${base}T12:00:00`);d.setDate(d.getDate()+delta);return localDate(d);}
export function localDate(d=new Date()){const y=d.getFullYear(),m=String(d.getMonth()+1).padStart(2,'0'),day=String(d.getDate()).padStart(2,'0');return `${y}-${m}-${day}`;}


export const AUX_PITCH_TYPES=new Set(['pickoff_normal','pickoff_error','game_warmup','pitching_exit']);

export function canonicalParentMaps(data,{athleteId=null}={}){
  const bf=new Map(active(data.batterFaced).filter(x=>!athleteId||x.athleteId===athleteId).map(x=>[x.id,x]));
  const pa=new Map(active(data.plateAppearances).filter(x=>!athleteId||x.athleteId===athleteId).map(x=>[x.id,x]));
  return {bf,pa};
}
function parentMaps(data,athleteId=null){return canonicalParentMaps(data,{athleteId});}
function parentForEvent(e,maps){if(e.parentType==='batter_faced')return maps.bf.get(e.parentId)||null;if(e.parentType==='plate_appearance')return maps.pa.get(e.parentId)||null;return null;}
function scopeRecordForEvent(e,maps){return parentForEvent(e,maps)||e;}
export function isCanonicalGameEvent(data,e,{athleteId=null,maps=null}={}){
  if(!e||e.deletedAt)return false;
  if(athleteId&&e.athleteId!==athleteId)return false;
  const pm=maps||canonicalParentMaps(data,{athleteId});
  if(e.parentType==='batter_faced'){
    const p=pm.bf.get(e.parentId);
    return !!p&&p.athleteId===e.athleteId&&e.domain==='pitching';
  }
  if(e.parentType==='plate_appearance'){
    const p=pm.pa.get(e.parentId);
    return !!p&&p.athleteId===e.athleteId&&['hitting','batting'].includes(e.domain);
  }
  if(e.parentType||e.parentId)return false;
  if(e.domain==='pitching')return AUX_PITCH_TYPES.has(e.eventType);
  return e.domain==='defense'||e.domain==='baserunning';
}
export function canonicalGameEvents(data,{athleteId=null}={}){
  const maps=canonicalParentMaps(data,{athleteId});
  return active(data.gameEvents).filter(e=>isCanonicalGameEvent(data,e,{athleteId,maps}));
}
export function gameEventIntegrity(data,{athleteId=null}={}){
  const maps=canonicalParentMaps(data,{athleteId}),all=active(data.gameEvents).filter(e=>!athleteId||e.athleteId===athleteId),invalid=[];
  for(const e of all)if(!isCanonicalGameEvent(data,e,{athleteId,maps}))invalid.push(e);
  return {
    invalid,
    orphanPitching:invalid.filter(e=>e.domain==='pitching'&&OFFICIAL_PITCH_TYPES.has(e.eventType)).length,
    orphanHitting:invalid.filter(e=>['hitting','batting'].includes(e.domain)).length,
    total:invalid.length
  };
}
function athleteThrowSide(data,athleteId){const a=active(data.athletes).find(x=>x.id===athleteId);return a&&['R','L'].includes(a.throws)?a.throws:null;}
function validSide(value){return value==='R'||value==='L'?value:null;}
function storedSide(metadata,key,fallback){return Object.prototype.hasOwnProperty.call(metadata||{},key)?validSide(metadata[key]):validSide(fallback);}
export function gameEventMatchup(event,parent=null){const metadata=event?.metadata||{};return {pitcherSide:storedSide(metadata,'pitcherSide',parent?.pitcherSide),batterSide:storedSide(metadata,'batterSide',parent?.batterSide)};}
function eventMatchesSides(event,parent,{pitcherSide=null,batterSide=null}={}){const matchup=gameEventMatchup(event,parent);return (!pitcherSide||matchup.pitcherSide===pitcherSide)&&(!batterSide||matchup.batterSide===batterSide);}
function nonBfThrowSide(data,e,athleteId){return validSide(e.metadata?.throwSide)||validSide(e.metadata?.pitcherSide)||athleteThrowSide(data,athleteId)||null;}
function matchDateAndGame(x,{date=null,from=null,to=null,gameDayId=null}={}){return (!gameDayId||x.gameDayId===gameDayId)&&(date?x.activityDate===date:inDateRange(x.activityDate,from,to));}
function ratioObject(obj){const total=Object.values(obj||{}).reduce((a,v)=>a+Number(v||0),0),out={};for(const [k,v] of Object.entries(obj||{}))out[k]=pct(Number(v||0),total);return {total,ratios:out};}
function sortedParentEvents(events,parentId){return events.filter(event=>event.parentId===parentId).sort((a,b)=>new Date(a.recordedAt)-new Date(b.recordedAt));}
function parentMatchesSides(parent,parentEvents,sides){const terminal=parentEvents.at(-1)||null;return eventMatchesSides(terminal,parent,sides);}

export function gamePitchingSummary(data,{athleteId,date=null,from=null,to=null,gameDayId=null,pitcherSide=null,batterSide=null}={}){
  const maps=parentMaps(data,athleteId);
  const all=canonicalGameEvents(data,{athleteId}).filter(e=>e.domain==='pitching'&&matchDateAndGame(scopeRecordForEvent(e,maps),{date,from,to,gameDayId}));
  const allPitches=all.filter(e=>OFFICIAL_PITCH_TYPES.has(e.eventType));
  const scopedBF=active(data.batterFaced).filter(b=>b.athleteId===athleteId&&matchDateAndGame(b,{date,from,to,gameDayId}));
  const events=all.filter(e=>{
    if(e.parentType==='batter_faced'){
      const bf=maps.bf.get(e.parentId);
      return eventMatchesSides(e,bf,{pitcherSide,batterSide});
    }
    if(e.eventType==='pitching_exit')return eventMatchesSides(e,null,{pitcherSide,batterSide});
    if(batterSide)return false;
    if(pitcherSide&&nonBfThrowSide(data,e,athleteId)!==pitcherSide)return false;
    return true;
  });
  const pitches=events.filter(e=>OFFICIAL_PITCH_TYPES.has(e.eventType));
  const strikes=pitches.filter(e=>STRIKE_PITCH_TYPES.has(e.eventType));
  const balls=pitches.filter(e=>e.eventType==='ball');
  const hbp=pitches.filter(e=>e.eventType==='hbp');
  const called=pitches.filter(e=>e.eventType==='called');
  const swinging=pitches.filter(e=>e.eventType==='swinging');
  const foul=pitches.filter(e=>e.eventType==='foul');
  const inplay=pitches.filter(e=>e.eventType==='inplay');
  const pickoffs=events.filter(e=>e.eventType==='pickoff_normal');
  const pickoffErrors=events.filter(e=>e.eventType==='pickoff_error');
  const warmups=events.filter(e=>e.eventType==='game_warmup');
  const pitchingExits=events.filter(e=>e.eventType==='pitching_exit');
  const gameTLU=events.reduce((sum,e)=>sum+(GAME_TLU[e.eventType]||Number(e.metadata?.tlu)||0),0);
  const bfList=scopedBF.filter(b=>parentMatchesSides(b,sortedParentEvents(allPitches,b.id),{pitcherSide,batterSide}));
  const completed=bfList.filter(b=>b.completed),unknown=bfList.filter(b=>!b.completed&&b.result==='UNKNOWN'),relieved=bfList.filter(b=>!b.completed&&b.result==='RELIEVED'),incomplete=bfList.filter(b=>!b.completed&&!['UNKNOWN','RELIEVED'].includes(b.result));
  const k=completed.filter(b=>b.result==='K').length,bb=completed.filter(b=>b.result==='BB').length,bfHbp=completed.filter(b=>b.result==='HBP').length;
  let firstPitchStrikes=0,firstPitchCount=0;
  for(const bf of scopedBF){const first=sortedParentEvents(allPitches,bf.id)[0];if(first&&eventMatchesSides(first,bf,{pitcherSide,batterSide})){firstPitchCount++;if(STRIKE_PITCH_TYPES.has(first.eventType))firstPitchStrikes++;}}
  const battedResults={OUT:0,'1B':0,'2B':0,'3B':0,HR:0,ROE:0,SH:0,SF:0},battedTypes={GB:0,LD:0,FB:0},directions={L:0,C:0,R:0};
  for(const e of inplay){const r=e.metadata?.result;if(r&&r in battedResults)battedResults[r]++;const bt=e.metadata?.battedBall;if(bt&&bt in battedTypes)battedTypes[bt]++;const dr=e.metadata?.direction;if(dr&&dr in directions)directions[dr]++;}
  const completedIds=new Set(completed.map(b=>b.id)),completedPitchCount=allPitches.filter(e=>completedIds.has(e.parentId)).length;
  const battedTypeInfo=ratioObject(battedTypes),directionInfo=ratioObject(directions);
  const defenseTLU=batterSide?0:defenseSummary(data,{athleteId,date,from,to,gameDayId,throwSide:pitcherSide}).throwTLU;
  const strikePct=pct(strikes.length,pitches.length),kPct=pct(k,completed.length),bbPct=pct(bb,completed.length);
  const missingPitcherSide=allPitches.filter(e=>!gameEventMatchup(e,maps.bf.get(e.parentId)).pitcherSide).length,missingBatterSide=allPitches.filter(e=>!gameEventMatchup(e,maps.bf.get(e.parentId)).batterSide).length;
  return {
    officialPitches:pitches.length,totalGameThrows:pitches.length+pickoffs.length+pickoffErrors.length+warmups.length,
    gameTLU:round2(gameTLU),gameTotalTLU:round2(gameTLU+defenseTLU),defenseThrowTLU:round2(defenseTLU),
    strikes:strikes.length,balls:balls.length,hbp:hbp.length,called:called.length,swinging:swinging.length,foul:foul.length,inplay:inplay.length,
    strikePct,ballPct:pct(balls.length,pitches.length),calledStrikePct:pct(called.length,pitches.length),swStrPct:pct(swinging.length,pitches.length),cswPct:pct(called.length+swinging.length,pitches.length),foulPct:pct(foul.length,pitches.length),inPlayPct:pct(inplay.length,pitches.length),hbpPitchPct:pct(hbp.length,pitches.length),
    firstPitchStrikes,firstPitchCount,firstPitchStrikePct:pct(firstPitchStrikes,firstPitchCount),
    bf:completed.length,unknownBF:unknown.length,relievedBF:relieved.length,incompleteBF:incomplete.length,k,bb,bfHbp,kPct,bbPct,kMinusBbPct:kPct==null||bbPct==null?null:kPct-bbPct,
    completedPitchCount,pitchesPerBatter:pct(completedPitchCount,completed.length),pickoffs:pickoffs.length,pickoffErrors:pickoffErrors.length,warmups:warmups.length,pitchingExits:pitchingExits.length,
    missingPitcherSide,missingBatterSide,
    battedResults,battedTypes,battedTypePct:battedTypeInfo.ratios,directions,directionPct:directionInfo.ratios,bipWithType:battedTypeInfo.total,bipWithDirection:directionInfo.total,
    events,pitches,bfList,completedBF:completed
  };
}

export function battingSummary(data,{athleteId,date=null,from=null,to=null,gameDayId=null,batterSide=null,pitcherSide=null}={}){
  const maps=parentMaps(data,athleteId),allPas=active(data.plateAppearances).filter(p=>p.athleteId===athleteId&&matchDateAndGame(p,{date,from,to,gameDayId})),allPaIds=new Set(allPas.map(p=>p.id));
  const allEvents=canonicalGameEvents(data,{athleteId}).filter(e=>['hitting','batting'].includes(e.domain)&&e.parentType==='plate_appearance'&&allPaIds.has(e.parentId)&&HITTING_PITCH_TYPES.has(e.eventType));
  const pas=allPas.filter(p=>parentMatchesSides(p,sortedParentEvents(allEvents,p.id),{batterSide,pitcherSide}));
  const completed=pas.filter(p=>p.completed&&p.result),unknown=pas.filter(p=>!p.completed&&p.result==='UNKNOWN'),incomplete=pas.filter(p=>!p.completed&&p.result!=='UNKNOWN');
  const events=allEvents.filter(e=>eventMatchesSides(e,maps.pa.get(e.parentId),{batterSide,pitcherSide}));
  const counts={};for(const p of completed)counts[p.result]=(counts[p.result]||0)+1;
  const H=(counts['1B']||0)+(counts['2B']||0)+(counts['3B']||0)+(counts.HR||0),BB=counts.BB||0,HBP=counts.HBP||0,SF=counts.SF||0,SH=counts.SH||0,SO=counts.SO||0,ROE=counts.ROE||0,HR=counts.HR||0;
  const AB=completed.length-BB-HBP-SF-SH,TB=(counts['1B']||0)+2*(counts['2B']||0)+3*(counts['3B']||0)+4*HR,AVG=pct(H,AB),OBP=pct(H+BB+HBP,AB+BB+HBP+SF),SLG=AB?TB/AB:(completed.length?0:null),OPS=OBP==null?null:OBP+SLG,ISO=AVG==null||SLG==null?null:SLG-AVG;
  const babipDen=AB-SO-HR+SF,BABIP=pct(H-HR,babipDen);
  const swingTypes=new Set(['swinging_strike','foul','in_play']),swings=events.filter(e=>swingTypes.has(e.eventType)),whiffs=events.filter(e=>e.eventType==='swinging_strike'),contacts=events.filter(e=>['foul','in_play'].includes(e.eventType));
  const takenBalls=events.filter(e=>e.eventType==='taken_ball').length,takenStrikes=events.filter(e=>e.eventType==='taken_strike').length,totalPitches=events.length;
  const completedIds=new Set(completed.map(p=>p.id)),completedPitchCount=allEvents.filter(e=>completedIds.has(e.parentId)).length;
  const battedTypes={GB:0,LD:0,FB:0},directions={L:0,C:0,R:0};for(const e of events.filter(e=>e.eventType==='in_play')){const bt=e.metadata?.battedBall;if(bt&&bt in battedTypes)battedTypes[bt]++;const dr=e.metadata?.direction;if(dr&&dr in directions)directions[dr]++;}
  const battedTypeInfo=ratioObject(battedTypes),directionInfo=ratioObject(directions),kPct=pct(SO,completed.length),bbPct=pct(BB,completed.length);
  const missingBatterSide=allEvents.filter(e=>!gameEventMatchup(e,maps.pa.get(e.parentId)).batterSide).length,missingPitcherSide=allEvents.filter(e=>!gameEventMatchup(e,maps.pa.get(e.parentId)).pitcherSide).length;
  return {
    PA:completed.length,unknownPA:unknown.length,incompletePA:incomplete.length,AB,H,BB,HBP,SF,SH,SO,ROE,HR,AVG,OBP,SLG,OPS,ISO,BABIP,TB,counts,
    totalPitches,completedPitchCount,pitchesPerPA:pct(completedPitchCount,completed.length),swings:swings.length,whiffs:whiffs.length,contacts:contacts.length,
    swingPct:pct(swings.length,totalPitches),whiffPct:pct(whiffs.length,swings.length),contactPct:pct(contacts.length,swings.length),calledStrikePct:pct(takenStrikes,totalPitches),kPct,bbPct,bbPerK:pct(BB,SO),
    takenBalls,takenStrikes,events,pas,completedPA:completed,missingBatterSide,missingPitcherSide,battedTypes,battedTypePct:battedTypeInfo.ratios,directions,directionPct:directionInfo.ratios,bipWithType:battedTypeInfo.total,bipWithDirection:directionInfo.total
  };
}

function isOutfieldPosition(p){return ['LF','CF','RF'].includes(String(p||'').toUpperCase());}
function fieldTypeBucket(m){return isOutfieldPosition(m.position)||m.positionGroup==='OF'?'OF':'IF';}
export function defenseSummary(data,{athleteId,date=null,from=null,to=null,gameDayId=null,throwSide=null}={}){
  const events=canonicalGameEvents(data,{athleteId}).filter(e=>e.domain==='defense'&&matchDateAndGame(e,{date,from,to,gameDayId})&&e.eventType==='fielding_play'&&(!throwSide||((e.metadata?.throwSide||athleteThrowSide(data,athleteId))===throwSide)));
  const field={success:0,unstable:0,failed:0},throws={success:0,error:0,missing:0,none:0},receives={clean:0,recovered:0,failed:0,excluded:0,missing:0},tags={clean:0,recovered:0,missed:0,dropped:0,missing:0},tagCalls={out:0,safe:0,no_call:0,missing:0},baseTouches={secure:0,off_base:0,missed:0,missing:0},baseCalls={out:0,safe:0,no_call:0,missing:0},outTiming={early:0,close:0,late:0,na:0,missing:0},covers={correct:0,recovered:0,failed:0,missing:0},reach={easy:0,effort:0,not_reached:0,missing:0},throwQuality={accurate:0,catchable:0,uncatchable:0,missing:0},throwTiming={on_time:0,late:0,no_chance:0,missing:0},actionCounts={field:0,throw:0,receive:0,tag:0,base:0,cover:0},official={po:0,a:0,e:0,dp:0,missing:0,none:0},dataStatus={complete:0,incomplete:0,legacy:0},ifTypes={},ofTypes={},targets={},targetStats={},fieldTypeThrowStats={},outcomes={out:0,safe:0,continue:0,missing:0};let throwTLU=0,receiveSaveOpportunities=0,receiveSaves=0,scoopAttempts=0,scoopSuccess=0;
  const judgment={best:0,acceptable:0,wrong:0,evaluated:0,appropriate:0};
  for(const e of events){
    const m=normalizeDefenseMetadata(e.metadata||{}),actions=m.actions||[],throwActions=actions.filter(x=>x.type==='throw');throwTLU+=defenseThrowTLU(m);
    if(m.legacy)dataStatus.legacy++;else if(defenseMissingFields(m).length)dataStatus.incomplete++;else dataStatus.complete++;
    outcomes[m.outcome||'missing']=(outcomes[m.outcome||'missing']||0)+1;if(m.official.status==='missing')official.missing++;else if(m.official.status==='none')official.none++;for(const key of ['po','a','e','dp'])if(m.official[key])official[key]++;
    const js=defenseJudgmentSummary(m);for(const key of ['best','acceptable','wrong','evaluated','appropriate'])judgment[key]+=js[key]||0;
    if(!throwActions.length)throws.none++;
    for(const [actionIndex,action] of actions.entries()){
      actionCounts[action.type]=(actionCounts[action.type]||0)+1;
      if(action.type==='field'){
        if(action.reach in reach)reach[action.reach]++;else reach.missing++;
        if(action.reach==='not_reached')field.failed++;else if(action.result==='clean')field.success++;else if(action.result==='recovered')field.unstable++;else if(action.result==='failed')field.failed++;
        if(action.fieldingType){const bucket=fieldTypeBucket(m),obj=bucket==='OF'?ofTypes:ifTypes;obj[action.fieldingType]=(obj[action.fieldingType]||0)+1;}
      }else if(action.type==='throw'){
        const quality=action.quality||'missing';throwQuality[quality]=(throwQuality[quality]||0)+1;if(['accurate','catchable'].includes(quality))throws.success++;else if(quality==='uncatchable')throws.error++;else throws.missing++;
        const timing=action.timing||'missing';throwTiming[timing]=(throwTiming[timing]||0)+1;if(action.target){targets[action.target]=(targets[action.target]||0)+1;const x=targetStats[action.target]||(targetStats[action.target]={attempts:0,success:0,error:0,missing:0});x.attempts++;if(['accurate','catchable'].includes(quality))x.success++;else if(quality==='uncatchable')x.error++;else x.missing++;}
        const previous=actions[actionIndex-1];if(previous?.type==='field'&&previous.fieldingType){const bucket=fieldTypeBucket(m),x=fieldTypeThrowStats[previous.fieldingType]||(fieldTypeThrowStats[previous.fieldingType]={attempts:0,success:0,error:0,missing:0,bucket});x.attempts++;if(['accurate','catchable'].includes(quality))x.success++;else if(quality==='uncatchable')x.error++;else x.missing++;}
      }else if(action.type==='receive'){
        const result=action.result||'missing';receives[result]=(receives[result]||0)+1;if(['high','low','wide','bounce'].includes(action.incoming)&&['clean','recovered','failed'].includes(result)){receiveSaveOpportunities++;if(['clean','recovered'].includes(result))receiveSaves++;}if(action.technique==='scoop'&&['clean','recovered','failed'].includes(result)){scoopAttempts++;if(['clean','recovered'].includes(result))scoopSuccess++;}
      }else if(action.type==='tag'){
        const execution=action.execution||'missing',call=action.call||'missing',timing=action.timing||'missing';tags[execution]=(tags[execution]||0)+1;tagCalls[call]=(tagCalls[call]||0)+1;outTiming[timing]=(outTiming[timing]||0)+1;
      }else if(action.type==='base'){
        const execution=action.execution||'missing',call=action.call||'missing',timing=action.timing||'missing';baseTouches[execution]=(baseTouches[execution]||0)+1;baseCalls[call]=(baseCalls[call]||0)+1;outTiming[timing]=(outTiming[timing]||0)+1;
      }else{const result=action.result||'missing';covers[result]=(covers[result]||0)+1;}
    }
  }
  for(const x of Object.values(targetStats))x.successPct=pct(x.success,x.success+x.error);for(const x of Object.values(fieldTypeThrowStats))x.successPct=pct(x.success,x.success+x.error);
  const fieldAttempts=field.success+field.unstable+field.failed,handledAttempts=field.success+field.unstable+field.failed-reach.not_reached,reachAttempts=reach.easy+reach.effort+reach.not_reached,throwQualityAttempts=throwQuality.accurate+throwQuality.catchable+throwQuality.uncatchable,throwAttempts=actionCounts.throw,receiveAttempts=receives.clean+receives.recovered+receives.failed,onTimeAttempts=throwTiming.on_time+throwTiming.late,tagAttempts=actionCounts.tag,tagExecutionAttempts=tags.clean+tags.recovered+tags.missed+tags.dropped,tagCallAttempts=tagCalls.out+tagCalls.safe,baseTouchAttempts=actionCounts.base,baseExecutionAttempts=baseTouches.secure+baseTouches.off_base+baseTouches.missed,outTimingAttempts=outTiming.early+outTiming.close+outTiming.late,outExecutionAttempts=tagExecutionAttempts+baseExecutionAttempts,outMisses=tags.missed+tags.dropped+baseTouches.off_base+baseTouches.missed,totalChances=official.po+official.a+official.e;
  return {plays:events.length,field,throws,receives,tags,tagCalls,baseTouches,baseCalls,outTiming,covers,reach,throwQuality,throwTiming,actionCounts,official,dataStatus,outcomes,ifTypes,ofTypes,targets,targetStats,fieldTypeThrowStats,fieldAttempts,handledAttempts,reachAttempts,fieldingSuccessPct:pct(field.success,fieldAttempts),cleanPct:pct(field.success,handledAttempts),securePct:pct(field.success+field.unstable,handledAttempts),reachPct:pct(reach.easy+reach.effort,reachAttempts),throwSuccessPct:pct(throws.success,throwQualityAttempts),onTargetPct:pct(throwQuality.accurate,throwQualityAttempts),catchablePct:pct(throws.success,throwQualityAttempts),onTimePct:pct(throwTiming.on_time,onTimeAttempts),receivePct:pct(receives.clean+receives.recovered,receiveAttempts),savePct:pct(receiveSaves,receiveSaveOpportunities),scoopPct:pct(scoopSuccess,scoopAttempts),receiveMissPct:pct(receives.failed,receiveAttempts),tagContactPct:pct(tags.clean+tags.recovered,tagExecutionAttempts),tagOutPct:pct(tagCalls.out,tagCallAttempts),baseTouchPct:pct(baseTouches.secure,baseExecutionAttempts),outOnTimePct:pct(outTiming.early+outTiming.close,outTimingAttempts),outMissPct:pct(outMisses,outExecutionAttempts),judgmentAppropriatePct:pct(judgment.appropriate,judgment.evaluated),judgment,throwTLU:round2(throwTLU),throwAttempts,throwQualityAttempts,tagAttempts,tagExecutionAttempts,tagCallAttempts,baseTouchAttempts,baseExecutionAttempts,outTimingAttempts,outExecutionAttempts,totalChances,fieldingPct:pct(official.po+official.a,totalChances),events};
}

export function baserunningSummary(data,{athleteId,date=null,from=null,to=null,gameDayId=null}={}){
  const events=canonicalGameEvents(data,{athleteId}).filter(e=>e.domain==='baserunning'&&matchDateAndGame(e,{date,from,to,gameDayId}));
  const steals=events.filter(e=>e.eventType==='steal_attempt'),sb=steals.filter(e=>e.metadata?.result==='SUCCESS').length,cs=steals.filter(e=>e.metadata?.result==='FAILED').length,routes={};
  for(const e of steals){const key=`${e.metadata?.from||'?'}>${e.metadata?.to||'?'}`,x=routes[key]||(routes[key]={attempts:0,success:0,failed:0});x.attempts++;if(e.metadata?.result==='SUCCESS')x.success++;else if(e.metadata?.result==='FAILED')x.failed++;}
  for(const x of Object.values(routes))x.successPct=pct(x.success,x.attempts);
  return {sb,cs,attempts:sb+cs,sbPct:pct(sb,sb+cs),events:steals,routes};
}

export function trainingSummary(data,{athleteId,date=null,from=null,to=null,domain=null,side=null}={}){
  const sets=active(data.trainingSets).filter(s=>s.athleteId===athleteId&&(date?s.activityDate===date:inDateRange(s.activityDate,from,to))&&(!domain||domain==='all'||s.domain===domain)&&(!side||s.side===side));
  const byDomain={pitching:{sets:0,volume:0,tlu:0},hitting:{sets:0,volume:0,tlu:0},defense:{sets:0,volume:0,tlu:0},baserunning:{sets:0,volume:0,tlu:0}},byType={},bySide={R:0,L:0,N:0},byArea={IF:0,OF:0,N:0},byIntensity={light:0,medium:0,max:0};let tlu=0,defenseThrowCount=0;
  for(const s of sets){const d=byDomain[s.domain]||(byDomain[s.domain]={sets:0,volume:0,tlu:0});d.sets++;d.volume+=Number(s.quantity)||0;d.tlu+=Number(s.tluTotal)||0;tlu+=Number(s.tluTotal)||0;byType[s.trainingType]=(byType[s.trainingType]||0)+(Number(s.quantity)||0);bySide[s.side||'N']=(bySide[s.side||'N']||0)+(Number(s.quantity)||0);byArea[s.metadata?.area||'N']=(byArea[s.metadata?.area||'N']||0)+(Number(s.quantity)||0);if(s.domain==='pitching'&&s.metadata?.intensity in byIntensity)byIntensity[s.metadata.intensity]+=Number(s.quantity)||0;if(s.domain==='defense')defenseThrowCount+=Number(s.metadata?.throwCount||0);}
  Object.values(byDomain).forEach(x=>x.tlu=round2(x.tlu));return {sets,byDomain,byType,bySide,byArea,byIntensity,defenseThrowCount,tlu:round2(tlu)};
}

export function workloadSummary(data,{athleteId,date=null,from=null,to=null,throwSide=null}={}){
  const gp=gamePitchingSummary(data,{athleteId,date,from,to,pitcherSide:throwSide}),gd=defenseSummary(data,{athleteId,date,from,to,throwSide});
  const allSets=active(data.trainingSets).filter(s=>s.athleteId===athleteId&&(date?s.activityDate===date:inDateRange(s.activityDate,from,to)));
  const defaultSide=athleteThrowSide(data,athleteId);
  const pitchingSets=allSets.filter(s=>s.domain==='pitching'&&(!throwSide||s.side===throwSide));
  const defenseSets=allSets.filter(s=>s.domain==='defense'&&(!throwSide||defaultSide===throwSide));
  const pitchingTraining=pitchingSets.reduce((a,s)=>a+Number(s.tluTotal||0),0),defenseTraining=defenseSets.reduce((a,s)=>a+Number(s.tluTotal||0),0);
  const officialPitchTLU=gp.officialPitches,pickoffTLU=round2((gp.pickoffs+gp.pickoffErrors)*0.85),warmupTLU=gp.warmups,gameDefenseThrowing=gd.throwTLU;
  return {officialPitchTLU,pickoffTLU,warmupTLU,gameDefenseThrowing:round2(gameDefenseThrowing),pitchingTraining:round2(pitchingTraining),defenseThrowing:round2(defenseTraining),total:round2(officialPitchTLU+pickoffTLU+warmupTLU+gameDefenseThrowing+pitchingTraining+defenseTraining)};
}
export function totalTLU(data,opts={}){return workloadSummary(data,opts).total;}
export function todaySummary(data,{athleteId,date}){const p=gamePitchingSummary(data,{athleteId,date}),h=battingSummary(data,{athleteId,date}),d=defenseSummary(data,{athleteId,date}),b=baserunningSummary(data,{athleteId,date}),t=trainingSummary(data,{athleteId,date}),w=workloadSummary(data,{athleteId,date});return {date,totalTLU:w.total,gameTLU:p.gameTotalTLU,game:{pitching:p,hitting:h,defense:d,baserunning:b},training:t,workload:w};}

export function analysisSnapshot(data,{athleteId,source='game',domain='pitching',date=null,from=null,to=null,gameDayId=null,ownSide=null,oppSide=null}={}){
  if(source==='game'){
    if(domain==='pitching')return {source,domain,summary:gamePitchingSummary(data,{athleteId,date,from,to,gameDayId,pitcherSide:ownSide,batterSide:oppSide})};
    if(domain==='hitting')return {source,domain,summary:battingSummary(data,{athleteId,date,from,to,gameDayId,batterSide:ownSide,pitcherSide:oppSide})};
    if(domain==='defense')return {source,domain,summary:defenseSummary(data,{athleteId,date,from,to,gameDayId})};
    return {source,domain:'baserunning',summary:baserunningSummary(data,{athleteId,date,from,to,gameDayId})};
  }
  const training=trainingSummary(data,{athleteId,date,from,to,domain:domain==='all'?null:domain,side:ownSide});
  const workload=workloadSummary(data,{athleteId,date,from,to,throwSide:domain==='pitching'?ownSide:null});
  return {source:'training',domain,summary:training,workload,domainSummary:domain==='all'?null:(training.byDomain[domain]||{sets:0,volume:0,tlu:0})};
}

export function analysisMetricValue(snapshot,metric){
  if(!snapshot)return null;
  const s=snapshot.summary;
  if(snapshot.source==='game'){
    if(snapshot.domain==='pitching'){
      const map={officialPitches:s.officialPitches,gameTLU:s.gameTotalTLU,strikePct:s.strikePct==null?null:s.strikePct*100,firstPitchStrikePct:s.firstPitchStrikePct==null?null:s.firstPitchStrikePct*100,ballPct:s.ballPct==null?null:s.ballPct*100,bbPct:s.bbPct==null?null:s.bbPct*100,pitchesPerBatter:s.pitchesPerBatter,cswPct:s.cswPct==null?null:s.cswPct*100,swStrPct:s.swStrPct==null?null:s.swStrPct*100,calledStrikePct:s.calledStrikePct==null?null:s.calledStrikePct*100,kPct:s.kPct==null?null:s.kPct*100,kMinusBbPct:s.kMinusBbPct==null?null:s.kMinusBbPct*100,foulPct:s.foulPct==null?null:s.foulPct*100,inPlayPct:s.inPlayPct==null?null:s.inPlayPct*100,hbpPitchPct:s.hbpPitchPct==null?null:s.hbpPitchPct*100,bf:s.bf,k:s.k,bb:s.bb,gbPct:s.battedTypePct.GB==null?null:s.battedTypePct.GB*100,ldPct:s.battedTypePct.LD==null?null:s.battedTypePct.LD*100,fbPct:s.battedTypePct.FB==null?null:s.battedTypePct.FB*100};return map[metric]??null;
    }
    if(snapshot.domain==='hitting'){
      const map={PA:s.PA,H:s.H,AVG:s.AVG,OBP:s.OBP,SLG:s.SLG,OPS:s.OPS,ISO:s.ISO,BABIP:s.BABIP,pitchesPerPA:s.pitchesPerPA,swingPct:s.swingPct==null?null:s.swingPct*100,whiffPct:s.whiffPct==null?null:s.whiffPct*100,contactPct:s.contactPct==null?null:s.contactPct*100,calledStrikePct:s.calledStrikePct==null?null:s.calledStrikePct*100,kPct:s.kPct==null?null:s.kPct*100,bbPct:s.bbPct==null?null:s.bbPct*100,bbPerK:s.bbPerK,swings:s.swings,gbPct:s.battedTypePct.GB==null?null:s.battedTypePct.GB*100,ldPct:s.battedTypePct.LD==null?null:s.battedTypePct.LD*100,fbPct:s.battedTypePct.FB==null?null:s.battedTypePct.FB*100};return map[metric]??null;
    }
    if(snapshot.domain==='defense'){const map={plays:s.plays,fieldingSuccessPct:s.fieldingSuccessPct==null?null:s.fieldingSuccessPct*100,cleanPct:s.cleanPct==null?null:s.cleanPct*100,securePct:s.securePct==null?null:s.securePct*100,reachPct:s.reachPct==null?null:s.reachPct*100,throwSuccessPct:s.throwSuccessPct==null?null:s.throwSuccessPct*100,onTargetPct:s.onTargetPct==null?null:s.onTargetPct*100,catchablePct:s.catchablePct==null?null:s.catchablePct*100,onTimePct:s.onTimePct==null?null:s.onTimePct*100,receivePct:s.receivePct==null?null:s.receivePct*100,savePct:s.savePct==null?null:s.savePct*100,scoopPct:s.scoopPct==null?null:s.scoopPct*100,receiveMissPct:s.receiveMissPct==null?null:s.receiveMissPct*100,tagAttempts:s.tagAttempts,tagContactPct:s.tagContactPct==null?null:s.tagContactPct*100,tagOutPct:s.tagOutPct==null?null:s.tagOutPct*100,baseTouchAttempts:s.baseTouchAttempts,baseTouchPct:s.baseTouchPct==null?null:s.baseTouchPct*100,outOnTimePct:s.outOnTimePct==null?null:s.outOnTimePct*100,outMissPct:s.outMissPct==null?null:s.outMissPct*100,judgmentAppropriatePct:s.judgmentAppropriatePct==null?null:s.judgmentAppropriatePct*100,throwAttempts:s.throwAttempts,throwTLU:s.throwTLU,PO:s.official.po,A:s.official.a,E:s.official.e,DP:s.official.dp,TC:s.totalChances,FPCT:s.fieldingPct};return map[metric]??null;}
    const map={sb:s.sb,cs:s.cs,attempts:s.attempts,sbPct:s.sbPct==null?null:s.sbPct*100};return map[metric]??null;
  }
  const d=snapshot.domainSummary,t=snapshot.summary,w=snapshot.workload;
  if(snapshot.domain==='all'){
    const map={total_tlu:w.total,throws:(t.byDomain.pitching?.volume||0)+(t.defenseThrowCount||0),swings:t.byDomain.hitting?.volume||0,defenseReps:t.byDomain.defense?.volume||0,baserunningReps:t.byDomain.baserunning?.volume||0};return map[metric]??null;
  }
  if(snapshot.domain==='pitching'){const map={volume:d?.volume||0,tlu:d?.tlu||0,total_tlu:w.total,sets:d?.sets||0,light:t.byIntensity.light||0,medium:t.byIntensity.medium||0,max:t.byIntensity.max||0};return map[metric]??null;}
  if(snapshot.domain==='hitting'){const map={volume:d?.volume||0,sets:d?.sets||0,total_tlu:w.total};return map[metric]??(t.byType[metric]??null);}
  if(snapshot.domain==='defense'){const map={volume:d?.volume||0,sets:d?.sets||0,throwCount:t.defenseThrowCount||0,tlu:d?.tlu||0,total_tlu:w.total};return map[metric]??(t.byType[metric]??null);}
  const map={volume:d?.volume||0,sets:d?.sets||0,total_tlu:w.total};return map[metric]??(t.byType[metric]??null);
}

function sourceHasData(snapshot,metric){if(!snapshot)return false;const s=snapshot.summary;if(snapshot.source==='training'){if(metric==='total_tlu')return snapshot.workload.total>0;return (s.sets?.length||0)>0;}if(snapshot.domain==='pitching')return s.events.length>0||s.bf+s.unknownBF+s.incompleteBF+(s.relievedBF||0)>0;if(snapshot.domain==='hitting')return s.events.length>0||s.PA+s.unknownPA+s.incompletePA>0;if(snapshot.domain==='defense')return s.plays>0;return s.attempts>0;}
function mondayOf(date){const d=new Date(`${date}T12:00:00`),day=(d.getDay()+6)%7;d.setDate(d.getDate()-day);return localDate(d);}
function monthEnd(date){const [y,m]=date.split('-').map(Number);return localDate(new Date(y,m,0,12));}
function yearEnd(date){return `${date.slice(0,4)}-12-31`;}
function clampRange(start,end,from,to){return {from:start<from?from:start,to:end>to?to:end};}
function relevantDates(data,{athleteId,source,domain,metric,from,to}){
  const out=[];
  const maps=canonicalParentMaps(data,{athleteId}),validEvents=canonicalGameEvents(data,{athleteId});
  if(source==='game'){
    if(domain==='pitching'){for(const x of validEvents)if(x.domain==='pitching'){const d=scopeRecordForEvent(x,maps).activityDate;if(inDateRange(d,from,to))out.push(d);}for(const x of active(data.batterFaced))if(x.athleteId===athleteId&&inDateRange(x.activityDate,from,to))out.push(x.activityDate);}
    else if(domain==='hitting'){for(const x of validEvents)if(['hitting','batting'].includes(x.domain)){const d=scopeRecordForEvent(x,maps).activityDate;if(inDateRange(d,from,to))out.push(d);}for(const x of active(data.plateAppearances))if(x.athleteId===athleteId&&inDateRange(x.activityDate,from,to))out.push(x.activityDate);}
    else for(const x of validEvents)if(x.domain===domain&&inDateRange(x.activityDate,from,to))out.push(x.activityDate);
  }else{
    if(metric==='total_tlu'){for(const x of validEvents)if(['pitching','defense'].includes(x.domain)){const d=scopeRecordForEvent(x,maps).activityDate;if(inDateRange(d,from,to))out.push(d);}for(const x of active(data.trainingSets))if(x.athleteId===athleteId&&inDateRange(x.activityDate,from,to))out.push(x.activityDate);}
    else for(const x of active(data.trainingSets))if(x.athleteId===athleteId&&(domain==='all'||x.domain===domain)&&inDateRange(x.activityDate,from,to))out.push(x.activityDate);
  }
  return [...new Set(out)].sort();
}
function groupDescriptors(data,{athleteId,source,domain,metric,from,to,viewUnit}){
  if(source==='game'&&viewUnit==='game'){
    let gds=active(data.gameDays).filter(g=>g.athleteId===athleteId&&inDateRange(g.activityDate,from,to)).sort((a,b)=>a.activityDate.localeCompare(b.activityDate));
    if(!gds.length){return relevantDates(data,{athleteId,source,domain,metric,from,to}).map(d=>({key:d,label:d.slice(5).replace('-','/'),from:d,to:d,date:d,gameDayId:null}));}
    const dateCounts={};return gds.map(g=>{dateCounts[g.activityDate]=(dateCounts[g.activityDate]||0)+1;const n=dateCounts[g.activityDate],same=gds.filter(x=>x.activityDate===g.activityDate).length;return {key:g.id,label:`${g.activityDate.slice(5).replace('-','/')}${same>1?` G${n}`:''}`,from:g.activityDate,to:g.activityDate,date:g.activityDate,gameDayId:g.id};});
  }
  const dates=relevantDates(data,{athleteId,source,domain,metric,from,to}),groups=new Map();
  for(const d of dates){let key,start,end,label;if(viewUnit==='day'||viewUnit==='game'){key=d;start=end=d;label=d.slice(5).replace('-','/');}else if(viewUnit==='week'){start=mondayOf(d);end=dateShift(start,6);key=start;label=`${start.slice(5).replace('-','/')} 주`;}else if(viewUnit==='month'){start=`${d.slice(0,7)}-01`;end=monthEnd(start);key=d.slice(0,7);label=d.slice(0,7).replace('-','.');}else{start=`${d.slice(0,4)}-01-01`;end=yearEnd(start);key=d.slice(0,4);label=key;}
    if(!groups.has(key)){const c=clampRange(start,end,from,to);groups.set(key,{key,label,from:c.from,to:c.to,date:start});}
  }
  return [...groups.values()].sort((a,b)=>a.key.localeCompare(b.key));
}

export function analysisSeries(data,{athleteId,source='game',domain='pitching',metric,from,to,viewUnit='game',ownSide=null,oppSide=null}={}){
  const groups=groupDescriptors(data,{athleteId,source,domain,metric,from,to,viewUnit}),out=[];
  for(const g of groups){const snap=analysisSnapshot(data,{athleteId,source,domain,from:g.from,to:g.to,gameDayId:g.gameDayId||null,ownSide,oppSide}),value=analysisMetricValue(snap,metric);if(sourceHasData(snap,metric)&&value!==null&&Number.isFinite(Number(value)))out.push({...g,value:Number(value),snapshot:snap});}
  return out;
}

// Backward-compatible daily series API used by older screens/tests.
export function seriesByDate(data,{athleteId,from,to,metric,source='training',domain=null,batterSide=null,pitcherSide=null}){
  return analysisSeries(data,{athleteId,from,to,metric,source:source==='training'?'training':'game',domain:source==='training'?(domain||'all'):source,viewUnit:'day',ownSide:source==='pitching'?pitcherSide:(['hitting','batting'].includes(source)?batterSide:null),oppSide:source==='pitching'?batterSide:(['hitting','batting'].includes(source)?pitcherSide:null)}).map(x=>({date:x.from,value:x.value}));
}
