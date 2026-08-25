export const DEFENSE_VERSION=5;
export const DEFENSE_ACTION_TYPES=['field','receive','tag','base','throw','cover'];

const copy=value=>JSON.parse(JSON.stringify(value));
const valueOrNull=value=>value===undefined||value===''?null:value;
const numberOrNull=value=>value===null||value===undefined||value===''?null:(Number.isFinite(Number(value))?Number(value):null);
const enumOrNull=(value,allowed)=>allowed.includes(value)?value:null;
const textOrNull=(value,max=500)=>value===null||value===undefined||value===''?null:String(value).slice(0,max);
const actionId=(index,type)=>`def-${type}-${index+1}`;
const safeActionId=(value,index,type)=>/^[A-Za-z0-9_-]{1,80}$/.test(String(value||''))?String(value):actionId(index,type);
const normalizePosition=value=>enumOrNull(String(value||'').toUpperCase(),['P','C','1B','2B','3B','SS','LF','CF','RF'])||'SS';

export function newDefenseAction(type,id=null){
  const base={id:id||actionId(Date.now(),type),type,judgment:{rating:null,source:null,note:null}};
  if(type==='field')return {...base,battedBall:null,direction:null,speed:null,fieldingType:null,result:null,judgment:{...base.judgment,reaction:null,route:null}};
  if(type==='throw')return {...base,target:null,accuracy:null,tlu:.85,distance:null,velocity:null,judgment:{...base.judgment,bestChoice:null}};
  if(type==='receive')return {...base,target:null,sourcePosition:null,incoming:null,technique:null,result:null,baseHold:null,judgment:{...base.judgment,positioning:null,nextReady:null}};
  if(type==='tag')return {...base,targetRunner:null,execution:null,timing:null,call:null,judgment:{...base.judgment,bestChoice:null}};
  if(type==='base')return {...base,base:null,execution:null,timing:null,call:null,judgment:{...base.judgment,bestChoice:null}};
  return {...base,role:null,timing:null,result:null,judgment:{...base.judgment,communication:null}};
}

export function newDefenseDraft({position='SS',throwSide=null}={}){
  return {defenseVersion:DEFENSE_VERSION,position:normalizePosition(position),situation:{outs:null,runners:null},actions:[],flowEnded:false,outsRecorded:null,runnersAfter:null,official:{status:'missing',po:false,a:false,e:false,dp:false},note:null,throwSide:enumOrNull(throwSide,['R','L']),legacy:false,previousFormat:false};
}

function normalizeJudgment(raw={}){
  const judgment={
    rating:enumOrNull(raw.rating,['best','acceptable','wrong']),source:enumOrNull(raw.source,['self','coach','video']),note:textOrNull(raw.note,300),reaction:enumOrNull(raw.reaction,['good','normal','late','wrong']),route:enumOrNull(raw.route,['direct','adjusted','inefficient','na']),bestChoice:enumOrNull(raw.bestChoice,['hold','TAG','1B','2B','3B','HOME','RELAY']),positioning:enumOrNull(raw.positioning,['correct','late','wrong']),nextReady:enumOrNull(raw.nextReady,['ready','late','na']),communication:enumOrNull(raw.communication,['good','late','missed','na'])
  };
  return judgment.rating?judgment:{rating:null,source:null,note:null,reaction:null,route:null,bestChoice:null,positioning:null,nextReady:null,communication:null};
}

