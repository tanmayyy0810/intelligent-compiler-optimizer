/* ================= PART 1a : utilities, numeric types, C arithmetic ================= */
const isStr = o => typeof o === 'string';
const isTemp = n => isStr(n) && n[0] === '%';
const isGlob = n => isStr(n) && n[0] === '@';
const clone = o => JSON.parse(JSON.stringify(o));

class CompileError extends Error {
  constructor(msg, line, col, hint, fix) { super(msg); this.line = line; this.col = col; this.hint = hint; this.fix = fix; }
}
function editDistance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

/* ---- numeric types: char short int long (+unsigned), float, double ---- */
const INT_TYPES = new Set(['bool', 'char', 'uchar', 'short', 'ushort', 'int', 'uint', 'long', 'ulong']);
const isFloatTy = t => t === 'float' || t === 'double';
const TYSIZE = { bool: 1, char: 1, uchar: 1, short: 2, ushort: 2, int: 4, uint: 4, long: 8, ulong: 8, float: 4, double: 8 };
function wrapTy(ty, v) {
  switch (ty) {
    case 'bool': return v !== 0 ? 1 : 0;
    case 'int': return v | 0;
    case 'uint': return v >>> 0;
    case 'char': return (v << 24) >> 24;
    case 'uchar': return v & 255;
    case 'short': return (v << 16) >> 16;
    case 'ushort': return v & 65535;
    case 'long': return Math.trunc(v);
    case 'ulong': { v = Math.trunc(v); return v < 0 ? v + 18446744073709551616 : v; }
    case 'float': return Math.fround(v);
    default: return v;                                    // double
  }
}
/* conversion of a value to type ty (float -> int truncates toward zero) */
function castTo(ty, v) {
  if (typeof v !== 'number') return v;
  if (ty === 'bool') return v !== 0 && !Number.isNaN(v) ? 1 : 0;
  if (isFloatTy(ty)) return wrapTy(ty, v);
  v = Number.isFinite(v) ? Math.trunc(v) : 0;
  return wrapTy(ty, v);
}
const promote = t => (t === 'bool' || t === 'char' || t === 'uchar' || t === 'short' || t === 'ushort') ? 'int' : t;
function commonType(a, b) {
  a = promote(a); b = promote(b);
  if (a === 'double' || b === 'double') return 'double';
  if (a === 'float' || b === 'float') return 'float';
  if (a === 'ulong' || b === 'ulong') return 'ulong';
  if (a === 'long' || b === 'long') return 'long';
  if (a === 'uint' || b === 'uint') return 'uint';
  return 'int';
}
/* true when converting a value of type `from` to `to` can never change its numeric value */
function lossless(from, to) {
  if (from === to) return true;
  const L = {
    long: ['bool', 'char', 'uchar', 'short', 'ushort', 'int', 'uint'], int: ['bool', 'char', 'uchar', 'short', 'ushort'], uint: ['bool', 'uchar', 'ushort'],
    ulong: ['bool', 'uchar', 'ushort', 'uint'], short: ['bool', 'char', 'uchar'], ushort: ['bool', 'uchar'], char: ['bool'], uchar: ['bool'],
    double: ['float', 'bool', 'char', 'uchar', 'short', 'ushort', 'int', 'uint'], float: ['bool', 'char', 'uchar', 'short', 'ushort']
  };
  return !!(L[to] && L[to].includes(from));
}
const CMP_OPS = new Set(['<', '<=', '>', '>=', '==', '!=', '&&', '||']);
/* C arithmetic on typed values. ONE routine is shared by the constant folder and the interpreter. */
function evalBin(o, a, b, ty) {
  ty = ty || 'int';
  const fl = isFloatTy(ty);
  switch (o) {
    case '+': return wrapTy(ty, a + b);
    case '-': return wrapTy(ty, a - b);
    case '*': return wrapTy(ty, (ty === 'int' || ty === 'uint') ? Math.imul(a, b) : a * b);
    case '/': if (fl) return wrapTy(ty, a / b); return b === 0 ? undefined : wrapTy(ty, Math.trunc(a / b));
    case '%': if (fl || b === 0) return undefined; return wrapTy(ty, (a % b) + 0);
    case '<': return +(a < b); case '<=': return +(a <= b);
    case '>': return +(a > b); case '>=': return +(a >= b);
    case '==': return +(a === b); case '!=': return +(a !== b);
    case '&&': return +(a !== 0 && b !== 0); case '||': return +(a !== 0 || b !== 0);
    case '&': return fl ? undefined : wrapTy(ty, a & b);
    case '|': return fl ? undefined : wrapTy(ty, a | b);
    case '^': return fl ? undefined : wrapTy(ty, a ^ b);
    case '<<': return fl ? undefined : wrapTy(ty, a << (b & 31));
    case '>>': return fl ? undefined : (ty === 'uint' ? a >>> (b & 31) : a >> (b & 31));
  }
  return undefined;
}
function evalUn(o, a, ty) {
  ty = ty || 'int';
  return o === '-' ? wrapTy(ty, -a) : o === '!' ? +(a === 0) : o === '~' ? wrapTy(ty, ~a) : undefined;
}

