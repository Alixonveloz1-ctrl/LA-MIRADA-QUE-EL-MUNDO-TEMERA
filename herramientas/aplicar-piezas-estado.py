from pathlib import Path
import json


def reemplazar(ruta, viejo, nuevo, veces=1):
    p = Path(ruta)
    texto = p.read_text()
    encontrados = texto.count(viejo)
    if encontrados != veces:
        raise SystemExit(f'{ruta}: esperaba {veces} coincidencia(s), encontré {encontrados}')
    p.write_text(texto.replace(viejo, nuevo, veces))


# Tomas: serie.json sigue siendo la base; estado.piezas se superpone en cada repintado.
reemplazar(
    'app/pantallas/tomas.js',
    "      let modelo;\n      try {\n        modelo = construirModelo(await laSerie());",
    "      let datos;\n      let modelo;\n      try {\n        datos = await laSerie();\n        modelo = construirModelo(datos, leerEstado());"
)
reemplazar(
    'app/pantallas/tomas.js',
    "      const repintar = () => {\n        sonando.clear();",
    "      const repintar = () => {\n        modelo = construirModelo(datos, leerEstado());\n        sonando.clear();"
)
reemplazar(
    'app/pantallas/tomas.js',
    "function construirModelo(datos) {\n  const mapa = esObjeto(datos) && esObjeto(datos.piezas) ? datos.piezas : {};",
    "function construirModelo(datos, estado = {}) {\n  const estaticas = esObjeto(datos) && esObjeto(datos.piezas) ? datos.piezas : {};\n  const dinamicas = esObjeto(estado) && esObjeto(estado.piezas) ? estado.piezas : {};\n  const mapa = { ...estaticas, ...dinamicas };"
)

# Audio: selector y bloques usan la misma superposición.
reemplazar(
    'app/pantallas/audio.js',
    "function piezasDeLaSerie(serie) {\n  const piezas = esObjeto(serie.piezas) ? serie.piezas : {};",
    "function piezasDeLaSerie(serie, estado = {}) {\n  const estaticas = esObjeto(serie.piezas) ? serie.piezas : {};\n  const dinamicas = esObjeto(estado) && esObjeto(estado.piezas) ? estado.piezas : {};\n  const piezas = { ...estaticas, ...dinamicas };"
)
reemplazar(
    'app/pantallas/audio.js',
    "function piezaActiva(serie, estado) {\n  const todas = piezasDeLaSerie(serie);",
    "function piezaActiva(serie, estado) {\n  const todas = piezasDeLaSerie(serie, estado);"
)
reemplazar(
    'app/pantallas/audio.js',
    "  const todas = piezasDeLaSerie(serie);\n  const musica = musicaDeLaPieza(serie, pieza.id, todas.length);",
    "  const todas = piezasDeLaSerie(serie, estado);\n  const musica = musicaDeLaPieza(serie, pieza.id, todas.length);"
)

# Desglose: conservar el diálogo y escribirlo en la pieza.
reemplazar(
    'app/pantallas/desglose.js',
    "          lineas: Array.isArray(una.dialogo) ? una.dialogo.length : 0,\n          accion: texto(una.accion)",
    "          dialogo: (Array.isArray(una.dialogo) ? una.dialogo : [])\n            .map((linea) => ({\n              quien: texto(linea && linea.quien),\n              es: texto(linea && (linea.texto ?? linea.es)),\n              ja: texto(linea && linea.ja),\n              intencion: texto(linea && linea.intencion) || null\n            }))\n            .filter((linea) => linea.quien && linea.es),\n          lineas: Array.isArray(una.dialogo) ? una.dialogo.length : 0,\n          accion: texto(una.accion)"
)

