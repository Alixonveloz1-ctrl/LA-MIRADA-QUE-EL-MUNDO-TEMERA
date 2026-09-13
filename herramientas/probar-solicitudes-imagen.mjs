import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { imagenUnaVez, protegerDetenciones } from '../api/_lib/solicitudes-imagen.js';
import { ErrorDeCara } from '../api/_lib/errores.js';

const cuerpo = { tipo:'keyframe', pieza:'ep01', id:'3-2', solicitud_id:'11111111-1111-4111-8111-111111111111' };
function memoria() {
  const archivos = new Map(); let version = 0, llamadas = 0;
  const deps = {
    estado:{cola:[]},
    leer:async ruta => archivos.get(ruta) || null,
    escribir:async (ruta,texto,{generacion}={}) => {
      const previo=archivos.get(ruta);
      if (generacion != null && String(generacion)!==String(previo?.generacion || '0')) throw new ErrorDeCara('Carrera',{http:409});
      archivos.set(ruta,{texto,generacion:String(++version)});
    },
    generar:async () => { llamadas++; return {ruta:'keyframes/ep01/3-2/2.png',intento:2}; },
    firmar:async ruta => 'firmada:'+ruta,
  };
  return {deps,archivos,llamadas:()=>llamadas};
}
test('Respuesta perdida después de guardar: recupera la misma imagen sin volver a generar',async()=>{
  const m=memoria();let firmas=0;
  m.deps.firmar=async ruta=>{if(!firmas++)throw new Error('Conexión perdida al entregar');return ruta;};
  await assert.rejects(()=>imagenUnaVez(cuerpo,m.deps),/Conexión/);
  const r=await imagenUnaVez(cuerpo,{...m.deps});
  assert.equal(r.recuperada,true);assert.equal(m.llamadas(),1);
});
test('Dos pestañas a la vez solo llaman una vez al modelo',async()=>{
  const m=memoria();let terminar,iniciada;const inicio=new Promise(r=>iniciada=r),espera=new Promise(r=>terminar=r);
  const original=m.deps.generar;m.deps.generar=async()=>{iniciada();await espera;return original();};
  const primera=imagenUnaVez(cuerpo,m.deps);await inicio;
  const segunda=await imagenUnaVez(cuerpo,m.deps);assert.equal(segunda.pendiente,true);
  terminar();await primera;assert.equal(m.llamadas(),1);
});
test('Una reserva antigua con resultado incierto nunca vuelve a llamar al modelo',async()=>{
  const m=memoria();await imagenUnaVez(cuerpo,m.deps);
  for(const [ruta,r]of m.archivos){const d=JSON.parse(r.texto);m.archivos.set(ruta,{...r,texto:JSON.stringify({...d,estado:'en_curso',inicio:0})});}
  m.deps.ahora=()=>400000;
  await assert.rejects(()=>imagenUnaVez(cuerpo,m.deps),/evitar pagar/);assert.equal(m.llamadas(),1);
});
test('Un fallo incierto del proveedor no provoca una segunda generación',async()=>{
  const m=memoria();let n=0;m.deps.generar=async()=>{n++;throw new ErrorDeCara('Respuesta perdida',{http:502,reintentable:true});};
  await assert.rejects(()=>imagenUnaVez(cuerpo,m.deps));
  await assert.rejects(()=>imagenUnaVez(cuerpo,m.deps),/No se volverá/);assert.equal(n,1);
});
test('Una cuota rechazada explícitamente permite un nuevo intento protegido',async()=>{
  const m=memoria();const original=m.deps.generar;let n=0;
  m.deps.generar=async()=>{if(!n++)throw new ErrorDeCara('Cuota',{http:429,reintentable:true});return original();};
  await assert.rejects(()=>imagenUnaVez(cuerpo,m.deps));
  assert.equal((await imagenUnaVez(cuerpo,m.deps)).ruta,'keyframes/ep01/3-2/2.png');assert.equal(m.llamadas(),1);
});
test('Reutilizar una identificación para otra toma se rechaza antes de cobrar',async()=>{
  const m=memoria();await imagenUnaVez(cuerpo,m.deps);
  await assert.rejects(()=>imagenUnaVez({...cuerpo,id:'3-3'},m.deps),/otra imagen/);assert.equal(m.llamadas(),1);
});
test('Detener bloquea también las peticiones de una pestaña antigua',async()=>{
  const m=memoria();m.deps.estado.cola=[{id:'j',tipo:'keyframe',args:{pieza:'ep01',id:'3-2'},estado:'en_curso',detencion_solicitada:true}];
  await assert.rejects(()=>imagenUnaVez({...cuerpo,solicitud_id:undefined},m.deps),/detenida/);assert.equal(m.llamadas(),0);
});
test('Los encargos antiguos sin identificación no se regeneran tras una desconexión',async()=>{
  const m=memoria();m.deps.estado.cola=[{id:'j',tipo:'keyframe',args:{pieza:'ep01',id:'3-2'},estado:'en_curso'}];
  await assert.rejects(()=>imagenUnaVez({...cuerpo,solicitud_id:undefined},m.deps),/Actualiza/);assert.equal(m.llamadas(),0);
});
test('Recupera el resultado anotado en el estado aunque falle el guardado del recibo',async()=>{
  const m=memoria();m.deps.estado.cola=[{id:'j',tipo:'keyframe',args:{pieza:'ep01',id:'3-2'},solicitud_id:cuerpo.solicitud_id,
    resultado_imagen:{solicitud_id:cuerpo.solicitud_id,ruta:'ya-generada.png'}}];
  const r=await imagenUnaVez({...cuerpo,trabajo_id:'j'},m.deps);assert.equal(r.ruta,'ya-generada.png');assert.equal(m.llamadas(),0);
});
test('Una escritura atrasada no puede borrar una detención; una reanudación expresa sí',()=>{
  const antes={cola:[{id:'j',solicitud_id:'uno',detencion_solicitada:true,estado:'detenido'}]};
  const propuesta=structuredClone(antes);propuesta.cola[0].estado='pendiente';
  assert.throws(()=>protegerDetenciones(propuesta,antes),/detenido/);
  propuesta.cola[0].reanudacion_id='nueva-reanudacion';propuesta.cola[0].detencion_solicitada=false;
  assert.doesNotThrow(()=>protegerDetenciones(propuesta,antes));
});

