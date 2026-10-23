'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {validate,AXES} = require('./validate-audit.cjs');
const e = (revision,observation) => ({revision,kind:'test',ref:'local:'+revision,observation});
function sample() {
  const feature='cli-export';
  return {
    schema_version:1,
    run:{target:'org/repo',base_ref:'a1',head_ref:'b2',profile:'standard',scope:['cli'],status:'complete',execution:'sandboxed_tested',limitations:[]},
    features:[{id:feature,name:'CLI export',purpose:'Produce JSON',intent_status:'documented',intent_evidence:[{ref:'README.md',detail:'Documents output'}],entrypoints:['bin/export'],contracts:['Outputs JSON'],status:'in_scope',exclusion_reason:null}],
    coverage:AXES.map(axis=>({id:feature+'::'+axis+'::default',feature_id:feature,axis,case_id:'default',status:'covered',base_result:'pass',head_result:'pass',evidence:[e('base','passed'),e('head','passed')],reason:null})),
    findings:[]
  };
}
const invalid = (doc,term) => assert.ok(validate(doc).some(s=>s.includes(term)),JSON.stringify(validate(doc)));
test('full valid suite passes',()=>assert.deepEqual(validate(sample()),[]));
test('missing coverage axis is rejected',()=>{const a=sample();a.coverage.pop();invalid(a,'missing required lifecycle');});
test('duplicate IDs are rejected',()=>{const a=sample();a.coverage.push({...a.coverage[0]});invalid(a,'duplicate id');});
test('no baseline means no comparison evidence',()=>{const a=sample();a.run.base_ref=null;invalid(a,'base evidence without base_ref');});
test('static-only cannot report dynamic passes',()=>{const a=sample();a.run.execution='static_only';invalid(a,'static_only');});
test('non-executed coverage is not passing',()=>{const a=sample();a.coverage[0].status='blocked';a.coverage[0].reason='no sandbox';invalid(a,'cannot claim HEAD result');});
test('unknown intent cannot be asserted as documented purpose',()=>{const a=sample();a.features[0].intent_status='unknown';invalid(a,'purpose inconsistent');});
test('confirmed regression requires an independent verifier and linked failing comparison',()=>{
  const a=sample();a.run.status='incomplete';a.run.limitations=['confirmed failure'];
  a.findings=[{id:'reg1',feature_id:'cli-export',coverage_ids:['cli-export::primary::default'],verdict:'confirmed_regression',title:'Export fails',expected:'Export works',observed:'Export fails',intent_classification:'unintended',impact:'Cannot export',severity:'high',evidence:[e('base','pass'),e('head','fail')],blockers:[],discovery_agent:'a',verifier_agent:'a'}];
  invalid(a,'independent verifier');invalid(a,'BASE pass');
  a.coverage[0].status='failed';a.coverage[0].head_result='fail';a.findings[0].verifier_agent='b';
  assert.deepEqual(validate(a),[]);
});
test('unresolved findings prevent complete status',()=>{
 const a=sample();a.findings=[{id:'lead1',feature_id:'cli-export',coverage_ids:['cli-export::primary::default'],verdict:'needs_validation',title:'Possible issue',expected:'Stable output',observed:null,intent_classification:'unknown',impact:null,severity:null,evidence:[],blockers:['Need supported OS'],discovery_agent:'a',verifier_agent:null}];
 invalid(a,'unresolved findings');
});
test('completed runs cannot include failed cases',()=>{const a=sample();a.coverage[0].status='failed';a.coverage[0].head_result='fail';invalid(a,'incomplete or failing coverage');});
