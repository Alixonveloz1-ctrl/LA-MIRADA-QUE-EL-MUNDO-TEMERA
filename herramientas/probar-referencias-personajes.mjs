import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Buffer } from 'node:buffer';
import { serie, toma as tomaDeLaPieza, nivelImagen, escenasDeEpisodio, escenaDeGuion } from '../api/_lib/datos.js';
import { marcoDeEscena } from '../datos/continuidad.js';
import { ErrorDeCara } from '../api/_lib/errores.js';
import { exigirAprobada } from '../api/_lib/estado.js';
import { revisarPlanosDeEscena } from '../api/_lib/texto.js';
import { promptKeyframe, comprobarCupos } from '../api/_lib/prompt.js';
import { referenciaDeSecuencia, referenciasDeReparto, personajesSinReferencia, pasoDeEscena } from '../app/continuidad.js';

// Se ejecuta el recorrido real modos → prompt → lectura de referencias →
// imagen → cuerpo de Vertex. Solo se sustituyen almacenamiento y transporte.
globalThis.fetch=async()=>{throw new Error('Esta prueba no puede generar imágenes de pago.');};
let total=0;
function prueba(nombre,fn) { fn(); total++; console.log(`✓ ${nombre}`); }
const placas=serie.banco.placas;
function toma(ep,esc,id,visibles,refs=[]) {
  const s=escenaDeGuion(ep,esc),c=marcoDeEscena(ep,escenasDeEpisodio(ep),s);
  return {id,escena:esc,escenario:s.escenario,luz:s.luz,refs,continuidad:c,revision_direccion:'r1',
    dur:4,dur_gen:4,recorte:[0,4],veo:'economico',boca_visible:null,encadena_con:null,de_archivo:null,
    imagen:'The masked Celebrant securely holds the wrapped newborn; acolytes celebrate around them.',
    video:'The acolytes gently sway. Camera locked.',
    direccion:{visibles,fuera_de_campo:c.personajes.filter(p=>!visibles.includes(p)),
      posiciones:'Celebrant and newborn in the center; acolytes around them.',miradas:'Toward the newborn and one another.',
      camara:'Medium wide shot at eye level.',estado_inicial:'Same plain robes and leather mask.',estado_final:'A small natural movement.'}};
}
const culto=toma(1,'1','1-2',['madre','acolitos'],['madre-cripta']);
const bebe=toma(1,'1','1-7',['saharis'],['saharis-bebe-ancla']);
const actual=toma(1,'2','2-1',['celebrante','saharis','acolitos'],['celebrante-mascara','saharis-bebe-ancla']);
const pieza={id:'ep01',tomas:[culto,bebe,actual]};
const aprobada=ruta=>({keyframe_aprobado:ruta,intentos_keyframe:[ruta],revision_aprobada:'r1'});
const estado={piezas:{ep01:pieza},tomas:{'ep01/1-2':aprobada('culto.png'),'ep01/1-7':aprobada('bebe.png')},
  escenarios:{cripta:{aprobada:'cripta.png'}},banco:{'celebrante-mascara':{aprobada:'mascara.png'},'saharis-bebe-ancla':{aprobada:'ancla-bebe.png'}}};
const componer=(t=actual,e=estado,p=pieza)=>promptKeyframe(p.id,t.id,{...p,tomas:p.tomas.map(a=>a.id===t.id?t:a)},
  referenciaDeSecuencia(p,t,e),referenciasDeReparto(p,t,e,placas));
