/* ================= PART 1d : IR printing ================= */
function fmtInstr(x, r) {
  r = r || (n => n);
  const f = o => typeof o === 'number' ? String(o) : (o === undefined ? '' : r(o));
  const vop = (o, isV) => typeof o === 'number' ? `splat(${o})` : isV ? f(o) : `splat(${f(o)})`;
  const tag = x.ty && x.ty !== 'int' ? `   // ${x.ty}` : '';
  switch (x.op) {
    case 'label': return x.name + ':';
    case 'copy': return `${f(x.dst)} = ${f(x.a)}`;
    case 'cast': return `${f(x.dst)} = (${x.ty}) ${f(x.a)}`;
    case 'bin': return `${f(x.dst)} = ${f(x.a)} ${x.o} ${f(x.b)}${tag}`;
    case 'un': return `${f(x.dst)} = ${x.o}${f(x.a)}${tag}`;
    case 'load': return `${f(x.dst)} = load ${f(x.base)}[${f(x.idx)}]`;
    case 'store': return `store ${f(x.base)}[${f(x.idx)}] = ${f(x.a)}${x.ty && x.ty !== 'int' ? `   // ${x.ty}` : ''}`;
    case 'addr': return `${f(x.dst)} = &${f(x.a)}`;
    case 'alloca': return `${f(x.dst)} = alloca ${x.n} x ${x.ty || 'int'}   // stack`;
    case 'alloc': return `${f(x.dst)} = malloc ${f(x.a)} bytes   // heap`;
    case 'strlit': return `${f(x.dst)} = string ${JSON.stringify(x.text)}`;
    case 'jmp': return `goto ${x.l}`;
    case 'jz': return `ifFalse ${f(x.a)} goto ${x.l}`;
    case 'jnz': return `if ${f(x.a)} goto ${x.l}`;
    case 'ret': return x.a === undefined ? 'return' : `return ${f(x.a)}`;
    case 'call': return `${x.dst ? f(x.dst) + ' = ' : ''}call ${x.fn}(${[...(x.fmt !== undefined ? [JSON.stringify(x.fmt)] : []), ...x.args.map(f)].join(', ')})`;
    case 'vload': return `${f(x.dst)} = vload ${f(x.base)}[${f(x.idx)} .. +${x.vl}]`;
    case 'vstore': return `vstore ${f(x.base)}[${f(x.idx)} .. +${x.vl}] = ${vop(x.a, x.av)}`;
    case 'vbin': return `${f(x.dst)} = vec(${vop(x.a, x.av)} ${x.o} ${vop(x.b, x.bv)})${tag}`;
    case 'vun': return `${f(x.dst)} = vec(${x.o}${vop(x.a, x.av)})${tag}`;
    case 'loop_body_begin': return `// loop #${x.loop} body {`;
    case 'loop_body_end': return `// } loop #${x.loop} body`;
  }
  return '?' + x.op;
}
function irLines(instrs, r) {
  return instrs.map(x => ({
    t: x.op === 'label' ? fmtInstr(x) : '    ' + fmtInstr(x, r),
    k: x.op === 'label' ? 'label' : x.op.startsWith('loop_') ? 'marker' : (x.op === 'vload' || x.op === 'vstore' || x.op === 'vbin' || x.op === 'vun') ? 'vec' : 'ins',
    line: x.line
  }));
}
