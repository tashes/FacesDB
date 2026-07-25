// facesdb/index.d.ts

export function list(): Promise<string[]>;
export function createCollection(collection: string): Promise<void>;
export function listCollectionDocuments(collection: string): Promise<string[]>;
export function listCollectionIndexes(collection: string): Promise<string[]>;
export function deleteCollection(collection: string): Promise<void>;

export function createDocument<T extends object>(
    collection: string,
    documentobj: T,
): Promise<T & { _id: string }>;

export function viewDocument<T = Record<string, unknown>>(
    collection: string,
    document: string,
): Promise<T & { _id: string }>;

export function putDocument<T extends object>(
    collection: string,
    document: string,
    documentobj: T,
): Promise<T & { _id: string }>;
export function updateDocument<T extends object>(
    collection: string,
    document: string,
    updater: (current: T & { _id: string }) => T,
): Promise<T & { _id: string }>;

export function deleteDocument(
    collection: string,
    document: string,
): Promise<void>;

export function saveToBucket(
    collection: string,
    object: unknown,
): Promise<string>;

export function viewInBucket<T = unknown>(
    collection: string,
    id: string,
): Promise<T>;

export function deleteFromBucket(collection: string, id: string): Promise<void>;

export function createIndex(
    index: string,
    config: Record<string, boolean>,
    collection: string,
): Promise<void>;

export function viewIndex(
    index: string,
    collection: string,
    pageNumber?: number,
): Promise<Array<{ _id: string; [key: string]: unknown }>>;

export function searchIndex(
    index: string,
    collection: string,
    fn: (doc: any) => boolean,
    pageNumber?: number,
): Promise<Array<{ _id: string; [key: string]: unknown }>>;

export function rankIndex<T extends Record<string, any> = Record<string, any>>(
    index: string,
    collection: string,
    sorter: (a: T, b: T) => number,
    exclusion?: (entry: T) => boolean,
): Promise<void>;
export function findIndexEntry<T = Record<string, unknown>>(
    index: string,
    collection: string,
    document: string,
): Promise<T | undefined>;

export function viewIndexConfig(
    index: string,
    collection: string,
): Promise<Record<string, boolean>>;

export function deleteIndex(index: string, collection: string): Promise<void>;
export function compactIndex(index: string, collection: string): Promise<boolean>;

export interface FacesDBMaintenanceOptions {
    intervalMs?: number;
    updateLimitBytes?: number;
    staleRatio?: number;
    minimumUpdateRecords?: number;
}
export function configureMaintenance(options?: FacesDBMaintenanceOptions): void;
export function ensureMaintenanceWorker(): unknown;
export function runMaintenance(
    options?: FacesDBMaintenanceOptions & { force?: boolean },
): Promise<Array<{ collection: string; index: string }>>;
export function stopMaintenance(): Promise<void>;

export type KVMutationPriority = "foreground" | "normal" | "background";
export interface KVMutationOptions {
    priority?: KVMutationPriority;
    timeoutMs?: number;
    namespace?: string;
    durability?: "buffered" | "sync";
}
export interface KVLockEvent {
    type: "queued" | "acquired" | "released" | "timeout";
    keyHash: string;
    requestId: string;
    priority: KVMutationPriority;
    namespace?: string;
    operation: string;
    keyCount: number;
    queueDepth: number;
    timestamp: number;
    waitMs: number;
    holdMs?: number;
    mode?: "shared" | "exclusive";
    resourceHash?: string;
    resourceCount?: number;
}

export function setKV<T = unknown>(
    key: string,
    value: T,
    options?: KVMutationOptions,
): Promise<T>;
export function setManyKV<T = unknown>(
    entries: Array<readonly [string, T]>,
    options?: KVMutationOptions,
): Promise<T[]>;
export function getKV<T = unknown>(
    key: string,
    options?: KVMutationOptions,
): Promise<T | undefined>;
export function getManyKV<T = unknown>(
    keys: string[],
    options?: KVMutationOptions,
): Promise<Array<T | undefined>>;
export function deleteKV(key: string, options?: KVMutationOptions): Promise<boolean>;
export function deleteManyKV(
    keys: string[],
    options?: KVMutationOptions,
): Promise<boolean[]>;
export function hasKV(key: string, options?: KVMutationOptions): Promise<boolean>;
export function hasManyKV(
    keys: string[],
    options?: KVMutationOptions,
): Promise<boolean[]>;
export function updateKV<T = unknown>(
    key: string,
    updater: (current: T | undefined) => T,
    options?: KVMutationOptions,
): Promise<T>;
export function getVersionedKV<T = unknown>(
    key: string,
    options?: KVMutationOptions,
): Promise<{ value: T | undefined; revision: number }>;
export function compareAndSetKV<T = unknown>(
    key: string,
    expectedRevision: number,
    value: T,
    options?: KVMutationOptions,
): Promise<boolean>;
export function observeKVLocks(listener: (event: KVLockEvent) => void): () => void;
export function observeResourceLocks(listener: (event: KVLockEvent) => void): () => void;
export interface KVImportOptions extends KVMutationOptions {
    batchSize?: number;
}
export function importManyKV<T = unknown>(
    entries: Iterable<readonly [string, T]> | AsyncIterable<readonly [string, T]>,
    options?: KVImportOptions,
): Promise<{ count: number; batches: number }>;
