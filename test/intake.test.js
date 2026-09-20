import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { scoreSubmission } from '../src/decision/scoring.js';
import { buildEscalations } from '../src/decision/escalation.js';
import { assertEvidenceCase, validateCandidate, extractEvidence, confirmEvidence, reviewedRow, reviewedReport } from '../src/decision/intake.js';
const rules = JSON.parse(await readFile(new URL('../config/appetite.json', import.meta.url), 'utf8'));
function sample() {
  const scored = scoreSubmission({ id: 1, submissionNumber: 'SUB-1', accountName: 'Example', queueStatus: 'quoted', lineOfBusiness: 'property',
    businessTypes: [], premium: null, primaryState: 'OH', tiv: 75000000, knownTiv: 75000000, effectiveDate: '2025-01-01', exposuresComplete: true,
    buildings: [{ id: 9, yearBuilt: 2015, constructionType: 'Joisted Masonry', tiv: 75000000 }],
    loss: { observed: 0, historyComplete: true, coverageRatio: 1, gaps: [], claimIds: [], claims: [] }, issues: [] }, rules);
  return { ...scored, ...buildEscalations(scored, rules) };
}
const text = 'SUB-1: New business. Total quoted premium is USD 85000.';
function draft(row, revision = 0) {
  return { id:'draft', reportVersion:'v1', revision, source:'Broker response', sourceDate:'2024-12-01', text, model:'test', facts: [
    validateCandidate({ field:'businessType', value:'new', quote:'New business.' },row,text),
    validateCandidate({ field:'premium', value:'85000', quote:'Total quoted premium is USD 85000.' },row,text),
  ] };
}
test('confirmed cited facts recalculate rules and ranking without changing the source snapshot', () => {
  const row = sample(), original = structuredClone(row), record = { requests: {}, decision: { decision:'decline', decidedBy:'Reviewer' } }, d = draft(row);
  const event = confirmEvidence(record,row,rules,d,d.facts.map(f=>f.id),'Reviewer','Matched broker response to SUB-1.','v1');
  assert.ok(event.after.score > event.before.score);
  assert.equal(event.after.coverage,100);
  assert.equal(event.after.decision,'IN_APPETITE');
  assert.equal(record.decision,null);
  assert.equal(record.decisionHistory.length,1);
  assert.equal(record.requests['1:premium'],'answered');
  const reviewed = reviewedRow(row,rules,record,'v1');
  assert.equal(reviewed.factors.find(f=>f.key==='premium').confidence,'confirmed');
  assert.equal(reviewed.premium,85000);
  assert.deepEqual(row,original);
  assert.equal(reviewedReport({generatedAt:'v1',rules,rows:[row]},{records:{'1':record}}).rows[0].score,event.after.score);
  assert.equal(reviewedRow(row,rules,record,'new-version').premium,null,'old confirmations cannot silently migrate to new source snapshots');
});
test('unconfirmed drafts never affect the score; stale and duplicate confirmations fail', () => {
  const row=sample(), d=draft(row), record={requests:{}, evidenceDraft:d};
  assert.equal(reviewedRow(row,rules,record,'v1').score,row.score);
  assert.throws(()=>confirmEvidence(record,row,rules,d,[], 'Reviewer','Matched this case','v1'),/Select/);
  assert.throws(()=>confirmEvidence(record,row,rules,d,d.facts.map(f=>f.id), '', 'Matched this case','v1'),/name/);
  confirmEvidence(record,row,rules,d,d.facts.map(f=>f.id),'Reviewer','Matched this case','v1');
  assert.throws(()=>confirmEvidence(record,row,rules,d,d.facts.map(f=>f.id),'Reviewer','Matched this case','v1'),/changed/);
});
test('evidence rejects uncited values, nonexistent buildings and invalid types', () => {
  const row=sample();
  assert.throws(()=>validateCandidate({field:'premium',value:'5',quote:'invented'},row,text),/exact quote/);
  assert.throws(()=>validateCandidate({field:'yearBuilt',value:'2010',buildingId:'other',quote:'New business.'},row,text),/existing insured building/);
  assert.throws(()=>validateCandidate({field:'premium',value:'Infinity',quote:'New business.'},row,text),/numeric/);
  assert.throws(()=>validateCandidate({field:'loss',value:'0',quote:'New business.'},row,text),/Unsupported/);
  const report={generatedAt:'v1',rows:[row]};
  assert.throws(()=>assertEvidenceCase(report,1,'old'),/Refresh/);
  assert.throws(()=>assertEvidenceCase({...report,rows:[{...row,lineOfBusiness:'cyber'}]},1,'v1'),/active property/);
  assert.throws(()=>assertEvidenceCase({...report,rows:[{...row,queueStatus:'bound'}]},1,'v1'),/active property/);
});
test('AI extraction is schema constrained and drops invented quotes', async () => {
  const row=sample(); let sent;
  const result=await extractEvidence(row,text,{apiKey:'test',fetchImpl:async (url,init)=>{
    sent=JSON.parse(init.body);
    return new Response(JSON.stringify({status:'completed',model:'test',output:[{content:[{type:'output_text',text:JSON.stringify({facts:[
      {field:'premium',value:'85000',buildingId:'',quote:'Total quoted premium is USD 85000.'},
      {field:'businessType',value:'new',buildingId:'',quote:'Made up quote'},
    ]})}]}]}));
  }});
  assert.equal(sent.store,false);
  assert.equal(sent.text.format.strict,true);
  assert.match(sent.instructions,/untrusted data/);
  assert.equal(result.facts.length,1);
  assert.equal(result.facts[0].field,'premium');
});
test('a roof update cannot cure a construction-age failure, and aggregate TIV cannot hide known building value', () => {
  const row=sample();row.buildings[0].yearBuilt=1985;
  const roofText='Roof replaced in 2023. Complete TIV USD 1000.';
  const d={...draft(row),text:roofText,facts:[validateCandidate({field:'roofYear',value:'2023',buildingId:'9',quote:'Roof replaced in 2023.'},row,roofText),validateCandidate({field:'tiv',value:'1000',quote:'Complete TIV USD 1000.'},row,roofText)]};
  const record={requests:{}};
  confirmEvidence(record,row,rules,d,d.facts.map(f=>f.id),'Reviewer','Matched building and source','v1');
  const after=reviewedRow(row,rules,record,'v1');
  assert.equal(after.factors.find(f=>f.key==='year').status,'fail');
  assert.equal(after.tiv,null);
  assert.equal(after.knownTiv,75000000);
  assert.ok(after.issues.some(i=>i.includes('Reconcile')));
});
