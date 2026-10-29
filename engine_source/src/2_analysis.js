/* ================= PART 2 : ANALYSES ================= */
const MARKERS = new Set(['loop_body_begin', 'loop_body_end']);
const VEC_OPS = new Set(['vload', 'vstore', 'vbin', 'vun']);

function usesOf(x) {
  let u;
  switch (x.op) {
    case 'copy': case 'un': case 'cast': case 'jz': case 'jnz': case 'ret': case 'vun': u = [x.a]; break;
    case 'alloc': u = [x.a]; break;
    case 'bin': case 'vbin': u = [x.a, x.b]; break;
    case 'load': case 'vload': u = [x.base, x.idx]; break;
    case 'store': case 'vstore': u = [x.base, x.idx, x.a]; break;
    case 'call': u = x.args; break;
    default: u = [];
  }
  return u.filter(isStr);
}
function defOf(x) {
  switch (x.op) {
    case 'copy': case 'bin': case 'un': case 'cast': case 'load': case 'addr': case 'alloca': case 'alloc': case 'strlit': case 'vload': case 'vbin': case 'vun': return x.dst;
    case 'call': return x.dst || null;
  }
  return null;
}

/* ---------- Control-flow graph, dominators, natural loops ---------- */
function buildCFG(I) {
  const leaders = new Set([0]), labelAt = {};
  I.forEach((x, k) => {
    if (x.op === 'label') { leaders.add(k); labelAt[x.name] = k; }
    if (['jmp', 'jz', 'jnz', 'ret'].includes(x.op) && k + 1 < I.length) leaders.add(k + 1);
  });
  const starts = [...leaders].filter(k => k < I.length).sort((a, b) => a - b);
  const blocks = starts.map((s, bi) => ({ id: bi, start: s, end: (bi + 1 < starts.length ? starts[bi + 1] : I.length) - 1, succ: [], pred: [] }));
  const blockOf = new Array(I.length);
  blocks.forEach(b => { for (let k = b.start; k <= b.end; k++) blockOf[k] = b.id; });
  blocks.forEach(b => {
    const last = I[b.end]; const add = t => { if (t !== undefined && !b.succ.includes(t)) b.succ.push(t); };
    if (last.op === 'jmp') add(blockOf[labelAt[last.l]]);
    else if (last.op === 'jz' || last.op === 'jnz') { add(blockOf[labelAt[last.l]]); if (b.id + 1 < blocks.length) add(b.id + 1); }
    else if (last.op !== 'ret') { if (b.id + 1 < blocks.length) add(b.id + 1); }
  });
  blocks.forEach(b => b.succ.forEach(s => blocks[s].pred.push(b.id)));
  // reachability
  const reach = new Set(); const st = blocks.length ? [0] : [];
  while (st.length) { const b = st.pop(); if (reach.has(b)) continue; reach.add(b); blocks[b].succ.forEach(s => st.push(s)); }
  blocks.forEach(b => b.reachable = reach.has(b.id));
  // dominators (iterative)
  const R = [...reach], dom = {};
  R.forEach(b => dom[b] = b === 0 ? new Set([0]) : new Set(R));
  let ch = true;
  while (ch) {
    ch = false;
    for (const b of R) {
      if (b === 0) continue;
      let nd = null;
      blocks[b].pred.filter(p => reach.has(p)).forEach(p => { nd = nd === null ? new Set(dom[p]) : new Set([...nd].filter(x => dom[p].has(x))); });
      nd = nd || new Set(); nd.add(b);
      if (nd.size !== dom[b].size) { dom[b] = nd; ch = true; }
    }
  }
  const backEdges = [];
  R.forEach(b => blocks[b].succ.forEach(s => { if (dom[b] && dom[b].has(s)) backEdges.push([b, s]); }));
  const natural = backEdges.map(([n, h]) => {
    const body = new Set([h]); const stack = [n];
    while (stack.length) { const x = stack.pop(); if (body.has(x)) continue; body.add(x); blocks[x].pred.forEach(p => stack.push(p)); }
    return { header: h, latch: n, blocks: [...body].sort((a, b) => a - b) };
  });
  blocks.forEach(b => b.depth = natural.filter(l => l.blocks.includes(b.id)).length);
  return { blocks, blockOf, labelAt, backEdges, natural, dom };
}

