/* ================= PART 3 : INTERPRETER, VERIFIER, OPTIMISATION PASSES, PIPELINE ================= */
class Fault extends Error {}
class Obj { constructor(n, tag) { this.data = new Array(n).fill(0); this.tag = tag; } }
class Ptr { constructor(o, off) { this.o = o; this.off = off; } }
const newTemp = fn => '%t' + (++fn.tmpN);
const newVec = fn => '%v' + (++fn.vecN);

/* ---------- Reference interpreter for the IR (original, scalar-optimised and vector IR) ---------- */
function readCString(p) {
  let out = '';
  if (!(p instanceof Ptr)) return out;
  for (let k = p.off; k < p.o.data.length; k++) { const c = p.o.data[k]; if (c === 0) break; out += String.fromCharCode(c & 255); }
  return out;
}
function execute(fns, name, args, limit, io) {
  io = io || { tokens: [], pos: 0, out: '' };
  const stats = { instr: 0, load: 0, store: 0, branch: 0, vec: 0, call: 0 };
  const gl = new Map();
  (fns.__g || []).forEach(g => { const o = new Obj(g.size, 'global:' + g.name); g.init.forEach((v, k) => { o.data[k] = v; }); gl.set(g.name, new Ptr(o, 0)); });
  const rd = (p, i) => {
    if (!(p instanceof Ptr)) throw new Fault('invalid pointer dereference');
    const k = p.off + i; if (k < 0 || k >= p.o.data.length) throw new Fault(`out-of-bounds read at index ${k} (size ${p.o.data.length})`);
    return p.o.data[k];
  };
  const wr = (p, i, v) => {
    if (!(p instanceof Ptr)) throw new Fault('invalid pointer dereference');
    const k = p.off + i; if (k < 0 || k >= p.o.data.length) throw new Fault(`out-of-bounds write at index ${k} (size ${p.o.data.length})`);
    p.o.data[k] = v;
  };
  function binv(o, a, b, ty) {
    const pa = a instanceof Ptr, pb = b instanceof Ptr;
    if (pa || pb) {
      if (o === '+') { if (pa && !pb) return new Ptr(a.o, a.off + b); if (pb && !pa) return new Ptr(b.o, b.off + a); throw new Fault('pointer + pointer'); }
      if (o === '-') { if (pa && !pb) return new Ptr(a.o, a.off - b); if (pa && pb) { if (a.o !== b.o) throw new Fault('pointer difference across objects'); return a.off - b.off; } throw new Fault('int - pointer'); }
      if (['<', '<=', '>', '>=', '==', '!='].includes(o)) {
        if (pa && pb) { if (a.o !== b.o) { if (o === '==') return 0; if (o === '!=') return 1; throw new Fault('ordered comparison of unrelated pointers'); } return evalBin(o, a.off, b.off, 'int'); }
        const n = pa ? b : a; if (n !== 0 || (o !== '==' && o !== '!=')) throw new Fault('unsupported pointer comparison'); return o === '==' ? 0 : 1;
      }
      if (o === '&&' || o === '||') return evalBin(o, pa ? 1 : a, pb ? 1 : b, 'int');
      throw new Fault('invalid pointer arithmetic');
    }
    const r = evalBin(o, a, b, ty); if (r === undefined) throw new Fault(o === '/' || o === '%' ? 'division by zero' : 'invalid operation'); return r;
  }
  function scan(x, val) {
    const fmt = x.fmt; let n = 0, ai = 0;
    const re = /%([*]?)(\d*)(hh|h|ll|l|L)?([diuoxXfFeEgGcsp%])/g; let m, last = 0;
    while ((m = re.exec(fmt))) {
      if (m[4] === '%') continue;
      if (io.pos >= io.tokens.length) return n === 0 ? -1 : n;
      const tok = io.tokens[io.pos++]; const target = m[1] ? null : val(x.args[ai]); const pty = x.pty ? x.pty[ai] : 'int'; if (!m[1]) ai++;
      if (!target) continue;
      if (m[4] === 's') { const need = tok.length + 1; for (let k = 0; k < need; k++) { if (target.off + k >= target.o.data.length) throw new Fault('scanf %s overflows the buffer'); target.o.data[target.off + k] = k < tok.length ? tok.charCodeAt(k) : 0; } n++; continue; }
      if (m[4] === 'c') { wr(target, 0, tok.charCodeAt(0)); n++; continue; }
      const isF = 'fFeEgG'.includes(m[4]); const num = isF ? parseFloat(tok) : parseInt(tok, m[4] === 'x' || m[4] === 'X' ? 16 : 10);
      if (Number.isNaN(num)) return n;
      wr(target, 0, castTo(isF ? (m[3] === 'l' || m[3] === 'L' ? 'double' : 'float') : (pty || 'int'), num)); n++;
    }
    return n;
  }
  function call(fn, args, depth) {
    if (depth > 60) throw new Fault('recursion too deep');
    const env = new Map(); fn.params.forEach((p, i) => env.set(p.name, args[i]));
    const addrObj = new Map();
    (fn.addrTaken || []).forEach(n => { const o = new Obj(1, 'local:' + n); if (env.has(n)) o.data[0] = env.get(n); addrObj.set(n, o); });
    const get = n => n[0] === '@' ? gl.get(n) : addrObj.has(n) ? addrObj.get(n).data[0] : (env.has(n) ? env.get(n) : 0);
    const set = (n, v) => { if (addrObj.has(n)) addrObj.get(n).data[0] = v; else env.set(n, v); };
    const val = o => typeof o === 'number' ? o : get(o);
    const I = fn.instrs, lab = new Map();
    I.forEach((x, k) => { if (x.op === 'label') lab.set(x.name, k); });
    let pc = 0;
    while (pc < I.length) {
      const x = I[pc++];
      if (x.op === 'label' || x.op === 'loop_body_begin' || x.op === 'loop_body_end') continue;
      if (++stats.instr > limit) throw new Fault('step limit exceeded');
      switch (x.op) {
        case 'copy': set(x.dst, val(x.a)); break;
        case 'cast': { const a = val(x.a); if (a instanceof Ptr) throw new Fault('cast of a pointer to a number'); set(x.dst, castTo(x.ty, a)); break; }
        case 'bin': set(x.dst, binv(x.o, val(x.a), val(x.b), x.ty)); break;
        case 'un': { const a = val(x.a); if (a instanceof Ptr) throw new Fault('unary operator on pointer'); set(x.dst, evalUn(x.o, a, x.ty)); break; }
        case 'load': stats.load++; set(x.dst, rd(val(x.base), val(x.idx))); break;
        case 'store': { stats.store++; let v = val(x.a); if (x.ty && typeof v === 'number') v = castTo(x.ty, v); wr(val(x.base), val(x.idx), v); break; }
        case 'addr': set(x.dst, addrObj.has(x.a) ? new Ptr(addrObj.get(x.a), 0) : val(x.a)); break;
        case 'alloca': set(x.dst, new Ptr(new Obj(x.n, 'local:' + x.dst), 0)); break;
        case 'alloc': { const b = val(x.a); if (typeof b !== 'number' || b < 0 || b > 4e6) throw new Fault('bad allocation size'); set(x.dst, new Ptr(new Obj(Math.ceil(b / (x.esz || 4)), 'heap'), 0)); break; }
        case 'strlit': { const o = new Obj(x.text.length + 1, 'str'); for (let k = 0; k < x.text.length; k++) o.data[k] = x.text.charCodeAt(k); set(x.dst, new Ptr(o, 0)); break; }
        case 'jmp': stats.branch++; pc = lab.get(x.l); break;
        case 'jz': stats.branch++; if (val(x.a) === 0) pc = lab.get(x.l); break;
        case 'jnz': stats.branch++; if (val(x.a) !== 0) pc = lab.get(x.l); break;
        case 'ret': return x.a === undefined ? 0 : val(x.a);
        case 'call': {
          stats.call++;
          if (x.fn === 'free') break;
          if (x.fn === 'printf') {
            const s = cFormat(x.fmt, x.args.map(val), readCString); io.out += s; if (io.out.length > 100000) throw new Fault('output too long');
            if (x.dst) set(x.dst, s.length); break;
          }
          if (x.fn === 'scanf') { const r = scan(x, val); if (x.dst) set(x.dst, r); break; }
          if (x.fn === 'realloc') {
            const p = val(x.args[0]), b = val(x.args[1]); if (typeof b !== 'number' || b < 0 || b > 4e6) throw new Fault('bad allocation size');
            const o = new Obj(Math.ceil(b / (x.esz || 4)), 'heap');
            if (p instanceof Ptr) for (let k = 0; k < Math.min(o.data.length, p.o.data.length - p.off); k++) o.data[k] = p.o.data[p.off + k];
            set(x.dst, new Ptr(o, 0)); break;
          }
          const g = fns[x.fn]; if (!g) throw new Fault('call to unknown function ' + x.fn);
          const r = call(g, x.args.map(val), depth + 1); if (x.dst) set(x.dst, r); break;
        }
        case 'vload': { stats.load++; stats.vec++; const b = val(x.base), i = val(x.idx), a = []; for (let l = 0; l < x.vl; l++) a.push(rd(b, i + l)); set(x.dst, a); break; }
        case 'vstore': { stats.store++; stats.vec++; const b = val(x.base), i = val(x.idx), v = val(x.a); for (let l = 0; l < x.vl; l++) { let e = Array.isArray(v) ? v[l] : v; if (x.ty && typeof e === 'number') e = castTo(x.ty, e); wr(b, i + l, e); } break; }
        case 'vbin': { stats.vec++; const a = val(x.a), b = val(x.b), r = []; for (let l = 0; l < x.vl; l++) r.push(binv(x.o, Array.isArray(a) ? a[l] : a, Array.isArray(b) ? b[l] : b, x.ty)); set(x.dst, r); break; }
        case 'vun': { stats.vec++; const a = val(x.a), r = []; for (let l = 0; l < x.vl; l++) r.push(evalUn(x.o, Array.isArray(a) ? a[l] : a, x.ty)); set(x.dst, r); break; }
        default: throw new Fault('unknown instruction ' + x.op);
      }
    }
    return 0;
  }
  const ret = call(fns[name], args, 0);
  return { ret, stats, io, gl };
}

