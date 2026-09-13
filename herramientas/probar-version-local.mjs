import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { serie, escenasDeEpisodio, escenaDeGuion } from '../api/_lib/datos.js';
import { marcoDeEscena } from '../datos/continuidad.js';
import { revisarAdaptacionDeArchivo } from '../api/_lib/texto.js';
import { aplicarVersionLocal } from '../api/_lib/version-local.js';
import { claveDelMaterial } from '../app/planos.js';
import { contextoDeToma } from '../app/relato.js';
import { referenciaDeSecuencia, pasoDeEscena } from '../app/continuidad.js';
import { promptKeyframe } from '../api/_lib/prompt.js';

let total=0;
const prueba=(nombre,fn)=>{fn();total++;console.log('✓ '+nombre);};
const c=marcoDeEscena(1,escenasDeEpisodio(1),escenaDeGuion(1,'3'));
const original={id:'3-2',escena:'3',inicio:45,dur:4,dur_gen:4,recorte:[0,4],veo:'economico',
  escenario:'elserath-salon',luz:'NOBLE',refs:[],boca_visible:null,encadena_con:null,segmento:null,
  imagen:'',video:'',de_archivo:'arch-elserath-salon-b',continuidad:c};
const candidata={...original,de_archivo:null,historia:'Una lámpara encendida vista de cerca. Las sillas y los invitados quedan fuera de esta imagen.',
  imagen:'Extreme close detail of the lit oil lamp at the night dinner. Only the lamp fills the frame; no seats or gathering area are visible.',
  video:'The lamp flame flickers gently. Camera locked.',
  direccion:{visibles:[],fuera_de_campo:c.personajes,posiciones:'Only the lamp, no seats visible. The guests remain at dinner outside the crop.',
    miradas:'None.',camara:'Extreme close detail at table height.',estado_inicial:'Lit lamp at night.',estado_final:'Same lamp and crop.'}};
const revisar=p=>revisarAdaptacionDeArchivo(1,'3',original,{planos:[p]});
const nueva={...revisar(candidata).planos[0],revision_direccion:'local-prueba'};

prueba('Se adapta solo la lámpara, manteniendo escena, duración y corte',()=>assert.deepEqual(revisar(candidata).quejas,[]));
prueba('Se rechazan cambios de tiempos, IDs, segmento, escenario y luz',()=>{
  for (const cambio of [{dur:3},{id:'3-1'},{segmento:'otro'},{escenario:'cripta'},{luz:'CRIPTA'}]) assert.ok(revisar({...candidata,...cambio}).quejas.length);
});
prueba('La adaptación exige texto de la toma y material propio',()=>{
  assert.ok(revisar({...candidata,historia:''}).quejas.length);
  assert.ok(revisar({...candidata,de_archivo:original.de_archivo}).quejas.length);
  assert.ok(revisarAdaptacionDeArchivo(1,'3',original,{planos:[candidata,candidata]}).quejas.length);
});
prueba('No se permite introducir un personaje sin su referencia del banco',()=>{
  assert.ok(revisar({...candidata,direccion:{...candidata.direccion,visibles:['saharis'],fuera_de_campo:c.personajes.filter(p=>p!=='saharis')}}).quejas.length);
});

const estadoInicial=()=>({piezas:{ep01:{id:'ep01',tomas:[{...original,id:'3-1',de_archivo:null},structuredClone(original)],audio:{voz:['intacta']}},
  ep02:{id:'ep02',tomas:[{...original,id:'2-1'}]}},
  tomas:{'archivo/arch-elserath-salon-b':{keyframe_aprobado:'banco.png',clip_elegido:'banco.mp4',intentos_keyframe:['banco.png'],intentos_clip:['banco.mp4']}},
  banco:{saharis:{aprobada:'personaje.png'}},cola:[],montajes:[{id:'ep01/3',ruta:'montaje.mp4'},{id:'ep02/2',ruta:'otro.mp4'}]});