/* ---------- Liveness (backward dataflow, block + per-instruction) ---------- */
function liveness(fn, cfg) {
  const B = cfg.blocks, I = fn.instrs;
  const use = B.map(() => new Set()), def = B.map(() => new Set());
  B.forEach((b, bi) => {
    for (let k = b.start; k <= b.end; k++) {
      usesOf(I[k]).forEach(u => { if (!def[bi].has(u)) use[bi].add(u); });
      const d = defOf(I[k]); if (d) def[bi].add(d);
    }
  });
  let inn = B.map(() => new Set()), out = B.map(() => new Set());
  let ch = true, guard = 0;
  while (ch && guard++ < 100) {
    ch = false;
    for (let bi = B.length - 1; bi >= 0; bi--) {
      const o = new Set(); B[bi].succ.forEach(s => inn[s].forEach(v => o.add(v)));
      const n = new Set(use[bi]); o.forEach(v => { if (!def[bi].has(v)) n.add(v); });
      if (n.size !== inn[bi].size || o.size !== out[bi].size || [...n].some(v => !inn[bi].has(v)) || [...o].some(v => !out[bi].has(v))) ch = true;
      inn[bi] = n; out[bi] = o;
    }
  }
  const instIn = new Array(I.length), instOut = new Array(I.length);
  B.forEach((b, bi) => {
    const live = new Set(out[bi]);
    for (let k = b.end; k >= b.start; k--) {
      instOut[k] = new Set(live);
      const d = defOf(I[k]); if (d) live.delete(d);
      usesOf(I[k]).forEach(u => live.add(u));
      instIn[k] = new Set(live);
    }
  });
  return { blockIn: inn, blockOut: out, instIn, instOut };
}

/* ---------- Alias analysis (flow-insensitive points-to, Andersen-style, offsets tracked when constant) ---------- */
function aliasAnalysis(fn) {
  const I = fn.instrs, pts = new Map(), OFF = new Map(), objInfo = {};
  const P = n => { if (!pts.has(n)) pts.set(n, new Set()); return pts.get(n); };
  const setOff = (n, v) => { if (!OFF.has(n)) OFF.set(n, v); else if (OFF.get(n) !== v) OFF.set(n, null); };
  fn.params.forEach(p => {
    if (p.kind === 'ptr') { const o = 'param:' + p.name; objInfo[o] = { kind: 'param', restrict: !!p.restrict, name: p.name }; P(p.name).add(o); setOff(p.name, 0); }
  });
  (fn.globalNames || []).forEach(n => { const o = 'global:' + n; objInfo[o] = { kind: 'global', name: n.slice(1) }; P(n).add(o); setOff(n, 0); });
  let changed = true, guard = 0;
  const addAll = (d, src) => src.forEach(o => { if (!P(d).has(o)) { P(d).add(o); changed = true; } });
  while (changed && guard++ < 30) {
    changed = false;
    I.forEach(x => {
      switch (x.op) {
        case 'alloca': { const o = 'local:' + x.dst; objInfo[o] = { kind: 'local-array', name: x.dst, size: x.n }; addAll(x.dst, [o]); setOff(x.dst, 0); break; }
        case 'strlit': { const o = `str:${x.dst}@L${x.line}`; objInfo[o] = { kind: 'str', name: x.dst }; addAll(x.dst, [o]); setOff(x.dst, 0); break; }
        case 'alloc': { const o = `heap:${x.dst}@L${x.line}`; objInfo[o] = { kind: 'heap', name: x.dst, line: x.line, bytes: x.a }; addAll(x.dst, [o]); setOff(x.dst, 0); break; }
        case 'addr': { const o = 'local:' + x.a; objInfo[o] = { kind: 'local-var', name: x.a }; addAll(x.dst, [o]); setOff(x.dst, 0); break; }
        case 'call': if (x.fn === 'realloc' && x.dst) { const o = `heap:${x.dst}@L${x.line}`; objInfo[o] = { kind: 'heap', name: x.dst, line: x.line }; addAll(x.dst, [o]); setOff(x.dst, 0); } break;
        case 'copy': if (isStr(x.a) && P(x.a).size) { addAll(x.dst, P(x.a)); setOff(x.dst, OFF.has(x.a) ? OFF.get(x.a) : null); } break;
        case 'bin': if (x.o === '+' || x.o === '-') {
          const pa = isStr(x.a) && P(x.a).size > 0, pb = isStr(x.b) && P(x.b).size > 0;
          if (pa && !pb) { addAll(x.dst, P(x.a)); const ob = OFF.get(x.a); setOff(x.dst, typeof ob === 'number' && typeof x.b === 'number' ? (x.o === '+' ? ob + x.b : ob - x.b) : null); }
          else if (pb && !pa && x.o === '+') { addAll(x.dst, P(x.b)); const ob = OFF.get(x.b); setOff(x.dst, typeof ob === 'number' && typeof x.a === 'number' ? ob + x.a : null); }
        } break;
      }
    });
  }
  const isLocalKind = k => k === 'local-array' || k === 'local-var' || k === 'heap' || k === 'str';
  const label = o => { const i = objInfo[o]; return i.kind === 'param' ? `parameter '${i.name}'` : i.kind === 'global' ? `global '${i.name}'` : i.kind === 'str' ? 'string literal' : i.kind === 'heap' ? `malloc'd block '${i.name}'` : `local '${i.name}'`; };
  function relObj(o1, o2) {
    if (o1 === o2) return { r: 'SAME' };
    const a = objInfo[o1], b = objInfo[o2];
    if (isLocalKind(a.kind) || isLocalKind(b.kind)) return { r: 'NO', why: `${label(o1)} and ${label(o2)} are distinct allocations` };
    if (a.kind === 'global' && b.kind === 'global') return { r: 'NO', why: `globals '${a.name}' and '${b.name}' are distinct objects` };
    if (a.restrict || b.restrict) return { r: 'NO', why: `'${a.restrict ? a.name : b.name}' is declared restrict (no other pointer may access its memory)` };
    return { r: 'MAY', why: `${label(o1)} and ${label(o2)} may refer to overlapping memory (a pointer parameter could point at the other)` };
  }
  function query(a, b) {
    if (a === b) return { result: 'MUST_ALIAS', reason: 'same pointer variable' };
    const A = [...P(a)], B = [...P(b)];
    if (!A.length || !B.length) return { result: 'MAY_ALIAS', reason: `no points-to information for '${!A.length ? a : b}'` };
    let anyMay = null, allNo = true, sameObj = false, whyNo = '';
    for (const o1 of A) for (const o2 of B) {
      const r = relObj(o1, o2);
      if (r.r === 'NO') whyNo = r.why; else { allNo = false; if (r.r === 'MAY') anyMay = r.why; if (r.r === 'SAME') sameObj = true; }
    }
    if (allNo) return { result: 'NO_ALIAS', reason: whyNo };
    if (A.length === 1 && B.length === 1 && A[0] === B[0]) {
      const oa = OFF.get(a), ob = OFF.get(b);
      if (typeof oa === 'number' && oa === ob) return { result: 'MUST_ALIAS', reason: `both point to the same place in ${label(A[0])} (offset ${oa})` };
      return { result: 'MAY_ALIAS', reason: `both point into ${label(A[0])} but at ${typeof oa === 'number' && typeof ob === 'number' ? `different offsets (${oa} vs ${ob}) so their ranges overlap` : 'unknown offsets'}` };
    }
    return { result: 'MAY_ALIAS', reason: anyMay || (sameObj ? 'they may point into the same object' : 'analysis cannot rule out overlap') };
  }
  const names = [];
  fn.params.forEach(p => { if (p.kind === 'ptr') names.push(p.name); });
  I.forEach(x => { if (x.dst && !isTemp(x.dst) && P(x.dst).size && !names.includes(x.dst)) names.push(x.dst); });
  const pairs = [];
  for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) pairs.push(Object.assign({ a: names[i], b: names[j] }, query(names[i], names[j])));
  const pointsTo = {};
  names.forEach(n => { pointsTo[n] = [...P(n)].map(o => o + (typeof OFF.get(n) === 'number' ? `+${OFF.get(n)}` : '+?')); });
  return { pts, OFF, objInfo, query, pairs, pointsTo, names, holders: o => [...pts.keys()].filter(n => pts.get(n).has(o)) };
}

