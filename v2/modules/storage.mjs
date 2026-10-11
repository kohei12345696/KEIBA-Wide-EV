import {initialState, clone, uid, normalizeProbabilities, parseProbability, calcWideProb, calcReqOdds, validateResult} from './core.mjs';
const DB_NAME = 'wide-ev-v2-records', STORE = 'workspace';
export async function openStorage() {
  if (!globalThis.indexedDB) throw new Error('このブラウザーでは端末内保存を利用できません。');
  const db = await new Promise((resolve, reject) => { const request = indexedDB.open(DB_NAME, 1); request.onupgradeneeded = () => request.result.createObjectStore(STORE); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); request.onblocked = () => reject(new Error('他のタブを閉じてから、もう一度開いてください。')); });
  let revision = 0;
  return {
    async load() { return new Promise((resolve, reject) => { const tx = db.transaction(STORE, 'readonly'), r = tx.objectStore(STORE).get('data'); r.onsuccess = () => { revision = r.result?.revision || 0; resolve(r.result?.data || initialState()); }; r.onerror = () => reject(r.error); }); },
    async save(data) { const copy = clone(data); return new Promise((resolve, reject) => { const tx = db.transaction(STORE, 'readwrite'), store = tx.objectStore(STORE), r = store.get('data'); let conflict = false; r.onsuccess = () => { if ((r.result?.revision || 0) !== revision) { conflict = true; tx.abort(); return; } store.put({revision: revision + 1, data: copy}, 'data'); }; tx.oncomplete = () => { revision++; resolve(); }; tx.onerror = () => reject(tx.error || new Error('保存に失敗しました。')); tx.onabort = () => reject(new Error(conflict ? '別のタブで記録が更新されました。現在の内容をバックアップしてから再読み込みしてください。' : '保存を完了できませんでした。')); }); },
    close() { db.close(); }
  };
}
const string = (v, max = 1000) => typeof v === 'string' ? v.slice(0, max) : String(v ?? '').slice(0, max);
function check(condition, message) { if (!condition) throw new Error(message); }
function finite(n) { return typeof n === 'number' && Number.isFinite(n); }
const safeId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,250}$/.test(value);
function validateSnapshot(s) {
  check(s && safeId(s.id) && Array.isArray(s.horses) && s.horses.length >= 2 && s.horses.length <= 18, '予想データの形式が正しくありません。');
  check(new Set(s.horses.map(h => h.id)).size === s.horses.length, '馬のIDが重複しています。');
  check(s.horses.every(h => safeId(h.id) && Number.isInteger(h.number) && h.number >= 1 && h.number <= 18 && ['candidate','exclude','observe'].includes(h.role)), '馬の情報が正しくありません。');
  check(['pre','retrospective','unknown'].includes(s.timing) && ['legacy','split'].includes(s.mode), '予想の保存区分が正しくありません。');
  for (const key of ['legacy', 'neutral', 'decision']) check(Array.isArray(s[key]) && s[key].length === s.horses.length && s[key].every(finite), '保存された確率を確認してください。');
  check(s.statistical == null || Array.isArray(s.statistical) && s.statistical.length === s.horses.length && s.statistical.every(finite), '補正確率を確認してください。');
  s.horses = s.horses.map(h => ({...h,name:string(h.name,60),raw:string(h.raw,30),margin:string(h.margin,30)}));
  // Reconstruct revision input from validated fields; never trust arbitrary nested backup input.
  if (s.input) s.input = {...s.input,horses:clone(s.horses),axisId:s.axisId,mode:s.mode,timing:s.timing,odds:Object.fromEntries(s.horses.map(h => [h.id,string(s.input.odds?.[h.id],30)])),selectedPartner:s.horses.some(h=>h.id===s.input.selectedPartner)?s.input.selectedPartner:''};
  return s;
}
export function validateBackupRace(value) {
  const r = clone(value), s = r.snapshot;
  check(safeId(r.id) && /^\d{4}-\d{2}-\d{2}$/.test(r.date) && Number.isFinite(Date.parse(r.date)), 'レースID・日付を確認してください。');
  validateSnapshot(s);
  check(Array.isArray(r.bets) && r.bets.length <= 500 && r.bets.every(b => safeId(b.id) && finite(b.stake) && b.stake >= 0 && (b.payout == null || finite(b.payout) && b.payout >= 0)), '購入記録を確認してください。');
  check(new Set(r.bets.map(b=>b.id)).size === r.bets.length, '購入記録のIDが重複しています。');
  check(r.bets.every(b => b.axisId !== b.partnerId && s.horses.some(h => h.id === b.axisId) && s.horses.some(h => h.id === b.partnerId)), '購入した馬の情報がありません。');
  if (r.result) check(Array.isArray(r.result.entries) && r.result.entries.length === s.horses.length && new Set(r.result.entries.map(e => e.horseId)).size === s.horses.length && r.result.entries.every(e => s.horses.some(h => h.id === e.horseId) && ['finished','dnf','dns','excluded'].includes(e.status) && (r.result.voidRace || e.status !== 'finished' || Number.isInteger(Number(e.rank)) && Number(e.rank) >= 1 && Number(e.rank) <= 18)), '着順データを確認してください。');
  if (r.result) check(validateResult(r,r.result).length === 0, '着順の連続性や同着の入力を確認してください。');
  r.name = string(r.name, 200); r.notes = string(r.notes, 5000); r.course = string(r.course, 100); r.versions = Array.isArray(r.versions) ? r.versions.map(validateSnapshot) : [];
  if (s.input) s.input = {...s.input,id:r.id,parentRaceId:r.id,name:r.name,date:r.date,time:string(r.time,5),course:r.course,distance:string(r.distance,50),notes:r.notes,decision:['bet','skip','watch'].includes(r.decision)?r.decision:'watch',stake:string(s.input.stake,30)};
  return r;
}
export function exportBackup(state) { return JSON.stringify({app: 'wide-ev-v2', schema: 1, exportedAt: new Date().toISOString(), data: state}, null, 2); }
export function decodeBackup(text) {
  check(text.length <= 25000000, 'ファイルが大きすぎます（上限25MB）。');
  const value = JSON.parse(text);
  if (value.app === 'wide-ev-v2') {
    check(value.schema === 1 && value.data && Array.isArray(value.data.races), '対応していないバックアップ形式です。');
    const races = value.data.races.map(validateBackupRace);
    check(new Set(races.map(r => r.id)).size === races.length, 'バックアップ内でレースIDが重複しています。');
    const settings = value.data.settings;
    check(settings && finite(settings.baseBankroll) && finite(settings.evThreshold) && settings.evThreshold >= 1 && settings.evThreshold <= 10 && [.25,.5,1].includes(settings.kellyFraction), '設定値が正しくありません。');
    return {kind: 'v2', races, settings: {baseBankroll: settings.baseBankroll, evThreshold: settings.evThreshold, kellyFraction: settings.kellyFraction}, draft: value.data.draft || null};
  }
  if (Array.isArray(value.raceSlots) || value.savedCalcState) return decodeLegacy(value);
  throw new Error('Wide EVのJSONバックアップを選択してください。Excelは使用しません。');
}
export function decodeLegacy(value) {
  const settings = {baseBankroll: Number(value.settings?.bankroll) || 100000, evThreshold: Number(value.settings?.evThreshold) || 1.2, kellyFraction: [.25,.5,1].includes(value.settings?.kellyFraction) ? value.settings.kellyFraction : .5};
  const slots = value.raceSlots || [{...value.savedCalcState, id: 'old-single', raceName: '旧サイトの保存レース'}], history = Array.isArray(value.betHistory) ? value.betHistory : [];
  const races = [], warnings = [];
  for (const slot of slots) {
    if (!Array.isArray(slot.horses) || slot.horses.length < 2 || slot.horses.length > 18) { warnings.push('馬情報が不足した保存レースを除外しました。'); continue; }
    const horses = slot.horses.map((h,i) => ({id: string(h.id || `horse-${i}`), number: Number(h.number) || i + 1, name: '', raw: string(h.placeProb, 30), margin: '', role: 'observe'}));
    const p = normalizeProbabilities(horses.map(h => parseProbability(h.raw))), axisId = string(slot.axisHorseId), axis = horses.findIndex(h => h.id === axisId);
    const records = history.filter(b => b.raceSlotId === slot.id && b.betSelected !== false);
    const dateValue = slot.raceDate || records[0]?.date || new Date(slot.savedAt || Date.now()).toISOString().slice(0,10);
    const race = {id: `legacy-${string(slot.id || uid(), 200)}`, name: string(slot.raceName || '旧サイトのレース', 200), date: /^\d{4}-\d{2}-\d{2}$/.test(dateValue) ? dateValue : '1970-01-01', time: '', course: '', distance: '', notes: '旧サイトから移行。事前確定時刻・全馬結果が未確認のため、予想精度の学習には使用しません。', provenance: 'legacy', decision: records.length ? 'bet' : 'watch', updatedAt: new Date().toISOString(), versions: [], result: null, snapshot: {id: `legacy-snapshot-${slot.id}`, savedAt: new Date(slot.savedAt || Date.now()).toISOString(), timing: 'unknown', engine: 'legacy-8d2a86b-1', mode: 'legacy', horses, axisId, legacy: p, neutral: p, decision: p, statistical: null, modelVersion: null, input: null, settings, pairs: axis < 0 ? [] : horses.flatMap((h,i) => i === axis ? [] : [{axisId, partnerId: h.id, probability: calcWideProb(p[axis],p[i]), legacyProb: calcWideProb(p[axis],p[i]), required: calcReqOdds(calcWideProb(p[axis],p[i]),settings.evThreshold)}])}, bets: records.flatMap(b => {const a = horses.find(h => h.number === b.axisHorseNum), p = horses.find(h => h.number === b.partnerHorseNum); if (!a || !p) { warnings.push('馬情報と結び付かない購入記録を除外しました。'); return []; } return [{id: `legacy-bet-${b.id}`, axisId:a.id, partnerId:p.id, odds:Number(b.entryOdds)||0, probability:Number(b.wideProb)||0, stake:Number(b.betAmount)||0, payout:b.result === 'hit' && Number(b.finalOdds)>0 ? Number(b.betAmount)*Number(b.finalOdds) : null, legacyOutcome:['hit','miss'].includes(b.result)?b.result:null}];})};
    races.push(validateBackupRace(race));
  }
  const linked = new Set(slots.map(s => s.id));
  const orphan = history.filter(b => b.betSelected !== false && !linked.has(b.raceSlotId)).length;
  if (orphan) warnings.push(`全馬情報のない購入履歴${orphan}件は移行対象外です。元のJSONは保管してください。`);
  return {kind:'legacy', races, settings:null, draft:null, warnings};
}
export function mergeImported(existing, incoming) { const ids = new Set(existing.map(r => r.id)); return {races: [...incoming.filter(r => !ids.has(r.id)), ...existing], added: incoming.filter(r => !ids.has(r.id)).length, skipped: incoming.filter(r => ids.has(r.id)).length}; }
export function readLegacyStorage() { const parse = key => {const text = localStorage.getItem(key); return text ? JSON.parse(text) : null;}; const raceSlots = parse('keiba_race_slots'), savedCalcState = parse('keiba_saved_calculator'); if (!raceSlots?.length && !savedCalcState) throw new Error('このブラウザーには旧サイトの保存データがありません。以前使っていたブラウザーからJSONを移してください。'); return {raceSlots:raceSlots?.length?raceSlots:null, savedCalcState, settings:parse('keiba_settings'), betHistory:parse('keiba_bet_history') || []}; }
