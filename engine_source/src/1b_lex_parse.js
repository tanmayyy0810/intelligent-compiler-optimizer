/* ================= PART 1b : LEXER + PARSER ================= */
const UNSUP_TYPES = new Set(['struct', 'enum', 'typedef', 'union']);
const UNSUP_STMT = new Set(['goto']);
const TYKW = new Set(['bool', '_Bool', 'int', 'char', 'short', 'long', 'float', 'double', 'unsigned', 'signed', 'void', 'const']);
const KW = new Set(['bool', '_Bool', 'int', 'char', 'short', 'long', 'float', 'double', 'unsigned', 'signed', 'void', 'const', 'for', 'while', 'do', 'if', 'else', 'return', 'restrict', 'sizeof',
  'break', 'continue', 'switch', 'case', 'default', ...UNSUP_TYPES, ...UNSUP_STMT]);
const OPS2 = ['<=', '>=', '==', '!=', '&&', '||', '++', '--', '+=', '-=', '*=', '/=', '%=', '<<', '>>'];
const OPS1 = '+-*/%<>=!&|^~()[]{};,:?';
const ESC = { n: 10, t: 9, r: 13, '0': 0, '\\': 92, "'": 39, '"': 34, a: 7, b: 8, f: 12, v: 11 };

function lex(src, macros) {
  if (!macros) { macros = new Map(); macros.set('true', [{ t: 'num', v: 1, ty: 'int' }]); macros.set('false', [{ t: 'num', v: 0, ty: 'int' }]); macros.set('NULL', [{ t: 'num', v: 0, ty: 'int' }]); }
  const toks = []; let i = 0, line = 1, ls = 0;
  const col = () => i - ls + 1;
  while (i < src.length) {
    const c = src[i];
    if (c === '\n') { i++; line++; ls = i; continue; }
    if (c === ' ' || c === '\t' || c === '\r') { i++; continue; }
    if (c === '#') {                                              // preprocessor: #include ignored, simple #define NAME value supported
      let j = i; while (j < src.length && src[j] !== '\n') j++;
      const txt = src.slice(i, j).replace(/\/\/.*$/, '');
      const m = /^#\s*define\s+([A-Za-z_]\w*)(\(?)\s*(.*)$/.exec(txt);
      if (m && !m[2]) { try { const sub = lex(m[3].trim(), macros); sub.pop(); macros.set(m[1], sub); } catch (e) { /* ignore bad macro */ } }
      i = j; continue;
    }
    if (c === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      if (end < 0) throw new CompileError('Unterminated comment', line, col(), 'Close the comment with */', { from: src.length, to: src.length, text: '*/' });
      for (let k = i; k < end + 2; k++) if (src[k] === '\n') { line++; ls = k + 1; }
      i = end + 2; continue;
    }
    const start = i, sl = line, sc = col();
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] || ''))) {
      const m = /^(0[xX][0-9a-fA-F]+|(?:\d+\.\d*|\.\d+|\d+)(?:[eE][+-]?\d+)?)([fFuUlL]*)/.exec(src.slice(i));
      i += m[0].length;
      const body = m[1], suf = m[2].toLowerCase(), isHex = /^0[xX]/.test(body);
      const isFloat = !isHex && /[.eE]/.test(body);
      const v = Number(body); let ty;
      if (isFloat) ty = suf.includes('f') ? 'float' : 'double';
      else {
        if (v > 9007199254740991) throw new CompileError(`Integer literal ${body} is too large`, sl, sc, 'Use a value below 2^53');
        const u = suf.includes('u'), l = suf.includes('l');
        ty = l ? (u ? 'ulong' : 'long') : u ? 'uint' : v > 2147483647 ? (v > 4294967295 || !isHex ? 'long' : 'uint') : 'int';
      }
      toks.push({ t: 'num', v: isFloat && ty === 'float' ? Math.fround(v) : v, ty, line: sl, col: sc, pos: start, end: i }); continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      while (i < src.length && /[A-Za-z0-9_]/.test(src[i])) i++;
      let w = src.slice(start, i); if (w === '__restrict' || w === '__restrict__') w = 'restrict';
      if (macros.has(w)) { macros.get(w).forEach(t => toks.push(Object.assign({}, t, { line: sl, col: sc, pos: start, end: i }))); continue; }
      toks.push({ t: KW.has(w) ? 'kw' : 'id', v: w, line: sl, col: sc, pos: start, end: i }); continue;
    }
    if (c === "'") {
      const m = /^'(\\x[0-9a-fA-F]+|\\.|[^\\'\n])'/.exec(src.slice(i));
      if (!m) throw new CompileError('Malformed character literal', sl, sc, "Write a single character such as 'a' or '\\n'");
      i += m[0].length; const b = m[1];
      const v = b[0] === '\\' ? (b[1] === 'x' ? parseInt(b.slice(2), 16) : (ESC[b[1]] !== undefined ? ESC[b[1]] : b.charCodeAt(1))) : b.charCodeAt(0);
      toks.push({ t: 'num', v, ty: 'int', line: sl, col: sc, pos: start, end: i }); continue;
    }
    if (c === '"') {
      let j = i + 1, s = '';
      while (j < src.length && src[j] !== '"' && src[j] !== '\n') {
        if (src[j] === '\\') { const e = src[j + 1]; s += String.fromCharCode(ESC[e] !== undefined ? ESC[e] : e.charCodeAt(0)); j += 2; } else s += src[j++];
      }
      if (src[j] !== '"') throw new CompileError('Unterminated string literal', sl, sc, 'Add the closing " before the end of the line', { from: j, to: j, text: '"' });
      i = j + 1; toks.push({ t: 'str', v: s, line: sl, col: sc, pos: start, end: i }); continue;
    }
    const two = src.substr(i, 2);
    if (OPS2.includes(two)) { i += 2; toks.push({ t: 'op', v: two, line: sl, col: sc, pos: start, end: i }); continue; }
    if (OPS1.includes(c)) { i++; toks.push({ t: 'op', v: c, line: sl, col: sc, pos: start, end: i }); continue; }
    throw new CompileError(`Unexpected character '${c}'`, sl, sc, `Remove '${c}' – it is not part of the supported C subset`, { from: i, to: i + 1, text: '' });
  }
  toks.push({ t: 'eof', v: '', line, col: col(), pos: src.length, end: src.length });
  return toks;
}

