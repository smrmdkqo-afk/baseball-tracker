export const DB_NAME='baseball-tracker-v6';
export const DB_VERSION=1;
export const STORES=['athletes','gameDays','batterFaced','plateAppearances','gameEvents','trainingSets','meta'];

let dbPromise=null;

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

export function openDB(){
  if(dbPromise)return dbPromise;
  dbPromise=new Promise((resolve,reject)=>{
    const req=indexedDB.open(DB_NAME,DB_VERSION);
    req.onerror=()=>reject(req.error);
    req.onupgradeneeded=()=>{
      const db=req.result;
      for(const name of STORES){
        if(!db.objectStoreNames.contains(name))db.createObjectStore(name,{keyPath:name==='meta'?'key':'id'});
      }
    };
    req.onsuccess=()=>resolve(req.result);
  });
  return dbPromise;
}

async function tx(store,mode='readonly'){
  const db=await openDB();
  return db.transaction(store,mode).objectStore(store);
}
function reqPromise(req){return new Promise((resolve,reject)=>{req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});}

export async function getAll(store){return reqPromise((await tx(store)).getAll());}
export async function getOne(store,id){return reqPromise((await tx(store)).get(id));}
export async function putOne(store,obj){return reqPromise((await tx(store,'readwrite')).put(obj));}
export async function putMany(store,items){
  if(!items?.length)return;
  const db=await openDB();
  return new Promise((resolve,reject)=>{
    const t=db.transaction(store,'readwrite');const s=t.objectStore(store);
    items.forEach(x=>s.put(x));t.oncomplete=()=>resolve();t.onerror=()=>reject(t.error);t.onabort=()=>reject(t.error);
  });
}
export async function deleteOne(store,id){return reqPromise((await tx(store,'readwrite')).delete(id));}
export async function clearStore(store){return reqPromise((await tx(store,'readwrite')).clear());}
export async function getMeta(key,def=null){const x=await getOne('meta',key);return x?.value??def;}
export async function setMeta(key,value){return putOne('meta',{key,value});}

export async function snapshot(){
  const out={};
  for(const s of STORES.filter(s=>s!=='meta'))out[s]=await getAll(s);
  out.meta=Object.fromEntries((await getAll('meta')).map(x=>[x.key,x.value]));
  return out;
}

export async function replaceSnapshot(data){
  const db=await openDB();
  const stores=STORES;
  return new Promise((resolve,reject)=>{
    const t=db.transaction(stores,'readwrite');
    for(const name of stores)t.objectStore(name).clear();
    for(const name of stores.filter(x=>x!=='meta'))(data[name]||[]).forEach(x=>t.objectStore(name).put(x));
    Object.entries(data.meta||{}).forEach(([key,value])=>t.objectStore('meta').put({key,value}));
    t.oncomplete=()=>resolve();t.onerror=()=>reject(t.error);t.onabort=()=>reject(t.error);
  });
}

export async function ensureInitialData(){
  let athletes=(await getAll('athletes')).filter(x=>!x.deletedAt);
  if(!athletes.length){
    const a=stamp({id:uuid(),name:'선수 1',number:'',birthDate:'',team:'',position:'',throws:'R',bats:'R',deletedAt:null,ownerId:null});
    await putOne('athletes',a);await setMeta('activeAthleteId',a.id);athletes=[a];
  }
  let active=await getMeta('activeAthleteId');
  if(!athletes.some(a=>a.id===active)){active=athletes[0].id;await setMeta('activeAthleteId',active);}
  return {athletes,activeAthleteId:active};
}

