import RaftPersistentState from "../models/raftPersistentState.js";
import {getRaftState} from "./raftState.js";
import {getLogger} from "../logger.js";


let persistChain = Promise.resolve();


function createPersistentSnapshot() {
    const state = getRaftState();

    return {
        nodeId: state.nodeId,
        currentTerm: state.currentTerm,
        votedFor: state.votedFor,
        log: state.log.map(
                entry => ({
                    index: entry.index,
                    term: entry.term,
                    command: entry.command
                })
            ),
        commitIndex: state.commitIndex,
        lastApplied: state.lastApplied
    };
}


export async function loadPersistentRaftState(nodeId) {
    const logger = getLogger();
    const document = await RaftPersistentState.findOne({nodeId}).lean();
    if (!document) {
        logger.info(
            `RAFT_PERSISTENCE_EMPTY | ` +
            `node=${nodeId}`
        );

        return null;
    }

    const result = {
        nodeId: document.nodeId,
        currentTerm: document.currentTerm,
        votedFor: document.votedFor ?? null,
        log: Array.isArray(document.log)
                ? document.log
                : [],

        commitIndex: document.commitIndex ?? -1,
        lastApplied: document.lastApplied ?? -1
    };

    logger.info(
        `RAFT_PERSISTENCE_LOADED | ` +
        `node=${nodeId} | ` +
        `term=${result.currentTerm} | ` +
        `logLength=${result.log.length} | ` +
        `commitIndex=${result.commitIndex} | ` +
        `lastApplied=${result.lastApplied}`
    );

    return result;
}


export function persistRaftState(reason = "UNSPECIFIED") {
    const snapshot = createPersistentSnapshot();
    const task = persistChain.then(
        async () => { 
                await RaftPersistentState
                    .findOneAndUpdate(
                        {
                            nodeId: snapshot.nodeId
                        },

                        {
                            $set: {
                                currentTerm: snapshot.currentTerm,
                                votedFor: snapshot.votedFor,
                                log: snapshot.log,
                                commitIndex: snapshot.commitIndex,
                                lastApplied: snapshot.lastApplied
                            },

                            $setOnInsert: {
                                nodeId: snapshot.nodeId
                            }
                        },

                        {
                            upsert: true,
                            returnDocument: "after",
                            runValidators: true
                        }
                    );


                const logger = getLogger();

                logger.debug(
                    `RAFT_PERSISTED | ` +
                    `node=${snapshot.nodeId} | ` +
                    `reason=${reason} | ` +
                    `term=${snapshot.currentTerm} | ` +
                    `logLength=${snapshot.log.length} | ` +
                    `commitIndex=${snapshot.commitIndex} | ` +
                    `lastApplied=${snapshot.lastApplied}`
                );

                return snapshot;
            }
        );

    persistChain = task.catch(() => {});
    return task;
}