/* ---------- Escape analysis (simplified, conservative, intra-procedural) ---------- */
function escapeAnalysis(fn, alias) {
  const out = [];
  Object.keys(alias.objInfo).forEach(o => {
    const info = alias.objInfo[o];
    if (info.kind === 'param' || info.kind === 'global' || info.kind === 'str') return;
    const holders = new Set(alias.holders(o)); const ev = [];
    fn.instrs.forEach(x => {
      if (x.op === 'ret' && isStr(x.a) && holders.has(x.a)) ev.push({ t: 'RETURN', line: x.line, why: `pointer to ${info.name} is returned to the caller (line ${x.line})` });
      if (x.op === 'call' && !NO_ESCAPE_BUILTINS.has(x.fn) && x.args.some(a => isStr(a) && holders.has(a))) ev.push({ t: 'ARG', line: x.line, why: `pointer to ${info.name} is passed to function ${x.fn}() (line ${x.line}); callee behaviour is unknown, so assume it escapes` });
      if (x.op === 'store' && isStr(x.a) && holders.has(x.a)) ev.push({ t: 'STORE', line: x.line, why: `pointer to ${info.name} is stored into memory (line ${x.line})` });
    });
    const rank = { RETURN: 0, ARG: 1, STORE: 2 };
    ev.sort((a, b) => rank[a.t] - rank[b.t]);
    const status = ev.length ? ev[0].t + '_ESCAPE' : 'NO_ESCAPE';
    out.push({
      object: info.name, kind: info.kind === 'heap' ? 'heap (malloc)' : info.kind === 'local-array' ? 'stack array' : 'address-taken local', objId: o,
      status, reason: ev.length ? ev[0].why : `no pointer to ${info.name} is returned, passed to a call or stored in memory – it never outlives the function`,
      line: info.line
    });
  });
  return out;
}

