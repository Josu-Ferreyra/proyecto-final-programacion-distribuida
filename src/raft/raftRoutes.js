import express from "express";
import mongoose from "mongoose";
import Resource from "../models/product.js";
import {getRaftState, getLastLogInfo, becomeFollower, voteFor, appendEntriesFromLeader, appendLocalLogEntry, setCommitIndex, ROLE_LEADER} from "./raftState.js";
import {isKnownNode} from "./cluster.js";
import {resetElectionTimer} from "./election.js";
import {stopHeartbeat} from "./heartbeat.js";
import {replicateAllPeers} from "./replication.js";
import {applyCommittedEntries} from "./stateMachine.js";
import {getLogger} from "../logger.js";
import {persistRaftState} from "./raftPersistence.js";
import {getPeers, getQuorum} from "./cluster.js";

const router = express.Router();

router.get("/status", (req, res) => {
        const state = getRaftState();
        const remainingElectionMs = state.electionDeadlineAt !== null && state.electionDeadlineAt !== undefined 
                ? Math.max(0, state.electionDeadlineAt - Date.now())
                : null;

        return res
            .status(200)
            .json({
                nodeId: state.nodeId,
                role: state.role,
                currentTerm: state.currentTerm,
                votedFor: state.votedFor,
                leaderId: state.leaderId,
                commitIndex: state.commitIndex,
                lastApplied: state.lastApplied,
                logLength: state.log.length,
                quorum: getQuorum(),
                election: {
                    timeoutMs: state.electionTimeoutMs,
                    remainingMs: remainingElectionMs,
                    startedAt: state.electionStartedAt,
                    deadlineAt: state.electionDeadlineAt
                },

                peers: 
                    getPeers(state.nodeId)
                    .map(
                        peer => ({
                            id: peer.id,
                            url: peer.url
                        })
                    )
            });
    }
);

router.post("/request-vote", async (req, res, next) => {
        const logger = getLogger();
        try {
            const state = getRaftState();
            const {term, candidateId, lastLogIndex, lastLogTerm} = req.body || {};

            if (!Number.isInteger(term) || term < 0) {
                return res
                    .status(400)
                    .json({
                        error: "term inválido"
                    });
            }


            if (typeof candidateId !== "string" || candidateId.trim() === "") {
                return res
                    .status(400)
                    .json({
                        error: "candidateId inválido"
                    });
            }


            const candidate = candidateId.trim();
            if (!isKnownNode(candidate)) {
                return res
                    .status(400)
                    .json({
                        error: "candidateId desconocido"
                    });
            }

            if (!Number.isInteger(lastLogIndex) || lastLogIndex < -1) {
                return res
                    .status(400)
                    .json({
                        error: "lastLogIndex inválido"
                    });

            }

            if (!Number.isInteger(lastLogTerm) || lastLogTerm < 0) {
                return res
                    .status(400)
                    .json({
                        error: "lastLogTerm inválido"
                    });
            }

            logger.info(
                `RAFT_REQUEST_VOTE_RX | ` +
                `node=${state.nodeId} | ` +
                `from=${candidate} | ` +
                `candidateTerm=${term} | ` +
                `localTerm=${state.currentTerm} | ` +
                `lastLogIndex=${lastLogIndex} | ` +
                `lastLogTerm=${lastLogTerm}`
            );

            if (term < state.currentTerm) {
                logger.info(
                    `RAFT_VOTE_REJECTED | ` +
                    `node=${state.nodeId} | ` +
                    `candidate=${candidate} | ` +
                    `reason=STALE_TERM | ` +
                    `candidateTerm=${term} | ` +
                    `localTerm=${state.currentTerm}`
                );


                return res
                    .status(200)
                    .json({
                        term: state.currentTerm,
                        voteGranted: false
                    });
            }

            if (term > state.currentTerm) {
                const previousTerm = state.currentTerm;
                becomeFollower(term, null);

                await persistRaftState("REQUEST_VOTE_HIGHER_TERM");
                logger.info(
                    `RAFT_HIGHER_TERM | ` +
                    `node=${state.nodeId} | ` +
                    `oldTerm=${previousTerm} | ` +
                    `newTerm=${state.currentTerm} | ` +
                    `source=${candidate}`
                );
            }

            const localLog = getLastLogInfo();
            const candidateLogIsUpToDate = 
                (lastLogTerm > localLog.lastLogTerm) ||
                (
                    lastLogTerm === localLog.lastLogTerm &&
                    lastLogIndex >= localLog.lastLogIndex
                );

            if (!candidateLogIsUpToDate) {
                logger.info(
                    `RAFT_VOTE_REJECTED | ` +
                    `node=${state.nodeId} | ` +
                    `candidate=${candidate} | ` +
                    `reason=LOG_NOT_UP_TO_DATE | ` +
                    `candidateLastIndex=${lastLogIndex} | ` +
                    `candidateLastTerm=${lastLogTerm} | ` +
                    `localLastIndex=${localLog.lastLogIndex} | ` +
                    `localLastTerm=${localLog.lastLogTerm}`
                );


                return res
                    .status(200)
                    .json({
                        term: state.currentTerm,
                        voteGranted: false
                    });
            }

            const canVote = state.votedFor === null || state.votedFor === candidate;
            if (!canVote) {
                logger.info(
                    `RAFT_VOTE_REJECTED | ` +
                    `node=${state.nodeId} | ` +
                    `candidate=${candidate} | ` +
                    `reason=ALREADY_VOTED | ` +
                    `votedFor=${state.votedFor} | ` +
                    `term=${state.currentTerm}`
                );


                return res
                    .status(200)
                    .json({
                        term: state.currentTerm,
                        voteGranted: false
                    });
            }

            becomeFollower(state.currentTerm, null);
            voteFor(candidate);

            await persistRaftState("VOTE_GRANTED");
            resetElectionTimer("VOTE_GRANTED");
            logger.info(
                `RAFT_VOTE_GRANTED | ` +
                `node=${state.nodeId} | ` +
                `candidate=${candidate} | ` +
                `term=${state.currentTerm}`
            );


            return res
                .status(200)
                .json({
                    term: state.currentTerm,
                    voteGranted: true
                });

        }
        catch (error) {
            logger.error(
                `RAFT_REQUEST_VOTE_ERROR | ` +
                `${error.stack || error.message}`
            );

            return next(error);
        }
    }
);

