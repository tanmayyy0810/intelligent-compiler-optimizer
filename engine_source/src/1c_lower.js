/* ================= PART 1c : SEMANTIC CHECKS + LOWERING (AST -> typed three-address code) ================= */
const NO_ESCAPE_BUILTINS = new Set(['free', 'printf', 'scanf']);
const prodDims = a => a.reduce((x, y) => x * y, 1);
const T_INT = { k: 'int', ty: 'int' };
const tInt = ty => ({ k: 'int', ty });
const tPtr = (ty, dims) => ({ k: 'ptr', ty, dims });

function lowerProgram(ast, diags) {
  const sigs = {}, globalScope = new Map(), gdesc = [];
  ast.fns.forEach(f => {
    if (sigs[f.name]) diags.push({ level: 'error', line: f.line, col: f.col, message: `Redefinition of function '${f.name}'`, hint: 'Rename one of the functions.' });
    else sigs[f.name] = f;
  });
  /* global variables become named memory objects '@name' that every function can load/store */
  (ast.globals || []).forEach(d => d.vars.forEach(v => {
    const err = (m, h) => diags.push({ level: 'error', line: v.line, col: v.col, message: m, hint: h });
    if (globalScope.has(v.name)) { err(`Redefinition of global '${v.name}'`, 'Rename or delete the duplicate.'); return; }
    let size = 1, dims, kind = v.ptr ? 'ptr' : 'int', initVals = [];
    if (v.dims) {
      if (v.ptr) { err('Arrays of pointers are not supported', 'Use a flat int array.'); return; }
      dims = v.dims.map(e => e ? constEval(e) : null);
      if (dims.slice(1).some(x => x === null || x <= 0)) { err('Array dimensions must be positive constants', 'Example: int a[3][3];'); return; }
      if (dims[0] === null) { if (v.list) dims[0] = Array.isArray(v.list[0]) || dims.length > 1 ? v.list.length : v.list.length; else if (v.init && v.init.k === 'str') dims[0] = v.init.v.length + 1; }
      if (dims[0] === null || dims[0] <= 0) { err(`Array '${v.name}' needs a positive constant size`, 'Example: int a[10];'); return; }
      size = prodDims(dims); kind = 'array';
    }
    const flat = (items, level, base) => {
      let pos = 0; const sub = dims ? prodDims(dims.slice(level + 1)) : 1;
      for (const it of items) {
        if (Array.isArray(it)) { pos = Math.ceil(pos / sub) * sub; flat(it, level + 1, base + pos); pos += sub; }
        else { const c = cev(it); if (c === null) { err('Global initialisers must be constants', 'Use literal numbers.'); return; } initVals[base + pos] = castTo(v.ty, c.v); pos++; }
      }
    };
    if (v.list) flat(v.list, 0, 0);
    else if (v.init && v.init.k === 'str' && kind === 'array') { for (let k = 0; k < v.init.v.length; k++) initVals[k] = v.init.v.charCodeAt(k); }
    else if (v.init) { const c = cev(v.init); if (c === null) { err('Global initialisers must be constants', 'Use literal numbers.'); return; } initVals[0] = castTo(v.ty, c.v); }
    const sym = { name: '@' + v.name, src: v.name, kind, ty: v.ty, dims, size, global: true, used: true, node: v };
    globalScope.set(v.name, sym);
    gdesc.push({ name: '@' + v.name, size, ty: v.ty, init: Array.from({ length: size }, (_, k) => initVals[k] === undefined ? 0 : initVals[k]) });
  }));
  const fns = ast.fns.map(f => lowerFunction(f, sigs, diags, globalScope));
  return { fns, globals: gdesc };
}

function retType(sig) { return sig.ret === 'void' ? null : sig.ret.endsWith('*') ? tPtr(sig.ret.slice(0, -1)) : tInt(sig.ret); }