// Ejecutar la cola real con almacenamiento en memoria; no se permite red.
function colaReal() {
  let estado={cola:[],tomas:{},ajustes:{imagen:{nivel:'calidad'}}},gasto=0;
  const stubs={ErrorDeCara,actual:()=>estado,cargar:async()=>estado,
    cambiar:async fn=>{const e=structuredClone(estado);await fn(e);estado=e;return e;},
    anotarGasto:()=>gasto++,ritmoActual:()=>0,ponerRitmoMinimo:()=>{},
    llamar:(...args)=>stubs.transporte(...args),transporte:async()=>{throw new Error('Red no permitida');}};
  let src=readFileSync(new URL('../app/cola.js',import.meta.url),'utf8')
    .replace(/^import\s*\{([^}]+)\}\s*from\s*['"][^'"]+['"];\s*$/gm,(_,d)=>
      `const {${d.split(',').map(s=>s.trim().split(/\s+as\s+/).at(-1)).join(',')}}=__stubs;`)
    .replace(/import\.meta\.url/g,"'file:///r/app/'").replace(/^export default /gm,'const pantallaExportada = ').replace(/^export /gm,'');
  const api=new Function('__stubs',src+'\nreturn {prepararEncolado,detener,resolver,revivirHuerfanos,cogerLaTanda,ejecutarUno,conCuaderno,escribirLaTanda};')(stubs);
  return {api,stubs,get estado(){return estado;},get gasto(){return gasto;}};
}
test('Un clic mantiene su identidad al reaplicar escrituras; otro clic obtiene una nueva',()=>{
  const c=colaReal();const p=c.api.prepararEncolado('keyframe',{pieza:'ep01',id:'3-2'});
  p.cambio(c.estado);const id=c.estado.cola[0].solicitud_id;
  c.estado.cola[0].estado='hecho';p.cambio(c.estado);assert.equal(c.estado.cola[0].solicitud_id,id);
  c.estado.cola[0].estado='hecho';c.api.prepararEncolado('keyframe',{pieza:'ep01',id:'3-2'}).cambio(c.estado);
  assert.notEqual(c.estado.cola[0].solicitud_id,id);
});
test('Detener durante la creación persiste y una respuesta tardía no vuelve a activarla',async()=>{
  const c=colaReal();c.api.prepararEncolado('keyframe',{pieza:'ep01',id:'3-2'}).cambio(c.estado);
  c.estado.cola[0].estado='en_curso';await c.api.detener(c.estado.cola[0].id);
  c.api.resolver(c.estado.cola[0],{fin:'reintentar',http:0,mensaje:'Load failed'});
  assert.equal(c.estado.cola[0].estado,'detenido');assert.equal(c.estado.cola[0].proximo,null);
});
test('Una recarga recupera un trabajo con identidad y detiene uno antiguo incierto',async()=>{
  const c=colaReal();c.estado.cola.push({id:'viejo',tipo:'keyframe',estado:'en_curso',actualizado:'2020-01-01'},
    {id:'nuevo',tipo:'keyframe',solicitud_id:'misma-solicitud',estado:'en_curso',actualizado:'2020-01-01'});
  await c.api.revivirHuerfanos();assert.equal(c.estado.cola[0].estado,'detenido');assert.equal(c.estado.cola[1].estado,'pendiente');
  assert.equal(c.estado.cola[1].solicitud_id,'misma-solicitud');
});
test('Flujo completo: Load failed tras generar, reintento de cola recupera una imagen y un gasto',async()=>{
  const c=colaReal(),m=memoria();let perdida=true;
  c.stubs.transporte=async(modo,campos)=>{assert.equal(modo,'imagen');m.deps.estado=c.estado;
    const r=await imagenUnaVez(campos,m.deps);
    if(perdida){perdida=false;throw new ErrorDeCara('Load failed',{http:0,reintentable:true});}return r;};
  c.api.prepararEncolado('keyframe',{pieza:'ep01',id:'3-2',nivel:'calidad'}).cambio(c.estado);
  for(let n=0;n<2;n++){
    const t=structuredClone(c.estado.cola[0]);
    const {valor,cambios}=await c.api.conCuaderno(()=>c.api.ejecutarUno(t));
    await c.api.escribirLaTanda(cambios,[valor]);
  }
  assert.equal(c.estado.cola[0].estado,'hecho');assert.equal(m.llamadas(),1);assert.equal(c.gasto,1);
  assert.equal(c.estado.tomas['ep01/3-2'].intentos_keyframe.length,1);
});
test('La pantalla permite detener cuando solo existe un trabajo en curso',async()=>{
  const botones=[],detenciones=[];
  const stubs={
    resumen:()=>({pendientes:0,enCurso:1,hechas:0,fallidas:0,detenidas:0}),corriendo:()=>true,
    h:(tag,attrs,...hijos)=>({tag,attrs,hijos}),seccion:(...args)=>args,
    boton:(texto,accion,opciones={})=>{const b={texto,accion,opciones};botones.push(b);return b;},
    detener:async id=>detenciones.push(id),confirmar:async()=>true,
  };
  const src=readFileSync(new URL('../app/pantallas/cola.js',import.meta.url),'utf8')
    .replace(/^import\s*\{([^}]+)\}\s*from\s*['"][^'"]+['"];\s*$/gm,(_,d)=>
      `const {${d.split(',').map(s=>s.trim().split(/\s+as\s+/).at(-1)).join(',')}}=__stubs;`)
    .replace(/import\.meta\.url/g,"'file:///r/app/'").replace(/^export default /gm,'const pantallaExportada = ').replace(/^export /gm,'');
  const ui=new Function('__stubs',src+'\nreturn {seccionMando,accionesDeUnTrabajo};')(stubs);
  const ctx={estado:{},repintar:()=>{}};ui.seccionMando(ctx);
  const global=botones.find(b=>b.texto==='DETENER');assert.ok(global);assert.equal(global.opciones.desactivado,false);
  await global.accion();assert.equal(detenciones.length,1);
  ui.accionesDeUnTrabajo({id:'j',tipo:'keyframe',estado:'en_curso'},ctx);
  const individual=botones.find(b=>b.texto==='Detener reintentos');assert.ok(individual);assert.ok(!individual.opciones.desactivado);
  await individual.accion();assert.equal(detenciones[1],'j');
});
test('Una imagen que termina después de detener se conserva sin sustituir la aprobada',async()=>{
  const c=colaReal();c.api.prepararEncolado('keyframe',{pieza:'ep01',id:'3-2',nivel:'calidad'}).cambio(c.estado);
  c.estado.tomas['ep01/3-2']={keyframe_aprobado:'aprobada.png',intentos_keyframe:['aprobada.png'],revision_pendiente:false};
  const t=structuredClone(c.estado.cola[0]);c.estado.cola[0].estado='en_curso';
  c.stubs.transporte=async()=>{await c.api.detener(t.id);return {ruta:'terminada-despues.png'};};
  const {valor,cambios}=await c.api.conCuaderno(()=>c.api.ejecutarUno(t));
  await c.api.escribirLaTanda(cambios,[valor]);
  assert.equal(c.estado.cola[0].estado,'detenido');
  assert.equal(c.estado.tomas['ep01/3-2'].keyframe_aprobado,'aprobada.png');
  assert.deepEqual(c.estado.tomas['ep01/3-2'].intentos_keyframe,['aprobada.png']);
  assert.deepEqual(c.estado.tomas['ep01/3-2'].intentos_keyframe_detenidos,['terminada-despues.png']);
  assert.equal(c.estado.tomas['ep01/3-2'].revision_pendiente,false);
});