// V5 localStorage -> V6 IndexedDB. Old data remains untouched for rollback.
export async function migrateV5LocalIfNeeded(){
  if(await getMeta('v5LocalMigrated',false))return {migrated:false};
  const rawText=localStorage.getItem('baseballTrackerV1');
  if(!rawText){await setMeta('v5LocalMigrated',true);return {migrated:false};}
  let raw;try{raw=JSON.parse(rawText);}catch{await setMeta('v5LocalMigrated',true);return {migrated:false};}
  if(Number(raw?.version||0)<5){return {migrated:false,reason:'legacy-before-v5'};}

  const oldAthletes=(raw.athletes||[]).filter(a=>!a.deletedAt);
  const existing=await getAll('athletes');
  if(existing.length===0&&oldAthletes.length){
    await putMany('athletes',oldAthletes.map(a=>stamp({
      id:a.id||uuid(),name:a.name||'선수',number:a.number||'',birthDate:a.birthDate||'',team:a.team||'',position:a.position||'',throws:a.throws||'R',bats:a.bats||'R',deletedAt:null,ownerId:null,legacySource:'v5-local-athlete'
    })));
  }
  const athletes=await getAll('athletes');
  const athleteIds=new Set(athletes.map(a=>a.id));
  const fallback=athletes[0]?.id;
  const gameDateMap=new Map((raw.games||[]).map(g=>[g.id,g.date]));
  const trainingDateMap=new Map((raw.trainingSessions||[]).map(t=>[t.id,t.date]));
  const events=(raw.events||[]).filter(e=>!e.deletedAt).slice().sort((a,b)=>new Date(a.occurredAt)-new Date(b.occurredAt));
  const byAthleteDate=new Map();
  const dateOf=e=>e.metadata?.activityDate||gameDateMap.get(e.gameId)||trainingDateMap.get(e.trainingSessionId)||todayKey(new Date(e.occurredAt||Date.now()));
  for(const e of events){
    const athleteId=athleteIds.has(e.athleteId)?e.athleteId:fallback;if(!athleteId)continue;
    const date=dateOf(e);const key=`${athleteId}:${date}`;
    if(!byAthleteDate.has(key))byAthleteDate.set(key,{athleteId,date,events:[]});
    byAthleteDate.get(key).events.push(e);
  }

  const gameDays=[],bfs=[],pas=[],gameEvents=[],trainingSets=[];
  for(const group of byAthleteDate.values()){
    const hasGame=group.events.some(e=>!String(e.category||'').startsWith('training_'));
    const gd=hasGame?stamp({id:uuid(),athleteId:group.athleteId,activityDate:group.date,ownerId:null,deletedAt:null,legacySource:`v5-local:${group.athleteId}:${group.date}:game`}):null;
    if(gd)gameDays.push(gd);
    let currentBF=null,b=0,s=0,bfSeq=0,paSeq=0;
    const trainingAgg=new Map();
    for(const old of group.events){
      const cat=old.category||'',type=old.eventType||'';
      if(cat==='pitch'){
        if(!currentBF){currentBF=stamp({id:uuid(),athleteId:group.athleteId,gameDayId:gd.id,sequenceNo:++bfSeq,pitcherSide:null,batterSide:null,result:null,completed:false,activityDate:group.date,ownerId:null,deletedAt:null,legacySource:`v5-local-bf:${old.id}`});bfs.push(currentBF);b=0;s=0;}
        const ge=stamp({id:uuid(),athleteId:group.athleteId,gameDayId:gd.id,domain:'pitching',parentType:'batter_faced',parentId:currentBF.id,eventType:type,activityDate:group.date,recordedAt:old.metadata?.recordedAt||old.occurredAt||iso(),metadata:{...(old.metadata||{}),legacy:true,tlu:1},ownerId:null,deletedAt:null,legacySource:`v5-local-event:${old.id}`});gameEvents.push(ge);
        if(type==='ball')b++; if(['called','swinging','foul','inplay'].includes(type)){if(!(type==='foul'&&s>=2))s++;}
        let result=null;if(type==='hbp')result='HBP';else if(type==='inplay')result=old.metadata?.inplayResult||'IN_PLAY';else if(b>=4)result='BB';else if(s>=3)result='K';
        if(result){currentBF.result=result;currentBF.completed=true;stamp(currentBF);currentBF=null;b=0;s=0;}
      } else if(['game_throw','game_event'].includes(cat)&&['pickoff_normal','pickoff_error','game_warmup'].includes(type)){
        gameEvents.push(stamp({id:uuid(),athleteId:group.athleteId,gameDayId:gd.id,domain:'pitching',parentType:null,parentId:null,eventType:type,activityDate:group.date,recordedAt:old.metadata?.recordedAt||old.occurredAt||iso(),metadata:{...(old.metadata||{}),legacy:true,tlu:type==='game_warmup'?1:0.85},ownerId:null,deletedAt:null,legacySource:`v5-local-event:${old.id}`}));
      } else if(cat==='batting'){
        const result=type;const pa=stamp({id:uuid(),athleteId:group.athleteId,gameDayId:gd.id,sequenceNo:++paSeq,batterSide:null,pitcherSide:null,result,completed:true,activityDate:group.date,ownerId:null,deletedAt:null,legacySource:`v5-local-pa:${old.id}`});pas.push(pa);
      } else if(cat==='defense'||cat==='baserunning'){
        gameEvents.push(stamp({id:uuid(),athleteId:group.athleteId,gameDayId:gd.id,domain:cat,parentType:null,parentId:null,eventType:type,activityDate:group.date,recordedAt:old.metadata?.recordedAt||old.occurredAt||iso(),metadata:{...(old.metadata||{}),legacy:true},ownerId:null,deletedAt:null,legacySource:`v5-local-event:${old.id}`}));
      } else if(String(cat).startsWith('training_')){
        let domain='throwing',trainingType='throwing',side=null,unit='reps',tluPerRep=0;
        if(cat==='training_throw'){domain='pitching';trainingType='throwing';unit='throws';tluPerRep={light:.75,moderate:.85,full:1}[type]||0;}
        else if(cat==='training_hit'){domain='hitting';trainingType=old.metadata?.type||'other';unit='swings';}
        else if(cat==='training_defense'){domain='defense';trainingType=old.metadata?.drill||'other';unit='reps';}
        const k=[domain,trainingType,type,side,tluPerRep].join('|');
        if(!trainingAgg.has(k))trainingAgg.set(k,{domain,trainingType,side,unit,tluPerRep,quantity:0,metadata:{legacy:true,intensity:type}});
        trainingAgg.get(k).quantity++;
      }
    }
    for(const [k,a] of trainingAgg){trainingSets.push(stamp({id:uuid(),athleteId:group.athleteId,activityDate:group.date,domain:a.domain,trainingType:a.trainingType,side:a.side,quantity:a.quantity,unit:a.unit,tluPerRep:a.tluPerRep,tluTotal:a.quantity*a.tluPerRep,metadata:a.metadata,recordedAt:iso(),ownerId:null,deletedAt:null,legacySource:`v5-local-training:${group.athleteId}:${group.date}:${k}`}));}
  }
  await putMany('gameDays',gameDays);await putMany('batterFaced',bfs);await putMany('plateAppearances',pas);await putMany('gameEvents',gameEvents);await putMany('trainingSets',trainingSets);
  if(raw.activeAthleteId)await setMeta('activeAthleteId',raw.activeAthleteId);
  await setMeta('v5LocalMigrated',true);
  return {migrated:true,counts:{gameDays:gameDays.length,batterFaced:bfs.length,plateAppearances:pas.length,gameEvents:gameEvents.length,trainingSets:trainingSets.length}};
}