marca = "async function armarLaPieza(episodio, modelo, sello) {"
helper = r'''function vozDelEpisodio(episodio, tomas) {
  const salida = [];

  for (const escena of episodio.escenas) {
    const lineas = Array.isArray(escena.dialogo) ? escena.dialogo : [];
    if (!lineas.length) continue;

    const suyas = tomas.filter((toma) => String(toma.escena) === String(escena.escena));
    if (!suyas.length) continue;

    const desde = Math.min(...suyas.map((toma) => Number(toma.inicio) || 0));
    const fin = Math.max(
      ...suyas.map((toma) => (Number(toma.inicio) || 0) + (Number(toma.dur) || 0))
    );
    const duracion = Math.max(0, fin - desde);
    const paso = lineas.length ? duracion / lineas.length : 0;

    lineas.forEach((linea, indice) => {
      const t = desde + paso * indice;
      const hasta = indice === lineas.length - 1 ? fin : desde + paso * (indice + 1);
      salida.push({
        quien: linea.quien,
        es: linea.es,
        ja: linea.ja || '',
        intencion: linea.intencion,
        escena: String(escena.escena),
        t: Number(t.toFixed(3)),
        hasta: Number(hasta.toFixed(3))
      });
    });
  }

  return salida;
}

async function armarLaPieza(episodio, modelo, sello) {'''
reemplazar('app/pantallas/desglose.js', marca, helper)
reemplazar(
    'app/pantallas/desglose.js',
    "      : null,\n    tomas\n  };",
    "      : null,\n    audio: { voz: vozDelEpisodio(episodio, tomas) },\n    tomas\n  };"
)

# Backend de datos: serie.json por defecto, pieza alternativa desde estado cuando se pasa.
reemplazar(
    'api/_lib/datos.js',
    "export function pieza(id) {\n  const piezas = serie.piezas || {};",
    "export function pieza(id, alternativa = null) {\n  if (alternativa && typeof alternativa === 'object' && !Array.isArray(alternativa)) {\n    const idAlternativo = alternativa.id == null ? '' : String(alternativa.id);\n    if (!idAlternativo || idAlternativo === String(id)) return alternativa;\n  }\n  const piezas = serie.piezas || {};"
)
reemplazar(
    'api/_lib/datos.js',
    "export function toma(idPieza, idToma) {\n  const laPieza = pieza(idPieza);",
    "export function toma(idPieza, idToma, piezaAlternativa = null) {\n  const laPieza = pieza(idPieza, piezaAlternativa);"
)
reemplazar(
    'api/_lib/datos.js',
    "function lineasCrudas(idPieza) {\n  const laPieza = pieza(idPieza);",
    "function lineasCrudas(idPieza, piezaAlternativa = null) {\n  const laPieza = pieza(idPieza, piezaAlternativa);"
)
reemplazar(
    'api/_lib/datos.js',
    "export function lineasDeVoz(idPieza) {\n  return lineasCrudas(idPieza).map((l) => ({",
    "export function lineasDeVoz(idPieza, piezaAlternativa = null) {\n  return lineasCrudas(idPieza, piezaAlternativa).map((l) => ({"
)
reemplazar(
    'api/_lib/datos.js',
    "export function bloquesDeVoz(idPieza) {\n  const laPieza = pieza(idPieza);\n  const tomas = laPieza.tomas || [];\n  const lineas = lineasCrudas(idPieza);",
    "export function bloquesDeVoz(idPieza, piezaAlternativa = null) {\n  const laPieza = pieza(idPieza, piezaAlternativa);\n  const tomas = laPieza.tomas || [];\n  const lineas = lineasCrudas(idPieza, piezaAlternativa);"
)

