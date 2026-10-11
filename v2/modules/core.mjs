// Calculation contract: legacy commit 8d2a86b, module 771.
// Preserve operation order, sentinel values and unrounded intermediate values.
export const ENGINE_VERSION = 'legacy-8d2a86b-1';
export function normalizeProbabilities(n) { const t = n.reduce((n, t) => n + t, 0); return t === 0 ? n.map(() => 0) : n.map(n => n / t * 3); }
export function calcWideProb(n, t) { if (n <= 0 || t <= 0) return 0; const r = 2 * n / (3 - n); return Math.min(t * r, 1); }
export function calcReqOdds(n, t = 1.2) { return n <= 0 ? 999 : t / n; }
export function calcEV(n, t) { return n <= 0 || t <= 0 ? null : n * t; }
export function calcKellyRatio(n, t, r = .5) { if (t <= 1) return 0; const l = (n * t - 1) / (t - 1); return Math.max(0, l * r); }
export function calcBetAmount(n, t, r, l = .5) { const u = calcKellyRatio(t, r, l); return 100 * Math.floor(n * u / 100); }
export function parseProbability(value) { const n = parseFloat(value); return isNaN(n) || n <= 0 ? 0 : n / 100; }
export const uid = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
export const clone = value => JSON.parse(JSON.stringify(value));
export function todayJST(now = new Date()) { return new Date(now.getTime() + 9 * 3600000).toISOString().slice(0, 10); }
export function newHorse(number) { return {id: uid(), number, name: '', raw: '', margin: '', role: 'observe'}; }
export function newDraft(count = 8) { return {id: uid(), name: '', date: todayJST(), time: '', course: '', distance: '', mode: 'legacy', horses: Array.from({length: count}, (_, i) => newHorse(i + 1)), axisId: '', odds: {}, selectedPartner: '', decision: 'watch', stake: '', notes: '', timing: 'pre'}; }
export function initialState() { return {schema: 1, settings: {baseBankroll: 100000, evThreshold: 1.2, kellyFraction: .5}, races: [], draft: newDraft(), model: null, validation: null}; }
export function probabilitiesValid(p) { return p.length >= 3 && p.every(x => Number.isFinite(x) && x >= 0 && x <= 1) && Math.abs(p.reduce((a, b) => a + b, 0) - 3) < 1e-9; }