/* ---------- Test-case generation and verification harness ---------- */
const TEST_INTS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 16, 17, 20, 25, 32, 33];
const BUF = 1200;
function genTests(fn, count) {
  if (!fn.params.length) return [{ label: '(no arguments)', ints: [], seed: 1 }];
  const tests = [];
  for (let c = 0; c < count; c++) {
    let ii = 0; const ints = [], parts = [];
    fn.params.forEach((p, pi) => {
      if (p.kind === 'int') { let v = TEST_INTS[(c * (ii + 1) + ii * 3) % TEST_INTS.length]; if (isFloatTy(p.ty)) v += (c % 2) * 0.5; v = castTo(p.ty || 'int', v); ints.push(v); parts.push(`${p.name}=${v}`); ii++; }
      else { ints.push(null); parts.push(`${p.name}=buf${pi}`); }
    });
    tests.push({ label: parts.join(', '), ints, seed: c + 1 });
  }
  return tests;
}
function buildArgs(fn, spec) {
  const bufs = [];
  const args = fn.params.map((p, pi) => {
    if (p.kind === 'int') return spec.ints[pi];
    const o = new Obj(BUF, 'param' + pi); let s = ((spec.seed * 2654435761) + pi * 97) >>> 0;
    for (let i = 0; i < BUF; i++) {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0; const r = (s >>> 16) % 100;
      o.data[i] = isFloatTy(p.ty) ? r / 4 : (p.ty === 'char' || p.ty === 'uchar') ? 32 + (r % 90) : castTo(p.ty || 'int', r);
    }
    if (p.ty === 'char' || p.ty === 'uchar') o.data[BUF - 1] = 0;
    bufs.push(o); return new Ptr(o, 0);
  });
  return { args, bufs };
}
function runOne(fns, fn, spec, limit) {
  const { args, bufs } = buildArgs(fn, spec);
  const tokens = []; let sd = (spec.seed * 7919 + 13) >>> 0;
  for (let k = 0; k < 80; k++) { sd = (Math.imul(sd, 1664525) + 1013904223) >>> 0; tokens.push(String(1 + (sd >>> 16) % 30)); }
  const io = { tokens, pos: 0, out: '' };
  try {
    const r = execute(fns, fn.name, args, limit, io);
    const g = [...r.gl.values()].map(p => p.o.data.join(',')).join('|');
    return { ret: r.ret instanceof Ptr ? `ptr(${r.ret.o.tag}+${r.ret.off})` : String(r.ret), mem: bufs.map(b => b.data.join(',')).join('|') + '##' + g, out: io.out, stats: r.stats };
  } catch (e) { if (e instanceof Fault) return { fault: e.message }; throw e; }
}
function makeVerifier(origFn, fnsOrig, opts) {
  const tests = genTests(origFn, opts.testCases), limit = opts.stepLimit;
  const exp = tests.map(t => runOne(Object.assign({}, fnsOrig, { [origFn.name]: origFn }), origFn, t, limit));
  return {
    tests, exp,
    check(cand) {
      const fns = Object.assign({}, fnsOrig, { [origFn.name]: cand });
      const res = { passed: 0, failed: 0, skipped: 0, cases: [], before: { instr: 0, load: 0, store: 0, branch: 0, vec: 0 }, after: { instr: 0, load: 0, store: 0, branch: 0, vec: 0 } };
      tests.forEach((t, i) => {
        const e = exp[i];
        if (e.fault) { res.skipped++; res.cases.push({ label: t.label, status: 'SKIPPED', detail: 'original program faults on this input: ' + e.fault }); return; }
        const g = runOne(fns, cand, t, limit);
        if (g.fault) { res.failed++; res.cases.push({ label: t.label, status: 'FAIL', expected: e.ret, got: 'fault: ' + g.fault, detail: 'optimised code faults but the original does not' }); return; }
        if (g.ret !== e.ret || g.mem !== e.mem || g.out !== e.out) { res.failed++; res.cases.push({ label: t.label, status: 'FAIL', expected: e.ret, got: g.ret, detail: g.ret !== e.ret ? 'return value differs' : g.out !== e.out ? 'printed output differs' : 'final memory contents differ' }); return; }
        res.passed++;
        for (const k in res.before) { res.before[k] += e.stats[k]; res.after[k] += g.stats[k]; }
        res.cases.push({ label: t.label, status: 'PASS', expected: e.ret, got: g.ret, output: e.out.length > 60 ? e.out.slice(0, 60) + '…' : e.out, instrBefore: e.stats.instr, instrAfter: g.stats.instr });
      });
      return res;
    }
  };
}

/* ---------- Constant folding / propagation / algebraic simplification / branch folding / DCE ---------- */
const NAC = '⊥';
function meetStates(list) {
  if (!list.length) return null;
  const keys = new Set(); list.forEach(s => s.forEach((_, k) => keys.add(k)));
  const r = new Map();
  keys.forEach(k => {
    let v, first = true, nac = false;
    for (const s of list) {
      if (!s.has(k)) { nac = true; break; }
      const x = s.get(k); if (x === NAC) { nac = true; break; }
      if (first) { v = x; first = false; } else if (v !== x) { nac = true; break; }
    }
    r.set(k, nac ? NAC : v);
  });
  return r;
}
const sameState = (a, b) => { if (!a || !b || a.size !== b.size) return false; for (const [k, v] of a) if (!b.has(k) || b.get(k) !== v) return false; return true; };

function constFold(fn, opts) {
  const events = [], addr = new Set(fn.addrTaken);
  for (let round = 0; round < 14; round++) {
    let changed = false;
    const I = fn.instrs, cfg = buildCFG(I), nb = cfg.blocks.length;
    const IN = new Array(nb).fill(null), OUT = new Array(nb).fill(null);
    const get = (st, o) => typeof o === 'number' ? o : (st.has(o) ? st.get(o) : NAC);
    const xfer = (x, st) => {
      const d = defOf(x); if (!d) return;
      if (addr.has(d)) { st.set(d, NAC); return; }
      let v = NAC;
      if (x.op === 'copy') v = get(st, x.a);
      else if (x.op === 'bin') { const a = get(st, x.a), b = get(st, x.b); if (typeof a === 'number' && typeof b === 'number') { const r = evalBin(x.o, a, b, x.ty); if (r !== undefined) v = r; } }
      else if (x.op === 'un') { const a = get(st, x.a); if (typeof a === 'number') { const r = evalUn(x.o, a, x.ty); if (r !== undefined) v = r; } }
      else if (x.op === 'cast') { const a = get(st, x.a); if (typeof a === 'number') v = castTo(x.ty, a); }
      st.set(d, v);
    };
    let ch = true, it = 0;
    while (ch && it++ < 80) {
      ch = false;
      for (const b of cfg.blocks) {
        if (!b.reachable) continue;
        let inS;
        if (b.id === 0) inS = new Map();
        else { inS = meetStates(b.pred.filter(p => OUT[p] !== null && cfg.blocks[p].reachable).map(p => OUT[p])); if (!inS) continue; }
        const st = new Map(inS);
        for (let k = b.start; k <= b.end; k++) xfer(I[k], st);
        if (!sameState(OUT[b.id], st)) { OUT[b.id] = st; ch = true; }
        IN[b.id] = inS;
      }
    }
    const out = [];
    for (const b of cfg.blocks) {
      if (!b.reachable) {
        const real = I.slice(b.start, b.end + 1).filter(x => x.op !== 'label' && !MARKERS.has(x.op) && !x.implicit);
        if (real.length) { events.push({ kind: 'unreachable', line: real[0].line, before: real.map(x => fmtInstr(x)).join('; '), after: '(removed)', why: 'no path from the function entry reaches this code' }); }
        changed = true; continue;
      }
      const st = new Map(IN[b.id] || []);
      for (let k = b.start; k <= b.end; k++) {
        const x = I[k]; const before = fmtInstr(x); const y = Object.assign({}, x); const prop = [];
        const rw = o => { if (isStr(o) && !addr.has(o)) { const v = get(st, o); if (typeof v === 'number') { prop.push(`${o}=${v}`); return v; } } return o; };
        switch (y.op) {
          case 'copy': y.a = rw(y.a); break;
          case 'bin': y.a = rw(y.a); y.b = rw(y.b); break;
          case 'un': y.a = rw(y.a); break;
          case 'cast': y.a = rw(y.a); break;
          case 'jz': case 'jnz': y.a = rw(y.a); break;
          case 'ret': if (y.a !== undefined) y.a = rw(y.a); break;
          case 'load': y.idx = rw(y.idx); break;
          case 'store': y.idx = rw(y.idx); y.a = rw(y.a); break;
          case 'alloc': y.a = rw(y.a); break;
          case 'call': y.args = y.args.map(rw); break;
        }
        let kind = prop.length ? 'propagate' : null, drop = false, extra = '';
        if (y.op === 'bin' && typeof y.a === 'number' && typeof y.b === 'number') {
          const r = evalBin(y.o, y.a, y.b, y.ty);
          if (r !== undefined) { y.op = 'copy'; y.a = r; delete y.b; delete y.o; delete y.ty; kind = 'fold'; }
          else if (!events.some(e => e.kind === 'warn' && e.line === x.line)) events.push({ kind: 'warn', line: x.line, before, after: before, why: `division by zero in a constant expression – left for run time` });
        } else if (y.op === 'un' && typeof y.a === 'number') {
          const r = evalUn(y.o, y.a, y.ty); if (r !== undefined) { y.op = 'copy'; y.a = r; delete y.o; delete y.ty; kind = 'fold'; }
        } else if (y.op === 'cast' && typeof y.a === 'number') {
          y.a = castTo(y.ty, y.a); y.op = 'copy'; delete y.ty; delete y.from; kind = 'fold';
        } else if (y.op === 'bin' && !isFloatTy(y.ty)) {
          const A = y.a, B = y.b, num = typeof A === 'number' ? A : typeof B === 'number' ? B : null;
          if (num !== null) {
            const other = typeof A === 'number' ? B : A, left = typeof A === 'number';
            let res = null;
            if (y.o === '+' && num === 0) res = other;
            else if (y.o === '-' && !left && num === 0) res = other;
            else if (y.o === '*' && num === 1) res = other;
            else if (y.o === '*' && num === 0) res = 0;
            else if (y.o === '/' && !left && num === 1) res = other;
            if (res !== null) { y.op = 'copy'; y.a = res; delete y.b; delete y.o; delete y.ty; kind = 'algebraic'; }
          }
        } else if ((y.op === 'jz' || y.op === 'jnz') && typeof y.a === 'number') {
          const taken = y.op === 'jz' ? y.a === 0 : y.a !== 0;
          kind = 'branch';
          if (taken) { y.op = 'jmp'; delete y.a; extra = 'condition is a constant that always jumps'; } else { drop = true; extra = 'condition is a constant that never jumps'; }
        }
        const after = drop ? '(removed)' : fmtInstr(y);
        if (kind && (after !== before)) {
          events.push({ kind, line: x.line, before, after, via: prop, why: extra }); changed = true;
        }
        if (!drop) { xfer(y, st); out.push(y); } else changed = true;
      }
    }
    // remove "goto L" immediately followed by "L:"
    const clean = [];
    out.forEach((x, k) => {
      if (x.op === 'jmp') { let j = k + 1; while (j < out.length && out[j].op === 'label') { if (out[j].name === x.l) break; j++; } if (j < out.length && out[j].op === 'label' && out[j].name === x.l && out.slice(k + 1, j).every(q => q.op === 'label')) { changed = true; return; } }
      clean.push(x);
    });
    fn.instrs = clean;
    if (!changed) break;
  }
  dce(fn, opts, events);
  return events;
}
function dce(fn, opts, events) {
  let any = true, guard = 0; const addr = new Set(fn.addrTaken);
  while (any && guard++ < 50) {
    any = false;
    const I = fn.instrs, cfg = buildCFG(I), live = liveness(fn, cfg), keep = [];
    I.forEach((x, k) => {
      const d = defOf(x);
      if (d && ['copy', 'bin', 'un', 'cast', 'load', 'addr'].includes(x.op) && !addr.has(d) && (isSynth(d) || opts.dceVars) && !live.instOut[k].has(d)) {
        events.push({ kind: 'dce', line: x.line, before: fmtInstr(x), after: '(removed)', why: `'${d}' is never read afterwards` }); any = true;
      } else keep.push(x);
    });
    fn.instrs = keep;
  }
}

