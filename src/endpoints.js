import express from "express";
import mongoose from "mongoose";
import Resource from "./models/product.js";
import {acquireLock, releaseLock} from "./redis.js";
import {log} from "./logger.js";
import {getLocalRaftInfo, submitRaftCommand} from "./raft/commandClient.js";

const router = express.Router();
const RESERVATION_DELAY_MS = 3000;
const LOCK_TTL_MS = 5000;

// -----------------------------------------------------------------------------
// Utilidades
// -----------------------------------------------------------------------------
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}


function isValidId(id) {
    return mongoose.isValidObjectId(id);
}


function hasRequiredResourceFields(body) {
    return (
        body &&
        body.codigo !== undefined &&
        body.nombre !== undefined &&
        body.precio !== undefined &&
        body.stock !== undefined
    );
}


function isDuplicateKeyError(error) {
    return error && error.code === 11000;
}


function isValidationError(error) {
    return error && error.name === "ValidationError";
}


function requireLeader(res) {
    const raft = getLocalRaftInfo();
    if (raft.isLeader) { 
        return true;
    }

    res
        .status(409)
        .json({
            ok: false,
            error: "NOT_LEADER",
            nodeId: raft.nodeId,
            role: raft.role,
            term: raft.term,
            leaderId: raft.leaderId
        });

    return false;
}


// -----------------------------------------------------------------------------
// GET /api
// -----------------------------------------------------------------------------
router.get("/", (req, res) => {
    const raft = getLocalRaftInfo();

    return res
        .status(200)
        .json({
            service: "TP4 - API REST Distribuida con Raft",
            status: "OK",
            database: "MongoDB + Mongoose",
            coordination: "Redis / Memurai",
            consensus: "Raft",
            raft: {
                nodeId: raft.nodeId,
                role: raft.role,
                term: raft.term,
                leaderId: raft.leaderId
            }
        });
});


// -----------------------------------------------------------------------------
// GET /api/productos
// -----------------------------------------------------------------------------
router.get("/productos", async (req, res) => {
    try {
        const resources = await Resource.find().sort({createdAt: 1});

        log.info(`Productos consultados: ${resources.length}`);

        return res.status(200).json(resources);

    } catch (error) {
        log.error(`Error consultando productos: ${error.message}`);

        return res.status(500).json({
            error: "Error interno del servidor"
        });
    }
});


// -----------------------------------------------------------------------------
// GET /api/productos/:id
// -----------------------------------------------------------------------------
router.get("/productos/:id", async (req, res) => {
    const id = req.params.id;

    if (!isValidId(id)) {
        return res.status(400).json({
            error: "ID inválido"
        });
    }

    try {
        const resource = await Resource.findById(id);
        if (!resource) {
            log.warn(`Producto no encontrado: id=${id}`);

            return res.status(404).json({
                error: "Producto no encontrado"
            });
        }

        return res.status(200).json(resource);

    } catch (error) {
        log.error(`Error consultando producto id=${id}: ${error.message}`);

        return res.status(500).json({
            error: "Error interno del servidor"
        });
    }
});


// =============================================================================
// POST /api/productos
//
// CREATE mediante Raft.
//
// NO escribe directamente en MongoDB.
// =============================================================================
router.post("/productos", async (req, res) => {
        if (!requireLeader(res)) {
            return;
        }


        if (!hasRequiredResourceFields(req.body)) {
            return res
                .status(400)
                .json({
                    error: "Los campos codigo, nombre, precio y stock son obligatorios"
                });
        }

        try {
            const existing = await Resource.findOne({codigo: req.body.codigo});
            if (existing) {
                log.warn(`Código de producto duplicado: ${req.body.codigo}`);

                return res
                    .status(409)
                    .json({
                        error: "Ya existe un producto con ese código"
                    });
            }

            const raftResult = await submitRaftCommand("PRODUCT_CREATE", {
                        codigo: req.body.codigo,
                        nombre: req.body.nombre,
                        precio: req.body.precio,
                        stock: req.body.stock
                    }
                );

            if (!raftResult.ok) {
                return res .status(raftResult.status).json(raftResult.data);
            }

            const resourceId = raftResult.data?.entry?.command?.payload?._id;
            const resource = await Resource.findById(resourceId);
            if (!resource) {
                log.error(`RAFT_CREATE_APPLIED_BUT_RESOURCE_NOT_FOUND | id=${resourceId}`);

                return res
                    .status(500)
                    .json({
                        error: "El comando fue confirmado pero no se encontró el producto aplicado"
                    });
            }

            log.info(
                `Producto creado mediante Raft: ` +
                `id=${resource._id} | ` +
                `leader=${raftResult.data.leaderId} | ` +
                `term=${raftResult.data.term} | ` +
                `commitIndex=${raftResult.data.commitIndex}`
            );

            return res
                .status(201)
                .json(resource);
        }
        catch (error) {
            if (isDuplicateKeyError(error)) {
                return res
                    .status(409)
                    .json({
                        error: "Ya existe un producto con ese código"
                    });
            }

            if (isValidationError(error)) {
                return res
                    .status(400)
                    .json({
                        error: error.message
                    });

            }

            log.error(`Error creando producto mediante Raft: ` +`${error.message}`);
            return res
                .status(500)
                .json({
                    error: "Error interno del servidor"
                });
        }
    }
);