// Statistical calibration is separate from the preserved legacy engine.
export function transformProbabilities(p, theta) {
  if (!theta || (theta.a === 1 && theta.b === 0)) return [...p];
  if (!probabilitiesValid(p)) return null;
  const q = p.map(x => { const v = Math.max(1e-6, Math.min(1 - 1e-6, x)); return 1 / (1 + Math.exp(-(theta.a * Math.log(v / (1 - v)) + theta.b))); });
  const result = normalizeProbabilities(q);
  return probabilitiesValid(result) ? result : null;
}
export function decisionFromStatistical(statistical, raw, margin) {
  const scale = raw.reduce((a, b) => a + b, 0) / 3;
  return normalizeProbabilities(statistical.map((p, i) => p * scale + margin[i]));
}
export function projectDraft(draft, settings, bankroll, model) {
  const raw = draft.horses.map(h => parseProbability(h.raw));
  const margins = draft.horses.map(h => draft.mode === 'split' ? parseProbability(h.margin) : 0);
  const legacy = normalizeProbabilities(raw.map((q, i) => q + margins[i]));
  const neutral = normalizeProbabilities(raw);
  let statistical = null, decision = legacy, applied = false, modelNote = '';
  if (model?.active) {
    if (draft.mode !== 'split') modelNote = '保守調整を分けた入力で補正を利用できます。';
    else if (draft.date <= model.trainedThrough) modelNote = '学習に使った日以前の予想には補正を適用しません。';
    else {
      statistical = transformProbabilities(neutral, model.theta);
      const identity = model.theta.a === 1 && model.theta.b === 0;
      const adjusted = statistical && (identity ? legacy : decisionFromStatistical(statistical, raw, margins));
      if (adjusted && probabilitiesValid(adjusted)) { decision = adjusted; applied = true; }
      else { statistical = null; modelNote = '補正後の確率条件を満たさないため、従来計算を表示しています。'; }
    }
  }
  const axis = draft.horses.findIndex(h => h.id === draft.axisId);
  const pairs = axis < 0 ? [] : draft.horses.flatMap((h, i) => {
    if (i === axis) return [];
    const oddsText = draft.odds[h.id] ?? '', odds = parseFloat(oddsText);
    const w = calcWideProb(decision[axis], decision[i]);
    const ev = Number.isFinite(odds) && odds > 0 ? calcEV(w, odds) : null;
    return [{partnerId: h.id, partnerIndex: i, axisId: draft.axisId, legacyProb: calcWideProb(legacy[axis], legacy[i]), probability: w, statisticalProb: statistical ? calcWideProb(statistical[axis], statistical[i]) : null, required: calcReqOdds(w, settings.evThreshold), oddsText, odds: Number.isFinite(odds) && odds > 0 ? odds : null, ev, recommended: ev !== null && ev >= settings.evThreshold, kelly: Number.isFinite(odds) && odds > 0 ? calcKellyRatio(w, odds, settings.kellyFraction) : 0, amount: Number.isFinite(odds) && odds > 0 ? calcBetAmount(bankroll, w, odds, settings.kellyFraction) : 0}];
  });
  return {raw, margins, legacy, neutral, statistical, decision, applied, modelNote, axis, pairs};
}
export function validateDraft(draft, projection, now = new Date()) {
  const errors = [];
  if (!draft.name.trim()) errors.push('レース名を入力してください。');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.date) || !Number.isFinite(Date.parse(draft.date))) errors.push('レース日を入力してください。');
  if (draft.horses.length < 4 || draft.horses.length > 18) errors.push('確定保存は4〜18頭で行ってください。');
  if (new Set(draft.horses.map(h => h.number)).size !== draft.horses.length || draft.horses.some(h => !Number.isInteger(h.number) || h.number < 1 || h.number > 18)) errors.push('馬番は1〜18の重複しない番号にしてください。');
  for (const h of draft.horses) {
    if (String(h.raw).trim() === '' || !Number.isFinite(Number(h.raw)) || Number(h.raw) < 0 || Number(h.raw) > 100) errors.push(`${h.number}番の見積もりを0〜100%で入力してください。`);
    if (draft.mode === 'split' && h.margin !== '' && (!Number.isFinite(Number(h.margin)) || Number(h.margin) < 0 || Number(h.margin) > 100)) errors.push(`${h.number}番の保守上乗せを0〜100ポイントで入力してください。`);
  }
  if (!probabilitiesValid(projection.legacy) || !probabilitiesValid(projection.decision)) errors.push('正規化後は各馬0〜100%、合計300%になる入力が必要です。値は自動で切り詰めません。');
  if (projection.axis < 0) errors.push('軸馬を1頭選んでください。');
  if (draft.timing === 'pre') {
    if (draft.date < todayJST(now)) errors.push('過去日の予想は「事後の記録」として保存してください。');
    if (draft.time && Date.parse(`${draft.date}T${draft.time}:00+09:00`) <= now.getTime()) errors.push('発走時刻を過ぎています。「事後の記録」に切り替えてください。');
  }
  if (draft.decision === 'bet') {
    const pair = projection.pairs.find(p => p.partnerId === draft.selectedPartner);
    if (!pair || !(pair.odds > 0)) errors.push('購入する相手と、記録時のワイドオッズを入力してください。');
    const stake = Number(draft.stake);
    if (!Number.isFinite(stake) || stake <= 0 || stake % 100 !== 0) errors.push('実購入額を100円単位で入力してください。');
  }
  return [...new Set(errors)];
}
export function createRace(draft, projection, settings, bankroll, model, now = new Date()) {
  const errors = validateDraft(draft, projection, now); if (errors.length) throw new Error(errors.join('\n'));
  const selected = projection.pairs.find(p => p.partnerId === draft.selectedPartner);
  return {id: draft.parentRaceId || draft.id, name: draft.name.trim(), date: draft.date, time: draft.time, course: draft.course, distance: draft.distance, notes: draft.notes, decision: draft.decision, provenance: 'manual', updatedAt: now.toISOString(), versions: [], snapshot: {id: uid(), savedAt: now.toISOString(), timing: draft.timing, engine: ENGINE_VERSION, input: clone(draft), settings: clone(settings), bankroll, horses: clone(draft.horses), axisId: draft.axisId, mode: draft.mode, legacy: [...projection.legacy], neutral: [...projection.neutral], statistical: projection.statistical ? [...projection.statistical] : null, decision: [...projection.decision], pairs: clone(projection.pairs), modelVersion: projection.applied ? model.id : null}, result: null, bets: draft.decision === 'bet' ? [{id: uid(), axisId: draft.axisId, partnerId: draft.selectedPartner, odds: selected.odds, probability: selected.probability, stake: Number(draft.stake), payout: null}] : []};
}
export function upsertRace(races, race) {
  const existing = races.find(r => r.id === race.id);
  if (!existing) return [race, ...races];
  if (existing.result) throw new Error('結果入力済みの事前予想は変更できません。');
  return races.map(r => r.id === race.id ? {...race, versions: [...(r.versions || []), r.snapshot]} : r);
}
export function emptyResult(race) { return {voidRace: false, entries: race.snapshot.horses.map(h => ({horseId: h.id, rank: '', status: 'finished'})), payouts: Object.fromEntries(race.bets.map(b => [b.id, b.payout ?? '']))}; }
export function validateResult(race, result) {
  if (result.voidRace) return [];
  const errors = [], ranks = [];
  if (result.entries.length !== race.snapshot.horses.length || new Set(result.entries.map(e => e.horseId)).size !== result.entries.length || race.snapshot.horses.some(h => !result.entries.some(e => e.horseId === h.id))) return ['全出走馬の結果が必要です。'];
  for (const e of result.entries) {
    const h = race.snapshot.horses.find(h => h.id === e.horseId);
    if (!['finished', 'dnf', 'dns', 'excluded'].includes(e.status)) errors.push(`${h.number}番の出走状態を選んでください。`);
    if (e.status === 'finished') { const rank = Number(e.rank); if (!Number.isInteger(rank) || rank < 1 || rank > race.snapshot.horses.length) errors.push(`${h.number}番の着順を入力してください。`); else ranks.push(rank); }
  }
  if (ranks.length === 0) errors.push('着順、またはレース不成立を記録してください。');
  ranks.sort((a, b) => a - b);
  for (let i = 0; i < ranks.length;) { if (ranks[i] !== i + 1) { errors.push('着順に抜けがあります。同着の次は、その頭数分を飛ばしてください。'); break; } const current = ranks[i]; while (i < ranks.length && ranks[i] === current) i++; }
  for (const b of race.bets) { const value = result.payouts?.[b.id]; if (value !== '' && value != null && (!Number.isInteger(Number(value)) || Number(value) < 0)) errors.push('払戻金は0以上の整数で入力してください。'); }
  return [...new Set(errors)];
}
export function wideOutcome(race, a, b, result = race.result) {
  if (!result) return null;
  if (result.voidRace) return 'refund';
  const x = result.entries.find(e => e.horseId === a), y = result.entries.find(e => e.horseId === b);
  if (!x || !y) return null;
  if ([x.status, y.status].some(s => s === 'dns' || s === 'excluded')) return 'refund';
  if ([x,y].some(e => e.status === 'finished' && (!Number.isInteger(Number(e.rank)) || Number(e.rank) < 1))) return null;
  return x.status === 'finished' && y.status === 'finished' && Number(x.rank) <= 3 && Number(y.rank) <= 3 && !(Number(x.rank) === 3 && Number(y.rank) === 3) ? 'hit' : 'miss';
}
export function betSettlement(race, bet) {
  const outcome = wideOutcome(race, bet.axisId, bet.partnerId) || bet.legacyOutcome || null;
  if (!outcome) return {outcome: null, net: null, payout: null};
  const payout = outcome === 'refund' ? bet.stake : outcome === 'miss' ? 0 : bet.payout === '' || bet.payout == null ? null : Number(bet.payout);
  return {outcome, payout, net: payout == null ? null : payout - bet.stake};
}
export function finances(races) {
  let profit = 0, settledStake = 0, payout = 0, bets = 0, hits = 0, missingPayout = 0;
  for (const race of races) for (const bet of race.bets) { const s = betSettlement(race, bet); if (s.net != null) profit += s.net; if (s.outcome === 'hit' || s.outcome === 'miss') { bets++; if (s.outcome === 'hit') hits++; if (s.payout == null) missingPayout++; else { settledStake += bet.stake; payout += s.payout; } } }
  return {profit, settledStake, payout, bets, hits, missingPayout, roi: settledStake ? payout / settledStake : null, hitRate: bets ? hits / bets : null};
}
export function bankroll(state) { return Math.max(0, state.settings.baseBankroll + finances(state.races).profit); }
