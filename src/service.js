import express from "express";
import {createServer as createHttpsServer} from "node:https";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {loadEnvFile} from "node:process";
import swaggerUi from "swagger-ui-express";
import cors from "cors";
import endpoints from "./endpoints.js";
import {connectRedis} from "./redis.js";
import {connectDatabase, disconnectDatabase} from "./database.js";
import {initLogger, getLogger} from "./logger.js";
import {buildSwaggerSpec} from "./swagger.js";
import {getNodeConfig, getPeers, getQuorum} from "./raft/cluster.js";
import {initRaftState, getRaftState} from "./raft/raftState.js";
import raftRoutes from "./raft/raftRoutes.js";
import {initElection, startElectionTimer, stopElectionTimer} from "./raft/election.js";
import {initHeartbeat, stopHeartbeat} from "./raft/heartbeat.js";
import {initReplication} from "./raft/replication.js";
import {loadPersistentRaftState, persistRaftState} from "./raft/raftPersistence.js";
import {applyCommittedEntries} from "./raft/stateMachine.js";

loadEnvFile();

const nodeId = process.argv[2];
if (!nodeId) {
    console.error("Debe indicar el nodo Raft.");
    console.error("Ejemplo: node src/service.js node1");
    process.exit(1);
}

let raftNode;
try {
    raftNode = getNodeConfig(nodeId);
}catch (error) {
    console.error(error.message);
    process.exit(1);
}

const nodeMatch = /^node(\d+)$/.exec(nodeId);
if (!nodeMatch) {
    console.error(`Formato de nodo inválido: ${nodeId}`);
    process.exit(1);
}

const nodeNumber = Number(nodeMatch[1]);
const nodeOffset = nodeNumber - 1;

const HOST = process.env.HOST || "127.0.0.1";

const API_PREFIX = process.env.API_PREFIX || "/api";
const JSON_LIMIT = process.env.JSON_LIMIT || "100kb";
const NODE_ENV = process.env.NODE_ENV || "development";
const HTTP_ENABLED = process.env.HTTP_ENABLED === "true";
const HTTP_BASE_PORT = Number(process.env.HTTP_PORT) || 3000;
const HTTP_PORT = HTTP_BASE_PORT + nodeOffset;

const HTTPS_ENABLED = process.env.HTTPS_ENABLED === "true";
const HTTPS_BASE_PORT = Number(process.env.HTTPS_PORT) || 3443;
const HTTPS_PORT = HTTPS_BASE_PORT + nodeOffset;
const HTTPS_PFX_PATH = process.env.HTTPS_PFX_PATH;
const HTTPS_PFX_PASSPHRASE = process.env.HTTPS_PFX_PASSPHRASE;

const REDIS_URL = process.env.REDIS_URL || "redis://127.0.0.1:6379";

const MONGODB_BASE_URI = process.env.MONGODB_BASE_URI || "mongodb://127.0.0.1:27017";
const MONGODB_DB_PREFIX = process.env.MONGODB_DB_PREFIX || "tp4";
const mongoDbName = `${MONGODB_DB_PREFIX}_${nodeId}`;
const mongoUri = `${MONGODB_BASE_URI}/${mongoDbName}`;

const LOG_LEVEL = process.env.LOG_LEVEL || "info";
const LOG_DIR_BASE = process.env.LOG_DIR || "./logs";
const LOG_DIR = resolve(LOG_DIR_BASE, nodeId);
const LOG_MAX_SIZE = process.env.LOG_MAX_SIZE || "5m";
const LOG_MAX_FILES = process.env.LOG_MAX_FILES || "7d";

initLogger({
    logLevel: LOG_LEVEL,
    logDir: LOG_DIR,
    maxSize: LOG_MAX_SIZE,
    maxFiles: LOG_MAX_FILES
});

const logger = getLogger();

const RAFT_ELECTION_TIMEOUT_MIN_MS = Number(process.env.RAFT_ELECTION_TIMEOUT_MIN_MS) || 2500;
const RAFT_ELECTION_TIMEOUT_MAX_MS = Number(process.env.RAFT_ELECTION_TIMEOUT_MAX_MS) || 4500;
const RAFT_RPC_TIMEOUT_MS = Number(process.env.RAFT_RPC_TIMEOUT_MS) ||1500;
const RAFT_HEARTBEAT_INTERVAL_MS = Number(process.env.RAFT_HEARTBEAT_INTERVAL_MS) || 700;
const RAFT_REPLICATION_RPC_TIMEOUT_MS = Number(process.env.RAFT_REPLICATION_RPC_TIMEOUT_MS) || 700;

