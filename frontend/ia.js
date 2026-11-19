'use strict';
const $ = id => document.getElementById(id);
let token = null;
const show = msg => { $('notice').textContent = msg; };
async function call(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  const res = await fetch(path, { ...options, headers });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) { if (res.status === 401 && token) reset(); throw new Error(body.error || `HTTP ${res.status}`); }
  return body;
}
function reset() { token=null; $('analysis').hidden=true; $('access').hidden=false; $('items').textContent=''; }
$('login').addEventListener('submit', async e => {
  e.preventDefault(); const btn=e.target.querySelector('button');btn.disabled=true;
  try {
    const data=await call('/api/auth/login',{method:'POST',body:JSON.stringify({correo:$('correo').value,contrasena:$('pass').value})});
    if (!data.token || data.usuario?.rol !== 'administrador') {
      if (data.token) { token=data.token;await call('/api/auth/logout',{method:'POST'}).catch(()=>{}); }
      reset();throw new Error('Acceso exclusivo para administrador.');
    }
    token=data.token; $('access').hidden=true;$('analysis').hidden=false;show('Sesión autenticada.');
  } catch(err) {show(err.message);} finally {$('pass').value='';btn.disabled=false;}
});
$('run').addEventListener('submit',async e=>{
  e.preventDefault();$('go').disabled=true;$('items').textContent='';show('Consultando…');
  try {
    const data=await call('/api/ia/reposicion',{method:'POST',body:JSON.stringify({horizon_days:Number($('horizon').value),lead_days:Number($('lead').value)})});
    show([data.modo==='prediccion'?'Análisis del microservicio (fecha de corte: '+data.fecha_corte+')':'Modo estático: IA no disponible',...(data.advertencias || [])].join('\n'));
    for(const r of data.items || []) {
      const tr=document.createElement('tr');
      for(const k of ['sku','producto','stock','transito','modelo','demanda_diaria','cobertura_dias','riesgo','cantidad_sugerida']) {const td=document.createElement('td');td.textContent=r[k]??'—';tr.append(td);}
      $('items').append(tr);
    }
  } catch(err){show(err.message);} finally {$('go').disabled=false;}
});
$('logout').addEventListener('click',async()=>{try{await call('/api/auth/logout',{method:'POST'});}catch(err){show(err.message);}finally{reset();}});