/* ---------- Escape-driven heap -> stack promotion ---------- */
function promoteHeap(fn) {
  const alias = aliasAnalysis(fn), esc = escapeAnalysis(fn, alias), cfg = buildCFG(fn.instrs);
  const results = [], removeFree = new Set();
  fn.instrs.forEach((x, k) => {
    if (x.op !== 'alloc') return;
    const objId = `heap:${x.dst}@L${x.line}`, e = esc.find(q => q.objId === objId);
    const holders = new Set(alias.holders(objId));
    const checks = [];
    checks.push({ check: 'Pointer does not escape the function', ok: !!e && e.status === 'NO_ESCAPE', detail: e ? e.reason : 'no escape information' });
    checks.push({ check: 'Allocation size is a compile-time constant', ok: typeof x.a === 'number', detail: typeof x.a === 'number' ? `${x.a} bytes` : 'size depends on run-time data' });
    checks.push({ check: 'Size is small enough for the stack (≤ 4096 bytes)', ok: typeof x.a === 'number' && x.a <= 4096, detail: typeof x.a === 'number' ? `${x.a} bytes` : 'unknown' });
    const depth = cfg.blocks[cfg.blockOf[k]].depth;
    checks.push({ check: 'Allocation runs at most once per call (not inside a loop)', ok: depth === 0, detail: depth === 0 ? 'outside every loop' : `loop nesting depth ${depth}` });
    const ok = checks.every(c => c.ok);
    results.push({ k, x, checks, ok, objId, holders });
    if (ok) fn.instrs.forEach((q, qi) => { if (q.op === 'call' && q.fn === 'free' && isStr(q.args[0]) && holders.has(q.args[0])) removeFree.add(qi); });
  });
  results.forEach(r => { if (r.ok) fn.instrs[r.k] = { op: 'alloca', dst: r.x.dst, n: Math.max(1, Math.ceil(r.x.a / 4)), line: r.x.line }; });
  if (removeFree.size) fn.instrs = fn.instrs.filter((_, i) => !removeFree.has(i));
  return results;
}

/* ---------- Loop transformations ---------- */
function mapOps(y, ren) {
  ['a', 'b', 'idx', 'base', 'dst'].forEach(f => { if (isStr(y[f])) y[f] = ren(y[f]); });
  if (y.args) y.args = y.args.map(o => isStr(o) ? ren(o) : o);
}
function addLoopRec(fn, view, extra) {
  const rec = view.rec, id = fn.loops.length;
  fn.loops.push(Object.assign({ id, kind: 'for', line: rec.line, var: view.var, cmp: view.cmp, canonical: false, why: [], hasInner: false, depth: rec.depth, parent: rec.parent, origin: rec.id }, extra));
  return id;
}
function spliceLoop(fn, view, mainLoop, divisible) {
  const I = fn.instrs, pre = I.slice(0, view.h), post = I.slice(view.x + 1), region = I.slice(view.h, view.x + 1);
  const result = divisible ? [...pre, ...mainLoop, ...post] : [...pre, ...mainLoop, ...region, ...post];
  const after = result.slice(view.h, result.length - post.length);
  fn.instrs = result;
  return { before: region, after };
}
function mainLoopHeader(fn, view, step, K, divisible, ln) {
  const out = [], mk = o => { o.line = ln; return o; };
  const c = newTemp(fn);
  const vt = view.latch[0].ty, ct = view.cond.ty;
  if (divisible) out.push(mk({ op: 'bin', o: view.cmp, dst: c, a: view.var, b: view.bound, ty: ct }));
  else { const u = newTemp(fn); out.push(mk({ op: 'bin', o: '+', dst: u, a: view.var, b: (K - 1) * step, ty: vt })); out.push(mk({ op: 'bin', o: view.cmp, dst: c, a: u, b: view.bound, ty: ct })); }
  return { out, c };
}
function unrollTransform(fn, view, K) {
  const rec = view.rec, s = view.step, v = view.var, ln = rec.line, mk = o => { o.line = ln; return o; };
  const divisible = view.trips !== null && view.trips % K === 0;
  const labH = rec.header + '.u', labX = divisible ? rec.exit : rec.header + '.um';
  const newId = addLoopRec(fn, view, { transformed: 'unrolled', header: labH, exit: labX, factor: K });
  const temps = new Set(); view.body.forEach(q => { const d = defOf(q); if (d && isTemp(d)) temps.add(d); });
  const out = [mk({ op: 'label', name: labH })];
  const hd = mainLoopHeader(fn, view, s, K, divisible, ln); out.push(...hd.out);
  out.push(mk({ op: 'jz', a: hd.c, l: labX }), mk({ op: 'loop_body_begin', loop: newId }));
  for (let k = 0; k < K; k++) {
    let iv = v;
    if (k > 0) { iv = `%i${k}.L${newId}`; out.push(mk({ op: 'bin', o: '+', dst: iv, a: v, b: k * s, ty: view.latch[0].ty })); }
    const ren = o => o === v ? iv : (k > 0 && temps.has(o) ? `${o}.u${k}.L${newId}` : o);
    view.body.forEach(q => { const y = clone(q); mapOps(y, ren); out.push(y); });
  }
  out.push(mk({ op: 'loop_body_end', loop: newId }), mk({ op: 'bin', o: s > 0 ? '+' : '-', dst: v, a: v, b: Math.abs(K * s), ty: view.latch[0].ty }), mk({ op: 'jmp', l: labH }), mk({ op: 'label', name: labX }));
  if (divisible) rec.removed = true; else rec.remainder = true;
  return spliceLoop(fn, view, out, divisible);
}
function buildVectorBody(fn, view, dep, VL) {
  const vec = new Set(), renamed = new Map(), out = [], dependsOnI = new Set([view.var]);
  const accAt = new Map(); dep.accs.forEach(a => accAt.set(a.instr, a));
  const useOp = o => isStr(o) && renamed.has(o) ? renamed.get(o) : o;
  const isVec = o => isStr(o) && vec.has(o);
  const scalarDef = d => { if (vec.has(d)) { vec.delete(d); renamed.delete(d); } };
  const isOne = p => pKey(p) === pKey(pConst(1)), isZero = p => !Object.keys(p).length;
  for (let k = view.bodyStart; k < view.bodyEnd; k++) {
    const x = fn.instrs[k], dstName = d => isTemp(d) ? newVec(fn) : d + '.v';
    switch (x.op) {
      case 'load': {
        const a = accAt.get(k);
        if (!a || a.indirect) return { error: `index of ${x.base}[..] is not affine` };
        if (isVec(x.idx) || isVec(x.base)) return { error: 'index depends on loaded data' };
        if (isOne(a.A)) { const nd = dstName(x.dst); renamed.set(x.dst, nd); vec.add(x.dst); out.push({ op: 'vload', dst: nd, base: x.base, idx: x.idx, vl: VL, line: x.line }); }
        else if (isZero(a.A)) { scalarDef(x.dst); out.push(clone(x)); }
        else return { error: `access ${a.text} is not unit-stride` };
        break;
      }
      case 'store': {
        const a = accAt.get(k);
        if (!a || a.indirect || !isOne(a.A)) return { error: `store to ${a ? a.text : x.base + '[..]'} is not contiguous (scatter unsupported)` };
        if (isVec(x.idx)) return { error: 'store index depends on loaded data' };
        if (!isVec(x.a) && isStr(x.a) && dependsOnI.has(x.a)) return { error: 'induction variable is stored as data (needs an index vector)' };
        out.push({ op: 'vstore', base: x.base, idx: x.idx, a: useOp(x.a), av: isVec(x.a), vl: VL, ty: x.ty, line: x.line });
        break;
      }
      case 'bin': {
        if (isVec(x.a) || isVec(x.b)) {
          if ((isStr(x.a) && !isVec(x.a) && dependsOnI.has(x.a)) || (isStr(x.b) && !isVec(x.b) && dependsOnI.has(x.b))) return { error: 'induction variable used as data in a vector operation' };
          const nd = dstName(x.dst); const y = { op: 'vbin', o: x.o, dst: nd, a: useOp(x.a), b: useOp(x.b), av: isVec(x.a), bv: isVec(x.b), vl: VL, ty: x.ty, line: x.line };
          renamed.set(x.dst, nd); vec.add(x.dst); out.push(y);
        } else { scalarDef(x.dst); out.push(clone(x)); if (dependsOnI.has(x.a) || dependsOnI.has(x.b)) dependsOnI.add(x.dst); else dependsOnI.delete(x.dst); }
        break;
      }
      case 'un': {
        if (isVec(x.a)) { const nd = dstName(x.dst); renamed.set(x.dst, nd); vec.add(x.dst); out.push({ op: 'vun', o: x.o, dst: nd, a: useOp(x.a), av: true, vl: VL, ty: x.ty, line: x.line }); }
        else { scalarDef(x.dst); out.push(clone(x)); if (dependsOnI.has(x.a)) dependsOnI.add(x.dst); }
        break;
      }
      case 'copy': {
        if (isVec(x.a)) { renamed.set(x.dst, useOp(x.a)); vec.add(x.dst); }
        else { scalarDef(x.dst); out.push(clone(x)); if (dependsOnI.has(x.a)) dependsOnI.add(x.dst); else dependsOnI.delete(x.dst); }
        break;
      }
      case 'cast': return { error: `type conversion '${fmtInstr(x).trim()}' has no vector form in this engine` };
      default: return { error: `instruction '${x.op}' cannot be vectorised` };
    }
  }
  return { body: out };
}
function vectorizeTransform(fn, view, body, VL) {
  const rec = view.rec, ln = rec.line, mk = o => { o.line = ln; return o; };
  const divisible = view.trips !== null && view.trips % VL === 0;
  const labH = rec.header + '.v', labX = divisible ? rec.exit : rec.header + '.vm';
  const newId = addLoopRec(fn, view, { transformed: 'vectorized', header: labH, exit: labX, factor: VL });
  const out = [mk({ op: 'label', name: labH })];
  const hd = mainLoopHeader(fn, view, 1, VL, divisible, ln); out.push(...hd.out);
  out.push(mk({ op: 'jz', a: hd.c, l: labX }), mk({ op: 'loop_body_begin', loop: newId }), ...body);
  out.push(mk({ op: 'loop_body_end', loop: newId }), mk({ op: 'bin', o: '+', dst: view.var, a: view.var, b: VL, ty: view.latch[0].ty }), mk({ op: 'jmp', l: labH }), mk({ op: 'label', name: labX }));
  if (divisible) rec.removed = true; else rec.remainder = true;
  return spliceLoop(fn, view, out, divisible);
}