// =============================================================================
// PUT /api/productos/:id
//
// UPDATE mediante Raft.
// =============================================================================
router.put("/productos/:id", async (req, res) => {
        const id = req.params.id;
        if (!requireLeader(res)) {
            return;
        }

        if (!isValidId(id)) {
            return res
                .status(400)
                .json({
                    error: "ID inválido"
                });
        }

        if (!hasRequiredResourceFields(req.body)) {
            return res
                .status(400)
                .json({
                    error: "Los campos codigo, nombre, precio y stock son obligatorios"
                });
        }

        try {
            const existing = await Resource.findById(id);
            if (!existing) {
                log.warn(`Producto no encontrado para actualizar: id=${id}`);

                return res
                    .status(404)
                    .json({
                        error: "Producto no encontrado"
                    });
            }

            const duplicate = await Resource.findOne({
                    codigo: req.body.codigo,
                    _id: { 
                        $ne: id
                    }
                });

            if (duplicate) {
                return res
                    .status(409)
                    .json({
                        error: "Ya existe un producto con ese código"
                    });
            }

            const raftResult = await submitRaftCommand("PRODUCT_UPDATE",
                    {
                        _id: id,
                        codigo: req.body.codigo,
                        nombre: req.body.nombre,
                        precio: req.body.precio,
                        stock: req.body.stock
                    }
                );

            if (!raftResult.ok) {
                return res
                    .status(raftResult.status)
                    .json(raftResult.data);
            }

            const updatedResource = await Resource.findById(id);
            if (!updatedResource) {
                return res
                    .status(500)
                    .json({
                        error: "El comando fue confirmado pero no se encontró el producto actualizado"
                    });
            }

            log.info(
                `Producto actualizado mediante Raft: ` +
                `id=${id} | ` +
                `leader=${raftResult.data.leaderId} | ` +
                `term=${raftResult.data.term} | ` +
                `commitIndex=${raftResult.data.commitIndex}`
            );

            return res
                .status(200)
                .json(updatedResource);
        }
        catch (error) {
            if (isDuplicateKeyError(error)) {
                return res
                    .status(409)
                    .json({
                        error: "Ya existe un producto con ese código"
                    });
            }

            if (isValidationError(error)) {
                return res
                    .status(400)
                    .json({
                        error: error.message
                    });
            }

            log.error(`Error actualizando producto mediante Raft ` + `id=${id}: ${error.message}`);

            return res
                .status(500)
                .json({
                    error: "Error interno del servidor"
                });
        }
    }
);


// =============================================================================
// DELETE /api/productos/:id
//
// DELETE mediante Raft.
// =============================================================================

router.delete("/productos/:id", async (req, res) => {
        const id = req.params.id;
        if (!requireLeader(res)) {
            return;
        }

        if (!isValidId(id)) {
            return res
                .status(400)
                .json({
                    error: "ID inválido"
                });
        }

        try {
            const existing = await Resource.findById(id);
            if (!existing) {
                log.warn(`Producto no encontrado para eliminar: id=${id}`);

                return res
                    .status(404)
                    .json({
                        error: "Producto no encontrado"
                    });
            }

            const raftResult = await submitRaftCommand("PRODUCT_DELETE", {
                _id: id
                }
            );

            if (!raftResult.ok) {
                return res
                    .status(raftResult.status)
                    .json(raftResult.data);
            }

            log.info(
                `Producto eliminado mediante Raft: ` +
                `id=${id} | ` +
                `leader=${raftResult.data.leaderId} | ` +
                `term=${raftResult.data.term} | ` +
                `commitIndex=${raftResult.data.commitIndex}`
            );

            return res
                .status(204)
                .send();

        }
        catch (error) {
            log.error(`Error eliminando producto mediante Raft ` + `id=${id}: ${error.message}`);

            return res
                .status(500)
                .json({
                    error: "Error interno del servidor"
                });
        }
    }
);