/* ---------- Polynomial helper (symbolic index expressions) ---------- */
const pConst = n => n ? { '': n } : {};
const pVar = v => ({ [v]: 1 });
function pAdd(a, b, sg = 1) { const r = Object.assign({}, a); for (const k in b) { r[k] = (r[k] || 0) + sg * b[k]; if (r[k] === 0) delete r[k]; } return r; }
function pMul(a, b) {
  const r = {};
  for (const ka in a) for (const kb in b) {
    const k = [...(ka ? ka.split('*') : []), ...(kb ? kb.split('*') : [])].sort().join('*');
    r[k] = (r[k] || 0) + a[ka] * b[kb]; if (r[k] === 0) delete r[k];
  }
  return r;
}
const pKey = p => Object.keys(p).sort().map(k => k + ':' + p[k]).join(',');
function pStr(p) {
  const ks = Object.keys(p); if (!ks.length) return '0';
  ks.sort((a, b) => (a === '' ? 1 : 0) - (b === '' ? 1 : 0) || a.localeCompare(b));
  return ks.map((k, idx) => {
    const c = p[k], ab = Math.abs(c), body = k === '' ? String(ab) : (ab === 1 ? k : ab + '*' + k);
    return idx === 0 ? (c < 0 ? '-' : '') + body : (c < 0 ? ' - ' : ' + ') + body;
  }).join('');
}
function pSplit(p, v) {
  const A = {}, B = {}; let ok = true;
  for (const k in p) {
    const vs = k ? k.split('*') : [], c = vs.filter(x => x === v).length;
    if (c === 0) B[k] = p[k];
    else if (c === 1) { const rest = vs.filter(x => x !== v).join('*'); A[rest] = (A[rest] || 0) + p[k]; }
    else ok = false;
  }
  return { A, B, ok };
}
const pIsConst = p => Object.keys(p).every(k => k === '');
const pConstVal = p => p[''] || 0;

/* ---------- Loop views ---------- */
function findLabel(I, name) { return I.findIndex(x => x.op === 'label' && x.name === name); }
function loopView(fn, id) {
  const rec = fn.loops[id]; if (!rec) return null;
  const I = fn.instrs;
  const h = findLabel(I, rec.header), x = findLabel(I, rec.exit);
  const bb = I.findIndex(q => q.op === 'loop_body_begin' && q.loop === id), be = I.findIndex(q => q.op === 'loop_body_end' && q.loop === id);
  if (h < 0 || x < 0 || bb < 0 || be < 0 || !(h < bb && bb < be && be < x)) return null;
  const v = { rec, id, h, x, bb, be, bodyStart: bb + 1, bodyEnd: be, jmpIdx: x - 1, cond: I[h + 1], jz: I[h + 2], latch: I.slice(be + 1, x - 1), body: I.slice(bb + 1, be) };
  v.canonical = !!(rec.canonical && v.cond && v.cond.op === 'bin' && v.cond.a === rec.var && v.jz && v.jz.op === 'jz' && v.jz.a === v.cond.dst &&
    v.latch.length === 1 && v.latch[0].op === 'bin' && v.latch[0].dst === rec.var && v.latch[0].a === rec.var && typeof v.latch[0].b === 'number' &&
    (v.latch[0].o === '+' || v.latch[0].o === '-') && I[x - 1].op === 'jmp' && I[h + 3] === I[bb]);
  if (v.canonical) {
    v.var = rec.var; v.cmp = v.cond.o; v.bound = v.cond.b;
    v.step = v.latch[0].o === '+' ? v.latch[0].b : -v.latch[0].b;
    const pre = I[h - 1]; v.init = pre && pre.op === 'copy' && pre.dst === v.var ? pre.a : null;
    v.trips = tripCount(v.init, v.bound, v.step, v.cmp);
  }
  v.innermost = !v.body.some(q => ['label', 'jmp', 'jz', 'jnz', 'loop_body_begin', 'loop_body_end', 'ret'].includes(q.op));
  v.hasCall = v.body.some(q => q.op === 'call');
  return v;
}
function tripCount(init, bound, step, cmp) {
  if (typeof init !== 'number' || typeof bound !== 'number' || !step) return null;
  let n = null;
  if (cmp === '<' && step > 0) n = Math.ceil((bound - init) / step);
  else if (cmp === '<=' && step > 0) n = Math.floor((bound - init) / step) + 1;
  else if (cmp === '>' && step < 0) n = Math.ceil((init - bound) / -step);
  else if (cmp === '>=' && step < 0) n = Math.floor((init - bound) / -step) + 1;
  return n === null ? null : Math.max(0, n);
}

