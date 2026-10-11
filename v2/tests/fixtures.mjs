import * as c from '../modules/core.mjs';
export function raceFixture({date='2026-01-01',mode='split',decision='bet',timing='pre',raw=['80','40','30','30','30','30','30','30'],margins=Array(8).fill('')}={}){
  const d=c.newDraft(raw.length);d.name='Synthetic race';d.date=date;d.mode=mode;d.decision=decision;d.timing=timing;
  d.horses.forEach((h,i)=>{h.raw=raw[i];h.margin=margins[i]||'';h.role=i<2?'candidate':i===7?'exclude':'observe';});d.axisId=d.horses[0].id;d.selectedPartner=d.horses[1].id;d.odds[d.horses[1].id]='5';d.stake='1000';
  const settings=c.initialState().settings,p=c.projectDraft(d,settings,100000,null);return c.createRace(d,p,settings,100000,null,new Date(`${date}T00:00:00+09:00`));
}
export function rankedResult(r,order=[1,2,3,4,5,6,7,8]){return {voidRace:false,entries:r.snapshot.horses.map((h,i)=>({horseId:h.id,status:'finished',rank:order[i]})),payouts:Object.fromEntries(r.bets.map(b=>[b.id,''])),savedAt:`${r.date}T10:00:00Z`};}