function normalizeAction(raw,index,sourceVersion=DEFENSE_VERSION){
  const source=raw&&typeof raw==='object'?raw:{},type=DEFENSE_ACTION_TYPES.includes(source.type)?source.type:'field',id=safeActionId(source.id,index,type),action={...newDefenseAction(type,id),judgment:normalizeJudgment(source.judgment||{})};
  if(type==='field'){
    action.battedBall=enumOrNull(source.battedBall,['GB','LD','FB','PU','BUNT']);action.direction=enumOrNull(source.direction,['L','C','R']);action.speed=enumOrNull(source.speed,['slow','medium','fast']);action.fieldingType=enumOrNull(source.fieldingType,['FRONT','FOREHAND','BACKHAND','CHARGE','FORWARD','STRAIGHT','LATERAL','BACK']);action.result=enumOrNull(source.result,['clean','recovered','failed']);
    if(sourceVersion<4){action.difficulty=enumOrNull(source.difficulty,['routine','normal','difficult']);action.reach=enumOrNull(source.reach,['easy','effort','not_reached']);if(action.reach==='not_reached'&&!action.result)action.result='failed';}
  }else if(type==='throw'){
    const legacyQuality=enumOrNull(source.quality,['accurate','catchable','uncatchable']),legacyMiss=enumOrNull(source.missDirection,['high','low','left','right','bounce']);
    action.target=enumOrNull(source.target,['1B','2B','3B','HOME','RELAY','OTHER']);action.accuracy=enumOrNull(source.accuracy,['accurate','high','low','left','right','bounce','uncatchable','catchable'])||(legacyQuality==='accurate'?'accurate':legacyQuality==='uncatchable'?'uncatchable':legacyQuality==='catchable'?(legacyMiss||'catchable'):null);action.tlu=[0,.75,.85,1].includes(Number(source.tlu))?Number(source.tlu):.85;action.distance=numberOrNull(source.distance);if(action.distance!==null&&action.distance<0)action.distance=null;action.velocity=numberOrNull(source.velocity);if(action.velocity!==null&&(action.velocity<0||action.velocity>200))action.velocity=null;if(sourceVersion<4)action.timing=enumOrNull(source.timing,['on_time','late','no_chance']);
  }else if(type==='receive'){
    action.target=enumOrNull(source.target,['1B','2B','3B','HOME','RELAY','OTHER']);action.sourcePosition=enumOrNull(source.sourcePosition,['P','C','1B','2B','3B','SS','LF','CF','RF','RELAY','OTHER']);action.incoming=enumOrNull(source.incoming,['on_target','high','low','left','right','wide','bounce','uncatchable']);action.result=enumOrNull(source.result,['clean','recovered','failed','excluded']);action.technique=enumOrNull(source.technique,['normal','stretch','scoop','tag','block','base_hold']);action.baseHold=enumOrNull(source.baseHold,['success','failed','na']);
    if(action.incoming==='uncatchable')action.result='excluded';
    else if(action.result==='excluded')action.result=null;
  }else if(type==='tag'){
    action.targetRunner=enumOrNull(source.targetRunner,['BR','R1','R2','R3','UNKNOWN']);action.execution=enumOrNull(source.execution,['clean','recovered','missed','dropped']);action.timing=enumOrNull(source.timing,['early','close','late','na']);action.call=enumOrNull(source.call,['out','safe','no_call']);
  }else if(type==='base'){
    action.base=enumOrNull(source.base,['1B','2B','3B','HOME']);action.execution=enumOrNull(source.execution,['secure','off_base','missed']);action.timing=enumOrNull(source.timing,['early','close','late','na']);action.call=enumOrNull(source.call,['out','safe','no_call']);if(sourceVersion<4)action.purpose=enumOrNull(source.purpose,['force','appeal','other']);
  }else{
    action.role=enumOrNull(source.role,['base_cover','backup','cutoff','communication']);action.timing=enumOrNull(source.timing,['on_time','late','missed']);action.result=enumOrNull(source.result,['correct','recovered','failed']);
  }
  return action;
}

function normalizeOfficial(raw){
  const status=['missing','none','entered'].includes(raw?.status)?raw.status:(raw&&(raw.po||raw.a||raw.e||raw.dp)?'entered':'missing');
  const flags={po:!!raw?.po,a:!!raw?.a,e:!!raw?.e,dp:!!raw?.dp},hasFlag=Object.values(flags).some(Boolean);
  return status==='entered'&&hasFlag?{status,...flags}:{status:status==='entered'?'none':status,po:false,a:false,e:false,dp:false};
}

function normalizeSituation(raw){
  const outs=numberOrNull(raw?.outs),runners=Array.isArray(raw?.runners)?[...new Set(raw.runners.filter(x=>['1B','2B','3B'].includes(x)))]:null;
  return {outs:[0,1,2].includes(outs)?outs:null,runners};
}

function legacyDraft(metadata={}){
  const actions=[],fieldMap={success:'clean',unstable:'recovered',failed:'failed'},throwMap={success:'catchable',error:'uncatchable'};
  actions.push(normalizeAction({id:'legacy-field-1',type:'field',battedBall:valueOrNull(metadata.battedBall),result:fieldMap[metadata.fieldingResult]||null,fieldingType:valueOrNull(metadata.fieldingType)},0,1));
  if(['success','error'].includes(metadata.throwResult))actions.push(normalizeAction({id:'legacy-throw-1',type:'throw',target:valueOrNull(metadata.throwTarget),quality:throwMap[metadata.throwResult]||null,tlu:Number(metadata.throwTLU??metadata.throwIntensity)||.85},1,1));
  return {defenseVersion:DEFENSE_VERSION,position:normalizePosition(metadata.position),situation:normalizeSituation(metadata.situation),actions,flowEnded:true,outsRecorded:null,runnersAfter:null,official:{status:'missing',po:false,a:false,e:false,dp:false},note:textOrNull(metadata.note),throwSide:enumOrNull(metadata.throwSide,['R','L']),legacy:true,previousFormat:true,legacyOutcome:null};
}

