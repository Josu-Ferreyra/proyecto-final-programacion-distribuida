import {getRaftState, ROLE_LEADER} from "./raftState.js";
import {replicateAllPeers} from "./replication.js";
import {getLogger} from "../logger.js";

let heartbeatTimer = null;
let heartbeatRunning = false;
let heartbeatConfig = { 
    intervalMs: 700
};

let onHigherTermCallback = null;


export function initHeartbeat({intervalMs = 700} = {}) {
    const parsedInterval = Number(intervalMs);
    if (!Number.isInteger(parsedInterval) || parsedInterval <= 0) {
        throw new Error("RAFT_HEARTBEAT_INTERVAL_MS inválido");
    }

    heartbeatConfig = {
        intervalMs: parsedInterval
    };
}


async function heartbeatTick() {
    if (heartbeatRunning) {
        return;
    }

    heartbeatRunning = true;
    const logger = getLogger();
    try {
        const state = getRaftState();
        if (state.role !== ROLE_LEADER) {
            stopHeartbeat();
            return;
        }

        const result = await replicateAllPeers();
        if (result.reason === "HIGHER_TERM") {
            logger.warn(
                `RAFT_HEARTBEAT_HIGHER_TERM | ` +
                `node=${state.nodeId} | ` +
                `localTerm=${state.currentTerm} | ` +
                `remoteTerm=${result.higherTerm} | ` +
                `source=${result.higherTermPeer}`
            );

            const callback = onHigherTermCallback;
            
            stopHeartbeat();
            if (typeof callback === "function") {
                callback(
                    result.higherTerm,
                    result.higherTermPeer
                );
            }

            return;
        }

        for (const peerResult of result.results ?? []) {
            if (!peerResult.ok && !peerResult.aborted) {
                logger.debug(
                    `RAFT_HEARTBEAT_PEER_UNREACHABLE | ` +
                    `peer=${peerResult.peerId} | ` +
                    `reason=${peerResult.error}`
                );
            }
        }
    }
    catch (error) {
        logger.error(`RAFT_HEARTBEAT_ERROR | ` +`${error.stack || error.message}`);
    }
    finally {
        heartbeatRunning = false;
    }
}

export function startHeartbeat({onHigherTerm = null} = {}) {
    const logger = getLogger();
    const state = getRaftState();

    stopHeartbeat();

    if (state.role !== ROLE_LEADER) {
        return;
    }

    onHigherTermCallback = onHigherTerm;

    logger.info(
        `RAFT_HEARTBEAT_STARTED | ` +
        `node=${state.nodeId} | ` +
        `term=${state.currentTerm} | ` +
        `intervalMs=${heartbeatConfig.intervalMs}`
    );

    heartbeatTick();

    heartbeatTimer = setInterval(heartbeatTick, heartbeatConfig.intervalMs);
}


export function stopHeartbeat() {
    if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
    }

    heartbeatRunning = false;
    onHigherTermCallback = null;
}