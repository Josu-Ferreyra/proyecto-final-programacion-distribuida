import Resource from "../models/product.js";
import {getRaftState, setLastApplied} from "./raftState.js";
import {getLogger} from "../logger.js";
import {persistRaftState} from "./raftPersistence.js";

let applyChain = Promise.resolve();

async function applyProductCreate(payload) {
    if (!payload || !payload._id) {
        throw new Error("PRODUCT_CREATE_REQUIRES_ID");
    }

    const existingByCode = await Resource.findOne({
            codigo: payload.codigo
        });

    if (existingByCode) {
        if (String(existingByCode._id) === String(payload._id)) {
            return {
                applied: true,
                idempotent: true,
                resource: existingByCode
            };
        }

        return {
            applied: false,
            rejected: true,
            reason: "PRODUCT_CODE_ALREADY_EXISTS",
            codigo: payload.codigo,
            existingId: String(existingByCode._id),
            commandId: String(payload._id)
        };
    }

    const resource = await Resource.findOneAndUpdate(
            {
                _id: payload._id
            },
            {
                $setOnInsert: {
                    _id: payload._id,
                    codigo: payload.codigo,
                    nombre: payload.nombre,
                    precio: payload.precio,
                    stock: payload.stock,
                    createdAt: payload.createdAt,
                    updatedAt: payload.updatedAt
                }
            },

            {
                upsert: true, 
                returnDocument: "after",
                runValidators: true,
                setDefaultsOnInsert: true,
                timestamps: false
            }
        );

    return {
        applied: true,
        created: true,
        resource
    };
}

async function applyProductUpdate(payload) {
    if (!payload || !payload._id) {
        throw new Error("PRODUCT_UPDATE_REQUIRES_ID");
    }

    const {_id, ...changes} = payload;
    const resource = await Resource.findByIdAndUpdate(
            _id,
            {
                $set: changes
            },
            {
                returnDocument: "after",
                runValidators: true,
                timestamps: false
            }
        );

    if (!resource) {
        return {
            applied: false,
            rejected: true,
            reason: "PRODUCT_NOT_FOUND",
            resourceId: String(_id)
        };
    }

    return {
        applied: true,
        updated: true,
        resource
    };
}


async function applyProductDelete(payload) {
    if (!payload || !payload._id) {
        throw new Error("PRODUCT_DELETE_REQUIRES_ID");
    }

    return Resource.deleteOne({
        _id: payload._id
    });
}


async function applyCommand(command) {
    if (!command || typeof command.type !== "string") {
        throw new Error("INVALID_RAFT_COMMAND");
    }

    switch (command.type) {
        case "PRODUCT_CREATE":
            return applyProductCreate(command.payload);

        case "PRODUCT_UPDATE":
            return applyProductUpdate(command.payload);

        case "PRODUCT_DELETE":
            return applyProductDelete(command.payload);
        
        case "PRODUCT_RESERVE":
            return applyProductReserve(command.payload);
            
        default:
            throw new Error(`UNKNOWN_RAFT_COMMAND:${command.type}`);
    }
}


async function applyCommittedEntriesInternal() {
    const logger = getLogger();
    const state = getRaftState();

    while (state.lastApplied < state.commitIndex) {
        const nextIndex = state.lastApplied + 1;
        const entry = state.log[nextIndex];
        if (!entry) {
            throw new Error(`RAFT_MISSING_COMMITTED_ENTRY:${nextIndex}`);
        }

        logger.info(
            `RAFT_STATE_MACHINE_APPLY | ` +
            `node=${state.nodeId} | ` +
            `index=${entry.index} | ` +
            `term=${entry.term} | ` +
            `type=${entry.command?.type}`
        );

        const result = await applyCommand(entry.command);
        setLastApplied(nextIndex);
        await persistRaftState("STATE_MACHINE_APPLIED");
        if (result && result.rejected) {
            logger.warn(
                `RAFT_STATE_MACHINE_REJECTED | ` +
                `node=${state.nodeId} | ` +
                `index=${entry.index} | ` +
                `term=${entry.term} | ` +
                `type=${entry.command?.type} | ` +
                `reason=${result.reason}`
            );
        }
        else {
            logger.info(
                `RAFT_STATE_MACHINE_APPLIED | ` +
                `node=${state.nodeId} | ` +
                `index=${entry.index} | ` +
                `commitIndex=${state.commitIndex} | ` +
                `lastApplied=${state.lastApplied}`
            );
        }
    }

    return {
        commitIndex: state.commitIndex,
        lastApplied: state.lastApplied
    };
}


async function applyProductReserve(payload) {
    if (!payload || !payload._id) {
        throw new Error("PRODUCT_RESERVE_REQUIRES_ID");
    }

    if (!Number.isInteger(payload.stockAfter) || payload.stockAfter < 0) {
        throw new Error("PRODUCT_RESERVE_INVALID_STOCK_AFTER");
    }

    const existing = await Resource.findById(payload._id);
    if (!existing) {
        return {
            applied: false,
            rejected: true,
            reason: "PRODUCT_NOT_FOUND",
            resourceId: String(payload._id)
        };
    }
    const resource = await Resource.findByIdAndUpdate(
            payload._id,
            {
                $set: {
                    stock: payload.stockAfter,
                    updatedAt: payload.updatedAt
                }
            },

            {
                returnDocument: "after",
                runValidators: true,
                timestamps: false
            }
        );

    return {
        applied: true,
        reserved: true,
        quantity: payload.quantity || 1,
        stockBefore: payload.stockBefore,
        stockAfter: payload.stockAfter,
        resource
    };
}


export function applyCommittedEntries() {
    const task = applyChain.then(() =>applyCommittedEntriesInternal());

    applyChain = task.catch(() => {});
    return task;
}