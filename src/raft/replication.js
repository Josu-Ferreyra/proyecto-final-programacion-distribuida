import {getRaftState, setNextIndex, setMatchIndex, setCommitIndex, ROLE_LEADER} from "./raftState.js";
import {getPeers, getQuorum} from "./cluster.js";
import {getLogger} from "../logger.js";
import {persistRaftState} from "./raftPersistence.js";

let replicationConfig = {
    rpcTimeoutMs:500
};


export function initReplication({rpcTimeoutMs = 500} = {}) {
    const parsedRpcTimeoutMs = Number(rpcTimeoutMs);
    if (!Number.isInteger(parsedRpcTimeoutMs) || parsedRpcTimeoutMs <= 0) {
        throw new Error("RAFT_REPLICATION_RPC_TIMEOUT_MS inválido");
    }

    replicationConfig = {
        rpcTimeoutMs: parsedRpcTimeoutMs
    };
}


async function sendAppendEntriesRpc(peer, request) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), replicationConfig.rpcTimeoutMs);

    try {
        const response = await fetch(
                `${peer.url}/raft/append-entries`,
                {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "Accept": "application/json"
                    },

                    body: JSON.stringify(request),
                    signal: controller.signal
                }
            );

        const responseText = await response.text();
        let data = null;
        if (responseText) {
            try {
                data = JSON.parse(responseText);
            }
            catch {
                data = {
                    raw: responseText
                };
            }
        }

        if (!response.ok) {
            return {
                peerId: peer.id,
                ok: false,
                success: false,
                term: Number.isInteger(data?.term)
                        ? data.term
                        : null,
                error: data?.error || `HTTP_${response.status}`
            };
        }

        const remoteTerm = Number(data?.term);
        return {
            peerId: peer.id,
            ok: true,
            success: data?.success === true,
            term: Number.isInteger(remoteTerm)
                    ? remoteTerm
                    : null,
            matchIndex: Number.isInteger(data?.matchIndex)
                    ? data.matchIndex
                    : null,
            error:null
        };
    }
    catch (error) {
        return {
            peerId: peer.id,
            ok: false,
            success: false,
            term: null,
            error: error.name === "AbortError"
                    ? "TIMEOUT"
                    : error.message
        };
    }
    finally {
        clearTimeout(timeout);
    }
}


function buildAppendEntriesRequest(peerId) {
    const state = getRaftState();
    let nextIndex = state.nextIndex[peerId];

    if (!Number.isInteger(nextIndex)) {
        nextIndex = state.log.length;
        setNextIndex(peerId, nextIndex);
    }

    const prevLogIndex = nextIndex - 1;
    const prevLogTerm = prevLogIndex >= 0 
                            ? state.log[prevLogIndex]?.term ?? 0
                            : 0;

    const entries = state.log
            .slice(nextIndex)
            .map(entry => ({
                    index: entry.index,
                    term: entry.term,
                    command: entry.command
                })
            );

    return {
        term: state.currentTerm,
        leaderId: state.nodeId,
        prevLogIndex,
        prevLogTerm,
        entries,
        leaderCommit: state.commitIndex
    };
}