function lowerFunction(f, sigs, diags, globalScope) {
  const fn = { name: f.name, ret: f.ret, line: f.line, params: [], instrs: [], loops: [], addrTaken: [] };
  let tmpN = 0, lblN = 0, shadowN = 0;
  const T = () => '%t' + (++tmpN), L = () => 'L' + (++lblN);
  const scopes = [globalScope], loopStack = [], jumpStack = [];
  const addrNames = new Set();
  walk(f.body, x => { if (x.k === 'un' && x.o === '&' && x.e.k === 'var') addrNames.add(x.e.name); if (x.k === 'call' && x.name === 'scanf') x.args.forEach(a => { if (a.k === 'var') addrNames.add(a.name); }); });
  let curLine = f.line;
  const err = (n, msg, hint, fix) => diags.push({ level: 'error', line: n.line, col: n.col, message: msg, hint, fix });
  const warn = (n, msg, hint) => diags.push({ level: 'warning', line: n.line, col: n.col, message: msg, hint });
  const emit = (ins, n) => { ins.line = n ? n.line : curLine; fn.instrs.push(ins); return ins; };
  const retT = retType(f);

  const pushScope = () => scopes.push(new Map());
  function popScope() {
    const sc = scopes.pop();
    sc.forEach(s => { if (!s.used && !s.param) warn(s.node, `Variable '${s.src}' is declared but never used`, 'Remove it or use it.'); });
  }
  function declare(name, node, kind, extra) {
    const cur = scopes[scopes.length - 1];
    if (cur.has(name)) err(node, `Redeclaration of '${name}' in the same scope`, 'Rename the variable or delete the duplicate declaration.');
    const shadow = scopes.slice(1).some(sc => sc.has(name));
    const sym = Object.assign({ name: shadow ? `${name}_${++shadowN}` : name, src: name, kind, used: false, node }, extra || {});
    cur.set(name, sym); return sym;
  }
  function lookup(n) {
    for (let k = scopes.length - 1; k >= 0; k--) if (scopes[k].has(n.name)) { const s = scopes[k].get(n.name); s.used = true; return s; }
    const names = []; scopes.forEach(sc => sc.forEach((_, key) => names.push(key)));
    let best = null, bd = 3;
    names.forEach(c => { const d = editDistance(n.name, c); if (d < bd) { bd = d; best = c; } });
    const tok = n.tok;
    err(n, `Use of undeclared identifier '${n.name}'`, best ? `Did you mean '${best}'?` : `Declare it first, e.g.  int ${n.name} = 0;`,
      best && tok ? { from: tok.pos, to: tok.end, text: best } : undefined);
    return null;
  }
  function peekSym(name) { for (let k = scopes.length - 1; k >= 0; k--) if (scopes[k].has(name)) return scopes[k].get(name); return null; }

  /* ---------- static types of expressions (no code emitted) ---------- */
  const idxChain = e => { let n = 0, b = e; while (b.k === 'idx') { n++; b = b.base; } return { n, base: b }; };
  function typeOf(e) {
    switch (e.k) {
      case 'num': return tInt(e.ty || 'int');
      case 'str': return tPtr('char');
      case 'sizeofe': return T_INT;
      case 'var': { const s = peekSym(e.name); if (!s) return T_INT; return s.kind === 'int' ? tInt(s.ty) : tPtr(s.ty, s.dims); }
      case 'idx': { const { n, base } = idxChain(e); const bt = typeOf(base); if (bt.k !== 'ptr') return T_INT; const d = bt.dims; return d && d.length > n ? tPtr(bt.ty, d.slice(n)) : tInt(bt.ty); }
      case 'cast': return e.ptr ? tPtr(e.ty) : tInt(e.ty);
      case 'un': {
        if (e.o === '&') { const t = typeOf(e.e); return tPtr(t.ty); }
        if (e.o === '*') return typeOf({ k: 'idx', base: e.e, index: { k: 'num', v: 0 } });
        if (e.o === '!') return T_INT;
        return tInt(promote(typeOf(e.e).ty));
      }
      case 'bin': {
        const a = typeOf(e.l), b = typeOf(e.r);
        if (a.k === 'ptr' || b.k === 'ptr') { if ((e.o === '+' || e.o === '-') && a.k === 'ptr' && b.k !== 'ptr') return a; if (e.o === '+' && b.k === 'ptr') return b; return T_INT; }
        if (CMP_OPS.has(e.o)) return T_INT;
        if (e.o === '<<' || e.o === '>>') return tInt(promote(a.ty));
        return tInt(commonType(a.ty, b.ty));
      }
      case 'call': {
        if (['malloc', 'calloc', 'alloca', 'realloc'].includes(e.name)) return tPtr('int');
        const g = sigs[e.name]; const r = g && retType(g); return r || T_INT;
      }
      case 'assign': return typeOf(e.l);
      case 'incdec': return typeOf(e.e);
      case 'cond': { const a = typeOf(e.a), b = typeOf(e.b); if (a.k === 'ptr') return a; if (b.k === 'ptr') return b; return tInt(commonType(a.ty, b.ty)); }
    }
    return T_INT;
  }
  /* convert operand `o` of type `from` to scalar type `to`; emits a cast instruction only when the value could change */
  function conv(o, from, to, node) {
    if (from === to || lossless(from, to)) return o;
    if (typeof o === 'number') return castTo(to, o);
    const t = T(); emit({ op: 'cast', dst: t, a: o, ty: to, from }, node); return t;
  }
  const needsCast = (from, to) => !(from === to || lossless(from, to));

  /* ---------- index chains: a[i][j] -> flat element index into the underlying object ---------- */
  function resolveIdx(e) {
    const idxs = []; let b = e;
    while (b.k === 'idx') { idxs.unshift(b.index); b = b.base; }
    const bt = typeOf(b);
    if (bt.k !== 'ptr') { err(e, 'Subscripted value is not an array or pointer', 'Only arrays and pointers can be indexed with [].'); return { err: true }; }
    const dims = bt.dims || [null];
    if (idxs.length > dims.length) { err(e, `Too many subscripts: '${b.name || 'value'}' has ${dims.length} dimension(s)`, dims.length === 1 ? 'Arrays of pointers (int **) are not supported; use a flat array and compute i*n + j.' : ''); return { err: true }; }
    const base = opnd(b);
    let acc = null;
    idxs.forEach((ix, k) => {
      const io = opnd(ix);
      const ti = typeOf(ix);
      if (isFloatTy(ti.ty)) err(ix, 'Array subscript is not an integer', 'Use an int index.');
      const stride = prodDims(dims.slice(k + 1).map(x => x === null ? 1 : x));
      let term = io;
      if (stride !== 1) { if (typeof io === 'number') term = io * stride; else { const t = T(); emit({ op: 'bin', o: '*', dst: t, a: io, b: stride, ty: 'int' }, e); term = t; } }
      if (acc === null) acc = term;
      else if (typeof acc === 'number' && typeof term === 'number') acc = acc + term;
      else { const t = T(); emit({ op: 'bin', o: '+', dst: t, a: acc, b: term, ty: 'int' }, e); acc = t; }
    });
    return { base, idx: acc === null ? 0 : acc, ty: bt.ty, partial: idxs.length < dims.length, dims: dims.slice(idxs.length) };
  }

  /* ---------- expressions ---------- */
  function opnd(e, dst, noval, hint) {
    curLine = e.line;
    switch (e.k) {
      case 'num': return e.v;
      case 'str': { const d = dst || T(); emit({ op: 'strlit', dst: d, text: e.v }, e); return d; }
      case 'sizeofe': {                                  // sizeof(expr): compile-time, from the static type; operand is not executed
        const x = e.e;
        if (x.k === 'var') { const s = lookup(x); if (!s) return 0; return s.kind === 'array' ? s.size * TYSIZE[s.ty] : s.kind === 'ptr' ? 8 : TYSIZE[s.ty]; }
        const te = typeOf(x);
        if (te.k === 'ptr') return te.dims ? prodDims(te.dims.map(d => d || 1)) * TYSIZE[te.ty] : 8;
        return TYSIZE[te.ty] || 4;
      }
      case 'var': {
        const s = lookup(e); if (!s) return 0;
        if (s.global && s.kind !== 'array') { const d = dst || T(); emit({ op: 'load', dst: d, base: s.name, idx: 0 }, e); return d; }
        return s.name;
      }
      case 'idx': {
        const r = resolveIdx(e); if (r.err) return 0;
        const d = dst || T();
        if (r.partial) emit({ op: 'bin', o: '+', dst: d, a: r.base, b: r.idx, ty: 'int' }, e); else emit({ op: 'load', dst: d, base: r.base, idx: r.idx }, e);
        return d;
      }
      case 'cast': {
        if (e.ptr) return opnd(e.e, dst, noval, e.ty);
        const te = typeOf(e.e), o = opnd(e.e);
        if (typeof o === 'number') return castTo(e.ty, o);
        const d = dst || T(); emit({ op: 'cast', dst: d, a: o, ty: e.ty, from: te.ty }, e); return d;
      }
      case 'un': {
        if (e.o === '*') return opnd({ k: 'idx', base: e.e, index: { k: 'num', v: 0, ty: 'int', line: e.line, col: e.col }, line: e.line, col: e.col }, dst, noval);
        if (e.o === '&') {
          const x = e.e;
          if (x.k === 'var') {
            const s = lookup(x); if (!s) return 0;
            if (s.kind === 'array') return s.name;
            if (s.kind === 'ptr') { err(e, 'Taking the address of a pointer variable is not supported', 'Only &x of a numeric variable or &a[i] is supported.'); return 0; }
            if (s.global) return s.name;
            if (!fn.addrTaken.includes(s.name)) fn.addrTaken.push(s.name);
            const d = dst || T(); emit({ op: 'addr', dst: d, a: s.name }, e); return d;
          }
          if (x.k === 'idx') {
            const r = resolveIdx(x); if (r.err) return 0;
            const d = dst || T(); emit({ op: 'bin', o: '+', dst: d, a: r.base, b: r.idx, ty: 'int' }, e); return d;
          }
          if (x.k === 'un' && x.o === '*') return opnd(x.e, dst);
          err(e, 'Cannot take the address of this expression', ''); return 0;
        }
        const te = typeOf(e.e);
        if (te.k === 'ptr') { err(e, `Invalid operand to unary '${e.o}' (pointer)`, ''); return 0; }
        if (e.o === '~' && isFloatTy(te.ty)) err(e, "Invalid operand to '~' (floating point)", 'Use an integer.');
        const a = opnd(e.e); const d = dst || T();
        emit({ op: 'un', o: e.o, dst: d, a, ty: e.o === '!' ? 'int' : promote(te.ty) }, e); return d;
      }
      case 'bin': {
        const tl = typeOf(e.l), tr = typeOf(e.r);
        if (e.o === '&&' || e.o === '||') {                // short-circuit evaluation exactly like C
          const d = T(), Lend = L(), a = opnd(e.l);
          emit({ op: 'copy', dst: d, a: e.o === '&&' ? 0 : 1 }, e);
          emit({ op: e.o === '&&' ? 'jz' : 'jnz', a, l: Lend }, e);
          const b = opnd(e.r); emit({ op: 'bin', o: '!=', dst: d, a: b, b: 0, ty: 'int' }, e);
          emit({ op: 'label', name: Lend }, e); return d;
        }
        if (tl.k === 'ptr' || tr.k === 'ptr') {
          if (!['+', '-', '<', '>', '<=', '>=', '==', '!=', '&&', '||'].includes(e.o)) err(e, `Invalid operands to binary '${e.o}' (pointer operand)`, 'Pointers support only +, - and comparisons.');
          let a = opnd(e.l), b = opnd(e.r);
          if ((e.o === '+' || e.o === '-') && tl.k === 'ptr' && tr.k !== 'ptr' && tl.dims && tl.dims.length > 1) {   // pointer to row: scale by row size
            const rowSz = prodDims(tl.dims.slice(1)); if (typeof b === 'number') b *= rowSz; else { const t = T(); emit({ op: 'bin', o: '*', dst: t, a: b, b: rowSz, ty: 'int' }, e); b = t; }
          }
          const d = dst || T(); emit({ op: 'bin', o: e.o, dst: d, a, b, ty: 'int' }, e); return d;
        }
        if (e.o === '%' && (isFloatTy(tl.ty) || isFloatTy(tr.ty))) err(e, "Invalid operands to '%' (floating point)", 'Use fmod-like logic with integers, or cast to int.');
        if (['&', '|', '^', '<<', '>>'].includes(e.o) && (isFloatTy(tl.ty) || isFloatTy(tr.ty))) err(e, `Invalid operands to '${e.o}' (floating point)`, 'Bitwise operators need integer operands.');
        const shift = e.o === '<<' || e.o === '>>';
        const opTy = (e.o === '&&' || e.o === '||') ? 'int' : shift ? promote(tl.ty) : commonType(tl.ty, tr.ty);
        let a = opnd(e.l), b = opnd(e.r);
        if (e.o !== '&&' && e.o !== '||') { a = conv(a, tl.ty, opTy, e); if (!shift) b = conv(b, tr.ty, opTy, e); }
        const d = dst || T();
        emit({ op: 'bin', o: e.o, dst: d, a, b, ty: opTy }, e); return d;
      }
      case 'cond': {                                      // c ? a : b  ->  jumps, both arms write the same destination
        const ta = typeOf(e.a), tb = typeOf(e.b), rt = typeOf(e);
        const d = dst || T(), Le = L(), Ln = L();
        const c = opnd(e.c); emit({ op: 'jz', a: c, l: Le }, e);
        const arm = (x, tx) => { if (rt.k === 'ptr') { const r = opnd(x, d, false, hint); if (r !== d) emit({ op: 'copy', dst: d, a: r }, x); } else { if (tx.k === 'ptr') { err(x, 'Cannot mix a pointer and a number in ?:', ''); return; } const r = conv(opnd(x), tx.ty, rt.ty, x); emit({ op: 'copy', dst: d, a: r }, x); } };
        arm(e.a, ta); emit({ op: 'jmp', l: Ln }, e); emit({ op: 'label', name: Le }, e); arm(e.b, tb); emit({ op: 'label', name: Ln }, e);
        return d;
      }
      case 'call': return lowerCall(e, dst, noval, hint);
      case 'assign': return lowerAssign(e);
      case 'incdec': {
        const lv = lvalue(e.e); if (!lv) return 0;
        const ty = lv.isPtr ? 'int' : lv.ty, o = e.o === '++' ? '+' : '-';
        if (lv.k === 'var') {
          let old = null;
          if (e.post && !noval) { old = T(); emit({ op: 'copy', dst: old, a: lv.sym.name }, e); }
          emit({ op: 'bin', o, dst: lv.sym.name, a: lv.sym.name, b: 1, ty }, e);
          return old !== null ? old : lv.sym.name;
        }
        const t = T(), t2 = T();
        emit({ op: 'load', dst: t, base: lv.base, idx: lv.idx }, e);
        emit({ op: 'bin', o, dst: t2, a: t, b: 1, ty }, e);
        emit({ op: 'store', base: lv.base, idx: lv.idx, a: t2, ty: lv.ty }, e);
        return e.post ? t : t2;
      }
    }
    return 0;
  }
  function hasSideEffect(e) { let r = false; walk(e, x => { if (x.k === 'assign' || x.k === 'incdec' || x.k === 'call') r = true; }); return r; }

  /* write `e` into local variable sym with the correct C conversion */
  function intoVar(e, sym) {
    if (sym.kind === 'ptr') { const te = typeOf(e); if (te.k !== 'ptr' && !(e.k === 'num' && e.v === 0)) warn(e, `Initialising pointer '${sym.src}' from a non-pointer value`, ''); const r = opnd(e, sym.name, false, sym.ty); if (r !== sym.name) emit({ op: 'copy', dst: sym.name, a: r }, e); return; }
    const te = typeOf(e);
    if (te.k === 'ptr') { err(e, `Cannot assign a pointer to numeric variable '${sym.src}'`, 'Declare the variable as a pointer (int *p) or dereference the value (*p).'); return; }
    if (e.k === 'num') { emit({ op: 'copy', dst: sym.name, a: castTo(sym.ty, e.v) }, e); return; }
    if (!needsCast(te.ty, sym.ty)) { const r = opnd(e, sym.name); if (r !== sym.name) emit({ op: 'copy', dst: sym.name, a: r }, e); return; }
    const r = opnd(e);
    if (typeof r === 'number') emit({ op: 'copy', dst: sym.name, a: castTo(sym.ty, r) }, e);
    else emit({ op: 'cast', dst: sym.name, a: r, ty: sym.ty, from: te.ty }, e);
  }
  function lvalue(L) {
    if (L.k === 'var') {
      const s = lookup(L); if (!s) return null;
      if (s.kind === 'array') { err(L, `Cannot assign to array '${s.src}'`, 'Assign to its elements: a[i] = ...'); return null; }
      if (s.global) return { k: 'mem', base: s.name, idx: 0, ty: s.ty, isPtr: s.kind === 'ptr' };
      return { k: 'var', sym: s, ty: s.ty, isPtr: s.kind === 'ptr' };
    }
    const node = L.k === 'idx' ? L : { k: 'idx', base: L.e, index: { k: 'num', v: 0, ty: 'int', line: L.line, col: L.col }, line: L.line, col: L.col };
    const r = resolveIdx(node); if (r.err) return null;
    if (r.partial) { err(L, 'Cannot assign to a whole row of a multi-dimensional array', 'Assign to a single element: a[i][j] = ...'); return null; }
    return { k: 'mem', base: r.base, idx: r.idx, ty: r.ty, isPtr: false };
  }
  function lowerAssign(e) {
    const lv = lvalue(e.l); if (!lv) { opnd(e.r); return 0; }
    const tr = typeOf(e.r);
    if (e.o === '=') {
      if (lv.k === 'var') { intoVar(e.r, lv.sym); return lv.sym.name; }
      if (!lv.isPtr && tr.k === 'ptr') { err(e, 'Cannot store a pointer into a numeric element', ''); return 0; }
      let r = opnd(e.r, null, false, lv.isPtr ? lv.ty : undefined);
      if (!lv.isPtr) r = conv(r, tr.ty, lv.ty, e);
      emit({ op: 'store', base: lv.base, idx: lv.idx, a: r, ty: lv.ty }, e); return r;
    }
    const op = e.o.slice(0, -1);
    let cur;
    if (lv.k === 'var') cur = lv.sym.name; else { cur = T(); emit({ op: 'load', dst: cur, base: lv.base, idx: lv.idx }, e); }
    if (lv.isPtr) {
      const r = opnd(e.r); const d = lv.k === 'var' ? lv.sym.name : T();
      emit({ op: 'bin', o: op, dst: d, a: cur, b: r, ty: 'int' }, e);
      if (lv.k !== 'var') emit({ op: 'store', base: lv.base, idx: lv.idx, a: d, ty: lv.ty }, e);
      return d;
    }
    if (op === '%' && (isFloatTy(lv.ty) || isFloatTy(tr.ty))) err(e, "Invalid operands to '%=' (floating point)", 'Use integers.');
    const shift = op === '<<' || op === '>>';
    const opTy = shift ? promote(lv.ty) : commonType(lv.ty, tr.ty);
    let rhs = opnd(e.r); rhs = shift ? rhs : conv(rhs, tr.ty, opTy, e);
    const curc = conv(cur, lv.ty, opTy, e);
    if (lv.k === 'var' && !needsCast(opTy, lv.ty)) { emit({ op: 'bin', o: op, dst: lv.sym.name, a: curc, b: rhs, ty: opTy }, e); return lv.sym.name; }
    const t = T(); emit({ op: 'bin', o: op, dst: t, a: curc, b: rhs, ty: opTy }, e);
    const r = conv(t, opTy, lv.ty, e);
    if (lv.k === 'var') emit({ op: 'copy', dst: lv.sym.name, a: r }, e); else emit({ op: 'store', base: lv.base, idx: lv.idx, a: r, ty: lv.ty }, e);
    return r;
  }

  function lowerCall(e, dst, noval, hint) {
    const nm = e.name;
    if (nm === 'printf' || nm === 'scanf' || nm === 'puts' || nm === 'putchar') return lowerIO(e, dst, noval);
    if (nm === 'malloc' || nm === 'alloca') {
      if (e.args.length !== 1) { err(e, `${nm} expects exactly 1 argument (number of bytes)`, 'Example: malloc(10 * sizeof(int))'); return 0; }
      const b = opnd(e.args[0]); const d = dst || T(); emit({ op: 'alloc', dst: d, a: b, esz: TYSIZE[hint] || 4 }, e); return d;
    }
    if (nm === 'calloc') {
      if (e.args.length !== 2) { err(e, 'calloc expects 2 arguments (count, size)', 'Example: calloc(10, sizeof(int))'); return 0; }
      const n = opnd(e.args[0]), s = opnd(e.args[1]); let b;
      if (typeof n === 'number' && typeof s === 'number') b = n * s; else { b = T(); emit({ op: 'bin', o: '*', dst: b, a: n, b: s, ty: 'int' }, e); }
      const d = dst || T(); emit({ op: 'alloc', dst: d, a: b, esz: TYSIZE[hint] || 4 }, e); return d;
    }
    if (nm === 'realloc') {
      if (e.args.length !== 2) { err(e, 'realloc expects 2 arguments (pointer, bytes)', ''); return 0; }
      const p = opnd(e.args[0]), b = opnd(e.args[1]); const d = dst || T(); emit({ op: 'call', fn: 'realloc', dst: d, args: [p, b], esz: TYSIZE[hint] || 4 }, e); return d;
    }
    if (nm === 'free') {
      if (e.args.length !== 1) { err(e, 'free expects exactly 1 argument', ''); return 0; }
      emit({ op: 'call', fn: 'free', args: [opnd(e.args[0])] }, e); return 0;
    }
    const g = sigs[nm];
    if (!g) { err(e, `Call to undeclared function '${nm}'`, 'Only functions defined in this file, malloc/calloc/realloc/free, printf, scanf, puts and putchar are available.'); return 0; }
    if (g.params.length !== e.args.length) { err(e, `Function '${nm}' expects ${g.params.length} argument(s) but ${e.args.length} given`, ''); return 0; }
    const args = e.args.map((a, i) => {
      const p = g.params[i], ta = typeOf(a);
      if (p.kind === 'int') { if (ta.k === 'ptr') { err(a, `Argument ${i + 1} of '${nm}' must be a number, not a pointer`, 'Dereference it (*p) or pass an element.'); return 0; } return conv(opnd(a), ta.ty, p.ty, a); }
      if (ta.k !== 'ptr' && !(a.k === 'num' && a.v === 0)) { err(a, `Argument ${i + 1} of '${nm}' must be a pointer or array`, "Pass an array name or &x.", a.k === 'var' && a.tok ? { from: a.tok.pos, to: a.tok.pos, text: '&' } : undefined); return 0; }
      return opnd(a);
    });
    const d = g.ret === 'void' ? null : (dst || T());
    emit({ op: 'call', fn: nm, dst: d, args }, e);
    return d === null ? 0 : d;
  }
  function lowerIO(e, dst, noval) {
    const nm = e.name;
    const want = noval ? null : (dst || T());
    if (nm === 'putchar') {
      if (e.args.length !== 1) { err(e, 'putchar expects 1 argument', ''); return 0; }
      emit({ op: 'call', fn: 'printf', fmt: '%c', args: [opnd(e.args[0])], dst: want }, e); return want === null ? 0 : want;
    }
    if (nm === 'puts') {
      if (e.args.length !== 1) { err(e, 'puts expects 1 argument', ''); return 0; }
      const a = e.args[0];
      if (a.k === 'str') emit({ op: 'call', fn: 'printf', fmt: a.v.replace(/%/g, '%%') + '\n', args: [], dst: want }, e);
      else emit({ op: 'call', fn: 'printf', fmt: '%s\n', args: [opnd(a)], dst: want }, e);
      return want === null ? 0 : want;
    }
    if (!e.args.length || e.args[0].k !== 'str') { err(e, `${nm} needs a string literal as its first argument`, `Example: ${nm}("%d", ${nm === 'scanf' ? '&x' : 'x'});`); return 0; }
    const fmt = e.args[0].v, rest = e.args.slice(1), n = countSpecs(fmt);
    if (n !== rest.length) warn(e, `${nm} format has ${n} conversion(s) but ${rest.length} argument(s) were given`, 'Make the number of % conversions match the number of arguments.');
    if (nm === 'printf') {
      const args = rest.map(a => { const ta = typeOf(a); return opnd(a); });
      emit({ op: 'call', fn: 'printf', fmt, args, dst: want }, e); return want === null ? 0 : want;
    }
    const pty = [], args = rest.map((a, i) => {
      const ta = typeOf(a);
      if (ta.k !== 'ptr') { err(a, `scanf argument ${i + 1} must be a pointer`, a.k === 'var' ? `Did you forget '&' before '${a.name}'?` : 'Pass the address of a variable, e.g. &x.', a.k === 'var' && a.tok ? { from: a.tok.pos, to: a.tok.pos, text: '&' } : undefined); return 0; }
      pty.push(ta.ty); return opnd(a);
    });
    emit({ op: 'call', fn: 'scanf', fmt, args, pty, dst: want }, e); return want === null ? 0 : want;
  }

  /* ---------- statements ---------- */
  function lowerDecl(s) {
    for (const v of s.vars) {
      const ty = v.ty;
      if (v.dims) {
        if (v.ptr) { err(v, 'Arrays of pointers are not supported', 'Use a flat int array.'); continue; }
        const dims = v.dims.map(d => d ? constEval(d) : null);
        if (v.dims.some((d, k) => d && dims[k] === null)) { err(v, `Array '${v.name}' has a non-constant size (variable-length arrays are not supported)`, 'Use a constant size such as  int a[100];  or  #define N 100  then  int a[N];', v.dims[0] && v.dims[0].k === 'var' && v.dims[0].tok ? undefined : undefined); continue; }
        if (dims.slice(1).some(x => x === null || x <= 0) || (dims[0] !== null && dims[0] <= 0)) { err(v, `Array '${v.name}' needs positive constant dimensions`, 'Variable-length arrays are not supported. Example: int a[100]; or int m[3][3];'); continue; }
        if (dims[0] === null) { if (v.list) dims[0] = v.list.length; else if (v.init && v.init.k === 'str') dims[0] = v.init.v.length + 1; }
        if (dims[0] === null || dims[0] <= 0) { err(v, `Array '${v.name}' needs a size`, 'Example: int a[10];'); continue; }
        const total = prodDims(dims);
        const sym = declare(v.name, v, 'array', { size: total, ty, dims });
        emit({ op: 'alloca', dst: sym.name, n: total, ty }, v);
        const st = (pos, val, node) => { const tv = typeOf(val); if (tv.k === 'ptr') { err(node, 'Array elements must be numbers', ''); return; } emit({ op: 'store', base: sym.name, idx: pos, a: conv(opnd(val), tv.ty, ty, node), ty }, node); };
        if (v.list) {
          const fill = (items, level, base) => {
            let pos = 0; const sub = prodDims(dims.slice(level + 1));
            for (const it of items) {
              if (Array.isArray(it)) { pos = Math.ceil(pos / sub) * sub; fill(it, level + 1, base + pos); pos += sub; }
              else { if (base + pos >= total) { warn(v, `Too many initialisers for '${v.name}'`, ''); break; } st(base + pos, it, v); pos++; }
            }
          };
          fill(v.list, 0, 0);
        } else if (v.init && v.init.k === 'str') {
          if (v.init.v.length + 1 > total) warn(v, `String is longer than array '${v.name}'`, `Make the array at least ${v.init.v.length + 1} elements.`);
          for (let k = 0; k < Math.min(v.init.v.length, total); k++) emit({ op: 'store', base: sym.name, idx: k, a: v.init.v.charCodeAt(k), ty }, v);
        } else if (v.init) err(v, 'An array cannot be initialised with a single value', 'Use braces: int a[3] = {1, 2, 3};');
      } else {
        const sym = declare(v.name, v, v.ptr ? 'ptr' : 'int', { ty, restrict: v.restrict });
        if (v.list) { err(v, 'Brace initialiser used for a scalar', ''); continue; }
        if (v.init) intoVar(v.init, sym);
      }
    }
  }
  function lowerStmt(s) {
    curLine = s.line;
    switch (s.k) {
      case 'empty': return;
      case 'block': pushScope(); s.body.forEach(lowerStmt); popScope(); return;
      case 'decl': lowerDecl(s); return;
      case 'expr': opnd(s.e, null, true); return;
      case 'ret': {
        if (retT === null && s.e) { err(s, 'Void function should not return a value', 'Remove the value.'); opnd(s.e); emit({ op: 'ret', a: undefined }, s); return; }
        if (retT !== null && !s.e) warn(s, 'Non-void function returns without a value', 'Return a value.');
        let o;
        if (s.e) {
          const te = typeOf(s.e); o = opnd(s.e, null, false, retT && retT.k === 'ptr' ? retT.ty : undefined);
          if (retT && retT.k === 'int') { if (te.k === 'ptr') err(s, 'Returning a pointer from a numeric function', ''); else o = conv(o, te.ty, retT.ty, s); }
        }
        emit({ op: 'ret', a: o }, s); return;
      }
      case 'break': { const j = jumpStack[jumpStack.length - 1]; if (!j) { err(s, "'break' outside of a loop or switch", 'Use break only inside for, while, do-while or switch.'); return; } emit({ op: 'jmp', l: j.brk }, s); return; }
      case 'continue': {
        let j = null; for (let k = jumpStack.length - 1; k >= 0; k--) if (jumpStack[k].kind !== 'switch') { j = jumpStack[k]; break; }
        if (!j) { err(s, "'continue' outside of a loop", 'Use continue only inside for, while or do-while.'); return; }
        j.usedCont = true; emit({ op: 'jmp', l: j.cont }, s); return;
      }
      case 'if': {
        const c = opnd(s.c), Lelse = L(); curLine = s.line;
        emit({ op: 'jz', a: c, l: Lelse }, s);
        lowerStmt(s.t);
        if (s.f) { const Lend = L(); emit({ op: 'jmp', l: Lend }, s); emit({ op: 'label', name: Lelse }, s); lowerStmt(s.f); emit({ op: 'label', name: Lend }, s); }
        else emit({ op: 'label', name: Lelse }, s);
        return;
      }
      case 'switch': return lowerSwitch(s);
      case 'while': return lowerLoop(s, null, 'while');
      case 'for': return lowerLoop(s, s, 'for');
      case 'dowhile': return lowerLoop(s, null, 'do');
    }
  }
  function lowerSwitch(s) {
    const te = typeOf(s.e);
    if (te.k !== 'int' || isFloatTy(te.ty)) err(s, 'The switch expression must be an integer', 'Use an int or char value.');
    const v = opnd(s.e), Lend = L(), seen = new Map(); let defL = null;
    const labels = s.items.map(it => {
      if (it.k === 'case') {
        const c = constEval(it.e);
        if (c === null) { err(it, 'case value must be an integer constant', 'Use a literal such as case 3: or case \'a\':'); return null; }
        if (seen.has(c)) err(it, `Duplicate case value ${c}`, 'Each case label must be unique.'); seen.set(c, 1);
        return { Lc: L(), val: c };
      }
      if (it.k === 'default') { if (defL) err(it, 'More than one default label', ''); defL = L(); return { Lc: defL }; }
      return null;
    });
    const opTy = commonType(te.ty, 'int');
    s.items.forEach((it, k) => { if (it.k === 'case' && labels[k]) { const t = T(); emit({ op: 'bin', o: '==', dst: t, a: v, b: labels[k].val, ty: opTy }, it); emit({ op: 'jnz', a: t, l: labels[k].Lc }, it); } });
    emit({ op: 'jmp', l: defL || Lend }, s);
    jumpStack.push({ brk: Lend, kind: 'switch' }); pushScope();
    s.items.forEach((it, k) => { if (it.k === 'case' || it.k === 'default') { if (labels[k]) emit({ op: 'label', name: labels[k].Lc }, it); } else lowerStmt(it); });
    popScope(); jumpStack.pop();
    emit({ op: 'label', name: Lend }, s);
  }
  function lowerLoop(s, forNode, kind) {
    pushScope();
    const rec = { id: fn.loops.length, kind: kind === 'do' ? 'dowhile' : kind, line: s.line, var: null, cmp: null, bound: null, canonical: false, why: [], header: L(), exit: L(), hasInner: false, depth: loopStack.length, parent: loopStack.length ? loopStack[loopStack.length - 1] : null };
    fn.loops.push(rec);
    if (rec.parent !== null) fn.loops[rec.parent].hasInner = true;
    let cond = forNode ? forNode.cond : s.c, stepNode = null, boundOp = null, boundTy = 'int';
    if (forNode) {
      if (forNode.init) { if (forNode.init.k === 'decl') lowerDecl(forNode.init); else opnd(forNode.init, null, true); }
      stepNode = forNode.step;
      let vname = null; const I = forNode.init;
      if (I && I.k === 'decl' && I.vars.length === 1 && I.vars[0].init && !I.vars[0].dims && !I.vars[0].ptr) vname = I.vars[0].name;
      else if (I && I.k === 'assign' && I.o === '=' && I.l.k === 'var') vname = I.l.name;
      else rec.why.push('initialiser is not a single "i = value"');
      const asg = assignedIn(forNode.body);
      if (vname) {
        const sym = peekSym(vname);
        const okCond = cond && cond.k === 'bin' && ['<', '<=', '>', '>=', '!='].includes(cond.o) && cond.l.k === 'var' && cond.l.name === vname;
        if (!okCond) rec.why.push('condition is not of the form  i < bound');
        const st = stepOf(stepNode, vname);
        if (st === null || st === 0) rec.why.push('step is not a constant increment such as i++ or i += 2');
        if (sym && (sym.kind !== 'int' || !INT_TYPES.has(sym.ty) || sym.global)) rec.why.push(`induction variable '${vname}' is not a local integer`);
        if (asg.has(vname)) rec.why.push(`induction variable '${vname}' is modified inside the loop body`);
        if (addrNames.has(vname)) rec.why.push(`address of '${vname}' is taken`);
        if (okCond && st) {
          if ((cond.o === '<' || cond.o === '<=') && st < 0) rec.why.push('step direction contradicts the condition');
          if ((cond.o === '>' || cond.o === '>=') && st > 0) rec.why.push('step direction contradicts the condition');
          const pure = x => x.k === 'num' || (x.k === 'var' && (() => { const q = peekSym(x.name); return q && q.kind === 'int' && !q.global && !asg.has(x.name) && !addrNames.has(x.name); })())
            || (x.k === 'bin' && !['&&', '||'].includes(x.o) && pure(x.l) && pure(x.r)) || (x.k === 'un' && x.o === '-' && pure(x.e));
          const tb = typeOf(cond.r);
          if (!pure(cond.r) || tb.k !== 'int' || !INT_TYPES.has(tb.ty)) rec.why.push('bound is not a loop-invariant integer expression');
          if (!rec.why.length) { rec.canonical = true; rec.var = sym.name; rec.cmp = cond.o; rec.step = st; boundTy = commonType(sym.ty, tb.ty); boundOp = conv(opnd(cond.r), tb.ty, boundTy, cond); }
        }
      }
    } else if (kind === 'while') rec.why.push('while loop (not a counted for-loop)');
    else rec.why.push('do-while loop (not a counted for-loop)');
    const entry = { brk: rec.exit, kind, cont: kind === 'while' ? rec.header : L(), usedCont: false };
    if (kind === 'do') {
      emit({ op: 'label', name: rec.header }, s);
      emit({ op: 'loop_body_begin', loop: rec.id }, s);
      loopStack.push(rec.id); jumpStack.push(entry);
      lowerStmt(s.body);
      jumpStack.pop(); loopStack.pop();
      emit({ op: 'loop_body_end', loop: rec.id }, s);
      if (entry.usedCont) emit({ op: 'label', name: entry.cont }, s);
      const c = opnd(cond); emit({ op: 'jnz', a: c, l: rec.header }, s);
      emit({ op: 'label', name: rec.exit }, s);
      popScope(); return;
    }
    emit({ op: 'label', name: rec.header }, s);
    if (rec.canonical) {
      const c = T(); emit({ op: 'bin', o: rec.cmp, dst: c, a: rec.var, b: boundOp, ty: boundTy }, s);
      emit({ op: 'jz', a: c, l: rec.exit }, s);
    } else if (cond) { const c = opnd(cond); emit({ op: 'jz', a: c, l: rec.exit }, s); }
    emit({ op: 'loop_body_begin', loop: rec.id }, s);
    loopStack.push(rec.id); jumpStack.push(entry);
    lowerStmt(forNode ? forNode.body : s.body);
    jumpStack.pop(); loopStack.pop();
    if (entry.usedCont && kind === 'for') emit({ op: 'label', name: entry.cont }, s);
    emit({ op: 'loop_body_end', loop: rec.id }, s);
    if (stepNode) opnd(stepNode, null, true);
    emit({ op: 'jmp', l: rec.header }, s);
    emit({ op: 'label', name: rec.exit }, s);
    popScope();
  }

  pushScope();
  f.params.forEach(p => { const sym = declare(p.name, p, p.kind, { restrict: p.restrict, param: true, ty: p.ty, dims: p.dims }); fn.params.push({ name: sym.name, kind: p.kind, ty: p.ty, restrict: p.restrict, dims: p.dims }); });
  f.body.body.forEach(lowerStmt);
  popScope();
  const last = fn.instrs[fn.instrs.length - 1];
  fn.tmpN = tmpN; fn.vecN = 0;
  if (!last || last.op !== 'ret') {
    if (f.ret !== 'void' && f.name !== 'main') warn(f, `Control may reach the end of non-void function '${f.name}'`, 'Add a return statement at the end.');
    fn.instrs.push({ op: 'ret', a: f.ret === 'void' ? undefined : 0, line: f.line, implicit: true });
  }
  const g = new Set(); fn.instrs.forEach(x => ['a', 'b', 'base', 'idx', 'dst'].forEach(k => { if (isGlob(x[k])) g.add(x[k]); }));
  fn.globalNames = [...g];
  return fn;
}
