import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { serie, guiones, toma as tomaDeLaPieza, escenaDeGuion, escenasDeEpisodio, personajesDeEscena } from '../api/_lib/datos.js';
import { ErrorDeCara } from '../api/_lib/errores.js';
import { exigirAprobada } from '../api/_lib/estado.js';
import { marcoDeEscena, prepararGuiones } from '../datos/continuidad.js';
import { segmentosDeEscena } from '../datos/segmentos.js';
import { promptKeyframe, promptVideo, comprobarCupos } from '../api/_lib/prompt.js';
import { revisarPlanosDeEscena, conservaDuracionDeEscena } from '../api/_lib/texto.js';
import { aplicarCorreccion } from '../api/_lib/continuidad.js';
import { materialVigente, necesitaDireccion, conservaMontaje, invalidarMontajes, referenciaDeSecuencia, marcarCambio } from '../app/continuidad.js';
import { claveDelMaterial, esDeArchivo, porQueNoSeGenera } from '../app/planos.js';

// Ninguna prueba de continuidad puede disparar una generación de pago.
globalThis.fetch = async () => { throw new Error('La prueba intentó usar la red.'); };
let total=0;
function prueba(nombre, fn) { fn(); total++; console.log(`✓ ${nombre}`); }
const marco=(ep,esc)=>marcoDeEscena(ep,escenasDeEpisodio(ep),escenaDeGuion(ep,esc));
function plano(ep,esc) {
  const s=escenaDeGuion(ep,esc), c=marco(ep,esc);
  return {id:`${esc}-1`,escena:String(esc),imagen:'Saharis studies the room.',video:'Saharis slowly turns his head toward the table.',
    dur:3,dur_gen:4,recorte:[0,3],veo:'medio',luz:s.luz,escenario:s.escenario,
    refs:[],boca_visible:null,encadena_con:null,de_archivo:null,continuidad:c,
    direccion:{visibles:['saharis'],fuera_de_campo:s.personajes.filter(p=>p!=='saharis'),
      posiciones:'Saharis beside the table; established guests occupy their seats outside this close-up.',
      miradas:'Toward the table and the partner, not toward the viewer.',camara:'Three-quarter view at seated eye height.',
      estado_inicial:'Seated, same coat and cup.',estado_final:'Only a small head turn.'}};
}
prueba('Las 289 acciones, diálogos y marcas de pasado se conservan al aplicar el contexto',()=>{
  const raw=JSON.parse(readFileSync(new URL('../datos/guiones.json',import.meta.url),'utf8'));
  const antes=JSON.stringify(raw), ajustado=prepararGuiones(raw);
  assert.equal(JSON.stringify(raw),antes);
  assert.equal(ajustado.guiones[0].escenas[0].accion,raw.guiones[0].escenas[0].accion);
  for (let e=0;e<raw.guiones.length;e++) for (let s=0;s<raw.guiones[e].escenas.length;s++) {
    for (const campo of ['accion','dialogo','flashback','momento']) {
      assert.deepEqual(ajustado.guiones[e].escenas[s][campo],raw.guiones[e].escenas[s][campo]);
    }
  }
  assert.deepEqual(prepararGuiones(ajustado),ajustado);
});
prueba('Las aclaraciones del autor prevalecen en presente, recuerdos y canción',()=>{
  assert.match(marco(1,'1').reglas,/mother's death is shown here/);
  assert.doesNotMatch(marco(1,'1').reglas,/decision is unresolved/);
  assert.match(marco(1,'3').reglas,/This scene is PRESENT.*sixteen-year-old/);
  assert.match(marco(12,'1').reglas,/This scene is PRESENT.*sixteen-year-old/);
  assert.doesNotMatch(marco(12,'1').resumen,/is eighteen/);
  for (const [ep,s] of [[1,'17'],[2,'14'],[4,'6'],[8,'5'],[12,'18']]) assert.match(marco(ep,s).reglas,/This scene is PAST/);
  for (const [ep,s] of [[2,'14'],[10,'16b'],[12,'20'],[12,'21']]) assert.match(marco(ep,s).reglas,/never heard it complete/);
  assert.match(marco(10,'16b').reglas,/INTERCUT.*do not share a room or a time/);
});
prueba('El canon dirige la imagen y Veo recibe solo movimiento y conservación del fotograma',()=>{
  const t=plano(1,'3'),pieza={id:'ep01',tomas:[t]};
  for (const p of [promptKeyframe('ep01',t.id,pieza)]) {
    assert.match(p.texto,/AUTHOR-CONFIRMED NARRATIVE/);
    assert.match(p.texto,/sixteen-year-old design/);
    assert.match(p.texto,/Episode order is presentation order/);
  }
  const v=promptVideo('ep01',t.id,pieza).texto;
  assert.match(v,/Single continuous shot from the supplied first frame/);
  assert.match(v,/Only the described motion changes/);
  assert.doesNotMatch(v,/AUTHOR-CONFIRMED NARRATIVE|mother's death|lullaby/);
});
prueba('Las 289 escenas resuelven su contexto sin perder el flashback 16b',()=>{
  let escenas=0;
  for (const ep of guiones.guiones) for (const s of ep.escenas) { const c=marco(ep.episodio,s.escena);assert.ok(c.luz);escenas++; }
  assert.equal(escenas,289);
});
prueba('El capítulo 1 conserva población y protagonista aunque no hablen',()=>{
  for (const id of ['3','4','5','6','7','8']) assert.ok(personajesDeEscena(1,id).includes('invitados'));
  assert.deepEqual(personajesDeEscena(1,'14'),['saharis']);
  assert.ok(personajesDeEscena(1,'17').includes('saharis'));
});
prueba('Se corrigen Eira, cautiva, Celebrante y madre mencionada',()=>{
  assert.ok(personajesDeEscena(5,'9').includes('eira'));
  assert.ok(!personajesDeEscena(5,'9').includes('madre'));
  assert.ok(personajesDeEscena(7,'22').includes('cautiva'));
  assert.ok(!personajesDeEscena(2,'16').includes('madre'));
  assert.ok(personajesDeEscena(11,'21').includes('celebrante'));
});
prueba('Kadre, jardín Vharn y la puerta entre capítulos apuntan al lugar correcto',()=>{
  for (const e of ['9','10','11','12','13','14','21']) assert.equal(escenaDeGuion(10,e).escenario,'casa-ilmen');
  assert.equal(escenaDeGuion(4,'13').escenario,'vharn-jardin');
  assert.equal(escenaDeGuion(2,'1').escenario,escenaDeGuion(1,'24').escenario);
});
prueba('Goteo, nieve exterior y nieve relatada son fenómenos distintos',()=>{
  assert.equal(marco(1,'16').goteo,true);assert.equal(marco(1,'16').precipitacion,'ninguna');
  assert.equal(marco(1,'13').interior,true);assert.equal(marco(1,'6').precipitacion,'ninguna');
  assert.equal(marco(10,'3').precipitacion,'nieve');
  assert.equal(marco(10,'5').interior,true);assert.equal(marco(10,'5').precipitacion,'ninguna');
  assert.equal(marco(1,'4').momento,'NOCHE');
});
prueba('Volver del flashback retoma el refugio y permite movimientos escritos',()=>{
  assert.match(marco(1,'16').reglas,/RETURN.*13-14/);
  assert.match(marco(1,'8').reglas,/SAHARIS pours wine INTO THE GUEST/);
  assert.match(marco(1,'5').reglas,/moved beside a window/);
  assert.match(marco(1,'24').reglas,/does NOT enter/);
});
prueba('El prompt final del interior ya no pide lluvia ni apagar el farol',()=>{
  const t=plano(1,'13'),p={id:'ep01',tomas:[t]};
  const k=promptKeyframe(p.id,t.id,p),v=promptVideo(p.id,t.id,p);
  for (const texto of [k.texto,v.texto]) assert.doesNotMatch(texto,/rain haze|no warm source/);
  assert.match(k.texto,/warm lantern/);assert.match(v.texto,/Preserve its.*lighting/);
  assert.match(v.texto,/supplied first frame/);
  assert.match(k.referencias[0].instruccion,/background population/);
  assert.doesNotMatch(k.referencias[0].instruccion,/and nobody else/);
});
prueba('La galería y el archivo se conservan',()=>{
  assert.equal(serie.banco.placas.length,73);assert.equal(serie.escenarios.placas.length,28);
  assert.equal(serie.piezas.archivo.tomas.length,56);
});
prueba('Una sala ocupada no reutiliza un general vacío; sí admite un detalle',()=>{
  const base={...plano(1,'4'),imagen:'',video:'',refs:[],direccion:null,dur:4,dur_gen:4,recorte:[0,4],veo:'economico'};
  const general=serie.piezas.archivo.tomas.find(t=>t.escenario===base.escenario && /Wide establishing/.test(t.imagen));
  const detalle=serie.piezas.archivo.tomas.find(t=>t.escenario===base.escenario && /Close detail/.test(t.imagen));
  assert.ok(general);assert.ok(detalle);
  assert.ok(revisarPlanosDeEscena(1,'4',{planos:[{...base,de_archivo:general.id}]}).quejas.some(q=>q.regla==='el-archivo-se-usa-como-puntero'));
  assert.deepEqual(revisarPlanosDeEscena(1,'4',{planos:[{...base,de_archivo:detalle.id}]}).quejas,[]);
});
prueba('El archivo lluvioso no introduce lluvia en el mercado seco',()=>{
  const base={...plano(1,'19'),imagen:'',video:'',refs:[],direccion:null,dur:4,dur_gen:4,recorte:[0,4],veo:'economico',de_archivo:'arch-barrio-humo-b'};
  assert.equal(base.escenario,'barrio-humo');
  assert.ok(revisarPlanosDeEscena(1,'19',{planos:[base]}).quejas.some(q=>q.regla==='el-archivo-se-usa-como-puntero'));
});
prueba('Se adjunta la imagen aprobada anterior compatible junto al banco y escenario',()=>{
  const a={...plano(1,'3'),revision_direccion:'r3'},b={...plano(1,'4'),revision_direccion:'r4'},c=plano(1,'5');
  c.refs=['saharis-ancla'];
  const pieza={id:'ep01',tomas:[a,b,c]}, estado={tomas:{
    'ep01/3-1':{keyframe_aprobado:'3.png',revision_aprobada:'r3'},
    'ep01/4-1':{keyframe_aprobado:'4.png',revision_aprobada:'r4'}
  }};
  const ref=referenciaDeSecuencia(pieza,c,estado);
  assert.deepEqual(ref,{id:'4-1',ruta:'4.png'});
  const encargo=promptKeyframe(pieza.id,c.id,pieza,ref);
  assert.deepEqual(encargo.referencias.map(r=>r.escenario||r.placa||r.continuidad),[c.escenario,'saharis-ancla','4.png']);
  assert.equal(comprobarCupos(encargo.referencias,serie.modelos.imagen.calidad.id).total,3);
  estado.tomas['ep01/4-1'].revision_pendiente=true;
  assert.equal(referenciaDeSecuencia(pieza,c,estado).ruta,'3.png');
  estado.tomas['ep01/3-1'].revision_aprobada='vieja';
  assert.equal(referenciaDeSecuencia(pieza,c,estado),null);
});
prueba('Una referencia no cruza flashbacks ni toma una imagen futura',()=>{
  const a=plano(1,'14'),b=plano(1,'15'),c=plano(1,'16');
  const pieza={id:'ep01',tomas:[a,b,c]},estado={tomas:{'ep01/16-1':{keyframe_aprobado:'futura.png'}}};
  assert.equal(referenciaDeSecuencia(pieza,a,estado),null);
  estado.tomas['ep01/14-1']={keyframe_aprobado:'refugio.png'};
  assert.equal(referenciaDeSecuencia(pieza,b,estado),null);
  assert.equal(referenciaDeSecuencia(pieza,c,estado).ruta,'refugio.png');
  delete a.continuidad;
  assert.equal(referenciaDeSecuencia(pieza,c,estado),null);
});
prueba('No se genera silenciosamente contra el viejo desglose',()=>{
  const t=plano(1,'13');delete t.continuidad;
  assert.equal(necesitaDireccion({id:'ep01'},t),true);
  assert.throws(()=>promptKeyframe('ep01',t.id,{id:'ep01',tomas:[t]}),/actualizar su continuidad/);
});
prueba('El validador acepta un primer plano con invitados fuera de campo',()=>{
  const t=plano(1,'4');
  assert.deepEqual(revisarPlanosDeEscena(1,'4',{planos:[t]}).quejas,[]);
});
prueba('El validador rechaza invitados desaparecidos y mirada al espectador',()=>{
  const t=plano(1,'4');t.direccion.fuera_de_campo=[];t.imagen='Saharis looking warmly towards the camera.';
  const q=revisarPlanosDeEscena(1,'4',{planos:[t]}).quejas.map(e=>e.queja).join(' ');
  assert.match(q,/invitados/);assert.match(q,/espectador/);
});
prueba('El validador rechaza lluvia interior y la referencia de una madre ausente',()=>{
  const t=plano(1,'13');t.video='Rainfall fills the room.';
  assert.match(JSON.stringify(revisarPlanosDeEscena(1,'13',{planos:[t]}).quejas),/lluvia/);
  const e=plano(5,'9');e.refs=['madre-ancla'];
  assert.ok(revisarPlanosDeEscena(5,'9',{planos:[e]}).quejas.some(q=>q.regla==='las-refs-son-de-personajes-de-esta-escena'));
});
prueba('La reparación no admite cambiar IDs, orden, duración, recorte o boca',()=>{
  const a=[plano(1,'4')];assert.equal(conservaMontaje(a,[{...a[0],imagen:'Corrected blocking.'}]),true);
  for (const c of [{id:'4-2'},{dur:4},{recorte:[1,3]},{boca_visible:'rothar'}]) assert.equal(conservaMontaje(a,[{...a[0],...c}]),false);
  assert.equal(conservaMontaje(a,[]),false);
});
const inicial=()=>{const t=plano(1,'4');delete t.continuidad;return {
  piezas:{ep01:{id:'ep01',episodio:1,sello:'original',audio:{voz:[{es:'Rothar tiene razón.',t:2}]},tomas:[{...t,inicio:12}]}},
  tomas:{'ep01/4-1':{keyframe_aprobado:'old.png',intentos_keyframe:['old.png'],clip_elegido:'old.mp4',intentos_clip:['old.mp4']}},
  desglose:{'1/4':{ruta:'old.json',cuando:'fecha-original',planos:1}},montajes:[{id:'ep01/esc-4',ruta:'montado.mp4'}]};};
prueba('La migración conserva material, voz y tiempos; marca revisión sin borrar',()=>{
  const estado=inicial(),voz=JSON.stringify(estado.piezas.ep01.audio),antes=structuredClone(estado.piezas.ep01.tomas);
  aplicarCorreccion(estado,'ep01','4',antes,[plano(1,'4')],{revision:'nueva',respaldo:'backup.json',ruta:'new.json'});
  assert.equal(JSON.stringify(estado.piezas.ep01.audio),voz);assert.equal(estado.piezas.ep01.tomas[0].inicio,12);
  assert.equal(estado.desglose['1/4'].cuando,'fecha-original');assert.equal(estado.desglose['1/4'].ruta,'new.json');
  const e=estado.tomas['ep01/4-1'];assert.equal(e.keyframe_aprobado,'old.png');assert.deepEqual(e.intentos_clip,['old.mp4']);
  assert.equal(materialVigente(e,'keyframe'),false);assert.equal(materialVigente(e,'clip'),false);
  assert.equal(estado.montajes[0].revision_pendiente,true);
});
prueba('Una edición concurrente detiene la migración sin tocar el estado nuevo',()=>{
  const estado=inicial(),antes=structuredClone(estado.piezas.ep01.tomas);estado.piezas.ep01.tomas[0].imagen='User edit';
  const intacto=JSON.stringify(estado);
  assert.throws(()=>aplicarCorreccion(estado,'ep01','4',antes,[plano(1,'4')],{}),/cambió durante/);
  assert.equal(JSON.stringify(estado),intacto);
});
const planosSegmentados=(ep,esc)=>segmentosDeEscena(ep,esc).map((s,i)=>({
  ...plano(ep,esc),id:`${esc}-${i+1}`,segmento:s.id,escenario:s.escenario,luz:s.luz,
  imagen:s.accion,video:'The visible person makes a small natural movement. Camera locked.',
  direccion:{...plano(ep,esc).direccion,visibles:s.personajes,fuera_de_campo:[],
    posiciones:'Keep the visible people in their established positions.',miradas:'Eyes toward the partner or the task.'}
}));
prueba('Las cuatro escenas mixtas cubren todos sus segmentos sin unir espacios',()=>{
  for (const [ep,esc] of [[6,'3'],[8,'8'],[10,'16b'],[12,'6']]) {
    const r=revisarPlanosDeEscena(ep,esc,{planos:planosSegmentados(ep,esc)});
    assert.deepEqual(r.quejas,[],`${ep}/${esc}: ${JSON.stringify(r.quejas)}`);
    assert.ok(r.planos.every(p=>p.segmento && p.continuidad.subespacio));
  }
});
prueba('La madre y la niña conservan reparto, espacio y edad separados en 10/16b',()=>{
  const r=revisarPlanosDeEscena(10,'16b',{planos:planosSegmentados(10,'16b')});
  assert.deepEqual(r.planos.map(p=>p.escenario),['cripta-celda','casa-ilmen','cripta-celda','casa-ilmen']);
  assert.deepEqual(r.planos[0].continuidad.personajes,['madre']);
  assert.ok(!r.planos[1].continuidad.personajes.includes('madre'));
  assert.match(r.planos[0].continuidad.reglas,/This scene is PAST/);
  assert.match(r.planos[1].continuidad.reglas,/This scene is PRESENT/);
  assert.equal(r.planos[0].continuidad.secuencia,r.planos[2].continuidad.secuencia);
  assert.notEqual(r.planos[0].continuidad.secuencia,r.planos[1].continuidad.secuencia);
  const mezclados=planosSegmentados(10,'16b');mezclados[1].direccion.visibles.push('madre');
  assert.ok(revisarPlanosDeEscena(10,'16b',{planos:mezclados}).quejas.some(q=>/no pertenece al reparto/.test(q.queja)));
});
prueba('No se omiten segmentos ni se pide a Veo hacer cortes o interpolar recuerdos',()=>{
  const ps=planosSegmentados(10,'16b');
  assert.ok(revisarPlanosDeEscena(10,'16b',{planos:ps.slice(0,3)}).quejas.some(q=>q.regla==='segmentos-y-cortes'));
  ps[0].video='The mother sings. Cut to the girl in the kitchen.';
  assert.ok(revisarPlanosDeEscena(10,'16b',{planos:ps}).quejas.some(q=>/toma continua/.test(q.queja)));
  ps[0].encadena_con=ps[1].id;
  assert.ok(revisarPlanosDeEscena(10,'16b',{planos:ps}).quejas.some(q=>/nunca interpolando/.test(q.queja)));
});
prueba('Separar un plano mixto mantiene la duración, audio, siguiente escena e historial',()=>{
  const antes=[{...plano(10,'16b'),id:'16b-1',dur:12,inicio:30}];
  const nuevos=revisarPlanosDeEscena(10,'16b',{planos:planosSegmentados(10,'16b')}).planos.map(p=>({...p,escena:'16b'}));
  assert.equal(conservaDuracionDeEscena(antes,nuevos),true);
  assert.equal(conservaDuracionDeEscena(antes,nuevos.slice(1)),false);
  const siguiente={...plano(10,'17'),inicio:42};
  const e={piezas:{ep10:{id:'ep10',episodio:10,tomas:[...antes,siguiente],audio:{voz:['conservada']}}},
    tomas:{'ep10/16b-1':{keyframe_aprobado:'old.png',clip_elegido:'old.mp4'}},montajes:[]};
  aplicarCorreccion(e,'ep10','16b',antes,nuevos,{});
  assert.deepEqual(e.piezas.ep10.tomas.map(p=>p.inicio),[30,33,36,39,42]);
  assert.deepEqual(e.piezas.ep10.audio,{voz:['conservada']});
  assert.equal(e.tomas['ep10/16b-1'].keyframe_aprobado,'old.png');
  assert.equal(e.tomas['ep10/16b-1'].revision_pendiente,true);
  assert.equal(e.tomas['ep10/16b-2'].keyframe_aprobado,undefined);
});
prueba('Un clip de otro keyframe no se considera vigente',()=>{
  assert.equal(materialVigente({keyframe_aprobado:'new.png',clip_elegido:'old.mp4',origenes_clip:{'old.mp4':{keyframe:'old.png'}}},'clip'),false);
});
// Ejecutar la pantalla con material antiguo: el botón debe encolar la reparación,
// y los botones de generación no deben saltarse las comprobaciones del servidor.
const encolados=[];
const nodo=(tipo,atributos,...hijos)=>({tipo,atributos,hijos:hijos.flat().filter(x=>x!=null),appendChild(h){this.hijos.push(h);}});
const estadoUi=inicial();
const stubs={necesitaDireccion,materialVigente,invalidarMontajes,claveDelMaterial,esDeArchivo,porQueNoSeGenera,
  ErrorDeCara,llamar:globalThis.fetch,actual:()=>estadoUi,cambiar:async fn=>fn(estadoUi),alCambiar:()=>{},
  encolar:()=>{},encolarVarios:lista=>encolados.push(...lista),confirmar:async()=>true,
  h:nodo,seccion:(...h)=>nodo('seccion',{},h),aviso:t=>nodo('aviso',{},t),
  boton:(texto,accion,opciones)=>({...nodo('boton',{},texto),texto,accion,opciones}),
  filtro:()=>nodo('filtro',{}),espera:t=>nodo('espera',{},t),
  plural:(n,u,p)=>`${n} ${n===1?u:p}`,segundos:n=>`${n}s`};
let uiFuente=readFileSync(new URL('../app/pantallas/tomas.js',import.meta.url),'utf8');
uiFuente=uiFuente.replace(/^import\s*\{([^}]+)\}\s*from\s*['"][^'"]+['"];\s*$/gm,(_,nombres)=>
  `const { ${nombres.split(',').map(n=>n.trim().replace(/\s+as\s+/,': ')).join(',')} } = __stubs;`)
  .replace(/import\.meta\.url/g,JSON.stringify(new URL('../app/pantallas/tomas.js',import.meta.url).href))
  .replace(/^export default /gm,'const pantallaExportada = ').replace(/^export /gm,'');
const ui=new Function('__stubs',`${uiFuente}\nreturn {construirModelo,seccionCabecera,accionesDeTanda,porQueNoSePuedeKeyframe,porQueNoHayBotonDeVideo,leerToma,aprobarKeyframe};`)(stubs);
const modeloUi=ui.construirModelo(serie,estadoUi);
const ctx={modelo:modeloUi,pieza:modeloUi.porId.get('ep01'),estado:estadoUi,repintar:()=>{},trabajos:new Map()};
const arbol=ui.seccionCabecera(ctx);
function encontrarBoton(n){if(n?.texto==='Corregir continuidad')return n;for(const hijo of n?.hijos||[]){const encontrado=encontrarBoton(hijo);if(encontrado)return encontrado;}return null;}
const corregir=encontrarBoton(arbol);
assert.ok(corregir,'La pantalla debe ofrecer una salida para los planos antiguos');
await corregir.accion();
prueba('El botón de Tomas encola la escena correcta sin generar imágenes',()=>{
  assert.deepEqual(encolados,[{tipo:'corregir-continuidad',args:{pieza:'ep01',escena:'4'}}]);
  assert.match(ui.porQueNoSePuedeKeyframe(ctx.pieza.tomas[0],ctx),/Corregir continuidad/);
});
const e=estadoUi.tomas['ep01/4-1'];e.revision_pendiente=true;
await ui.aprobarKeyframe('ep01/4-1','old.png','4-1',ui.leerToma(estadoUi,'ep01/4-1'),ctx);
prueba('Una imagen existente puede conservarse tras volver a aprobarla',()=>{
  assert.equal(e.revision_pendiente,false);assert.equal(e.keyframe_aprobado,'old.png');
  assert.deepEqual(e.intentos_keyframe,['old.png']);
});
estadoUi.piezas.ep01.tomas=[{...plano(1,'4'),revision_direccion:'r4'}];
estadoUi.escenarios={[plano(1,'4').escenario]:{aprobada:'escenario.png'}};
e.revision_pendiente=true;
const ctxNuevo={...ctx,pieza:ui.construirModelo(serie,estadoUi).porId.get('ep01')};
const botones=n=>[...(n?.texto ? [n] : []),...(n?.hijos||[]).flatMap(botones)];
const regenerar=ui.accionesDeTanda(ctxNuevo).flatMap(botones).find(b=>b.texto.startsWith('Regenerar '));
assert.ok(regenerar);await regenerar.accion();
prueba('La tanda de revisión pide otra imagen y no borra la anterior',()=>{
  assert.deepEqual(encolados.at(-1),{tipo:'keyframe',args:{pieza:'ep01',id:'4-1'}});
  assert.equal(e.keyframe_aprobado,'old.png');
  e.origenes_keyframe={'new.png':{revision:'r4'}};
  assert.ok(!ui.accionesDeTanda(ctxNuevo).flatMap(botones).some(b=>b.texto.startsWith('Regenerar ')));
});
e.revision_pendiente=false;e.revision_aprobada='r4';e.clip_revision_pendiente=true;
const regenerarVideo=ui.accionesDeTanda(ctxNuevo).flatMap(botones).find(b=>b.texto.includes('vídeos con imágenes revisadas'));
assert.ok(regenerarVideo);await regenerarVideo.accion();
prueba('La tanda de vídeo exige imagen revisada y conserva los intentos anteriores',()=>{
  assert.deepEqual(encolados.at(-1),{tipo:'clip',args:{pieza:'ep01',id:'4-1'}});
  assert.equal(e.clip_elegido,'old.mp4');
  e.origenes_clip={'nuevo.mp4':{keyframe:'old.png',revision:'r4'}};
  assert.ok(!ui.accionesDeTanda(ctxNuevo).flatMap(botones).some(b=>b.texto.includes('vídeos con imágenes revisadas')));
  e.origenes_clip={};e.revision_pendiente=true;
  assert.ok(!ui.accionesDeTanda(ctxNuevo).flatMap(botones).some(b=>b.texto.includes('vídeos con imágenes revisadas')));
});
prueba('Los intentos todavía no aprobados también se señalan para revisión',()=>{
  const entrada={intentos_keyframe:['intento.png'],intentos_clip:['intento.mp4']};
  const antes=plano(1,'4'),despues={...antes,imagen:'The guests stay seated.'};
  marcarCambio(entrada,antes,despues);
  assert.equal(entrada.revision_pendiente,true);assert.equal(entrada.clip_revision_pendiente,true);
  assert.deepEqual(entrada.intentos_keyframe,['intento.png']);
});
// Modos reales con almacenamiento en memoria y generación prohibida. Comprueba
// los cerrojos del servidor y el orden de escritura, no solo los de la pantalla.
let servidor=inicial();
const escrituras=[],eventos=[];
const prestado={Buffer,createHash,randomUUID,ErrorDeCara,serie,tomaDeLaPieza,exigirAprobada,
  materialVigente,necesitaDireccion,referenciaDeSecuencia,aplicarCorreccion,promptVideo,
  leerElEstado:async()=>({estado:structuredClone(servidor),generacion:'1'}),
  escribirElEstado:async estado=>{servidor=structuredClone(estado);eventos.push('estado');return {generacion:'2'};},
  escribirEnElBucket:async(ruta,contenido)=>{escrituras.push({ruta,contenido:JSON.parse(contenido)});eventos.push(ruta.endsWith('/anterior.json')?'respaldo':'propuesta');return {ruta};},
  corregirPlanosDeEscena:async()=>{eventos.push('texto-simulado');return {planos:[plano(1,'4')]};},
  lanzarVeo:globalThis.fetch,lanzarMontaje:globalThis.fetch
};
let fuenteModos=readFileSync(new URL('../api/_lib/modos.js',import.meta.url),'utf8')
  .replace(/^import\s*\{([^}]+)\}\s*from\s*['"][^'"]+['"];\s*$/gm,(_,nombres)=>
    `const { ${nombres.split(',').map(n=>n.trim().split(/\s+as\s+/).at(-1)).join(',')} } = __stubs;`)
  .replace(/^export /gm,'');