function loopChecksCommon(view) {
  const rec = view.rec, c = [];
  c.push({ check: 'Innermost loop with a straight-line body', ok: view.innermost && !rec.hasInner, detail: view.innermost && !rec.hasInner ? 'no nested loop, branch or return inside the body' : rec.hasInner ? 'contains a nested loop' : 'body contains control flow (if / return)' });
  c.push({ check: 'Canonical counted loop  (i = a; i < n; i += c)', ok: view.canonical, detail: view.canonical ? `i=${view.init === null ? '?' : view.init}, i ${view.cmp} ${view.bound}, step ${view.step}` : (rec.why.length ? rec.why.join('; ') : 'loop structure was changed by an earlier transformation') });
  return c;
}
function unrollChecks(fn, view, dep, opts) {
  const K = opts.unrollFactor, c = loopChecksCommon(view);
  if (!c.every(q => q.ok)) return { checks: c, ok: false };
  const sizeInstr = view.body.filter(q => !MARKERS.has(q.op)).length;
  c.push({ check: 'Loop bound is invariant and the induction variable is not modified in the body', ok: true, detail: 'verified when the loop was recognised (bound is a loop-invariant integer expression)' });
  c.push({ check: 'Comparison is <, <=, > or >= (not !=)', ok: view.cmp !== '!=', detail: `condition uses '${view.cmp}'` });
  c.push({ check: 'No function calls in the body', ok: !view.hasCall, detail: view.hasCall ? 'a call may have side effects the unroller cannot see' : 'none' });
  c.push({ check: 'Iteration order is preserved', ok: true, detail: dep && (dep.hasCarried || dep.scalarDeps.length) ? 'loop-carried dependences exist, but unrolling keeps the original order of every statement, so they do not block it' : 'unrolling only repeats the body in the original order' });
  c.push({ check: `Trip count is not smaller than the unroll factor (${K})`, ok: view.trips === null || view.trips >= K, detail: view.trips === null ? 'trip count unknown at compile time: a remainder loop is generated' : `trip count = ${view.trips}` });
  c.push({ check: 'Code growth is acceptable (body ≤ 24 IR instructions)', ok: sizeInstr <= 24, detail: `${sizeInstr} instructions × ${K} copies` });
  return { checks: c, ok: c.every(q => q.ok) };
}
function vectorChecks(fn, view, dep, alias, opts) {
  const VL = opts.vectorWidth, c = loopChecksCommon(view);
  if (!c.every(q => q.ok)) return { checks: c, ok: false };
  c.push({ check: 'Unit stride (step = +1)', ok: view.step === 1 && (view.cmp === '<' || view.cmp === '<='), detail: `step ${view.step}, condition '${view.cmp}'` });
  c.push({ check: 'No function calls in the body', ok: !view.hasCall, detail: view.hasCall ? 'calls cannot be vectorised' : 'none' });
  const aliasR = dep.reasons.filter(r => r.kind === 'alias'), memR = dep.reasons.filter(r => r.kind === 'mem');
  const noAlias = dep.deps.filter(d => d.detail.includes('NO_ALIAS')).map(d => d.detail);
  c.push({ check: 'Alias analysis: written memory cannot overlap other accessed memory', ok: aliasR.length === 0, detail: aliasR.length ? [...new Set(aliasR.map(r => r.msg))].join(' | ') : (noAlias.length ? [...new Set(noAlias)].join(' | ') : 'all accesses go through one base pointer') });
  c.push({ check: 'Dependence analysis: no loop-carried memory dependence', ok: memR.length === 0, detail: memR.length ? [...new Set(memR.map(r => r.msg))].join(' | ') : 'all dependences are loop-independent (same iteration) or absent' });
  c.push({ check: 'No loop-carried scalar dependence (reduction / recurrence)', ok: dep.scalarDeps.length === 0, detail: dep.scalarDeps.length ? dep.scalarDeps.map(s => s.msg).join(' | ') : 'none' });
  c.push({ check: 'No scalar defined in the loop is live after it (liveness analysis)', ok: dep.liveOut.length === 0, detail: dep.liveOut.length ? `${dep.liveOut.join(', ')} used after the loop` : 'none' });
  const bad = dep.accs.filter(a => a.indirect || !(isZeroP(a.A) && a.kind === 'R') && pKey(a.A) !== pKey(pConst(1)));
  c.push({ check: 'Every access is contiguous (stride 1) or a loop-invariant load', ok: bad.length === 0, detail: bad.length ? 'not contiguous: ' + bad.map(a => a.text).join(', ') : 'all accesses are stride-1 or invariant' });
  c.push({ check: `Trip count ≥ vector width (${VL})`, ok: view.trips === null || view.trips >= VL, detail: view.trips === null ? 'unknown: scalar remainder loop is generated' : `trip count = ${view.trips}` });
  let plan = null;
  if (c.every(q => q.ok)) {
    const r = buildVectorBody(fn, view, dep, VL);
    c.push({ check: 'Every operation has an abstract vector form', ok: !r.error, detail: r.error || 'vload / vstore / vector arithmetic available for all operations' });
    plan = r.body || null;
  }
  return { checks: c, ok: c.every(q => q.ok), plan };
}
const isZeroP = p => !Object.keys(p).length;

