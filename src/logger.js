import winston from "winston";
import DailyRotateFile from "winston-daily-rotate-file";
import fs from "node:fs";
import path from "node:path";

let logger = null;

// -----------------------------------------------------------------------------
// Crear logger
// -----------------------------------------------------------------------------
export function initLogger(config = {}) {
    if (logger) {
        return logger;
    }

    const logDir = path.resolve(config.logDir || "./logs");
    const logLevel = config.logLevel || "info";
    const maxSize = config.maxSize || "5m";
    const maxFiles = config.maxFiles || "7d";

    // -------------------------------------------------------------------------
    // Crear directorio de logs
    // -------------------------------------------------------------------------
    fs.mkdirSync(logDir, {recursive: true});

    // -------------------------------------------------------------------------
    // Formato
    // -------------------------------------------------------------------------
    const fileFormat =
        winston.format.combine(
            winston.format.timestamp({
                format: "YYYY-MM-DD HH:mm:ss"
            }),

            winston.format.errors({
                stack: true
            }),

            winston.format.printf(
                ({
                    timestamp,
                    level,
                    message,
                    stack
                }) => {

                    return (
                        `${timestamp} [${level.toUpperCase()}] ` +
                        `${stack || message}`
                    );

                }
            )
        );

    // -------------------------------------------------------------------------
    // Archivo general
    // -------------------------------------------------------------------------
    const applicationTransport =
        new DailyRotateFile({
            level: logLevel,
            dirname: logDir,
            filename: "application-%DATE%.log",
            datePattern: "YYYY-MM-DD",
            maxSize: maxSize,
            maxFiles: maxFiles,
            zippedArchive: false,
            format: fileFormat
        });


    // -------------------------------------------------------------------------
    // Archivo de errores
    // -------------------------------------------------------------------------
    const errorTransport =
        new DailyRotateFile({

            level: "error",
            dirname: logDir,
            filename: "error-%DATE%.log",
            datePattern: "YYYY-MM-DD",
            maxSize: maxSize,
            maxFiles: maxFiles,
            zippedArchive: false,
            format: fileFormat
        });


    // -------------------------------------------------------------------------
    // Manejo de errores de los transports
    // -------------------------------------------------------------------------
    applicationTransport.on("error", error => {
            console.error("Logger file error:", error.message);
        }
    );

    errorTransport.on("error", error => {
            console.error("Logger error file error:", error.message);
        }
    );


    // -------------------------------------------------------------------------
    // Logger
    // -------------------------------------------------------------------------
    logger =
        winston.createLogger({
            level: logLevel,
            transports: [
                new winston.transports.Console({
                    format:
                        winston.format.combine(
                            winston.format.colorize(),
                            winston.format.timestamp({format: "HH:mm:ss"}),
                            winston.format.printf(
                                ({
                                    timestamp,
                                    level,
                                    message
                                }) => {

                                    return (
                                        `${timestamp} ` +
                                        `${level}: ${message}`
                                    );

                                }
                            )
                        )
                }),

                applicationTransport,
                errorTransport
            ]
        });


    return logger;
}


// -----------------------------------------------------------------------------
// Obtener logger
// -----------------------------------------------------------------------------
export function getLogger() {
    if (!logger) {
        throw new Error("Logger no inicializado");
    }

    return logger;
}


// -----------------------------------------------------------------------------
//Logger global diferido
// -----------------------------------------------------------------------------
export const log = {
    debug(message, ...args) {
        return getLogger().debug(
            message,
            ...args
        );
    },


    info(message, ...args) {
        return getLogger().info(
            message,
            ...args
        );
    },


    warn(message, ...args) {
        return getLogger().warn(
            message,
            ...args
        );
    },


    error(message, ...args) {
        return getLogger().error(
            message,
            ...args
        );
    }

};