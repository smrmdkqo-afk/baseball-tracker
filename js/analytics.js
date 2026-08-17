export const OFFICIAL_PITCH_TYPES=new Set(['ball','called','swinging','foul','inplay','hbp']);
export const STRIKE_PITCH_TYPES=new Set(['called','swinging','foul','inplay']);
export const GAME_TLU={ball:1,called:1,swinging:1,foul:1,inplay:1,hbp:1,pickoff_normal:.85,pickoff_error:.85,game_warmup:1};

export function active(list){return (list||[]).filter(x=>!x.deletedAt);}
export function round2(v){return Math.round((Number(v)||0)*100)/100;}
export function pct(n,d){return d? n/d : null;}
export function avg(arr){return arr.length?arr.reduce((a,b)=>a+b,0)/arr.length:null;}

export function inDateRange(date,from,to){return (!from||date>=from)&&(!to||date<=to);}
export function dateShift(base,delta){const d=new Date(`${base}T12:00:00`);d.setDate(d.getDate()+delta);return localDate(d);}
export function localDate(d=new Date()){const y=d.getFullYear(),m=String(d.getMonth()+1).padStart(2,'0'),day=String(d.getDate()).padStart(2,'0');return `${y}-${m}-${day}`;}

function parentMaps(data){return {
  bf:new Map(active(data.batterFaced).map(x=>[x.id,x])),
  pa:new Map(active(data.plateAppearances).map(x=>[x.id,x]))
};}

