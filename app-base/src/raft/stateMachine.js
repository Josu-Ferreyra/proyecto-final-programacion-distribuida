// State Machine replicada (Hito 5).
//
// Es el ÚNICO lugar del TP4 que modifica la colección de productos. Recibe entradas
// que el protocolo ya dio por committed, en orden de índice, y las aplica a la base
// Mongo local del nodo. Como las tres réplicas aplican los mismos comandos en el mismo
// orden partiendo del mismo estado, terminan con el mismo estado.
//
// Para que eso se cumpla, el comando trae todo lo no determinístico ya resuelto por el
// Leader: el _id del producto, las marcas de tiempo y, en la compra, el stock resultante.
//
// Los errores de negocio (nombre duplicado, producto inexistente, validación) no son
// excepciones: se devuelven como resultado. Son determinísticos, así que todas las
// réplicas llegan a la misma conclusión y el log sigue avanzando.

const mongoose = require('mongoose');
const { Producto } = require('../models/producto.model');

const TIPOS = Object.freeze({
  NOOP: 'NOOP',
  CREAR_PRODUCTO: 'CREAR_PRODUCTO',
  ACTUALIZAR_PRODUCTO: 'ACTUALIZAR_PRODUCTO',
  ELIMINAR_PRODUCTO: 'ELIMINAR_PRODUCTO',
  COMPRAR_PRODUCTO: 'COMPRAR_PRODUCTO',
});

function mensajeDeValidacion(err) {
  return Object.values(err.errors)
    .map((e) => e.message)
    .join('; ');
}

function rechazo(status, error) {
  return { ok: false, status, body: { error } };
}

// Traduce errores de Mongo/Mongoose de negocio a resultados; el resto se relanza.
function erroresDeNegocio(err, nombre) {
  if (err instanceof mongoose.Error.ValidationError) return rechazo(400, mensajeDeValidacion(err));
  if (err.code === 11000) return rechazo(409, `Ya existe un producto con el nombre "${nombre}"`);
  throw err;
}

async function crear(entrada) {
  const { id, datos, timestamp } = entrada.comando;

  const existente = await Producto.findById(id);
  if (existente) {
    // Re-aplicación tras un reinicio (se cayó entre aplicar y guardar lastApplied).
    return { ok: true, status: 201, body: existente.toJSON() };
  }

  try {
    const producto = new Producto({
      _id: id,
      ...datos,
      version: 1,
      ultimoIndiceRaft: entrada.index,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    await producto.save();
    return { ok: true, status: 201, body: producto.toJSON() };
  } catch (err) {
    return erroresDeNegocio(err, datos.nombre);
  }
}

async function actualizar(entrada, cambios) {
  const { id, timestamp } = entrada.comando;

  const producto = await Producto.findById(id);
  if (!producto) return rechazo(404, `Producto con id ${id} no encontrado`);

  if (producto.ultimoIndiceRaft >= entrada.index) {
    return { ok: true, status: 200, body: producto.toJSON() }; // ya aplicada
  }

  producto.set(cambios);
  producto.version += 1;
  producto.ultimoIndiceRaft = entrada.index;
  producto.updatedAt = timestamp;

  try {
    await producto.save();
    return { ok: true, status: 200, body: producto.toJSON() };
  } catch (err) {
    return erroresDeNegocio(err, cambios.nombre);
  }
}

async function eliminar(entrada) {
  const { id } = entrada.comando;
  const producto = await Producto.findByIdAndDelete(id);
  if (!producto) return rechazo(404, `Producto con id ${id} no encontrado`);
  return { ok: true, status: 204, body: null };
}

async function comprar(entrada) {
  const { id, cantidad, stockNuevo } = entrada.comando;
  const resultado = await actualizar(entrada, { stock: stockNuevo });
  if (!resultado.ok) return resultado;
  const p = resultado.body;
  return {
    ok: true,
    status: 200,
    body: { id: p.id, nombre: p.nombre, comprado: cantidad, stockRestante: p.stock, version: p.version },
  };
}

async function aplicar(entrada) {
  const { comando } = entrada;
  switch (comando.tipo) {
    case TIPOS.NOOP:
      return { ok: true, status: 200, body: null };
    case TIPOS.CREAR_PRODUCTO:
      return crear(entrada);
    case TIPOS.ACTUALIZAR_PRODUCTO:
      return actualizar(entrada, comando.cambios);
    case TIPOS.ELIMINAR_PRODUCTO:
      return eliminar(entrada);
    case TIPOS.COMPRAR_PRODUCTO:
      return comprar(entrada);
    default:
      return rechazo(400, `Tipo de comando desconocido: ${comando.tipo}`);
  }
}

module.exports = { aplicar, TIPOS };