prueba('La toma lleva las fichas del Celebrante y bebé además de la cripta, el bebé anterior y los acólitos',()=>{
  const r=componer().referencias;
  assert.deepEqual(r.map(r=>r.placa||r.escenario||r.continuidad),['cripta','celebrante-mascara','saharis-bebe-ancla','bebe.png','culto.png']);
  assert.deepEqual(r.find(r=>r.uso==='reparto').reparto,['acolitos']);
  for (const modelo of ['gemini-3-pro-image','gemini-3.1-flash-image']) assert.equal(comprobarCupos(r,modelo).total,5);
});
prueba('Apagar las imágenes anteriores conserva todas las fichas del banco',()=>{
  assert.deepEqual(componer({...actual,referencia_anterior:false}).referencias.map(r=>r.placa||r.escenario),
    ['cripta','celebrante-mascara','saharis-bebe-ancla']);
});
prueba('La máscara y ropa del banco prevalecen; el reparto fuera de campo permanece fuera',()=>{
  const k=componer();
  assert.match(k.texto,/FRAME CAST IS EXCLUSIVE/);
  assert.match(k.texto,/mask shape and accessories/);
  for (const r of k.referencias.filter(r=>r.placa)) {
    assert.match(r.instruccion,/approved CHARACTER BANK.*clothing design, mask design/);
    assert.doesNotMatch(r.instruccion,/not the reference costume/);
  }
  assert.match(k.referencias.find(r=>r.uso==='reparto').instruccion,/Ignore every other person/);
});
prueba('No se inventa un bebé adulto ni se confunde la acólita con el grupo sin ficha',()=>{
  assert.deepEqual(personajesSinReferencia({...actual,refs:[]},placas),['celebrante','saharis']);
  assert.deepEqual(personajesSinReferencia(actual,placas),[]);
  assert.throws(()=>promptKeyframe('ep01','2-1',{...pieza,tomas:[{...actual,refs:['celebrante-mascara']}]}),/saharis/);
  const r=revisarPlanosDeEscena(1,'2',{planos:[{...actual,refs:[]}]});
  assert.ok(r.quejas.some(q=>q.regla==='continuidad-de-la-direccion' && /referencia.*celebrante/.test(q.queja)));
  assert.ok(r.quejas.some(q=>/referencia.*saharis/.test(q.queja)));
  assert.deepEqual(revisarPlanosDeEscena(1,'2',{planos:[actual]}).quejas,[]);
});
prueba('Un primer plano sin esos acompañantes no les presta otra apariencia',()=>{
  const sinGrupo={...actual,direccion:{...actual.direccion,visibles:['saharis']}};
  assert.deepEqual(referenciasDeReparto(pieza,sinGrupo,estado,placas),[]);
  const pendiente=structuredClone(estado);
  pendiente.tomas['ep01/1-2'].intentos_keyframe.push('culto-nuevo-sin-aprobar.png');
  assert.deepEqual(referenciasDeReparto(pieza,actual,pendiente,placas),[]);
  pendiente.tomas['ep01/1-2']=aprobada('culto.png');
  pendiente.cola=[{tipo:'keyframe',estado:'en_curso',args:{pieza:'ep01',id:'1-2'}}];
  assert.deepEqual(referenciasDeReparto(pieza,actual,pendiente,placas),[]);
});
prueba('Una imagen compartida por espacio y acompañantes viaja una sola vez con ambos cometidos',()=>{
  const p={...pieza,tomas:[culto,actual]},e={...estado,piezas:{ep01:p}};
  const r=componer(actual,e,p).referencias;
  assert.equal(r.filter(r=>r.continuidad==='culto.png').length,1);
  assert.match(r.at(-1).instruccion,/SEQUENCE REFERENCE.*BACKGROUND CAST APPEARANCE ONLY/);
});
prueba('La búsqueda de acompañantes funciona en los doce capítulos y respeta cambios de lugar o tiempo',()=>{
  const pares=[[1,'1','2'],[2,'23','24'],[3,'23','24'],[4,'7','8'],[5,'21','22'],[6,'22','23'],
    [7,'10','11'],[8,'6','7'],[9,'22','23'],[10,'18','19'],[11,'17','18'],[12,'20','21']];
  for (const [ep,a,b] of pares) {
    const t1=toma(ep,a,`${a}-1`,['grupo-sin-ficha']),t2=toma(ep,b,`${b}-1`,['grupo-sin-ficha']);
    const id=`ep${String(ep).padStart(2,'0')}`,p={id,tomas:[t1,t2]},e={tomas:{[`${id}/${t1.id}`]:aprobada('grupo.png')}};
    assert.equal(referenciasDeReparto(p,t2,e,placas)[0]?.ruta,'grupo.png',`${ep}: ${a}→${b}`);
    assert.deepEqual(referenciasDeReparto(p,{...t2,escenario:'otro-lugar'},e,placas),[]);
  }
  for (const esc of ['3','15']) {
    const t=toma(1,esc,`${esc}-1`,['acolitos']),p={id:'ep01',tomas:[culto,t]};
    assert.deepEqual(referenciasDeReparto(p,t,estado,placas),[]);
  }
});
prueba('Los acompañantes pueden continuar entre capítulos sin tomar una imagen futura',()=>{
  const a=toma(1,'24','24-1',['grupo-sin-ficha']),b=toma(2,'1','1-1',['grupo-sin-ficha']);
  const pa={id:'ep01',tomas:[a]},pb={id:'ep02',tomas:[b]};
  const e={piezas:{ep01:pa,ep02:pb},tomas:{'ep01/24-1':aprobada('fin-ep01.png'),'ep02/1-1':aprobada('futuro.png')}};
  assert.equal(referenciasDeReparto(pb,b,e,placas)[0]?.ruta,'fin-ep01.png');
  assert.deepEqual(referenciasDeReparto(pa,a,e,placas),[]);
});

