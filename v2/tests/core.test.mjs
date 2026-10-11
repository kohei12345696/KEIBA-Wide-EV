import {raceFixture,rankedResult} from './fixtures.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as c from '../modules/core.mjs';
const fixture=JSON.parse(fs.readFileSync(new URL('./legacy-golden-cases.json',import.meta.url)));
let factory;vm.runInNewContext(fs.readFileSync(new URL('./legacy-engine.fixture.cjs',import.meta.url),'utf8'),{__d:f=>factory=f});
const old={};factory({},null,null,null,{},old,[]);
for(const f of fixture.records)test(`legacy parity / ${f.name}`,()=>{
  const p=c.normalizeProbabilities(f.input.map(c.parseProbability));assert.deepEqual(p,f.normalized);
  const wide=c.calcWideProb(p[f.axis],p[f.partner]);assert.equal(wide,f.wide);
  const required=c.calcReqOdds(wide,f.threshold),ev=c.calcEV(wide,f.odds);
  assert.equal(required,f.required);assert.equal(ev,f.ev);assert.equal(c.calcKellyRatio(wide,f.odds,f.fraction),f.kelly);assert.equal(c.calcBetAmount(f.bankroll,wide,f.odds,f.fraction),f.bet);
  assert.deepEqual({probabilityTable:(wide*100).toFixed(1),probabilityDetail:(wide*100).toFixed(2),requiredTable:required.toFixed(1),requiredDetail:required.toFixed(2),evTable:ev===null?null:ev.toFixed(2),evDetail:ev===null?null:ev.toFixed(3)},f.display);
  const d=c.newDraft(f.input.length);d.horses.forEach((h,i)=>h.raw=f.input[i]);d.axisId=d.horses[f.axis].id;d.odds[d.horses[f.partner].id]=String(f.odds);
  const projection=c.projectDraft(d,{evThreshold:f.threshold,kellyFraction:f.fraction},f.bankroll,null),pair=projection.pairs.find(p=>p.partnerIndex===f.partner);
  assert.deepEqual(projection.decision,f.normalized);assert.equal(pair.probability,f.wide);assert.equal(pair.amount,f.bet);assert.equal(pair.recommended,f.recommended);
});
test('10,000 deterministic inputs match the executed original bundle, including boundaries',()=>{
  let seed=4183;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  for(let i=0;i<10000;i++){
    const n=4+Math.floor(random()*15),input=Array.from({length:n},()=>Math.floor(random()*10001)/10000),p=c.normalizeProbabilities(input),q=Array.from(old.normalizeProbabilities(input));assert.deepEqual(p,q);
    const axis=Math.floor(random()*n),partner=(axis+1+Math.floor(random()*(n-1)))%n,w=c.calcWideProb(p[axis],p[partner]),wo=old.calcWideProb(q[axis],q[partner]);assert.equal(w,wo);
    const threshold=[1,1.2,1.5,2][i%4],odds=i%5===0?c.calcReqOdds(w,threshold):1+random()*80,fraction=[.25,.5,1][i%3],bankroll=Math.floor(random()*500000);
    assert.equal(c.calcReqOdds(w,threshold),old.calcReqOdds(wo,threshold));assert.equal(c.calcEV(w,odds),old.calcEV(wo,odds));assert.equal(c.calcKellyRatio(w,odds,fraction),old.calcKellyRatio(wo,odds,fraction));assert.equal(c.calcBetAmount(bankroll,w,odds,fraction),old.calcBetAmount(bankroll,wo,odds,fraction));
  }
});
test('snapshots are immutable copies and revisions do not double count races',()=>{
  const r=raceFixture(),p=c.projectDraft(r.snapshot.input,r.snapshot.settings,100000,null),revision=c.createRace({...r.snapshot.input,parentRaceId:r.id},p,r.snapshot.settings,100000,null,new Date('2026-01-01T00:01:00+09:00'));
  revision.snapshot.input.horses[0].raw='79';assert.equal(r.snapshot.horses[0].raw,'80');
  const records=c.upsertRace([r],revision);assert.equal(records.length,1);assert.equal(records[0].versions.length,1);assert.equal(records[0].versions[0].id,r.snapshot.id);
  r.result=rankedResult(r);assert.throws(()=>c.upsertRace([r],revision),/変更できません/);
});
test('pre-race save rejects past dates, passed times, invalid probabilities, duplicate numbers',()=>{
  const r=raceFixture(),d=c.clone(r.snapshot.input);d.date='2025-01-01';let p=c.projectDraft(d,r.snapshot.settings,100000,null);assert.ok(c.validateDraft(d,p,new Date('2026-01-01')).some(e=>e.includes('過去日')));
  d.date='2026-01-01';d.time='10:00';assert.ok(c.validateDraft(d,p,new Date('2026-01-01T10:00:00+09:00')).some(e=>e.includes('発走')));
  d.timing='retrospective';d.horses[1].number=d.horses[0].number;assert.ok(c.validateDraft(d,p).some(e=>e.includes('重複')));
  d.horses.forEach((h,i)=>{h.number=i+1;h.raw=i?'10':'90';});p=c.projectDraft(d,r.snapshot.settings,100000,null);assert.ok(p.legacy[0]>1);assert.ok(c.validateDraft(d,p).some(e=>e.includes('正規化')));
});
test('blank results do not count as a hit; valid ties and cancellations settle correctly',()=>{
  const r=raceFixture(),a=r.snapshot.horses[0].id,b=r.snapshot.horses[1].id;
  assert.equal(c.wideOutcome(r,a,b,c.emptyResult(r)),null);
  let result=rankedResult(r,[3,3,1,2,5,6,7,8]);assert.deepEqual(c.validateResult(r,result),[]);assert.equal(c.wideOutcome(r,a,b,result),'miss');assert.equal(c.wideOutcome(r,a,r.snapshot.horses[2].id,result),'hit');
  result=rankedResult(r,[1,1,3,4,5,6,7,8]);assert.deepEqual(c.validateResult(r,result),[]);assert.equal(c.wideOutcome(r,a,b,result),'hit');
  result=rankedResult(r,[1,2,4,5,6,7,8,8]);assert.ok(c.validateResult(r,result).length);
  result=rankedResult(r);result.entries[1].status='dns';assert.equal(c.wideOutcome(r,a,b,result),'refund');result.voidRace=true;assert.equal(c.wideOutcome(r,a,b,result),'refund');
});
test('manual payout, missing payout, refunds and corrections produce consistent bankroll',()=>{
  const state=c.initialState(),r=raceFixture();state.races=[r];r.result=rankedResult(r);
  assert.equal(c.finances([r]).missingPayout,1);assert.equal(c.bankroll(state),100000);assert.equal(c.finances([r]).roi,null);
  r.bets[0].payout=4500;assert.equal(c.bankroll(state),103500);assert.equal(c.finances([r]).roi,4.5);
  r.result=rankedResult(r,[4,5,1,2,3,6,7,8]);assert.equal(c.bankroll(state),99000);
  r.result.voidRace=true;assert.equal(c.bankroll(state),100000);assert.equal(c.finances([r]).bets,0);
  state.races=[];assert.equal(c.bankroll(state),100000);
});
test('identity calibration remains bit-exact; future-only and separated-input restrictions',()=>{
  const r=raceFixture(),d=r.snapshot.input,model={id:'identity',active:true,trainedThrough:'2025-12-31',theta:{a:1,b:0}},p=c.projectDraft(d,r.snapshot.settings,100000,model);
  assert.equal(p.applied,true);assert.deepEqual(p.decision,p.legacy);
  assert.equal(c.projectDraft({...d,mode:'legacy'},r.snapshot.settings,100000,model).applied,false);
  assert.equal(c.projectDraft({...d,date:'2025-12-31'},r.snapshot.settings,100000,model).applied,false);
});