/* ---------- Pipeline ---------- */
/* ---------- Copy propagation (forward "available copies" dataflow, intersection at joins) ---------- */
const isSynth = n => isTemp(n) || (isStr(n) && /\.i\d+$/.test(n));        // compiler-made names (temps, inlined-callee variables)
function copyProp(fn, opts) {
  const events = [], addr = new Set(fn.addrTaken);
  const okName = n => isStr(n) && !isGlob(n) && !addr.has(n);
  const meetI = list => { if (!list.length) return null; const r = new Map(list[0]); for (const [k, v] of [...r]) if (!list.every(m => m.get(k) === v)) r.delete(k); return r; };
  const xfer = (x, st) => {
    const d = defOf(x); if (!d) return;
    for (const [k, v] of [...st]) if (k === d || v === d) st.delete(k);
    if (x.op === 'copy' && isStr(x.a) && okName(x.a) && okName(d) && x.a !== d) { const src = st.has(x.a) ? st.get(x.a) : x.a; if (src !== d) st.set(d, src); }
  };
  for (let round = 0; round < 4; round++) {
    let changed = false;
    const I = fn.instrs, cfg = buildCFG(I), nb = cfg.blocks.length, OUT = new Array(nb).fill(null), IN = new Array(nb).fill(null);
    let ch = true, it = 0;
    while (ch && it++ < 80) {
      ch = false;
      for (const b of cfg.blocks) {
        if (!b.reachable) continue;
        const inS = b.id === 0 ? new Map() : meetI(b.pred.filter(p => OUT[p] !== null && cfg.blocks[p].reachable).map(p => OUT[p]));
        if (!inS) continue;
        const st = new Map(inS); for (let k = b.start; k <= b.end; k++) xfer(I[k], st);
        if (!sameState(OUT[b.id], st)) { OUT[b.id] = st; ch = true; }
        IN[b.id] = inS;
      }
    }
    for (const b of cfg.blocks) {
      if (!b.reachable || !IN[b.id]) continue;
      const st = new Map(IN[b.id]);
      for (let k = b.start; k <= b.end; k++) {
        const x = I[k], y = Object.assign({}, x), via = [];
        const rw = o => { if (isStr(o) && st.has(o)) { via.push(`${o}→${st.get(o)}`); return st.get(o); } return o; };
        switch (y.op) {
          case 'copy': case 'un': case 'cast': case 'jz': case 'jnz': case 'alloc': y.a = rw(y.a); break;
          case 'ret': if (y.a !== undefined) y.a = rw(y.a); break;
          case 'bin': y.a = rw(y.a); y.b = rw(y.b); break;
          case 'load': y.base = rw(y.base); y.idx = rw(y.idx); break;
          case 'store': y.base = rw(y.base); y.idx = rw(y.idx); y.a = rw(y.a); break;
          case 'call': y.args = y.args.map(rw); break;
        }
        if (via.length) { const before = fmtInstr(x), after = fmtInstr(y); if (before !== after) { events.push({ kind: 'copyprop', line: x.line, before, after, via }); I[k] = y; changed = true; } }
        xfer(I[k], st);
      }
    }
    if (!changed) break;
  }
  dce(fn, opts, events);
  return events;
}

/* ---------- Common subexpression elimination (value numbering inside each basic block) ---------- */
function cse(fn, opts) {
  const events = [], addr = new Set(fn.addrTaken), I = fn.instrs, cfg = buildCFG(I), out = [...I];
  const COMM = new Set(['+', '*', '&', '|', '^', '==', '!=']);
  cfg.blocks.forEach(b => {
    if (!b.reachable) return;
    const tab = new Map();
    const kill = d => { for (const [k, e] of [...tab]) if (e.h === d || e.ops.includes(d)) tab.delete(k); };
    for (let k = b.start; k <= b.end; k++) {
      const x = out[k];
      if (x.op === 'store' || x.op === 'call' || x.op === 'alloc' || x.op === 'vstore') for (const [kk, e] of [...tab]) if (e.load) tab.delete(kk);
      const d = defOf(x); let key = null, ops = [];
      if (d && !addr.has(d) && (x.op === 'bin' || x.op === 'un' || x.op === 'cast' || x.op === 'load')) {
        let A = x.a, B = x.b;
        if (x.op === 'bin' && COMM.has(x.o) && String(A) > String(B)) [A, B] = [B, A];
        key = x.op === 'bin' ? `bin|${x.o}|${x.ty || 'int'}|${A}|${B}` : x.op === 'un' ? `un|${x.o}|${x.ty || 'int'}|${A}` : x.op === 'cast' ? `cast|${x.ty}|${A}` : `load|${x.base}|${x.idx}`;
        ops = (x.op === 'load' ? [x.base, x.idx] : x.op === 'bin' ? [x.a, x.b] : [x.a]).filter(isStr);
      }
      if (key && tab.has(key)) {
        const h = tab.get(key).h, y = { op: 'copy', dst: d, a: h, line: x.line };
        events.push({ kind: 'cse', line: x.line, before: fmtInstr(x), after: fmtInstr(y), via: [h] }); out[k] = y; kill(d); continue;
      }
      if (d) kill(d);
      if (key && !ops.includes(d)) tab.set(key, { h: d, ops, load: x.op === 'load' });
    }
  });
  fn.instrs = out;
  dce(fn, opts, events);
  return events;
}

/* ---------- Strength reduction (runs last, so index arithmetic stays analysable for dependence / cache analysis) ---------- */
function strengthReduce(fn) {
  const events = [], pow2 = n => typeof n === 'number' && n >= 2 && n <= 1073741824 && (n & (n - 1)) === 0, lg = n => Math.round(Math.log2(n));
  fn.instrs = fn.instrs.map(x => {
    if (x.op !== 'bin' || (x.ty !== 'int' && x.ty !== 'uint' && x.ty !== undefined)) return x;
    let y = null;
    if (x.o === '*') {
      if (isStr(x.a) && pow2(x.b)) y = { op: 'bin', o: '<<', dst: x.dst, a: x.a, b: lg(x.b), ty: x.ty, line: x.line };
      else if (isStr(x.b) && pow2(x.a)) y = { op: 'bin', o: '<<', dst: x.dst, a: x.b, b: lg(x.a), ty: x.ty, line: x.line };
    } else if (x.ty === 'uint' && isStr(x.a) && pow2(x.b)) {
      if (x.o === '/') y = { op: 'bin', o: '>>', dst: x.dst, a: x.a, b: lg(x.b), ty: x.ty, line: x.line };
      else if (x.o === '%') y = { op: 'bin', o: '&', dst: x.dst, a: x.a, b: x.b - 1, ty: x.ty, line: x.line };
    }
    if (!y) return x;
    events.push({ kind: 'strength', line: x.line, before: fmtInstr(x), after: fmtInstr(y) }); return y;
  });
  return events;
}

/* ---------- Loop-invariant code motion (innermost canonical loops; only pure, non-trapping, compiler-made values) ---------- */
function licmPlan(fn, view, live) {
  const I = fn.instrs, defs = new Map();
  for (let k = view.bodyStart; k < view.bodyEnd; k++) { const d = defOf(I[k]); if (d) defs.set(d, (defs.get(d) || 0) + 1); }
  const exitLive = live.instIn[view.x] || new Set(), hoisted = new Set(), used = new Set(), idx = [];
  for (let k = view.bodyStart; k < view.bodyEnd; k++) {
    const x = I[k], d = defOf(x), uses = usesOf(x);
    const pureOp = ['bin', 'un', 'cast', 'copy'].includes(x.op);
    const traps = x.op === 'bin' && (x.o === '/' || x.o === '%') && !(typeof x.b === 'number' && x.b !== 0);
    const synthOnly = d && isSynth(d) && !fn.addrTaken.includes(d);
    const invariant = uses.every(u => u !== view.var && !isGlob(u) && (!defs.has(u) || hoisted.has(u)));
    if (pureOp && !traps && synthOnly && defs.get(d) === 1 && !used.has(d) && !exitLive.has(d) && invariant) { idx.push(k); hoisted.add(d); }
    uses.forEach(u => used.add(u));
  }
  return idx;
}
function licmTransform(fn, view, idx) {
  const I = fn.instrs, moved = idx.map(k => I[k]), rm = new Set(idx);
  let p = view.h; for (let k = view.h - 1; k >= 0 && k >= view.h - 3; k--) if (I[k].op === 'copy' && I[k].dst === view.var) { p = k; break; }
  const out = [];
  for (let k = 0; k < I.length; k++) { if (k === p) out.push(...moved); if (!rm.has(k)) out.push(I[k]); }
  fn.instrs = out; return moved;
}

const DEFAULTS = { copyProp: true, cse: true, licm: true, strength: true, inline: true, constFold: true, escapeOpt: true, unroll: true, unrollFactor: 4, vectorize: true, vectorWidth: 4, regs: 6, vregs: 4, dceVars: false, verify: true, testCases: 20, cacheLine: 64, stepLimit: 400000 };

/* ---------- Function inlining (small straight-line callees) ---------- */
function inlineChecks(callee, callerName) {
  const I = callee.instrs, c = [];
  const branchy = I.some(x => ['label', 'jmp', 'jz', 'jnz', 'loop_body_begin', 'loop_body_end'].includes(x.op));
  const side = I.some(x => ['call', 'alloca', 'alloc', 'addr', 'strlit'].includes(x.op)) || (callee.addrTaken || []).length > 0;
  const r = I.findIndex(x => x.op === 'ret');
  const tail = r >= 0 && I.slice(r + 1).every(x => x.op === 'ret' && x.implicit);
  const size = I.filter(x => x.op !== 'ret').length;
  c.push({ check: 'Callee body is straight-line (no loops or branches)', ok: !branchy, detail: branchy ? 'contains control flow' : 'single basic block' });
  c.push({ check: 'Callee makes no calls, allocations or address-of operations', ok: !side, detail: side ? 'it calls other code or takes addresses' : 'only arithmetic and memory accesses' });
  c.push({ check: 'Single return at the end', ok: tail, detail: tail ? 'one return' : 'early or multiple returns' });
  c.push({ check: 'Callee is small (≤ 16 IR instructions)', ok: size <= 16, detail: `${size} instructions` });
  c.push({ check: 'Not recursive', ok: callee.name !== callerName, detail: callee.name !== callerName ? 'callee differs from caller' : 'a function cannot be inlined into itself' });
  return { checks: c, ok: c.every(q => q.ok) };
}
function inlineCalls(fn, fnsOrig) {
  const out = [], results = [];
  for (const x of fn.instrs) {
    const callee = x.op === 'call' ? fnsOrig[x.fn] : null;
    if (!callee) { out.push(x); continue; }
    const ck = inlineChecks(callee, fn.name);
    if (!ck.ok) { out.push(x); results.push({ line: x.line, fn: x.fn, checks: ck.checks, ok: false, before: [fmtInstr(x)], after: [] }); continue; }
    const k = fn.inlN = (fn.inlN || 0) + 1, sfx = '.i' + k, ren = n => isGlob(n) ? n : n + sfx, body = [];
    callee.params.forEach((p, i) => body.push({ op: 'copy', dst: ren(p.name), a: x.args[i], line: x.line }));
    for (const q of callee.instrs) {
      if (q.op === 'ret') { if (q.a !== undefined && x.dst) body.push({ op: 'copy', dst: x.dst, a: isStr(q.a) ? ren(q.a) : q.a, line: x.line }); break; }
      const y = clone(q); mapOps(y, ren); y.line = x.line; body.push(y);
    }
    out.push(...body);
    results.push({ line: x.line, fn: x.fn, checks: ck.checks, ok: true, before: [fmtInstr(x)], after: body.map(b => fmtInstr(b)) });
  }
  fn.instrs = out;
  return results;
}

