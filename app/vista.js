// Actualizaciones visuales compartidas. No escribe estado ni ejecuta trabajos.
// Prepara la pantalla fuera del documento y la cambia en una sola operación,
// conservando lo que el usuario está leyendo. Nunca cambia un blanco de toque
// entre pointerdown y click, ni destruye un reproductor mientras está sonando.
const REPOSO_MS=180;
const campos='input,textarea,select';

function firma(n) {
  if (n.id) return '#'+n.id;
  if (n.dataset.vistaClave) return 'clave:'+n.dataset.vistaClave;
  const titulo=n.matches('article,section') && n.querySelector('h2,h3,h4');
  if (titulo) return n.tagName+':'+titulo.textContent.trim();
  if (n.matches('button,summary')) return n.tagName+':'+n.textContent.trim();
  if (n.matches('img,audio,video')) return n.tagName+':'+(n.getAttribute('alt') || n.getAttribute('aria-label') || n.getAttribute('src') || '');
  return n.tagName+':'+(n.getAttribute('name') || n.getAttribute('aria-label') || n.getAttribute('placeholder') || '');
}

/** Claves dentro de su tarjeta/grupo, independientes de avisos añadidos arriba.
 * Las repeticiones se numeran solo entre hermanos de la misma firma. */
function indexar(raiz) {
  const porClave=new Map(),porNodo=new Map();
  function recorrer(n,padre) {
    const cuentas=new Map();
    for (const hijo of n.children) {
      const f=firma(hijo),i=cuentas.get(f) || 0;
      cuentas.set(f,i+1);
      const k=hijo.id ? '#'+hijo.id : padre+'/'+f+':'+i;
      porClave.set(k,hijo);porNodo.set(hijo,k);
      recorrer(hijo,k);
    }
  }
  recorrer(raiz,'');
  return {porClave,porNodo};
}

const valor=n=>n.type==='checkbox' || n.type==='radio' ? n.checked : n.value;
const ponerValor=(n,v)=>{if(n.type==='checkbox' || n.type==='radio') n.checked=v;else n.value=v;};
const editable=n=>n?.matches('textarea,input:not([type=button]):not([type=submit]):not([type=checkbox]):not([type=radio]):not([type=range]),[contenteditable=true]');
function mismoArchivo(a,b) {
  if(a===b) return true;
  try {
    const x=new URL(a,location.href),y=new URL(b,location.href);
    return x.origin===y.origin && x.pathname===y.pathname &&
      (x.search===y.search || x.hostname==='storage.googleapis.com');
  } catch {return false;}
}

function recordar(raiz,bases,ultimoToque) {
  const indice=indexar(raiz),detalles=new Map(),desplazamientos=new Map(),borradores=new Map(),medios=new Map();
  for(const [k,n] of indice.porClave) {
    if(n.tagName==='DETAILS') detalles.set(k,n.open);
    if(n.scrollLeft || n.scrollTop) desplazamientos.set(k,[n.scrollLeft,n.scrollTop]);
    if(n.matches(campos) && bases.has(n) && valor(n)!==bases.get(n)) borradores.set(k,{base:bases.get(n),valor:valor(n)});
    if(n.matches('audio,video')) medios.set(k,{src:n.getAttribute('src'),tiempo:n.currentTime,volumen:n.volume,silencio:n.muted,velocidad:n.playbackRate});
  }
  // Una tarjeta de voces también puede crecer POR ENCIMA de otra que se está
  // leyendo. Ese punto de lectura vive fuera de la tarjeta que se actualiza.
  const alcance=raiz.closest('#pantalla,main') || document.body;
  const candidatos=[ultimoToque,...raiz.querySelectorAll('button,summary,h2,h3,img,p,article'),
    ...alcance.querySelectorAll('button,summary,h2,h3,img,p,article')].filter((n,i,lista)=>n && alcance.contains(n) && lista.indexOf(n)===i);
  const anclas=candidatos.flatMap(n=>{
    const r=n.getBoundingClientRect(),k=indice.porNodo.get(n);
    return r.width && r.height && r.top>=0 && r.top<window.innerHeight-70 ? [{k,n,y:r.top}] : [];
  });
  const foco=document.activeElement;
  return {detalles,desplazamientos,borradores,medios,anclas,
    foco:indice.porNodo.get(foco),x:window.scrollX,y:window.scrollY};
}

function restaurar(nueva,memoria,bases) {
  const indice=indexar(nueva);
  for(const [k,n] of indice.porClave) {
    if(n.tagName==='DETAILS' && memoria.detalles.has(k)) n.open=memoria.detalles.get(k);
    if(n.matches(campos)) {
      const base=valor(n),borrador=memoria.borradores.get(k);
      bases.set(n,base);
      // Una edición nueva del modelo gana; un borrador aún sin guardar sobre
      // la misma base se mantiene, con sus manejadores ligados al nodo nuevo.
      if(borrador && base===borrador.base) ponerValor(n,borrador.valor);
    }
    if(n.matches('audio,video')) {
      const m=memoria.medios.get(k);
      if(m && mismoArchivo(m.src,n.getAttribute('src'))) {
        n.volume=m.volumen;n.muted=m.silencio;n.playbackRate=m.velocidad;
        if(m.tiempo>0) {
          const situar=()=>{try{n.currentTime=m.tiempo;}catch{ /* Espera a los metadatos. */ }};
          n.addEventListener('loadedmetadata',situar,{once:true});
          situar();
        }
      }
    }
  }
  return indice;
}

