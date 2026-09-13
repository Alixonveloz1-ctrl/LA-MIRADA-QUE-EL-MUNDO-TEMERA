// Pruebas de DOM y geometría reales: abrir probar-vista.html y pulsar Ejecutar.
// Usa los componentes del estudio y medios de prueba locales. Ninguna API.
import { h, tarjeta, boton } from '../app/ui.js';
import { crearActualizador } from '../app/vista.js';
import { videoDePrueba } from './vista-media.js';

const zona=document.getElementById('prueba'),resultado=document.getElementById('resultado');
const esperar=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const afirmar=(bien,texto)=>{if(!bien) throw new Error(texto);};
const puntero=(n,tipo)=>n.dispatchEvent(new PointerEvent(tipo,{bubbles:true,pointerId:1,pointerType:'touch'}));
const tecla=(n,tipo)=>n.dispatchEvent(new KeyboardEvent(tipo,{bubbles:true,key:' '}));
const tiempo=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
const caja=n=>n.getBoundingClientRect().top;
const casi=(a,b)=>Math.abs(a-b)<2;
let activo=null;

function preparar() {
  activo?.destruir();zona.replaceChildren();window.scrollTo(0,0);
  const modelo={avance:0,aviso:false,valor:'Base',capitulo:'ep01'};
  let pintadas=0,pulsaciones=0,valorGuardado=null;
  const construir=()=>{
    pintadas++;
    const campo=h('textarea',{id:'edicion',value:modelo.valor,'aria-label':'Texto de prueba'});
    const audio=h('audio',{id:'audio-prueba',src:videoDePrueba,controls:true,preload:'auto','aria-label':'Música de prueba'});
    const video=h('video',{id:'video-prueba',src:videoDePrueba,controls:true,preload:'auto',playsinline:true,'aria-label':'Vídeo de prueba'});
    audio.muted=true;video.muted=true;
    return h('div',{clase:'pantalla'},
      h('div',{clase:'relleno'}),
      modelo.aviso?h('p',{id:'aviso',estilo:{height:'180px'}},'Trabajo terminado'):null,
      tarjeta({titulo:'Escena 2 · Toma 1 de 6',
        media:h('img',{alt:'Imagen de prueba',src:'data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="160" height="90"><rect width="160" height="90" fill="#655427"/></svg>')}),
        pie:[h('p',{id:'avance'},`Avance ${modelo.avance}`),
          h('details',{id:'detalles'},h('summary',null,'Leer la escena'),h('p',null,'Saharis permanece en la cripta.')),
          h('div',{id:'filtros',clase:'deslizador'},h('div',null,'Escenas 1 a 24')),
          campo,
          h('select',{id:'selector','aria-label':'Opción'},h('option',{value:'a'},'A'),h('option',{value:'b'},'B')),
          audio,video],
        acciones:[boton('Aprobar',()=>{pulsaciones++;valorGuardado=campo.value;}),boton('Otro intento',()=>{pulsaciones+=100;})]}),
      h('div',{clase:'despues'}));
  };
  const actualizar=crearActualizador(zona,construir,{contexto:()=>modelo.capitulo});
  activo=actualizar;actualizar();
  return {modelo,actualizar,get pintadas(){return pintadas;},get pulsaciones(){return pulsaciones;},get valorGuardado(){return valorGuardado;}};
}

