import {initialState, newDraft, newHorse, clone, todayJST, projectDraft, validateDraft, createRace, upsertRace, emptyResult, validateResult, wideOutcome, betSettlement, finances, bankroll, probabilitiesValid} from './modules/core.mjs';
import {observations, summarize, exclusionReason, runValidation, MIN_TRAIN_RACES, MIN_TEST_RACES} from './modules/analysis.mjs';
import {openStorage, exportBackup, decodeBackup, decodeLegacy, mergeImported, readLegacyStorage} from './modules/storage.mjs';

const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const num = (value, digits = 2) => Number.isFinite(value) ? value.toFixed(digits) : '—';
const pct = (value, digits = 1) => Number.isFinite(value) ? `${(value * 100).toFixed(digits)}%` : '—';
const yen = value => Number.isFinite(value) ? `${Math.round(value).toLocaleString('ja-JP')}円` : '—';
const selected = (a, b) => a === b ? ' selected' : '';
const checked = value => value ? ' checked' : '';
const horseLabel = h => h ? `${h.number}番${h.name ? ` ${h.name}` : ''}` : '未選択';
const badge = (text, color = '') => `<span class="badge ${color}">${esc(text)}</span>`;
const paths = {predict:['レース予想','M4 17V7m6 10V3m6 14v-6m6 6V5'],history:['レース記録','M5 3h14v18H5zM8 8h8M8 12h8M8 16h5'],analysis:['精度分析','M4 3v17h17M7 15l5-6 4 3 5-8'],calibration:['自動補正','M4 7h16M4 17h16M9 3v8m6 2v8'],settings:['設定・保存','M4 6h16M4 12h16M4 18h16M9 3v6m6 0v6m-7 0v6']};
const icon = path => `<svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${path}"/></svg>`;
let state = initialState(), storage = null, storageError = '', saveTimer, saveQueue = Promise.resolve(), dirty = false, toastTimer;
let page = 'predict', resultRaceId = null, resultDraft = null, historyFilter = 'all', historySearch = '', analysisOptions = {target:'horse',track:'decision',filter:'all',from:'',to:''}, validating = false, committing = false, resultDirty = false;
const header = (eyebrow, title, subtitle, actions = '') => `<div class="page-heading"><div><div class="eyebrow">${eyebrow}</div><h1>${title}</h1><p>${subtitle}</p></div>${actions ? `<div class="heading-actions">${actions}</div>` : ''}</div>`;
const panelTitle = (step, title, right = '') => `<div class="panel-header"><h2>${step ? `<span class="step-no">${step}</span>` : ''}${title}</h2>${right}</div>`;
const option = (value, text, current) => `<option value="${esc(value)}"${selected(value,current)}>${esc(text)}</option>`;
const empty = (title, detail, action = '') => `<div class="empty-state"><div class="empty-icon">${icon(paths.history[1])}</div><h2>${title}</h2><p>${detail}</p>${action}</div>`;
function notify(message) { $('toast').textContent = message; $('toast').classList.add('visible'); clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').classList.remove('visible'), 4200); }
function showStorageError(error) { storageError = error.message || String(error); $('storage-warning').innerHTML = `<div class="info-box error"><strong>保存できていません。</strong> ${esc(storageError)} 入力内容は「設定・保存」からJSONでバックアップできます。</div>`; $('save-status').textContent = '未保存'; $('save-status').classList.add('error'); }
async function persist(data = state) {
  clearTimeout(saveTimer); dirty = true; $('save-status').textContent = '保存中…';
  const copy = clone(data);
  const job = saveQueue.catch(() => {}).then(async () => { if (!storage) throw new Error(storageError || '端末内保存を利用できません。'); await storage.save(copy); });
  saveQueue = job;
  try { await job; if (saveQueue === job) { dirty = false; storageError='';$('storage-warning').innerHTML='';$('save-status').classList.remove('error');$('save-status').textContent = resultDirty?'結果は未保存':'端末に保存済み'; } }
  catch (error) { showStorageError(error); throw error; }
}
function scheduleSave() { dirty = true; $('save-status').textContent = '保存待ち'; clearTimeout(saveTimer); saveTimer = setTimeout(() => persist().catch(() => {}), 350); }
async function commit(next, message) { committing=true;$('main').inert=true;try{await persist(next); state = next; render(); if (message) notify(message);}finally{committing=false;$('main').inert=false;} }
function invalidate(next) { next.model = null; next.validation = null; }
function dialog(title, body, buttons = '<button class="btn primary" data-action="close-dialog">閉じる</button>') { $('dialog-content').innerHTML = `<h2>${title}</h2>${body}<div class="dialog-actions">${buttons}</div>`; $('confirm-dialog').showModal(); }
function failure(error) { dialog('内容を確認してください', `<p class="error-lines">${esc(error.message || error).replace(/\n/g,'<br>')}</p>`); }
function confirmAction(title, text, action, id = '') { dialog(title, `<p>${esc(text)}</p>`, `<button class="btn" data-action="close-dialog">キャンセル</button><button class="btn primary" data-action="${action}" data-id="${esc(id)}">実行する</button>`); }
function closeDialog() { $('confirm-dialog').close(); }
function navigate(next) { if (location.hash === `#${next}`) { page = next; render(); } else location.hash = next; }
function render() {
  const active = document.activeElement, focus = active?.id, start = active?.selectionStart, end = active?.selectionEnd;
  const scrolls = [...document.querySelectorAll('.table-scroll')].map(el => el.scrollLeft);
  $('breadcrumb').textContent = paths[page][0];
  $('navigation').innerHTML = Object.entries(paths).map(([id,[label,path]]) => `<a href="#${id}" class="nav-link${page===id?' active':''}"${page===id?' aria-current="page"':''}>${icon(path)}<span>${label}</span>${id==='history'&&state.races.length?`<small>${state.races.length}</small>`:''}</a>`).join('');
  $('mobile-navigation').innerHTML = Object.entries(paths).map(([id,[label,path]]) => `<a href="#${id}" class="${page===id?'active':''}"${page===id?' aria-current="page"':''}>${icon(path)}<span>${label.replace('・保存','').replace('レース','')}</span></a>`).join('');
  $('main').innerHTML = ({predict:renderPredict,history:renderHistory,analysis:renderAnalysis,calibration:renderCalibration,settings:renderSettings}[page])();
  if (focus && $(focus)) { $(focus).focus({preventScroll:true}); if (typeof start === 'number') { try { $(focus).setSelectionRange(start,end); } catch {} } }
  [...document.querySelectorAll('.table-scroll')].forEach((el,i) => { el.scrollLeft = scrolls[i] || 0; });
}
function renderPredict() {
  const d = state.draft, p = projectDraft(d,state.settings,bankroll(state),state.model), axis = d.horses[p.axis], chosen = p.pairs.find(q=>q.partnerId===d.selectedPartner), total = p.raw.reduce((a,b)=>a+b,0)+p.margins.reduce((a,b)=>a+b,0), valid = probabilitiesValid(p.decision);
  return header('PREDICT & RECORD','予想を、確かめられる記録に。','全馬の見積もりから、軸1頭のワイドを検討します。',`<button class="btn" data-action="new-race">＋ 新しいレース</button>`)+`
  ${d.parentRaceId?'<div class="info-box warning mb">保存済み予想の改訂中です。前の見積もりも履歴に残り、分析では最新の事前予想を1件として扱います。</div>':''}
  <div class="grid-two"><div>
  <section class="panel">${panelTitle('01','レース情報',badge(d.timing==='pre'?'事前の予想':'事後の記録',d.timing==='pre'?'green':'gold'))}
  <div class="panel-body"><div class="race-meta">
    <label class="field">レース名 <span class="required">必須</span><input id="race-name" data-field="name" value="${esc(d.name)}" placeholder="例：東京11R 毎日王冠" maxlength="100" autocomplete="off"></label>
    <label class="field">レース日<input id="race-date" data-field="date" type="date" value="${esc(d.date)}"></label>
    <label class="field">発走時刻 <span class="muted">任意・日本時間</span><input id="race-time" data-field="time" type="time" value="${esc(d.time)}"></label>
  </div><div class="meta-extra">
    <label class="field">競馬場<input id="race-course" data-field="course" value="${esc(d.course)}" placeholder="東京" maxlength="30"></label>
    <label class="field">条件・距離<input id="race-distance" data-field="distance" value="${esc(d.distance)}" placeholder="芝1800m" maxlength="50"></label>
    <label class="field">記録区分<select id="race-timing" data-field="timing">${option('pre','レース前の予想',d.timing)}${option('retrospective','事後の記録（分析対象外）',d.timing)}</select></label>
  </div></div></section>
  <section class="panel mt">${panelTitle('02','全馬の複勝率',`<div class="count-control"><button class="btn icon-only" data-action="remove-horse" aria-label="1頭減らす"${d.horses.length<=4?' disabled':''}>−</button><span>${d.horses.length}頭</span><button class="btn icon-only" data-action="add-horse" aria-label="1頭増やす"${d.horses.length>=18?' disabled':''}>＋</button></div>`)}
  <div class="mode-row"><label>入力方式 <select id="input-mode" data-field="mode">${option('legacy','従来どおりに入力',d.mode)}${option('split','見積もりと保守上乗せを分ける',d.mode)}</select></label>${badge(p.applied?'統計補正 適用中':'従来計算',p.applied?'green':'')}</div>
  <p class="mode-note">${d.mode==='split'?'「見積もり」に素直な評価を、「保守上乗せ」に買わない馬などへの加算ポイントを入力。統計補正は見積もりだけに学習させます。':'これまでと同じ複勝率を入力してください。保守的な上乗せを含めた値でも、旧サイトと同じ計算になります。'}</p>
  <div class="table-scroll"><table class="horse-table${d.mode==='split'?' with-margin':''}"><thead><tr><th>軸</th><th>馬番・馬名</th><th class="numeric">${d.mode==='split'?'見積もり':'複勝率'}</th>${d.mode==='split'?'<th class="numeric">保守上乗せ</th>':''}<th class="numeric">正規化後</th><th>扱い</th></tr></thead><tbody>
  ${d.horses.map((h,i)=>`<tr class="${h.id===d.axisId?'axis-row':''}"><td class="axis-cell" data-label="軸"><input id="axis-${h.id}" type="radio" name="axis" data-axis="${h.id}" aria-label="${h.number}番を軸にする"${checked(h.id===d.axisId)}></td><td class="horse-cell"><div class="horse-name"><input id="number-${h.id}" class="horse-no" data-horse="${h.id}" data-key="number" type="number" min="1" max="18" value="${h.number}" aria-label="馬番"><input id="name-${h.id}" data-horse="${h.id}" data-key="name" value="${esc(h.name)}" placeholder="馬名（任意）" maxlength="60" aria-label="${h.number}番の馬名"></div></td><td class="numeric probability-cell" data-label="${d.mode==='split'?'見積もり':'複勝率'}"><span class="percent-unit"><input id="raw-${h.id}" class="prob-input" inputmode="decimal" data-horse="${h.id}" data-key="raw" value="${esc(h.raw)}" placeholder="0" aria-label="${h.number}番の複勝率"><span>%</span></span></td>${d.mode==='split'?`<td class="numeric margin-cell" data-label="保守上乗せ"><span class="percent-unit"><input id="margin-${h.id}" class="prob-input" inputmode="decimal" data-horse="${h.id}" data-key="margin" value="${esc(h.margin)}" placeholder="0" aria-label="${h.number}番の保守上乗せ"><span>pt</span></span></td>`:''}<td class="numeric norm-cell norm-val${p.decision[i]>1?' negative':''}" data-label="正規化後">${pct(p.decision[i])}</td><td class="role-cell" data-label="扱い"><select id="role-${h.id}" class="role-select" data-horse="${h.id}" data-key="role" aria-label="${h.number}番の扱い">${option('observe','未指定',h.role)}${option('candidate','購入候補',h.role)}${option('exclude','買わない',h.role)}</select></td></tr>`).join('')}
  </tbody></table></div><div class="table-foot"><span>入力合計 <strong>${pct(total)}</strong></span><span class="total">正規化後 <strong>${pct(p.decision.reduce((a,b)=>a+b,0))}</strong></span></div>
  ${!valid&&total>0?'<div class="info-box warning">正規化後に100%を超える馬があります。計算式はそのまま表示していますが、この状態では確定保存できません。</div>':''}
  ${d.horses.length<8?'<div class="info-box warning">8頭未満でも従来の合計300%で計算します。複勝の対象着順が異なるため、精度分析・自動補正の対象には含めません。</div>':''}
  ${p.modelNote?`<div class="info-box">${esc(p.modelNote)}</div>`:''}</section>
  <section class="panel mt commit-panel">${panelTitle('03','判断を残す')}
  <div class="panel-body"><div class="decision-options">${[['watch','検討中'],['skip','見送り'],['bet','購入する']].map(([value,label])=>`<label class="choice${d.decision===value?' active':''}"><input type="radio" name="decision" data-field="decision" value="${value}"${checked(d.decision===value)}>${label}</label>`).join('')}</div>
  ${d.decision==='bet'?`<div class="inline-fields mt"><label class="field">購入する相手<select id="selected-partner" data-field="selectedPartner"><option value="">相手を選択</option>${p.pairs.map(q=>option(q.partnerId,horseLabel(d.horses[q.partnerIndex]),d.selectedPartner)).join('')}</select></label><label class="field">実購入額（円）<input id="actual-stake" data-field="stake" inputmode="numeric" value="${esc(d.stake)}" placeholder="100円単位"></label></div><p class="small muted">${chosen?`${esc(horseLabel(axis))} − ${esc(horseLabel(d.horses[chosen.partnerIndex]))} ／ 記録オッズ ${num(chosen.odds,1)}倍`:'右の一覧から相手とオッズを選んでください。'} 実購入額を記録しても、馬券は自動購入されません。</p>`:''}
  <label class="field notes-label">予想メモ<textarea id="race-notes" data-field="notes" rows="3" maxlength="5000" placeholder="能力評価、人気を落としている理由、見送った理由など">${esc(d.notes)}</textarea></label>
  <div class="commit-actions"><p>下書きは自動保存。確定時点の全馬の数値とオッズを残します。</p><button class="btn primary" data-action="save-race">${d.parentRaceId?'改訂した予想を保存':'予想を確定して保存'} <span aria-hidden="true">→</span></button></div></div></section>
  </div><aside class="sticky-calc"><section class="panel">
  <div class="calc-head"><div class="eyebrow">WIDE EXPECTED VALUE</div><div class="calc-title"><h2>ワイド期待値</h2>${badge(`EV ≥ ${num(state.settings.evThreshold,2)}`,'green')}</div><div class="calc-axis"><span>軸馬</span><strong>${esc(horseLabel(axis))}</strong><div class="big-num">${axis?pct(p.decision[p.axis]):'—'}</div></div></div>
  <div class="calc-settings"><span>資金 <strong>${yen(bankroll(state))}</strong></span><span>ケリー <strong>${state.settings.kellyFraction===1?'フル':state.settings.kellyFraction===.5?'½':'¼'}</strong></span><a href="#settings">変更</a></div>
  ${p.axis<0?'<div class="empty-inline"><strong>軸馬を選んでください</strong><p>左の表で軸を選ぶと、全相手の的中確率と必要オッズが表示されます。</p></div>':`<div class="table-scroll"><table class="calc-table"><thead><tr><th>相手</th><th class="numeric">的中率</th><th class="numeric">必要<br>オッズ</th><th class="numeric">現在<br>オッズ</th><th class="numeric">EV</th></tr></thead><tbody>${p.pairs.map(q=>`<tr class="pair-row${q.partnerId===d.selectedPartner?' selected':''}"><td class="pair-cell"><button class="pair-label" data-action="select-pair" data-id="${q.partnerId}" aria-label="${esc(horseLabel(d.horses[q.partnerIndex]))}を選択">${d.horses[q.partnerIndex].number}<span>${esc(d.horses[q.partnerIndex].name||'番')}</span></button></td><td class="numeric" data-label="推定的中率">${pct(q.probability)}</td><td class="numeric" data-label="必要オッズ">${num(q.required,1)}</td><td class="numeric" data-label="現在オッズ"><input id="odds-${q.partnerId}" class="odds-input" inputmode="decimal" data-odds="${q.partnerId}" value="${esc(q.oddsText)}" placeholder="—" aria-label="${d.horses[q.partnerIndex].number}番とのワイドオッズ"></td><td class="numeric" data-label="期待値（EV）"><span class="ev-pill${q.recommended?' positive':''}">${num(q.ev)}</span></td></tr>`).join('')}</tbody></table></div>`}
  ${chosen?`<div class="pair-detail"><h3>${axis.number} − ${d.horses[chosen.partnerIndex].number} の検討</h3><div class="detail-line"><span>推定的中確率</span><strong>${pct(chosen.probability,2)}</strong></div><div class="detail-line"><span>必要オッズ</span><strong>${num(chosen.required,2)}倍</strong></div><div class="detail-line"><span>期待値</span><strong>${num(chosen.ev,3)}</strong></div><div class="stake-hero"><span>ケリー基準の購入額</span><strong>${yen(chosen.amount)}</strong><small>資金の${pct(chosen.kelly,2)}・100円単位</small></div><button class="btn soft full-width" data-action="use-stake">この組み合わせを購入記録に使う</button></div>`:'<p class="mode-note">相手の馬番を押すと、購入額の目安を確認できます。オッズに幅がある場合は、採用する値を入力してください。</p>'}
  </section><div class="sidebar-stat"><strong>条件に合わなければ、見送り。</strong><p>一強の軸馬と相手1頭を検討するための計算です。購入の判断はご自身で行います。</p></div></aside></div>`;
}

function renderHistory() {
  if (resultRaceId) return renderResult();
  const finance = finances(state.races), waiting = state.races.filter(r=>!r.result).length;
  const races = state.races.filter(r=>(historyFilter==='all'||historyFilter==='waiting'&&!r.result||historyFilter==='done'&&r.result||historyFilter==='bet'&&r.bets.length||historyFilter==='skip'&&r.decision==='skip') && `${r.name} ${r.date} ${r.course}`.toLowerCase().includes(historySearch.toLowerCase())).sort((a,b)=>b.date.localeCompare(a.date));
  return header('RACE JOURNAL','予想と結果を、ひとつずつ。','買ったレースも、見送ったレースも。全馬の着順を手入力で記録します。',`<a class="btn primary" href="#predict">予想を入力する</a>`)+`
  <div class="stat-grid"><div class="stat-card"><span class="label">保存したレース</span><strong class="value">${state.races.length}<small>レース</small></strong><span class="sub">結果待ち ${waiting}レース</span></div><div class="stat-card"><span class="label">購入ワイドの的中率</span><strong class="value">${pct(finance.hitRate)}</strong><span class="sub">${finance.hits}的中 / ${finance.bets}件・返還を除く</span></div><div class="stat-card"><span class="label">回収率</span><strong class="value">${pct(finance.roi)}</strong><span class="sub">払戻額まで確定した購入記録</span></div><div class="stat-card emphasis"><span class="label">確定した収支</span><strong class="value">${finance.profit>0?'+':''}${yen(finance.profit)}</strong><span class="sub">${finance.missingPayout?`的中 ${finance.missingPayout}件の払戻額が未入力`:'払戻金 − 購入額'}</span></div></div>
  <section class="panel mt"><div class="filters"><label class="field">絞り込み<select id="history-filter" data-ui="historyFilter">${[['all','すべて'],['waiting','結果待ち'],['done','結果入力済み'],['bet','購入したレース'],['skip','見送ったレース']].map(([v,t])=>option(v,t,historyFilter)).join('')}</select></label><label class="field search-field">レースを検索<input id="history-search" data-ui="historySearch" value="${esc(historySearch)}" placeholder="レース名・日付・競馬場"></label></div>
  ${races.length?`<div class="race-list">${races.map(r=>{const axis=r.snapshot.horses.find(h=>h.id===r.snapshot.axisId),settlements=r.bets.map(b=>betSettlement(r,b)),net=settlements.filter(s=>s.net!=null).reduce((a,b)=>a+b.net,0);return `<article class="race-card"><div class="race-date"><strong>${esc(r.date.slice(5).replace('-','/'))}</strong><span>${esc(r.date.slice(0,4))}</span></div><div class="race-card-content"><h3>${esc(r.name)}</h3><p>${esc(r.course||'競馬場未指定')} ${esc(r.distance||'')} · ${r.snapshot.horses.length}頭 · 軸 ${esc(horseLabel(axis))}</p><div class="race-tags">${badge(r.result?'結果入力済み':'結果待ち',r.result?'green':'gold')}${badge(r.decision==='bet'?'購入':r.decision==='skip'?'見送り':'検討のみ')}${r.snapshot.timing!=='pre'?badge(r.snapshot.timing==='unknown'?'旧データ・分析対象外':'事後記録・分析対象外'):''}${r.snapshot.modelVersion?badge('補正あり','green'):''}${settlements.some(s=>s.net!=null)?badge(`${net>0?'+':''}${yen(net)}`,net>=0?'green':'red'):''}</div></div><div class="race-card-actions"><button class="btn${r.result?'':' soft'}" data-action="open-result" data-id="${esc(r.id)}">${r.result?'結果を確認・編集':'結果を入力'}</button><button class="text-link" data-action="show-snapshot" data-id="${esc(r.id)}">保存した予想</button></div></article>`;}).join('')}</div>`:empty(state.races.length?'該当するレースがありません':'まだレースの記録がありません',state.races.length?'条件を変えて検索してください。':'まずは全馬の複勝率を入力して、レース前に予想を確定保存してください。',state.races.length?'':'<a class="btn primary" href="#predict">最初の予想を記録する</a>')}
  </section>`;
}
function renderResult() {
  const r = state.races.find(r=>r.id===resultRaceId); if (!r) {resultRaceId=null;return renderHistory();}
  const d = resultDraft, s = r.snapshot;
  return header('RACE RESULT',esc(r.name),`${esc(r.date)} · ${s.horses.length}頭 · 保存済みの予想に結果を追加します。`,'<button class="btn" data-action="back-history">← レース一覧</button>')+`
  <div class="result-grid"><section class="panel">${panelTitle('01','全馬の着順')}
  <div class="panel-body"><label class="check-line"><input id="void-race" type="checkbox" data-result="void"${checked(d.voidRace)}>レース不成立・全額返還</label><p class="small muted">同着は同じ着順を入力します。例：1、2、3、3、5。中止・取消・除外の馬は状態を変更してください。</p></div>
  <div class="table-scroll"><table class="result-table"><thead><tr><th>馬番・馬名</th><th>予想複勝率</th><th>着順</th><th>状態</th></tr></thead><tbody>${s.horses.map((h,i)=>{const e=d.entries.find(e=>e.horseId===h.id);return `<tr><td><span class="readonly-name">${esc(horseLabel(h))}</span> ${h.id===s.axisId?badge('軸','green'):''}</td><td>${pct(s.decision[i])}</td><td><input id="rank-${h.id}" class="rank-input" data-result-horse="${h.id}" data-result-key="rank" inputmode="numeric" value="${esc(e.rank??'')}" placeholder="—" aria-label="${h.number}番の着順"${e.status!=='finished'||d.voidRace?' disabled':''}></td><td><select id="finish-${h.id}" data-result-horse="${h.id}" data-result-key="status" aria-label="${h.number}番の出走状態"${d.voidRace?' disabled':''}>${[['finished','完走'],['dnf','競走中止'],['dns','出走取消'],['excluded','除外']].map(([v,t])=>option(v,t,e.status)).join('')}</select></td></tr>`;}).join('')}</tbody></table></div>
  <div class="panel-body"><button class="btn primary" data-action="save-result">結果を保存する</button><p class="small muted">結果は保存ボタンで確定します。予想時点の数値は変更されません。</p></div></section>
  <aside><section class="panel">${panelTitle('02','購入と払戻金')}<div class="panel-body">${r.bets.length?r.bets.map(b=>{const a=s.horses.find(h=>h.id===b.axisId),p=s.horses.find(h=>h.id===b.partnerId),out=wideOutcome(r,b.axisId,b.partnerId,d), labels={hit:'的中',miss:'不的中',refund:'返還'};return `<div class="bet-result"><h3>ワイド ${a.number} − ${p.number} ${out?badge(labels[out],out==='hit'?'green':''):''}</h3><div class="detail-line"><span>購入額</span><strong>${yen(b.stake)}</strong></div><div class="detail-line"><span>記録時の的中確率</span><strong>${pct(b.probability,2)}</strong></div><div class="detail-line"><span>記録時オッズ</span><strong>${num(b.odds,1)}倍</strong></div>${out==='hit'?`<label class="field mt">実際の払戻金・総額（円）<input id="payout-${esc(b.id)}" data-payout="${esc(b.id)}" inputmode="numeric" value="${esc(d.payouts[b.id]??'')}" placeholder="この購入分の払戻総額"></label><p class="small muted">100円あたりの配当ではなく、この馬券で受け取った総額です。未入力なら収支は未確定として扱います。</p>`:out==='refund'?`<p class="info-box">${yen(b.stake)}の返還として記録します。</p>`:out==='miss'?'<p class="small muted">払戻金は0円として記録します。</p>':'<p class="small muted">着順を入力すると的中・不的中を判定します。</p>'}</div>`;}).join(''):'<p class="muted">このレースに購入記録はありません。着順は予想精度の分析に使われます。</p>'}</div></section>
  <section class="panel mt">${panelTitle('','記録について')}<div class="panel-body"><p class="small">${s.timing==='pre'?'事前保存した予想です。通常の8頭以上のレースを精度分析に含めます。':'事前保存を確認できない記録です。収支は記録しますが、精度分析と補正の学習には含めません。'}</p><p class="small muted">取消・除外・上位の同着を含むレースは分析対象外です。購入ワイドの結果は個別に判定します。</p><button class="text-link" data-action="show-snapshot" data-id="${esc(r.id)}">保存した予想を確認</button></div></section></aside></div>`;
}
function renderSnapshot(r) {
  const s=r.snapshot,canRevise=!r.result&&s.input&&r.date>=todayJST()&&(!r.time||Date.parse(`${r.date}T${r.time}:00+09:00`)>Date.now());
  dialog(esc(r.name),`<p class="small muted">${esc(r.date)} · ${s.timing==='pre'?'事前予想':s.timing==='unknown'?'保存区分未確認':'事後記録'} · ${esc(new Date(s.savedAt).toLocaleString('ja-JP',{timeZone:'Asia/Tokyo'}))} 保存</p><div class="table-scroll"><table class="result-table"><thead><tr><th>馬</th><th>入力</th><th>保守上乗せ</th><th>従来計算</th><th>使用した値</th></tr></thead><tbody>${s.horses.map((h,i)=>`<tr><td>${esc(horseLabel(h))}${h.id===s.axisId?'（軸）':''}</td><td>${esc(h.raw)}%</td><td>${s.mode==='split'?esc(h.margin||'0'):'—'}</td><td>${pct(s.legacy[i],2)}</td><td>${pct(s.decision[i],2)}</td></tr>`).join('')}</tbody></table></div>${r.notes?`<p class="pre-wrap">${esc(r.notes)}</p>`:''}<p class="small muted">計算版 ${esc(s.engine)} · 過去の改訂 ${r.versions?.length||0}件${s.modelVersion?' · 統計補正あり':''}</p>${r.versions?.length?`<details><summary>改訂前の予想</summary>${r.versions.map(v=>`<p class="small">${esc(v.savedAt)} ／ ${v.horses.map((h,i)=>`${esc(horseLabel(h))}: ${pct(v.decision[i])}`).join('、')}</p>`).join('')}</details>`:''}`,`<button class="btn danger small" data-action="ask-delete" data-id="${esc(r.id)}">記録を削除</button>${canRevise?`<button class="btn" data-action="revise-race" data-id="${esc(r.id)}">予想を改訂</button>`:''}<button class="btn primary" data-action="close-dialog">閉じる</button>`);
}
function calibrationChart(summary) {
  const x=p=>52+p*350,y=p=>350-p*304;
  return `<svg viewBox="0 0 450 405" role="img" aria-label="横軸は推定複勝率、縦軸は実際の的中率。破線は両者が一致する線です。"><rect x="52" y="46" width="350" height="304" fill="#f9faf6"/>${[0,.2,.4,.6,.8,1].map(t=>`<line x1="52" y1="${y(t)}" x2="402" y2="${y(t)}" stroke="#e0e5df"/><text x="42" y="${y(t)+4}" text-anchor="end" fill="#737d74" font-size="11">${t*100}%</text><text x="${x(t)}" y="371" text-anchor="middle" fill="#737d74" font-size="11">${t*100}%</text>`).join('')}<line x1="52" y1="350" x2="402" y2="46" stroke="#a8b5a6" stroke-width="1.5" stroke-dasharray="6 6"/>${summary.bins.filter(b=>b.n).map(b=>`<circle cx="${x(b.predicted)}" cy="${y(b.actual)}" r="${Math.min(10,4+Math.sqrt(b.n)/3)}" fill="#1e6b50" stroke="#fff" stroke-width="2"><title>推定${pct(b.predicted)}・実測${pct(b.actual)}・${b.n}件</title></circle>`).join('')}<text x="227" y="399" text-anchor="middle" fill="#526157" font-size="12">推定確率</text><text x="52" y="26" fill="#526157" font-size="12">実際の的中率</text></svg>`;
}
function exclusionsView(exclusions) { return Object.keys(exclusions).length?`<details class="exclusions"><summary>分析から除外したレース</summary><div class="microstats">${Object.entries(exclusions).map(([k,v])=>`<span>${esc(k)} <strong>${v}件</strong></span>`).join('')}</div></details>`:''; }
function renderAnalysis() {
  const {data,exclusions}=observations(state.races,analysisOptions),s=summarize(data),wide=analysisOptions.target==='wide';
  const filters=wide?[['all','軸 × 全相手'],['candidate','軸 × 購入候補'],['exclude','軸 × 買わない馬'],['purchased','実際に購入した組み合わせ']]:[['all','全馬'],['axis','軸馬'],['candidate','軸・購入候補'],['exclude','買わない馬']];
  return header('FORECAST ACCURACY','見積もりと実測を比べる。','事前に確定した予想と、手入力した結果を比較します。')+`
  <div class="track-options"><button data-action="analysis-target" data-id="horse" class="${!wide?'active':''}">全馬の複勝率</button><button data-action="analysis-target" data-id="wide" class="${wide?'active':''}">ワイド的中確率</button></div>
  <section class="panel"><div class="filters analysis-filters"><label class="field">比較する予想<select id="analysis-track" data-analysis="track">${[['decision','保存時に使用した確率'],['legacy','従来計算の確率'],['neutral','保守上乗せ前の見積もり'],['statistical','統計補正後・保守上乗せ前']].map(([v,t])=>option(v,t,analysisOptions.track)).join('')}</select></label><label class="field">対象<select id="analysis-filter" data-analysis="filter">${filters.map(([v,t])=>option(v,t,analysisOptions.filter)).join('')}</select></label><label class="field">開始日<input id="analysis-from" type="date" data-analysis="from" value="${esc(analysisOptions.from)}"></label><label class="field">終了日<input id="analysis-to" type="date" data-analysis="to" value="${esc(analysisOptions.to)}"></label></div></section>
  <div class="stat-grid mt"><div class="stat-card"><span class="label">分析対象</span><strong class="value">${s.n.toLocaleString()}<small>${wide?'組':'頭'}</small></strong><span class="sub">${s.races}レース</span></div><div class="stat-card"><span class="label">平均した推定確率</span><strong class="value">${pct(s.mean)}</strong><span class="sub">保存時の値をそのまま使用</span></div><div class="stat-card"><span class="label">実際の的中率</span><strong class="value">${pct(s.actual)}</strong><span class="sub">${s.hits}的中 / ${s.n}件</span></div><div class="stat-card emphasis"><span class="label">Brierスコア</span><strong class="value">${num(s.brier,4)}</strong><span class="sub">小さいほど予測誤差が小さい</span></div></div>
  <section class="panel mt">${panelTitle('','確率帯ごとの精度',badge(wide?'軸と相手のペア':'3着以内の予想'))}
  ${s.n?`<div class="chart-layout"><div class="chart-wrap">${calibrationChart(s)}<div class="chart-note"><span class="legend-dot"></span>記録から集計 <span class="legend-line"></span>推定と実測が一致</div></div><div class="table-scroll"><table class="result-table"><thead><tr><th>確率帯</th><th>件数</th><th>平均推定</th><th>実測</th></tr></thead><tbody>${s.bins.map(b=>`<tr><td>${b.index*10}–${(b.index+1)*10}%${b.index===9?'':'未満'}</td><td>${b.n}</td><td>${pct(b.predicted)}</td><td>${pct(b.actual)}</td></tr>`).join('')}</tbody></table></div></div><div class="panel-body"><p class="small muted">対数損失 ${num(s.logLoss,4)}。各頭・各ペアを1件として集計しています。同じレース内の予想は独立ではありません。少数の確率帯は数件の結果で大きく動きます。</p>${!wide&&analysisOptions.filter==='all'?'<p class="small muted">全馬の平均は合計300%の制約を受けるため、平均値だけでは精度を判断できません。確率帯ごとの実測と誤差も確認してください。</p>':''}</div>`:empty('分析する結果がまだありません','通常の8頭以上のレースを事前保存し、全馬の着順を入力すると表示されます。','<a class="btn soft" href="#history">レース記録を開く</a>')}
  ${exclusionsView(exclusions)}</section><p class="small muted mt">ワイドは保存した軸と全相手を評価します。実際に購入した組み合わせだけに絞ることもできます。取消・除外・上位の同着・事後入力は精度分析から除外します。</p>`;
}

function renderCalibration() {
  const eligible=state.races.filter(r=>!exclusionReason(r,true)).length,v=state.validation,active=state.model?.active;
  return header('CALIBRATION LAB','補正は、改善を確かめてから。','統計的な精度改善と、購入時の保守的な評価を分けて扱います。',badge(active?'将来の予想に適用中':'自動補正 OFF',active?'green':''))+`
  <section class="panel validation-intro"><div class="panel-body"><h2>見積もりを学習し、保守上乗せはその後に。</h2><p>学習するのは「保守上乗せ前」の予想です。補正した確率に、買わない馬などへの上乗せを加え、合計300%に正規化します。入力した元の数値と従来計算も保存します。</p><div class="progress-steps"><div class="progress-step"><span>01</span><strong>過去だけで学習</strong><p>日付順に、前日までのレースから補正式を選びます。</p></div><div class="progress-step"><span>02</span><strong>次の日で検証</strong><p>同じ日のレースをまとめて、学習に使わず評価します。</p></div><div class="progress-step"><span>03</span><strong>改善後に有効化</strong><p>保守上乗せ後とワイドの精度も確認します。</p></div></div></div></section>
  <div class="grid-two mt"><section class="panel">${panelTitle('','検証に使える記録',badge(`${eligible}レース`))}<div class="panel-body"><p>「見積もりと保守上乗せを分ける」で事前保存し、全馬の着順を入力した通常レースが対象です。購入しなかったレースも含みます。</p><div class="microstats"><span>学習 <strong>${MIN_TRAIN_RACES}レース以上</strong></span><span>未使用の検証 <strong>${MIN_TEST_RACES}レース以上</strong></span></div><p class="small muted">これは検証を開始する最低件数です。十分な精度や将来の改善を保証する件数ではありません。同日のレースだけでは前後に分割できません。</p><button class="btn primary" data-action="run-validation"${validating?' disabled':''}>${validating?'時系列で検証しています…':'蓄積したデータで検証する'}</button></div></section>
  <section class="panel">${panelTitle('','適用状態')}<div class="panel-body"><h3>${active?'統計補正を有効にしています':'従来の計算を使用しています'}</h3><p>${active?`${esc(state.model.trainedThrough)}までのデータで学習した補正を、それより後の日付の予想に適用します。`:'検証で改善が確認された場合だけ、ご自身で有効にできます。保存済みの予想は補正によって書き換わりません。'}</p>${active?'<button class="btn" data-action="disable-model">補正を無効にする</button>':v?.status==='accepted'?'<button class="btn primary" data-action="enable-model">検証済みの補正を有効にする</button>':'<span class="small muted">検証済みモデルはありません。</span>'}<p class="small muted mt">結果の追加・訂正や移行でデータが変わったら、再検証します。</p></div></section></div>
  ${v?`<section class="panel mt">${panelTitle('','時系列検証の結果',badge(v.status==='accepted'?'改善を確認':v.status==='insufficient'?'データ不足':'改善は未確認',v.status==='accepted'?'green':'gold'))}<div class="panel-body"><p>${esc(v.message)}</p>${v.status!=='insufficient'?`<p class="small muted">検証期間 ${esc(v.testFrom)} 〜 ${esc(v.testTo)} · ${v.testCount}レース · 補正が無効なため従来値を使ったレース ${v.fallbackCount}件</p><div class="table-scroll"><table class="result-table"><thead><tr><th>Brierスコア</th><th>補正前</th><th>補正後</th><th>改善幅の95%区間</th></tr></thead><tbody>${[['見積もり',v.before,v.after,v.horse],['保守上乗せ後',v.decisionBefore,v.decisionAfter,v.decision],['軸とのワイド',v.wideBefore,v.wideAfter,v.wide]].map(([label,b,a,ci])=>`<tr><td>${label}</td><td>${num(b,5)}</td><td>${num(a,5)}</td><td>${num(ci.low,5)} 〜 ${num(ci.high,5)}</td></tr>`).join('')}</tbody></table></div><p class="small muted">改善幅＝補正前 − 補正後。正なら改善です。レース単位で2,000回再抽出した区間を表示します。見積もりの区間下限が0より大きく、保守上乗せ後とワイドの下限が0以上の場合を有効化の条件にしています。</p>`:`<p class="small muted">対象 ${v.eligible}レース ／ 時系列で評価できた未使用レース ${v.testCount}件</p>`}</div>${exclusionsView(v.excluded)}</section>`:''}
  <p class="small muted mt">候補の補正式と判定ルールは固定しています。繰り返し同じ検証結果を見てルールを調整すると過大評価につながるため、新たなレースの結果で継続して確認してください。手入力の事前記録であり、保存時刻を外部で証明する仕組みはありません。</p>`;
}
function renderSettings() {
  const f=finances(state.races);
  return header('SETTINGS & BACKUP','記録を、手元に残す。','計算の設定と、端末内データのバックアップを管理します。')+`
  <div class="settings-grid"><section class="panel">${panelTitle('','計算設定')}<form id="settings-form" class="panel-body settings-form"><label class="field">現在の計算用資金（円）<input id="setting-bankroll" name="bankroll" inputmode="numeric" value="${bankroll(state)}" required></label><p class="small muted">確定収支を反映した現在値です。入出金した場合は、この金額を変更してください。未決着の購入額は差し引きません。</p><label class="field">購入検討の期待値基準<input id="setting-threshold" name="threshold" inputmode="decimal" value="${state.settings.evThreshold}" required></label><label class="field">ケリーの割合<select id="setting-kelly" name="kelly">${option('0.25','¼ ケリー（25%）',String(state.settings.kellyFraction))}${option('0.5','½ ケリー（50%）',String(state.settings.kellyFraction))}${option('1','フルケリー（100%）',String(state.settings.kellyFraction))}</select></label><p class="small muted">購入額の計算は旧サイトを継承し、100円単位で切り捨てます。入力した実購入額は別に保存します。</p><button class="btn primary" type="submit">設定を保存</button></form></section>
  <div><section class="panel">${panelTitle('','バックアップ')}<div class="panel-body"><p>記録はこのブラウザーだけに保存されます。別の端末との同期はありません。ブラウザーのデータ削除や端末変更に備えて、JSONを保存してください。</p><div class="microstats"><span>レース <strong>${state.races.length}件</strong></span><span>購入記録 <strong>${state.races.reduce((n,r)=>n+r.bets.length,0)}件</strong></span></div><div class="button-row"><button class="btn primary" data-action="export">JSONをダウンロード</button><button class="btn" data-action="choose-import">JSONから取り込む</button></div><p class="small muted">同じIDの記録は重複追加しません。補正モデルは移行後に再検証します。GitHubへ予想や結果を送信する機能はありません。</p></div></section>
  <section class="panel mt">${panelTitle('','旧サイトの記録を移行')}<div class="panel-body"><p>同じブラウザーに保存された旧サイトのレースを読み取れます。旧サイトの記録はそのまま残ります。</p><button class="btn soft" data-action="import-legacy">旧サイトの保存データを確認</button><p class="small muted">事前保存の確認や全馬の結果がない旧記録は、精度分析と補正の学習から除外します。移行できない購入履歴がある場合は、取り込み前に件数を表示します。プリセットは移行しません。</p></div></section></div></div>
  <section class="panel mt">${panelTitle('','計算とデータについて')}<div class="panel-body"><p>従来計算の版：<code>legacy-8d2a86b-1</code>。全馬の入力を合計300%に正規化し、手動で選んだ軸からワイド的中確率を計算します。確定収支は ${yen(f.profit)} です。</p><div class="button-row"><a class="btn" href="./docs/guide.html" target="_blank" rel="noopener">使い方・計算式・検証方法 ↗</a><a class="text-link" href="../" target="_blank" rel="noopener">旧サイトを開く ↗</a></div></div></section>`;
}

let pendingImport=null;
function previewImport(parsed) {
  const merged=mergeImported(state.races,parsed.races);pendingImport=parsed;
  dialog('バックアップの内容を確認',`<p>${parsed.kind==='legacy'?'旧サイト':'新サイト'}の記録 ${parsed.races.length}件を読み込みました。</p><p><strong>${merged.added}件を追加</strong>し、同じIDの${merged.skipped}件はスキップします。現在の予想や結果を上書きしません。</p>${parsed.warnings?.length?`<div class="info-box warning">${parsed.warnings.map(esc).join('<br>')}</div>`:''}${parsed.settings?'<label class="check-line mt"><input id="restore-settings" type="checkbox">計算設定と資金をバックアップから復元する</label><p class="small muted">全記録を戻すときに選択してください。記録の一部だけを追加する場合、資金は設定画面で確認してください。</p>':''}<p class="small muted">下書きと補正モデルは取り込みません。レース記録と全馬の予想・結果を追加します。</p>`,`<button class="btn" data-action="close-dialog">キャンセル</button><button class="btn primary" data-action="confirm-import">${merged.added}件を取り込む</button>`);
}
function downloadBackup() {
  const data=exportBackup(state),url=URL.createObjectURL(new Blob([data],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download=`wide-ev-backup-${todayJST()}.json`;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),5000);notify('バックアップのダウンロードを開始しました。');
}
const dataSignature = races => JSON.stringify(races.map(r=>[r.id,r.snapshot.id,r.result]));
async function validateModel() {
  if(validating)return;validating=true;render();
  const records=clone(state.races),signature=dataSignature(records);
  try {
    const result=typeof Worker==='function'?await new Promise((resolve,reject)=>{
      const worker=new Worker(new URL('./modules/validation-worker.mjs',import.meta.url),{type:'module'});
      worker.onmessage=({data})=>{worker.terminate();data.ok?resolve(data.result):reject(new Error(data.error));};
      worker.onerror=event=>{worker.terminate();reject(new Error(event.message||'検証処理を実行できませんでした。'));};
      worker.postMessage(records);
    }):runValidation(records);
    if(signature!==dataSignature(state.races))throw new Error('検証中に記録が変わりました。もう一度検証してください。');
    const next=clone(state);next.validation=result;next.model=null;await commit(next,'時系列検証を完了しました。');
  } finally {validating=false;render();}
}

async function action(name,id,el) {
  if(committing)return;
  if(name==='close-dialog'){closeDialog();return;}
  if(name==='new-race'){if(state.draft.horses.some(h=>h.raw!=='')||state.draft.name){confirmAction('新しいレースを入力','現在の下書きを新しいレースに切り替えます。確定保存した予想は残ります。','confirm-new');}else{state.draft=newDraft(8);scheduleSave();render();}return;}
  if(name==='confirm-new'){closeDialog();const next=clone(state);next.draft=newDraft(8);await commit(next,'新しい下書きを作成しました。');return;}
  if(name==='add-horse'||name==='remove-horse'){
    const d=state.draft;if(name==='add-horse'&&d.horses.length<18){const used=new Set(d.horses.map(h=>h.number));d.horses.push(newHorse(Array.from({length:18},(_,i)=>i+1).find(n=>!used.has(n))));}
    if(name==='remove-horse'&&d.horses.length>4){const h=d.horses[d.horses.length-1];if(h.raw||h.name){confirmAction('最後の馬を外す',`${h.number}番の入力を下書きから外します。`,'confirm-remove-horse',h.id);return;}removeHorse(h.id);}
    scheduleSave();render();return;
  }
  if(name==='confirm-remove-horse'){closeDialog();removeHorse(id);scheduleSave();render();return;}
  if(name==='select-pair'){state.draft.selectedPartner=id;scheduleSave();render();return;}
  if(name==='use-stake'){const p=projectDraft(state.draft,state.settings,bankroll(state),state.model).pairs.find(p=>p.partnerId===state.draft.selectedPartner);if(!p)return;state.draft.decision='bet';state.draft.stake=String(p.amount);scheduleSave();render();$('actual-stake')?.focus();return;}
  if(name==='save-race'){
    const p=projectDraft(state.draft,state.settings,bankroll(state),state.model),errors=validateDraft(state.draft,p);if(errors.length)throw new Error(errors.join('\n'));
    const race=createRace(state.draft,p,state.settings,bankroll(state),state.model),next=clone(state);next.races=upsertRace(next.races,race);next.draft=newDraft(state.draft.horses.length);await commit(next,'予想時点の全馬の数値を保存しました。');navigate('history');return;
  }
  if(name==='show-snapshot'){const r=state.races.find(r=>r.id===id);if(r)renderSnapshot(r);return;}
  if(name==='open-result'){
    const r=state.races.find(r=>r.id===id);if(!r)return;resultRaceId=id;resultDirty=false;resultDraft=r.result?{...clone(r.result),payouts:Object.fromEntries(r.bets.map(b=>[b.id,b.payout??'']))}:emptyResult(r);render();window.scrollTo({top:0,behavior:'smooth'});return;
  }
  if(name==='back-history'){if(resultDirty){confirmAction('結果の入力を破棄','まだ保存していない結果を破棄して、一覧に戻ります。','discard-results');return;}resultRaceId=null;resultDraft=null;render();return;}
  if(name==='discard-results'){closeDialog();resultRaceId=null;resultDraft=null;resultDirty=false;$('save-status').textContent=storageError?'未保存':dirty?'保存待ち':'端末に保存済み';render();return;}
  if(name==='save-result'){
    const r=state.races.find(r=>r.id===resultRaceId),errors=validateResult(r,resultDraft);if(errors.length)throw new Error(errors.join('\n'));
    const next=clone(state),target=next.races.find(r=>r.id===resultRaceId),d=clone(resultDraft);target.result={voidRace:d.voidRace,entries:d.entries.map(e=>({...e,rank:e.status==='finished'&&e.rank!==''?Number(e.rank):null})),savedAt:new Date().toISOString()};
    target.bets=target.bets.map(b=>({...b,payout:d.payouts[b.id]===''||d.payouts[b.id]==null?null:Number(d.payouts[b.id])}));target.updatedAt=new Date().toISOString();invalidate(next);await commit(next,'結果を保存しました。精度分析に反映しています。');resultRaceId=null;resultDraft=null;resultDirty=false;$('save-status').textContent='端末に保存済み';render();return;
  }
  if(name==='ask-delete'){closeDialog();confirmAction('このレースを削除','予想・結果・購入記録と改訂履歴を削除します。収支も再計算されます。必要な記録は先にJSONで保存してください。','delete-race',id);return;}
  if(name==='delete-race'){const next=clone(state);next.races=next.races.filter(r=>r.id!==id);invalidate(next);closeDialog();resultRaceId=null;resultDraft=null;await commit(next,'レースを削除しました。');return;}
  if(name==='revise-race'){
    const r=state.races.find(r=>r.id===id);if(!r||r.result||!r.snapshot.input)throw new Error('この予想は変更できません。');
    if(r.date<todayJST()||r.time&&Date.parse(`${r.date}T${r.time}:00+09:00`)<=Date.now())throw new Error('発走後の事前予想は改訂できません。');
    closeDialog();confirmAction('保存した予想を改訂','現在の下書きを、保存済み予想に切り替えます。改訂を保存しても前の予想は履歴に残ります。','confirm-revise',id);return;
  }
  if(name==='confirm-revise'){const r=state.races.find(r=>r.id===id);if(!r||r.result)throw new Error('この予想は変更できません。');const next=clone(state);next.draft={...clone(r.snapshot.input),parentRaceId:r.id};closeDialog();await commit(next);navigate('predict');return;}
  if(name==='analysis-target'){analysisOptions={...analysisOptions,target:id,filter:'all'};render();return;}
  if(name==='run-validation'){await validateModel();return;}
  if(name==='enable-model'){if(state.validation?.status!=='accepted')throw new Error('先に時系列検証で改善を確認してください。');const next=clone(state);next.model={...clone(state.validation.model),active:true};await commit(next,'検証済みの補正を有効にしました。');return;}
  if(name==='disable-model'){const next=clone(state);if(next.model)next.model.active=false;await commit(next,'従来計算に切り替えました。');return;}
  if(name==='export'){downloadBackup();return;}
  if(name==='choose-import'){$('import-file').click();return;}
  if(name==='import-legacy'){previewImport(decodeLegacy(readLegacyStorage()));return;}
  if(name==='confirm-import'){
    if(!pendingImport)return;const merged=mergeImported(state.races,pendingImport.races),next=clone(state);next.races=merged.races;if($('restore-settings')?.checked&&pendingImport.settings)next.settings=clone(pendingImport.settings);invalidate(next);closeDialog();await commit(next,`${merged.added}件のレースを追加しました。`);pendingImport=null;return;
  }
}
function removeHorse(id){const d=state.draft;d.horses=d.horses.filter(h=>h.id!==id);delete d.odds[id];if(d.axisId===id)d.axisId='';if(d.selectedPartner===id)d.selectedPartner='';}
function handleValue(el) {
  const d=state.draft;
  if(el.dataset.field){d[el.dataset.field]=el.value;if(el.dataset.field==='selectedPartner'&&d.stake===''){const p=projectDraft(d,state.settings,bankroll(state),state.model).pairs.find(p=>p.partnerId===d.selectedPartner);if(p)d.stake=String(p.amount);}scheduleSave();render();}
  else if(el.dataset.horse){const h=d.horses.find(h=>h.id===el.dataset.horse);if(!h)return;h[el.dataset.key]=el.dataset.key==='number'&&el.value!==''?Number(el.value):el.value;scheduleSave();render();}
  else if(el.dataset.axis){d.axisId=el.dataset.axis;if(d.selectedPartner===d.axisId)d.selectedPartner='';scheduleSave();render();}
  else if(el.dataset.odds){d.odds[el.dataset.odds]=el.value;scheduleSave();render();}
  else if(el.dataset.ui){if(el.dataset.ui==='historyFilter')historyFilter=el.value;else historySearch=el.value;render();}
  else if(el.dataset.analysis){analysisOptions[el.dataset.analysis]=el.value;render();}
  else if(el.dataset.result==='void'){resultDraft.voidRace=el.checked;resultDirty=true;render();}
  else if(el.dataset.resultHorse){const e=resultDraft.entries.find(e=>e.horseId===el.dataset.resultHorse);e[el.dataset.resultKey]=el.value;resultDirty=true;render();}
  else if(el.dataset.payout){resultDraft.payouts[el.dataset.payout]=el.value;resultDirty=true;}
  if(resultDirty)$('save-status').textContent='結果は未保存';
}
document.addEventListener('click',event=>{const el=event.target.closest('[data-action]');if(!el||el.disabled)return;event.preventDefault();Promise.resolve(action(el.dataset.action,el.dataset.id,el)).catch(failure);});
let composing=false;
document.addEventListener('compositionstart',()=>{composing=true;});
document.addEventListener('compositionend',event=>{composing=false;handleValue(event.target);});
document.addEventListener('input',event=>{if(composing||event.isComposing||['checkbox','radio'].includes(event.target.type)||event.target.tagName==='SELECT')return;handleValue(event.target);});
document.addEventListener('change',event=>{if(event.target.tagName==='SELECT'||['checkbox','radio'].includes(event.target.type))handleValue(event.target);});
document.addEventListener('submit',async event=>{
  if(event.target.id!=='settings-form')return;event.preventDefault();
  try{const bank=Number($('setting-bankroll').value),threshold=Number($('setting-threshold').value),kelly=Number($('setting-kelly').value);if(!Number.isFinite(bank)||bank<0||!Number.isInteger(bank))throw new Error('資金は0円以上の整数で入力してください。');if(!Number.isFinite(threshold)||threshold<1||threshold>10)throw new Error('期待値基準は1〜10で入力してください。');if(![.25,.5,1].includes(kelly))throw new Error('ケリーの割合を選択してください。');const next=clone(state);next.settings={baseBankroll:bank-finances(state.races).profit,evThreshold:Math.round(threshold*100)/100,kellyFraction:kelly};await commit(next,'計算設定を保存しました。');}catch(error){failure(error);}
});
$('import-file').addEventListener('change',async event=>{try{const file=event.target.files[0];if(!file)return;if(file.size>25000000)throw new Error('ファイルは25MB以下にしてください。');previewImport(decodeBackup(await file.text()));}catch(error){failure(error);}finally{event.target.value='';}});
window.addEventListener('hashchange',()=>{if(location.hash==='#main')return;page=Object.hasOwn(paths,location.hash.slice(1))?location.hash.slice(1):'predict';render();window.scrollTo(0,0);});
window.addEventListener('beforeunload',event=>{if(dirty||resultDirty){event.preventDefault();event.returnValue='';}});
document.addEventListener('visibilitychange',()=>{if(document.hidden&&dirty)persist().catch(()=>{});});
try{storage=await openStorage();state=await storage.load();$('save-status').textContent='端末に保存済み';}catch(error){showStorageError(error);}
page=Object.hasOwn(paths,location.hash.slice(1))?location.hash.slice(1):'predict';
render();
