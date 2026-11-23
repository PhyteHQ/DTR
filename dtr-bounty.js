/* DTR // Bounty Board. Local claim builder; no automatic external posting. */
(() => {
  'use strict';
  if (window.DTRBounty) return;
  const KEY='dtr:bounty:draft:v1';
  const FACTIONS=[
    ['phoenix','Phoenix / Zoner (pirate transports)',150000],
    ['nomads','Nomads',80000],['wild','The Wild',80000],
    ['hessians','Red Hessians',60000],['outcasts','Outcasts',60000],
    ['bhg','Bounty Hunters Guild',60000],['core','The Core',60000],['mollys','Mollys',60000],
    ['coalition','Coalition',30000],['rheinland','Rheinland military / police',30000],
    ['bretonia','Bretonia military / police',30000],['kusari','Kusari military / police',30000],
    ['chrysanthemums','Golden Chrysanthemums',25000],['dragons','Blood Dragons',25000],
    ['gmg','Gas Miners Guild',25000],['corporation','Hostile House corporation (piracy)',20000]
  ];
  const SHIPS=[['light','Light (Fighters & Bombers)',10000],['medium','Medium (Gunboats & Frigates)',25000],['heavy','Heavy (Cruisers & Battleships)',40000]];
  const IDS=[['dtr','DTR',50000],['corsair','Corsair Naval Independent Pilot',20000]];
  const $=id=>document.getElementById(id);
  const clean=value=>String(value==null?'':value);
  const escape=value=>clean(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const money=n=>Math.round(n).toLocaleString('en-GB');
  const short=n=>Number.isInteger(n/1000)?n/1000+'K':money(n);
  const number=(v,min=0,max=100000000)=>{if(v===''||v===null||v===undefined)return null;const n=Number(v);return Number.isFinite(n)&&n>=min&&n<=max?n:null;};
  const find=(rows,key)=>rows.find(r=>r[0]===key)||rows[0];
  const localDate=()=>{const d=new Date(),offset=d.getTimezoneOffset();return new Date(d.getTime()-offset*60000).toISOString().slice(0,10);};
  const newEntry=()=>({uid:++nextId,victim:'',faction:'phoenix',ship:'light',damage:'',eventEnabled:false,eventType:'multiplier',eventValue:'',eventReason:''});
  let nextId=0;
  const blank=()=>({character:'',date:localDate(),id:'dtr',kind:'kill',destination:'',proof:'',affiliationProof:'',entries:[newEntry()]});
  function restore(){
    try{
      const raw=JSON.parse(localStorage.getItem(KEY)||'null');
      if(!raw||!Array.isArray(raw.entries)||!raw.entries.length)return blank();
      const entries=raw.entries.slice(0,15).map(e=>({
        ...newEntry(),victim:clean(e.victim).slice(0,160),faction:find(FACTIONS,e.faction)[0],
        ship:find(SHIPS,e.ship)[0],damage:clean(e.damage).slice(0,8),
        eventEnabled:Boolean(e.eventEnabled),eventType:e.eventType==='flat'?'flat':'multiplier',
        eventValue:clean(e.eventValue).slice(0,20),eventReason:clean(e.eventReason).slice(0,180)
      }));
      return {character:clean(raw.character).slice(0,160),date:/^\d{4}-\d{2}-\d{2}$/.test(raw.date)?raw.date:localDate(),
        id:find(IDS,raw.id)[0],kind:raw.kind==='piracy'?'piracy':'kill',destination:clean(raw.destination).slice(0,180),
        proof:clean(raw.proof).slice(0,5000),affiliationProof:clean(raw.affiliationProof).slice(0,5000),entries};
    }catch{return blank();}
  }
  let state=restore(),activeOutput='discord',flashTimer=null;
  const choice=(rows,value)=>rows.map(r=>'<option value="'+escape(r[0])+'"'+(r[0]===value?' selected':'')+'>'+escape(r[1])+'</option>').join('');
  function multiplier(p){if(p===null)return 0;if(p>=91)return 1;if(p>=51)return .75;if(p>=26)return .5;if(p>=10)return .25;return 0;}
  function calculate(e){
    const f=find(FACTIONS,e.faction),s=find(SHIPS,e.ship),id=find(IDS,state.id);
    const damage=number(e.damage,0,100),factor=multiplier(damage),base=(f[2]+s[2]+id[2])*factor;
    const eventValue=number(e.eventValue,0,100000000);
    const apply=e.eventEnabled&&eventValue!==null&&(e.eventType==='flat'||eventValue>0);
    const total=apply?(e.eventType==='flat'?base+eventValue:base*eventValue):base;
    return {f,s,id,damage,factor,base,apply,total,eventValue};
  }
  function formula(e,c){
    let expression='('+short(c.f[2])+' ('+c.f[1].replace(' (pirate transports)','')+') + '+short(c.s[2])+' ('+c.s[1].split(' (')[0]+') + '+short(c.id[2])+' ('+c.id[1]+')) × '+c.factor+' ('+(c.damage===null?0:c.damage)+'%)';
    if(c.apply)expression=c.eventType==='flat'?expression:expression;
    if(c.apply)expression='('+expression+') '+(e.eventType==='flat'?'+ '+money(c.eventValue):'× '+c.eventValue);
    return expression+' = '+money(c.total);
  }
  function eventLine(e,c){
    if(!c.apply)return '';
    const reason=e.eventReason.trim()||'Exceptional bounty';
    return 'Event: '+reason+' ('+(e.eventType==='flat'?'+'+money(c.eventValue)+' cr':'×'+c.eventValue)+')';
  }
  function textValue(t){return clean(t).trim()||'—';}
  function victims(){return state.entries.map(e=>textValue(e.victim)+', '+find(FACTIONS,e.faction)[1]+', '+find(SHIPS,e.ship)[1].split(' (')[0]).join('\n');}
  function claims(){return state.entries.map((e,i)=>{const c=calculate(e);return (state.entries.length>1?'#'+(i+1)+' ':'')+formula(e,c)+(eventLine(e,c)?'\n'+eventLine(e,c):'');}).join('\n')+(state.entries.length>1?'\nTOTAL = '+money(state.entries.reduce((sum,e)=>sum+calculate(e).total,0)):'');}
  function discord(){return [
    '- Character\'s Name:\n'+textValue(state.character),
    '- Date: '+state.date,
    '- Kills / piracy victims:\n'+victims(),
    '- Amount owed and where is the money going to:\n'+claims()+'\nMoney to '+textValue(state.destination),
    '- Proof of the kill (links or direct image)\n'+textValue(state.proof),
    '- Visual evidence of affiliation (ID on ship used for the task):\n'+textValue(state.affiliationProof)
  ].join('\n\n');}
  function forum(){const label=s=>'[color=#c06f6c]'+s+'[/color]';return [
    label('Character\'s Name:')+' '+textValue(state.character),
    label('Date:')+' '+state.date,
    label('Kills / Piracy victims:')+' '+victims(),
    label('Amount owed and where is the money going to:')+' '+claims()+'\nMoney to '+textValue(state.destination),
    label('Proof (as stated in the requirements):')+' '+textValue(state.proof),
    label('Visual evidence of affiliation (ID on ship used for the task):')+' '+textValue(state.affiliationProof)
  ].join('\n');}
  function persist(){try{localStorage.setItem(KEY,JSON.stringify(state));}catch{setStatus('Local draft could not be saved. Copy your report before leaving.','warn');}}
  function setStatus(message,tone='good'){const node=$('bountyFeedback');if(node){node.textContent=message;node.dataset.tone=tone;}}
  function entryMarkup(e,i){
    const c=calculate(e);
    return '<article class="bounty-entry" data-uid="'+e.uid+'">'+
      '<header class="bounty-entry-head"><div><small>ENGAGEMENT '+String(i+1).padStart(2,'0')+'</small><strong>'+ (state.kind==='piracy'?'PIRACY VICTIM':'KILL TARGET') +'</strong></div>'+
      '<button type="button" class="bounty-remove" data-remove="'+e.uid+'"'+(state.entries.length===1?' disabled':'')+' aria-label="Remove engagement '+(i+1)+'">REMOVE</button></header>'+
      '<div class="bounty-fields">'+
      '<label class="bounty-field bounty-wide"><span>Target / victim name</span><input data-field="victim" value="'+escape(e.victim)+'" maxlength="160" placeholder="Character or unnamed target" autocomplete="off"></label>'+
      '<label class="bounty-field"><span>Enemy affiliation</span><select data-field="faction">'+choice(FACTIONS,e.faction)+'</select></label>'+
      '<label class="bounty-field"><span>Ship class</span><select data-field="ship">'+choice(SHIPS,e.ship)+'</select></label>'+
      '<label class="bounty-field bounty-wide"><span>Damage dealt (%) <button type="button" class="bounty-info" data-info="damage" aria-label="Damage multiplier information">i</button></span><input type="number" min="0" max="100" step="1" inputmode="numeric" data-field="damage" value="'+escape(e.damage)+'" placeholder="e.g. 61"></label>'+
      '</div><div class="bounty-event"><label class="bounty-event-toggle"><input type="checkbox" data-field="eventEnabled"'+(e.eventEnabled?' checked':'')+'><span>EXCEPTIONAL BOUNTY <small>(EVENT)</small></span></label>'+
      '<div class="bounty-event-body"'+(e.eventEnabled?'':' hidden')+'><div class="bounty-event-grid">'+
      '<label class="bounty-field"><span>Event type</span><select data-field="eventType"><option value="multiplier"'+(e.eventType==='multiplier'?' selected':'')+'>× Multiplier</option><option value="flat"'+(e.eventType==='flat'?' selected':'')+'>+ Flat bonus</option></select></label>'+
      '<label class="bounty-field"><span>Value</span><input type="number" min="0" max="100000000" step="any" data-field="eventValue" value="'+escape(e.eventValue)+'" placeholder="'+(e.eventType==='flat'?'Credits':'e.g. 5')+'"></label>'+
      '</div><label class="bounty-field"><span>Event / reason (shown in claim)</span><input data-field="eventReason" maxlength="180" value="'+escape(e.eventReason)+'" placeholder="e.g. Harvest Moon Raid Week ×5"></label>'+
      '<p class="bounty-event-hint" data-event-hint>'+(c.apply?'EVENT BONUS ACTIVE // INCLUDED IN PAYOUT':'NO VALID EVENT VALUE // STANDARD PAYOUT')+'</p></div></div>'+
      '<div class="bounty-entry-result"><code data-formula>'+escape(formula(e,c))+'</code><strong data-amount>'+money(c.total)+' <span>cr</span></strong></div></article>';
  }
  function renderEntries(){
    $('bountyEntries').innerHTML=state.entries.map(entryMarkup).join('');
    $('bountyAdd').disabled=state.entries.length>=15;
    updateResults();
  }
  function updateResults(){
    let total=0;
    state.entries.forEach(e=>{
      const node=$('bountyEntries').querySelector('[data-uid="'+e.uid+'"]');if(!node)return;
      const c=calculate(e);total+=c.total;
      node.querySelector('[data-formula]').textContent=formula(e,c);
      node.querySelector('[data-amount]').innerHTML=money(c.total)+' <span>cr</span>';
      const hint=node.querySelector('[data-event-hint]');if(hint)hint.textContent=c.apply?'EVENT BONUS ACTIVE // INCLUDED IN PAYOUT':'NO VALID EVENT VALUE // STANDARD PAYOUT';
    });
    $('bountyTotal').textContent=money(total)+' cr';
    $('bountyCount').textContent=state.entries.length+' / 15';
    $('bountyPreview').textContent=activeOutput==='forum'?forum():discord();
    $('bountyPreviewTitle').textContent=activeOutput==='forum'?'FORUM // BBCODE':'DISCORD // PLAIN TEXT';
    document.querySelectorAll('[data-output]').forEach(b=>{b.classList.toggle('active',b.dataset.output===activeOutput);b.setAttribute('aria-pressed',String(b.dataset.output===activeOutput));});
    persist();
  }
  async function copy(){
    const content=activeOutput==='forum'?forum():discord();
    try{
      if(!navigator.clipboard?.writeText)throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(content);
      setStatus((activeOutput==='forum'?'Forum BBCode':'Discord report')+' copied. Paste it into your post.');
    }catch{
      const box=$('bountyPreview');
      const selection=window.getSelection(),range=document.createRange();
      range.selectNodeContents(box);selection.removeAllRanges();selection.addRange(range);
      try{if(!document.execCommand('copy'))throw new Error('Copy failed');setStatus('Report copied. Paste it into your post.');selection.removeAllRanges();}
      catch{setStatus('Select the report text above and copy it manually.','warn');}
    }
  }
  function mount(){
    const root=$('bountyRoot');if(!root)return;
    root.innerHTML='<div class="bounty-hero"><div><p class="section-kicker">DTR // CORSAIR OPERATIONS</p><h2>BOUNTY BOARD</h2><p>FILE THE ENGAGEMENT. VERIFY THE MATH. TRANSMIT THE CLAIM.</p></div><span class="bounty-hero-mark" aria-hidden="true">✦</span></div>'+
      '<div class="bounty-shell"><div class="bounty-main"><div class="bounty-panel"><div class="bounty-section-title"><span>01 // REPORT IDENTITY</span><button class="bounty-info" type="button" data-info="identity" aria-label="Report identity help">i</button></div>'+
      '<div class="bounty-fields"><label class="bounty-field"><span>Character\'s name</span><input id="bountyCharacter" maxlength="160" placeholder="Your character name"></label>'+
      '<label class="bounty-field"><span>Date</span><input id="bountyDate" type="date"></label>'+
      '<label class="bounty-field"><span>Operation</span><select id="bountyKind"><option value="kill">KILL REPORT</option><option value="piracy">PIRACY REPORT</option></select></label>'+
      '<label class="bounty-field"><span>Affiliation / ID</span><select id="bountyId">'+choice(IDS,state.id)+'</select></label></div></div>'+
      '<section class="bounty-panel"><div class="bounty-section-title"><span>02 // ENGAGEMENT LOG</span><span class="bounty-mini-counter" id="bountyCount"></span></div><div id="bountyEntries"></div><button type="button" class="bounty-add" id="bountyAdd">+ ADD ANOTHER ENGAGEMENT</button></section>'+
      '<section class="bounty-panel"><div class="bounty-section-title"><span>03 // CLAIM & EVIDENCE</span><button class="bounty-info" type="button" data-info="evidence" aria-label="Evidence help">i</button></div>'+
      '<div class="bounty-fields"><label class="bounty-field bounty-wide"><span>Money to (recipient / account)</span><input id="bountyDestination" maxlength="180" placeholder="Where should the payout go?"></label>'+
      '<label class="bounty-field bounty-wide"><span>Proof of kill / piracy (links or direct image)</span><textarea id="bountyProof" rows="3" placeholder="Paste screenshot, DSAce or evidence links"></textarea></label>'+
      '<label class="bounty-field bounty-wide"><span>Visual evidence of affiliation (ID on ship)</span><textarea id="bountyAffiliationProof" rows="3" placeholder="Paste ID / affiliation screenshot link"></textarea></label></div></section></div>'+
      '<aside class="bounty-side"><div class="bounty-payout"><small>ESTIMATED CLAIM VALUE</small><strong id="bountyTotal">0 cr</strong><p>Calculated live from the bounty matrix. Each engagement contributes to the total.</p></div>'+
      '<div class="bounty-panel bounty-export"><div class="bounty-section-title"><span>04 // TRANSMISSION READY</span><button type="button" class="bounty-info" data-info="posting" aria-label="Posting information">i</button></div>'+
      '<div class="bounty-output-switch"><button data-output="discord" type="button" class="active">DISCORD</button><button data-output="forum" type="button">FORUM BBCode</button></div>'+
      '<div class="bounty-preview-label" id="bountyPreviewTitle"></div><pre id="bountyPreview" tabindex="0"></pre><button class="bounty-copy" id="bountyCopy" type="button">COPY REPORT</button>'+
      '<p class="bounty-feedback" role="status" aria-live="polite" id="bountyFeedback">Copy the formatted claim, then submit it to your Discord or forum.</p></div></aside></div>'+
      '<div class="bounty-infobox" id="bountyHelp" role="status" hidden></div>';
    const map={bountyCharacter:'character',bountyDate:'date',bountyKind:'kind',bountyId:'id',bountyDestination:'destination',bountyProof:'proof',bountyAffiliationProof:'affiliationProof'};
    Object.entries(map).forEach(([id,key])=>{const el=$(id);el.value=state[key];const save=()=>{state[key]=el.value;updateResults();if(id==='bountyKind')renderEntries();};el.addEventListener('input',save);el.addEventListener('change',save);});
    root.addEventListener('input',event=>{
      const field=event.target.dataset.field,entry=event.target.closest('[data-uid]');
      if(!field||!entry)return;
      const e=state.entries.find(x=>x.uid===Number(entry.dataset.uid));if(!e)return;
      e[field]=event.target.type==='checkbox'?event.target.checked:event.target.value;
      updateResults();
    });
    root.addEventListener('change',event=>{
      const field=event.target.dataset.field,entry=event.target.closest('[data-uid]');
      if(!field||!entry)return;
      const e=state.entries.find(x=>x.uid===Number(entry.dataset.uid));if(!e)return;
      e[field]=event.target.type==='checkbox'?event.target.checked:event.target.value;
      if(field==='eventEnabled'||field==='eventType')renderEntries();else updateResults();
    });
    root.addEventListener('click',event=>{
      const remove=event.target.closest('[data-remove]'),info=event.target.closest('[data-info]'),output=event.target.closest('[data-output]');
      if(remove&&state.entries.length>1){state.entries=state.entries.filter(e=>e.uid!==Number(remove.dataset.remove));renderEntries();return;}
      if(output){activeOutput=output.dataset.output;updateResults();return;}
      if(info){
        const help={damage:'Damage multiplier: 0–9% = ×0 (unconfirmed low-damage claims); 10–25% = ×0.25; 26–50% = ×0.5; 51–90% = ×0.75; 91–100% = ×1. Values outside 0–100 are treated as unknown.',identity:'Select the ID displayed on the ship used for this operation. The ID bonus applies to each engagement.',evidence:'Include kill / piracy evidence and a separate screenshot proving the ID used. Links are printed into both report formats. Files are not uploaded by DTR.',posting:'COPY REPORT generates the exact Discord text or Forum BBCode. Automatic posting requires a securely configured server integration and is not enabled.'};
        const node=$('bountyHelp'),type=info.dataset.info;node.textContent=help[type]||'';node.hidden=!node.hidden&&node.dataset.type===type;node.dataset.type=type;return;
      }
    });
    $('bountyAdd').addEventListener('click',()=>{if(state.entries.length<15){state.entries.push(newEntry());renderEntries();$('bountyEntries').lastElementChild?.scrollIntoView({behavior:'smooth',block:'nearest'});}});
    $('bountyCopy').addEventListener('click',copy);
    renderEntries();
  }
  window.DTRBounty=Object.freeze({calculate,multiplier,discord,forum,getState:()=>JSON.parse(JSON.stringify(state))});
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount,{once:true});
  else mount();
})();
