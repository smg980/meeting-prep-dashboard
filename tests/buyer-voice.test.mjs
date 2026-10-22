import test from 'node:test';
import assert from 'node:assert/strict';
import {matchMeeting,extractSignals,makeOutcome} from '../scripts/buyer-voice.mjs';
const prep=[{id:'p1',title:'ExampleCo monitoring trial follow-up',account:'ExampleCo',start:'2026-10-22T19:00:00Z',attendees:['A. Person']}];
const note={id:'n1',title:'ExampleCo monitoring trial follow-up',account:'ExampleCo',date:'2026-10-22T19:10:00Z',participants:['A. Person'],url:'https://notes.granola.ai/d/example'};
test('matches same meeting',()=>assert.equal(matchMeeting(prep,note).status,'matched'));
test('rejects distant meeting',()=>assert.equal(matchMeeting(prep,{...note,date:'2026-11-02T19:10:00Z'}).status,'unmatched'));
test('flags ambiguous matches',()=>assert.equal(matchMeeting([prep[0],{...prep[0],id:'p2'}],note).status,'ambiguous'));
test('validates dates',()=>assert.throws(()=>matchMeeting(prep,{...note,date:'invalid'})));
test('signals are extractive and unverified',()=>{
 const signals=extractSignals(['Production InfoSec approval required.','A trial might be possible.']);
 assert.equal(signals.length,2);
 assert.ok(signals.every(s=>s.attribution==='unverified'&&!('purchase_confirmed' in s)));
});
test('draft outcomes retain provenance and no invented owners',()=>{
 const o=makeOutcome({note,prepMatch:matchMeeting(prep,note),lines:['Db2 upgrade next year'],actions:[{description:'Confirm installation'}]});
 assert.equal(o.meeting.prep_id,'p1');
 assert.equal(o.commitments[0].owner,null);
 assert.equal(o.review_status,'draft');
});
test('source URL required',()=>assert.throws(()=>makeOutcome({note:{...note,url:''}})));