function cfgReport(fn, cfg) {
  const I = fn.instrs;
  return {
    blocks: cfg.blocks.map(b => ({ id: 'B' + b.id, start: b.start, end: b.end, succ: b.succ.map(s => 'B' + s), pred: b.pred.map(s => 'B' + s), depth: b.depth, reachable: b.reachable, instrs: I.slice(b.start, b.end + 1).filter(x => !MARKERS.has(x.op)).map(x => fmtInstr(x)) })),
    backEdges: cfg.backEdges.map(([a, b]) => `B${a} → B${b}`),
    naturalLoops: cfg.natural.map(l => ({ header: 'B' + l.header, latch: 'B' + l.latch, blocks: l.blocks.map(x => 'B' + x) }))
  };
}
function livenessReport(fn, cfg, live) {
  return cfg.blocks.map((b, i) => ({ id: 'B' + b.id, in: [...live.blockIn[i]].filter(n => !isTemp(n)).sort(), out: [...live.blockOut[i]].filter(n => !isTemp(n)).sort() }));
}
const KIND_PASS = { copyprop: 'Copy Propagation', cse: 'Common Subexpression Elimination', strength: 'Strength Reduction', fold: 'Constant Folding', propagate: 'Constant Propagation', algebraic: 'Algebraic Simplification', branch: 'Branch Folding', unreachable: 'Unreachable-Code Removal', dce: 'Dead-Code Elimination', warn: 'Constant Folding' };
function eventChecks(e) {
  switch (e.kind) {
    case 'fold': return [{ check: 'All operands are compile-time constants', ok: true, detail: e.via && e.via.length ? `after propagating ${e.via.join(', ')}` : 'literal operands' }, { check: 'Evaluated with 32-bit signed C arithmetic', ok: true, detail: 'same routine used by the verifier' }, { check: 'No division by zero', ok: true, detail: 'divisor is non-zero' }];
    case 'propagate': return [{ check: 'Every path that reaches this use assigns the same constant', ok: true, detail: `dataflow meet over all predecessors gives ${e.via.join(', ')}` }, { check: 'Variable cannot be changed through a pointer', ok: true, detail: 'its address is never taken' }];
    case 'algebraic': return [{ check: 'Identity holds for every integer value', ok: true, detail: 'x+0, x-0, x*1, x/1 → x ;  x*0 → 0' }];
    case 'branch': return [{ check: 'Branch condition is a compile-time constant', ok: true, detail: e.why }];
    case 'unreachable': return [{ check: 'No path from function entry reaches the block', ok: true, detail: 'checked on the control-flow graph' }];
    case 'dce': return [{ check: 'Result is never used afterwards (liveness analysis)', ok: true, detail: e.why }, { check: 'Instruction has no side effect', ok: true, detail: 'copy / arithmetic / load only' }];
    case 'copyprop': return [{ check: 'The copy is available on every path reaching this use', ok: true, detail: `dataflow intersection over all predecessors: ${e.via.join(', ')}` }, { check: 'Neither side of the copy is redefined in between', ok: true, detail: 'a redefinition kills the copy' }, { check: 'Neither name has its address taken', ok: true, detail: 'no pointer can change it behind the compiler\'s back' }];
    case 'cse': return [{ check: 'An identical expression was computed earlier in the same basic block', ok: true, detail: `value is still held by ${e.via.join(', ')}` }, { check: 'No operand was redefined since', ok: true, detail: 'value numbering table invalidated on every definition' }, { check: 'For loads: no store or call in between', ok: true, detail: 'memory could not have changed' }];
    case 'strength': return [{ check: 'Integer type with two\'s-complement wrap-around', ok: true, detail: 'x*2^k and x<<k agree modulo 2^32' }, { check: 'Constant operand is a power of two', ok: true, detail: e.before + ' → ' + e.after }];
    case 'warn': return [{ check: 'No division by zero', ok: false, detail: e.why }];
  }
  return [];
}

