// =============================================================================
// Servers Raft
// =============================================================================
function buildRaftServers({raftUrl, nodeId}) {
    return [
        {
            url: raftUrl,
            description: `Raft interno - ${nodeId}`
        }
    ];
}


// =============================================================================
// Schemas Raft
// =============================================================================
export function buildRaftSchemas() {
    return {
        // =====================================================================
        // Peer
        // =====================================================================
        RaftPeer: {
            type: "object",
            properties: {
                id: {
                    type: "string",
                    example: "node2"
                },

                url: {
                    type: "string",
                    example: "http://127.0.0.1:4002"
                }
            }
        },

        // =====================================================================
        // Election timer
        // =====================================================================
        RaftElectionStatus: {
            type: "object",
            properties: {
                timeoutMs: {
                    type: "integer",
                    nullable: true,
                    example: 3250
                },

                remainingMs: {
                    type: "integer",
                    nullable: true,
                    example: 2180
                },

                startedAt: {
                    type: "integer",
                    format: "int64",
                    nullable: true,
                    example: 1788440000000
                },

                deadlineAt: {
                    type: "integer",
                    format: "int64",
                    nullable: true,
                    example: 1788440003250
                }
            }
        },

        // =====================================================================
        // Estado Raft
        // =====================================================================
        RaftStatus: {
            type: "object",
            properties: {
                nodeId: {
                    type: "string",
                    example: "node1"
                },

                role: {
                    type: "string",
                    enum: ["FOLLOWER", "CANDIDATE", "LEADER"],
                    example: "LEADER"
                },

                currentTerm: {
                    type: "integer",
                    minimum: 0,
                    example: 12
                },

                votedFor: {
                    type: "string",
                    nullable: true,
                    example: "node1"
                },

                leaderId: {
                    type: "string",
                    nullable: true,
                    example: "node1"
                },

                commitIndex: {
                    type: "integer",
                    example: 7
                },

                lastApplied: {
                    type: "integer",
                    example: 7
                },

                logLength: {
                    type: "integer",
                    minimum: 0,
                    example: 8
                },

                quorum: {
                    type: "integer",
                    minimum: 1,
                    example: 2
                },

                election: {
                    $ref: "#/components/schemas/RaftElectionStatus"
                },

                peers: {
                    type: "array",
                    items: {
                        $ref: "#/components/schemas/RaftPeer"
                    }
                }
            }
        },

        // =====================================================================
        // Command contenido en una entrada
        // =====================================================================
        RaftCommand: {
            type: "object",
            required: ["type", "payload"],
            properties: {
                type: {
                    type: "string",
                    enum: ["PRODUCT_CREATE", "PRODUCT_UPDATE", "PRODUCT_DELETE", "PRODUCT_RESERVE"],
                    example: "PRODUCT_CREATE"
                },

                payload: {
                    type: "object",
                    additionalProperties: true
                }
            }
        },

        // =====================================================================
        // Entrada del log
        // =====================================================================
        RaftLogEntry: {
            type: "object",
            required: ["index", "term", "command"],
            properties: {
                index: {
                    type: "integer",
                    minimum: 0,
                    example: 7
                },

                term: {
                    type: "integer",
                    minimum: 0,
                    example: 11
                },

                command: {
                    $ref: "#/components/schemas/RaftCommand"
                }
            }
        },

        // =====================================================================
        // Mapas nextIndex / matchIndex
        // =====================================================================
        RaftIndexMap: {
            type: "object",
            additionalProperties: { 
                type: "integer"
            },

            example: {
                node2: 8,
                node3: 8
            }
        },

        // =====================================================================
        // GET /raft/log
        // =====================================================================
        RaftLogResponse: {
            type: "object",
            properties: {
                nodeId: {
                    type: "string",
                    example: "node1"
                },

                role: {
                    type: "string",
                    enum: ["FOLLOWER", "CANDIDATE", "LEADER"],
                    example: "LEADER"
                },

                currentTerm: {
                    type: "integer",
                    example: 12
                },

                leaderId: {
                    type: "string",
                    nullable: true,
                    example: "node1"
                },

                commitIndex: {
                    type: "integer",
                    example: 7
                },

                lastApplied: {
                    type: "integer",
                    example: 7
                },

                logLength: {
                    type: "integer",
                    example: 8
                },

                log: {
                    type: "array",
                    items: {
                        $ref: "#/components/schemas/RaftLogEntry"
                    }
                },

                nextIndex: {
                    $ref: "#/components/schemas/RaftIndexMap"
                },

                matchIndex: {
                    $ref: "#/components/schemas/RaftIndexMap"
                }
            }
        },

        // =====================================================================
        // RequestVote
        // =====================================================================
        RequestVoteRequest: {
            type: "object",
            required: ["term", "candidateId", "lastLogIndex", "lastLogTerm"],
            properties: {
                term: {
                    type: "integer",
                    minimum: 0,
                    example: 13
                },

                candidateId: {
                    type: "string",
                    example: "node2"
                },

                lastLogIndex: {
                    type: "integer",
                    minimum: -1,
                    example: 7
                },

                lastLogTerm: {
                    type: "integer",
                    minimum: 0,
                    example: 11
                }
            }
        },

        RequestVoteResponse: {
            type: "object",
            properties: {
                term: {
                    type: "integer",
                    minimum: 0,
                    example: 13
                },

                voteGranted: {
                    type: "boolean",
                    example: true
                },

                reason: {
                    type: "string",
                    nullable: true,
                    example: "VOTE_GRANTED"
                }
            }
        },

        // =====================================================================
        // AppendEntries
        // =====================================================================
        AppendEntriesRequest: {
            type: "object",
            required: ["term", "leaderId", "prevLogIndex", "prevLogTerm", "entries", "leaderCommit"],
            properties: {
                term: {
                    type: "integer",
                    minimum: 0,
                    example: 12
                },

                leaderId: {
                    type: "string",
                    example: "node1"
                },

                prevLogIndex: {
                    type: "integer",
                    minimum: -1,
                    example: 6
                },

                prevLogTerm: {
                    type: "integer",
                    minimum: 0,
                    example: 11
                },

                entries: {
                    type: "array",
                    items: {
                        $ref: "#/components/schemas/RaftLogEntry"
                    },

                    description: "Entradas a replicar. Un array vacío representa un heartbeat."
                },
                
                leaderCommit: {
                    type: "integer",
                    minimum: -1,
                    example: 7
                }
            }
        },

        AppendEntriesResponse: {
            type: "object",
            properties: {
                term: {
                    type: "integer",
                    example: 12
                },

                success: {
                    type: "boolean",
                    example: true
                },

                matchIndex: {
                    type: "integer",
                    example: 7
                },

                reason: {
                    type: "string",
                    nullable: true,
                    example: null
                },

                stateMachineApplied: {
                    type: "boolean",
                    nullable: true,
                    example: true
                },

                stateMachineError: {
                    type: "string",
                    nullable: true,
                    example: null
                }
            }
        },

        // =====================================================================
        // POST /raft/command
        // =====================================================================
        RaftCommandRequest: {
            type: "object",
            required: ["type", "payload"],
            properties: {
                type: {
                    type: "string",
                    enum: ["PRODUCT_CREATE", "PRODUCT_UPDATE", "PRODUCT_DELETE", "PRODUCT_RESERVE"],
                    example: "PRODUCT_CREATE"
                },

                payload: {
                    type: "object",
                    description: "Datos correspondientes al comando solicitado.",
                    example: {
                        codigo: "P007",
                        nombre: "Producto Raft",
                        precio: 7000,
                        stock: 70
                    }
                }
            }
        },

        RaftCommandResponse: {
            type: "object",
            properties: {
                ok: { 
                    type: "boolean",
                    example: true
                },

                committed: {
                    type: "boolean",
                    example: true
                },

                leaderId: {
                    type: "string",
                    example: "node1"
                },

                term: {
                    type: "integer",
                    example: 12
                },
                
                entry: {
                    $ref: "#/components/schemas/RaftLogEntry"
                },

                commitIndex: {
                    type: "integer",
                    example: 8
                },

                lastApplied: {
                    type: "integer",
                    example: 8
                },

                matchIndex: {
                    $ref: "#/components/schemas/RaftIndexMap"
                }
            }
        },

        // =====================================================================
        // NOT_LEADER interno
        // =====================================================================
        RaftNotLeader: {
            type: "object",
            properties: {
                ok: {
                    type: "boolean",
                    example: false
                },

                error: {
                    type: "string",
                    example: "NOT_LEADER"
                },

                nodeId: {
                    type: "string",
                    example: "node2"
                },

                role: {
                    type: "string",
                    example: "FOLLOWER"
                },

                term: {
                    type: "integer",
                    example: 12
                },

                leaderId: {
                    type: "string",
                    nullable: true,
                    example: "node1"
                }
            }
        },

        // =====================================================================
        // Error
        // =====================================================================
        RaftError: {
            type: "object",
            properties: {
                error: {
                    type: "string",
                    example: "Solicitud Raft inválida"
                }
            }
        }
    };
}