export function gamePitchingSummary(data,{athleteId,date=null,from=null,to=null,pitcherSide=null,batterSide=null}={}){
  const maps=parentMaps(data);
  const all=active(data.gameEvents).filter(e=>e.athleteId===athleteId&&e.domain==='pitching'&&(date?e.activityDate===date:inDateRange(e.activityDate,from,to)));
  const events=all.filter(e=>{
    if(e.parentType==='batter_faced'){
      const bf=maps.bf.get(e.parentId);if(!bf)return !pitcherSide&&!batterSide;
      if(pitcherSide&&bf.pitcherSide!==pitcherSide)return false;
      if(batterSide&&bf.batterSide!==batterSide)return false;
    } else if(pitcherSide||batterSide){
      // Side filters apply only to batter-facing pitches, not pickoffs/warmups.
      return false;
    }
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
  const gameTLU=events.reduce((sum,e)=>sum+(GAME_TLU[e.eventType]||Number(e.metadata?.tlu)||0),0);
  const bfList=active(data.batterFaced).filter(b=>b.athleteId===athleteId&&(date?b.activityDate===date:inDateRange(b.activityDate,from,to))&&(!pitcherSide||b.pitcherSide===pitcherSide)&&(!batterSide||b.batterSide===batterSide));
  const completed=bfList.filter(b=>b.completed);
  const k=completed.filter(b=>b.result==='K').length,bb=completed.filter(b=>b.result==='BB').length,bfHbp=completed.filter(b=>b.result==='HBP').length;
  const firstPitch=[];
  for(const bf of bfList){
    const ps=pitches.filter(e=>e.parentId===bf.id).sort((a,b)=>new Date(a.recordedAt)-new Date(b.recordedAt));
    if(ps[0])firstPitch.push(STRIKE_PITCH_TYPES.has(ps[0].eventType)?1:0);
  }
  const battedResults={OUT:0,'1B':0,'2B':0,'3B':0,HR:0,ROE:0,SH:0,SF:0};
  const battedTypes={GB:0,LD:0,FB:0};
  const directions={L:0,C:0,R:0};
  for(const e of inplay){const r=e.metadata?.result;if(r&&r in battedResults)battedResults[r]++;const bt=e.metadata?.battedBall;if(bt&&bt in battedTypes)battedTypes[bt]++;const dr=e.metadata?.direction;if(dr&&dr in directions)directions[dr]++;}
  return {
    officialPitches:pitches.length,totalGameThrows:pitches.length+pickoffs.length+pickoffErrors.length+warmups.length,gameTLU:round2(gameTLU),
    strikes:strikes.length,balls:balls.length,hbp:hbp.length,called:called.length,swinging:swinging.length,foul:foul.length,inplay:inplay.length,
    strikePct:pct(strikes.length,pitches.length),firstPitchStrikePct:firstPitch.length?avg(firstPitch):null,
    bf:completed.length,k,bb,bfHbp,pitchesPerBatter:pct(pitches.length,completed.length),pickoffs:pickoffs.length,pickoffErrors:pickoffErrors.length,warmups:warmups.length,
    battedResults,battedTypes,directions,events,pitches
  };
}

export function battingSummary(data,{athleteId,date=null,from=null,to=null,batterSide=null,pitcherSide=null}={}){
  const pas=active(data.plateAppearances).filter(p=>p.athleteId===athleteId&&(date?p.activityDate===date:inDateRange(p.activityDate,from,to))&&(!batterSide||p.batterSide===batterSide)&&(!pitcherSide||p.pitcherSide===pitcherSide));
  const completed=pas.filter(p=>p.completed&&p.result);
  const events=active(data.gameEvents).filter(e=>e.athleteId===athleteId&&e.domain==='batting'&&e.parentType==='plate_appearance'&&pas.some(p=>p.id===e.parentId));
  const counts={};for(const p of completed)counts[p.result]=(counts[p.result]||0)+1;
  const H=(counts['1B']||0)+(counts['2B']||0)+(counts['3B']||0)+(counts.HR||0);
  const BB=counts.BB||0,HBP=counts.HBP||0,SF=counts.SF||0,SH=counts.SH||0,SO=counts.SO||0,ROE=counts.ROE||0;
  const AB=completed.length-BB-HBP-SF-SH;
  const TB=(counts['1B']||0)+2*(counts['2B']||0)+3*(counts['3B']||0)+4*(counts.HR||0);
  const AVG=pct(H,AB),OBP=pct(H+BB+HBP,AB+BB+HBP+SF),SLG=pct(TB,AB),OPS=(OBP??0)+(SLG??0);
  const swingTypes=new Set(['swinging_strike','foul','in_play']);
  const swings=events.filter(e=>swingTypes.has(e.eventType));
  const whiffs=events.filter(e=>e.eventType==='swinging_strike');
  const contacts=events.filter(e=>['foul','in_play'].includes(e.eventType));
  const takenBalls=events.filter(e=>e.eventType==='taken_ball').length;
  const takenStrikes=events.filter(e=>e.eventType==='taken_strike').length;
  const battedTypes={GB:0,LD:0,FB:0},directions={L:0,C:0,R:0};
  for(const e of events.filter(e=>e.eventType==='in_play')){const bt=e.metadata?.battedBall;if(bt in battedTypes)battedTypes[bt]++;const dr=e.metadata?.direction;if(dr in directions)directions[dr]++;}
  return {PA:completed.length,AB,H,BB,HBP,SF,SH,SO,ROE,AVG,OBP,SLG,OPS,TB,counts,swings:swings.length,whiffs:whiffs.length,contacts:contacts.length,whiffPct:pct(whiffs.length,swings.length),contactPct:pct(contacts.length,swings.length),takenBalls,takenStrikes,events,pas,battedTypes,directions};
}

export function defenseSummary(data,{athleteId,date=null,from=null,to=null}={}){
  const events=active(data.gameEvents).filter(e=>e.athleteId===athleteId&&e.domain==='defense'&&(date?e.activityDate===date:inDateRange(e.activityDate,from,to))&&e.eventType==='fielding_play');
  const field={success:0,unstable:0,failed:0},throws={success:0,error:0,none:0},ifTypes={},ofTypes={},targets={},dp={opportunities:0,complete:0,one_out:0,failed:0};
  for(const e of events){const m=e.metadata||{};if(m.fieldingResult)field[m.fieldingResult]=(field[m.fieldingResult]||0)+1;if(m.throwResult)throws[m.throwResult]=(throws[m.throwResult]||0)+1;if(m.throwTarget)targets[m.throwTarget]=(targets[m.throwTarget]||0)+1;if(m.positionGroup==='IF'&&m.fieldingType)ifTypes[m.fieldingType]=(ifTypes[m.fieldingType]||0)+1;if(m.positionGroup==='OF'&&m.fieldingType)ofTypes[m.fieldingType]=(ofTypes[m.fieldingType]||0)+1;if(m.doublePlayOpportunity){dp.opportunities++;if(m.doublePlayResult)dp[m.doublePlayResult]=(dp[m.doublePlayResult]||0)+1;}}
  const fieldAttempts=field.success+field.unstable+field.failed,throwAttempts=throws.success+throws.error;
  return {plays:events.length,field,throws,ifTypes,ofTypes,targets,dp,fieldingSuccessPct:pct(field.success,fieldAttempts),throwSuccessPct:pct(throws.success,throwAttempts),events};
}

export function baserunningSummary(data,{athleteId,date=null,from=null,to=null}={}){
  const events=active(data.gameEvents).filter(e=>e.athleteId===athleteId&&e.domain==='baserunning'&&(date?e.activityDate===date:inDateRange(e.activityDate,from,to)));
  const steals=events.filter(e=>e.eventType==='steal_attempt');const advancements=events.filter(e=>e.eventType==='advancement');
  const sb=steals.filter(e=>e.metadata?.result==='SUCCESS').length,cs=steals.filter(e=>e.metadata?.result==='FAILED').length;
  return {sb,cs,attempts:sb+cs,sbPct:pct(sb,sb+cs),advancements:advancements.length,events};
}

export function trainingSummary(data,{athleteId,date=null,from=null,to=null,domain=null,side=null}={}){
  const sets=active(data.trainingSets).filter(s=>s.athleteId===athleteId&&(date?s.activityDate===date:inDateRange(s.activityDate,from,to))&&(!domain||s.domain===domain)&&(!side||s.side===side));
  const byDomain={pitching:{sets:0,volume:0,tlu:0},hitting:{sets:0,volume:0,tlu:0},defense:{sets:0,volume:0,tlu:0},baserunning:{sets:0,volume:0,tlu:0}};
  const byType={},bySide={R:0,L:0,N:0},byArea={IF:0,OF:0,N:0};let tlu=0;
  for(const s of sets){const d=byDomain[s.domain]||(byDomain[s.domain]={sets:0,volume:0,tlu:0});d.sets++;d.volume+=Number(s.quantity)||0;d.tlu+=Number(s.tluTotal)||0;tlu+=Number(s.tluTotal)||0;byType[s.trainingType]=(byType[s.trainingType]||0)+(Number(s.quantity)||0);bySide[s.side||'N']=(bySide[s.side||'N']||0)+(Number(s.quantity)||0);byArea[s.metadata?.area||'N']=(byArea[s.metadata?.area||'N']||0)+(Number(s.quantity)||0);}
  Object.values(byDomain).forEach(x=>x.tlu=round2(x.tlu));
  return {sets,byDomain,byType,bySide,byArea,tlu:round2(tlu)};
}


export function workloadSummary(data,{athleteId,date=null,from=null,to=null}={}){
  const gp=gamePitchingSummary(data,{athleteId,date,from,to});
  const allSets=active(data.trainingSets).filter(s=>s.athleteId===athleteId&&(date?s.activityDate===date:inDateRange(s.activityDate,from,to)));
  const pitchingTraining=allSets.filter(s=>s.domain==='pitching').reduce((a,s)=>a+Number(s.tluTotal||0),0);
  const defenseThrowing=allSets.filter(s=>s.domain==='defense').reduce((a,s)=>a+Number(s.tluTotal||0),0);
  const officialPitchTLU=gp.officialPitches;
  const pickoffTLU=round2((gp.pickoffs+gp.pickoffErrors)*0.85);
  const warmupTLU=gp.warmups;
  return {officialPitchTLU,pickoffTLU,warmupTLU,pitchingTraining:round2(pitchingTraining),defenseThrowing:round2(defenseThrowing),total:round2(officialPitchTLU+pickoffTLU+warmupTLU+pitchingTraining+defenseThrowing)};
}

export function totalTLU(data,opts={}){return workloadSummary(data,opts).total;}

export function todaySummary(data,{athleteId,date}){
  const p=gamePitchingSummary(data,{athleteId,date}),h=battingSummary(data,{athleteId,date}),d=defenseSummary(data,{athleteId,date}),b=baserunningSummary(data,{athleteId,date}),t=trainingSummary(data,{athleteId,date});
  return {date,totalTLU:round2(p.gameTLU+t.tlu),game:{pitching:p,hitting:h,defense:d,baserunning:b},training:t};
}

export function seriesByDate(data,{athleteId,from,to,metric,source='training',domain=null,batterSide=null,pitcherSide=null}){
  const out=[];let cur=from;while(cur<=to){let value=0;
    if(source==='training'){
      const s=trainingSummary(data,{athleteId,date:cur,domain});
      if(metric==='total_tlu')value=workloadSummary(data,{athleteId,date:cur}).total;else if(metric==='tlu')value=s.tlu;else if(metric==='volume')value=domain?s.byDomain[domain]?.volume||0:Object.values(s.byDomain).reduce((a,x)=>a+x.volume,0);else value=s.byType[metric]||0;
    } else if(source==='pitching'){
      const p=gamePitchingSummary(data,{athleteId,date:cur,pitcherSide,batterSide});
      value=metric==='strikePct'?(p.strikePct??0)*100:metric==='firstPitchStrikePct'?(p.firstPitchStrikePct??0)*100:metric==='gameTLU'?p.gameTLU:metric==='officialPitches'?p.officialPitches:metric==='k'?p.k:metric==='bb'?p.bb:0;
    } else if(source==='batting'){
      const h=battingSummary(data,{athleteId,date:cur,batterSide,pitcherSide});
      value=metric==='AVG'?(h.AVG??0)*1000:metric==='OBP'?(h.OBP??0)*1000:metric==='OPS'?(h.OPS??0)*1000:metric==='PA'?h.PA:metric==='swings'?h.swings:0;
    } else if(source==='defense'){const d=defenseSummary(data,{athleteId,date:cur});value=['fieldingSuccessPct','throwSuccessPct'].includes(metric)?(d[metric]??0)*100:(d[metric]||0);}
    else if(source==='baserunning'){const b=baserunningSummary(data,{athleteId,date:cur});value=metric==='sbPct'?(b.sbPct??0)*100:(b[metric]||0);}
    out.push({date:cur,value:Number(value)||0});cur=dateShift(cur,1);
  }return out;
}