/* ---------------- Parser (recursive descent; first syntax error stops with a hint and a suggested fix) ---------------- */
const PREC = { '||': 1, '&&': 2, '|': 3, '^': 4, '&': 5, '==': 6, '!=': 6, '<': 7, '>': 7, '<=': 7, '>=': 7, '<<': 8, '>>': 8, '+': 9, '-': 9, '*': 10, '/': 10, '%': 10 };
const ASSIGN_OPS = ['=', '+=', '-=', '*=', '/=', '%='];

function parse(toks, srcLen) {
  let p = 0;
  const peek = (o = 0) => toks[Math.min(p + o, toks.length - 1)];
  const next = () => toks[p++];
  const isOp = (v, o = 0) => { const t = peek(o); return t.t === 'op' && t.v === v; };
  const isKw = (v, o = 0) => { const t = peek(o); return t.t === 'kw' && t.v === v; };
  const isTypeStart = (o = 0) => { const t = peek(o); return t.t === 'kw' && TYKW.has(t.v); };
  const desc = t => t.t === 'eof' ? 'end of file' : t.t === 'str' ? 'a string' : `'${t.v}'`;
  const node = (k, t, o) => Object.assign({ k, line: t.line, col: t.col }, o);

  function expectOp(v, ctx) {
    if (isOp(v)) return next();
    const prev = toks[p - 1], cur = peek();
    const msg = `Expected '${v}' ${ctx || ''} but found ${desc(cur)}`.replace(/\s+/g, ' ');
    if (prev && (v === ';' || v === ')' || v === ']' || v === '}'))
      throw new CompileError(msg, prev.line, prev.col + (prev.end - prev.pos), `Insert '${v}' right after ${desc(prev)}`,
        cur.t === 'eof' && v === '}' ? { from: srcLen, to: srcLen, text: '\n}' } : { from: prev.end, to: prev.end, text: v });
    throw new CompileError(msg, cur.line, cur.col, `Insert '${v}' before ${desc(cur)}`, { from: cur.pos, to: cur.pos, text: v });
  }
  const unsupType = t => new CompileError(`'${t.v}' is not supported`, t.line, t.col, "Structures, enums, unions and typedefs are not part of this C subset. Use int/char/long/float/double, arrays and pointers.");

  /* type specifier: [const] [unsigned|signed] [short|long|long long] int|char|float|double|void  ->  type name or 'void' */
  function parseTypeSpec() {
    let uns = false, longs = 0, base = null, isVoid = false, any = false, isBool = false;
    while (peek().t === 'kw' && TYKW.has(peek().v)) {
      any = true; const w = next().v;
      if (w === 'unsigned') uns = true; else if (w === 'long') longs++; else if (w === 'short') base = 'short';
      else if (w === 'int') base = base || 'int'; else if (w === 'char') base = 'char'; else if (w === 'float') base = 'float';
      else if (w === 'double') base = 'double'; else if (w === 'void') isVoid = true; else if (w === 'bool' || w === '_Bool') isBool = true;
    }
    if (!any) { const t = peek(); throw new CompileError(`Expected a type but found ${desc(t)}`, t.line, t.col, 'Use int, char, short, long, float, double or void.'); }
    if (isVoid) return 'void';
    if (isBool) return 'bool';
    if (base === 'float') return 'float';
    if (base === 'double') return 'double';
    if (base === 'char') return uns ? 'uchar' : 'char';
    if (base === 'short') return uns ? 'ushort' : 'short';
    if (longs) return uns ? 'ulong' : 'long';
    return uns ? 'uint' : 'int';
  }
  function parseProgram() {
    const fns = [], globals = [];
    while (peek().t !== 'eof') {
      const t = peek();
      if (t.t === 'kw' && UNSUP_TYPES.has(t.v)) throw unsupType(t);
      if (!isTypeStart()) throw new CompileError(`Expected a type (function or global declaration) but found ${desc(t)}`, t.line, t.col, 'Statements must be inside a function, e.g.  int main() { ... }');
      const ty = parseTypeSpec();
      let ptr = false, restrict = false;
      while (isOp('*') || isKw('const') || isKw('restrict')) { const q = next(); if (q.v === '*') ptr = true; else if (q.v === 'restrict') restrict = true; }
      const nameTok = next();
      if (nameTok.t !== 'id') throw new CompileError(`Expected a name but found ${desc(nameTok)}`, nameTok.line, nameTok.col, 'Example:  int sum(int n) { ... }');
      if (isOp('(')) fns.push(parseFunction(t, ty, ptr, nameTok));
      else {
        if (ty === 'void' && !ptr) throw new CompileError('A variable cannot have type void', nameTok.line, nameTok.col, 'Use int (or another numeric type).');
        globals.push(parseDeclList(ty, { ptr, restrict, id: nameTok }, t));
        expectOp(';', 'after the global declaration');
      }
    }
    if (!fns.length) throw new CompileError('The program has no function', 1, 1, 'Write at least one function, e.g.  int main() { return 0; }');
    return { k: 'program', fns, globals };
  }
  function parseFunction(st, ty, ptr, nameTok) {
    next();                                                            // (
    const params = [];
    if (isKw('void') && isOp(')', 1)) next();
    else if (!isOp(')')) { do { params.push(parseParam()); } while (isOp(',') && next()); }
    expectOp(')', 'after the parameter list');
    if (!isOp('{')) throw new CompileError(`Expected '{' to start the body of '${nameTok.v}' but found ${desc(peek())}`, peek().line, peek().col, 'Function prototypes without a body are not supported; define the function before it is used.');
    const body = parseBlock();
    return node('fn', st, { name: nameTok.v, ret: ty === 'void' && !ptr ? 'void' : ptr ? ty + '*' : ty, params, body });
  }
  function parseParam() {
    if (!isTypeStart()) throw new CompileError(`Parameter must start with a type but found ${desc(peek())}`, peek().line, peek().col, 'Example:  int *a, int n');
    const ty = parseTypeSpec(); let stars = 0, restrict = false;
    while (isOp('*') || isKw('restrict') || isKw('const')) { const q = next(); if (q.v === '*') stars++; else if (q.v === 'restrict') restrict = true; }
    const id = next();
    if (ty === 'void' && !stars) throw new CompileError("Parameter cannot have type 'void'", id.line, id.col, 'Use int.');
    if (id.t !== 'id') throw new CompileError(`Expected a parameter name but found ${desc(id)}`, id.line, id.col, 'Give the parameter a name.');
    let dims = null, ptr = stars > 0;
    if (stars > 1) throw new CompileError('Pointer-to-pointer parameters are not supported', id.line, id.col, "For main use  int main()  instead of main(int argc, char *argv[]).");
    if (isOp('[')) {
      dims = [];
      while (isOp('[')) {
        next();
        if (isOp(']')) { if (dims.length) throw new CompileError('Only the first array dimension may be empty', peek().line, peek().col, 'Example: int a[][3]'); dims.push(null); }
        else { const e = parseExpr(); const v = constEval(e); if (v === null || v <= 0) throw new CompileError('Array dimension must be a positive constant', e.line, e.col, 'Example: int a[][3]'); dims.push(v); }
        expectOp(']', 'in the array parameter');
      }
      if (ptr) throw new CompileError('Arrays of pointers (such as char *argv[]) are not supported', id.line, id.col, 'Use  int main()  without arguments, or pass a flat array.');
      ptr = true;
    }
    return { name: id.v, kind: ptr ? 'ptr' : 'int', ty, restrict, dims: dims && dims.length > 1 ? dims : undefined, line: id.line, col: id.col };
  }
  function parseBlock() {
    const t = expectOp('{'); const body = [];
    while (!isOp('}')) {
      if (peek().t === 'eof') expectOp('}', 'to close the block opened on line ' + t.line);
      body.push(parseStmt());
    }
    next();
    return node('block', t, { body });
  }
  function parseInitList() {                                           // { a, b, {c, d} }  -> nested arrays of expressions
    expectOp('{'); const items = [];
    if (!isOp('}')) { do { if (isOp('}')) break; items.push(isOp('{') ? parseInitList() : parseAssign()); } while (isOp(',') && next()); }
    expectOp('}', 'after the initialiser list');
    return items;
  }
  /* declarators after a type: [*]name[dims][= init] {, ...} ; `pre` = already-consumed first declarator prefix */
  function parseDeclList(ty, pre, startTok) {
    const vars = [];
    do {
      let ptr = false, restrict = false, id;
      if (pre) { ptr = pre.ptr; restrict = pre.restrict; id = pre.id; pre = null; }
      else {
        while (isOp('*') || isKw('restrict') || isKw('const')) { const q = next(); if (q.v === '*') ptr = true; else if (q.v === 'restrict') restrict = true; }
        id = next();
        if (id.t !== 'id') throw new CompileError(`Expected a variable name but found ${desc(id)}`, id.line, id.col, 'Declare like:  int x = 0;');
      }
      if (ty === 'void' && !ptr) throw new CompileError('A variable cannot have type void', id.line, id.col, 'Use int (or another numeric type).');
      const v = { name: id.v, ty, ptr, restrict, line: id.line, col: id.col, tok: id };
      if (isOp('[')) {
        v.dims = [];
        while (isOp('[')) { next(); if (isOp(']')) v.dims.push(null); else v.dims.push(parseExpr()); expectOp(']', 'after the array size'); }
      }
      if (isOp('=')) { next(); if (isOp('{')) v.list = parseInitList(); else v.init = parseAssign(); }
      vars.push(v);
    } while (isOp(',') && next());
    return node('decl', startTok || peek(), { vars });
  }
  function parseStmt() {
    const t = peek();
    if (isOp('{')) return parseBlock();
    if (isOp(';')) { next(); return node('empty', t, {}); }
    if (t.t === 'kw' && UNSUP_TYPES.has(t.v)) throw unsupType(t);
    if (t.t === 'kw' && t.v === 'goto') throw new CompileError("'goto' is not supported in this C subset", t.line, t.col, 'Use loops and if/else instead.');
    if (isTypeStart()) { const ty = parseTypeSpec(); const d = parseDeclList(ty, null, t); expectOp(';', 'after the declaration'); return d; }
    if (t.t === 'kw') {
      switch (t.v) {
        case 'if': {
          next(); expectOp('(', "after 'if'"); const c = parseExpr(); expectOp(')', 'after the if-condition');
          const th = parseStmt(); let el = null;
          if (isKw('else')) { next(); el = parseStmt(); }
          return node('if', t, { c, t: th, f: el });
        }
        case 'while': { next(); expectOp('(', "after 'while'"); const c = parseExpr(); expectOp(')', 'after the while-condition'); return node('while', t, { c, body: parseStmt() }); }
        case 'do': {
          next(); const body = parseStmt();
          if (!isKw('while')) throw new CompileError(`Expected 'while' after the do-body but found ${desc(peek())}`, peek().line, peek().col, 'A do-while loop ends with  while (condition);');
          next(); expectOp('(', "after 'while'"); const c = parseExpr(); expectOp(')', 'after the do-while condition'); expectOp(';', 'after do-while');
          return node('dowhile', t, { c, body });
        }
        case 'for': return parseFor();
        case 'return': { next(); let e = null; if (!isOp(';')) e = parseExpr(); expectOp(';', 'after return'); return node('ret', t, { e }); }
        case 'break': next(); expectOp(';', "after 'break'"); return node('break', t, {});
        case 'continue': next(); expectOp(';', "after 'continue'"); return node('continue', t, {});
        case 'switch': {
          next(); expectOp('(', "after 'switch'"); const e = parseExpr(); expectOp(')', 'after the switch expression'); expectOp('{', 'to open the switch body');
          const items = [];
          while (!isOp('}')) {
            if (peek().t === 'eof') expectOp('}', 'to close the switch');
            if (isKw('case')) { const ct = next(); const ce = parseBin(1); expectOp(':', 'after the case value'); items.push(node('case', ct, { e: ce })); }
            else if (isKw('default')) { const ct = next(); expectOp(':', "after 'default'"); items.push(node('default', ct, {})); }
            else items.push(parseStmt());
          }
          next(); return node('switch', t, { e, items });
        }
        case 'else': throw new CompileError("'else' without a matching 'if'", t.line, t.col, "Check the braces of the preceding 'if'.");
        case 'case': case 'default': throw new CompileError(`'${t.v}' outside of a switch`, t.line, t.col, 'Put it inside  switch (x) { ... }');
      }
    }
    const e = parseExpr(); expectOp(';', 'at the end of the statement');
    return node('expr', t, { e });
  }
  function parseFor() {
    const t = next(); expectOp('(', "after 'for'");
    let init = null, cond = null, step = null;
    if (isTypeStart()) { const st = peek(); const ty = parseTypeSpec(); init = parseDeclList(ty, null, st); expectOp(';', 'after the for-loop initialiser'); }
    else if (!isOp(';')) { init = parseExpr(); expectOp(';', 'after the for-loop initialiser'); } else next();
    if (!isOp(';')) cond = parseExpr();
    expectOp(';', 'after the for-loop condition');
    if (!isOp(')')) step = parseExpr();
    expectOp(')', 'after the for-loop header');
    return node('for', t, { init, cond, step, body: parseStmt() });
  }
  function parseExpr() { return parseAssign(); }
  function parseCond() {                                    // c ? a : b   (right associative, binds looser than ||)
    const c = parseBin(1);
    if (isOp('?')) { const t = next(); const a = parseExpr(); expectOp(':', "in the conditional expression (after the '?' part)"); const b = parseCond(); return node('cond', t, { c, a, b }); }
    return c;
  }
  function parseAssign() {
    const l = parseCond(); const t = peek();
    if (t.t === 'op' && ASSIGN_OPS.includes(t.v)) {
      if (!(l.k === 'var' || l.k === 'idx' || (l.k === 'un' && l.o === '*')))
        throw new CompileError('Left side of an assignment must be a variable, array element or *pointer', t.line, t.col, 'Examples:  x = 5;   a[i] = 5;   *p = 5;');
      next(); const r = parseAssign();
      return node('assign', t, { o: t.v, l, r });
    }
    return l;
  }
  function parseBin(minP) {
    let l = parseUnary();
    for (;;) {
      const t = peek(); if (t.t !== 'op') break;
      const pr = PREC[t.v]; if (!pr || pr < minP) break;
      next(); const r = parseBin(pr + 1);
      l = node('bin', t, { o: t.v, l, r });
    }
    return l;
  }
  function parseUnary() {
    const t = peek();
    if (t.t === 'op' && t.v === '(' && isTypeStart(1)) {              // cast
      next(); const ty = parseTypeSpec(); let ptr = false; while (isOp('*') || isKw('const')) { if (next().v === '*') ptr = true; }
      expectOp(')', 'after the cast type'); const e = parseUnary();
      return node('cast', t, { ty, ptr, e });
    }
    if (t.t === 'op' && ['-', '!', '*', '&', '~', '+'].includes(t.v)) {
      next(); const e = parseUnary();
      if (t.v === '+') return e;
      if (t.v === '-' && e.k === 'num') return node('num', t, { v: isFloatTy(e.ty) ? -e.v : wrapTy(e.ty, -e.v), ty: e.ty });
      return node('un', t, { o: t.v, e });
    }
    if (t.t === 'op' && (t.v === '++' || t.v === '--')) { next(); return node('incdec', t, { o: t.v, e: parseUnary(), post: false }); }
    if (isKw('sizeof')) {
      next(); expectOp('(', "after 'sizeof'");
      if (isTypeStart()) { const ty = parseTypeSpec(); let ptr = false; while (isOp('*')) { next(); ptr = true; } expectOp(')', 'after sizeof(type'); return node('num', t, { v: ptr ? 8 : (TYSIZE[ty] || 1), ty: 'int' }); }
      const e = parseExpr(); expectOp(')', 'after the sizeof operand'); return node('sizeofe', t, { e });
    }
    return parsePostfix();
  }
  function parsePostfix() {
    let e = parsePrimary();
    for (;;) {
      const t = peek();
      if (isOp('[')) { next(); const ix = parseExpr(); expectOp(']', 'after the array index'); e = node('idx', t, { base: e, index: ix }); }
      else if (isOp('(')) {
        if (e.k !== 'var') throw new CompileError('Only named functions can be called', t.line, t.col, '');
        next(); const args = [];
        if (!isOp(')')) { do { args.push(parseAssign()); } while (isOp(',') && next()); }
        expectOp(')', 'after the call arguments');
        e = node('call', t, { name: e.name, args, tok: e.tok, line: e.line, col: e.col });
      }
      else if (isOp('++') || isOp('--')) { next(); e = node('incdec', t, { o: t.v, e, post: true }); }
      else break;
    }
    return e;
  }
  function parsePrimary() {
    const t = next();
    if (t.t === 'num') return node('num', t, { v: t.v, ty: t.ty || 'int' });
    if (t.t === 'str') { let s = t.v; while (peek().t === 'str') s += next().v; return node('str', t, { v: s }); }
    if (t.t === 'id') return node('var', t, { name: t.v, tok: t });
    if (t.t === 'op' && t.v === '(') { const e = parseExpr(); expectOp(')', "to close '('"); return e; }
    if (t.t === 'kw' && UNSUP_TYPES.has(t.v)) throw unsupType(t);
    throw new CompileError(`Expected an expression but found ${desc(t)}`, t.line, t.col, 'A value, variable or parenthesised expression is needed here.');
  }
  return parseProgram();
}

