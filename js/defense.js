export const DEFENSE_VERSION=2;
export const DEFENSE_ACTION_TYPES=['field','receive','throw','cover'];

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
  if(type==='field')return {...base,battedBall:null,difficulty:null,reach:null,result:null,fieldingType:null,direction:null,judgment:{...base.judgment,reaction:null,route:null}};
  if(type==='throw')return {...base,target:null,quality:null,missDirection:null,timing:null,tlu:.85,distance:null,velocity:null,judgment:{...base.judgment,bestChoice:null}};
  if(type==='receive')return {...base,target:null,incoming:null,result:null,technique:null,judgment:{...base.judgment,positioning:null,nextReady:null}};
  return {...base,role:null,timing:null,result:null,judgment:{...base.judgment,communication:null}};
}

export function newDefenseDraft({position='SS',throwSide=null}={}){
  return {defenseVersion:DEFENSE_VERSION,position:normalizePosition(position),actions:[],flowEnded:false,outcome:null,outMethod:null,outsRecorded:null,official:{status:'missing',po:false,a:false,e:false,dp:false},situation:{outs:null,runners:[]},note:null,throwSide:enumOrNull(throwSide,['R','L']),legacy:false};
}

function normalizeJudgment(raw={}){
  const judgment={
    rating:enumOrNull(raw.rating,['best','acceptable','wrong']),source:enumOrNull(raw.source,['self','coach','video']),note:textOrNull(raw.note,300),reaction:enumOrNull(raw.reaction,['good','normal','late','wrong']),route:enumOrNull(raw.route,['direct','adjusted','inefficient','na']),bestChoice:enumOrNull(raw.bestChoice,['hold','1B','2B','3B','HOME','RELAY']),positioning:enumOrNull(raw.positioning,['correct','late','wrong']),nextReady:enumOrNull(raw.nextReady,['ready','late','na']),communication:enumOrNull(raw.communication,['good','late','missed','na'])
  };
  return judgment.rating?judgment:{rating:null,source:null,note:null,reaction:null,route:null,bestChoice:null,positioning:null,nextReady:null,communication:null};
}