prueba('La versión propia no cambia el banco, otro capítulo ni el audio',()=>{
  const e=estadoInicial(),antes=structuredClone(e);
  aplicarVersionLocal(e,'ep01',original,nueva,{respaldo:'respaldo.json'});
  assert.equal(claveDelMaterial('ep01',e.piezas.ep01.tomas[1]),'ep01/3-2');
  assert.equal(claveDelMaterial('ep02',e.piezas.ep02.tomas[0]),'archivo/arch-elserath-salon-b');
  assert.deepEqual(e.tomas,antes.tomas);assert.deepEqual(e.banco,antes.banco);
  assert.deepEqual(e.piezas.ep02,antes.piezas.ep02);assert.deepEqual(e.piezas.ep01.audio,antes.piezas.ep01.audio);
  assert.equal(e.piezas.ep01.tomas[1].inicio,45);assert.equal(e.montajes[0].revision_pendiente,true);
  assert.deepEqual(e.montajes[1],antes.montajes[1]);
});
prueba('Las ediciones simultáneas y los trabajos activos detienen la sustitución',()=>{
  for (const cambiar of [e=>e.piezas.ep01.tomas[1].imagen='Edición nueva',e=>e.cola.push({tipo:'keyframe',estado:'pendiente',args:{pieza:'ep01',id:'3-2'}})]) {
    const e=estadoInicial();cambiar(e);const antes=structuredClone(e);
    assert.throws(()=>aplicarVersionLocal(e,'ep01',original,nueva),/cambió|Espera/);assert.deepEqual(e,antes);
  }
});
prueba('El detalle propio se aprueba en orden, pero no reemplaza la referencia de los personajes',()=>{
  const e=estadoInicial();aplicarVersionLocal(e,'ep01',original,nueva);
  const p=e.piezas.ep01;
  p.tomas.push({...original,id:'3-3',de_archivo:null});
  e.tomas['ep01/3-1']={keyframe_aprobado:'cena.png'};
  assert.ok(pasoDeEscena(p,p.tomas[2],e).bloqueo);
  e.tomas['ep01/3-2']={keyframe_aprobado:'lampara.png',revision_aprobada:'local-prueba'};
  assert.equal(pasoDeEscena(p,p.tomas[2],e).bloqueo,null);
  assert.equal(referenciaDeSecuencia(p,p.tomas[2],e).ruta,'cena.png');
});
prueba('La imagen recibe una instrucción de recorte, no permiso para vaciar asientos',()=>{
  const p={id:'ep01',tomas:[{...nueva,escena:'3'}]};
  const prompt=promptKeyframe('ep01','3-2',p).texto;
  assert.match(prompt,/OFF SCREEN MEANS OUTSIDE THE CROP/);
  assert.match(prompt,/Do not show their places empty/);
  assert.match(prompt,/Extreme close detail/);
});

const guiones=JSON.parse(readFileSync(new URL('../datos/guiones.json',import.meta.url)));
const relatos=JSON.parse(readFileSync(new URL('../datos/relatos-ep01.json',import.meta.url)));
prueba('Las siete descripciones de la cena distinguen las personas de los detalles',()=>{
  const p={id:'ep01',tomas:Object.entries(relatos).filter(([id])=>id.startsWith('3-')).map(([id,t])=>({...t,id,escena:'3'}))};
  const textos=p.tomas.map(t=>contextoDeToma(p,t,guiones,relatos).historia);
  assert.equal(textos.length,7);assert.match(textos[0],/veinte invitados/);
  assert.match(textos[1],/debe estar ocupada/);assert.match(textos[2],/no está solo/);
  assert.match(textos[6],/solo las manos/);assert.match(textos[6],/invitados quedan fuera/);
});
prueba('La misma opción de versión propia funciona en los doce capítulos',()=>{
  for(let ep=1;ep<=12;ep++) {
    const id=`ep${String(ep).padStart(2,'0')}`,e={piezas:{[id]:{tomas:[structuredClone(original)]}},tomas:{},cola:[]};
    aplicarVersionLocal(e,id,original,nueva);
    assert.equal(claveDelMaterial(id,e.piezas[id].tomas[0]),`${id}/3-2`);
  }
});
console.log(`${total} comprobaciones de versiones locales y lectura de tomas.`);
