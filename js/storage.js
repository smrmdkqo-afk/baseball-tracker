export const DB_PREFIX='baseball-diary-v7:';
export const LEGACY_DB_NAME='baseball-tracker-v6';
export const DB_VERSION=1;
export const STORES=['athletes','gameDays','batterFaced','plateAppearances','gameEvents','trainingSets','meta'];
export const DATA_STORES=STORES.filter(name=>name!=='meta');

let dbPromise=null;
let activeOwnerId=null;
let activeDbName=null;

function requiredOwnerId(value){
  const ownerId=String(value||'').trim();
  if(!ownerId)throw new Error('로그인 계정이 확인되지 않았습니다.');
  return ownerId;
}

export function accountDBName(ownerId){return `${DB_PREFIX}${requiredOwnerId(ownerId)}`;}
export function getActiveOwnerId(){return activeOwnerId;}
export function uuid(){
  if(globalThis.crypto?.randomUUID)return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,c=>{const r=Math.random()*16|0,v=c==='x'?r:(r&3|8);return v.toString(16);});
}
export function iso(ts=Date.now()){return new Date(ts).toISOString();}
export function todayKey(d=new Date()){
  const y=d.getFullYear(),m=String(d.getMonth()+1).padStart(2,'0'),day=String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${day}`;
}
export function stamp(record,{dirty=true}={}){
  record.updatedAt=iso();
  record.clientUpdatedAt=Date.now();
  if(dirty)record.dirty=true;
  return record;
}

function openNamedDB(name,version=DB_VERSION){
  return new Promise((resolve,reject)=>{
    const req=indexedDB.open(name,version);
    req.onerror=()=>reject(req.error||new Error('로컬 데이터베이스를 열 수 없습니다.'));
    req.onblocked=()=>reject(new Error('다른 탭에서 로컬 데이터베이스를 사용 중입니다. 다른 야구일기 탭을 닫고 다시 시도하세요.'));
    req.onupgradeneeded=()=>{
      const db=req.result;
      for(const storeName of STORES){
        if(!db.objectStoreNames.contains(storeName))db.createObjectStore(storeName,{keyPath:storeName==='meta'?'key':'id'});
      }
    };
    req.onsuccess=()=>resolve(req.result);
  });
}

export async function configureAccountDB(ownerId){
  const uid=requiredOwnerId(ownerId);
  if(activeOwnerId===uid&&dbPromise)return openDB();
  await closeDB();
  activeOwnerId=uid;
  activeDbName=accountDBName(uid);
  const db=await openDB();
  await setMeta('accountOwnerId',uid);
  return db;
}

export function openDB(){
  if(!activeOwnerId||!activeDbName)return Promise.reject(new Error('로그인 후에만 기록 저장소를 열 수 있습니다.'));
  if(dbPromise)return dbPromise;
  const expectedName=activeDbName;
  dbPromise=openNamedDB(expectedName).then(db=>{
    db.onversionchange=()=>db.close();
    return db;
  }).catch(err=>{
    if(activeDbName===expectedName)dbPromise=null;
    throw err;
  });
  return dbPromise;
}

export async function closeDB(){
  const pending=dbPromise;
  dbPromise=null;
  activeOwnerId=null;
  activeDbName=null;
  if(!pending)return;
  try{const db=await pending;db.close();}catch{}
}

export async function deleteAccountDatabase(ownerId){
  const uid=requiredOwnerId(ownerId),name=accountDBName(uid);
  if(activeOwnerId===uid)await closeDB();
  return new Promise((resolve,reject)=>{
    const req=indexedDB.deleteDatabase(name);
    req.onsuccess=()=>resolve(true);
    req.onerror=()=>reject(req.error||new Error('이 기기의 계정 캐시를 삭제하지 못했습니다.'));
    req.onblocked=()=>reject(new Error('다른 탭에서 이 계정 기록을 사용 중입니다. 다른 야구일기 탭을 닫고 다시 시도하세요.'));
  });
}

async function tx(store,mode='readonly'){
  if(!STORES.includes(store))throw new Error(`알 수 없는 저장소: ${store}`);
  const db=await openDB();
  return db.transaction(store,mode).objectStore(store);
}
function reqPromise(req){return new Promise((resolve,reject)=>{req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});}
function assertOwnedRecord(store,obj){
  if(store==='meta')return;
  if(!activeOwnerId)throw new Error('로그인 계정 저장소가 열려 있지 않습니다.');
  if(obj?.ownerId!==activeOwnerId)throw new Error('현재 계정과 다른 소유자의 기록은 이 기기에 저장할 수 없습니다.');
}

export async function getAll(store){return reqPromise((await tx(store)).getAll());}
export async function getOne(store,id){return reqPromise((await tx(store)).get(id));}
export async function putOne(store,obj){assertOwnedRecord(store,obj);return reqPromise((await tx(store,'readwrite')).put(obj));}
export async function putMany(store,items){
  if(!items?.length)return;
  items.forEach(item=>assertOwnedRecord(store,item));
  const db=await openDB();
  return new Promise((resolve,reject)=>{
    const transaction=db.transaction(store,'readwrite'),objectStore=transaction.objectStore(store);
    items.forEach(item=>objectStore.put(item));
    transaction.oncomplete=()=>resolve();
    transaction.onerror=()=>reject(transaction.error);
    transaction.onabort=()=>reject(transaction.error);
  });
}
export async function deleteOne(store,id){return reqPromise((await tx(store,'readwrite')).delete(id));}
export async function clearStore(store){return reqPromise((await tx(store,'readwrite')).clear());}
export async function getMeta(key,def=null){const record=await getOne('meta',key);return record?.value??def;}
export async function setMeta(key,value){return putOne('meta',{key,value});}

function snapshotShape(value){
  const source=value?.data&&typeof value.data==='object'?value.data:(value||{}),out={};
  for(const storeName of DATA_STORES)out[storeName]=Array.isArray(source[storeName])?source[storeName]:[];
  out.meta=source.meta&&typeof source.meta==='object'&&!Array.isArray(source.meta)?source.meta:{};
  return out;
}

export async function snapshot({ownerId=activeOwnerId}={}){
  const uid=requiredOwnerId(ownerId);
  if(uid!==activeOwnerId)throw new Error('현재 로그인 계정의 기록만 백업할 수 있습니다.');
  const out={};
  for(const storeName of DATA_STORES)out[storeName]=(await getAll(storeName)).filter(record=>record.ownerId===uid);
  const activeAthleteId=await getMeta('activeAthleteId',null);
  out.meta={activeAthleteId};
  return out;
}

export function snapshotOwnerIds(value){
  const source=snapshotShape(value),ids=new Set();
  for(const storeName of DATA_STORES){
    for(const record of source[storeName])if(record?.ownerId)ids.add(String(record.ownerId));
  }
  return [...ids];
}

export function previewSnapshot(value){
  const source=snapshotShape(value),dates=[];
  for(const storeName of DATA_STORES){
    for(const record of source[storeName])if(/^\d{4}-\d{2}-\d{2}$/.test(record?.activityDate||''))dates.push(record.activityDate);
  }
  dates.sort();
  return {
    athletes:source.athletes.filter(record=>!record.deletedAt).length,
    gameDays:source.gameDays.filter(record=>!record.deletedAt).length,
    batterFaced:source.batterFaced.filter(record=>!record.deletedAt).length,
    plateAppearances:source.plateAppearances.filter(record=>!record.deletedAt).length,
    gameEvents:source.gameEvents.filter(record=>!record.deletedAt).length,
    trainingSets:source.trainingSets.filter(record=>!record.deletedAt).length,
    from:dates[0]||null,
    to:dates.at(-1)||null
  };
}

function claimedSnapshot(value,ownerId,{markDirty=true,touch=true}={}){
  const uid=requiredOwnerId(ownerId),source=snapshotShape(value),out={meta:{...source.meta}},base=Date.now();
  let sequence=0;
  for(const storeName of DATA_STORES){
    out[storeName]=source[storeName].filter(record=>record&&record.id).map(record=>{
      const copy=typeof structuredClone==='function'?structuredClone(record):JSON.parse(JSON.stringify(record));
      copy.ownerId=uid;
      if(markDirty)copy.dirty=true;
      if(touch){copy.clientUpdatedAt=Math.max(Number(copy.clientUpdatedAt||0),base)+sequence++;copy.updatedAt=iso();}
      return copy;
    });
  }
  return out;
}

function safeActiveAthleteId(source){
  const wanted=source.meta?.activeAthleteId;
  return source.athletes.some(record=>record.id===wanted&&!record.deletedAt)?wanted:source.athletes.find(record=>!record.deletedAt)?.id||null;
}

export async function replaceSnapshot(value,{ownerId=activeOwnerId,markDirty=true}={}){
  const uid=requiredOwnerId(ownerId);
  if(uid!==activeOwnerId)throw new Error('다른 계정의 로컬 저장소를 교체할 수 없습니다.');
  const source=claimedSnapshot(value,uid,{markDirty,touch:markDirty});
  const migrationState=await getMeta('legacyMigrationState',null);
  const db=await openDB();
  return new Promise((resolve,reject)=>{
    const transaction=db.transaction(STORES,'readwrite');
    for(const storeName of STORES)transaction.objectStore(storeName).clear();
    for(const storeName of DATA_STORES)source[storeName].forEach(record=>transaction.objectStore(storeName).put(record));
    const metaStore=transaction.objectStore('meta');
    metaStore.put({key:'accountOwnerId',value:uid});
    metaStore.put({key:'activeAthleteId',value:safeActiveAthleteId(source)});
    if(migrationState)metaStore.put({key:'legacyMigrationState',value:migrationState});
    transaction.oncomplete=()=>resolve();
    transaction.onerror=()=>reject(transaction.error);
    transaction.onabort=()=>reject(transaction.error);
  });
}

export async function mergeSnapshot(value,{ownerId=activeOwnerId,markDirty=true}={}){
  const uid=requiredOwnerId(ownerId);
  if(uid!==activeOwnerId)throw new Error('다른 계정의 로컬 저장소에 기록을 합칠 수 없습니다.');
  const source=claimedSnapshot(value,uid,{markDirty,touch:markDirty});
  const result={inserted:0,replaced:0,kept:0};
  for(const storeName of DATA_STORES){
    const current=await getAll(storeName),currentMap=new Map(current.map(record=>[record.id,record])),writes=[];
    for(const incoming of source[storeName]){
      const existing=currentMap.get(incoming.id);
      if(!existing){writes.push(incoming);result.inserted++;continue;}
      if(Number(incoming.clientUpdatedAt||0)>=Number(existing.clientUpdatedAt||0)){writes.push(incoming);result.replaced++;}
      else result.kept++;
    }
    await putMany(storeName,writes);
  }
  const currentActive=await getMeta('activeAthleteId',null);
  if(!currentActive&&source.athletes.length)await setMeta('activeAthleteId',safeActiveAthleteId(source));
  return result;
}

export async function ensureInitialData(ownerId=activeOwnerId){
  const uid=requiredOwnerId(ownerId);
  if(uid!==activeOwnerId)throw new Error('현재 로그인 계정이 바뀌었습니다.');
  let athletes=(await getAll('athletes')).filter(record=>record.ownerId===uid&&!record.deletedAt);
  if(!athletes.length){
    const athlete=stamp({id:uuid(),name:'선수 1',number:'',birthDate:'',team:'',position:'',throws:'R',bats:'R',deletedAt:null,ownerId:uid});
    await putOne('athletes',athlete);
    await setMeta('activeAthleteId',athlete.id);
    athletes=[athlete];
  }
  let activeAthleteId=await getMeta('activeAthleteId');
  if(!athletes.some(athlete=>athlete.id===activeAthleteId)){activeAthleteId=athletes[0].id;await setMeta('activeAthleteId',activeAthleteId);}
  return {athletes,activeAthleteId};
}

async function databaseExists(name){
  if(typeof indexedDB.databases!=='function')return null;
  try{return (await indexedDB.databases()).some(info=>info.name===name);}catch{return null;}
}

async function readExistingDatabase(name){
  const exists=await databaseExists(name);
  if(exists===false)return null;
  return new Promise((resolve,reject)=>{
    let created=false;
    const req=indexedDB.open(name);
    req.onupgradeneeded=()=>{created=true;req.transaction.abort();};
    req.onerror=()=>{
      if(created){indexedDB.deleteDatabase(name);resolve(null);}
      else reject(req.error||new Error('기존 로컬 기록을 읽지 못했습니다.'));
    };
    req.onsuccess=()=>{
      const db=req.result,available=STORES.filter(storeName=>db.objectStoreNames.contains(storeName));
      if(!available.length){db.close();resolve(null);return;}
      const transaction=db.transaction(available,'readonly'),out=Object.fromEntries(DATA_STORES.map(storeName=>[storeName,[]]));
      out.meta={};
      for(const storeName of available){
        const request=transaction.objectStore(storeName).getAll();
        request.onsuccess=()=>{
          if(storeName==='meta')out.meta=Object.fromEntries((request.result||[]).map(record=>[record.key,record.value]));
          else out[storeName]=request.result||[];
        };
      }
      transaction.oncomplete=()=>{db.close();resolve(out);};
      transaction.onerror=()=>{const error=transaction.error;db.close();reject(error);};
      transaction.onabort=()=>{const error=transaction.error;db.close();reject(error);};
    };
  });
}

function meaningfulSnapshot(value){
  const source=snapshotShape(value);
  if(DATA_STORES.filter(name=>name!=='athletes').some(name=>source[name].length>0))return true;
  return source.athletes.some(athlete=>{
    if(athlete.deletedAt)return false;
    return athlete.name!=='선수 1'||!!athlete.number||!!athlete.birthDate||!!athlete.team||!!athlete.position||!['R',''].includes(athlete.throws||'')||!['R',''].includes(athlete.bats||'');
  });
}

function legacyRowsForOwner(value,ownerId){
  const uid=requiredOwnerId(ownerId),source=snapshotShape(value),owners=snapshotOwnerIds(source),hasForeignOwner=owners.some(id=>id!==uid);
  const includeExplicitOrLinked=(record,linked)=>record?.ownerId===uid||(!record?.ownerId&&linked);
  const athletes=source.athletes.filter(record=>record?.ownerId===uid||(!record?.ownerId&&!hasForeignOwner)),athleteIds=new Set(athletes.map(record=>record.id));
  const gameDays=source.gameDays.filter(record=>athleteIds.has(record.athleteId)&&includeExplicitOrLinked(record,true)),gameDayIds=new Set(gameDays.map(record=>record.id));
  const batterFaced=source.batterFaced.filter(record=>athleteIds.has(record.athleteId)&&gameDayIds.has(record.gameDayId)&&includeExplicitOrLinked(record,true));
  const plateAppearances=source.plateAppearances.filter(record=>athleteIds.has(record.athleteId)&&gameDayIds.has(record.gameDayId)&&includeExplicitOrLinked(record,true));
  const gameEvents=source.gameEvents.filter(record=>{
    if(!athleteIds.has(record.athleteId)||!gameDayIds.has(record.gameDayId)||!includeExplicitOrLinked(record,true))return false;
    // V6.5 intentionally preserved orphan pitch rows. Keep them locally during
    // account migration as well; the V7 sync layer leaves invalid relations local-only.
    if(record.parentType==='batter_faced')return true;
    if(record.parentType==='plate_appearance')return true;
    return true;
  });
  const trainingSets=source.trainingSets.filter(record=>athleteIds.has(record.athleteId)&&includeExplicitOrLinked(record,true));
  const activeAthleteId=athleteIds.has(source.meta?.activeAthleteId)?source.meta.activeAthleteId:athletes.find(record=>!record.deletedAt)?.id||null;
  return {data:{athletes,gameDays,batterFaced,plateAppearances,gameEvents,trainingSets,meta:{activeAthleteId}},partial:hasForeignOwner,owners};
}

function convertV5LocalStorage(){
  const rawText=localStorage.getItem('baseballTrackerV1');
  if(!rawText)return null;
  let raw;
  try{raw=JSON.parse(rawText);}catch{return null;}
  if(Number(raw?.version||0)<5)return null;
  const out=Object.fromEntries(DATA_STORES.map(name=>[name,[]]));out.meta={activeAthleteId:raw.activeAthleteId||null};
  const legacyStamp=record=>stamp(record,{dirty:false});
  const oldAthletes=(raw.athletes||[]).filter(athlete=>!athlete.deletedAt);
  out.athletes=oldAthletes.map(athlete=>legacyStamp({
    id:athlete.id||uuid(),name:athlete.name||'선수',number:athlete.number||'',birthDate:athlete.birthDate||'',team:athlete.team||'',position:athlete.position||'',throws:athlete.throws||'R',bats:athlete.bats||'R',deletedAt:null,ownerId:null,legacySource:'v5-local-athlete'
  }));
  const athleteIds=new Set(out.athletes.map(athlete=>athlete.id)),fallback=out.athletes[0]?.id;
  const gameDateMap=new Map((raw.games||[]).map(game=>[game.id,game.date]));
  const trainingDateMap=new Map((raw.trainingSessions||[]).map(session=>[session.id,session.date]));
  const events=(raw.events||[]).filter(event=>!event.deletedAt).slice().sort((a,b)=>new Date(a.occurredAt)-new Date(b.occurredAt));
  const grouped=new Map(),dateOf=event=>event.metadata?.activityDate||gameDateMap.get(event.gameId)||trainingDateMap.get(event.trainingSessionId)||todayKey(new Date(event.occurredAt||Date.now()));
  for(const event of events){
    const athleteId=athleteIds.has(event.athleteId)?event.athleteId:fallback;if(!athleteId)continue;
    const date=dateOf(event),key=`${athleteId}:${date}`;
    if(!grouped.has(key))grouped.set(key,{athleteId,date,events:[]});
    grouped.get(key).events.push(event);
  }
  for(const group of grouped.values()){
    const hasGame=group.events.some(event=>!String(event.category||'').startsWith('training_'));
    const gameDay=hasGame?legacyStamp({id:uuid(),athleteId:group.athleteId,activityDate:group.date,ownerId:null,deletedAt:null,legacySource:`v5-local:${group.athleteId}:${group.date}:game`}):null;
    if(gameDay)out.gameDays.push(gameDay);
    let currentBF=null,balls=0,strikes=0,bfSequence=0,paSequence=0;
    const trainingAgg=new Map();
    for(const old of group.events){
      const category=old.category||'',type=old.eventType||'';
      if(category==='pitch'&&gameDay){
        if(!currentBF){currentBF=legacyStamp({id:uuid(),athleteId:group.athleteId,gameDayId:gameDay.id,sequenceNo:++bfSequence,pitcherSide:null,batterSide:null,result:null,completed:false,activityDate:group.date,ownerId:null,deletedAt:null,legacySource:`v5-local-bf:${old.id}`});out.batterFaced.push(currentBF);balls=0;strikes=0;}
        out.gameEvents.push(legacyStamp({id:uuid(),athleteId:group.athleteId,gameDayId:gameDay.id,domain:'pitching',parentType:'batter_faced',parentId:currentBF.id,eventType:type,activityDate:group.date,recordedAt:old.metadata?.recordedAt||old.occurredAt||iso(),metadata:{...(old.metadata||{}),legacy:true,tlu:1},ownerId:null,deletedAt:null,legacySource:`v5-local-event:${old.id}`}));
        if(type==='ball')balls++;if(['called','swinging','foul','inplay'].includes(type)&&!(type==='foul'&&strikes>=2))strikes++;
        let result=null;if(type==='hbp')result='HBP';else if(type==='inplay')result=old.metadata?.inplayResult||'IN_PLAY';else if(balls>=4)result='BB';else if(strikes>=3)result='K';
        if(result){currentBF.result=result;currentBF.completed=true;legacyStamp(currentBF);currentBF=null;balls=0;strikes=0;}
      }else if(gameDay&&['game_throw','game_event'].includes(category)&&['pickoff_normal','pickoff_error','game_warmup'].includes(type)){
        out.gameEvents.push(legacyStamp({id:uuid(),athleteId:group.athleteId,gameDayId:gameDay.id,domain:'pitching',parentType:null,parentId:null,eventType:type,activityDate:group.date,recordedAt:old.metadata?.recordedAt||old.occurredAt||iso(),metadata:{...(old.metadata||{}),legacy:true,tlu:type==='game_warmup'?1:.85},ownerId:null,deletedAt:null,legacySource:`v5-local-event:${old.id}`}));
      }else if(category==='batting'&&gameDay){
        out.plateAppearances.push(legacyStamp({id:uuid(),athleteId:group.athleteId,gameDayId:gameDay.id,sequenceNo:++paSequence,batterSide:null,pitcherSide:null,result:type,completed:true,activityDate:group.date,ownerId:null,deletedAt:null,legacySource:`v5-local-pa:${old.id}`}));
      }else if(gameDay&&['defense','baserunning'].includes(category)){
        out.gameEvents.push(legacyStamp({id:uuid(),athleteId:group.athleteId,gameDayId:gameDay.id,domain:category,parentType:null,parentId:null,eventType:type,activityDate:group.date,recordedAt:old.metadata?.recordedAt||old.occurredAt||iso(),metadata:{...(old.metadata||{}),legacy:true},ownerId:null,deletedAt:null,legacySource:`v5-local-event:${old.id}`}));
      }else if(String(category).startsWith('training_')){
        let domain='pitching',trainingType='throwing',side=null,unit='reps',tluPerRep=0;
        if(category==='training_throw'){domain='pitching';trainingType='throwing';unit='throws';tluPerRep={light:.75,moderate:.85,full:1}[type]||0;}
        else if(category==='training_hit'){domain='hitting';trainingType=old.metadata?.type||'other';unit='swings';}
        else if(category==='training_defense'){domain='defense';trainingType=old.metadata?.drill||'other';unit='reps';}
        else if(category==='training_baserunning'){domain='baserunning';trainingType=old.metadata?.drill||'other';unit='reps';}
        const key=[domain,trainingType,type,side,tluPerRep].join('|');
        if(!trainingAgg.has(key))trainingAgg.set(key,{domain,trainingType,side,unit,tluPerRep,quantity:0,metadata:{legacy:true,intensity:type}});
        trainingAgg.get(key).quantity++;
      }
    }
    for(const [key,item] of trainingAgg)out.trainingSets.push(legacyStamp({id:uuid(),athleteId:group.athleteId,activityDate:group.date,domain:item.domain,trainingType:item.trainingType,side:item.side,quantity:item.quantity,unit:item.unit,tluPerRep:item.tluPerRep,tluTotal:item.quantity*item.tluPerRep,metadata:item.metadata,recordedAt:iso(),ownerId:null,deletedAt:null,legacySource:`v5-local-training:${group.athleteId}:${group.date}:${key}`}));
  }
  return out;
}

export async function inspectLegacyData(ownerId=activeOwnerId){
  const uid=requiredOwnerId(ownerId);
  let source='indexeddb-v6',data=await readExistingDatabase(LEGACY_DB_NAME);
  if(!data||!meaningfulSnapshot(data)){source='localstorage-v5';data=convertV5LocalStorage();}
  if(!data||!meaningfulSnapshot(data))return {available:false,blocked:false,source:null,data:null,preview:null};
  const isolated=legacyRowsForOwner(data,uid),available=meaningfulSnapshot(isolated.data),blocked=!available&&isolated.partial;
  return {available,blocked,partial:available&&isolated.partial,source,data:available?isolated.data:null,preview:available?previewSnapshot(isolated.data):null};
}
