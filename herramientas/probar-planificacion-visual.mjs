import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Buffer } from 'node:buffer';
import { serie, guiones, escenaDeGuion, escenasDeEpisodio } from '../api/_lib/datos.js';
import { marcoDeEscena } from '../datos/continuidad.js';
import { segmentosDeEscena } from '../datos/segmentos.js';
import { escenariosParaPlanificar, partesConEscenarios } from '../api/_lib/planificacion-visual.js';
import { personajesOmitidosEnGeneral } from '../app/continuidad.js';
import { promptKeyframe, comprobarCupos } from '../api/_lib/prompt.js';
import { revisarPlanosDeEscena } from '../api/_lib/texto.js';
import { ErrorDeCara } from '../api/_lib/errores.js';

globalThis.fetch=async()=>{throw new Error('Las pruebas no pueden generar imágenes de pago.');};
let total=0;
const prueba=(nombre,fn)=>{fn();total++;console.log('✓ '+nombre);};
const c=marcoDeEscena(1,escenasDeEpisodio(1),escenaDeGuion(1,'3'));
const general={id:'3-1',escena:'3',dur:4,dur_gen:4,recorte:[0,4],veo:'economico',luz:'NOBLE',
  escenario:'elserath-salon',refs:[],de_archivo:null,boca_visible:null,encadena_con:null,continuidad:c,
  imagen:'Wide shot of the occupied long table.',video:'The guests talk quietly. Camera locked.',
  direccion:{presentes:c.personajes,visibles:['invitados','criados'],fuera_de_campo:['saharis','iven','rothar','livia','invitada'],
    posiciones:'Guests along one long table.',miradas:'Toward their partners.',camara:'Wide shot, locked on the length of the table.',
    estado_inicial:'Everyone seated.',estado_final:'Same seats.'}};
prueba('Un general que excluye a los cuatro personajes presentes falla antes de gastar',()=>{
  assert.deepEqual(personajesOmitidosEnGeneral(general,serie.banco.placas),['saharis','iven','rothar','livia']);
  assert.throws(()=>promptKeyframe('ep01','3-1',{id:'ep01',tomas:[general]}),/plano general/);
  assert.ok(revisarPlanosDeEscena(1,'3',{planos:[general]}).quejas.some(q=>/general.*omite/.test(q.queja)));
});
const corregido={...general,refs:['saharis-noble','iven-noble','rothar-noble','livia-noble'],
  direccion:{...general.direccion,visibles:c.personajes,fuera_de_campo:[]}};
prueba('El general no adelanta la entrada de un personaje que llegará después',()=>{
  const antesDeEntrar={...general,direccion:{...general.direccion,presentes:['invitados','criados']}};
  assert.deepEqual(personajesOmitidosEnGeneral(antesDeEntrar,serie.banco.placas),[]);
});
prueba('El general completo envía el mismo comedor y las cuatro fichas incluso con el interruptor apagado',()=>{
  const p=promptKeyframe('ep01','3-1',{id:'ep01',tomas:[{...corregido,referencia_anterior:false}]});
  assert.deepEqual(p.referencias.map(r=>r.escenario || r.placa),['elserath-salon',...corregido.refs]);
  for (const m of ['gemini-3-pro-image','gemini-3.1-flash-image']) assert.equal(comprobarCupos(p.referencias,m).total,5);
  assert.match(p.referencias[0].instruccion,/SET GEOMETRY IS LOCKED/);
  assert.doesNotMatch(p.referencias[0].instruccion,/Do NOT copy.*scale/);
});
prueba('Los acercamientos no arrastran a todo el reparto dentro de la imagen',()=>{
  const t={...general,refs:['saharis-noble'],direccion:{...general.direccion,visibles:['saharis'],fuera_de_campo:c.personajes.filter(p=>p!=='saharis'),camara:'Close-up of Saharis.'}};
  assert.deepEqual(personajesOmitidosEnGeneral(t,serie.banco.placas),[]);
  assert.deepEqual(promptKeyframe('ep01',t.id,{id:'ep01',tomas:[t]}).referencias.map(r=>r.escenario || r.placa),['elserath-salon','saharis-noble']);
});
prueba('Las 289 escenas solo seleccionan sus escenarios aprobados, incluidos los segmentos separados',()=>{
  for(const ep of guiones.guiones) for(const s of ep.escenas) {
    const segmentos=segmentosDeEscena(ep.episodio,s.escena);
    const ids=[...new Set(segmentos.length?segmentos.map(s=>s.escenario):[s.escenario])];
    const e={escenarios:Object.fromEntries([...ids,'escenario-ajeno'].map(id=>[id,{aprobada:id+'.png',intentos:[id+'-pendiente.png']}]))};
    assert.deepEqual(escenariosParaPlanificar(e,ep.episodio,s.escena),ids.map(id=>({escenario:id,ruta:id+'.png'})));
  }
  assert.deepEqual(escenariosParaPlanificar({escenarios:{'elserath-salon':{intentos:['sin-aprobar.png']}}},1,'3'),[]);
});
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jGqkAAAAASUVORK5CYII=','base64');
prueba('El director recibe los bytes del escenario y una instrucción de inspeccionarlo, sin alterar llamadas de solo texto',()=>{
  const partes=partesConEscenarios('Preparar la lámpara',[{escenario:'elserath-salon',datos:png}]);
  assert.equal(partes[1].inlineData.data,png.toString('base64'));
  assert.equal(partes[1].inlineData.mimeType,'image/png');
  assert.match(partes[0].text,/hanging lamp remains hanging/);
  assert.deepEqual(partesConEscenarios('Traducir'),[{text:'Traducir'}]);
  assert.throws(()=>partesConEscenarios('x',[{escenario:'cripta',datos:Buffer.from('no es imagen')}]),/imagen compatible/);
});

// Ejecución del transporte real del modelo de texto; solo se simula Vertex.
let enviados=[];
const stubs={ErrorDeCara,Buffer,serie,partesConEscenarios,
  entorno:()=>({sa:{project_id:'sin-red'},modelos:{texto:{id:'modelo-prueba'}}}),
  conGrafias:(m,fn)=>fn(m.id),comoGrafia:(m,id)=>({...m,id}),urlModelo:()=>'/vertex-simulado',
  llamar:async(url,cuerpo)=>{enviados.push(cuerpo);return {candidates:[{content:{parts:[{text:'{"planos":[]}'}]}}]};}};
const fuente=readFileSync(new URL('../api/_lib/texto.js',import.meta.url),'utf8')
  .replace(/^import\s*\{([^}]+)\}\s*from\s*['"][^'"]+['"];\s*$/gm,(_,n)=>`const { ${n.split(',').map(n=>n.trim().replace(/\s+as\s+/,': ')).join(',')} }=__stubs;`)
  .replace(/^export /gm,'');
const generar=new Function('__stubs',fuente+'\nreturn generar;')(stubs);
await generar('Planear',{json:true,referenciasVisuales:[{escenario:'elserath-salon',datos:png}]});
prueba('La petición enviada al modelo de planificación contiene la imagen aprobada',()=>{
  assert.equal(enviados.length,1);
  assert.equal(enviados[0].contents[0].parts[1].inlineData.data,png.toString('base64'));
  assert.equal(enviados[0].generationConfig.responseMimeType,'application/json');
});
console.log(`${total} comprobaciones de planificación visual y reparto.`);
