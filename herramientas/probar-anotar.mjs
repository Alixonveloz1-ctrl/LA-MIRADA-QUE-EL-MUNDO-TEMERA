#!/usr/bin/env node
// LO QUE YA ESTÁ PAGADO SE APUNTA, AUNQUE OTRO ESTÉ ESCRIBIENDO A LA VEZ.
//
// El fallo que trajo esto: «La imagen se ha generado bien y está guardada en el
// bucket. Lo único que ha fallado es apuntarla en el estado.» O sea, la peor
// combinación posible — generada, subida, COBRADA, y sin apuntar.
//
// La causa era una secuencia que solo se ve mirándola entera:
//
//   1. La función LEE el estado (versión 100).
//   2. GENERA la imagen: treinta o cuarenta segundos.
//   3. Intenta ESCRIBIR con la versión 100.
//
// Pero en esos cuarenta segundos el navegador ha escrito el latido de la cola dos
// o tres veces, así que la versión ya va por la 103. El paso 3 es un 409
// GARANTIZADO, no una carrera desafortunada. Y como solo había un reintento, ese
// choque seguro se lo comía entero.
//
// Aquí se reproduce: se escribe con un estado viejo mientras «otro» escribe cada
// poco, y se exige que el cambio acabe guardado.

let version = 100;
let guardado = { banco: {} };
const escrituras = [];

// El «otro» que escribe: el latido de la cola del navegador.
function latido() {
  version += 1;
}

class ErrorDeCara extends Error {
  constructor(m, o = {}) { super(m); this.mensaje = m; Object.assign(this, o); }
}

async function leerElEstado() {
  return { estado: JSON.parse(JSON.stringify(guardado)), generacion: String(version) };
}

async function escribirElEstado(estado, generacion) {
  escrituras.push(generacion);
  if (String(generacion) !== String(version)) {
    throw new ErrorDeCara('Otro ha guardado por debajo.', { http: 409, reintentable: true });
  }
  guardado = JSON.parse(JSON.stringify(estado));
  version += 1;
  return { generacion: String(version) };
}

const VUELTAS_DEL_ESTADO = 4;

async function cambiarElEstado(aplicar, yaLeido = null) {
  let partida = yaLeido;
  for (let vuelta = 1; vuelta <= VUELTAS_DEL_ESTADO; vuelta += 1) {
    const actual = partida || (await leerElEstado());
    partida = null;
    const devuelto = aplicar(actual.estado);
    try {
      const { generacion } = await escribirElEstado(actual.estado, actual.generacion);
      return { estado: actual.estado, generacion, devuelto };
    } catch (fallo) {
      const esCarrera = fallo instanceof ErrorDeCara && fallo.http === 409;
      if (!esCarrera || vuelta === VUELTAS_DEL_ESTADO) throw fallo;
    }
  }
}

let mal = 0;
const di = (bien, que, extra = '') => {
  if (!bien) mal++;
  console.log(`  ${bien ? '✓' : '✗'} ${que}${extra ? ` — ${extra}` : ''}`);
};

console.log('\nAPUNTAR LO QUE YA ESTÁ PAGADO\n');

// ── Lo que pasaba antes: escribir con el estado leído ANTES de generar ──────
const antesDeGenerar = await leerElEstado();
latido(); latido(); latido();          // cuarenta segundos de generación
escrituras.length = 0;
let fallo = null;
try {
  await cambiarElEstado((e) => { e.banco.uno = 'ruta1'; }, antesDeGenerar);
} catch (e) { fallo = e; }
di(!fallo && guardado.banco.uno === 'ruta1',
  'Con el estado viejo Y tres latidos, se apunta igual',
  `intentos: ${escrituras.length}`);
di(escrituras.length > 1, 'Y hizo falta más de un intento, que es lo que se estaba probando',
  `${escrituras.length} intentos`);

// ── Lo que hace ahora: releer siempre, que es lo que hace anotarLoGenerado ──
const viejoOtraVez = await leerElEstado();
latido(); latido(); latido();
escrituras.length = 0;
fallo = null;
try {
  await cambiarElEstado((e) => { e.banco.dos = 'ruta2'; }, null);   // ← null: relee
} catch (e) { fallo = e; }
di(!fallo && guardado.banco.dos === 'ruta2', 'Releyendo, se apunta a la PRIMERA',
  `intentos: ${escrituras.length}`);
di(escrituras.length === 1, 'Sin gastar ni un reintento en un choque que era seguro',
  `${escrituras.length} intento`);
void viejoOtraVez;

// ── Y si de verdad hay una tormenta, se rinde y lo dice ─────────────────────
escrituras.length = 0;
fallo = null;
try {
  await cambiarElEstado((e) => { latido(); e.banco.tres = 'ruta3'; }, null);
} catch (e) { fallo = e; }
di(Boolean(fallo) && fallo.http === 409, 'Con un latido en CADA vuelta, se rinde y dice que fue una carrera');
di(escrituras.length === VUELTAS_DEL_ESTADO, `Y probó las ${VUELTAS_DEL_ESTADO} vueltas antes de rendirse`,
  `${escrituras.length} intentos`);

console.log(mal === 0 ? '\nTodo bien.\n' : `\n${mal} MAL.\n`);
process.exit(mal ? 1 : 0);
