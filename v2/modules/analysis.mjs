import {probabilitiesValid, transformProbabilities, decisionFromStatistical, parseProbability, calcWideProb, wideOutcome, uid} from './core.mjs';
export function exclusionReason(race, requireSplit = false) {
  const s = race.snapshot;
  if (!race.result) return '結果未入力';
  if (s.timing !== 'pre') return '事前保存が未確認';
  if (race.result.voidRace) return 'レース不成立';
  if (race.result.entries.some(e => e.status === 'dns' || e.status === 'excluded')) return '取消・除外あり';
  if (s.horses.length < 8) return '8頭未満';
  if (race.result.entries.filter(e => e.status === 'finished' && Number(e.rank) <= 3).length !== 3) return '3着以内の同着等';
  if (!s.horses.some(h => h.id === s.axisId)) return '軸馬が未設定';
  if (!probabilitiesValid(s.legacy) || !probabilitiesValid(s.decision)) return '確率条件を満たさない';
  if (requireSplit && (s.mode !== 'split' || !probabilitiesValid(s.neutral))) return '保守調整が未分離';
  return '';
}
export function observations(races, {target = 'horse', track = 'decision', filter = 'all', from = '', to = ''} = {}) {
  const data = [], exclusions = {};
  for (const r of races) {
    if (from && r.date < from || to && r.date > to) continue;
    const why = exclusionReason(r, track === 'neutral' || track === 'statistical'); if (why) { exclusions[why] = (exclusions[why] || 0) + 1; continue; }
    const s = r.snapshot, values = s[track];
    if (!values) { exclusions['対象の確率なし'] = (exclusions['対象の確率なし'] || 0) + 1; continue; }
    const axisIndex = s.horses.findIndex(h => h.id === s.axisId);
    if (target === 'horse') {
      s.horses.forEach((h, i) => {
        if (filter === 'axis' && h.id !== s.axisId || filter === 'candidate' && h.role !== 'candidate' && h.id !== s.axisId || filter === 'exclude' && h.role !== 'exclude') return;
        const e = r.result.entries.find(e => e.horseId === h.id);
        data.push({raceId: r.id, p: values[i], y: e.status === 'finished' && Number(e.rank) <= 3 ? 1 : 0});
      });
    } else if (axisIndex >= 0) {
      s.horses.forEach((h, i) => {
        if (i === axisIndex) return;
        if (filter === 'candidate' && h.role !== 'candidate' || filter === 'exclude' && h.role !== 'exclude' || filter === 'purchased' && !r.bets.some(b => b.axisId === s.axisId && b.partnerId === h.id)) return;
        const result = wideOutcome(r, s.axisId, h.id);
        if (result === 'hit' || result === 'miss') data.push({raceId: r.id, p: calcWideProb(values[axisIndex], values[i]), y: result === 'hit' ? 1 : 0});
      });
    }
  }
  return {data, exclusions};
}
export function summarize(data) {
  const n = data.length, bins = Array.from({length: 10}, (_, i) => ({index: i, n: 0, sumP: 0, hits: 0}));
  let loss = 0, logLoss = 0, hits = 0, expected = 0;
  for (const d of data) { loss += (d.p - d.y) ** 2; const p = Math.max(1e-12, Math.min(1 - 1e-12, d.p)); logLoss -= d.y * Math.log(p) + (1 - d.y) * Math.log(1 - p); hits += d.y; expected += d.p; const b = bins[Math.min(9, Math.floor(d.p * 10))]; if (b) { b.n++; b.sumP += d.p; b.hits += d.y; } }
  return {n, races: new Set(data.map(d => d.raceId)).size, brier: n ? loss / n : null, logLoss: n ? logLoss / n : null, mean: n ? expected / n : null, actual: n ? hits / n : null, hits, bins: bins.map(b => ({...b, predicted: b.n ? b.sumP / b.n : null, actual: b.n ? b.hits / b.n : null}))};
}
export const VALIDATION_VERSION = 'monotone-grid-walk-forward-v1';
export const MIN_TRAIN_RACES = 20, MIN_TEST_RACES = 10;
function labels(r) { return r.snapshot.horses.map(h => { const e = r.result.entries.find(e => e.horseId === h.id); return e.status === 'finished' && Number(e.rank) <= 3 ? 1 : 0; }); }
function mse(p, y) { return p.reduce((a, v, i) => a + (v - y[i]) ** 2, 0) / p.length; }
const grid = [{a: 1, b: 0}, ...[.6, .8, 1, 1.2, 1.4].flatMap(a => [-.8, -.4, 0, .4, .8].filter(b => a !== 1 || b !== 0).map(b => ({a, b})))];
export function fitModel(races) {
  let best = {theta: {a: 1, b: 0}, loss: Infinity};
  for (const theta of grid) {
    let loss = 0, valid = true;
    for (const r of races) { const p = transformProbabilities(r.snapshot.neutral, theta); if (!p) { valid = false; break; } loss += mse(p, labels(r)); }
    if (valid && loss / races.length < best.loss - 1e-12) best = {theta, loss: loss / races.length};
  }
  return best.theta;
}
export function pairedInterval(values, seed = 37219) {
  if (!values.length) return {mean: null, low: null, high: null};
  const mean = values.reduce((a, b) => a + b, 0) / values.length, draws = [];
  let z = seed >>> 0; const random = () => { z = (Math.imul(z, 1664525) + 1013904223) >>> 0; return z / 4294967296; };
  for (let i = 0; i < 2000; i++) { let sum = 0; for (let j = 0; j < values.length; j++) sum += values[Math.floor(random() * values.length)]; draws.push(sum / values.length); }
  draws.sort((a, b) => a - b); return {mean, low: draws[50], high: draws[1949]};
}
export function runValidation(allRaces) {
  const eligible = allRaces.filter(r => !exclusionReason(r, true)).sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  const excluded = {}; for (const r of allRaces) { const reason = exclusionReason(r, true); if (reason) excluded[reason] = (excluded[reason] || 0) + 1; }
  const base = {version: VALIDATION_VERSION, eligible: eligible.length, excluded, minTrain: MIN_TRAIN_RACES, minTest: MIN_TEST_RACES, createdAt: new Date().toISOString()};
  const days = [...new Set(eligible.map(r => r.date))], train = [], comparisons = [];
  for (const day of days) {
    const batch = eligible.filter(r => r.date === day);
    if (train.length >= MIN_TRAIN_RACES) {
      const theta = fitModel(train);
      for (const r of batch) {
        const s = r.snapshot, y = labels(r), stat = transformProbabilities(s.neutral, theta);
        const margin = s.horses.map(h => parseProbability(h.margin)), raw = s.horses.map(h => parseProbability(h.raw));
        const adjusted = stat && (theta.a === 1 && theta.b === 0 ? s.legacy : decisionFromStatistical(stat, raw, margin));
        const valid = adjusted && probabilitiesValid(adjusted);
        // Invalid outputs revert to the baseline; they are not dropped from evaluation.
        const corrected = stat && valid ? stat : s.neutral, decision = valid ? adjusted : s.legacy;
        const axis = s.horses.findIndex(h => h.id === s.axisId);
        const pairYs = [], beforeWide = [], afterWide = [];
        s.horses.forEach((h, i) => { if (i === axis || axis < 0) return; pairYs.push(wideOutcome(r, s.axisId, h.id) === 'hit' ? 1 : 0); beforeWide.push(calcWideProb(s.legacy[axis], s.legacy[i])); afterWide.push(calcWideProb(decision[axis], decision[i])); });
        comparisons.push({raceId: r.id, date: r.date, trainThrough: train[train.length - 1].date, trainCount: train.length, theta, fallback: !valid, before: mse(s.neutral, y), after: mse(corrected, y), decisionBefore: mse(s.legacy, y), decisionAfter: mse(decision, y), wideBefore: mse(beforeWide, pairYs), wideAfter: mse(afterWide, pairYs)});
      }
    }
    train.push(...batch);
  }
  if (comparisons.length < MIN_TEST_RACES) return {...base, status: 'insufficient', testCount: comparisons.length, message: '保守調整を分けて事前保存した通常レースが必要です。日付順で学習20レース以上、未使用の検証10レース以上を確保してから判定します。'};
  const horse = pairedInterval(comparisons.map(c => c.before - c.after)), decision = pairedInterval(comparisons.map(c => c.decisionBefore - c.decisionAfter)), wide = pairedInterval(comparisons.map(c => c.wideBefore - c.wideAfter));
  const accepted = horse.low > 0 && decision.low >= 0 && wide.low >= 0;
  const mean = key => comparisons.reduce((s, c) => s + c[key], 0) / comparisons.length;
  return {...base, status: accepted ? 'accepted' : 'not_confirmed', testCount: comparisons.length, testFrom: comparisons[0].date, testTo: comparisons[comparisons.length - 1].date, horse, decision, wide, before: mean('before'), after: mean('after'), decisionBefore: mean('decisionBefore'), decisionAfter: mean('decisionAfter'), wideBefore: mean('wideBefore'), wideAfter: mean('wideAfter'), comparisons, fallbackCount: comparisons.filter(c => c.fallback).length, model: {id: uid(), version: VALIDATION_VERSION, active: false, theta: fitModel(eligible), trainedThrough: eligible[eligible.length - 1].date, trainedOn: eligible.map(r => `${r.id}:${r.snapshot.id}:${r.result.savedAt}`)}, message: accepted ? '未使用レースで改善を確認しました。将来の予想で補正を利用できます。' : '未使用レースで、保守調整後とワイドも含む改善を確認できませんでした。従来計算を継続します。'};
}