function processFunction(fn0, fnsOrig, opts) {
  const F = { name: fn0.name, ret: fn0.ret, params: fn0.params, optimizations: [], loops: [] };
  const orig = clone(fn0);
  const E = F.optimizations; let eid = 0;
  const push = e => { e.id = ++eid; E.push(e); return e; };
  F.irBefore = irLines(orig.instrs);
  const cfg0 = buildCFG(orig.instrs), live0 = liveness(orig, cfg0), alias0 = aliasAnalysis(orig);
  F.cfg = cfgReport(orig, cfg0); F.liveness = livenessReport(orig, cfg0, live0);
  F.alias = { pointsTo: alias0.pointsTo, pairs: alias0.pairs }; F.escape = escapeAnalysis(orig, alias0);
  F.loopTable = orig.loops.map(r => ({ id: r.id, line: r.line, kind: r.kind, canonical: r.canonical, var: r.var, depth: r.depth, why: r.why }));
  const verifier = opts.verify ? makeVerifier(orig, fnsOrig, opts) : null;
  const accept = cand => { if (!verifier) return { ok: true, v: null }; const v = verifier.check(cand); return { ok: v.failed === 0, v }; };
  const unverifiedNote = r => r.v && r.v.passed === 0 ? ' (no test input could be executed, so only static checks back this transformation)' : '';
  let cur = clone(orig);
  /* snapshots of the IR after every stage: used by the Optimizer Time Machine view */
  F.snapshots = [];
  let stageStart = 0;
  const snap = (name, note) => {
    const cfg = buildCFG(cur.instrs), rep = cfgReport(cur, cfg), lines = irLines(cur.instrs);
    const text = lines.map(l => l.t).join('\n'), prev = F.snapshots[F.snapshots.length - 1];
    const events = E.slice(stageStart).map(e => e.id); stageStart = E.length;
    if (prev && prev.text === text && !events.length) return;
    F.snapshots.push({ name, note, text, ir: lines, cfg: { blocks: rep.blocks, backEdges: rep.backEdges }, count: lines.filter(l => l.k !== 'marker' && l.k !== 'label').length, changed: !prev || prev.text !== text, events });
  };
  snap('Source → three-address code', 'Lowered straight from the AST. Nothing is optimised yet.');

  /* --- Pass 0: inline small callee functions (removes call overhead and exposes the body to later passes) --- */
  if (opts.inline && cur.instrs.some(x => x.op === 'call' && fnsOrig[x.fn])) {
    const cand = clone(cur), res = inlineCalls(cand, fnsOrig);
    const r = res.some(q => q.ok) ? accept(cand) : { ok: true };
    res.forEach(q => push({
      pass: 'Function Inlining', target: `call ${q.fn}() at line ${q.line}`, line: q.line,
      status: !q.ok ? 'REJECTED' : r.ok ? 'APPLIED' : 'REVERTED', safety: q.checks,
      reason: !q.ok ? q.checks.filter(c => !c.ok).map(c => `${c.check} – ${c.detail}`).join('  |  ') : r.ok ? 'the callee is a small straight-line function, so its body replaces the call; later passes can now fold it' : 'dynamic verification failed; change rolled back',
      before: q.before, after: q.after, decision: !q.ok ? 'Call retained' : r.ok ? 'Transformation kept' : 'Original retained'
    }));
    if (res.some(q => q.ok) && r.ok) cur = cand;
  }

  snap('Function inlining', 'Calls to small straight-line functions replaced by their bodies.');
  /* --- Pass 1: constant folding & friends --- */
  if (opts.constFold) {
    const cand = clone(cur), ev = constFold(cand, opts);
    if (ev.length) {
      const r = accept(cand);
      ev.forEach(e => push({
        pass: KIND_PASS[e.kind], target: `line ${e.line}`, line: e.line,
        status: e.kind === 'warn' ? 'REJECTED' : r.ok ? 'APPLIED' : 'REVERTED', safety: eventChecks(e),
        reason: e.kind === 'warn' ? e.why : r.ok ? (e.why || 'all safety conditions hold') + unverifiedNote(r) : 'the batch of constant-folding changes failed dynamic verification and was rolled back',
        before: [e.before], after: [e.after], decision: e.kind === 'warn' ? 'Original expression retained' : r.ok ? 'Transformation kept' : 'Original retained'
      }));
      if (r.ok) cur = cand;
    }
  }

  snap('Constant folding, propagation, dead code', 'Dataflow-based constant propagation, folding, branch folding, unreachable and dead-code removal.');
  /* --- Pass 1b: copy propagation, common subexpressions (each verified, each event reported) --- */
  const evPass = (enabled, fnPass, nameOverride) => {
    if (!enabled) return;
    const cand = clone(cur), ev = fnPass(cand, opts);
    if (!ev.length) return;
    const r = accept(cand);
    ev.forEach(e => push({
      pass: KIND_PASS[e.kind] + (nameOverride || ''), target: `line ${e.line}`, line: e.line, status: r.ok ? 'APPLIED' : 'REVERTED', safety: eventChecks(e),
      reason: r.ok ? (e.kind === 'dce' ? e.why : 'all safety conditions hold') + unverifiedNote(r) : 'failed dynamic verification and was rolled back',
      before: [e.before], after: [e.after], decision: r.ok ? 'Transformation kept' : 'Original retained'
    }));
    if (r.ok) cur = cand;
  };
  evPass(opts.copyProp, copyProp);
  snap('Copy propagation', 'Uses of a copied variable are replaced by the original (available-copies dataflow); the now-dead copies are removed.');
  evPass(opts.cse, cse);
  evPass(opts.copyProp, copyProp);
  snap('Common subexpression elimination', 'An expression computed twice in a basic block is computed once and reused (value numbering).');
  /* --- Pass 2: escape analysis -> heap-to-stack promotion --- */
  if (opts.escapeOpt && cur.instrs.some(x => x.op === 'alloc')) {
    const cand = clone(cur), res = promoteHeap(cand);
    const r = res.some(q => q.ok) ? accept(cand) : { ok: true };
    res.forEach(q => push({
      pass: 'Heap-to-Stack Promotion (Escape Analysis)', target: `${q.x.dst} = malloc(...) at line ${q.x.line}`, line: q.x.line,
      status: !q.ok ? 'REJECTED' : r.ok ? 'APPLIED' : 'REVERTED', safety: q.checks,
      reason: !q.ok ? 'failed: ' + q.checks.filter(c => !c.ok).map(c => c.check).join('; ') : r.ok ? 'object never escapes, so it can live in the stack frame; the matching free() is removed' : 'verification failed',
      before: [fmtInstr(q.x)], after: [q.ok ? fmtInstr(cand.instrs.find(i => i.op === 'alloca' && i.dst === q.x.dst) || q.x) : fmtInstr(q.x)], decision: !q.ok ? 'Heap allocation retained' : r.ok ? 'Transformation kept' : 'Original retained'
    }));
    if (res.some(q => q.ok) && r.ok) cur = cand;
  }
  snap('Heap → stack promotion', 'Escape analysis moves non-escaping malloc/calloc blocks to the stack and deletes the matching free().');
  const snapshotForCache = clone(cur);

  /* --- Pass 3: loop analyses + loop optimisations (vectorise first, else unroll) --- */
  const ids = cur.loops.filter(l => !l.transformed).map(l => l.id);
  let loopChanged = false;
  for (const id of ids) {
    let view = loopView(cur, id); const rec = cur.loops[id];
    if (!view) { push({ pass: 'Loop Analysis', target: `loop at line ${rec.line}`, line: rec.line, status: 'SKIPPED', safety: [], reason: 'loop was removed by constant folding / branch folding', before: [], after: [], decision: 'Nothing to optimise' }); continue; }
    if (opts.licm && view.canonical && view.innermost && !rec.hasInner) {            /* loop-invariant code motion */
      const lcfg = buildCFG(cur.instrs), llive = liveness(cur, lcfg), plan = licmPlan(cur, view, llive);
      if (plan.length) {
        const cand = clone(cur), cv = loopView(cand, id), moved = licmTransform(cand, cv, licmPlan(cand, cv, liveness(cand, buildCFG(cand.instrs))));
        const r = accept(cand);
        push({ pass: 'Loop-Invariant Code Motion', target: `for loop at line ${rec.line} (${rec.var})`, line: rec.line, status: r.ok ? 'APPLIED' : 'REVERTED',
          safety: [{ check: 'Innermost canonical loop with a straight-line body', ok: true, detail: 'the hoisted code ran on every iteration anyway' },
            { check: 'Every operand is defined outside the loop (or hoisted itself)', ok: true, detail: 'none depends on ' + rec.var },
            { check: 'Operation is pure and cannot trap', ok: true, detail: 'no memory access; no division by a non-constant' },
            { check: 'Result is a compiler temporary, defined once, not live after the loop', ok: true, detail: moved.map(m => m.dst).join(', ') }],
          reason: r.ok ? `${moved.length} loop-invariant computation(s) moved in front of the loop so they run once instead of every iteration` + unverifiedNote(r) : 'failed dynamic verification and was rolled back',
          before: moved.map(m => fmtInstr(m)), after: moved.map(m => fmtInstr(m) + '     ; now before the loop'), decision: r.ok ? 'Transformation kept' : 'Original retained' });
        if (r.ok) { cur = cand; view = loopView(cur, id); }
      }
    }
    const cfg = buildCFG(cur.instrs), live = liveness(cur, cfg), alias = aliasAnalysis(cur);
    const tgt = `${rec.kind} loop at line ${rec.line}` + (rec.var ? ` (${rec.var})` : '');
    const lr = { id, line: rec.line, kind: rec.kind, var: rec.var, canonical: view.canonical, innermost: view.innermost && !rec.hasInner, why: rec.why, init: view.init, bound: view.bound, step: view.step, cmp: view.cmp, tripCount: view.trips };
    let dep = null;
    if (lr.innermost && view.canonical) {
      dep = analyzeLoopDeps(cur, view, alias, live);
      lr.accesses = dep.accs.map(a => ({ ref: a.text, kind: a.kind, line: a.line })); lr.dependences = dep.deps; lr.scalarDeps = dep.scalarDeps.map(s => s.msg); lr.liveOut = dep.liveOut;
      lr.parallel = !dep.memBlocking && !dep.scalarDeps.length;
    }
    F.loops.push(lr);
    const before = irLines(view.h >= 0 ? cur.instrs.slice(view.h, view.x + 1) : []).map(l => l.t);
    const mkEntry = (pass, ck, status, reason, after, extra) => push(Object.assign({ pass, target: tgt, line: rec.line, status, safety: ck.checks, reason, before, after: after || [], decision: status === 'APPLIED' ? 'Transformation kept' : status === 'SKIPPED' ? 'Not attempted' : status === 'REVERTED' ? 'Reverted – original loop retained' : 'Original loop retained' }, extra || {}));
    const failed = ck => ck.checks.filter(c => !c.ok).map(c => `${c.check} – ${c.detail}`);
    let done = false;

    if (opts.vectorize) {
      const vc = dep ? vectorChecks(cur, view, dep, alias, opts) : { checks: loopChecksCommon(view), ok: false };
      if (vc.ok) {
        const cand = clone(cur), cv = loopView(cand, id), res = vectorizeTransform(cand, cv, vc.plan.map(clone), opts.vectorWidth);
        const r = accept(cand);
        if (r.ok) { cur = cand; done = true; loopChanged = true; mkEntry('Auto-Vectorization (abstract SIMD, width ' + opts.vectorWidth + ')', vc, 'APPLIED', 'every safety condition holds: no aliasing, no loop-carried dependence, contiguous accesses' + unverifiedNote(r), irLines(res.after).map(l => l.t), { verification: r.v && { passed: r.v.passed, failed: r.v.failed } }); }
        else mkEntry('Auto-Vectorization (abstract SIMD, width ' + opts.vectorWidth + ')', vc, 'REVERTED', 'static checks passed but dynamic verification failed (' + (r.v.cases.find(c => c.status === 'FAIL') || {}).label + '); change rolled back');
      } else mkEntry('Auto-Vectorization (abstract SIMD, width ' + opts.vectorWidth + ')', vc, 'REJECTED', failed(vc).join('  |  ') || 'not applicable');
    } else if (opts.vectorize === false) push({ pass: 'Auto-Vectorization (abstract SIMD)', target: tgt, line: rec.line, status: 'SKIPPED', safety: [], reason: 'disabled in the options', before: [], after: [], decision: 'Not attempted' });

    if (opts.unroll) {
      if (done) {
        push({ pass: `Loop Unrolling (×${opts.unrollFactor})`, target: tgt, line: rec.line, status: 'SKIPPED', safety: [], reason: 'the loop was already vectorised; vectorisation takes priority over unrolling', before: [], after: [], decision: 'Not attempted' });
      } else {
        const v2 = loopView(cur, id);
        const uc = unrollChecks(cur, v2, dep, opts);
        if (uc.ok) {
          const cand = clone(cur), cv = loopView(cand, id), res = unrollTransform(cand, cv, opts.unrollFactor);
          const r = accept(cand);
          if (r.ok) { cur = cand; loopChanged = true; mkEntry(`Loop Unrolling (×${opts.unrollFactor})`, uc, 'APPLIED', 'loop is canonical and countable; unrolling preserves iteration order, so it is safe even with dependences' + (v2.trips !== null && v2.trips % opts.unrollFactor === 0 ? '; trip count divisible by the factor, no remainder loop needed' : '; a remainder loop handles the leftover iterations') + unverifiedNote(r), irLines(res.after).map(l => l.t), { verification: r.v && { passed: r.v.passed, failed: r.v.failed } }); }
          else mkEntry(`Loop Unrolling (×${opts.unrollFactor})`, uc, 'REVERTED', 'static checks passed but dynamic verification failed; change rolled back');
        } else mkEntry(`Loop Unrolling (×${opts.unrollFactor})`, uc, 'REJECTED', failed(uc).join('  |  '));
      }
    }
  }
  snap('Loop optimisations (vectorise / unroll)', 'Each loop is analysed; vectorisation is tried first, unrolling second, every change is verified.');
  if (loopChanged && opts.constFold) {
    const cand = clone(cur), ev = constFold(cand, opts);
    if (ev.length) { const r = accept(cand); if (r.ok) { cur = cand; ev.forEach(e => push({ pass: KIND_PASS[e.kind] + ' (post-loop cleanup)', target: `line ${e.line}`, line: e.line, status: e.kind === 'warn' ? 'REJECTED' : 'APPLIED', safety: eventChecks(e), reason: e.why || 'folding exposed by the loop transformation', before: [e.before], after: [e.after], decision: 'Transformation kept' })); } }
  }
  snap('Cleanup after loop transforms', 'Constant folding again, now that unrolling/vectorising exposed new constants.');
  evPass(opts.strength, strengthReduce, '');
  snap('Strength reduction', 'Multiplication by a power of two becomes a shift (done last so index arithmetic stays analysable).');
  F.cache = cacheAnalysis(snapshotForCache, opts);
  F.irAfter = irLines(cur.instrs);
  F.regalloc = { before: regAlloc(orig, opts.regs, opts.vregs), after: regAlloc(cur, opts.regs, opts.vregs) };
  /* --- final verification against the ORIGINAL program --- */
  if (verifier) {
    const v = verifier.check(cur);
    F.verification = { passed: v.passed, failed: v.failed, skipped: v.skipped, cases: v.cases, status: v.failed ? 'FAIL' : v.passed ? 'PASS' : 'INCONCLUSIVE' };
    F.metrics = { tests: v.passed, before: v.before, after: v.after, changePct: v.before.instr ? +((v.after.instr - v.before.instr) / v.before.instr * 100).toFixed(1) : 0 };
    if (v.failed) { cur = clone(orig); F.irAfter = irLines(cur.instrs); F.verification.note = 'Final verification failed – the original code is emitted.'; }
  } else F.verification = { status: 'DISABLED', passed: 0, failed: 0, skipped: 0, cases: [] };
  F.finalFn = cur;
  F.stats = {
    applied: E.filter(e => e.status === 'APPLIED').length, rejected: E.filter(e => e.status === 'REJECTED').length,
    reverted: E.filter(e => e.status === 'REVERTED').length, skipped: E.filter(e => e.status === 'SKIPPED').length
  };
  return F;
}