function cargar(ruta,stubs,salida) {
  const fuente=readFileSync(new URL(ruta,import.meta.url),'utf8')
    .replace(/^import\s*\{([^}]+)\}\s*from\s*['"][^'"]+['"];\s*$/gm,(_,nombres)=>
      `const { ${nombres.split(',').map(n=>n.trim().split(/\s+as\s+/).at(-1)).join(',')} } = __stubs;`)
    .replace(/^export /gm,'');
  return new Function('__stubs',`${fuente}\nreturn ${salida};`)(stubs);
}
let servidor=structuredClone(estado),envios=[],escritos=new Map(),leidos=[];
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jGqkAAAAASUVORK5CYII=','base64');
const bytesDe=ruta=>Buffer.concat([png,Buffer.from(ruta)]);
const generarImagen=cargar('../api/_lib/imagen.js',{
  Buffer,ErrorDeCara,serie,nivelImagen,entorno:()=>({sa:{project_id:'prueba-sin-red'}}),
  conGrafias:(modelo,fn)=>fn(modelo.id),comoGrafia:(modelo,id)=>({...modelo,id}),urlModelo:()=>'/vertex-simulado',
  llamar:async(url,cuerpo)=>{
    envios.push(cuerpo);
    assert.ok(escritos.has('keyframes/ep01/2-1/1.encargo.json'),'Se guarda el encargo antes de generar.');
    return {candidates:[{content:{parts:[{inlineData:{mimeType:'image/png',data:png.toString('base64')}}]}}]};
  }
},'generar');
const modos=cargar('../api/_lib/modos.js',{
  Buffer,ErrorDeCara,serie,tomaDeLaPieza,nivelImagen,promptKeyframe,comprobarCupos,exigirAprobada,
  referenciaDeSecuencia,referenciasDeReparto,pasoDeEscena,generarImagen,
  leerElEstado:async()=>({estado:structuredClone(servidor),generacion:'1'}),
  escribirElEstado:async e=>{servidor=structuredClone(e);return {generacion:'2'};},
  leerBytes:async ruta=>{leidos.push(ruta);return {datos:bytesDe(ruta)};},
  listarElBucket:async()=>[],
  escribirEnElBucket:async(ruta,datos)=>{escritos.set(ruta,datos);return {ruta,bytes:datos.length};},
  firmarRutas:async rutas=>Object.fromEntries(rutas.map(r=>[r,`https://prueba.invalid/${r}`]))
},'MODOS');
const respuesta=await modos.imagen({tipo:'keyframe',pieza:'ep01',id:'2-1'});
prueba('El cuerpo que sale a Vertex contiene los bytes aprobados de las cinco referencias, cada uno con su instrucción',()=>{
  assert.equal(envios.length,1);
  const log=JSON.parse(escritos.get('keyframes/ep01/2-1/1.encargo.json'));
  assert.deepEqual(log.referencias.map(r=>r.ruta),['cripta.png','mascara.png','ancla-bebe.png','bebe.png','culto.png']);
  const partes=envios[0].contents[0].parts;
  assert.equal(partes.length,11);
  for (const [i,ref] of log.referencias.entries()) {
    assert.equal(partes[2*i].inlineData.data,bytesDe(ref.ruta).toString('base64'));
    assert.equal(partes[2*i+1].text,ref.instruccion);
  }
  const material=servidor.tomas['ep01/2-1'];
  assert.equal(material.revision_pendiente,true);
  assert.equal(material.keyframe_aprobado,null);
  assert.deepEqual(material.origenes_keyframe[respuesta.ruta].referencias_banco.map(r=>r.placa),actual.refs);
  assert.equal(material.origenes_keyframe[respuesta.ruta].referencia_anterior,'bebe.png');
  assert.deepEqual(material.origenes_keyframe[respuesta.ruta].referencias_reparto,[{personajes:['acolitos'],ruta:'culto.png'}]);
});
servidor=structuredClone(estado);delete servidor.banco['celebrante-mascara'].aprobada;
envios=[];leidos=[];
await assert.rejects(()=>modos.imagen({tipo:'keyframe',pieza:'ep01',id:'2-1'}),/aprobad/);
prueba('Una ficha sin aprobar impide enviar una petición pagada incompleta',()=>{
  assert.equal(envios.length,0);assert.equal(leidos.length,0);
});
console.log(`\n${total} pruebas de referencias de personajes superadas.`);