/* ---------------- AST helpers ---------------- */
function walk(n, cb) {
  if (Array.isArray(n)) { n.forEach(x => walk(x, cb)); return; }
  if (n && typeof n === 'object') {
    if (n.k) cb(n);
    for (const key in n) { if (key === 'tok') continue; const v = n[key]; if (v && typeof v === 'object') walk(v, cb); }
  }
}
function assignedIn(n) {
  const s = new Set();
  walk(n, x => {
    if (x.k === 'assign' && x.l.k === 'var') s.add(x.l.name);
    if (x.k === 'incdec' && x.e.k === 'var') s.add(x.e.name);
    if (x.k === 'un' && x.o === '&' && x.e.k === 'var') s.add(x.e.name);
    if (x.k === 'call' && (x.name === 'scanf')) x.args.forEach(a => { if (a.k === 'var') s.add(a.name); });
  });
  return s;
}
/* compile-time constant evaluation of an AST expression -> {v,ty} or null */
function cev(e) {
  if (!e) return null;
  if (e.k === 'num') return { v: e.v, ty: e.ty || 'int' };
  if (e.k === 'un' && e.o === '-') { const x = cev(e.e); return x && { v: isFloatTy(x.ty) ? -x.v : wrapTy(promote(x.ty), -x.v), ty: promote(x.ty) }; }
  if (e.k === 'un' && e.o === '~') { const x = cev(e.e); return x && !isFloatTy(x.ty) ? { v: wrapTy(promote(x.ty), ~x.v), ty: promote(x.ty) } : null; }
  if (e.k === 'cast' && !e.ptr) { const x = cev(e.e); return x && { v: castTo(e.ty, x.v), ty: e.ty }; }
  if (e.k === 'cond') { const c = cev(e.c); if (!c) return null; return c.v !== 0 ? cev(e.a) : cev(e.b); }
  if (e.k === 'bin') {
    const a = cev(e.l), b = cev(e.r); if (!a || !b) return null;
    const ty = commonType(a.ty, b.ty), r = evalBin(e.o, a.v, b.v, ty);
    return r === undefined ? null : { v: r, ty: CMP_OPS.has(e.o) ? 'int' : ty };
  }
  return null;
}
function constEval(e) { const r = cev(e); return r ? r.v : null; }
function stepOf(st, v) {
  if (!st) return null;
  if (st.k === 'incdec' && st.e.k === 'var' && st.e.name === v) return st.o === '++' ? 1 : -1;
  if (st.k === 'assign' && st.l.k === 'var' && st.l.name === v) {
    if ((st.o === '+=' || st.o === '-=') && st.r.k === 'num' && !isFloatTy(st.r.ty)) return st.o === '+=' ? st.r.v : -st.r.v;
    if (st.o === '=' && st.r.k === 'bin' && (st.r.o === '+' || st.r.o === '-') && st.r.l.k === 'var' && st.r.l.name === v && st.r.r.k === 'num' && !isFloatTy(st.r.r.ty)) return st.r.o === '+' ? st.r.r.v : -st.r.r.v;
  }
  return null;
}