/* ---------- Memory-access collection + dependence analysis for one loop ---------- */
function polyOf(o, ctx, at, depth) {
  depth = depth || 0;
  if (typeof o === 'number') return pConst(o);
  if (o === ctx.var) return pVar(o);
  const defs = ctx.defs.get(o);
  if (!defs) return ctx.addr.has(o) ? null : pVar(o);        // loop-invariant symbol
  if (defs.length !== 1 || defs[0] >= at || depth > 24) return null;
  const d = ctx.I[defs[0]];
  if (d.op === 'copy' || (d.op === 'cast' && INT_TYPES.has(d.ty))) return polyOf(d.a, ctx, defs[0], depth + 1);
  if (d.op === 'un' && d.o === '-') { const a = polyOf(d.a, ctx, defs[0], depth + 1); return a && pAdd({}, a, -1); }
  if (d.op === 'bin' && (d.o === '+' || d.o === '-' || d.o === '*')) {
    const a = polyOf(d.a, ctx, defs[0], depth + 1), b = polyOf(d.b, ctx, defs[0], depth + 1);
    if (!a || !b) return null;
    return d.o === '+' ? pAdd(a, b) : d.o === '-' ? pAdd(a, b, -1) : pMul(a, b);
  }
  return null;
}
function loopContext(fn, view) {
  const I = fn.instrs, defs = new Map();
  for (let k = view.bodyStart; k < view.bodyEnd; k++) { const d = defOf(I[k]); if (d) { if (!defs.has(d)) defs.set(d, []); defs.get(d).push(k); } }
  return { I, defs, var: view.rec.var, addr: new Set(fn.addrTaken) };
}
function collectAccesses(fn, view) {
  const ctx = loopContext(fn, view), I = fn.instrs, accs = [];
  for (let k = view.bodyStart; k < view.bodyEnd; k++) {
    const x = I[k]; if (x.op !== 'load' && x.op !== 'store') continue;
    let base = x.base, P = polyOf(x.idx, ctx, k), guard = 0;
    while (isTemp(base) && guard++ < 6) {                       // normalise  *(p + e)  into  p[e]
      const defs = ctx.defs.get(base); let d = null;
      if (defs && defs.length === 1 && defs[0] < k) d = I[defs[0]];
      else if (!defs) { const all = I.map((q, qi) => (defOf(q) === base ? qi : -1)).filter(q => q >= 0); if (all.length === 1) d = I[all[0]]; }
      if (!d) break;
      if (d.op === 'bin' && d.o === '+' && (isStr(d.a) || isStr(d.b))) {
        const pa = isStr(d.a) && (isTemp(d.a) || isGlob(d.a) || fn.params.some(p => p.name === d.a && p.kind === 'ptr') || I.some(q => q.op === 'alloca' && q.dst === d.a));
        const [pt, off] = pa ? [d.a, d.b] : [d.b, d.a];
        const po = polyOf(off, ctx, k); P = P && po ? pAdd(P, po) : null; base = pt;
      } else if (d.op === 'copy' && isStr(d.a)) base = d.a; else break;
    }
    const acc = { kind: x.op === 'load' ? 'R' : 'W', base, instr: k, line: x.line, poly: P, indirect: P === null };
    if (P) { const s = pSplit(P, ctx.var); acc.ok = s.ok; acc.A = s.A; acc.B = s.B; acc.text = `${base}[${pStr(P)}]`; if (!s.ok) acc.indirect = true; }
    else acc.text = `${base}[<data-dependent>]`;
    accs.push(acc);
  }
  return { accs, ctx };
}
function analyzeLoopDeps(fn, view, alias, live) {
  const { accs, ctx } = collectAccesses(fn, view); const I = fn.instrs;
  const deps = [], reasons = [];
  const trips = view.trips;
  const add = (a, b, type, distance, detail) => deps.push({ a: a.text + ' (' + a.kind + ')', b: b.text + ' (' + b.kind + ')', type, distance, detail });
  for (let i = 0; i < accs.length; i++) for (let j = i; j < accs.length; j++) {
    const a = accs[i], b = accs[j];
    if (a.kind === 'R' && b.kind === 'R') continue;
    if (i === j && a.kind === 'R') continue;
    let sameLoc = a.base === b.base;
    if (!sameLoc) {
      const q = alias.query(a.base, b.base);
      if (q.result === 'NO_ALIAS') { add(a, b, 'NONE', null, `${a.base} and ${b.base}: NO_ALIAS – ${q.reason}`); continue; }
      if (q.result === 'MAY_ALIAS') { add(a, b, 'UNKNOWN', null, `${a.base} and ${b.base}: MAY_ALIAS – ${q.reason}`); reasons.push({ kind: 'alias', msg: `MAY_ALIAS(${a.base}, ${b.base}): ${q.reason}` }); continue; }
      sameLoc = true;
    }
    if (a.indirect || b.indirect) { add(a, b, 'UNKNOWN', null, 'index is data-dependent / non-linear, so the overlap cannot be decided'); reasons.push({ kind: 'mem', msg: `cannot analyse index of ${a.indirect ? a.text : b.text}` }); continue; }
    if (pKey(a.A) !== pKey(b.A)) {
      if (pIsConst(a.A) && pIsConst(b.A) && pIsConst(pAdd(a.B, b.B, -1))) {   // GCD test
        const g = (x, y) => y ? g(y, x % y) : Math.abs(x);
        const gg = g(pConstVal(a.A), pConstVal(b.A)), dlt = pConstVal(pAdd(b.B, a.B, -1));
        if (gg && dlt % gg !== 0) { add(a, b, 'NONE', null, `GCD test: gcd(${pConstVal(a.A)},${pConstVal(b.A)})=${gg} does not divide ${dlt}`); continue; }
      }
      add(a, b, 'UNKNOWN', null, 'different strides – cannot prove the accesses are disjoint'); reasons.push({ kind: 'mem', msg: `different strides in ${a.text} and ${b.text}` }); continue;
    }
    const delta = pAdd(a.B, b.B, -1);                          // address equal when  A*x + Ba = A*y + Bb  ->  y-x = (Ba-Bb)/A
    if (!pIsConst(delta)) {
      if (!Object.keys(delta).length) { add(a, b, 'INDEPENDENT', 0, 'identical index expressions: dependence stays inside one iteration'); continue; }
      add(a, b, 'UNKNOWN', null, 'offsets differ by a symbolic amount'); reasons.push({ kind: 'mem', msg: `symbolic offset between ${a.text} and ${b.text}` }); continue;
    }
    const d = pConstVal(delta);
    if (pIsConst(a.A) && pConstVal(a.A) === 0) {              // loop-invariant address
      if (d === 0) { add(a, b, 'CARRIED', 'any', `same location ${a.text} touched in every iteration`); reasons.push({ kind: 'mem', msg: `loop-invariant location ${a.text} is written in every iteration (loop-carried ${a.kind === 'W' && b.kind === 'W' ? 'WAW' : 'RAW/WAR'})` }); }
      else add(a, b, 'NONE', null, 'different fixed locations');
      continue;
    }
    if (!pIsConst(a.A)) {                                      // symbolic stride
      if (d === 0) { add(a, b, 'INDEPENDENT', 0, 'same symbolic stride and offset: dependence within one iteration'); continue; }
      add(a, b, 'UNKNOWN', null, 'symbolic stride with constant offset'); reasons.push({ kind: 'mem', msg: `symbolic stride in ${a.text}` }); continue;
    }
    const c = pConstVal(a.A);
    if (d % c !== 0) { add(a, b, 'NONE', null, `${d} is not a multiple of stride ${c}: the accesses never touch the same element`); continue; }
    const dist = d / c;                                         // iteration distance (b relative to a)
    if (dist === 0) { add(a, b, 'INDEPENDENT', 0, 'same element, same iteration (loop-independent dependence)'); continue; }
    if (trips !== null && Math.abs(dist) >= trips) { add(a, b, 'NONE', null, `distance ${Math.abs(dist)} ≥ trip count ${trips}`); continue; }
    // a is the write or both writes; decide RAW / WAR / WAW
    let type;
    if (a.kind === 'W' && b.kind === 'W') type = 'WAW';
    else {
      const w = a.kind === 'W' ? a : b, r = a.kind === 'W' ? b : a;
      const distWtoR = a.kind === 'W' ? dist : -dist;           // read-iteration minus write-iteration
      type = distWtoR > 0 ? 'RAW' : 'WAR';
    }
    add(a, b, 'CARRIED', Math.abs(dist), `${type} loop-carried dependence, distance ${Math.abs(dist)} iteration(s)`);
    reasons.push({ kind: 'mem', msg: `loop-carried ${type} dependence between ${a.text} and ${b.text} (distance ${Math.abs(dist)})` });
  }
  // scalar loop-carried dependences / reductions / live-out
  const scalarDeps = [], defSeen = new Set(), liveOut = [];
  for (let k = view.bodyStart; k < view.bodyEnd; k++) {
    const x = I[k];
    usesOf(x).forEach(u => {
      if (ctx.defs.has(u) && !isTemp(u) && u !== ctx.var && !defSeen.has(u) && !scalarDeps.some(s => s.name === u)) {
        const dIdx = ctx.defs.get(u)[0], dd = I[dIdx];
        const red = dd.op === 'bin' && (dd.a === u || dd.b === u) && ['+', '*', '&', '|', '^'].includes(dd.o);
        scalarDeps.push({ name: u, reduction: red, text: fmtInstr(dd), msg: red ? `'${u}' is a reduction (${fmtInstr(dd)}) – each iteration needs the previous value` : `'${u}' is read before it is written in the iteration (value carried from the previous iteration)` });
      }
    });
    const d = defOf(x); if (d) defSeen.add(d);
  }
  const exitLive = live.instIn[view.x] || new Set();
  ctx.defs.forEach((_, n) => { if (!isTemp(n) && n !== ctx.var && exitLive.has(n)) liveOut.push(n); });
  const memBlocking = deps.some(d => d.type === 'CARRIED' || d.type === 'UNKNOWN');
  return { accs, deps, reasons, scalarDeps, liveOut, memBlocking, hasCarried: deps.some(d => d.type === 'CARRIED'), hasUnknown: deps.some(d => d.type === 'UNKNOWN') };
}

