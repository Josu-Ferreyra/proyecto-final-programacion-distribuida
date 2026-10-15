import {getNodeConfig} from "./cluster.js";
import {getRaftState, ROLE_LEADER} from "./raftState.js";

const nodeId = process.argv[2];
const raftNode = getNodeConfig(nodeId);

export function getLocalRaftInfo() {
    const state = getRaftState();
    return {
        nodeId: state.nodeId,
        role: state.role,
        term: state.currentTerm,
        leaderId: state.leaderId,
        isLeader: state.role === ROLE_LEADER
    };
}


export async function submitRaftCommand(type, payload) {
    const response = await fetch(`${raftNode.url}/raft/command`,
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Accept": "application/json"
                },
                body: JSON.stringify({type, payload})
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
                error: "INVALID_RAFT_RESPONSE",
                raw: responseText
            };
        }
    }

    return {
        ok: response.ok,
        status: response.status,
        data 
    };
}