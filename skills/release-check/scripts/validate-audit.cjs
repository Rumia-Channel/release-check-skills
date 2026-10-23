#!/usr/bin/env node
'use strict';
// Zero-dependency, deterministic integrity validator for release-check audit.json.
// This checks internal consistency, NOT whether tests or evidence are truthful.
const fs = require('node:fs');
const AXES = ['primary', 'boundary', 'error', 'integration', 'compatibility', 'lifecycle'];
const RESULTS = ['pass', 'fail', 'not_run', 'unknown'];
const STATUSES = ['covered', 'failed', 'blocked', 'deferred', 'not_applicable', 'out_of_scope'];
const VERDICTS = ['confirmed_regression', 'confirmed_change', 'needs_validation', 'rejected'];
const ID = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,127}$/;
const CASE_ID = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const isObj = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const nonempty = x => typeof x === 'string' && x.trim().length > 0;
const has = (x, k) => Object.prototype.hasOwnProperty.call(x, k);

function validate(doc) {
  const errors = [];
  const fail = (where, msg) => { if (errors.length < 150) errors.push(where + ': ' + msg); };
  const requireKeys = (o, keys, where) => {
    if (!isObj(o)) { fail(where, 'expected object'); return false; }
    for (const key of keys) if (!has(o, key)) fail(where + '.' + key, 'missing key');
    return true;
  };
  const keySet = (o, allowed, where) => {
    for (const key of Object.keys(o)) if (!allowed.includes(key)) fail(where + '.' + key, 'unexpected key');
  };
  const evidence = (value, where, baseAvailable) => {
    if (!Array.isArray(value)) { fail(where, 'expected array'); return; }
    value.forEach((e, j) => {
      const loc = where + '[' + j + ']';
      if (!requireKeys(e, ['revision', 'kind', 'ref', 'observation'], loc)) return;
      keySet(e, ['revision', 'kind', 'ref', 'observation'], loc);
      if (!['base', 'head', 'context'].includes(e.revision)) fail(loc, 'invalid revision');
      if (!['source', 'test', 'runtime'].includes(e.kind)) fail(loc, 'invalid evidence kind');
      if (!nonempty(e.ref) || !nonempty(e.observation)) fail(loc, 'ref and observation required');
      if (!baseAvailable && e.revision === 'base') fail(loc, 'base evidence without base_ref');
    });
  };
  if (!isObj(doc)) return ['audit: expected object'];
  requireKeys(doc, ['schema_version', 'run', 'features', 'coverage', 'findings'], 'audit');
  keySet(doc, ['schema_version', 'run', 'features', 'coverage', 'findings'], 'audit');
  if (doc.schema_version !== 1) fail('schema_version', 'expected 1');
  const r = doc.run;
  const rk = ['target','base_ref','head_ref','profile','scope','status','execution','limitations'];
  if (!requireKeys(r, rk, 'run')) return errors;
  keySet(r, rk, 'run');
  if (!nonempty(r.target) || !nonempty(r.head_ref)) fail('run', 'target and head_ref must be nonempty');
  if (r.base_ref !== null && (!nonempty(r.base_ref) || r.base_ref === r.head_ref)) fail('run.base_ref', 'expected null or a distinct revision');
  if (!['quick','standard','deep'].includes(r.profile)) fail('run.profile', 'invalid profile');
  if (!['complete','incomplete'].includes(r.status)) fail('run.status', 'invalid status');
  if (!['static_only','sandboxed_tested'].includes(r.execution)) fail('run.execution', 'invalid execution');
  if (!Array.isArray(r.scope) || r.scope.length === 0 || r.scope.some(x => !nonempty(x))) fail('run.scope', 'expected nonempty strings');
  if (!Array.isArray(r.limitations) || r.limitations.some(x => !nonempty(x))) fail('run.limitations', 'expected strings');
  if (r.status === 'incomplete' && Array.isArray(r.limitations) && r.limitations.length === 0) fail('run.limitations', 'incomplete run must explain limitations');
  const baseAvailable = nonempty(r.base_ref) && r.base_ref !== r.head_ref;
  const features = new Map();
  if (!Array.isArray(doc.features) || doc.features.length === 0) fail('features', 'expected nonempty array');
  else doc.features.forEach((f, i) => {
    const loc = 'features[' + i + ']';
    const keys = ['id','name','purpose','intent_status','intent_evidence','entrypoints','contracts','status','exclusion_reason'];
    if (!requireKeys(f, keys, loc)) return;
    keySet(f, keys, loc);
    if (typeof f.id !== 'string' || !ID.test(f.id) || f.id.includes('::')) fail(loc + '.id', 'invalid stable feature id');
    if (features.has(f.id)) fail(loc + '.id', 'duplicate id');
    else features.set(f.id, f);
    if (!nonempty(f.name)) fail(loc + '.name', 'required');
    if (!['documented','inferred','unknown'].includes(f.intent_status)) fail(loc + '.intent_status', 'invalid');
    if (f.intent_status === 'unknown' ? f.purpose !== null : !nonempty(f.purpose)) fail(loc + '.purpose', 'purpose inconsistent with intent_status');
    if (!Array.isArray(f.intent_evidence)) fail(loc + '.intent_evidence', 'expected array');
    else {
      f.intent_evidence.forEach((e,j) => {
        const p=loc+'.intent_evidence['+j+']';
        if (!requireKeys(e,['ref','detail'],p)) return;
        keySet(e,['ref','detail'],p);
        if (!nonempty(e.ref)||!nonempty(e.detail)) fail(p,'ref/detail required');
      });
      if (f.intent_status !== 'unknown' && f.intent_evidence.length===0) fail(loc+'.intent_evidence','documented/inferred intent needs evidence');
    }
    if (!Array.isArray(f.entrypoints) || f.entrypoints.some(x=>!nonempty(x))) fail(loc+'.entrypoints','expected array of strings');
    if (!Array.isArray(f.contracts) || f.contracts.some(x=>!nonempty(x))) fail(loc+'.contracts','expected array of strings');
    if (!['in_scope','out_of_scope'].includes(f.status)) fail(loc+'.status','invalid');
    if (f.status==='in_scope' && (!f.entrypoints?.length || !f.contracts?.length)) fail(loc,'in-scope feature needs entrypoints and contracts');
    if (f.status==='out_of_scope' ? !nonempty(f.exclusion_reason) : f.exclusion_reason !== null) fail(loc+'.exclusion_reason','inconsistent with scope');
  });
  const coverage = new Map();
  const axesByFeature = new Map();
  if (!Array.isArray(doc.coverage)) fail('coverage','expected array');
  else doc.coverage.forEach((c,i)=> {
    const loc='coverage['+i+']';
    const keys=['id','feature_id','axis','case_id','status','base_result','head_result','evidence','reason'];
    if (!requireKeys(c,keys,loc)) return;
    keySet(c,keys,loc);
    if (!features.has(c.feature_id)) fail(loc+'.feature_id','unknown feature');
    if (!AXES.includes(c.axis)) fail(loc+'.axis','invalid axis');
    if (typeof c.case_id!=='string' || !CASE_ID.test(c.case_id)) fail(loc+'.case_id','invalid case id');
    if (c.id !== c.feature_id+'::'+c.axis+'::'+c.case_id) fail(loc+'.id','must match canonical tuple');
    if (coverage.has(c.id)) fail(loc+'.id','duplicate id'); else coverage.set(c.id,c);
    if (!axesByFeature.has(c.feature_id)) axesByFeature.set(c.feature_id,new Set());
    axesByFeature.get(c.feature_id).add(c.axis);
    if (!STATUSES.includes(c.status)) fail(loc+'.status','invalid');
    if (!RESULTS.includes(c.base_result)||!RESULTS.includes(c.head_result)) fail(loc,'invalid base/head result');
    if (!baseAvailable && ['pass','fail'].includes(c.base_result)) fail(loc+'.base_result','cannot test absent baseline');
    evidence(c.evidence,loc+'.evidence',baseAvailable);
    const ev=Array.isArray(c.evidence)?c.evidence:[];
    const executed=rev=>ev.some(x=>isObj(x)&&x.revision===rev&&['test','runtime'].includes(x.kind));
    if (['pass','fail'].includes(c.head_result) && !executed('head')) fail(loc,'HEAD result needs executed evidence');
    if (['pass','fail'].includes(c.base_result) && !executed('base')) fail(loc,'BASE result needs executed evidence');
    if (c.status==='covered' && c.head_result!=='pass') fail(loc,'covered requires HEAD pass');
    if (c.status==='failed' && c.head_result!=='fail') fail(loc,'failed requires HEAD fail');
    if (['blocked','deferred','not_applicable','out_of_scope'].includes(c.status) && ['pass','fail'].includes(c.head_result)) fail(loc,'non-executed status cannot claim HEAD result');
    if (['blocked','deferred','not_applicable','out_of_scope'].includes(c.status) && !nonempty(c.reason)) fail(loc+'.reason','reason required');
    if (['covered','failed'].includes(c.status) && c.reason!==null) fail(loc+'.reason','must be null for executed case');
    if (c.status==='not_applicable' && ev.some(e=>e?.revision==='head'&&e?.kind!=='source')) fail(loc,'not_applicable should not have HEAD test evidence');
    if (features.get(c.feature_id)?.status==='out_of_scope' && c.status!=='out_of_scope') fail(loc,'excluded feature must have out_of_scope cases');
    if (r.execution==='static_only' && (executed('head')||executed('base'))) fail(loc,'static_only cannot contain executed test evidence');
  });
  for (const [id, f] of features) {
    if (f.status!=='in_scope') continue;
    const recorded=axesByFeature.get(id)||new Set();
    for (const axis of AXES) if (!recorded.has(axis)) fail('coverage','missing required '+axis+' axis for feature '+id);
  }
  const findingIds=new Set();
  if (!Array.isArray(doc.findings)) fail('findings','expected array');
  else doc.findings.forEach((f,i)=>{
    const loc='findings['+i+']';
    const keys=['id','feature_id','coverage_ids','verdict','title','expected','observed','intent_classification','impact','severity','evidence','blockers','discovery_agent','verifier_agent'];
    if (!requireKeys(f,keys,loc)) return;
    keySet(f,keys,loc);
    if (typeof f.id!=='string'||!ID.test(f.id)) fail(loc+'.id','invalid id');
    if (findingIds.has(f.id)) fail(loc+'.id','duplicate finding id'); else findingIds.add(f.id);
    if (!features.has(f.feature_id)) fail(loc+'.feature_id','unknown feature');
    if (!VERDICTS.includes(f.verdict)) fail(loc+'.verdict','invalid');
    if (!nonempty(f.title)||!nonempty(f.expected)) fail(loc,'title and expected required');
    if (f.observed!==null && !nonempty(f.observed)) fail(loc+'.observed','expected null or nonempty string');
    if (!['intended','unintended','unknown'].includes(f.intent_classification)) fail(loc+'.intent_classification','invalid');
    if (!Array.isArray(f.coverage_ids)||f.coverage_ids.length===0) fail(loc+'.coverage_ids','nonempty links required');
    const linked=[];
    if (Array.isArray(f.coverage_ids)) f.coverage_ids.forEach(id=>{
      const c=coverage.get(id);
      if (!c) fail(loc+'.coverage_ids','unknown coverage id: '+id);
      else if (c.feature_id!==f.feature_id) fail(loc+'.coverage_ids','linked to wrong feature');
      else linked.push(c);
    });
    evidence(f.evidence,loc+'.evidence',baseAvailable);
    if (!Array.isArray(f.blockers)||f.blockers.some(x=>!nonempty(x))) fail(loc+'.blockers','expected list of reasons');
    if (!nonempty(f.discovery_agent)) fail(loc+'.discovery_agent','required');
    if (f.verifier_agent!==null && !nonempty(f.verifier_agent)) fail(loc+'.verifier_agent','expected null or identifier');
    const confirmed=['confirmed_regression','confirmed_change'].includes(f.verdict);
    if (confirmed) {
      if (!nonempty(f.observed)||!Array.isArray(f.evidence)||f.evidence.length===0) fail(loc,'confirmed finding needs observation and evidence');
      if (!nonempty(f.verifier_agent)||f.verifier_agent===f.discovery_agent) fail(loc,'confirmed verdict requires independent verifier');
      if (Array.isArray(f.blockers)&&f.blockers.length!==0) fail(loc,'confirmed finding cannot have blockers');
      if (!baseAvailable) fail(loc,'confirmed change/regression requires BASE revision');
      for (const revision of ['base','head']) if (!f.evidence?.some(e=>e?.revision===revision&&['test','runtime'].includes(e?.kind))) fail(loc,'confirmed finding missing '+revision+' executed evidence');
    }
    if (f.verdict==='confirmed_regression') {
      if (f.intent_classification!=='unintended') fail(loc,'regression needs unintended classification');
      if (!nonempty(f.impact)||!['critical','high','medium','low'].includes(f.severity)) fail(loc,'regression requires impact and severity');
      if (!linked.some(c=>c.base_result==='pass'&&c.head_result==='fail'&&c.status==='failed')) fail(loc,'regression requires linked BASE pass → HEAD fail case');
    } else {
      if (f.impact!==null || f.severity!==null) fail(loc,'impact/severity only permitted for confirmed_regression');
    }
    if (f.verdict==='confirmed_change') {
      if (!['intended','unknown'].includes(f.intent_classification)) fail(loc,'change intention can be intended or unknown');
      if (!linked.some(c=>['pass','fail'].includes(c.base_result)&&['pass','fail'].includes(c.head_result))) fail(loc,'change needs a BASE/HEAD observed case');
    }
    if (f.verdict==='needs_validation' && (!Array.isArray(f.blockers)||!f.blockers.length)) fail(loc,'needs_validation requires exact blockers');
    if (f.verdict==='rejected' && (!Array.isArray(f.blockers)||!f.blockers.length)) fail(loc,'rejected needs reason in blockers');
  });
  if (r.status==='complete') {
    if (![...features.values()].some(f=>f.status==='in_scope')) fail('run.status','no in-scope features');
    if ([...coverage.values()].some(c=>['blocked','deferred','failed'].includes(c.status)&&features.get(c.feature_id)?.status==='in_scope')) fail('run.status','incomplete or failing coverage');
    if (Array.isArray(doc.findings)&&doc.findings.some(f=>f.verdict==='needs_validation'||f.verdict==='confirmed_regression')) fail('run.status','unresolved findings or regressions');
  }
  return errors;
}

function main(argv) {
  const path=argv[2];
  if (!path) { console.error('Usage: node validate-audit.cjs <audit.json>'); return 2; }
  try {
    const stat=fs.statSync(path);
    if (!stat.isFile()||stat.size>5*1024*1024) throw new Error('expected regular JSON file <=5 MiB');
    const data=JSON.parse(fs.readFileSync(path,'utf8'));
    const errors=validate(data);
    if (errors.length) { for (const e of errors) console.error('ERROR '+e); return 1; }
    console.log('OK: audit.json structure and cross-record invariants validated (not empirical truth)');
    return 0;
  } catch (error) { console.error('ERROR '+error.message); return 1; }
}
if (require.main===module) process.exitCode=main(process.argv);
module.exports={validate,AXES};