/* ---------- Cache behaviour analysis (static, qualitative) ---------- */
function cacheAnalysis(fn, opts) {
  const elem = 4, line = opts.cacheLine || 64, out = [];
  fn.loops.forEach(rec => {
    if (rec.transformed) return;
    const v = loopView(fn, rec.id); if (!v) return;
    const loopRec = { loop: rec.id, line: rec.line, var: rec.var, kind: rec.kind, innermost: v.innermost, accesses: [], verdict: '', suggestion: '' };
    if (!rec.canonical || !v.canonical) { loopRec.verdict = 'NOT_ANALYSED'; loopRec.suggestion = `loop is not in canonical counted form (${rec.why.join('; ') || 'unknown'}), so strides cannot be derived`; out.push(loopRec); return; }
    if (!v.innermost) { const outer = rec.hasInner; loopRec.verdict = outer ? 'OUTER_LOOP' : 'NOT_ANALYSED'; loopRec.suggestion = outer ? 'accesses are classified in the innermost loop' : 'the body contains conditional control flow, so strides are not analysed'; out.push(loopRec); return; }
    const { accs } = collectAccesses(fn, v);
    let worst = 0, sum = 0;
    accs.forEach(a => {
      let pattern, stride = null, miss, note = '';
      if (a.indirect) { pattern = 'IRREGULAR'; miss = 1; note = 'data-dependent index (gather/scatter): every access may touch a new cache line'; }
      else if (pIsConst(a.A)) {
        const c = pConstVal(a.A);
        if (c === 0) { pattern = 'INVARIANT'; miss = 0; note = 'same address every iteration – stays in a register/L1 (temporal reuse)'; }
        else if (Math.abs(c) === 1) { pattern = 'SEQUENTIAL'; stride = c; miss = elem / line; note = `unit stride: one miss per ${line / elem} elements, hardware prefetch friendly`; }
        else { pattern = 'STRIDED'; stride = c; miss = Math.min(1, elem * Math.abs(c) / line); note = `constant stride ${c} elements (${Math.abs(c) * elem} bytes)`; }
      } else { pattern = 'SYMBOLIC_STRIDE'; stride = pStr(a.A); miss = 1; note = `stride ${pStr(a.A)} elements is not a compile-time constant – typically a column-wise walk of a 2-D array`; }
      worst = Math.max(worst, miss); sum += miss;
      loopRec.accesses.push({ ref: a.text, kind: a.kind, pattern, stride, estMissPerAccess: +miss.toFixed(4), note });
    });
    const avg = accs.length ? sum / accs.length : 0;
    loopRec.verdict = !accs.length ? 'NO_MEMORY_ACCESS' : worst <= elem / line + 1e-9 ? 'CACHE_FRIENDLY' : avg >= 0.5 ? 'CACHE_UNFRIENDLY' : 'MIXED';
    if (loopRec.accesses.some(a => a.pattern === 'SYMBOLIC_STRIDE')) loopRec.suggestion = 'Consider loop interchange or tiling so the inner loop walks memory with unit stride.';
    else if (loopRec.accesses.some(a => a.pattern === 'IRREGULAR')) loopRec.suggestion = 'Indirect indexing defeats the cache; consider sorting indices or blocking the data.';
    else if (loopRec.accesses.some(a => a.pattern === 'STRIDED')) loopRec.suggestion = 'Strided access wastes cache-line bandwidth; consider restructuring data as structure-of-arrays.';
    else loopRec.suggestion = 'Access pattern is already cache friendly.';
    if (v.trips !== null) loopRec.tripCount = v.trips;
    out.push(loopRec);
  });
  return out;
}

