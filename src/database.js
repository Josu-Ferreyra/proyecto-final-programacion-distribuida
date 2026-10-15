import mongoose from "mongoose";
import { log } from "./logger.js";

export async function connectDatabase(mongoUri) {
    if(typeof mongoUri !== "string" || mongoUri.trim() === "") {
        throw new Error("MONGODB_URI no está configurado");
    }

    if (mongoose.connection.readyState === 1) {
        return mongoose.connection;
    }

    try {
        await mongoose.connect(mongoUri, {
                serverSelectionTimeoutMS: 5000
            }
        );

        return mongoose.connection;

    }
    catch (error) {
        throw new Error(`No se pudo conectar con MongoDB: ${error.message}`);
    }
}


export async function disconnectDatabase() {
    if (mongoose.connection.readyState === 0) {
        return;
    }

    await mongoose.disconnect();
}


export function isDatabaseConnected() {
    return mongoose.connection.readyState === 1;
}


export function getDatabaseInfo() {
    return {
        connected: mongoose.connection.readyState === 1,
        readyState: mongoose.connection.readyState,
        host: mongoose.connection.host || null,
        port: mongoose.connection.port || null,
        database: mongoose.connection.name || null
    };
}


mongoose.connection.on("connected", () => {
        log.info(`MongoDB     : conectado a ${mongoose.connection.name}`);
    }
);


mongoose.connection.on("disconnected",() => {
        log.info("MongoDB     : desconectado");
    }
);


mongoose.connection.on("error", error => {
        log.error("MongoDB Error:", error.message);
    }
);