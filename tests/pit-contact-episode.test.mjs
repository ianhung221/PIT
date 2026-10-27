import test from 'node:test';
import assert from 'node:assert/strict';
import {makeContactEpisodes,observeContactEpisode,finishContactEpisode} from '../lib/pitContactEpisode.ts';
import {makeDiagnostics,observeDiagnostic,closeContactDiagnostic,outcomeSample,updateDiagnostic} from '../lib/pitDiagnostics.ts';
const valid={localX:.975,localZ:1.6,playerLocalX:-1,playerLocalZ:-2,normalSide:.9,closingSpeed:5,normalSpeed:2,headingDelta:0,halfWidth:.975,halfLength:2.193,playerHalfLength:2.356,authorized:true};
const wrong={...valid,localZ:0};
test('continuous contact can improve within window; stable id, single damage/attempt, no candidate refresh',()=>{
  const s=makeContactEpisodes(),d=makeDiagnostics('practice','fixture');let damage=0,count=0,promotions=0;
  const step=(c,t)=>{const r=observeContactEpisode(s,c,t);damage+=r.damage;count+=r.countAttempt;promotions+=r.promoted;observeDiagnostic(d,c,s.current,t,r.changed);return r;};
  step(wrong,0);const id=d.latest.id;
  for(let i=1;i<=20;i++)step(wrong,i/60);
  assert.ok(step(valid,.35).promoted);assert.equal(d.latest.id,id);assert.equal(d.latest.status,'evaluating');
  for(let i=22;i<120;i++)step(valid,i/60);
  assert.equal(damage,1);assert.equal(count,1);assert.equal(promotions,1);
  updateDiagnostic(d,outcomeSample(0,1,20,10,0,.2,1),2,false);finishContactEpisode(s);
  assert.ok(d.lastSuccess);step(wrong,2.01);assert.equal(d.lastSuccess.id,id);
});
test('0.5 second window boundary, persistent bad contact and finite separation',()=>{
  for(const end of [.5,.5001]) {
    const s=makeContactEpisodes();observeContactEpisode(s,wrong,0);
    for(let t=.05;t<.49;t+=.05)observeContactEpisode(s,wrong,t);
    assert.equal(observeContactEpisode(s,valid,end).promoted,end===.5);
  }
  const s=makeContactEpisodes();observeContactEpisode(s,wrong,0);
  observeContactEpisode(s,null,.08);assert.ok(s.current);assert.equal(observeContactEpisode(s,valid,.09).started,false);
  observeContactEpisode(s,null,.19);assert.equal(s.current,null);
  assert.ok(observeContactEpisode(s,valid,.20).started);
});
test('unsafe and excessive episodes cannot become safe retroactively; counted once and separation permits retry',()=>{
  for(const c of [{...valid,authorized:false},{...valid,normalSpeed:9}]) {
    const s=makeContactEpisodes();const initial=observeContactEpisode(s,c,0);
    assert.ok(initial.unsafe);assert.ok(initial.countAttempt);
    for(let t=.01;t<1;t+=.01){const r=observeContactEpisode(s,valid,t);assert.equal(r.promoted,false);assert.equal(r.damage,false);assert.equal(r.countAttempt,false);}
    observeContactEpisode(s,null,1.2);assert.ok(observeContactEpisode(s,valid,1.21).promoted);
  }
});
test('conditions cannot be combined across samples and pending candidate cannot acquire a second episode',()=>{
  const s=makeContactEpisodes();observeContactEpisode(s,{...valid,localZ:0},0);
  assert.equal(observeContactEpisode(s,{...valid,headingDelta:1},.02).promoted,false);
  assert.equal(observeContactEpisode(s,{...valid,normalSpeed:0},.04).promoted,false);
  observeContactEpisode(s,null,.2);assert.equal(observeContactEpisode(s,valid,.21,true).promoted,false);
  assert.equal(observeContactEpisode(s,valid,.22,true).started,false);
});
test('separation closes diagnostic observation without inventing a result',()=>{
  const s=makeContactEpisodes(),d=makeDiagnostics('practice','fixture');const r=observeContactEpisode(s,wrong,0);
  observeDiagnostic(d,wrong,s.current,0,r.changed);const previous=s.current;
  observeContactEpisode(s,null,.1);closeContactDiagnostic(d,previous,.1);
  assert.equal(d.latest.status,'rejected');assert.match(d.latest.message,/分離/);assert.equal(d.lastSuccess,null);
});
