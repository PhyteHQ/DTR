(()=>{'use strict';
const POBS={
  'deterrence-sanctum':['deterrence sanctum'],
  'ravenna-invicta':['ravenna invicta','invicta'],
  'forja-del-vacio':['forja del vacio','forja del vacío'],
  'fort-torrelavega':['fort torrelavega','torrelavega']
};
const norm=v=>String(v??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const finite=v=>{const n=Number(v);return Number.isFinite(n)?n:null};
const num=new Intl.NumberFormat('de-DE');
const fmt=v=>Number.isFinite(v)?num.format(Math.round(v)):'—';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function snapshot(){try{const raw=JSON.parse(localStorage.getItem('dtr:pobs:live:v2')||'null');return Array.isArray(raw?.data)?raw.data:[]}catch{return[]}}
function baseForView(view){const aliases=(POBS[view]||[]).map(norm);if(!aliases.length)return null;return snapshot().find(base=>{const hay=norm([base?.name,base?.nickname,base?.base_name,base?.display_name].filter(Boolean).join(' '));return aliases.some(a=>hay===a||hay.includes(a))})||null}
function items(base){const list=base?.shop_items??base?.shopItems??base?.goods??[];return Array.isArray(list)?list:[]}
function itemName(item){return String(item?.name??item?.good_name??item?.commodity_name??item?.nickname??item?.good??'UNKNOWN ITEM')}
function itemFor(base,name){const key=norm(name);return items(base).find(item=>norm(itemName(item))===key)||null}
function qty(item){return finite(item?.quantity??item?.amount??item?.stock)??0}
function boundary(item){const min=finite(item?.min_stock??item?.min),max=finite(item?.max_stock??item?.max??item?.maxStock??item?.max_quantity??item?.maxQuantity);return{min,max,valid:min!==null&&max!==null&&max>0&&min>=0&&min<=max}}
function tone(item){const q=qty(item),b=boundary(item);if(!b.valid)return'muted';if(q<b.min)return'danger';if(b.min>0&&q<b.min*1.25)return'warn';return'good'}
function bar(item,compact=false){const q=qty(item),b=boundary(item),t=tone(item),max=b.valid?b.max:Math.max(q,1),fill=Math.max(0,Math.min(100,q/max*100)),marker=b.valid?Math.max(0,Math.min(100,b.min/b.max*100)):null,range=b.valid?`<span>MIN ${fmt(b.min)}</span><span>MAX ${fmt(b.max)}</span>`:'<span>MIN —</span><span>MAX —</span>';return`<div class="stock-level${compact?' compact':''}" data-tone="${t}"><div class="stock-range">${range}</div><div class="stock-track"><i style="width:${fill}%"></i>${marker===null?'':`<mark style="left:${marker}%"></mark>`}</div></div>`}
function activeView(){return document.querySelector('.tab.active')?.dataset?.view||'overview'}
function enhanceManifest(){
  const view=activeView();if(view==='overview')return;
  const base=baseForView(view);if(!base)return;
  const head=document.querySelector('.inventory-panel thead th:last-child');if(head&&head.textContent!=='STOCK LEVEL')head.textContent='STOCK LEVEL';
  document.querySelectorAll('#inventoryBody tr').forEach(row=>{
    const name=row.querySelector('.item-name')?.textContent?.trim();const cell=row.lastElementChild;if(!name||!cell)return;
    const item=itemFor(base,name);cell.classList.add('stock-cell');cell.dataset.label='STOCK LEVEL';const html=item?bar(item):bar({});if(cell.innerHTML!==html)cell.innerHTML=html;
  });
}
function enhanceWatch(){
  const view=activeView();if(view==='overview')return;
  const base=baseForView(view);if(!base)return;
  document.querySelectorAll('#watchGrid .watch-card').forEach(card=>{
    const name=card.querySelector('strong')?.textContent?.trim();if(!name)return;
    const item=itemFor(base,name);const old=card.querySelector(':scope > span');if(old)old.remove();
    let slot=card.querySelector(':scope > .stock-level');const html=item?bar(item,true):bar({},true);
    if(slot){const wrap=document.createElement('div');wrap.innerHTML=html;slot.replaceWith(wrap.firstElementChild)}else card.insertAdjacentHTML('beforeend',html);
  });
}
let scheduled=false;function run(){scheduled=false;document.documentElement.style.setProperty('--sigil','url("./assets/dtr-sigil.jpg")');enhanceManifest();enhanceWatch()}
function schedule(){if(scheduled)return;scheduled=true;requestAnimationFrame(run)}
new MutationObserver(schedule).observe(document.body,{childList:true,subtree:true});
window.addEventListener('storage',schedule);window.addEventListener('online',schedule);document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')schedule()});
setInterval(schedule,1500);schedule();
})();