export function normalizeDefenseMetadata(metadata={}){
  if(!Array.isArray(metadata.actions)||Number(metadata.defenseVersion||0)<2)return legacyDraft(metadata);
  const sourceVersion=Number(metadata.defenseVersion||2),previousFormat=metadata.previousFormat===true||sourceVersion<4,seenIds=new Set(),actions=metadata.actions.map((raw,index)=>{const action=normalizeAction(raw,index,sourceVersion);let id=action.id,suffix=2;while(seenIds.has(id))id=`${actionId(index,action.type)}-${suffix++}`;action.id=id;seenIds.add(id);return action;});
  const legacyOutcome=enumOrNull(metadata.outcome,['out','safe','continue']),rawOuts=numberOrNull(metadata.outsRecorded),outsRecorded=[0,1,2,3].includes(rawOuts)?rawOuts:(previousFormat&&['safe','continue'].includes(legacyOutcome)?0:null),runnersAfter=Array.isArray(metadata.runnersAfter)?[...new Set(metadata.runnersAfter.filter(x=>['1B','2B','3B'].includes(x)))]:null;
  return {
    defenseVersion:DEFENSE_VERSION,position:normalizePosition(metadata.position),situation:normalizeSituation(metadata.situation),actions,flowEnded:metadata.flowEnded!==false,outsRecorded,runnersAfter,official:normalizeOfficial(metadata.official),note:textOrNull(metadata.note),throwSide:enumOrNull(metadata.throwSide,['R','L']),legacy:metadata.legacy===true,previousFormat,legacyOutcome
  };
}

export function serializeDefenseDraft(draft){
  const normalized=normalizeDefenseMetadata({...copy(draft),defenseVersion:DEFENSE_VERSION});
  normalized.legacy=false;
  normalized.actions=normalized.actions.map(action=>{
    const out=copy(action);delete out.difficulty;delete out.reach;delete out.quality;delete out.missDirection;delete out.timingLegacy;if(out.type==='field'&&!['GB','BUNT'].includes(out.battedBall))out.fieldingType=null;if(out.type==='throw')delete out.timing;if(out.type==='receive'&&out.incoming==='uncatchable')out.result='excluded';if(out.type==='base')delete out.purpose;return out;
  });
  delete normalized.previousFormat;delete normalized.legacyOutcome;
  return normalized;
}

export function defenseMissingFields(input){
  const draft=normalizeDefenseMetadata(input),missing=[];
  if(!draft.actions.length)missing.push({scope:'play',field:'actions',label:'수비 동작'});
  draft.actions.forEach((action,index)=>{
    const add=(field,label)=>{if(action[field]===null||action[field]===undefined||action[field]==='')missing.push({scope:'action',actionId:action.id,index,field,label:`${index+1}단계 ${label}`});};
    if(action.type==='field'){add('battedBall','타구');add('direction','타구 방향');add('speed','타구 속도');if(['GB','BUNT'].includes(action.battedBall))add('fieldingType','타구 처리 방법');add('result','처리 결과');}
    else if(action.type==='throw'){add('target','송구 목적지');add('accuracy','송구 정확도');}
    else if(action.type==='receive'){add('target','송구를 받은 위치');add('sourcePosition','송구를 보낸 위치');add('incoming','송구 형태');add('technique','송구 받기 방법');if(action.incoming!=='uncatchable')add('result','송구 받기 결과');}
    else if(action.type==='tag'){add('targetRunner','태그 대상');add('execution','태그 실행');add('timing','태그 타이밍');add('call','태그 판정');}
    else if(action.type==='base'){add('base','터치 베이스');add('execution','베이스 접촉');add('timing','베이스 타이밍');add('call','베이스 판정');}
    else {add('role','커버 역할');add('timing','도착 시점');add('result','커버 결과');}
  });
  if(!draft.flowEnded)missing.push({scope:'play',field:'flowEnded',label:'플레이 종료'});
  if(draft.flowEnded&&draft.outsRecorded===null)missing.push({scope:'play',field:'outsRecorded',label:'이번 플레이 아웃 수'});
  if(draft.flowEnded&&draft.runnersAfter===null)missing.push({scope:'play',field:'runnersAfter',label:'플레이 후 주자'});
  if(draft.flowEnded&&draft.official.status==='missing')missing.push({scope:'play',field:'official',label:'공식 기록'});
  return missing;
}