/** Devuelve pedir(actualizada?), con destruir() para desmontar. El callback
 * opcional permite navegar a una tarjeta DESPUÉS del cambio, no antes. */
export function crearActualizador(raiz,construir,{contexto=()=>'',reemplazar=false}={}) {
  let vivo=true,pendiente=false,raf=0,reloj=0,hasta=0,ultimoToque=null,selector=null,clave=contexto();
  const dedos=new Set(),teclas=new Set(),bases=new WeakMap(),despues=[];
  const escuchar=(tipo,fn,opciones)=>{
    document.addEventListener(tipo,fn,opciones);
    salidas.push(()=>document.removeEventListener(tipo,fn,opciones));
  };
  const salidas=[];
  const reposa=()=>{
    hasta=performance.now()+REPOSO_MS;
    if(pendiente) programar();
  };
  escuchar('pointerdown',e=>{
    dedos.add(e.pointerId);ultimoToque=e.target.closest('button,summary,a') || e.target;
    if(e.target.matches('select')) selector=e.target;
  },true);
  escuchar('pointerup',e=>{dedos.delete(e.pointerId);reposa();},true);
  escuchar('pointercancel',e=>{dedos.delete(e.pointerId);reposa();},true);
  escuchar('click',e=>{if(raiz.contains(e.target)) reposa();},true);
  escuchar('scroll',reposa,true);
  escuchar('keydown',e=>{
    if(e.key===' ' || e.key==='Enter') teclas.add(e.key);
    if(e.target.matches('select') && [' ','Enter','ArrowDown','ArrowUp'].includes(e.key)) selector=e.target;
    if(e.key==='Escape') selector=null;
  },true);
  escuchar('keyup',e=>{teclas.delete(e.key);reposa();},true);
  escuchar('change',e=>{if(e.target===selector) selector=null;reposa();},true);
  escuchar('focusout',e=>{if(e.target===selector) selector=null;reposa();},true);
  escuchar('pause',reposa,true);
  escuchar('ended',reposa,true);
  const perderVentana=()=>{dedos.clear();teclas.clear();selector=null;reposa();};
  window.addEventListener('blur',perderVentana);
  salidas.push(()=>window.removeEventListener('blur',perderVentana));

  function programar() {
    if(!vivo || raf || reloj) return;
    reloj=setTimeout(()=>{reloj=0;raf=requestAnimationFrame(pintar);},Math.max(0,hasta-performance.now()));
  }
  function pintar() {
    raf=0;
    if(!vivo || !pendiente) return;
    if(!raiz.isConnected) {pedir.destruir();return;}
    // La espera acaba por eventos de interacción, no con un bucle que repinta.
    if(dedos.size || teclas.size || selector ||
      (raiz.contains(document.activeElement) && editable(document.activeElement)) ||
      (clave===contexto() && [...raiz.querySelectorAll('audio,video')].some(m=>!m.paused && !m.ended))) return;
    if(performance.now()<hasta) {programar();return;}
    pendiente=false;
    try {
      const mismaVista=clave===contexto();
      const memoria=recordar(raiz,bases,ultimoToque);
      const nueva=construir();
      if(!nueva) return;
      clave=contexto();
      const preparada=reemplazar?nueva:document.createElement('div');
      if(!reemplazar) preparada.appendChild(nueva);
      const indice=restaurar(preparada,mismaVista?memoria:{...memoria,detalles:new Map(),borradores:new Map(),medios:new Map()},bases);
      // No hay un fotograma intermedio con la pantalla vacía.
      if(reemplazar) {raiz.replaceWith(nueva);raiz=nueva;} else raiz.replaceChildren(nueva);
      if(mismaVista) {
        for(const [k,[x,y]] of memoria.desplazamientos) {
          const n=indice.porClave.get(k);if(n){n.scrollLeft=x;n.scrollTop=y;}
        }
        if(memoria.foco) indice.porClave.get(memoria.foco)?.focus?.({preventScroll:true});
        const ancla=memoria.anclas.find(a=>a.n.isConnected || indice.porClave.has(a.k));
        const nodo=ancla && (ancla.n.isConnected?ancla.n:indice.porClave.get(ancla.k));
        const delta=nodo?nodo.getBoundingClientRect().top-ancla.y:0;
        window.scrollTo({left:memoria.x,top:ancla?window.scrollY+delta:memoria.y,behavior:'instant'});
      }
      ultimoToque=null;
      for(const fn of despues.splice(0)) fn();
    } catch(fallo) {
      window.dispatchEvent(new CustomEvent('fallo-suelto',{detail:fallo}));
    }
    if(pendiente) programar();
  }
  function pedir(alTerminar) {
    if(!vivo) return;
    if(typeof alTerminar==='function') despues.push(alTerminar);
    pendiente=true;programar();
  }
  pedir.destruir=()=>{
    vivo=false;pendiente=false;cancelAnimationFrame(raf);clearTimeout(reloj);
    for(const salir of salidas) salir();
    despues.length=0;dedos.clear();teclas.clear();selector=null;
  };
  return pedir;
}
