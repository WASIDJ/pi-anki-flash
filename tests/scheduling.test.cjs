const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createJiti } = require(process.env.ANKI_TEST_JITI || 'jiti');
const jiti = createJiti(__filename);
const { getStudyPlan, setStudyPlan } = jiti('../extensions/anki-flash/scheduling.ts');

function fixture(options = {}) {
 const initial = {id:options.private ? 2 : 1,name:'Original',desiredRetention:0.85,new:{perDay:20,delays:[1,10],bury:true},rev:{perDay:200},lapse:{delays:[10]},fsrsParams6:[1,2],futureOption:{keep:true}};
 if(options.unsupported) delete initial.desiredRetention;
 const configs = {[initial.id]:structuredClone(initial)};
 const decks = {A:initial.id,B:options.private ? 1 : initial.id};
 if(options.private) configs[1]={...structuredClone(initial),id:1};
 const writes=[];
 global.fetch=async (_,request)=>{
  const {action,params:p}=JSON.parse(request.body);let result;
  if(action==='deckNames') result=Object.keys(decks);
  else if(action==='getDeckConfig') result=configs[decks[p.deck]] || false;
  else {
   writes.push({action,params:structuredClone(p)});
   if(action==='cloneDeckConfigId'){configs[3]={...structuredClone(configs[p.cloneFrom]),id:3,name:p.name};result=3;}
   else if(action==='saveDeckConfig'){
    result=!options.failSave;
    if(result){configs[p.config.id]=structuredClone(p.config);if(options.ignoreRetention) configs[p.config.id].desiredRetention=0.85;}
   } else if(action==='setDeckConfigId') {decks[p.decks[0]]=p.configId;result=true;}
   else throw Error(action);
  }
  return {ok:true,json:async()=>({result:structuredClone(result),error:null})};
 };
 return {initial,configs,decks,writes};
}

test('deck scheduling contract',async t=>{
 await t.test('read and preview do not write',async()=>{
  const f=fixture();assert.deepEqual((await getStudyPlan('A')).sharedWith,['B']);
  const preview=await setStudyPlan('A',{desiredRetention:0.9});
  assert.equal(preview.status,'preview');assert.equal(preview.clonePreset,true);assert.equal(f.writes.length,0);
 });
 await t.test('isolates shared preset and preserves unrelated fields',async()=>{
  const f=fixture();const r=await setStudyPlan('A',{desiredRetention:0.9,newCardsPerDay:10,learningStepsMinutes:[]},true);
  assert.equal(r.applied,true);assert.equal(f.decks.A,3);assert.equal(f.decks.B,1);
  assert.deepEqual(f.configs[1],f.initial);assert.deepEqual(f.configs[3].futureOption,{keep:true});
  assert.deepEqual(f.configs[3].fsrsParams6,[1,2]);assert.equal(f.configs[3].new.bury,true);
  assert.deepEqual(f.configs[3].new.delays,[]);
 });
 await t.test('private preset updates without cloning, zero limit accepted',async()=>{
  const f=fixture({private:true});await setStudyPlan('A',{newCardsPerDay:0},true);
  assert.equal(f.configs[2].new.perDay,0);assert.equal(f.writes.some(w=>w.action==='cloneDeckConfigId'),false);
 });
 await t.test('invalid input and unsupported field never write',async()=>{
  const f=fixture();for(const changes of [{desiredRetention:90},{newCardsPerDay:-1},{reviewsPerDay:1.5},{learningStepsMinutes:[1440]},{relearningStepsMinutes:[NaN]},{}, {fsrsEnabled:true}])
   await assert.rejects(setStudyPlan('A',changes,true));
  assert.equal(f.writes.length,0);await assert.rejects(getStudyPlan('Missing'));
  const old=fixture({unsupported:true});await assert.rejects(setStudyPlan('A',{desiredRetention:0.9},true),/does not expose/);assert.equal(old.writes.length,0);
 });
 await t.test('idempotent application creates no extra presets',async()=>{
  const f=fixture();await setStudyPlan('A',{desiredRetention:0.9},true);const n=f.writes.length;
  assert.equal((await setStudyPlan('A',{desiredRetention:0.9},true)).status,'unchanged');assert.equal(f.writes.length,n);
 });
 await t.test('save failure leaves original deck assignment intact',async()=>{
  const f=fixture({failSave:true});await assert.rejects(setStudyPlan('A',{desiredRetention:0.9},true),/Original deck settings restored/);
  assert.equal(f.decks.A,1);assert.deepEqual(f.configs[1],f.initial);
 });
 await t.test('readback mismatch restores original assignment',async()=>{
  const f=fixture({ignoreRetention:true});await assert.rejects(setStudyPlan('A',{desiredRetention:0.9},true),/did not retain/);assert.equal(f.decks.A,1);
 });
 await t.test('readback mismatch restores private preset',async()=>{
  const f=fixture({private:true,ignoreRetention:true});await assert.rejects(setStudyPlan('A',{desiredRetention:0.9},true),/Original deck settings restored/);assert.deepEqual(f.configs[2],f.initial);
 });
});
