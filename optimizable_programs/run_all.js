const C=require('./engine.js'),fs=require('fs'),path=require('path');
const dir=path.join(__dirname,'programs');
console.log('program'.padEnd(36)+'verify'.padEnd(10)+'optimizations applied');
fs.readdirSync(dir).filter(f=>f.endsWith('.c')).sort().forEach(f=>{
  const r=C.compile(fs.readFileSync(path.join(dir,f),'utf8'));
  if(!r.ok){console.log(f.padEnd(36)+'COMPILE ERROR: '+r.diagnostics[0].message);return;}
  const set=new Set();let p=0,x=0;
  r.functions.forEach(F=>{p+=F.verification.passed;x+=F.verification.failed;F.optimizations.forEach(e=>{if(e.status==='APPLIED')set.add(e.pass.split(' (')[0])});});
  console.log(f.padEnd(36)+(x?'FAIL':'PASS').padEnd(10)+[...set].join(', '));
});
