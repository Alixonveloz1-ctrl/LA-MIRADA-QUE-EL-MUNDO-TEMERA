#!/usr/bin/env node
// Prueba la cola EJECUTÁNDOLA, con un Google de mentira y un bucket en memoria.
//
//   node herramientas/probar-cola.mjs        (un trabajo suelto)
//   node herramientas/probar-cola.mjs 24     (el botón de «generar los que faltan»)
//   node herramientas/probar-cola.mjs cuota  (Google sin cuota: no se quema la lista)
//
// POR QUÉ HACE FALTA EJECUTARLA Y NO BASTA CON LEERLA. El fallo que trajo esto
// no se veía de ninguna otra forma: `encolar()` mandaba escribir el trabajo al
// bucket y, sin esperar a que la escritura terminara, llamaba al obrero. El
// obrero leía la cola, todavía no estaba el trabajo, decía «no hay nada que
// hacer» y se iba a casa. Medio segundo después el trabajo aparecía en el
// bucket y ya no había nadie mirando: se quedaba «pedida» para siempre.
//
// Sintaxis válida, ninguna excepción, ni una línea en los registros del
// servidor, y la aplicación sin generar nada. Por eso el bucket de mentira de
// aquí TARDA lo que tarda uno de verdad: sin ese retardo la carrera no ocurre y
// la prueba pasaría mintiendo.
//
// Se recorre el camino REAL: se encola y ya está. Nadie llama a arrancar() a
// mano, igual que cuando se pulsa un botón en la pantalla.

import { readFileSync } from 'node:fs';
const nada = () => {};
globalThis.window = { addEventListener: nada, dispatchEvent: nada };
globalThis.CustomEvent = class { constructor(t, o) { Object.assign(this, o); this.type = t; } };

// Con «cuota», el Google de mentira contesta 429 a todo, como una cuenta nueva
// con la cuota agotada. Lo que se comprueba entonces NO es que se genere nada
// —no se puede—, sino que la cola NO queme la lista entera contra la pared: seis
// trabajos fallando en seis segundos es lo que pasaba de verdad en producción.
const SIN_CUOTA = process.argv[2] === 'cuota';
const CUANTOS_SIN_CUOTA = 8;

let estado = { cola: [] };
let aLaVez = 0, maximo = 0;
let fila = Promise.resolve();
const clonar = (x) => JSON.parse(JSON.stringify(x));
const RETARDO_DEL_BUCKET_MS = 400;   // lo que tarda de verdad escribir en GCS

const llamadas = [];
const stubs = {
  ErrorDeCara: class extends Error { constructor(m, o = {}) { super(m); this.mensaje = m; this.http = o.http; this.reintentable = !!o.reintentable; } },
  llamar: async (modo) => {
    aLaVez += 1; maximo = Math.max(maximo, aLaVez);
    llamadas.push({ modo, cuando: Date.now() });
    await new Promise((r) => setTimeout(r, 30));
    aLaVez -= 1;
    if (SIN_CUOTA) {
      const fallo = new stubs.ErrorDeCara('Google dice que no hay cuota ahora mismo.',
        { http: 429, reintentable: true });
      throw fallo;
    }
    return { ruta: 'x', url: 'u', ja: 'あ', dur_s: 1 };
  },
  actual: () => estado,
  cargar: async () => estado,
  cambiar: (fn) => {
    const turno = fila.then(async () => {
      await new Promise((r) => setTimeout(r, RETARDO_DEL_BUCKET_MS)); // el viaje al bucket
      const t = clonar(estado);
      const d = await fn(t);
      estado = d && typeof d === 'object' ? d : t;
      return estado;
    });
    fila = turno.then(() => undefined, () => undefined);
    return turno;
  },
  anotarGasto: nada,
  reducirParaVeo: async () => ({ b64: 'AA', bytes: 2 }),
  pesoDeB64: () => 2,
  enBytes: (n) => `${n} B`,
};