async function replicateToPeer(peer) {
    const logger = getLogger();
    const state = getRaftState();
    const leaderTerm = state.currentTerm;
    const maxAttempts = state.log.length + 2;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        if (state.role !== ROLE_LEADER || state.currentTerm !== leaderTerm) {
            return {
                peerId: peer.id,
                ok: false,
                success: false,
                aborted: true,
                term: state.currentTerm,
                error: "NOT_LEADER_ANYMORE"
            };
        }

        const request = buildAppendEntriesRequest(peer.id);
        const entriesSent = request.entries.length;

        logger.debug(
            `RAFT_APPEND_ENTRIES_TX | ` +
            `leader=${state.nodeId} | ` +
            `peer=${peer.id} | ` +
            `term=${request.term} | ` +
            `prevLogIndex=${request.prevLogIndex} | ` +
            `entries=${entriesSent} | ` +
            `leaderCommit=${request.leaderCommit}`
        );

        const result = await sendAppendEntriesRpc(peer, request);
        if (!result.ok) {
            return result;
        }

        if (Number.isInteger(result.term) && result.term > state.currentTerm) {
            return {
                ...result,
                higherTerm: true
            };
        }

        if (result.success) {
            const replicatedThrough = request.prevLogIndex + entriesSent;

            setMatchIndex(peer.id, replicatedThrough);
            setNextIndex(peer.id, replicatedThrough + 1);
            if (entriesSent > 0) {
                logger.info(
                    `RAFT_LOG_REPLICATED | ` +
                    `leader=${state.nodeId} | ` +
                    `peer=${peer.id} | ` +
                    `from=${request.prevLogIndex + 1} | ` +
                    `to=${replicatedThrough} | ` +
                    `entries=${entriesSent}`
                );
            }

            return {
                ...result,
                replicatedThrough,
                entriesSent
            };
        }

        const currentNextIndex = state.nextIndex[peer.id] ?? 0;
        const newNextIndex = Math.max(0, currentNextIndex - 1);

        setNextIndex(peer.id, newNextIndex);

        logger.debug(
            `RAFT_LOG_BACKTRACK | ` +
            `leader=${state.nodeId} | ` +
            `peer=${peer.id} | ` +
            `oldNextIndex=${currentNextIndex} | ` +
            `newNextIndex=${newNextIndex}`
        );
    }

    return {
        peerId: peer.id,
        ok: false,
        success: false,
        term: state.currentTerm,
        error: "MAX_REPLICATION_ATTEMPTS"
    };
}


async function advanceCommitIndex() {
    const logger = getLogger();
    const state = getRaftState();
    if (state.role !== ROLE_LEADER) {
        return state.commitIndex;
    }

    const peers = getPeers(state.nodeId);
    const quorum = getQuorum();

    for (let index = state.log.length - 1; index > state.commitIndex; index--) {
        const entry = state.log[index];
        if (!entry) {
            continue;
        }

        if (entry.term !== state.currentTerm) {
            continue;
        }

        let replicated = 1;
        for (const peer of peers) {
            const peerMatchIndex = state.matchIndex[peer.id] ?? -1;
            if (peerMatchIndex >= index) {
                replicated += 1;
            }
        }

        if (replicated >= quorum) {
            const oldCommitIndex = state.commitIndex;
            
            setCommitIndex(index);
            
            await persistRaftState("LEADER_COMMIT_ADVANCED");

            if (state.commitIndex > oldCommitIndex) {
                logger.info(
                    `RAFT_COMMIT_ADVANCED | ` +
                    `leader=${state.nodeId} | ` +
                    `term=${state.currentTerm} | ` +
                    `oldCommitIndex=${oldCommitIndex} | ` +
                    `newCommitIndex=${state.commitIndex} | ` +
                    `replicated=${replicated} | ` +
                    `quorum=${quorum}`
                );
            }
            break;
        }
    }

    return state.commitIndex;
}


export async function replicateAllPeers() {
    const state = getRaftState();
    if (state.role !== ROLE_LEADER) {
        return {
            ok: false,
            reason: "NOT_LEADER",
            term: state.currentTerm,
            results: []
        };
    }

    const replicationTerm = state.currentTerm;
    const peers = getPeers(state.nodeId);
    const results = await Promise.all(peers.map(peer => replicateToPeer(peer)));
    let highestTerm = state.currentTerm;
    let highestTermPeer = null;
    for (const result of results) {
        if (Number.isInteger(result.term) && result.term > highestTerm) {
            highestTerm = result.term;
            highestTermPeer = result.peerId;
        }
    }

    if (highestTerm > state.currentTerm) {
        return {
            ok: false,
            reason: "HIGHER_TERM",
            replicationTerm, 
            higherTerm: highestTerm,
            higherTermPeer, 
            results
        };

    }

    if (state.role !== ROLE_LEADER || state.currentTerm !== replicationTerm) {
        return {
            ok: false,
            reason: "LEADERSHIP_CHANGED",
            replicationTerm, 
            results
        };
    }

    const commitIndex = advanceCommitIndex();

    return {
        ok: true,
        replicationTerm,
        commitIndex,
        results
    };
}