router.post("/append-entries", async (req, res, next) => {
        const logger = getLogger();
        try {
            const state = getRaftState();
            const {term, leaderId, prevLogIndex, prevLogTerm, entries, leaderCommit} = req.body || {};
            if (!Number.isInteger(term) || term < 0) {
                return res
                    .status(400)
                    .json({
                        error: "term inválido"
                    });
            }

            if (typeof leaderId !== "string" || !isKnownNode(leaderId)) {
                return res
                    .status(400)
                    .json({
                        error:"leaderId inválido"
                    });
            }

            if (!Number.isInteger(prevLogIndex) || prevLogIndex < -1) {
                return res
                    .status(400)
                    .json({
                        error: "prevLogIndex inválido"
                    });
            }

            if (!Number.isInteger(prevLogTerm) || prevLogTerm < 0) {
                return res
                    .status(400)
                    .json({
                        error: "prevLogTerm inválido"
                    });
            }

            if (!Array.isArray(entries)) {
                return res
                    .status(400)
                    .json({
                        error: "entries inválido"
                    });
            }

            if (!Number.isInteger(leaderCommit) || leaderCommit < -1) {
                return res
                    .status(400)
                    .json({
                        error: "leaderCommit inválido"
                    });
            }

            if (term < state.currentTerm) {
                logger.debug(
                    `RAFT_APPEND_ENTRIES_REJECTED | ` +
                    `node=${state.nodeId} | ` +
                    `leader=${leaderId} | ` +
                    `reason=STALE_TERM | ` +
                    `leaderTerm=${term} | ` +
                    `localTerm=${state.currentTerm}`
                );

                return res
                    .status(200)
                    .json({
                        term: state.currentTerm,
                        success: false,
                        matchIndex: state.log.length - 1
                    });
            }

            stopHeartbeat();
            becomeFollower(term, leaderId);
            if (prevLogIndex >= 0) {
                const previousEntry = state.log[prevLogIndex];
                if (!previousEntry) {
                    resetElectionTimer("APPEND_ENTRIES_LOG_MISMATCH");
                    logger.debug(
                        `RAFT_APPEND_ENTRIES_LOG_MISMATCH | ` +
                        `node=${state.nodeId} | ` +
                        `leader=${leaderId} | ` +
                        `reason=MISSING_PREV_ENTRY | ` +
                        `prevLogIndex=${prevLogIndex} | ` +
                        `localLogLength=${state.log.length}`
                    );

                    return res
                        .status(200)
                        .json({
                            term: state.currentTerm,
                            success: false,
                            matchIndex: state.log.length - 1
                        });
                }

                if (previousEntry.term !== prevLogTerm) {
                    resetElectionTimer("APPEND_ENTRIES_LOG_MISMATCH");

                    logger.debug(
                        `RAFT_APPEND_ENTRIES_LOG_MISMATCH | ` +
                        `node=${state.nodeId} | ` +
                        `leader=${leaderId} | ` +
                        `reason=TERM_MISMATCH | ` +
                        `prevLogIndex=${prevLogIndex} | ` +
                        `localPrevTerm=${previousEntry.term} | ` +
                        `leaderPrevTerm=${prevLogTerm}`
                    );

                    return res
                        .status(200)
                        .json({
                            term: state.currentTerm,
                            success: false,
                            matchIndex: prevLogIndex - 1
                        });
                }
            }

            const startIndex = prevLogIndex + 1;
            if (entries.length > 0) {
                appendEntriesFromLeader(startIndex, entries);

                await persistRaftState("FOLLOWER_APPEND_ENTRIES");

                logger.info(
                    `RAFT_APPEND_ENTRIES_APPLIED | ` +
                    `node=${state.nodeId} | ` +
                    `leader=${leaderId} | ` +
                    `term=${state.currentTerm} | ` +
                    `startIndex=${startIndex} | ` +
                    `entries=${entries.length} | ` +
                    `logLength=${state.log.length}`
                );
            }

            resetElectionTimer(entries.length > 0 ? "APPEND_ENTRIES" : "HEARTBEAT");

            const previousCommitIndex = state.commitIndex;
            if (leaderCommit > state.commitIndex) {
                const newCommitIndex = Math.min(leaderCommit, state.log.length - 1);
                setCommitIndex(newCommitIndex);
                await persistRaftState("FOLLOWER_COMMIT_ADVANCED");
            }

            if (state.commitIndex > previousCommitIndex) {
                logger.info(
                    `RAFT_FOLLOWER_COMMIT_ADVANCED | ` +
                    `node=${state.nodeId} | ` +
                    `leader=${leaderId} | ` +
                    `oldCommitIndex=${previousCommitIndex} | ` +
                    `newCommitIndex=${state.commitIndex}`
                );
            }

            let stateMachineApplied = true;
            let stateMachineError = null;
            if (state.lastApplied < state.commitIndex) {
                try {
                    await applyCommittedEntries();

                }
                catch (applyError) {
                    stateMachineApplied = false;
                    stateMachineError = applyError.message;

                    logger.error(
                        `RAFT_FOLLOWER_APPLY_FAILED | ` +
                        `node=${state.nodeId} | ` +
                        `leader=${leaderId} | ` +
                        `commitIndex=${state.commitIndex} | ` +
                        `lastApplied=${state.lastApplied} | ` +
                        `error=${applyError.message}`
                    );
                }
            }

            const matchIndex = entries.length > 0
                                ? prevLogIndex + entries.length
                                : prevLogIndex;

            if (entries.length === 0) {
                logger.debug(
                    `RAFT_HEARTBEAT_RX | ` +
                    `node=${state.nodeId} | ` +
                    `leader=${leaderId} | ` +
                    `term=${state.currentTerm} | ` +
                    `commitIndex=${state.commitIndex} | ` +
                    `lastApplied=${state.lastApplied}`
                );
            }

            return res
                .status(200)
                .json({
                    term: state.currentTerm,
                    success: true,
                    matchIndex,
                    commitIndex: state.commitIndex,
                    lastApplied: state.lastApplied,
                    stateMachineApplied,
                    stateMachineError
                });
        }
        catch (error) {
            logger.error(`RAFT_APPEND_ENTRIES_ERROR | ` + `${error.stack || error.message}`);
            return next(error);
        }
    }
);

