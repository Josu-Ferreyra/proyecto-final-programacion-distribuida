export const ROLE_FOLLOWER = "FOLLOWER";
export const ROLE_CANDIDATE = "CANDIDATE";
export const ROLE_LEADER = "LEADER";

let raftState = null;

export function initRaftState({nodeId, persistentState = null}) {
    if (!nodeId) {
        throw new Error("RAFT_NODE_ID_REQUIRED");
    }

    const persistedLog = Array.isArray(persistentState?.log)
                            ? persistentState.log
                            : [];

    const normalizedLog = persistedLog.map((entry, index) => ({
            index: Number.isInteger(entry.index)
                    ? entry.index
                    : index,

            term: Number(entry.term) || 0, 
            command:entry.command
        })
    );

    const lastLogIndex = normalizedLog.length - 1;
    let currentTerm = Number(persistentState?.currentTerm);
    if (!Number.isInteger(currentTerm) || currentTerm < 0) {
        currentTerm = 0;
    }

    const votedFor = typeof persistentState?.votedFor === "string" && persistentState.votedFor.trim()
                                                                        ? persistentState.votedFor
                                                                        : null;

    let commitIndex = Number(persistentState?.commitIndex);
    if (!Number.isInteger(commitIndex)) {
        commitIndex = -1;
    }

    commitIndex = Math.min(commitIndex, lastLogIndex);
    commitIndex = Math.max(commitIndex, -1);
    let lastApplied = Number(persistentState?.lastApplied);
    if (!Number.isInteger(lastApplied)) {
        lastApplied = -1;
    }

    lastApplied = Math.min(lastApplied, commitIndex);
    lastApplied = Math.max(lastApplied, -1);
    raftState = {
        nodeId,
        currentTerm,
        votedFor,
        log: normalizedLog,
        commitIndex,
        lastApplied,
        role: ROLE_FOLLOWER,
        leaderId: null,
        nextIndex: {},
        matchIndex: {},
        election: {
            timeoutMs: null,
            startedAt: null,
            deadlineAt: null
        }
    };

    return raftState;
}


export function getRaftState() {
    if (!raftState) {
        throw new Error("RAFT_STATE_NOT_INITIALIZED");
    }

    return raftState;
}


export function getLastLogInfo() {
    const state = getRaftState();
    const lastLogIndex = state.log.length - 1;
    const lastLogTerm = lastLogIndex >= 0 
                        ? state.log[lastLogIndex].term 
                        : 0;

    return {
        lastLogIndex,
        lastLogTerm
    };
}


export function voteFor(candidateId) {
    const state = getRaftState();
    state.votedFor = candidateId;
}


export function becomeFollower(term, leaderId = null) {
    const state = getRaftState();
    if (!Number.isInteger(term) || term < 0) {
        throw new Error("RAFT_INVALID_TERM");
    }

    if (term > state.currentTerm) {
        state.currentTerm = term;
        state.votedFor =null;
    }

    state.role = ROLE_FOLLOWER;
    state.leaderId = leaderId;
    state.nextIndex = {};
    state.matchIndex = {};
    return state;
}


export function becomeCandidate() {
    const state = getRaftState();
    state.role = ROLE_CANDIDATE;
    state.currentTerm += 1;
    state.votedFor = state.nodeId;
    state.leaderId = null;
    state.nextIndex = {};
    state.matchIndex = {};

    return state;
}


export function becomeLeader() {
    const state = getRaftState();
    state.role = ROLE_LEADER;
    state.leaderId = state.nodeId;
    return state;
}


export function initializeLeaderReplication(peerIds) {
    const state = getRaftState();
    const nextIndex = state.log.length;
    state.nextIndex = {};
    state.matchIndex = {};

    for (const peerId of peerIds) {
        state.nextIndex[peerId] = nextIndex;
        state.matchIndex[peerId] = -1;
    }
}


export function appendLocalLogEntry(command) {
    const state = getRaftState();
    if (state.role !== ROLE_LEADER) {
        throw new Error("RAFT_NOT_LEADER");
    }

    const entry = {
        index: state.log.length,
        term: state.currentTerm,
        command
    };

    state.log.push(entry);

    return entry;
}


export function getLogEntry(index) {
    const state = getRaftState();
    if (!Number.isInteger(index) || index < 0 || index >= state.log.length) {
        return null;
    }
    
    return state.log[index];
}


export function getLogEntriesFrom(index) {
    const state = getRaftState();
    if (!Number.isInteger(index) || index < 0) {
        throw new Error("RAFT_INVALID_LOG_INDEX");
    }

    return state.log.slice(index);
}


export function truncateLogFrom(index) {
    const state = getRaftState();
    if (!Number.isInteger(index) || index < 0   ) {
        throw new Error("RAFT_INVALID_LOG_INDEX");
    }

    if (index >= state.log.length) {
        return;
    }

    state.log.splice(index);
    if (state.commitIndex >= state.log.length) {
        state.commitIndex = state.log.length - 1;
    }

    if (state.lastApplied > state.commitIndex) {
        state.lastApplied = state.commitIndex;
    }
}


export function appendEntriesFromLeader(startIndex, entries) {
    const state = getRaftState();
    if (!Number.isInteger(startIndex) || startIndex < 0) {
        throw new Error("RAFT_INVALID_START_INDEX");
    }

    if (!Array.isArray(entries)) {
        throw new Error("RAFT_INVALID_ENTRIES");
    }

    for (let offset = 0; offset < entries.length; offset++) {
        const incoming = entries[offset];
        const index = startIndex + offset;
        const existing = state.log[index];

        if (existing && existing.term === incoming.term) {
            continue;
        }

        if (existing) {
            state.log.splice(index);
        }

        for (let i = offset; i < entries.length; i++) {
            const entry = entries[i];

            state.log.push({
                index: state.log.length,
                term: entry.term,
                command: entry.command
            });
        }

        break;
    }

    return state.log.length;
}


export function setNextIndex(peerId, index) {
    const state = getRaftState();
    state.nextIndex[peerId] = Math.max(0, Number(index));
}


export function setMatchIndex(peerId, index) {
    const state = getRaftState();
    state.matchIndex[peerId] = Number(index);
}


export function setCommitIndex(index) {
    const state = getRaftState();
    if (!Number.isInteger(index)) {
        throw new Error("RAFT_INVALID_COMMIT_INDEX");
    }

    const maxIndex = state.log.length - 1;
    const safeIndex = Math.min(index, maxIndex);
    if (safeIndex > state.commitIndex) {
        state.commitIndex = safeIndex;
    }

    return state.commitIndex;
}


export function setLastApplied(index) {
    const state = getRaftState();
    if (!Number.isInteger(index)) {
        throw new Error("RAFT_INVALID_APPLIED_INDEX");
    }

    if (index > state.lastApplied) {
        state.lastApplied = index;
    }

    return state.lastApplied;
}