export function defenseActionLabel(type){return {field:'타구 처리',throw:'송구',receive:'송구 받기',tag:'주자 태그',base:'베이스 터치',cover:'커버·백업'}[type]||'수비 동작';}
export function defenseActionShortLabel(type){return {field:'처리',throw:'송구',receive:'수신',tag:'태그',base:'베이스',cover:'커버'}[type]||'수비';}

export function defenseActionStatus(action){
  if(!action)return {key:'missing',tone:'unstable',label:'결과 미입력'};
  if(action.type==='field'){
    return action.result==='clean'?{key:'success',tone:'success',label:'처리 성공'}:action.result==='recovered'?{key:'recovered',tone:'unstable',label:'처리 보완'}:action.result==='failed'?{key:'failed',tone:'failed',label:'처리 실패'}:{key:'missing',tone:'unstable',label:'처리 미입력'};
  }
  if(action.type==='throw')return action.accuracy==='accurate'?{key:'success',tone:'success',label:'송구 정확'}:['high','low','left','right','bounce','catchable'].includes(action.accuracy)?{key:'recovered',tone:'unstable',label:'송구 가능'}:action.accuracy==='uncatchable'?{key:'failed',tone:'failed',label:'송구 불가'}:{key:'missing',tone:'unstable',label:'송구 미입력'};
  if(action.type==='receive')return action.result==='clean'?{key:'success',tone:'success',label:'수신 성공'}:action.result==='recovered'?{key:'recovered',tone:'unstable',label:'수신 보완'}:action.result==='failed'?{key:'failed',tone:'failed',label:'수신 실패'}:action.result==='excluded'?{key:'excluded',tone:'none',label:'평가 제외'}:{key:'missing',tone:'unstable',label:'수신 미입력'};
  if(action.type==='tag'){
    if(!action.execution||!action.timing||!action.call)return {key:'missing',tone:'unstable',label:'태그 미입력'};
    if(action.execution==='missed')return {key:'failed',tone:'failed',label:'태그 빗나감'};if(action.execution==='dropped')return {key:'failed',tone:'failed',label:'태그 중 공 빠짐'};if(action.call==='no_call')return {key:'excluded',tone:'none',label:'태그 판정 없음'};if(action.call==='safe')return {key:'recovered',tone:'unstable',label:action.timing==='late'?'태그 늦음':'태그 세이프'};if(action.execution==='recovered'||action.timing==='late')return {key:'recovered',tone:'unstable',label:action.timing==='late'?'태그 늦음':'태그 보완'};return {key:'success',tone:'success',label:'태그 아웃'};
  }
  if(action.type==='base'){
    if(!action.base||!action.execution||!action.timing||!action.call)return {key:'missing',tone:'unstable',label:'베이스 미입력'};
    if(action.execution==='off_base')return {key:'failed',tone:'failed',label:'베이스 이탈'};if(action.execution==='missed')return {key:'failed',tone:'failed',label:'베이스 미접촉'};if(action.call==='no_call')return {key:'excluded',tone:'none',label:'베이스 판정 없음'};if(action.call==='safe')return {key:'recovered',tone:'unstable',label:action.timing==='late'?'베이스 늦음':'베이스 세이프'};if(action.timing==='late')return {key:'recovered',tone:'unstable',label:'베이스 늦음'};return {key:'success',tone:'success',label:'베이스 아웃'};
  }
  return action.result==='correct'?{key:'success',tone:'success',label:'커버 성공'}:action.result==='recovered'?{key:'recovered',tone:'unstable',label:'커버 보완'}:action.result==='failed'?{key:'failed',tone:'failed',label:'커버 실패'}:{key:'missing',tone:'unstable',label:'커버 미입력'};
}