// =============================================================================
// Paths Raft
// =============================================================================
export function buildRaftPaths({raftUrl, nodeId}) {
    const raftServers = buildRaftServers({raftUrl, nodeId});

    return {
        // =====================================================================
        // STATUS
        // =====================================================================
        "/raft/status": {
            get: {
                tags: ["RAFT"],
                servers: raftServers,
                summary: "Consultar estado Raft",
                description:
                    "Devuelve el estado interno del nodo: rol, término, " +
                    "líder conocido, voto, quorum, election timer y peers.",

                responses: {
                    "200": {
                        description: "Estado Raft del nodo",
                        content: { 
                            "application/json": {
                                schema: {
                                    $ref: "#/components/schemas/RaftStatus"
                                }
                            }
                        }
                    },

                    "500": {
                        description: "Error interno del nodo Raft",
                        content: {
                            "application/json": {
                                schema: {
                                    $ref: "#/components/schemas/RaftError"
                                }
                            }
                        }
                    }
                }
            }
        },

        // =====================================================================
        // LOG
        // =====================================================================
        "/raft/log": {
            get: {
                tags: ["RAFT"],
                servers: raftServers,
                summary: "Consultar log Raft",
                description:
                    "Devuelve el log replicado del nodo junto con commitIndex, " +
                    "lastApplied y los índices de replicación. nextIndex y " +
                    "matchIndex sólo tienen contenido significativo en el Leader.",
                responses: {
                    "200": {
                        description: "Estado del log Raft",
                        content: {
                            "application/json": {
                                schema: {
                                    $ref: "#/components/schemas/RaftLogResponse"
                                }
                            }
                        }
                    },

                    "500": {
                        description: "Error consultando el log Raft",
                        content: {
                            "application/json": {
                                schema: {
                                    $ref: "#/components/schemas/RaftError"
                                }
                            }
                        }
                    }
                }
            }
        },

        // =====================================================================
        // REQUEST VOTE
        // =====================================================================
        "/raft/request-vote": {
            post: {
                tags: ["RAFT"],
                servers: raftServers,
                summary: "Solicitar voto Raft",
                description:
                    "RPC interno utilizado por un CANDIDATE para solicitar " +
                    "el voto de otro nodo durante una elección.",

                requestBody: {
                    required: true,
                    content: {
                        "application/json": {
                            schema: { 
                                $ref: "#/components/schemas/RequestVoteRequest"
                            }
                        }
                    }
                },

                responses: {
                    "200": {
                        description: "Resultado de RequestVote",
                        content: {
                            "application/json": {
                                schema: {
                                    $ref: "#/components/schemas/RequestVoteResponse"
                                },
                                examples: {
                                    voteGranted: {
                                        summary: "Voto concedido",
                                        value: {
                                            term: 13,
                                            voteGranted: true
                                        }
                                    },

                                    voteRejected: {
                                        summary: "Voto rechazado",
                                        value: {
                                            term: 13, 
                                            voteGranted: false
                                        }
                                    }
                                }
                            }
                        }
                    },

                    "400": {
                        description: "Solicitud RequestVote inválida",
                        content: {
                            "application/json": {
                                schema: {
                                    $ref: "#/components/schemas/RaftError"
                                }
                            }
                        }
                    },

                    "500": {
                        description: "Error interno del nodo Raft",
                        content: {
                            "application/json": {
                                schema: {
                                    $ref: "#/components/schemas/RaftError"
                                }
                            }
                        }
                    }
                }
            }
        },

        // =====================================================================
        // APPEND ENTRIES
        // =====================================================================
        "/raft/append-entries": {
            post: {
                tags: ["RAFT"],
                servers: raftServers,
                summary: "AppendEntries / Heartbeat Raft",
                description:
                    "RPC enviado por el Leader para mantener el liderazgo y " +
                    "replicar entradas del log. También transporta leaderCommit " +
                    "para permitir que los followers avancen su commitIndex y " +
                    "apliquen entradas en su State Machine.",

                requestBody: {
                    required: true,
                    content: {
                        "application/json": {
                            schema: { 
                                $ref: "#/components/schemas/AppendEntriesRequest"
                            },

                            examples: {
                                heartbeat: {
                                    summary: "Heartbeat sin nuevas entradas",
                                    value: {
                                        term: 12,
                                        leaderId: "node1",
                                        prevLogIndex: 7,
                                        prevLogTerm: 11,
                                        entries: [],
                                        leaderCommit: 7
                                    }
                                }
                            }
                        }
                    }
                },

                responses: {
                    "200": {
                        description: "Resultado de AppendEntries",
                        content: {
                            "application/json": {
                                schema: { 
                                    $ref: "#/components/schemas/AppendEntriesResponse"
                                }
                            }
                        }
                    },

                    "400": {
                        description: "Solicitud AppendEntries inválida",
                        content: {
                            "application/json": {
                                schema: {
                                    $ref: "#/components/schemas/RaftError"
                                }
                            }
                        }
                    },

                    "500": {
                        description: "Error interno procesando AppendEntries",
                        content: {
                            "application/json": {
                                schema: {
                                    $ref: "#/components/schemas/RaftError"
                                }
                            }
                        }
                    }
                }
            }
        },


        // =====================================================================
        // COMMAND
        // =====================================================================
        "/raft/command": {
            post: {
                tags: ["RAFT"],
                servers: raftServers,
                summary: "Agregar un comando al log Raft",
                description:
                    "Endpoint interno Leader-only. Agrega un comando al log local, " +
                    "lo replica hacia los followers, espera quorum, avanza commitIndex " +
                    "y aplica las entradas committed en la State Machine. " +
                    "La API REST de negocio utiliza internamente este mecanismo.",

                requestBody: {
                    required: true,
                    content: {
                        "application/json": {
                            schema: {
                                $ref: "#/components/schemas/RaftCommandRequest"
                            },

                            examples: {
                                productCreate: {
                                    summary: "Crear producto",
                                    value: {
                                        type: "PRODUCT_CREATE",
                                        payload: {
                                            codigo: "P007",
                                            nombre: "Producto Raft",
                                            precio: 7000,
                                            stock: 70
                                        }
                                    }
                                },

                                productReserve: {
                                    summary: "Reservar una unidad",
                                    value: {
                                        type: "PRODUCT_RESERVE",
                                        payload: {
                                            _id: "6aa2c589555ab594ffcadf0a",
                                            quantity: 1,
                                            stockBefore: 48,
                                            stockAfter: 47
                                        }
                                    }
                                }
                            }
                        }
                    }
                },

                responses: {
                    "201": {
                        description: "Comando committed y aplicado",
                        content: {
                            "application/json": {
                                schema: { 
                                    $ref: "#/components/schemas/RaftCommandResponse"
                                }
                            }
                        }
                    },

                    "400": {
                        description: "Comando inválido",
                        content: {
                            "application/json": {
                                schema: {
                                    $ref: "#/components/schemas/RaftError"
                                }
                            }
                        }
                    },

                    "409": {
                        description: "El nodo no es Leader o existe un conflicto funcional",
                        content: {
                            "application/json": {
                                schema: {
                                    oneOf: [
                                        {
                                            $ref: "#/components/schemas/RaftNotLeader"
                                        },

                                        {
                                            $ref: "#/components/schemas/RaftError"
                                        }
                                    ]
                                }
                            }
                        }
                    },

                    "503": {
                        description: "No se pudo alcanzar quorum",
                        content: {
                            "application/json": {
                                example: {
                                    ok: false,
                                    error: "NO_QUORUM"
                                }
                            }
                        }
                    },

                    "500": {
                        description: "Error interno procesando el comando",
                        content: {
                            "application/json": {
                                schema: {
                                    $ref: "#/components/schemas/RaftError"
                                }
                            }
                        }
                    }
                }
            }
        }
    };
}