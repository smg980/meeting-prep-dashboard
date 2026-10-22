import { createHash } from 'node:crypto';
const norm = s => String(s ?? '').normalize('NFKC').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const words = s => new Set(norm(s).split(' ').filter(w => w.length > 2 && !['meeting','follow','with','discussion','review','team'].includes(w)));
const overlap = (a,b) => { const x=words(a),y=words(b);return x.size&&y.size ? [...x].filter(w=>y.has(w)).length/Math.max(x.size,y.size):0; };
const hash = s => createHash('sha256').update(s).digest('hex').slice(0,20);

/** Pure read-only meeting matching. Ambiguous matches always require review. */
export function matchMeeting(prep, note, { maxHours=8, minScore=0.60, margin=0.12 }={}) {
  if (!Array.isArray(prep) || !note?.date) throw new Error('Prep array and note.date required');
  const date = new Date(note.date);
  if (Number.isNaN(+date)) throw new Error('Invalid note.date');
  const ranked=prep.flatMap(p=>{
    const start=new Date(p.start);
    if(!p.start || Number.isNaN(+start)) return [];
    const hours=Math.abs(date-start)/36e5;
    if(hours>maxHours) return [];
    const account=norm(p.account);
    const accountMatch=account.length>=4 && norm(note.title+' '+(note.account||'')).includes(account);
    const attendees=new Set((note.participants||[]).map(norm));
    const shared=(p.attendees||[]).some(x=>attendees.has(norm(x)));
    const score=Math.min(1,0.48*overlap(p.title,note.title)+0.30*(accountMatch?1:0)+0.12*(shared?1:0)+0.10*(1-hours/maxHours));
    return [{id:p.id??p.rid,title:p.title,score:+score.toFixed(3),hoursApart:+hours.toFixed(2)}];
  }).sort((a,b)=>b.score-a.score);
  const [best,second]=ranked;
  if(!best || best.score<minScore) return {status:'unmatched',candidates:ranked.slice(0,3)};
  if(second && best.score-second.score<margin) return {status:'ambiguous',candidates:ranked.slice(0,3)};
  return {status:'matched',match:best,candidates:ranked.slice(0,3)};
}

const rules=[
  ['technology_lifecycle',/\b(upgrad(?:e|ing)|out.of.support|end.of.support|unsupported|migration)\b/i],
  ['security_blocker',/\b(infosec|security approval|policy|production access|permission)\b/i],
  ['technical_evaluation',/\b(trial|pilot|proof.of.concept|evaluate|evaluation|demo)\b/i],
  ['product_interest',/\b(anomaly detection|monitoring|automation|reporting)\b/i]
];
/** Candidate signals with verbatim evidence, NOT interpreted purchase intent. */
export function extractSignals(lines) {
  if(!Array.isArray(lines)) throw new Error('lines must be an array');
  const found=[],seen=new Set();
  lines.forEach((line,i)=>{
    if(typeof line!=='string') return;
    for(const [category,re] of rules){
      const key=category+':'+norm(line);
      if(re.test(line)&&!seen.has(key)) {
        seen.add(key);
        found.push({category,evidence:line.trim(),source_line:i+1,attribution:'unverified',confidence:'requires_review'});
      }
    }
  });
  return found;
}
export function makeOutcome({note,prepMatch,lines=[],actions=[]}) {
  if(!note?.id||!note?.date||!note?.url) throw new Error('Note id, date and URL required');
  const prepId=prepMatch?.status==='matched'?prepMatch.match.id:null;
  return {
    schema_version:'buyer-voice.v0.1',
    id:hash(note.id+'|'+(prepId||'unmatched')),
    account:note.account||null,
    meeting:{granola_id:note.id,granola_url:note.url,date:note.date,title:note.title||null,prep_id:prepId},
    match_status:prepMatch?.status||'unmatched',
    signals:extractSignals(lines),
    commitments:actions.map(a=>({description:String(a.description||'').trim(),owner:a.owner||null,due:a.due||null,owner_status:a.owner?'source_attributed':'unassigned',review_status:'pending'})),
    review_status:'draft',extraction_method:'extractive_rule_based',generated_at:null,
    limitations:['No automatic customer speaker attribution','No verified purchase intent','Requires seller review before persistence or outreach']
  };
}