function normalizeAction(raw,index){
  const source=raw&&typeof raw==='object'?raw:{},type=DEFENSE_ACTION_TYPES.includes(source.type)?source.type:'field',id=safeActionId(source.id,index,type),action={...newDefenseAction(type,id),judgment:normalizeJudgment(source.judgment||{})};
  if(type==='field'){
    action.battedBall=enumOrNull(source.battedBall,['GB','LD','FB','PU','BUNT']);action.difficulty=enumOrNull(source.difficulty,['routine','normal','difficult']);action.reach=enumOrNull(source.reach,['easy','effort','not_reached']);action.result=enumOrNull(source.result,['clean','recovered','failed']);action.fieldingType=enumOrNull(source.fieldingType,['FRONT','FOREHAND','BACKHAND','CHARGE','FORWARD','STRAIGHT','LATERAL','BACK']);action.direction=enumOrNull(source.direction,['L','C','R']);if(action.reach==='not_reached')action.result=null;
  }else if(type==='throw'){
    action.target=enumOrNull(source.target,['1B','2B','3B','HOME','RELAY','OTHER']);action.quality=enumOrNull(source.quality,['accurate','catchable','uncatchable']);action.missDirection=enumOrNull(source.missDirection,['high','low','left','right','bounce']);action.timing=enumOrNull(source.timing,['on_time','late','no_chance']);action.tlu=[.75,.85,1].includes(Number(source.tlu))?Number(source.tlu):.85;action.distance=numberOrNull(source.distance);if(action.distance!==null&&action.distance<0)action.distance=null;action.velocity=numberOrNull(source.velocity);if(action.velocity!==null&&(action.velocity<0||action.velocity>200))action.velocity=null;if(action.quality==='accurate')action.missDirection=null;
  }else if(type==='receive'){
    action.target=enumOrNull(source.target,['1B','2B','3B','HOME','RELAY','OTHER']);action.incoming=enumOrNull(source.incoming,['on_target','high','low','wide','bounce','uncatchable']);action.result=enumOrNull(source.result,['clean','recovered','failed','excluded']);action.technique=enumOrNull(source.technique,['normal','stretch','scoop','tag','block','base_hold']);
    if(action.incoming==='uncatchable')action.result='excluded';
    else if(action.result==='excluded')action.result=null;
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

function legacyDraft(metadata={}){
  const actions=[],fieldMap={success:'clean',unstable:'recovered',failed:'failed'},throwMap={success:'catchable',error:'uncatchable'};
  actions.push(normalizeAction({id:'legacy-field-1',type:'field',battedBall:valueOrNull(metadata.battedBall),result:fieldMap[metadata.fieldingResult]||null,fieldingType:valueOrNull(metadata.fieldingType)},0));
  if(['success','error'].includes(metadata.throwResult))actions.push(normalizeAction({id:'legacy-throw-1',type:'throw',target:valueOrNull(metadata.throwTarget),quality:throwMap[metadata.throwResult]||null,tlu:Number(metadata.throwTLU??metadata.throwIntensity)||.85},1));
  return {defenseVersion:DEFENSE_VERSION,position:normalizePosition(metadata.position),actions,flowEnded:true,outcome:null,outMethod:null,outsRecorded:null,official:{status:'missing',po:false,a:false,e:false,dp:false},situation:{outs:null,runners:[]},note:textOrNull(metadata.note),throwSide:enumOrNull(metadata.throwSide,['R','L']),legacy:true};
}

export function normalizeDefenseMetadata(metadata={}){
  if(!Array.isArray(metadata.actions)||Number(metadata.defenseVersion||0)<DEFENSE_VERSION)return legacyDraft(metadata);
  const runners=Array.isArray(metadata.situation?.runners)?metadata.situation.runners.filter(x=>['1B','2B','3B'].includes(x)):[];
  const seenIds=new Set(),actions=metadata.actions.map((raw,index)=>{const action=normalizeAction(raw,index);let id=action.id,suffix=2;while(seenIds.has(id))id=`${actionId(index,action.type)}-${suffix++}`;action.id=id;seenIds.add(id);return action;});
  const outcome=enumOrNull(metadata.outcome,['out','safe','continue']),outsRecorded=numberOrNull(metadata.outsRecorded),situationOuts=numberOrNull(metadata.situation?.outs);
  return {
    defenseVersion:DEFENSE_VERSION,position:normalizePosition(metadata.position),actions,flowEnded:metadata.flowEnded!==false,outcome,outMethod:outcome==='out'?enumOrNull(metadata.outMethod,['catch','tag','base','throw']):null,outsRecorded:outcome==='out'&&[1,2,3].includes(outsRecorded)?outsRecorded:null,official:normalizeOfficial(metadata.official),situation:{outs:[0,1,2].includes(situationOuts)?situationOuts:null,runners:[...new Set(runners)]},note:textOrNull(metadata.note),throwSide:enumOrNull(metadata.throwSide,['R','L']),legacy:false
  };
}

export function serializeDefenseDraft(draft){
  const normalized=normalizeDefenseMetadata({...copy(draft),defenseVersion:DEFENSE_VERSION});
  normalized.legacy=false;
  normalized.actions=normalized.actions.map(action=>{
    const out=copy(action);if(out.type==='field'&&out.reach==='not_reached')out.result=null;if(out.type==='throw'&&out.quality==='accurate')out.missDirection=null;if(out.type==='receive'&&out.incoming==='uncatchable')out.result='excluded';return out;
  });
  return normalized;
}

export function defenseMissingFields(input){
  const draft=normalizeDefenseMetadata(input),missing=[];
  if(!draft.actions.length)missing.push({scope:'play',field:'actions',label:'수비 동작'});
  draft.actions.forEach((action,index)=>{
    const add=(field,label)=>{if(action[field]===null||action[field]===undefined||action[field]==='')missing.push({scope:'action',actionId:action.id,index,field,label:`${index+1}단계 ${label}`});};
    if(action.type==='field'){add('battedBall','타구');add('difficulty','난도');add('reach','도달');if(action.reach!=='not_reached')add('result','처리 결과');}
    else if(action.type==='throw'){add('target','송구 목적지');add('quality','송구 품질');add('timing','송구 타이밍');}
    else if(action.type==='receive'){add('target','수신 위치');add('incoming','들어온 송구');if(action.incoming!=='uncatchable')add('result','수신 결과');}
    else {add('role','커버 역할');add('timing','도착 시점');add('result','커버 결과');}
  });
  if(!draft.flowEnded)missing.push({scope:'play',field:'flowEnded',label:'플레이 종료'});
  if(draft.flowEnded&&!draft.outcome)missing.push({scope:'play',field:'outcome',label:'플레이 결과'});
  if(draft.outcome==='out'){if(!draft.outMethod)missing.push({scope:'play',field:'outMethod',label:'아웃 방식'});if(!draft.outsRecorded)missing.push({scope:'play',field:'outsRecorded',label:'아웃 수'});}
  return missing;
}

export function defenseActionLabel(type){return {field:'타구 처리',throw:'송구',receive:'송구 받기',cover:'커버·백업'}[type]||'수비 동작';}
export function defenseActionShortLabel(type){return {field:'처리',throw:'송구',receive:'수신',cover:'커버'}[type]||'수비';}

export function defenseActionStatus(action){
  if(!action)return {key:'missing',tone:'unstable',label:'결과 미입력'};
  if(action.type==='field'){
    if(action.reach==='not_reached')return {key:'failed',tone:'failed',label:'처리 미도달'};
    return action.result==='clean'?{key:'success',tone:'success',label:'처리 성공'}:action.result==='recovered'?{key:'recovered',tone:'unstable',label:'처리 보완'}:action.result==='failed'?{key:'failed',tone:'failed',label:'처리 실패'}:{key:'missing',tone:'unstable',label:'처리 미입력'};
  }
  if(action.type==='throw')return action.quality==='accurate'?{key:'success',tone:'success',label:'송구 정확'}:action.quality==='catchable'?{key:'recovered',tone:'unstable',label:'송구 가능'}:action.quality==='uncatchable'?{key:'failed',tone:'failed',label:'송구 불가'}:{key:'missing',tone:'unstable',label:'송구 미입력'};
  if(action.type==='receive')return action.result==='clean'?{key:'success',tone:'success',label:'수신 성공'}:action.result==='recovered'?{key:'recovered',tone:'unstable',label:'수신 보완'}:action.result==='failed'?{key:'failed',tone:'failed',label:'수신 실패'}:action.result==='excluded'?{key:'excluded',tone:'none',label:'평가 제외'}:{key:'missing',tone:'unstable',label:'수신 미입력'};
  return action.result==='correct'?{key:'success',tone:'success',label:'커버 성공'}:action.result==='recovered'?{key:'recovered',tone:'unstable',label:'커버 보완'}:action.result==='failed'?{key:'failed',tone:'failed',label:'커버 실패'}:{key:'missing',tone:'unstable',label:'커버 미입력'};
}

export function defenseCardStatuses(input,limit=2){
  const draft=normalizeDefenseMetadata(input),all=draft.actions.map(defenseActionStatus),rank={failed:4,missing:3,recovered:2,excluded:1,success:0};
  const chosen=all.map((status,index)=>({status,index})).sort((a,b)=>(rank[b.status.key]??0)-(rank[a.status.key]??0)||a.index-b.index).slice(0,limit).sort((a,b)=>a.index-b.index).map(x=>x.status);
  return chosen.length?chosen:[{key:'missing',tone:'none',label:draft.legacy?'기존 형식':'수비 미입력'}];
}

export function defenseOverallTone(input){
  const draft=normalizeDefenseMetadata(input);if(draft.legacy)return 'legacy';const statuses=draft.actions.map(defenseActionStatus);if(statuses.some(x=>x.key==='failed'))return 'failed';if(defenseMissingFields(draft).length||statuses.some(x=>['missing','recovered'].includes(x.key)))return 'unstable';return statuses.some(x=>x.key==='success')?'success':'none';
}

export function defenseThrowTLU(input){return Math.round(normalizeDefenseMetadata(input).actions.filter(x=>x.type==='throw').reduce((sum,x)=>sum+(Number(x.tlu)||0),0)*100)/100;}

export function defenseOfficialText(input){
  const official=normalizeDefenseMetadata(input).official;if(official.status==='missing')return '공식 기록 미입력';if(official.status==='none')return '공식 기록 없음';const values=[official.po?'PO':'',official.a?'A':'',official.e?'E':'',official.dp?'DP':''].filter(Boolean);return values.join(' + ')||'공식 기록 없음';
}

export function defenseOutcomeText(input){
  const draft=normalizeDefenseMetadata(input);return {out:'아웃',safe:'세이프',continue:'플레이 계속'}[draft.outcome]||'결과 미입력';
}

export function defenseJudgmentSummary(input){
  const counts={best:0,acceptable:0,wrong:0,evaluated:0};for(const action of normalizeDefenseMetadata(input).actions){const rating=action.judgment?.rating;if(rating&&rating in counts){counts[rating]++;counts.evaluated++;}}
  counts.appropriate=counts.best+counts.acceptable;return counts;
}

export function defenseOfficialRecommendation(input){
  const draft=normalizeDefenseMetadata(input);if(draft.outcome!=='out')return '공식 기록 추천 없음';const types=draft.actions.map(x=>x.type),outs=Number(draft.outsRecorded)||1,values=[];
  if(types.includes('receive')||types.includes('field')&&['catch','tag','base'].includes(draft.outMethod))values.push('PO');if(types.includes('throw'))values.push('A');if(outs>=2)values.push('DP');return values.length?`추천: ${[...new Set(values)].join(' + ')}`:'공식 기록 추천 없음';
}