let src = readFileSync('app/cola.js', 'utf8');
src = src.replace(/^import\s*\{([^}]+)\}\s*from\s*['"][^'"]+['"];\s*$/gm, (t, d) => {
  const n = d.split(',').map((s) => s.trim()).filter(Boolean)
    .map((s) => { const [de, a] = s.split(/\s+as\s+/); return a ? `${de}: ${a}` : de; });
  return `const { ${n.join(', ')} } = __stubs;`;
});
src = src.replace(/import\.meta\.url/g, "'file:///r/app/'");
const exportados = [...src.matchAll(/^export (?:async )?(?:function|const) (\w+)/gm)].map((m) => m[1]);
src = src.replace(/^export /gm, '');
const cola = new Function('__stubs', `${src}\nreturn { ${exportados.join(', ')} };`)(stubs);

if (SIN_CUOTA) {
  console.log(`GOOGLE NO DA CUOTA. SE ENCOLAN ${CUANTOS_SIN_CUOTA} TRABAJOS.`);
  cola.encolarVarios(Array.from({ length: CUANTOS_SIN_CUOTA }, (_, i) =>
    ({ tipo: 'muestra', args: { personaje: 'p' + i, voz_id: 'Charon' } })));

  // Se mira durante ocho segundos. La primera espera por cuota son treinta, así
  // que en esta ventana NO puede haber más que un puñado de llamadas: una que
  // descubre que no hay cuota y para de la cola.
  await new Promise((r) => setTimeout(r, 8000));

  const enSeisSegundos = llamadas.filter((l) => l.cuando <= llamadas[0].cuando + 6000).length;
  console.log('  encolados                     :', estado.cola.length);
  console.log('  llamadas a Google en 8 s      :', llamadas.length);
  console.log('  llamadas en los primeros 6 s  :', enSeisSegundos);
  console.log('  fallidos de golpe             :', estado.cola.filter((t) => t.estado === 'fallido').length);
  console.log();

  // Lo que se exige: con la cuota agotada, la cola prueba UNA VEZ y para. Antes
  // probaba las ocho seguidas. Se deja margen de dos por si el obrero ya tenía
  // otra en vuelo cuando llegó la negativa.
  const bienCuota = enSeisSegundos <= 2 &&
    estado.cola.filter((t) => t.estado === 'fallido').length === 0;
  console.log(bienCuota
    ? '✓ sin cuota, la cola espera entera en vez de quemar la lista'
    : `✗ mal: ${enSeisSegundos} llamadas en seis segundos, se está quemando la lista`);
  process.exit(bienCuota ? 0 : 1);
}

const cuantos = Number(process.argv[2] || 1);
if (cuantos === 1) {
  console.log('SE PULSA «OÍR ESTA VOZ» UNA VEZ. NADIE LLAMA A arrancar() A MANO.');
  cola.encolar('muestra', { personaje: 'concejal', voz_id: 'Charon' });
} else {
  console.log(`SE PULSA «GENERAR LOS ${cuantos} QUE FALTAN». NADIE LLAMA A arrancar() A MANO.`);
  cola.encolarVarios(Array.from({ length: cuantos }, (_, i) =>
    ({ tipo: 'muestra', args: { personaje: 'p' + i, voz_id: 'Charon' } })));
}

// Se espera de sobra: 6 segundos para un trabajo que tarda 30 ms.
const hasta = Date.now() + 6000 + Number(process.argv[2] || 1) * 1500;
while (Date.now() < hasta) {
  if (estado.cola.length && estado.cola.every((t) => t.estado === 'hecho' || t.estado === 'fallido')) break;
  await new Promise((r) => setTimeout(r, 50));
}

const hechos = estado.cola.filter((t) => t.estado === 'hecho').length;
console.log('  encolados          :', estado.cola.length);
console.log('  hechos             :', hechos);
console.log('  llamadas a Google  :', llamadas.length);
console.log('  máximo a la vez    :', maximo);
console.log();
const bien = hechos === estado.cola.length && estado.cola.length === Number(process.argv[2] || 1) && maximo === 1;
console.log(bien ? '✓ todos hechos, de uno en uno y sin ayuda' : '✗ mal');
process.exit(bien ? 0 : 1);