/* ---------- Register allocation (graph colouring, Chaitin–Briggs with optimistic spilling) ---------- */
function regAlloc(fn, K, KV) {
  const I = fn.instrs, cfg = buildCFG(I), live = liveness(fn, cfg);
  const addr = new Set(fn.addrTaken), arrays = new Set(I.filter(x => x.op === 'alloca').map(x => x.dst));
  const vec = new Set(); I.forEach(x => { if (VEC_OPS.has(x.op) && x.dst) vec.add(x.dst); });
  const cand = n => isStr(n) && !isGlob(n) && !addr.has(n) && !arrays.has(n);
  const nodes = new Set();
  I.forEach(x => { usesOf(x).forEach(u => cand(u) && nodes.add(u)); const d = defOf(x); if (d && cand(d)) nodes.add(d); });
  const adj = new Map(); nodes.forEach(n => adj.set(n, new Set()));
  const edge = (a, b) => { if (a !== b && nodes.has(a) && nodes.has(b) && vec.has(a) === vec.has(b)) { adj.get(a).add(b); adj.get(b).add(a); } };
  const cost = new Map(); nodes.forEach(n => cost.set(n, 0));
  I.forEach((x, k) => {
    if (!cfg.blockOf[k] && cfg.blockOf[k] !== 0) return;
    const w = Math.pow(10, cfg.blocks[cfg.blockOf[k]].depth || 0);
    usesOf(x).forEach(u => nodes.has(u) && cost.set(u, cost.get(u) + w));
    const d = defOf(x); if (d && nodes.has(d)) cost.set(d, cost.get(d) + w);
    if (d) live.instOut[k].forEach(v => { if (!(x.op === 'copy' && v === x.a)) edge(d, v); });
  });
  const ps = fn.params.map(p => p.name).filter(n => nodes.has(n));
  ps.forEach((a, i) => ps.slice(i + 1).forEach(b => edge(a, b)));
  let pressure = 0, vpressure = 0;
  I.forEach((x, k) => {
    let s = 0, v = 0; live.instOut[k].forEach(n => { if (nodes.has(n)) { if (vec.has(n)) v++; else s++; } });
    pressure = Math.max(pressure, s); vpressure = Math.max(vpressure, v);
  });
  function colour(names, k, prefix) {
    const rem = new Set(names), stack = [];
    const deg = n => [...adj.get(n)].filter(m => rem.has(m)).length;
    while (rem.size) {
      let pick = null;
      for (const n of rem) if (deg(n) < k) { pick = n; break; }
      let opt = false;
      if (!pick) { let best = Infinity; for (const n of rem) { const c = cost.get(n) / Math.max(1, deg(n)); if (c < best) { best = c; pick = n; } } opt = true; }
      rem.delete(pick); stack.push({ n: pick, opt });
    }
    const col = new Map(), spilled = [];
    while (stack.length) {
      const { n } = stack.pop(); const used = new Set();
      adj.get(n).forEach(m => { if (col.has(m)) used.add(col.get(m)); });
      let c = 0; while (c < k && used.has(c)) c++;
      if (c < k) col.set(n, c); else spilled.push(n);
    }
    return { col, spilled, prefix };
  }
  const sc = colour([...nodes].filter(n => !vec.has(n)), K, 'R'), vc = colour([...nodes].filter(n => vec.has(n)), KV, 'V');
  const mapping = {}; let slot = 0;
  [sc, vc].forEach(r => { r.col.forEach((c, n) => mapping[n] = r.prefix + c); r.spilled.forEach(n => mapping[n] = `[sp+${4 * slot++}]`); });
  const interference = []; adj.forEach((s, a) => s.forEach(b => { if (a < b) interference.push([a, b]); }));
  const allocated = irLines(I, n => mapping[n] || n).filter(l => l.k !== 'marker');
  return {
    K, KV, mapping, spills: [...sc.spilled, ...vc.spilled], pressure, vectorPressure: vpressure, nodes: [...nodes],
    interference, usedRegs: new Set(Object.values(mapping).filter(v => v[0] !== '[')).size,
    spillCost: [...sc.spilled, ...vc.spilled].reduce((s, n) => s + cost.get(n), 0), cost: Object.fromEntries(cost), vecNodes: [...vec], allocatedIR: allocated.map(l => l.t)
  };
}
