import {getRaftState, becomeCandidate, becomeFollower, becomeLeader, initializeLeaderReplication, ROLE_CANDIDATE, ROLE_LEADER} from "./raftState.js";
import {getQuorum, getPeers} from "./cluster.js";
import {requestVotes} from "./requestVote.js";
import {startHeartbeat, stopHeartbeat} from "./heartbeat.js";
import {getLogger} from "../logger.js";
import {persistRaftState} from "./raftPersistence.js";

let electionTimer = null;
let electionConfig = {
    minTimeoutMs: 2500,
    maxTimeoutMs: 4500,
    rpcTimeoutMs: 1500
};

export function initElection(config = {}) {
    const minTimeoutMs = Number(config.minTimeoutMs);
    const maxTimeoutMs = Number(config.maxTimeoutMs);
    const rpcTimeoutMs = Number(config.rpcTimeoutMs ?? 1500);

    if (!Number.isInteger(minTimeoutMs) || minTimeoutMs <= 0) {
        throw new Error("RAFT_ELECTION_TIMEOUT_MIN_MS inválido");
    }

    if (!Number.isInteger(maxTimeoutMs) || maxTimeoutMs <= minTimeoutMs) {
        throw new Error("RAFT_ELECTION_TIMEOUT_MAX_MS inválido");
    }

    if (!Number.isInteger(rpcTimeoutMs) || rpcTimeoutMs <= 0) {
        throw new Error("RAFT_RPC_TIMEOUT_MS inválido");
    }

    electionConfig = {
        minTimeoutMs,
        maxTimeoutMs,
        rpcTimeoutMs
    };
}


function createElectionTimeout() {
    const {minTimeoutMs, maxTimeoutMs} = electionConfig;
    const range = maxTimeoutMs - minTimeoutMs + 1;

    return (minTimeoutMs + Math.floor(Math.random() * range));
}


function clearElectionTimer() {
    if (!electionTimer) {
        return;
    }

    clearTimeout(electionTimer);
    electionTimer = null;
}


function clearElectionTimerState() {
    const state = getRaftState();

    state.electionTimeoutMs = null;
    state.electionStartedAt = null;
    state.electionDeadlineAt = null;
}


function winElection({electionTerm, votes, quorum}) {
    const logger = getLogger();
    const state = getRaftState();

    if (state.role !== ROLE_CANDIDATE || state.currentTerm !== electionTerm) {
        logger.info(
            `RAFT_ELECTION_WIN_IGNORED | ` +
            `node=${state.nodeId} | ` +
            `electionTerm=${electionTerm} | ` +
            `currentTerm=${state.currentTerm} | ` +
            `role=${state.role}`
        );

        return false;
    }

    becomeLeader();

    const peers = getPeers(state.nodeId);
    initializeLeaderReplication(peers.map(peer => peer.id));

    clearElectionTimer();
    clearElectionTimerState();

    logger.info(
        `RAFT_BECOME_LEADER | ` +
        `node=${state.nodeId} | ` +
        `term=${state.currentTerm} | ` +
        `votes=${votes} | ` +
        `quorum=${quorum}`
    );

    startHeartbeat({
        onHigherTerm: (newTerm, peerId) => {
                const currentState = getRaftState();
                if (!Number.isInteger(newTerm) || newTerm <= currentState.currentTerm) {
                    return;
                }

                const previousTerm = currentState.currentTerm;

                stopHeartbeat();
                becomeFollower(newTerm, null);
                resetElectionTimer("HIGHER_TERM_HEARTBEAT_RESPONSE");

                logger.warn(
                    `RAFT_STEP_DOWN | ` +
                    `node=${currentState.nodeId} | ` +
                    `oldTerm=${previousTerm} | ` +
                    `newTerm=${newTerm} | ` +
                    `source=${peerId}`
                );
           }
    });

    return true;
}

