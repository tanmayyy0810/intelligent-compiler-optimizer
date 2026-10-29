const COE=require('./engine.js'),fs=require('fs');
const src=fs.readFileSync(process.argv[2],'utf8');
const o={}; process.argv.slice(3).forEach(a=>{const m=/^--(\w+)=(.*)$/.exec(a); if(m) o[m[1]]=m[2]==='true'?true:m[2]==='false'?false:Number(m[2]);});
const r=COE.compile(src,o);
if(process.argv.includes('--json')) console.log(JSON.stringify(r,null,1));
else if(!r.ok){ r.diagnostics.forEach(d=>console.log(`${d.level} line ${d.line}:${d.col}: ${d.message}\n   ${d.source||''}\n   hint: ${d.hint||''}`)); }
else { r.diagnostics.forEach(d=>console.log(`${d.level} line ${d.line}: ${d.message}`)); r.functions.forEach(F=>{console.log('=== IR BEFORE',F.name);console.log(F.irBefore.map(l=>l.t).join('\n'));console.log('=== IR AFTER');console.log(F.irAfter.map(l=>l.t).join('\n'));}); console.log(r.reportText); }