if (!HTTP_ENABLED && !HTTPS_ENABLED) {
    logger.error("No hay ningún servidor API habilitado.");
    logger.error("Habilitar HTTP_ENABLED o HTTPS_ENABLED en .env");
    process.exit(1);
}

const apiApp = express();
const raftApp = express();

raftApp.use(cors());

apiApp.use(
    express.json({
        limit:JSON_LIMIT
    })
);

raftApp.use(
    express.json({
        limit: JSON_LIMIT
    })
);

const swaggerSpec = buildSwaggerSpec({
        httpPort: HTTP_PORT,
        httpsPort: HTTPS_PORT,
        apiPrefix: API_PREFIX,
        raftUrl: raftNode.url,
        nodeId: raftNode.id
    });

apiApp.get("/api-docs.json", (req, res) => {
        return res
            .status(200)
            .json(swaggerSpec);
    }
);

apiApp.use("/api-docs", swaggerUi.serve,
    swaggerUi.setup(
        swaggerSpec,
        {
            customSiteTitle: `TP4 - ${nodeId} - API REST`
        }
    )
);

apiApp.use(API_PREFIX, endpoints);

raftApp.use("/raft", raftRoutes);

apiApp.use((req, res) => {
    return res
        .status(404)
        .json({
            error:"Endpoint no encontrado"
        });
    }
);

raftApp.use((req, res) => {
    return res
        .status(404)
        .json({
            error: "Endpoint Raft no encontrado"
        });
    }
);


apiApp.use((error, req, res, next) => {
    logger.error(`API_ERROR | ` + `${error.stack || error.message}`);
    return res
        .status(500)
        .json({
            error:"Error interno del servidor"
        });
    }
);

raftApp.use((error, req, res, next) => {
    logger.error(`RAFT_ERROR | ` + `${error.stack || error.message}`);
    return res
        .status(500)
        .json({
            error: "Error interno del nodo Raft"
        });
    }
);

try {
    await connectDatabase(mongoUri);
    logger.info(`MongoDB     : conectado a ${mongoDbName}`);
}
catch (error) {
    logger.error(`No se pudo conectar a MongoDB: ${error.message}`);
    process.exit(1);
}

let persistentRaftState;
try {
    persistentRaftState = await loadPersistentRaftState(nodeId);
}
catch (error) {
    logger.error(`No se pudo cargar el estado Raft persistente: ${error.message}`);
    process.exit(1);
}


initRaftState({
    nodeId,
    persistentState: persistentRaftState
});

let raftState = getRaftState();
if (!persistentRaftState) {
    try {
        await persistRaftState("INITIAL_STATE");
        logger.info(`RAFT_PERSISTENCE_INITIALIZED | ` + `node=${nodeId}`);
    }
    catch (error) {
        logger.error(`No se pudo crear el estado Raft inicial: ${error.message}`);
        process.exit(1);
    }
}

raftState = getRaftState();
if (raftState.lastApplied < raftState.commitIndex) {
    logger.warn(
        `RAFT_STATE_MACHINE_RECOVERY | ` +
        `node=${nodeId} | ` +
        `commitIndex=${raftState.commitIndex} | ` +
        `lastApplied=${raftState.lastApplied}`
    );

    try {
        await applyCommittedEntries();
    }
    catch (error) {
        logger.error(
            `RAFT_STATE_MACHINE_RECOVERY_FAILED | ` +
            `node=${nodeId} | ` +
            `commitIndex=${raftState.commitIndex} | ` +
            `lastApplied=${raftState.lastApplied} | ` +
            `error=${error.message}`
        );
    }

}

initElection({
    minTimeoutMs: RAFT_ELECTION_TIMEOUT_MIN_MS,
    maxTimeoutMs: RAFT_ELECTION_TIMEOUT_MAX_MS,
    rpcTimeoutMs: RAFT_RPC_TIMEOUT_MS
});

initReplication({
    rpcTimeoutMs: RAFT_REPLICATION_RPC_TIMEOUT_MS
});

