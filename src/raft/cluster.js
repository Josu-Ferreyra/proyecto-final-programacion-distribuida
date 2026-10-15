export const RAFT_CLUSTER = {
    node1: {
        id: "node1",
        host: "127.0.0.1",
        port: 4001,
        url: "http://127.0.0.1:4001"
    },

    node2: {
        id: "node2",
        host: "127.0.0.1",
        port: 4002,
        url: "http://127.0.0.1:4002"
    },

    node3: {
        id: "node3",
        host: "127.0.0.1",
        port: 4003,
        url: "http://127.0.0.1:4003"
    }
};

export function getNodeConfig(nodeId) {
    if (typeof nodeId !== "string" || nodeId.trim() === "") {
        throw new Error("nodeId inválido");
    }

    const normalizedNodeId = nodeId.trim();
    const node = RAFT_CLUSTER[normalizedNodeId];
    if (!node) {
        throw new Error(`Nodo Raft desconocido: ${normalizedNodeId}`);
    }

    return node;
}

export function getPeers(nodeId) {
    const currentNode = getNodeConfig(nodeId);
    return Object 
        .values(RAFT_CLUSTER)
        .filter(
            node =>
                node.id !==
                currentNode.id
        );
}

export function getClusterSize() {
    return Object
        .keys(RAFT_CLUSTER)
        .length;
}


export function getQuorum() {
    const clusterSize = getClusterSize();
    return (Math.floor(clusterSize / 2) + 1);
}


export function isKnownNode(nodeId) {
    if (typeof nodeId !== "string") {
        return false;
    }

    return Boolean(RAFT_CLUSTER[nodeId.trim()]);
}