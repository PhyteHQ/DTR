import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';

const source=await readFile(new URL('../dtr-bounty.js',import.meta.url),'utf8');
function runtime(draft=null){
  const data=new Map();
  if(draft)data.set('dtr:bounty:draft:v1',JSON.stringify(draft));
  const window={};
  const document={readyState:'loading',addEventListener(){}};
  runInNewContext(source,{window,document,localStorage:{
    getItem:key=>data.get(key)??null,
    setItem:(key,value)=>data.set(key,value)
  },Date,Number,Math,Intl,JSON,String,Array,Boolean,Object,RegExp});
  assert(window.DTRBounty);
  return window.DTRBounty;
}
const report=runtime();
assert.equal(report.multiplier(0),0);
assert.equal(report.multiplier(9),0);
assert.equal(report.multiplier(10),.25);
assert.equal(report.multiplier(25),.25);
assert.equal(report.multiplier(26),.5);
assert.equal(report.multiplier(50),.5);
assert.equal(report.multiplier(51),.75);
assert.equal(report.multiplier(90),.75);
assert.equal(report.multiplier(91),1);
assert.equal(report.multiplier(100),1);
const base={faction:'phoenix',ship:'light',damage:'61',eventEnabled:false,eventType:'multiplier',eventValue:'',eventReason:''};
assert.equal(report.calculate(base).base,157500);
assert.equal(report.calculate({...base,eventEnabled:true,eventType:'multiplier',eventValue:'5'}).total,787500);
assert.equal(report.calculate({...base,eventEnabled:true,eventType:'flat',eventValue:'200000'}).total,357500);
assert.equal(report.calculate({...base,eventEnabled:true,eventType:'multiplier',eventValue:''}).total,157500);
assert.equal(report.calculate({...base,damage:''}).total,0);
const draft={
 character:'DTR Test',date:'2026-11-23',id:'dtr',kind:'kill',destination:'Fleet Treasury',
 proof:'https://example.org/kill.png',affiliationProof:'https://example.org/id.png',
 entries:[{...base,victim:'Enemy Pilot',eventEnabled:true,eventType:'multiplier',eventValue:'5',eventReason:'Raid Week'}]
};
const exports=runtime(draft);
assert.match(exports.discord(),/Character's Name:/);
assert.match(exports.discord(),/787,500/);
assert.match(exports.discord(),/Event: Raid Week/);
assert.match(exports.discord(),/Money to Fleet Treasury/);
assert.match(exports.forum(),/\[color=#c06f6c\]Amount owed and where is the money going to:\[\/color\]/);
assert.match(exports.forum(),/787,500/);
assert.match(exports.forum(),/https:\/\/example.org\/id.png/);
console.log('Bounty report and event audit passed.');