# Prompts dinámicos.
reemplazar(
    'api/_lib/prompt.js',
    "export function promptKeyframe(idPieza, idToma) {\n  const laToma = toma(idPieza, idToma);",
    "export function promptKeyframe(idPieza, idToma, piezaAlternativa = null) {\n  const laToma = toma(idPieza, idToma, piezaAlternativa);"
)
reemplazar(
    'api/_lib/prompt.js',
    "export function promptVideo(idPieza, idToma) {\n  const laToma = toma(idPieza, idToma);",
    "export function promptVideo(idPieza, idToma, piezaAlternativa = null) {\n  const laToma = toma(idPieza, idToma, piezaAlternativa);"
)
reemplazar(
    'api/_lib/prompt.js',
    "export function guionDeVoz(idPieza, idBloque) {\n  const bloques = bloquesDeVoz(idPieza);\n  const elBloque = bloques.find((b) => b.id === String(idBloque));",
    "export function guionDeVoz(idPieza, idBloque, piezaAlternativa = null, bloqueAlternativo = null) {\n  const bloques = bloquesDeVoz(idPieza, piezaAlternativa);\n  const elBloque =\n    bloqueAlternativo && bloqueAlternativo.id === String(idBloque)\n      ? bloqueAlternativo\n      : bloques.find((b) => b.id === String(idBloque));"
)

# Resolver explícitamente la pieza del estado en modos.js.
reemplazar(
    'api/_lib/modos.js',
    "function soloTexto(valor) {\n  return typeof valor === 'string' ? valor.trim() : valor == null ? '' : String(valor).trim();\n}",
    "function soloTexto(valor) {\n  return typeof valor === 'string' ? valor.trim() : valor == null ? '' : String(valor).trim();\n}\n\nfunction piezaDelEstado(estado, idPieza) {\n  if (!esObjeto(estado) || !esObjeto(estado.piezas)) return null;\n  const encontrada = estado.piezas[idPieza];\n  return esObjeto(encontrada) ? encontrada : null;\n}"
)

# Imagen.
reemplazar(
    'api/_lib/modos.js',
    "  const modelo = nivelImagen(nivel);\n\n  let compuesto;",
    "  const modelo = nivelImagen(nivel);\n  const leido = await leerElEstado();\n\n  let compuesto;"
)
reemplazar(
    'api/_lib/modos.js',
    "    idPiezaDelKeyframe = exigirTexto(cuerpo, 'pieza', 'de qué pieza es la toma del keyframe');\n    tomaDeLaPieza(idPiezaDelKeyframe, id);\n    compuesto = promptKeyframe(idPiezaDelKeyframe, id);",
    "    idPiezaDelKeyframe = exigirTexto(cuerpo, 'pieza', 'de qué pieza es la toma del keyframe');\n    const piezaEnEstado = piezaDelEstado(leido.estado, idPiezaDelKeyframe);\n    tomaDeLaPieza(idPiezaDelKeyframe, id, piezaEnEstado);\n    compuesto = promptKeyframe(idPiezaDelKeyframe, id, piezaEnEstado);"
)
reemplazar(
    'api/_lib/modos.js',
    "\n  const leido = await leerElEstado();\n\n  // Cada referencia tiene que estar APROBADA.",
    "\n  // Cada referencia tiene que estar APROBADA."
)

# Veo lanzar.
reemplazar(
    'api/_lib/modos.js',
    "  const idPieza = exigirTexto(cuerpo, 'pieza', 'de qué pieza es la toma');\n  const idToma = exigirTexto(cuerpo, 'toma', 'qué toma se genera');\n  const laToma = tomaDeLaPieza(idPieza, idToma);\n  const clave = `${idPieza}/${idToma}`;\n\n  const leido = await leerElEstado();",
    "  const idPieza = exigirTexto(cuerpo, 'pieza', 'de qué pieza es la toma');\n  const idToma = exigirTexto(cuerpo, 'toma', 'qué toma se genera');\n  const clave = `${idPieza}/${idToma}`;\n\n  const leido = await leerElEstado();\n  const piezaEnEstado = piezaDelEstado(leido.estado, idPieza);\n  const laToma = tomaDeLaPieza(idPieza, idToma, piezaEnEstado);"
)
reemplazar(
    'api/_lib/modos.js',
    "  const encargo = promptVideo(idPieza, idToma);",
    "  const encargo = promptVideo(idPieza, idToma, piezaEnEstado);"
)