async function startElection() {
    const logger = getLogger();
    const state = getRaftState();

    stopHeartbeat();
    becomeCandidate();

    await persistRaftState("BECOME_CANDIDATE");

    const electionTerm = state.currentTerm;

    logger.info(
        `RAFT_BECOME_CANDIDATE | ` +
        `node=${state.nodeId} | ` +
        `term=${electionTerm} | ` +
        `votedFor=${state.votedFor}`
    );

    let votes = 1;
    const quorum = getQuorum();

    logger.info(
        `RAFT_ELECTION_STARTED | ` +
        `node=${state.nodeId} | ` +
        `term=${electionTerm} | ` +
        `votes=${votes} | ` +
        `quorum=${quorum}`
    );

    if (votes >= quorum) {
        winElection({electionTerm, votes, quorum});
        return;
    }

    resetElectionTimer("CANDIDATE_RETRY");

    const {electionTerm: requestElectionTerm, results} = await requestVotes({
            rpcTimeoutMs: electionConfig.rpcTimeoutMs
        });

    if (requestElectionTerm !== electionTerm) {
        logger.info(
            `RAFT_ELECTION_STALE_REQUEST | ` +
            `node=${state.nodeId} | ` +
            `electionTerm=${electionTerm} | ` +
            `requestTerm=${requestElectionTerm}`
        );

        return;
    }

    if (state.role !== ROLE_CANDIDATE || state.currentTerm !== electionTerm) {
        logger.info(
            `RAFT_ELECTION_ABORTED | ` +
            `node=${state.nodeId} | ` +
            `electionTerm=${electionTerm} | ` +
            `currentTerm=${state.currentTerm} | ` +
            `role=${state.role}`
        );

        return;
    }

    let highestTerm = state.currentTerm;
    let highestTermPeer = null;
    for (const result of results) {
        if (Number.isInteger(result.term) && result.term > highestTerm) {
            highestTerm = result.term;
            highestTermPeer = result.peerId;
        }
    }

    if (highestTerm > state.currentTerm) {
        const previousTerm = state.currentTerm;

        stopHeartbeat();
        becomeFollower(highestTerm, null);
        await persistRaftState("ELECTION_HIGHER_TERM");
        resetElectionTimer("HIGHER_TERM_VOTE_RESPONSE");

        logger.warn(
            `RAFT_STEP_DOWN | ` +
            `node=${state.nodeId} | ` +
            `oldTerm=${previousTerm} | ` +
            `newTerm=${state.currentTerm} | ` +
            `source=${highestTermPeer}`
        );
        return;
    }

    for (const result of results) {
        if (result.ok && result.voteGranted && result.term === electionTerm) {
            votes += 1;
            logger.info(
                `RAFT_VOTE_RECEIVED | ` +
                `node=${state.nodeId} | ` +
                `from=${result.peerId} | ` +
                `term=${electionTerm} | ` +
                `votes=${votes} | ` +
                `quorum=${quorum}`
            );
        }
    }

    if (state.role !== ROLE_CANDIDATE || state.currentTerm !== electionTerm) {
        logger.info(
            `RAFT_ELECTION_ABORTED_AFTER_VOTES | ` +
            `node=${state.nodeId} | ` +
            `electionTerm=${electionTerm} | ` +
            `currentTerm=${state.currentTerm} | ` +
            `role=${state.role}`
        );

        return;
    }

    if (votes >= quorum) {
        winElection({electionTerm, votes, quorum});
        return;
    }

    logger.warn(
        `RAFT_ELECTION_NO_QUORUM | ` +
        `node=${state.nodeId} | ` +
        `term=${state.currentTerm} | ` +
        `votes=${votes} | ` +
        `quorum=${quorum}`
    );
}


async function handleElectionTimeout() {
    const logger = getLogger();
    const state = getRaftState();

    if (state.role === ROLE_LEADER) {
        clearElectionTimer();
        clearElectionTimerState();
        return;
    }

    logger.warn(
        `RAFT_ELECTION_TIMEOUT | ` +
        `node=${state.nodeId} | ` +
        `role=${state.role} | ` +
        `term=${state.currentTerm}`
    );


    try {
        await startElection();

    }
    catch (error) {
        logger.error(
            `RAFT_ELECTION_ERROR | ` +
            `node=${state.nodeId} | ` +
            `${error.stack || error.message}`
        );

        if (state.role !== ROLE_LEADER) {
            resetElectionTimer("ELECTION_ERROR");
        }
    }
}


export function resetElectionTimer(reason = "RESET") {
    const logger = getLogger();
    const state = getRaftState();

    clearElectionTimer();

    if (state.role === ROLE_LEADER) {
        clearElectionTimerState();
        return null;
    }

    const timeoutMs = createElectionTimeout();
    const now = Date.now();
    state.electionTimeoutMs = timeoutMs;
    state.electionStartedAt = now;
    state.electionDeadlineAt = now + timeoutMs;

    electionTimer = setTimeout(handleElectionTimeout, timeoutMs);

    const timerMessage =
        `RAFT_ELECTION_TIMER | ` +
        `node=${state.nodeId} | ` +
        `role=${state.role} | ` +
        `term=${state.currentTerm} | ` +
        `timeoutMs=${timeoutMs} | ` +
        `reason=${reason}`;

    if (reason === "HEARTBEAT") {
        logger.debug(timerMessage);
    }
    else {
        logger.info(timerMessage);
    }
    
    return timeoutMs;
}


export function startElectionTimer() {
    return resetElectionTimer("STARTUP");
}

export function stopElectionTimer() {
    clearElectionTimer();
    clearElectionTimerState();
}