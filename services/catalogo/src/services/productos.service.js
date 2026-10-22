const mongoose = require('mongoose');
const { Producto } = require('../models/producto.model');
const { CATEGORIAS } = require('../models/categorias');
const { solicitudInvalida, noEncontrado, conflicto } = require('./errores');

// Reglas de negocio del grupo funcional A (docs/02-responsabilidades.md): qué se
// ofrece, con qué nombre, en qué categoría y a qué precio. Catálogo no conoce el
// stock, ni Raft, ni el lock de Redis.

const CAMPOS_EDITABLES = ['nombre', 'precio', 'categoria'];

// nombreContiene es texto literal, no una expresión regular: sin escapar,
// ?nombreContiene=( hacía fallar la consulta con 500 (observación 12 de
// docs/01-inventario.md).
const escapar = (texto) => texto.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function esIdValido(id) {
  return mongoose.Types.ObjectId.isValid(id);
}

function validarId(id) {
  if (!esIdValido(id)) throw solicitudInvalida('El id debe ser un ObjectId de MongoDB válido');
}

function mensajeDeValidacion(err) {
  return Object.values(err.errors)
    .map((e) => e.message)
    .join('; ');
}

// Solo se aceptan los campos de Catálogo. El stock es de Inventario: si llega, se
// rechaza indicando dónde se ajusta, en lugar de ignorarlo en silencio (Caso 2).
function tomarCampos(body) {
  if (body.stock !== undefined) {
    throw solicitudInvalida('El stock no se modifica en Catálogo: se ajusta con PUT /stock/:productoId en Inventario');
  }
  const desconocidos = Object.keys(body).filter((c) => !CAMPOS_EDITABLES.includes(c));
  if (desconocidos.length > 0) {
    throw solicitudInvalida(`Campos no permitidos: ${desconocidos.join(', ')}. Solo se aceptan: ${CAMPOS_EDITABLES.join(', ')}`);
  }
  return Object.fromEntries(CAMPOS_EDITABLES.filter((c) => body[c] !== undefined).map((c) => [c, body[c]]));
}

async function validar(producto) {
  try {
    await producto.validate();
  } catch (err) {
    if (err instanceof mongoose.Error.ValidationError) throw solicitudInvalida(mensajeDeValidacion(err));
    throw err;
  }
}

async function verificarNombreLibre(nombre, idPropio) {
  const filtro = idPropio ? { nombre, _id: { $ne: idPropio } } : { nombre };
  if (await Producto.exists(filtro)) throw conflicto(`Ya existe un producto con el nombre "${nombre}"`);
}

// El chequeo previo de nombre libre no cubre dos altas simultáneas con el mismo
// nombre: en ese caso el índice único de Mongo rechaza la segunda (E11000).
async function guardar(producto) {
  try {
    return await producto.save();
  } catch (err) {
    if (err.code === 11000) throw conflicto(`Ya existe un producto con el nombre "${producto.nombre}"`);
    throw err;
  }
}

// ?ids=a,b,c (o ?ids=a&ids=b) → lista de ids sin repetir. Contrato C1: un id mal
// formado se trata igual que uno inexistente (no aparece), así que se descarta acá.
function separarIds(ids) {
  const valores = Array.isArray(ids) ? ids : [ids];
  if (!valores.every((v) => typeof v === 'string')) {
    throw solicitudInvalida('El parámetro "ids" debe ser una lista de ids separados por coma');
  }
  const lista = valores.flatMap((v) => v.split(',')).map((v) => v.trim());
  return [...new Set(lista)].filter(esIdValido);
}

async function listar({ nombreContiene, categoria, ids }) {
  if (nombreContiene !== undefined && typeof nombreContiene !== 'string') {
    throw solicitudInvalida('El parámetro "nombreContiene" debe ser texto');
  }
  if (categoria !== undefined && !CATEGORIAS.includes(categoria)) {
    throw solicitudInvalida(`El parámetro "categoria" debe ser una de: ${CATEGORIAS.join(', ')}`);
  }

  const filtro = {};
  if (nombreContiene) filtro.nombre = { $regex: escapar(nombreContiene), $options: 'i' };
  if (categoria) filtro.categoria = categoria;
  if (ids !== undefined) filtro._id = { $in: separarIds(ids) };

  return Producto.find(filtro).sort({ createdAt: 1 });
}

async function obtener(id) {
  validarId(id);
  const producto = await Producto.findById(id);
  if (!producto) throw noEncontrado(`Producto con id ${id} no encontrado`);
  return producto;
}

async function crear(body) {
  const producto = new Producto(tomarCampos(body));
  await validar(producto);
  await verificarNombreLibre(producto.nombre);
  return guardar(producto);
}

async function actualizar(id, body) {
  validarId(id);
  const cambios = tomarCampos(body);
  if (Object.keys(cambios).length === 0) {
    throw solicitudInvalida(`Debe enviar al menos uno de estos campos: ${CAMPOS_EDITABLES.join(', ')}`);
  }

  const producto = await obtener(id);
  producto.set(cambios);
  await validar(producto);
  if (cambios.nombre !== undefined) await verificarNombreLibre(producto.nombre, id);
  return guardar(producto);
}

// Baja lógica: activo = false. Repetirla no es un error (sigue dado de baja).
async function eliminar(id) {
  validarId(id);
  const resultado = await Producto.updateOne({ _id: id }, { activo: false });
  if (resultado.matchedCount === 0) throw noEncontrado(`Producto con id ${id} no encontrado`);
}

module.exports = { listar, obtener, crear, actualizar, eliminar };
