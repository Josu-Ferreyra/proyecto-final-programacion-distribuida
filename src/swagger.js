import {buildRaftPaths, buildRaftSchemas} from "./raft/raftSwagger.js";

function normalizeApiPrefix(apiPrefix) {
    if (!apiPrefix) {
        return "/api";
    }

    let prefix = String(apiPrefix).trim();
    if (!prefix.startsWith("/")) {
        prefix = "/" + prefix;
    }

    if (prefix.length > 1 && prefix.endsWith("/")) {
        prefix = prefix.slice(0, -1);
    }

    return prefix;
}


// =============================================================================
// Swagger
// =============================================================================
export function buildSwaggerSpec({httpPort, httpsPort, apiPrefix, raftUrl, nodeId}) {
    const normalizedApiPrefix = normalizeApiPrefix(apiPrefix);
    const raftPaths = buildRaftPaths({raftUrl, nodeId});
    const raftSchemas = buildRaftSchemas();

    // =========================================================================
    // Paths API REST
    // =========================================================================
    const apiPaths = {
        // =====================================================================
        // Estado general
        // =====================================================================
        "/": {
            get: {
                tags: ["General"],
                summary: "Estado general del nodo",
                description: "Devuelve información del servicio REST y del estado Raft del nodo local, incluyendo rol, término actual y líder conocido.",
                responses: {
                    200: {
                        description: "Estado actual del nodo",
                        content: {
                            "application/json": {
                                schema: {
                                    $ref: "#/components/schemas/ApiStatus"
                                },

                                example: {
                                    service: "TP4 - API REST Distribuida con Raft",
                                    status: "OK",
                                    database: "MongoDB + Mongoose",
                                    coordination: "Redis / Memurai",
                                    consensus: "Raft",
                                    raft: {
                                        nodeId: "node1",
                                        role: "LEADER",
                                        term: 12,
                                        leaderId: "node1"
                                    }
                                }
                            }
                        }
                    }
                }
            }
        },

        // =====================================================================
        // Productos
        // =====================================================================
        "/productos": {
            // -----------------------------------------------------------------
            // GET
            // -----------------------------------------------------------------
            get: {
                tags: ["Productos"],
                summary: "Obtener todos los productos",
                description: 
                    "Consulta la réplica MongoDB local del nodo. " +
                    "Esta operación no ejecuta consenso Raft. " +
                    "Un follower que se encuentre recuperándose podría devolver " +
                    "temporalmente una lectura atrasada.",

                responses: {
                    200: {
                        description: "Lista de productos almacenados en la réplica local",
                        content: { 
                            "application/json": { 
                                schema: {
                                    type: "array",
                                    items: {
                                        $ref: "#/components/schemas/Product"
                                    }
                                }
                            }
                        }
                    },

                    500: {
                        $ref: "#/components/responses/InternalServerError"
                    }
                }
            },

            // -----------------------------------------------------------------
            // POST
            // -----------------------------------------------------------------
            post: {
                tags: ["Productos"],
                summary: "Crear un producto mediante Raft",
                description:
                    "Operación de escritura Leader-only. " +
                    "El producto se incorpora al log Raft, se replica a los followers, " +
                    "debe alcanzar quorum y sólo después del commit es aplicado por " +
                    "la State Machine en MongoDB. " +
                    "Un follower responde 409 NOT_LEADER indicando el líder conocido.",

                requestBody: {
                    required: true,
                    content: {
                        "application/json": { 
                            schema: {
                                $ref: "#/components/schemas/ProductInput"
                            },

                            example: {
                                codigo: "PROD-001",
                                nombre: "Teclado",
                                precio: 45000,
                                stock: 10
                            }
                        }
                    }
                },

                responses: {
                    201: {
                        description: "Producto creado, committed y aplicado mediante Raft",
                        content: {
                            "application/json": {
                                schema: {
                                    $ref: "#/components/schemas/Product"
                                }
                            }
                        }
                    },

                    400: {
                        $ref: "#/components/responses/BadRequest"
                    },

                    409: {
                        description: "Conflicto: código duplicado o el nodo no es Leader",
                        content: {
                            "application/json": {
                                schema: {
                                    oneOf: [
                                        {
                                            $ref: "#/components/schemas/Error"
                                        },

                                        {
                                            $ref: "#/components/schemas/NotLeader"
                                        }
                                    ]
                                },

                                examples: {
                                    duplicateCode: {
                                        summary: "Código duplicado",
                                        value: {
                                            error: "Ya existe un producto con ese código"
                                        }
                                    },

                                    notLeader: {
                                        summary: "Escritura enviada a un follower",
                                        value: {
                                            ok: false,
                                            error: "NOT_LEADER",
                                            nodeId: "node2",
                                            role: "FOLLOWER",
                                            term: 12,
                                            leaderId: "node1"
                                        }
                                    }
                                }
                            }
                        }
                    },

                    503: {
                        $ref: "#/components/responses/RaftUnavailable"
                    },

                    500: {
                        $ref: "#/components/responses/InternalServerError"
                    }
                }
            }
        },

        // =====================================================================
        // Producto por ID
        // =====================================================================
        "/productos/{id}": {
            // -----------------------------------------------------------------
            // GET
            // -----------------------------------------------------------------
            get: {
                tags: ["Productos"],
                summary: "Obtener un producto por ID",
                description:
                    "Consulta la réplica MongoDB local. " +
                    "No requiere consenso Raft y puede ser temporalmente stale " +
                    "si el follower todavía se encuentra recuperando entradas.",

                parameters: [
                    {
                        $ref: "#/components/parameters/ProductId"
                    }
                ],

                responses: {
                    200: {
                        description: "Producto encontrado",
                        content: { 
                            "application/json": {
                                schema: {
                                    $ref: "#/components/schemas/Product"
                                }
                            }
                        }
                    },

                    400: {
                        $ref: "#/components/responses/BadRequest"
                    },

                    404: {
                        $ref: "#/components/responses/NotFound"
                    },

                    500: {
                        $ref: "#/components/responses/InternalServerError"
                    }
                }
            },

            // -----------------------------------------------------------------
            // PUT
            // -----------------------------------------------------------------
            put: {
                tags: ["Productos"],
                summary: "Actualizar un producto mediante Raft",
                description:
                    "Operación Leader-only. La modificación se incorpora como " +
                    "PRODUCT_UPDATE al log Raft y se aplica únicamente después " +
                    "de alcanzar quorum y commit.",

                parameters: [
                    {
                        $ref: "#/components/parameters/ProductId"
                    }
                ],

                requestBody: {
                    required: true,
                    content: {
                        "application/json": {
                            schema: {
                                $ref: "#/components/schemas/ProductInput"
                            },

                            example: {
                                codigo: "PROD-001",
                                nombre: "Teclado mecánico",
                                precio: 50000,
                                stock: 20
                            }
                        }
                    }
                },

                responses: {
                    200: {
                        description: "Producto actualizado, committed y aplicado mediante Raft",
                        content: {
                            "application/json": {
                                schema: {
                                    $ref: "#/components/schemas/Product"
                                }
                            }
                        }
                    },

                    400: {
                        $ref: "#/components/responses/BadRequest"
                    },

                    404: {
                        $ref: "#/components/responses/NotFound"
                    },

                    409: {
                        description: "Conflicto: código duplicado o nodo follower",
                        content: {
                            "application/json": {
                                schema: {
                                    oneOf: [
                                        {
                                            $ref: "#/components/schemas/Error"
                                        },

                                        { 
                                            $ref: "#/components/schemas/NotLeader"
                                        }
                                    ]
                                }
                            }
                        }
                    },

                    503: {
                        $ref: "#/components/responses/RaftUnavailable"
                    },

                    500: {
                        $ref: "#/components/responses/InternalServerError"
                    }
                }
            },

            // -----------------------------------------------------------------
            // DELETE
            // -----------------------------------------------------------------
            delete: {
                tags: ["Productos"],
                summary: "Eliminar un producto mediante Raft",
                description:
                    "Operación Leader-only. Se agrega PRODUCT_DELETE al log y " +
                    "el documento se elimina de cada réplica después del commit.",

                parameters: [
                    {
                        $ref: "#/components/parameters/ProductId"
                    }
                ],

                responses: {
                    204: {
                        description: "Producto eliminado mediante Raft"
                    },

                    400: {
                        $ref: "#/components/responses/BadRequest"
                    },

                    404: {
                        $ref: "#/components/responses/NotFound"
                    },

                    409: {
                        $ref: "#/components/responses/NotLeaderResponse"
                    },

                    503: {
                        $ref: "#/components/responses/RaftUnavailable"
                    },

                    500: {
                        $ref: "#/components/responses/InternalServerError"
                    }
                }
            }
        },

        // =====================================================================
        // Reserva SIN LOCK - TP2
        // =====================================================================
        "/productos/{id}/reservar-sin-lock": {
            post: {
                tags: ["Concurrencia"],
                summary: "Reservar una unidad sin lock - demostración TP2",
                description:
                    "Endpoint deliberadamente vulnerable conservado para demostrar " +
                    "una condición de carrera. Modifica únicamente MongoDB local y " +
                    "NO participa del consenso Raft. No debe considerarse una " +
                    "operación distribuida válida del TP4.",

                parameters: [
                    {
                        $ref: "#/components/parameters/ProductId"
                    }
                ],

                responses: {
                    200: { 
                        description: "Reserva local realizada sin lock",
                        content: {
                            "application/json": {
                                schema: {
                                    $ref: "#/components/schemas/LegacyReservation"
                                }
                            }
                        }
                    },

                    400: {
                        $ref: "#/components/responses/BadRequest"
                    },

                    404: {
                        $ref: "#/components/responses/NotFound"
                    },

                    409: {
                        description: "Sin stock disponible",
                        content: {
                            "application/json": {
                                schema: {
                                    $ref: "#/components/schemas/Error"
                                }
                            }
                        }
                    },

                    500: {
                        $ref: "#/components/responses/InternalServerError"
                    }
                }
            }
        },

        // =====================================================================
        // Reserva CON LOCK + RAFT
        // =====================================================================
        "/productos/{id}/reservar": {
            post: {
                tags: ["Concurrencia"],
                summary: "Reservar una unidad mediante Redis + Raft",
                description:
                    "Operación Leader-only. Redis/Memurai protege la sección crítica " +
                    "mediante un lock distribuido por producto. La modificación de stock " +
                    "se registra como PRODUCT_RESERVE en Raft y sólo es aplicada luego " +
                    "de alcanzar quorum y commit. El stock resultante es determinado " +
                    "por el Leader y replicado de forma determinística.",

                parameters: [
                    {
                        $ref: "#/components/parameters/ProductId"
                    }
                ],

                responses: {
                    200: {
                        $ref: "#/components/responses/RaftReservationSuccess"
                    },

                    400: {
                        $ref: "#/components/responses/BadRequest"
                    },

                    404: {
                        $ref: "#/components/responses/NotFound"
                    },

                    409: {
                        description: "Sin stock disponible o nodo no Leader",
                        content: {
                            "application/json": {
                                schema: {
                                    oneOf: [
                                        {
                                            $ref: "#/components/schemas/Error"
                                        },

                                        {
                                            $ref: "#/components/schemas/NotLeader"
                                        }
                                    ]
                                },
                                examples: {
                                    noStock: {
                                        value: {
                                            error: "Sin stock disponible"
                                        }
                                    },
                                    notLeader: {
                                        value: {
                                            ok: false,
                                            error: "NOT_LEADER",
                                            nodeId: "node2",
                                            role: "FOLLOWER",
                                            term: 12,
                                            leaderId: "node1"
                                        }
                                    }
                                }
                            }
                        }
                    },

                    423: {
                        description: "Lock de Redis ocupado por otra operación concurrente",
                        content: {
                            "application/json": {
                                schema: {
                                    $ref: "#/components/schemas/Error"
                                },

                                example: {
                                    error: "Producto bloqueado por otra operación"
                                }
                            }
                        }
                    },

                    503: {
                        $ref: "#/components/responses/RaftUnavailable"
                    },

                    500: {
                        $ref: "#/components/responses/InternalServerError"
                    }
                }
            }
        }
    };

    // =========================================================================
    // Schemas API
    // =========================================================================
    const apiSchemas = {
        // ---------------------------------------------------------------------
        // Estado API
        // ---------------------------------------------------------------------
        ApiStatus: {
            type: "object",
            properties: {
                service: {
                   type: "string"
                },
                
                status: {
                    type: "string",
                    example: "OK"
                },

                database: {
                    type: "string",
                    example: "MongoDB + Mongoose"
                },

                coordination: {
                    type: "string",
                    example: "Redis / Memurai"
                },

                consensus: {
                    type: "string",
                    example: "Raft"
                },

                raft: {
                    $ref: "#/components/schemas/RaftNodeSummary"
                }
            }
        },

        RaftNodeSummary: {
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

        // ---------------------------------------------------------------------
        // Product Input
        // ---------------------------------------------------------------------
        ProductInput: {
            type: "object",
            required: ["codigo", "nombre", "precio", "stock"],
            properties: {
                codigo: {
                    type: "string",
                    example: "PROD-001"
                },

                nombre: {
                    type: "string",
                    example: "Teclado"
                },

                precio: {
                    type: "number",
                    minimum: 0,
                    example: 45000
                },

                stock: {
                    type: "integer",
                    minimum: 0,
                    example: 10
                }
            }
        },

        // ---------------------------------------------------------------------
        // Product
        // ---------------------------------------------------------------------
        Product: {
            allOf: [
                {
                    $ref: "#/components/schemas/ProductInput"
                },

                {
                    type: "object",
                    properties: {
                        _id: {
                            type: "string",
                            pattern: "^[a-fA-F0-9]{24}$",
                            example: "6aa2c589555ab594ffcadf0a"
                        },
                        createdAt: {
                            type: "string",
                            format: "date-time",
                            example: "2026-09-10T14:58:17.618Z"
                        },

                        updatedAt: {
                            type: "string",
                            format: "date-time",
                            example: "2026-09-10T17:00:05.729Z"
                        }
                    }
               }
            ]
        },

        // ---------------------------------------------------------------------
        // Error genérico
        // ---------------------------------------------------------------------
        Error: {
            type: "object",
            properties: {
                error: {
                    type: "string", 
                    example: "Mensaje de error"
                }
            }
        },

        // ---------------------------------------------------------------------
        // NOT_LEADER
        // ---------------------------------------------------------------------
        NotLeader: {
            type: "object",
            required: ["ok", "error", "nodeId", "role", "term", "leaderId"],
            properties: {
                ok: {
                    type: "boolean",
                    example: false
                },

                error: {
                    type: "string",
                    enum: ["NOT_LEADER"]
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

        // ---------------------------------------------------------------------
        // Reserva histórica TP2
        // ---------------------------------------------------------------------
        LegacyReservation: {
            type: "object",
            properties: {
                message: {
                    type: "string",
                    example: "Reserva realizada sin lock"
                },

                resource: {
                    $ref: "#/components/schemas/Product"
                }
            }
        },

        // ---------------------------------------------------------------------
        // Metadata Raft de una operación
        // ---------------------------------------------------------------------
        RaftOperationMetadata: {
            type: "object",
            properties: {
                leaderId: {
                    type: "string",
                    example: "node1"
                },

                term: {
                    type: "integer",
                    example: 11
                },

                commitIndex: {
                    type: "integer",
                    example: 7
                },

                lastApplied: {
                    type: "integer",
                    example: 7
                }
            }
        },

        // ---------------------------------------------------------------------
        // Reserva distribuida TP4
        // ---------------------------------------------------------------------
        RaftReservation: {
            type: "object",
            properties: {
                message: {
                    type: "string", 
                    example: "Reserva realizada mediante Raft"
                },

                resource: {
                    $ref: "#/components/schemas/Product"
                },

                raft: {
                    $ref: "#/components/schemas/RaftOperationMetadata"
                }
            }
        }
    };

    // =========================================================================
    // Parameters
    // =========================================================================
    const apiParameters = {
        ProductId: {
            name: "id",
            in: "path",
            required: true,
            description: "Identificador ObjectId de MongoDB del producto",
            schema: {
                type: "string",
                pattern: "^[a-fA-F0-9]{24}$"
            },

            example: "6aa2c589555ab594ffcadf0a"
        }
    };

    // =========================================================================
    // Responses reutilizables
    // =========================================================================
    const apiResponses = {
        // ---------------------------------------------------------------------
        // 400
        // ---------------------------------------------------------------------
        BadRequest: {
            description: "Solicitud inválida",
            content: {
                "application/json": {
                    schema: {
                        $ref: "#/components/schemas/Error"
                    },
                    example: {
                        error: "Datos inválidos"
                    }
                }
            }
        },

        // ---------------------------------------------------------------------
        // 404
        // ---------------------------------------------------------------------
        NotFound: {
            description: "Producto no encontrado",
            content: {
                "application/json": {
                    schema: {
                        $ref: "#/components/schemas/Error"
                    },

                    example: {
                        error: "Producto no encontrado"
                    }
                }
            }
        },

        // ---------------------------------------------------------------------
        // 409 NOT_LEADER
        // ---------------------------------------------------------------------
        NotLeaderResponse: {
            description: "El nodo local no es el Leader Raft",
            content: {
                "application/json": {
                    schema: {
                        $ref: "#/components/schemas/NotLeader"
                    },

                    example: {
                        ok: false,
                        error: "NOT_LEADER",
                        nodeId: "node2",
                        role: "FOLLOWER",
                        term: 12,
                        leaderId: "node1"
                    }
                }
            }
        },

        // ---------------------------------------------------------------------
        // 503
        // ---------------------------------------------------------------------
        RaftUnavailable: {
            description: "No fue posible confirmar la operación mediante quorum Raft",
            content: {
                "application/json": {
                    schema: {
                        $ref: "#/components/schemas/Error"
                    },

                    example: {
                        error: "NO_QUORUM"
                    }
                }
            }
        },

        // ---------------------------------------------------------------------
        // 500
        // ---------------------------------------------------------------------
        InternalServerError: {
            description: "Error interno del servidor",
            content: {
                "application/json": {
                    schema: {
                        $ref: "#/components/schemas/Error"
                    },

                    example: {
                        error: "Error interno del servidor"
                    }
                }
            }
        },

        // ---------------------------------------------------------------------
        // Reserva Raft correcta
        // ---------------------------------------------------------------------
        RaftReservationSuccess: {
            description: "Reserva protegida por Redis y committed mediante Raft",
            content: {
                "application/json": {
                    schema: {
                        $ref: "#/components/schemas/RaftReservation"
                    },
                    example: {
                        message: "Reserva realizada mediante Raft",
                        resource: {
                            _id: "6aa2c589555ab594ffcadf0a",
                            codigo: "P005",
                            nombre: "Producto Persistencia 2",
                            precio: 5000,
                            stock: 47
                        },

                        raft: {
                            leaderId: "node1",
                            term: 11,
                            commitIndex: 7,
                            lastApplied: 7
                        }
                    }
                }
            }
        }
    };

    // =========================================================================
    // OpenAPI
    // =========================================================================
    return {
        openapi: "3.0.3",
        info: {
            title: `TP4 - API REST Distribuida + Raft - ${nodeId}`,
            version: "4.0.0",
            description:
                "API REST distribuida construida sobre tres nodos independientes. " +
                "Las escrituras se coordinan mediante una implementación simplificada " +
                "del algoritmo Raft, con elección de Leader, replicación de log, quorum, " +
                "commit y State Machine. Cada nodo mantiene su propia base MongoDB. " +
                "Redis/Memurai se utiliza exclusivamente para exclusión mutua distribuida " +
                "en operaciones concurrentes y no interviene en la elección, quorum ni " +
                "commit de Raft."

        },

        servers: [
            {
                url: `http://127.0.0.1:${httpPort}${normalizedApiPrefix}`,
                description: `API HTTP - ${nodeId}`
            },

            {
                url: `https://localhost:${httpsPort}${normalizedApiPrefix}`,
                description: `API HTTPS - ${nodeId}`
            }
        ],

        tags: [
            {
                name: "General",
                description: "Información general y estado Raft del nodo"
            },

            {
                name: "Productos",
                description: "CRUD REST. Las escrituras utilizan consenso Raft; los GET son lecturas locales."
            },

            {
                name: "Concurrencia",
                description: "Demostración de condición de carrera, exclusión mutua con Redis/Memurai y reserva distribuida mediante Raft."

            },

            {
                name: "RAFT",
                description: "Endpoints internos del protocolo Raft. No forman parte de la API de negocio."
            }

        ],

        paths: {
            ...apiPaths,
            ...raftPaths
        },

        components: {
            schemas: {
                ...apiSchemas,
                ...raftSchemas
            },

            parameters: {
                ...apiParameters
            },

            responses: {
                ...apiResponses
            }
        }
    };
}