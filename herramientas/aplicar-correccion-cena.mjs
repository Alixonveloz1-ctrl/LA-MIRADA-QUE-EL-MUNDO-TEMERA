// Aplicación puntual y revisable. --aplicar es necesario para escribir.
// Usa lectura fresca y condición de versión; nunca reintenta un conflicto.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { CORRECCION_CENA, MAESTRO_CENA, REVISION_CENA } from '../datos/correccion-cena-ep01.js';
import { conservaMontaje, marcarCambio } from '../app/continuidad.js';
import { revisarPlanosDeEscena } from '../api/_lib/texto.js';
import { promptKeyframe, comprobarCupos } from '../api/_lib/prompt.js';

const api='https://la-mirada-que-el-mundo-temera.vercel.app/api/g';
async function llamar(cuerpo) {
  const r=await fetch(api,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(cuerpo),signal:AbortSignal.timeout(60000)});
  if(!r.ok) throw new Error(`No se guardará de nuevo: respuesta ${r.status}.`);
  const d=await r.json(); if(!d.ok) throw new Error(d.mensaje || 'No se completó la operación.'); return d;
}
const snapshot=process.argv[2];
if(!snapshot || snapshot.startsWith('--')) throw new Error('Falta la lectura revisada del estado.');
const revisado=JSON.parse(readFileSync(snapshot)).estado;
const leido=await llamar({modo:'estado-leer'});
const e=structuredClone(leido.estado),p=e.piezas.ep01;
const originales=p.tomas.filter(t=>String(t.escena)==='3');
assert.deepEqual(originales,revisado.piezas.ep01.tomas.filter(t=>String(t.escena)==='3'),'El plan cambió desde la revisión; no se guarda.');
assert.equal(e.escenarios['elserath-salon'].aprobada,MAESTRO_CENA,'Cambió el maestro revisado.');
assert.equal(originales.length,7);
assert.ok(!(e.cola || []).some(j=>j.args?.pieza==='ep01' && ['pendiente','en_curso'].includes(j.estado)),'Hay trabajos activos en el episodio.');
const corregidas=originales.map(t=>({...t,...structuredClone(CORRECCION_CENA[t.id]),revision_direccion:REVISION_CENA}));
assert.ok(conservaMontaje(originales,corregidas));
const revision=revisarPlanosDeEscena(1,'3',{planos:corregidas});
assert.deepEqual(revision.quejas,[]);
const piezaNueva={...p,tomas:corregidas};
for(const t of corregidas) {
  const encargo=promptKeyframe('ep01',t.id,piezaNueva);
  for(const modelo of ['gemini-3-pro-image','gemini-3.1-flash-image']) comprobarCupos(encargo.referencias,modelo);
  for(const id of t.refs) assert.ok(e.banco[id]?.aprobada,`Falta la ficha aprobada: ${id}`);
  assert.equal(t.referencia_anterior,originales.find(a=>a.id===t.id).referencia_anterior);
}
p.tomas=p.tomas.map(t=>corregidas.find(n=>n.id===t.id) || t);
for(const antes of originales) {
  const material=e.tomas['ep01/'+antes.id];
  if(material) marcarCambio(material,antes,corregidas.find(t=>t.id===antes.id));
}
// Restaurar únicamente las diferencias previstas debe devolver TODO el estado
// original, incluidas imágenes, aprobaciones, banco, audio y otros capítulos.
const protegido=structuredClone(e);
protegido.piezas.ep01.tomas=leido.estado.piezas.ep01.tomas;
for(const t of originales) for(const campo of ['revision_pendiente','clip_revision_pendiente']) {
  const clave='ep01/'+t.id,antes=leido.estado.tomas[clave],despues=protegido.tomas[clave];
  if(!antes) continue;
  if(campo in antes) despues[campo]=antes[campo]; else delete despues[campo];
}
assert.deepEqual(protegido,leido.estado,'Hay cambios fuera del alcance.');
writeFileSync('/tmp/mirada-mesa-respaldo.json',JSON.stringify(leido));
writeFileSync('/tmp/mirada-mesa-propuesta.json',JSON.stringify(e));
console.log(JSON.stringify({preparado:true,tomas:corregidas.map(t=>({id:t.id,refs:t.refs})),imagenes_borradas:0,imagenes_generadas:0}));
if(process.argv.includes('--aplicar')) {
  const resultado=await llamar({modo:'estado-escribir',estado:e,generacion:leido.generacion});
  console.log(JSON.stringify({guardado:resultado.ok}));
  const despues=await llamar({modo:'estado-leer'});
  assert.deepEqual(despues.estado,e,'El guardado terminó, pero hubo cambios posteriores; no se vuelve a escribir.');
  console.log(JSON.stringify({verificado:true,material_y_aprobaciones_conservados:true}));
}