async function lista() {
  const errores=[];
  const probar=async(nombre,fn)=>{
    try {await fn();resultado.textContent+=`✓ ${nombre}\n`;}
    catch(error){errores.push(nombre);resultado.textContent+=`✗ ${nombre}: ${error.message}\n`;}
  };
  resultado.textContent='';
  await probar('Una sola actualización por tanda de avisos',async()=>{
    const p=preparar();await esperar(300);const n=p.pintadas;
    for(let i=0;i<25;i++){p.modelo.avance=i;p.actualizar();}
    await esperar(350);afirmar(p.pintadas===n+1,'Se reconstruyó más de una vez');
    afirmar(document.getElementById('avance').textContent==='Avance 24','No llegó el último estado');
  });
  await probar('Los detalles abiertos y los filtros no se cierran ni retroceden',async()=>{
    const p=preparar();await esperar(300);
    document.getElementById('detalles').open=true;
    document.getElementById('filtros').scrollLeft=180;
    p.modelo.avance++;p.actualizar();await esperar(350);
    afirmar(document.getElementById('detalles').open,'Se cerró la escena');
    afirmar(document.getElementById('filtros').scrollLeft===180,'El filtro retrocedió');
  });
  await probar('El botón conserva su altura aunque aparezca un aviso arriba',async()=>{
    const p=preparar();await esperar(300);
    const anterior=zona.querySelector('button');anterior.scrollIntoView({block:'center'});await esperar(250);
    const y=caja(anterior);p.modelo.aviso=true;p.actualizar();await esperar(350);
    afirmar(casi(caja(zona.querySelector('button')),y),'Se desplazó el botón al terminar un trabajo');
  });
  await probar('Ningún botón cambia entre apoyar y levantar el dedo',async()=>{
    const p=preparar();await esperar(300);const b=zona.querySelector('button');
    puntero(b,'pointerdown');p.modelo.aviso=true;p.actualizar();await esperar(350);
    afirmar(b.isConnected,'Se sustituyó el botón con el dedo apoyado');
    puntero(b,'pointerup');b.click();await esperar(350);
    afirmar(p.pulsaciones===1,'Se pulsó otra acción');afirmar(!b.isConnected,'No se aplicó el cambio pendiente');
  });
  await probar('También espera al levantar la tecla de activación',async()=>{
    const p=preparar();await esperar(300);const b=zona.querySelector('button');
    tecla(b,'keydown');p.actualizar();await esperar(350);afirmar(b.isConnected,'Cambió antes de soltar Espacio');
    tecla(b,'keyup');await esperar(350);afirmar(!b.isConnected,'No actualizó después de soltar Espacio');
  });
  await probar('Escribir conserva el borrador y la acción usa el campo visible',async()=>{
    const p=preparar();await esperar(300);const campo=document.getElementById('edicion');
    campo.focus();campo.value='Texto pendiente';p.modelo.avance++;p.actualizar();await esperar(350);
    afirmar(campo.isConnected,'Se perdió el foco mientras se escribía');campo.blur();await esperar(350);
    afirmar(document.getElementById('edicion').value==='Texto pendiente','Se perdió el borrador');
    zona.querySelector('button').click();afirmar(p.valorGuardado==='Texto pendiente','El botón leyó un campo antiguo');
    p.modelo.valor='Texto guardado nuevo';p.actualizar();await esperar(350);
    afirmar(document.getElementById('edicion').value===p.modelo.valor,'El borrador tapó un cambio guardado');
  });
  await probar('El selector espera a la elección y luego se actualiza',async()=>{
    const p=preparar();await esperar(300);const s=document.getElementById('selector');
    puntero(s,'pointerdown');puntero(s,'pointerup');p.actualizar();await esperar(350);
    afirmar(s.isConnected,'Se cerró el selector mientras se elegía');
    s.value='b';s.dispatchEvent(new Event('change',{bubbles:true}));await esperar(350);
    afirmar(!s.isConnected,'El selector bloqueó las actualizaciones');
    afirmar(document.getElementById('selector').value==='b','Se perdió la opción elegida');
  });
  await probar('El desplazamiento continuo retrasa las actualizaciones',async()=>{
    const p=preparar();await esperar(300);const b=zona.querySelector('button');p.actualizar();
    for(let i=0;i<5;i++){document.dispatchEvent(new Event('scroll'));await esperar(90);afirmar(b.isConnected,'Cambió durante el desplazamiento');}
    await esperar(350);afirmar(!b.isConnected,'No actualizó al dejar de desplazar');
  });
  for(const tipo of ['audio','video']) await probar(`La reproducción de ${tipo} continúa y conserva la pausa`,async()=>{
    const p=preparar();await esperar(300);const m=document.getElementById(`${tipo}-prueba`);
    await m.play();p.modelo.avance++;p.actualizar();await esperar(350);
    afirmar(m.isConnected && !m.paused,'Se interrumpió la reproducción');
    m.pause();m.currentTime=2;await esperar(350);const nuevo=document.getElementById(`${tipo}-prueba`);
    afirmar(nuevo!==m,'No actualizó al pausar');await esperar(150);
    afirmar(nuevo.paused && Math.abs(nuevo.currentTime-2)<.1,'La pausa volvió al principio');
  });
  await probar('Cambiar de capítulo no copia el borrador del anterior',async()=>{
    const p=preparar();await esperar(300);document.getElementById('edicion').value='Solo ep01';
    p.modelo.capitulo='ep02';p.actualizar();await esperar(350);
    afirmar(document.getElementById('edicion').value==='Base','Se copió texto entre capítulos');
  });
  await probar('Una tarjeta que cambia arriba conserva el botón de la siguiente',async()=>{
    const p=preparar();await esperar(300);p.actualizar.destruir();
    const superior=zona.querySelector('.relleno');
    const actualizar=crearActualizador(superior,()=>h('div',{estilo:{height:'1000px'}}),{reemplazar:true});activo=actualizar;
    const b=zona.querySelector('button');b.scrollIntoView({block:'center'});await esperar(250);const y=caja(b);
    puntero(b,'pointerdown');actualizar();await esperar(350);afirmar(superior.isConnected,'La otra tarjeta cambió durante el toque');
    puntero(b,'pointerup');await esperar(350);afirmar(casi(caja(b),y),'La otra tarjeta movió el botón');
  });
  await probar('Al salir se cancelan los cambios pendientes',async()=>{
    const p=preparar();await esperar(300);const n=p.pintadas;p.actualizar();p.actualizar.destruir();await esperar(350);
    afirmar(p.pintadas===n,'Se pintó una pantalla después de salir');
  });
  activo?.destruir();zona.replaceChildren();await tiempo();window.scrollTo(0,0);
  resultado.textContent+=(errores.length?`FALLARON ${errores.length}`:'TODAS LAS COMPROBACIONES PASARON');
}

document.getElementById('ejecutar').addEventListener('click',async e=>{
  e.target.disabled=true;
  try{await lista();}catch(error){resultado.textContent+=`\nERROR: ${error.stack}`;}
  finally{e.target.disabled=false;}
});
