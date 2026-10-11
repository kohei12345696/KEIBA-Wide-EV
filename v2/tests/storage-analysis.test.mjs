import test from 'node:test';
import assert from 'node:assert/strict';
import {initialState,clone,decisionFromStatistical,normalizeProbabilities,parseProbability,probabilitiesValid} from '../modules/core.mjs';
import {exportBackup,decodeBackup,decodeLegacy,mergeImported} from '../modules/storage.mjs';
import {observations,summarize,exclusionReason,runValidation,pairedInterval,fitModel} from '../modules/analysis.mjs';
import {raceFixture,rankedResult} from './fixtures.mjs';
test('backup round-trip keeps records, outputs and results; importing twice skips duplicates',()=>{
  const state=initialState(),r=raceFixture();r.result=rankedResult(r);r.bets[0].payout=4300;state.races=[r];
  const decoded=decodeBackup(exportBackup(state));assert.deepEqual(decoded.races[0].snapshot.decision,r.snapshot.decision);assert.deepEqual(decoded.races[0].result,r.result);assert.deepEqual(decoded.settings,state.settings);
  const once=mergeImported([],decoded.races),twice=mergeImported(once.races,decoded.races);assert.equal(once.added,1);assert.equal(twice.added,0);assert.equal(twice.skipped,1);assert.equal(twice.races.length,1);
});
test('malformed backups reject unsafe IDs, missing horses, non-finite values and broken ranks',()=>{
  const state=initialState();state.races=[raceFixture()];const good=JSON.parse(exportBackup(state));
  for(const mutate of [v=>v.data.races[0].snapshot.horses[0].id='"><img src=x>',v=>v.data.races[0].snapshot.decision[0]=null,v=>v.data.races[0].bets[0].partnerId='missing',v=>{const r=v.data.races[0];r.result=rankedResult(r,[1,2,4,5,6,7,8,8]);}]){const bad=clone(good);mutate(bad);assert.throws(()=>decodeBackup(JSON.stringify(bad)));}
  assert.throws(()=>decodeBackup('{broken'));assert.throws(()=>decodeBackup(JSON.stringify({app:'wide-ev-v2',schema:20,data:state})));
});
test('legacy import keeps exact probabilities and marks provenance unknown; presets are ignored',()=>{
  const old={raceSlots:[{id:'slot1',raceName:'Old',raceDate:'2026-01-01',savedAt:1767180000000,axisHorseId:'h1',horses:Array.from({length:8},(_,i)=>({id:`h${i+1}`,number:i+1,placeProb:i===0?'80':i===1?'40':'30'}))}],betHistory:[{id:'bet1',raceSlotId:'slot1',axisHorseNum:1,partnerHorseNum:2,betAmount:1000,entryOdds:5,wideProb:.29,result:'hit',finalOdds:4.5},{id:'orphan',raceSlotId:'missing',betSelected:true}],presets:[{name:'must not import'}]};
  const parsed=decodeLegacy(old),r=parsed.races[0];assert.equal(r.snapshot.timing,'unknown');assert.equal(r.bets[0].payout,4500);assert.equal(parsed.settings,null);assert.ok(parsed.warnings.some(s=>s.includes('1件')));assert.equal('presets' in parsed,false);assert.deepEqual(r.snapshot.decision,normalizeProbabilities(old.raceSlots[0].horses.map(h=>parseProbability(h.placeProb))));
});
test('analysis counts every horse and every axis pair, with explicit role and purchase subsets',()=>{
  const r=raceFixture();r.result=rankedResult(r);
  const horse=summarize(observations([r]).data),wide=summarize(observations([r],{target:'wide'}).data);assert.equal(horse.n,8);assert.equal(horse.hits,3);assert.equal(wide.n,7);assert.equal(wide.hits,2);
  assert.equal(observations([r],{filter:'candidate'}).data.length,2);assert.equal(observations([r],{filter:'exclude'}).data.length,1);assert.equal(observations([r],{target:'wide',filter:'purchased'}).data.length,1);
  assert.equal(horse.bins.reduce((n,b)=>n+b.n,0),8);assert.equal(horse.races,1);assert.equal(summarize([]).brier,null);
});
test('analysis excludes hindsight, small fields, withdrawals, extra top-three finishers and unseparated neutral inputs',()=>{
  const base=raceFixture();base.result=rankedResult(base);
  for(const mutate of [r=>r.snapshot.timing='retrospective',r=>r.result.voidRace=true,r=>r.result.entries[7].status='dns',r=>{r.result=rankedResult(r,[1,2,3,3,5,6,7,8]);},r=>r.snapshot.axisId='missing']){const r=clone(base);mutate(r);assert.ok(exclusionReason(r));assert.equal(observations([r]).data.length,0);}
  const six=raceFixture({raw:Array(6).fill('50')});six.result=rankedResult(six,[1,2,3,4,5,6]);assert.equal(exclusionReason(six),'8頭未満');
  const legacy=raceFixture({mode:'legacy'});legacy.result=rankedResult(legacy);assert.equal(observations([legacy],{track:'neutral'}).data.length,0);assert.equal(observations([legacy]).data.length,8);
});
function series(count=42){return Array.from({length:count},(_,i)=>{
  const date=new Date(Date.UTC(2026,0,1+Math.floor(i/2))).toISOString().slice(0,10),r=raceFixture({date,raw:['70','50','45','40','35','25','20','15'],margins:['','','','','','2','3','5']});
  r.id=`synthetic-${String(i).padStart(3,'0')}`;r.result=rankedResult(r,i%3===0?[1,2,3,4,5,6,7,8]:i%3===1?[4,1,2,3,5,6,7,8]:[1,4,5,2,3,6,7,8]);return r;
});}
test('walk-forward validation trains strictly before each date and keeps whole days out',()=>{
  const records=series(),result=runValidation(records);assert.equal(result.eligible,42);assert.equal(result.testCount,22);assert.notEqual(result.status,'insufficient');assert.equal(result.model.active,false);
  for(const c of result.comparisons){assert.ok(c.trainThrough<c.date);assert.equal(c.trainCount,records.filter(r=>r.date<c.date).length);}
  for(let i=0;i<result.comparisons.length;i+=2){assert.deepEqual(result.comparisons[i].theta,result.comparisons[i+1].theta);assert.equal(result.comparisons[i].trainCount,result.comparisons[i+1].trainCount);}
  const changed=clone(records);changed[changed.length-1].result=rankedResult(changed[changed.length-1],[8,7,6,5,4,3,2,1]);const other=runValidation(changed);assert.deepEqual(other.comparisons.slice(0,-2),result.comparisons.slice(0,-2));assert.deepEqual(other.comparisons.at(-1).theta,result.comparisons.at(-1).theta);
  assert.equal(result.status==='accepted',result.horse.low>0&&result.decision.low>=0&&result.wide.low>=0);
});
test('insufficient/same-day data cannot enable calibration; repeat fitting is deterministic',()=>{
  assert.equal(runValidation([]).status,'insufficient');assert.equal(runValidation(series(28)).status,'insufficient');
  const oneDay=series(40).map(r=>({...r,date:'2026-01-01'}));assert.equal(runValidation(oneDay).testCount,0);
  assert.deepEqual(fitModel(series(20)),fitModel(series(20)));assert.deepEqual(pairedInterval([.1,-.02,.03]),pairedInterval([.1,-.02,.03]));
});
test('conservative margin changes decision probabilities independently from statistical estimates',()=>{
  const raw=[.8,.4,.3,.3,.3,.3,.3,.3],p=normalizeProbabilities(raw),copy=[...p],margin=[0,0,0,0,0,0,0,.1],decision=decisionFromStatistical(p,raw,margin);
  assert.deepEqual(p,copy);assert.ok(probabilitiesValid(decision));assert.ok(decision[0]<p[0]);assert.ok(decision[7]>p[7]);
});
