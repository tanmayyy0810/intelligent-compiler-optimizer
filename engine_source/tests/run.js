const C=require('../engine.js'),fs=require('fs');
let bad=0;
for(const f of process.argv.slice(2)){
  const r=C.compile(fs.readFileSync(f,'utf8'));
  console.log('####',f, r.ok?'OK':'ERRORS');
  r.diagnostics.forEach(d=>console.log('  ',d.level,d.line+':'+d.col,d.message,'|',d.hint||''));
  if(!r.ok){bad++;continue;}
  r.functions.forEach(F=>{const v=F.verification;const c=v.cases.find(c=>c.status==='PASS');
    console.log('  fn',F.name,'verify',v.status,v.passed+'/'+v.failed+'/'+v.skipped,'applied',F.stats.applied,'rej',F.stats.rejected,'rev',F.stats.reverted,c?('ret='+c.expected+' out='+JSON.stringify(c.output)):'' );
    if(v.status==='FAIL'||F.stats.reverted){bad++;console.log(v.cases.filter(c=>c.status==='FAIL').slice(0,2));}
    if(v.status==='INCONCLUSIVE'){console.log('   skipped reason',v.cases[0].detail)}});
}
console.log('PROBLEMS',bad);