router.post("/command", async (req, res, next) => {
        const logger = getLogger();
        try {
            const state = getRaftState();
            if (state.role !== ROLE_LEADER) {
                return res
                    .status(409)
                    .json({
                        ok: false,
                        error: "NOT_LEADER",
                        nodeId: state.nodeId,
                        role: state.role,
                        term: state.currentTerm,
                        leaderId: state.leaderId
                    });
            }

            const {type, payload} = req.body || {};
            if (typeof type !== "string" || !type.trim()) {
                return res
                    .status(400)
                    .json({
                        ok: false,
                        error: "INVALID_COMMAND_TYPE"
                    });
            }

            if (payload === undefined || payload === null || typeof payload !== "object" || Array.isArray(payload)) {
                return res
                    .status(400)
                    .json({
                        ok: false,
                        error: "INVALID_COMMAND_PAYLOAD"
                    });
            }

            const commandType = type.trim();
            const commandTerm = state.currentTerm;
            const commandTimestamp = new Date();

            let raftPayload = {...payload};
            if (commandType === "PRODUCT_CREATE") {
                raftPayload = {
                    ...payload,
                    _id: payload._id || new mongoose.Types.ObjectId().toString(),
                    createdAt: payload.createdAt || commandTimestamp,
                    updatedAt: payload.updatedAt || commandTimestamp
                };
            }

            if (commandType === "PRODUCT_UPDATE") {
                raftPayload = {
                    ...payload,
                    updatedAt: payload.updatedAt || commandTimestamp
                };
            }
            
            if (commandType === "PRODUCT_CREATE") {
                const existing = await Resource.findOne({
                        codigo: payload.codigo
                    });

                if (existing) {
                    return res
                        .status(409)
                        .json({
                            ok: false,
                            error: "PRODUCT_CODE_ALREADY_EXISTS",
                            codigo: payload.codigo,
                            resourceId: String(existing._id)
                        });
                }
            }
 
            if (commandType === "PRODUCT_RESERVE") {
                raftPayload = {
                    ...payload,
                    updatedAt: payload.updatedAt || commandTimestamp
                };
            }
            
            const entry = appendLocalLogEntry({
                    type: commandType,
                    payload: raftPayload
                });

            await persistRaftState("LEADER_APPEND_LOCAL_ENTRY");

            logger.info(
                `RAFT_COMMAND_APPENDED | ` +
                `leader=${state.nodeId} | ` +
                `index=${entry.index} | ` +
                `term=${entry.term} | ` +
                `type=${entry.command.type}`
            );

            const replication = await replicateAllPeers();
            if (replication.reason === "HIGHER_TERM") {
                const previousTerm = state.currentTerm;

                stopHeartbeat();
                becomeFollower(replication.higherTerm, null);
                resetElectionTimer("HIGHER_TERM_COMMAND_REPLICATION");

                logger.warn(
                    `RAFT_COMMAND_STEP_DOWN | ` +
                    `node=${state.nodeId} | ` +
                    `oldTerm=${previousTerm} | ` +
                    `newTerm=${state.currentTerm} | ` +
                    `source=${replication.higherTermPeer}`
                );

                return res
                    .status(409)
                    .json({
                        ok: false,
                        error: "LEADERSHIP_LOST",
                        committed: false,
                        nodeId: state.nodeId,
                        role: state.role,
                        term: state.currentTerm,
                        leaderId: state.leaderId,
                        entryIndex: entry.index
                    });
            }

            if (state.role !== ROLE_LEADER || state.currentTerm !== commandTerm) {
                return res
                    .status(409)
                    .json({
                        ok: false,
                        error: "LEADERSHIP_CHANGED",
                        committed: false,
                        nodeId: state.nodeId,
                        role: state.role,
                        term: state.currentTerm,
                        leaderId: state.leaderId,
                        entryIndex: entry.index

                    });

            }

            const committed = state.commitIndex >= entry.index;
            if (!committed) {
                logger.warn(
                    `RAFT_COMMAND_NOT_COMMITTED | ` +
                    `leader=${state.nodeId} | ` +
                    `index=${entry.index} | ` +
                    `term=${entry.term} | ` +
                    `commitIndex=${state.commitIndex}`
                );

                return res
                    .status(503)
                    .json({
                        ok: false,
                        error: "NO_QUORUM",
                        committed: false,
                        entry, 
                        commitIndex: state.commitIndex,
                        lastApplied: state.lastApplied,
                        matchIndex: state.matchIndex
                    });
            }

            try {
                await applyCommittedEntries();
            }
            catch (applyError) {

                logger.error(
                    `RAFT_COMMAND_COMMITTED_APPLY_FAILED | ` +
                    `leader=${state.nodeId} | ` +
                    `index=${entry.index} | ` +
                    `commitIndex=${state.commitIndex} | ` +
                    `lastApplied=${state.lastApplied} | ` +
                    `error=${applyError.message}`
                );

                return res
                    .status(500)
                    .json({
                        ok: false,
                        error: "COMMITTED_BUT_APPLY_FAILED",
                        committed: true,
                        entry, 
                        commitIndex: state.commitIndex,
                        lastApplied: state.lastApplied
                    });
            }

            logger.info(
                `RAFT_COMMAND_COMMITTED | ` +
                `leader=${state.nodeId} | ` +
                `index=${entry.index} | ` +
                `term=${entry.term} | ` +
                `commitIndex=${state.commitIndex} | ` +
                `lastApplied=${state.lastApplied}`
            );

            return res
                .status(201)
                .json({
                    ok: true,
                    committed: true,
                    leaderId: state.nodeId,
                    term: state.currentTerm,
                    entry, 
                    commitIndex: state.commitIndex,
                    lastApplied: state.lastApplied,
                    matchIndex: state.matchIndex
                });
        }
        catch (error) {
            logger.error(`RAFT_COMMAND_ERROR | ` + `${error.stack || error.message}`);
            return next(error);
        }
    }
);

router.get("/log", (req, res) => {
        const state = getRaftState();
        return res
            .status(200)
            .json({
                nodeId: state.nodeId,
                role: state.role,
                currentTerm: state.currentTerm,
                leaderId: state.leaderId,
                commitIndex: state.commitIndex,
                lastApplied: state.lastApplied,
                logLength: state.log.length,
                log: state.log,
                nextIndex: state.nextIndex,
                matchIndex: state.matchIndex
            });
    }
);


export default router;