import {getRaftState, getLastLogInfo} from "./raftState.js";
import {getPeers} from "./cluster.js";
import {getLogger} from "../logger.js";


async function requestVoteFromPeer(peer, request, timeoutMs) {
    const logger = getLogger();
    const controller = new AbortController();
    const timeout = setTimeout(() => { 
                controller.abort();
            },timeoutMs
        );

    try {
        logger.info(
            `RAFT_REQUEST_VOTE_TX | ` +
            `peer=${peer.id} | ` +
            `term=${request.term} | ` +
            `candidateId=${request.candidateId} | ` +
            `lastLogIndex=${request.lastLogIndex} | ` +
            `lastLogTerm=${request.lastLogTerm}`
        );

        const response = await fetch(`${peer.url}/raft/request-vote`,
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
            logger.warn(
                `RAFT_REQUEST_VOTE_HTTP_ERROR | ` +
                `peer=${peer.id} | ` +
                `status=${response.status} | ` +
                `response=${JSON.stringify(data)}`
            );

            return {
                peerId: peer.id,
                ok: false,
                voteGranted: false,
                term: Number.isInteger(data?.term)
                        ? data.term
                        : null,

                error: data?.error || `HTTP_${response.status}`
            };
        }

        const remoteTerm = Number(data?.term);
        if (!Number.isInteger(remoteTerm)) {
            logger.warn(
                `RAFT_REQUEST_VOTE_INVALID_RESPONSE | ` +
                `peer=${peer.id} | ` +
                `reason=INVALID_TERM | ` +
                `response=${JSON.stringify(data)}`
            );

            return {
                peerId: peer.id,
                ok: false,
                voteGranted: false,
                term: null,
                error: "INVALID_RESPONSE_TERM"
            };
        }

        const voteGranted = data?.voteGranted === true;
        logger.info(
            `RAFT_REQUEST_VOTE_RESPONSE | ` +
            `peer=${peer.id} | ` +
            `term=${remoteTerm} | ` +
            `voteGranted=${voteGranted}`
        );

        return {
            peerId: peer.id,
            ok: true,
            voteGranted, 
            term: remoteTerm,
            error: null
        };
    }
    catch (error) {
        const reason = error.name === "AbortError"
                        ? "TIMEOUT"
                        : error.message;

        logger.warn(
            `RAFT_REQUEST_VOTE_FAILED | ` +
            `peer=${peer.id} | ` +
            `reason=${reason}`
        );

        return {
            peerId: peer.id,
            ok: false,
            voteGranted: false,
            term: null,
            error: reason
        };
    }
    finally {
        clearTimeout(timeout);
    }
}


export async function requestVotes({rpcTimeoutMs = 1500} = {}) {
    const logger = getLogger();
    const state = getRaftState();
    const peers = getPeers(state.nodeId);
    const {lastLogIndex, lastLogTerm} = getLastLogInfo();
    const electionTerm = state.currentTerm;
    const request = {
        term: electionTerm,
        candidateId: state.nodeId,
        lastLogIndex,
        lastLogTerm
    };

    logger.info(
        `RAFT_REQUEST_VOTE_BROADCAST | ` +
        `node=${state.nodeId} | ` +
        `term=${electionTerm} | ` +
        `peers=${peers.map(peer => peer.id).join(",")}`
    );

    const promises = peers.map(peer => requestVoteFromPeer(peer, request, rpcTimeoutMs));
    const results = await Promise.all(promises);
    const granted = results.filter(
            result =>
                result.ok &&
                result.voteGranted
        ).length;

    const rejected = results.filter(
            result =>
                result.ok &&
                !result.voteGranted
        ).length;

    const failed = results.filter(
            result =>
                !result.ok
        ).length;

    logger.info(
        `RAFT_REQUEST_VOTE_COMPLETE | ` +
        `node=${state.nodeId} | ` +
        `term=${electionTerm} | ` +
        `granted=${granted} | ` +
        `rejected=${rejected} | ` +
        `failed=${failed}`
    );

    return {
        electionTerm,
        results
    };
}