// -----------------------------------------------------------------------------
// POST /api/productos/:id/reservar-sin-lock
// Endpoint deliberadamente vulnerable para demostrar la condición de carrera.
// -----------------------------------------------------------------------------
router.post("/productos/:id/reservar-sin-lock", async (req, res) => {
    const id = req.params.id;

    if (!isValidId(id)) {
        return res.status(400).json({
            error: "ID inválido"
        });
    }

    try {
        const resource = await Resource.findById(id);

        if (!resource) {
            return res.status(404).json({
                error: "Producto no encontrado"
            });
        }

        if (resource.stock <= 0) {
            return res.status(409).json({
                error: "Sin stock disponible"
            });
        }

        log.debug(
            `Reserva SIN LOCK id=${id} | stock leído=${resource.stock}`
        );

        await delay(RESERVATION_DELAY_MS);

        resource.stock -= 1;
        await resource.save();

        log.info(
            `Reserva SIN LOCK id=${id} | stock resultante=${resource.stock}`
        );

        return res.status(200).json({
            message: "Reserva realizada sin lock",
            resource: resource
        });

    } catch (error) {
        if (isValidationError(error)) {
            return res.status(400).json({
                error: error.message
            });
        }

        log.error(`Error en reserva SIN LOCK id=${id}: ${error.message}`);

        return res.status(500).json({
            error: "Error interno del servidor"
        });
    }
});


// =============================================================================
// POST /api/productos/:id/reservar
//
// Reserva protegida mediante:
//
// 1. Leader Raft
// 2. Redis/Memurai distributed lock
// 3. Replicación Raft
// 4. Quorum
// 5. Commit
// 6. State Machine
//
// El endpoint NO modifica MongoDB directamente.
// =============================================================================
router.post("/productos/:id/reservar", async (req, res) => {
        const id = req.params.id;
        let lock = null;
        if (!requireLeader(res)) {
            return;
        }

        if (!isValidId(id)) {
            return res
                .status(400)
                .json({
                    error: "ID inválido"
                });
        }

        try {
            lock = await acquireLock(`producto:${id}`, LOCK_TTL_MS);
            if (!lock) {
                log.warn(`Reserva bloqueada: ` + `producto id=${id}`);

                return res
                    .status(423)
                    .json({
                        error: "Producto bloqueado por otra operación"
                    });
            }

            log.debug(`Lock adquirido para producto id=${id}`);

            let resource = await Resource.findById(id);
            if (!resource) {
                return res
                    .status(404)
                    .json({
                        error: "Producto no encontrado"
                    });
            }

            if (resource.stock <= 0) {
                return res
                    .status(409)
                    .json({
                        error: "Sin stock disponible"
                    });
            }

            log.debug(`Reserva RAFT id=${id} | ` + `stock leído=${resource.stock}`);

            await delay(RESERVATION_DELAY_MS);

            resource = await Resource.findById(id);
            if (!resource) {
                return res
                    .status(404)
                    .json({
                        error: "Producto no encontrado"
                    });
            }

            if (resource.stock <= 0) {
                return res
                    .status(409)
                    .json({
                        error: "Sin stock disponible"
                    });
            }

            const stockBefore = resource.stock;
            const stockAfter = stockBefore - 1;
            const raftResult = await submitRaftCommand("PRODUCT_RESERVE",
                    {
                        _id: id,
                        quantity: 1,
                        stockBefore,
                        stockAfter
                    }
                );

            if (!raftResult.ok) {
                log.warn(
                    `Reserva RAFT rechazada ` +
                    `id=${id} | ` +
                    `status=${raftResult.status} | ` +
                    `error=${raftResult.data?.error}`
                );

                return res.status(raftResult.status).json(raftResult.data);
            }

            const updatedResource = await Resource.findById(id);
            if (!updatedResource) {
                log.error(`RAFT_RESERVE_COMMITTED_RESOURCE_NOT_FOUND | ` + `id=${id}`);

                return res
                    .status(500)
                    .json({
                        error: "La reserva fue confirmada pero no se encontró el producto aplicado"
                    });
            }

            log.info(
                `Reserva mediante Raft | ` +
                `id=${id} | ` +
                `stockBefore=${stockBefore} | ` +
                `stockAfter=${stockAfter} | ` +
                `leader=${raftResult.data.leaderId} | ` +
                `term=${raftResult.data.term} | ` +
                `commitIndex=${raftResult.data.commitIndex}`
            );


            return res
                .status(200)
                .json({
                    message: "Reserva realizada mediante Raft",
                    resource: updatedResource,
                    raft: {
                        leaderId: raftResult.data.leaderId,
                        term: raftResult.data.term,
                        commitIndex: raftResult.data.commitIndex,
                        lastApplied: raftResult.data.lastApplied
                    }
                });

        }
        catch (error) {
            if (isValidationError(error)) {
                return res
                    .status(400)
                    .json({
                        error: error.message
                    });
            }

            log.error(`Error en reserva RAFT ` + `id=${id}: ${error.message}`);

            return res
                .status(500)
                .json({
                    error: "Error interno del servidor"
                });
        }
        finally {
            if (lock) {
                try {
                    const released = await releaseLock(lock);
                    log.debug(`Lock liberado para producto ` + `id=${id}: ${released}`);
                }
                catch (error) {
                    log.error(`Error liberando lock producto ` + `id=${id}: ${error.message}`);
                }
            }
        }
    }
);


export default router;
