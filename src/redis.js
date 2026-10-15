import { createClient } from "redis";
import { randomUUID } from "node:crypto";
import { log } from "./logger.js";

let redisClient = null;

function getClient() {
    if (!redisClient || !redisClient.isOpen) {
        throw new Error("Redis no está conectado");
    }

    return redisClient;
}

export async function connectRedis(redisUrl) {
    if (redisClient && redisClient.isOpen) {
        return await redisClient.ping();
    }

    redisClient = createClient({
        url: redisUrl,
        socket: {
            reconnectionStrategy: false
        },
        disableOfflineQueue: true
    });

    redisClient.on("error", error => {
            log.error("Redis Error:", error.message);
        }
    );


    redisClient.on("connect", () => {
            log.info("Redis       : conectando...");
        }
    );


    redisClient.on("ready", () => {
            log.info("Redis       : conexión lista");
        }
    );

    await redisClient.connect();

    return await redisClient.ping();
}

export async function disconnectRedis() {
    if (!redisClient || !redisClient.isOpen) {
        return;
    }

    await redisClient.quit();
}


export function isRedisConnected() {
    return Boolean(redisClient && redisClient.isReady);
}

export async function acquireLock(resource, ttlMs = 5000) {
    const client = getClient();

    if (typeof resource !== "string" || resource.trim() === "") {
        throw new Error("El recurso del lock es inválido");
    }

    if (!Number.isInteger(ttlMs) || ttlMs <= 0) {
        throw new Error("El TTL del lock debe ser un entero positivo");
    }

    const lockKey = `lock:${resource.trim()}`;
    const token = randomUUID();
    const result = await client.set(lockKey, token, {NX: true, PX: ttlMs});

    if (result !== "OK") {
        return null;
    }

    return {
        key: lockKey,
        token,
        ttlMs
    };
}


export async function releaseLock(lock) {
    const client = getClient();

    if (!lock || typeof lock.key !== "string" || typeof lock.token !== "string") {
        return false;
    }

    const releaseScript = `
        if redis.call("get", KEYS[1]) == ARGV[1] then
            return redis.call("del", KEYS[1])
        else
            return 0
        end
    `;

    const result = await client.eval(releaseScript, {keys: [lock.key], arguments: [lock.token]});

    return result === 1;
}

export async function getLockInfo(resource) {
    const client = getClient();
    const lockKey = `lock:${resource}`;
    const token = await client.get(lockKey);
    const ttl = await client.pTTL(lockKey);

    return {
        key: lockKey,
        exists: token !== null,
        token,
        ttlMs: ttl
    };
}