function astToTree(n) {
  const T = (t, c) => ({ t, c: c || [] });
  if (!n) return T('(none)');
  switch (n.k) {
    case 'program': return T('Program', [...(n.globals || []).map(astToTree), ...n.fns.map(astToTree)]);
    case 'fn': return T(`Function ${n.name}(${n.params.map(p => p.ty + (p.kind === 'ptr' ? ' *' : ' ') + (p.restrict ? 'restrict ' : '') + p.name).join(', ')}) → ${n.ret}`, n.body.body.map(astToTree));
    case 'block': return T('Block', n.body.map(astToTree));
    case 'decl': return T('Declaration', n.vars.map(v => T(`${v.ty}${v.ptr ? ' *' : ' '}${v.name}${v.dims ? v.dims.map(d => '[' + (d ? (d.v !== undefined ? d.v : '..') : '') + ']').join('') : ''}`, [...(v.init ? [astToTree(v.init)] : []), ...((v.list || []).flat(9).map(astToTree))])));
    case 'switch': return T('Switch', [T('value', [astToTree(n.e)]), ...n.items.map(astToTree)]);
    case 'case': return T('case', [astToTree(n.e)]);
    case 'default': return T('default');
    case 'dowhile': return T('Do-While', [T('body', [astToTree(n.body)]), T('condition', [astToTree(n.c)])]);
    case 'break': return T('Break');
    case 'continue': return T('Continue');
    case 'cast': return T(`Cast (${n.ty}${n.ptr ? ' *' : ''})`, [astToTree(n.e)]);
    case 'str': return T(`String ${JSON.stringify(n.v)}`);
    case 'sizeofe': return T('sizeof', [astToTree(n.e)]);
    case 'expr': return astToTree(n.e);
    case 'if': return T('If', [T('condition', [astToTree(n.c)]), T('then', [astToTree(n.t)]), ...(n.f ? [T('else', [astToTree(n.f)])] : [])]);
    case 'while': return T('While', [T('condition', [astToTree(n.c)]), T('body', [astToTree(n.body)])]);
    case 'for': return T('For', [T('init', n.init ? [astToTree(n.init)] : []), T('condition', n.cond ? [astToTree(n.cond)] : []), T('step', n.step ? [astToTree(n.step)] : []), T('body', [astToTree(n.body)])]);
    case 'ret': return T('Return', n.e ? [astToTree(n.e)] : []);
    case 'num': return T(`Number ${n.v}${n.ty && n.ty !== 'int' ? ' (' + n.ty + ')' : ''}`);
    case 'var': return T(`Variable ${n.name}`);
    case 'idx': return T('Index  [ ]', [astToTree(n.base), astToTree(n.index)]);
    case 'un': return T(`Unary ${n.o}`, [astToTree(n.e)]);
    case 'bin': return T(`Binary ${n.o}`, [astToTree(n.l), astToTree(n.r)]);
    case 'assign': return T(`Assign ${n.o}`, [astToTree(n.l), astToTree(n.r)]);
    case 'incdec': return T(`${n.post ? 'post' : 'pre'}${n.o}`, [astToTree(n.e)]);
    case 'call': return T(`Call ${n.name}`, n.args.map(astToTree));
    case 'empty': return T('Empty statement');
  }
  return T(n.k);
}

function compile(source, userOpts) {
  const opts = Object.assign({}, DEFAULTS, userOpts || {});
  const R = { ok: false, options: opts, diagnostics: [], functions: [], stages: [] };
  const lines = source.split('\n');
  const addDiag = d => { d.source = lines[d.line - 1]; R.diagnostics.push(d); };
  const fail = e => {
    if (!(e instanceof CompileError)) throw e;
    addDiag({ level: 'error', line: e.line, col: e.col, message: e.message, hint: e.hint, fix: e.fix }); return R;
  };
  let toks, ast;
  try { toks = lex(source); } catch (e) { return fail(e); }
  R.tokens = { count: toks.length - 1, sample: toks.slice(0, 80).map(t => ({ type: t.t, text: t.v, line: t.line, col: t.col })) };
  try { ast = parse(toks, source.length); } catch (e) { return fail(e); }
  R.ast = astToTree(ast);
  const diags = [];
  const low = lowerProgram(ast, diags), fns = low.fns;
  diags.forEach(addDiag);
  if (diags.some(d => d.level === 'error')) return R;
  const fnsOrig = {}; fns.forEach(f => { fnsOrig[f.name] = clone(f); }); fnsOrig.__g = low.globals; R.globals = low.globals.map(g => ({ name: g.name.slice(1), type: g.ty, elements: g.size }));
  fns.forEach(f => R.functions.push(processFunction(f, fnsOrig, opts)));
  const sum = { functions: R.functions.length, applied: 0, rejected: 0, reverted: 0, skipped: 0, tests: 0, failed: 0 };
  R.functions.forEach(F => { sum.applied += F.stats.applied; sum.rejected += F.stats.rejected; sum.reverted += F.stats.reverted; sum.skipped += F.stats.skipped; sum.tests += F.verification.passed || 0; sum.failed += F.verification.failed || 0; });
  R.summary = sum; R.ok = true;
  R.reportText = reportText(R);
  R.stages = stageSummary(R);
  R.irText = {}; R.functions.forEach(F => { R.irText[F.name] = { before: F.irBefore.map(l => l.t).join('\n'), after: F.irAfter.map(l => l.t).join('\n') }; });
  R.functions.forEach(F => delete F.finalFn);
  return R;
}

function reportText(R) {
  const L = [];
  L.push('INTELLIGENT COMPILER OPTIMIZATION ENGINE – OPTIMIZATION REPORT', '='.repeat(62));
  R.functions.forEach(F => {
    L.push('', `FUNCTION ${F.name}`, '-'.repeat(40));
    F.optimizations.forEach(e => {
      L.push(`Optimization: ${e.pass}`, `Target: ${e.target}`, `Status: ${e.status}`);
      if (e.safety.length) { L.push('Safety checks:'); e.safety.forEach(c => L.push(`  [${c.ok ? 'PASS' : 'FAIL'}] ${c.check} – ${c.detail}`)); }
      L.push('Reason:', ...String(e.reason).split('  |  ').map(r => `  - ${r}`));
      if (e.before.length && e.before.length < 6) L.push('Before:', ...e.before.map(x => '  ' + x.trim()));
      if (e.after.length && e.after.length < 6) L.push('After:', ...e.after.map(x => '  ' + x.trim()));
      L.push(`Decision: ${e.decision}`, '');
    });
    L.push(`Verification: ${F.verification.status} (${F.verification.passed} passed, ${F.verification.failed} failed, ${F.verification.skipped} skipped)`);
    if (F.metrics && F.metrics.before.instr) L.push(`Dynamic IR instructions over ${F.metrics.tests} tests: ${F.metrics.before.instr} → ${F.metrics.after.instr} (${F.metrics.changePct}%)  [experimental measurement]`);
  });
  return L.join('\n');
}
function stageSummary(R) {
  const f = R.functions[0];
  return [
    { name: '1. Lexer', out: `${R.tokens.count} tokens` },
    { name: '2. Parser → AST', out: `${R.functions.length} function(s)` },
    { name: '3. Semantic checks', out: `${R.diagnostics.filter(d => d.level === 'warning').length} warning(s), 0 errors` },
    { name: '4. Three-address IR', out: `${R.functions.reduce((s, x) => s + x.irBefore.filter(l => l.k !== 'marker' && l.k !== 'label').length, 0)} instructions` },
    { name: '5. CFG / basic blocks', out: `${R.functions.reduce((s, x) => s + x.cfg.blocks.length, 0)} blocks` },
    { name: '6. Analyses', out: 'alias · escape · liveness · dependence' },
    { name: '7. Safety checks + optimisation', out: `${R.summary.applied} applied, ${R.summary.rejected} rejected` },
    { name: '8. Backend analysis', out: 'register allocation · cache behaviour' },
    { name: '9. Verification', out: `${R.summary.tests} tests passed, ${R.summary.failed} failed` },
    { name: '10. Report', out: 'explanation trace' }
  ];
}

return { compile, lex, parse, DEFAULTS, version: '1.0' };
