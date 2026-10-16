import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
const base=process.env.RMC2_TEST_URL||'http://127.0.0.1:5173';
const login=await fetch(base+'/api/operations/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'admin@rmc2.local',password:'Rmc2Local!2026'})});assert.equal(login.status,200);
const cookie=login.headers.get('set-cookie').split(';')[0];
async function call(route,body,expected=200,extra={}){const r=await fetch(base+'/api/operations/'+route,{method:body===undefined?'GET':'POST',headers:{Cookie:cookie,...(body===undefined?{}:{'Content-Type':'application/json'}),...extra},body:body===undefined?undefined:JSON.stringify(body)});const value=await r.json();assert.equal(r.status,expected,JSON.stringify(value));return value;}
const checks=[],pass=name=>{checks.push(name);process.stdout.write('PASS '+name+'\n');};
await call('notifications',{ids:[]},403,{Origin:'https://unrelated.example'});pass('Cross-origin mutations are rejected');
const initial=await call('bootstrap');const zeo=initial.users.find(u=>u.id==='zeo'),emerson=initial.users.find(u=>u.id==='emerson');assert.ok(zeo.active&&zeo.canApprove&&emerson.active&&emerson.canApprove);
try{
 await call('users',{...zeo,active:false});
 await call('users',{...emerson,active:false},400);pass('Last approving supervisor cannot be deactivated');
 await call('users',{...emerson,role:'Employee'},400);pass('Last approving supervisor cannot lose the supervisor role');
 await call('users',{...emerson,canApprove:false},400);pass('Last approving supervisor cannot lose approval permission');
}finally{await call('users',zeo);}
const restored=await call('bootstrap');assert.ok(restored.users.filter(u=>u.active&&u.role==='Supervisor'&&u.canApprove).length===2);pass('Original supervisor permissions restored after tests');
await writeFile('test-results/controls.json',JSON.stringify({at:new Date().toISOString(),checks},null,2));
