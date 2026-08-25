export const DEFENSE_TRAINING_VERSION=1;
export const DEFENSE_TRAINING_MODES=['simple','scenario'];
export const DEFENSE_TRAINING_ACTION_TYPES=['field','receive','tag','base','throw','cover'];
export const DEFENSE_TRAINING_THROW_LOADS=[0,.75,.85,1];

const copy=value=>JSON.parse(JSON.stringify(value));
const enumOrNull=(value,allowed)=>allowed.includes(value)?value:null;
const textOrNull=(value,max=500)=>value===null||value===undefined||value===''?null:String(value).slice(0,max);
const numberOrNull=value=>value===null||value===undefined||value===''?null:(Number.isFinite(Number(value))?Number(value):null);
const nonNegative=value=>Math.max(0,Number(value)||0);
const integerOrNull=value=>{const number=numberOrNull(value);return number===null?null:Math.max(0,Math.round(number));};
const round2=value=>Math.round(nonNegative(value)*100)/100;
const normalizePosition=value=>enumOrNull(String(value||'').toUpperCase(),['P','C','1B','2B','3B','SS','LF','CF','RF'])||'SS';
const normalizeArea=value=>enumOrNull(String(value||'').toUpperCase(),['IF','OF'])||'IF';
const generatedId=(index,type)=>`dtr-${type}-${index+1}`;
const safeId=(value,index,type)=>/^[A-Za-z0-9_-]{1,80}$/.test(String(value||''))?String(value):generatedId(index,type);

export function defenseTrainingActionLabel(type){return {field:'타구 처리',receive:'송구 받기',tag:'주자 태그',base:'베이스 터치',throw:'송구',cover:'커버·백업'}[type]||'수비 동작';}
export function defenseTrainingActionShortLabel(type){return {field:'처리',receive:'수신',tag:'태그',base:'베이스',throw:'송구',cover:'커버'}[type]||'수비';}
export function defenseTrainingModeLabel(mode){return mode==='scenario'?'시나리오 기록':'간단 기록';}

export function newDefenseTrainingAction(type,id=null){
  const safeType=DEFENSE_TRAINING_ACTION_TYPES.includes(type)?type:'field',base={id:id||generatedId(Date.now(),safeType),type:safeType,countOverride:null};
  if(safeType==='field')return {...base,battedBall:null,difficulty:null,fieldingType:null,direction:null};
  if(safeType==='receive')return {...base,target:null,incoming:null,technique:null};
  if(safeType==='tag')return {...base,targetRunner:null,technique:null};
  if(safeType==='base')return {...base,base:null,purpose:null};
  if(safeType==='throw')return {...base,target:null,tlu:.75};
  return {...base,role:null};
}

export function newDefenseTrainingDraft({mode='simple',area='IF',position='SS',trainingType='FIELDING',quantity=10}={}){
  return {defenseTrainingVersion:DEFENSE_TRAINING_VERSION,trainingMode:DEFENSE_TRAINING_MODES.includes(mode)?mode:'simple',area:normalizeArea(area),position:normalizePosition(position),trainingType:textOrNull(trainingType,60)||'FIELDING',quantity:Math.max(0,Math.round(Number(quantity)||0)),simple:{throwCount:0,throwIntensity:.75,throwCountAuto:true},actions:[],outcomes:{target:null,adjust:null,failed:null},note:null,legacy:false};
}

function normalizeAction(raw,index){
  const source=raw&&typeof raw==='object'?raw:{},type=DEFENSE_TRAINING_ACTION_TYPES.includes(source.type)?source.type:'field',action={...newDefenseTrainingAction(type,safeId(source.id,index,type)),countOverride:integerOrNull(source.countOverride)};
  if(type==='field'){
    action.battedBall=enumOrNull(source.battedBall,['GB','LD','FB','PU','BUNT']);
    action.difficulty=enumOrNull(source.difficulty,['routine','normal','difficult']);
    action.fieldingType=enumOrNull(source.fieldingType,['FRONT','FOREHAND','BACKHAND','CHARGE','FORWARD','STRAIGHT','LATERAL','BACK']);
    action.direction=enumOrNull(source.direction,['L','C','R']);
  }else if(type==='receive'){
    action.target=enumOrNull(source.target,['1B','2B','3B','HOME','RELAY','OTHER']);
    action.incoming=enumOrNull(source.incoming,['on_target','high','low','wide','bounce','uncatchable']);
    action.technique=enumOrNull(source.technique,['normal','stretch','scoop','block','tag_ready','base_hold']);
  }else if(type==='tag'){
    action.targetRunner=enumOrNull(source.targetRunner,['BR','R1','R2','R3','UNKNOWN']);
    action.technique=enumOrNull(source.technique,['sweep','block','quick','other']);
  }else if(type==='base'){
    action.base=enumOrNull(source.base,['1B','2B','3B','HOME']);
    action.purpose=enumOrNull(source.purpose,['force','appeal','cover','other']);
  }else if(type==='throw'){
    action.target=enumOrNull(source.target,['1B','2B','3B','HOME','RELAY','OTHER']);
    action.tlu=DEFENSE_TRAINING_THROW_LOADS.includes(Number(source.tlu))?Number(source.tlu):.75;
  }else action.role=enumOrNull(source.role,['base_cover','backup','cutoff','communication']);
  return action;
}