initHeartbeat({
    intervalMs: RAFT_HEARTBEAT_INTERVAL_MS
});

try {
    const redisStatus = await connectRedis(REDIS_URL);
    logger.info(`Redis       : ${redisStatus}`);
}
catch (error) {
    logger.error(`No se pudo conectar a Redis: ${error.message}`);
    process.exit(1);
}

raftState = getRaftState();


logger.info("");
logger.info("=======================================");
logger.info("TP4 - API REST + RAFT");
logger.info("=======================================");
logger.info(`Environment  : ${NODE_ENV}`);
logger.info(`Node ID      : ${raftNode.id}`);
logger.info(`Raft Role    : ${raftState.role}`);
logger.info(`Raft Term    : ${raftState.currentTerm}`);
logger.info(`Raft Vote    : ${raftState.votedFor}`);
logger.info(`Raft Log     : ${raftState.log.length} entries`);
logger.info(`Raft Commit  : ${raftState.commitIndex}`);
logger.info(`Raft Applied : ${raftState.lastApplied}`);
logger.info(`Raft URL     : ${raftNode.url}`);
logger.info(`Raft Quorum  : ${getQuorum()}`);
logger.info(`Raft Peers   : ${getPeers(raftNode.id).map(peer =>peer.id).join(", ")}`);
logger.info(`Mongo DB     : ${mongoDbName}`);
logger.info(`API Host     : ${HOST}`);
logger.info(`API Prefix   : ${API_PREFIX}`);
logger.info(`HTTP         : ${HTTP_ENABLED}`);
logger.info(`HTTPS        : ${HTTPS_ENABLED}`);
logger.info(`Redis URL    : ${REDIS_URL}`);
logger.info(`Log Dir      : ${LOG_DIR}`);
logger.info("---------------------------------------");

const servers = [];
const raftServer =
    raftApp.listen(raftNode.port, raftNode.host, () => {
            logger.info(`RAFT         : ${raftNode.url}/raft`);
            logger.info(`RAFT Status  : ${raftNode.url}/raft/status`);
            startElectionTimer();
        }
    );

servers.push(raftServer);

if (HTTP_ENABLED) {
    const httpServer = apiApp.listen(HTTP_PORT, HOST, () => {
            logger.info(`HTTP         : ` + `http://${HOST}:${HTTP_PORT}${API_PREFIX}`);
            logger.info(`Swagger      : ` + `http://${HOST}:${HTTP_PORT}/api-docs`);
        }
    );

    servers.push(httpServer);
}


if (HTTPS_ENABLED) {
    if (!HTTPS_PFX_PATH) {
        logger.error("HTTPS_PFX_PATH no está configurado");
        process.exit(1);
    }

    try {
        const httpsOptions = {
            pfx: readFileSync(resolve(HTTPS_PFX_PATH)),
            passphrase:HTTPS_PFX_PASSPHRASE
        };

        const httpsServer = createHttpsServer(httpsOptions, apiApp);
        httpsServer.listen(HTTPS_PORT, HOST, () => {
                logger.info(`HTTPS        : ` + `https://localhost:${HTTPS_PORT}${API_PREFIX}`);
                logger.info(`Swagger HTTPS: ` + `https://localhost:${HTTPS_PORT}/api-docs`);
            }
        );

        servers.push(httpsServer);
    }
    catch (error) {
        logger.error(`No se pudo iniciar HTTPS: ${error.message}`);
        process.exit(1);
    }
}


logger.info("=======================================");
logger.info("");

let shuttingDown = false;

async function shutdown(signal) {
    if (shuttingDown) {
        return;
    }

    shuttingDown = true;
    logger.warn(`SHUTDOWN | signal=${signal}`);

    stopHeartbeat();
    stopElectionTimer();

    try {
        await persistRaftState("SHUTDOWN");
    }
    catch (error) {
        logger.error(`Error persistiendo Raft durante shutdown: ${error.message}`);
    }

    for (const server of servers) {
        await new Promise(
            resolveClose => {
                server.close(resolveClose);
            }
        );
    }

    try {
        await disconnectDatabase();

    }
    catch (error) {
        logger.error(`Error desconectando MongoDB: ${error.message}`);
    }

    logger.info(`Nodo ${nodeId} detenido`);
    process.exit(0);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM",() => shutdown("SIGTERM"));