const modos=new Function('__stubs',`${fuenteModos}\nreturn MODOS;`)(prestado);
await assert.rejects(()=>modos['veo-lanzar']({pieza:'ep01',toma:'4-1',imagen_ruta:'otra.png',imagen_b64:'fake'}),/keyframe aprobado cambió/);
servidor.tomas['ep01/4-1'].revision_pendiente=true;
await assert.rejects(()=>modos['veo-lanzar']({pieza:'ep01',toma:'4-1',imagen_ruta:'old.png',imagen_b64:'fake'}),/Revisa y aprueba/);
prueba('El servidor frena vídeo con origen distinto o aprobación pendiente antes de gastar',()=>assert.equal(escrituras.length,0));
servidor=inicial();
const reparada=await modos['corregir-continuidad']({pieza:'ep01',escena:'4'});
prueba('El modo guarda respaldo y propuesta antes de aplicar la corrección',()=>{
  assert.equal(reparada.corregida,true);
  assert.deepEqual(eventos,['respaldo','texto-simulado','propuesta','estado']);
  assert.notEqual(escrituras[0].ruta,escrituras[1].ruta);
  assert.equal(escrituras[0].contenido.tomas['ep01/4-1'].keyframe_aprobado,'old.png');
  assert.equal(servidor.tomas['ep01/4-1'].revision_pendiente,true);
  assert.equal(servidor.piezas.ep01.tomas[0].revision_direccion,servidor.piezas.ep01.correcciones_continuidad['4'].revision);
});
await assert.rejects(()=>modos.montar({manifiesto:{video:[{clave:'ep01/4-1',origen:'old.mp4'}]}}),/pendiente de revisar/);
await assert.rejects(()=>modos.montar({manifiesto:{video:[{clave:'ep01/4-1',origen:'otra.mp4'}]}}),/selección de vídeo cambió/);
await assert.rejects(()=>modos.montar({manifiesto:{capas_previas:['montado.mp4']}}),/Una escena ya montada quedó pendiente/);
prueba('El servidor rechaza montajes de clips cambiados o capas pendientes',()=>assert.equal(escrituras.length,2));
console.log(`\n${total} pruebas de continuidad correctas. Sin red ni generación.`);