export function normalizeDefenseTrainingOutcomes(raw={},quantity=0){
  const limit=Math.max(0,Math.round(Number(quantity)||0));let remaining=limit;
  const take=value=>{const number=integerOrNull(value);if(number===null)return null;const accepted=Math.min(number,remaining);remaining-=accepted;return accepted;};
  const target=take(raw?.target),adjust=take(raw?.adjust),failed=take(raw?.failed),evaluated=(target||0)+(adjust||0)+(failed||0);
  return {target,adjust,failed,evaluated,unassessed:Math.max(0,limit-evaluated),targetPct:evaluated?Number(target||0)/evaluated:null,adjustPct:evaluated?Number(adjust||0)/evaluated:null,failedPct:evaluated?Number(failed||0)/evaluated:null};
}

export function normalizeDefenseTrainingMetadata(metadata={},options={}){
  const source=metadata&&typeof metadata==='object'?metadata:{},quantity=Math.max(0,Math.round(Number(options.quantity??source.quantity)||0)),hasScenario=Number(source.defenseTrainingVersion||0)>=1&&source.trainingMode==='scenario'&&Array.isArray(source.actions),mode=hasScenario?'scenario':'simple';
  const draft=newDefenseTrainingDraft({mode,area:source.area,position:source.position||options.position,trainingType:options.trainingType||source.trainingType,quantity});
  draft.legacy=Number(source.defenseTrainingVersion||0)<1;
  draft.note=textOrNull(source.note);
  draft.outcomes=normalizeDefenseTrainingOutcomes(source.outcomes||{},quantity);
  if(mode==='scenario'){
    const seen=new Set();draft.actions=source.actions.map((raw,index)=>{const action=normalizeAction(raw,index);let id=action.id,suffix=2;while(seen.has(id))id=`${generatedId(index,action.type)}-${suffix++}`;action.id=id;seen.add(id);return action;});
  }else{
    const simpleSource=source.simple&&typeof source.simple==='object'?source.simple:source,throwCount=integerOrNull(simpleSource.throwCount)??0,rawLoad=Number(simpleSource.throwIntensity);
    draft.simple={throwCount,throwIntensity:DEFENSE_TRAINING_THROW_LOADS.includes(rawLoad)?rawLoad:.75,throwCountAuto:simpleSource.throwCountAuto===true};
  }
  return draft;
}

export function normalizeDefenseTrainingRecord(record={}){
  return normalizeDefenseTrainingMetadata(record.metadata||{},{quantity:record.quantity,trainingType:record.trainingType,position:record.position});
}

export function defenseTrainingActionCount(action,quantity){
  const override=integerOrNull(action?.countOverride);return override===null?Math.max(0,Math.round(Number(quantity)||0)):override;
}

export function defenseTrainingStats(input,quantity=null){
  const draft=input?.metadata?normalizeDefenseTrainingRecord(input):normalizeDefenseTrainingMetadata(input||{},{quantity:quantity??input?.quantity,trainingType:input?.trainingType});
  const reps=Math.max(0,Math.round(Number(quantity??draft.quantity)||0)),actionRepsByType={field:0,receive:0,tag:0,base:0,throw:0,cover:0},throwLoads={'0':0,'0.75':0,'0.85':0,'1':0};let actionReps=0,throwCount=0,throwTLU=0;
  if(draft.trainingMode==='scenario'){
    for(const action of draft.actions){const count=defenseTrainingActionCount(action,reps);actionReps+=count;actionRepsByType[action.type]=(actionRepsByType[action.type]||0)+count;if(action.type==='throw'){const load=DEFENSE_TRAINING_THROW_LOADS.includes(Number(action.tlu))?Number(action.tlu):.75;throwCount+=count;throwTLU+=count*load;throwLoads[String(load)]=(throwLoads[String(load)]||0)+count;}}
  }else{
    throwCount=Math.max(0,Math.round(Number(draft.simple.throwCount)||0));const load=DEFENSE_TRAINING_THROW_LOADS.includes(Number(draft.simple.throwIntensity))?Number(draft.simple.throwIntensity):.75;throwTLU=throwCount*load;throwLoads[String(load)]=(throwLoads[String(load)]||0)+throwCount;
  }
  const outcomes=normalizeDefenseTrainingOutcomes(draft.outcomes,reps);
  return {mode:draft.trainingMode,reps,actionReps,actionRepsByType,throwCount,throwTLU:round2(throwTLU),tluPerRep:reps?round2(throwTLU/reps):null,throwLoads,outcomes,actions:draft.actions,position:draft.position,area:draft.area,flow:draft.actions.map(action=>defenseTrainingActionShortLabel(action.type)).join(' → ')};
}

export function serializeDefenseTrainingDraft(input){
  const draft=normalizeDefenseTrainingMetadata(copy(input||{}),{quantity:input?.quantity,trainingType:input?.trainingType,position:input?.position}),stats=defenseTrainingStats(draft,draft.quantity),metadata={defenseTrainingVersion:DEFENSE_TRAINING_VERSION,trainingMode:draft.trainingMode,area:draft.area,outcomes:{target:draft.outcomes.target,adjust:draft.outcomes.adjust,failed:draft.outcomes.failed},note:draft.note,throwCount:stats.throwCount};
  if(draft.trainingMode==='scenario'){
    metadata.position=draft.position;
    metadata.actions=draft.actions.map(action=>copy(action));
  }else metadata.throwIntensity=draft.simple.throwIntensity;
  return metadata;
}

export function defenseTrainingOutcomeError(input,quantity=null){
  const raw=input?.outcomes||{},limit=Math.max(0,Math.round(Number(quantity??input?.quantity)||0)),values=['target','adjust','failed'].map(key=>integerOrNull(raw[key])||0);
  return values.reduce((sum,value)=>sum+value,0)>limit?'평가 결과 합계는 전체 reps를 넘을 수 없습니다.':null;
}