export function defenseFlowWarnings(input){
  const draft=normalizeDefenseMetadata(input),warnings=[];let hasBall=false;
  draft.actions.forEach((action,index)=>{
    const needsBall=['throw','tag','base'].includes(action.type);if(index===0&&needsBall)hasBall=true;
    if(needsBall&&!hasBall)warnings.push({scope:'action',actionId:action.id,index,label:`${index+1}단계 ${defenseActionLabel(action.type)} 전에 공을 확보한 동작이 없습니다.`});
    if(action.type==='field')hasBall=action.result==='failed'?false:['clean','recovered'].includes(action.result)?true:null;
    else if(action.type==='receive')hasBall=['clean','recovered'].includes(action.result)?true:['failed','excluded'].includes(action.result)?false:null;
    else if(action.type==='tag')hasBall=action.execution==='dropped'?false:['clean','recovered','missed'].includes(action.execution)?true:null;
    else if(action.type==='throw')hasBall=false;
  });
  const directOuts=draft.actions.filter(action=>['tag','base'].includes(action.type)&&action.call==='out').length;
  if(directOuts&&draft.outsRecorded!==null&&directOuts>draft.outsRecorded)warnings.push({scope:'play',field:'outsRecorded',label:'직접 기록한 아웃보다 이번 플레이 아웃 수가 적습니다.'});
  return warnings;
}

export function defenseCardStatuses(input,limit=2){
  const draft=normalizeDefenseMetadata(input),all=draft.actions.map(defenseActionStatus),rank={failed:4,missing:3,recovered:2,excluded:1,success:0};
  const chosen=all.map((status,index)=>({status,index})).sort((a,b)=>(rank[b.status.key]??0)-(rank[a.status.key]??0)||a.index-b.index).slice(0,limit).sort((a,b)=>a.index-b.index).map(x=>x.status);
  return chosen.length?chosen:[{key:'missing',tone:'none',label:draft.legacy?'기존 형식':'수비 미입력'}];
}

export function defenseOverallTone(input){
  const draft=normalizeDefenseMetadata(input);if(draft.legacy||draft.previousFormat)return 'legacy';const statuses=draft.actions.map(defenseActionStatus);if(statuses.some(x=>x.key==='failed'))return 'failed';if(defenseMissingFields(draft).length||statuses.some(x=>['missing','recovered'].includes(x.key)))return 'unstable';return statuses.some(x=>x.key==='success')?'success':'none';
}

export function defenseThrowTLU(input){return Math.round(normalizeDefenseMetadata(input).actions.filter(x=>x.type==='throw').reduce((sum,x)=>sum+(Number(x.tlu)||0),0)*100)/100;}

export function defenseOfficialText(input){
  const official=normalizeDefenseMetadata(input).official;if(official.status==='missing')return '공식 기록 미입력';if(official.status==='none')return '공식 기록 없음';const values=[official.po?'PO':'',official.a?'A':'',official.e?'E':'',official.dp?'DP':''].filter(Boolean);return values.join(' + ')||'공식 기록 없음';
}

export function defenseOutcomeText(input){
  const draft=normalizeDefenseMetadata(input);if(draft.outsRecorded===null)return draft.previousFormat&&draft.legacyOutcome?`${{out:'아웃',safe:'세이프',continue:'플레이 계속'}[draft.legacyOutcome]} · 이전 형식`:'결과 미입력';const runners=draft.runnersAfter===null?'주자 미입력':draft.runnersAfter.length?draft.runnersAfter.map(x=>({'1B':'1루','2B':'2루','3B':'3루'}[x])).join('·'):'주자 없음';return `아웃 ${draft.outsRecorded}개 · ${runners}`;
}

export function defenseJudgmentSummary(input){
  const counts={best:0,acceptable:0,wrong:0,evaluated:0};for(const action of normalizeDefenseMetadata(input).actions){const rating=action.judgment?.rating;if(rating&&rating in counts){counts[rating]++;counts.evaluated++;}}
  counts.appropriate=counts.best+counts.acceptable;return counts;
}

export function defenseOfficialRecommendation(input){
  const draft=normalizeDefenseMetadata(input),directOut=draft.actions.some(action=>['tag','base'].includes(action.type)&&action.call==='out'),types=draft.actions.map(x=>x.type),outs=Number(draft.outsRecorded)||0,values=[];if(!outs&&!directOut)return '공식 기록 추천 없음';
  if(directOut||types.includes('field')&&!types.includes('throw'))values.push('PO');if(types.includes('throw')&&outs)values.push('A');if(outs>=2)values.push('DP');return values.length?`추천: ${[...new Set(values)].join(' + ')}`:'공식 기록 추천 없음';
}

export function defenseThrowQuality(action){const accuracy=action?.accuracy;return accuracy==='accurate'?'accurate':accuracy==='uncatchable'?'uncatchable':['high','low','left','right','bounce','catchable'].includes(accuracy)?'catchable':'missing';}