# Veo consultar.
reemplazar(
    'api/_lib/modos.js',
    "  const idPieza = exigirTexto(cuerpo, 'pieza', 'de qué pieza es la toma');\n  const idToma = exigirTexto(cuerpo, 'toma', 'qué toma se estaba generando');\n  const laToma = tomaDeLaPieza(idPieza, idToma);\n  const clave = `${idPieza}/${idToma}`;\n\n  // El nombre de la operación se lee del estado, NO de lo que mande el\n  // navegador: lleva el project id dentro y por eso nunca ha viajado hasta allí.\n  const antesDeConsultar = await leerElEstado();",
    "  const idPieza = exigirTexto(cuerpo, 'pieza', 'de qué pieza es la toma');\n  const idToma = exigirTexto(cuerpo, 'toma', 'qué toma se estaba generando');\n  const clave = `${idPieza}/${idToma}`;\n\n  // El nombre de la operación se lee del estado, NO de lo que mande el\n  // navegador: lleva el project id dentro y por eso nunca ha viajado hasta allí.\n  const antesDeConsultar = await leerElEstado();\n  const piezaEnEstado = piezaDelEstado(antesDeConsultar.estado, idPieza);\n  const laToma = tomaDeLaPieza(idPieza, idToma, piezaEnEstado);"
)

# Voz: usar la pieza dinámica, traducir solo el bloque pedido y conservar el japonés.
viejo_voz = """async function modoVoz(cuerpo) {
  const idPieza = exigirTexto(cuerpo, 'pieza', 'de qué pieza es el bloque de voz');
  const idBloque = exigirTexto(cuerpo, 'bloque', 'qué bloque de voz se genera');

  // `guionDeVoz()` ya se planta con su frase en español si el bloque no existe,
  // así que a partir de aquí el bloque está.
  const guion = guionDeVoz(idPieza, idBloque);
  const elBloque = bloquesDeVoz(idPieza).find((b) => b.id === idBloque);

  const leido = await leerElEstado();
"""
nuevo_voz = """async function modoVoz(cuerpo) {
  const idPieza = exigirTexto(cuerpo, 'pieza', 'de qué pieza es el bloque de voz');
  const idBloque = exigirTexto(cuerpo, 'bloque', 'qué bloque de voz se genera');

  const leido = await leerElEstado();
  const piezaEnEstado = piezaDelEstado(leido.estado, idPieza);
  const encontrado = bloquesDeVoz(idPieza, piezaEnEstado).find((b) => b.id === idBloque);

  if (!encontrado) {
    guionDeVoz(idPieza, idBloque, piezaEnEstado);
  }

  const elBloque = {
    ...encontrado,
    lineas: encontrado.lineas.map((linea) => ({ ...linea }))
  };

  for (const linea of elBloque.lineas) {
    if (soloTexto(linea.ja)) continue;
    linea.ja = await traducirAJapones(linea.es, linea.intencion || '');
  }

  const guion = guionDeVoz(idPieza, idBloque, piezaEnEstado, elBloque);
"""
reemplazar('api/_lib/modos.js', viejo_voz, nuevo_voz)