/* ---- printf-style formatting used by the interpreter ---- */
function cFormat(fmt, args, readStr) {
  let ai = 0, out = '', last = 0, m;
  const re = /%([-+ 0#]*)(\d+|\*)?(?:\.(\d+|\*))?(hh|h|ll|l|z|j|t|L)?([diuoxXcsfFeEgGp%])/g;
  const pad = (s, w, left, zero) => { if (s.length >= w) return s; return left ? s + ' '.repeat(w - s.length) : (zero ? (/^[+-]/.test(s) ? s[0] + '0'.repeat(w - s.length) + s.slice(1) : '0'.repeat(w - s.length) + s) : ' '.repeat(w - s.length) + s); };
  while ((m = re.exec(fmt))) {
    out += fmt.slice(last, m.index); last = re.lastIndex;
    const fl = m[1], cv = m[5];
    if (cv === '%') { out += '%'; continue; }
    const w = m[2] === '*' ? Number(args[ai++]) : m[2] ? Number(m[2]) : 0;
    const pr = m[3] === undefined ? -1 : m[3] === '*' ? Number(args[ai++]) : Number(m[3]);
    const a = args[ai++]; const num = typeof a === 'number' ? a : 0;
    let s = '', zero = fl.includes('0') && !fl.includes('-');
    const sign = n => (n < 0 ? '-' : fl.includes('+') ? '+' : fl.includes(' ') ? ' ' : '');
    switch (cv) {
      case 'd': case 'i': { const n = Math.trunc(num); s = sign(n) + String(Math.abs(n)); if (pr >= 0) { s = sign(n) + String(Math.abs(n)).padStart(pr, '0'); zero = false; } break; }
      case 'u': s = String(num < 0 ? num + (m[4] === 'l' || m[4] === 'll' ? 18446744073709551616 : 4294967296) : Math.trunc(num)); break;
      case 'x': case 'X': case 'o': { let n = Math.trunc(num); if (n < 0) n += 4294967296; s = n.toString(cv === 'o' ? 8 : 16); if (cv === 'X') s = s.toUpperCase(); if (fl.includes('#') && n) s = (cv === 'o' ? '0' : cv === 'x' ? '0x' : '0X') + s; break; }
      case 'c': s = String.fromCharCode(num & 255); zero = false; break;
      case 's': s = typeof a === 'object' && a !== null ? readStr(a) : '(null)'; if (pr >= 0) s = s.slice(0, pr); zero = false; break;
      case 'f': case 'F': s = !Number.isFinite(num) ? (Number.isNaN(num) ? 'nan' : (num < 0 ? '-inf' : 'inf')) : sign(num) + Math.abs(num).toFixed(pr < 0 ? 6 : pr); if (!Number.isFinite(num)) zero = false; break;
      case 'e': case 'E': { s = sign(num) + Math.abs(num).toExponential(pr < 0 ? 6 : pr).replace(/e([+-])(\d)$/, 'e$10$2'); if (cv === 'E') s = s.toUpperCase(); break; }
      case 'g': case 'G': { const p = pr < 0 ? 6 : pr === 0 ? 1 : pr; let t = Math.abs(num).toPrecision(p); if (t.includes('e')) t = t.replace(/\.?0+e/, 'e').replace(/e([+-])(\d)$/, 'e$10$2'); else if (t.includes('.')) t = t.replace(/\.?0+$/, ''); s = sign(num) + t; break; }
      case 'p': s = '0x' + (a && a.off !== undefined ? (4096 + a.off * 4).toString(16) : '0'); zero = false; break;
    }
    out += pad(s, w, fl.includes('-'), zero);
  }
  return out + fmt.slice(last);
}
function countSpecs(fmt) { let n = 0; const re = /%([-+ 0#]*)(\d+|\*)?(?:\.(\d+|\*))?(hh|h|ll|l|z|j|t|L)?([diuoxXcsfFeEgGp%])/g; let m; while ((m = re.exec(fmt))) { if (m[5] !== '%') n += 1 + (m[2] === '*' ? 1 : 0) + (m[3] === '*' ? 1 : 0); } return n; }