reemplazar(
    'api/_lib/modos.js',
    "      const entrada = estado.audio.voz[clave];\n      entrada.ruta = ruta;",
    "      const entrada = estado.audio.voz[clave];\n\n      if (piezaEnEstado && esObjeto(estado.piezas) && esObjeto(estado.piezas[idPieza])) {\n        const piezaGuardada = estado.piezas[idPieza];\n        const audioPieza = esObjeto(piezaGuardada.audio) ? piezaGuardada.audio : null;\n        const lineasGuardadas = audioPieza && Array.isArray(audioPieza.voz) ? audioPieza.voz : [];\n        const usadas = new Set();\n        for (const traducida of elBloque.lineas) {\n          const indice = lineasGuardadas.findIndex((cruda, i) =>\n            !usadas.has(i) &&\n            esObjeto(cruda) &&\n            soloTexto(cruda.quien) === soloTexto(traducida.quien) &&\n            soloTexto(cruda.es) === soloTexto(traducida.es) &&\n            Number(cruda.t) === Number(traducida.t)\n          );\n          if (indice >= 0) {\n            lineasGuardadas[indice].ja = traducida.ja;\n            usadas.add(indice);\n          }\n        }\n      }\n\n      entrada.ruta = ruta;"
)

# Prueba focalizada del flujo.
prueba = r'''import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { serie, pieza, toma, bloquesDeVoz } from '../api/_lib/datos.js';
import { promptKeyframe, promptVideo, guionDeVoz } from '../api/_lib/prompt.js';

const base = serie.piezas.teaser;
assert.ok(base, 'La prueba necesita la pieza teaser preexistente');
const tomaBase = base.tomas.find((una) => una && una.imagen && una.video);
assert.ok(tomaBase, 'La prueba necesita una toma del teaser con imagen y vídeo');

const dinamica = {
  id: 'ep99',
  titulo: 'Episodio de prueba',
  duracion_s: Number(tomaBase.dur) || 4,
  tomas: [{ ...tomaBase, id: '1-1', escena: '1', inicio: 0 }],
  audio: {
    voz: [{
      quien: 'madre',
      es: 'No mires atrás.',
      ja: '振り返らないで。',
      intencion: 'susurro urgente',
      escena: '1',
      t: 0,
      hasta: Math.max(1, Number(tomaBase.dur) || 4)
    }]
  }
};

assert.equal(pieza('ep99', dinamica), dinamica);
assert.equal(toma('ep99', '1-1', dinamica).id, '1-1');
assert.ok(promptKeyframe('ep99', '1-1', dinamica).texto.length > 20);
assert.ok(promptVideo('ep99', '1-1', dinamica).texto.length > 20);

const bloques = bloquesDeVoz('ep99', dinamica);
assert.equal(bloques.length, 1);
assert.equal(bloques[0].id, 'esc-1');
const guion = guionDeVoz('ep99', 'esc-1', dinamica);
assert.equal(guion.partes.length, 1);
assert.equal(guion.partes[0].texto_ja, '振り返らないで。');

const tomasUi = readFileSync(new URL('../app/pantallas/tomas.js', import.meta.url), 'utf8');
const audioUi = readFileSync(new URL('../app/pantallas/audio.js', import.meta.url), 'utf8');
const desgloseUi = readFileSync(new URL('../app/pantallas/desglose.js', import.meta.url), 'utf8');
assert.match(tomasUi, /const dinamicas = .*estado\.piezas/);
assert.match(tomasUi, /modelo = construirModelo\(datos, leerEstado\(\)\)/);
assert.match(audioUi, /const dinamicas = .*estado\.piezas/);
assert.match(desgloseUi, /audio: \{ voz: vozDelEpisodio\(episodio, tomas\) \}/);

console.log('✓ Desglose → Tomas → Imagen → Vídeo → Audio/Voz acepta piezas de estado.json');
'''
Path('herramientas/probar-piezas-estado.mjs').write_text(prueba)

paquete = json.loads(Path('package.json').read_text())
scripts = paquete['scripts']
scripts['piezas-estado'] = 'node herramientas/probar-piezas-estado.mjs'
if 'npm run piezas-estado' not in scripts['comprobar']:
    scripts['comprobar'] = scripts['comprobar'].replace(
        'npm run invariantes',
        'npm run invariantes && npm run piezas-estado',
        1
    )
Path('package.json').write_text(json.dumps(paquete, ensure_ascii=False, indent=2) + '\n')
