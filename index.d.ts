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

export function viewIndexConfig(
    index: string,
    collection: string,
): Promise<Record<string, boolean>>;

export function deleteIndex(index: string, collection: string): Promise<void>;

export type KVMutationPriority = "foreground" | "normal" | "background";
export interface KVMutationOptions {
    priority?: KVMutationPriority;
    timeoutMs?: number;
    namespace?: string;
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
export function getKV<T = unknown>(key: string): Promise<T | undefined>;
export function deleteKV(key: string, options?: KVMutationOptions): Promise<boolean>;
export function deleteManyKV(
    keys: string[],
    options?: KVMutationOptions,
): Promise<boolean[]>;
export function hasKV(key: string): Promise<boolean>;
export function observeKVLocks(listener: (event: KVLockEvent) => void): () => void;

export interface SegmentMutationOptions extends KVMutationOptions {
    nodeId?: string;
}
export interface SegmentImportResult {
    segment: string | null;
    count: number;
}
export function importDocuments<T extends object>(
    collection: string,
    documents: Iterable<T> | AsyncIterable<T>,
    options?: SegmentMutationOptions,
): Promise<SegmentImportResult>;
export function deleteSegmentDocuments(
    collection: string,
    documentIds: Iterable<string> | AsyncIterable<string>,
    options?: SegmentMutationOptions,
): Promise<SegmentImportResult>;
export function refreshCollectionIndex(
    collection: string,
): Promise<{ segments: number }>;
export function viewSegmentDocument<T = Record<string, unknown>>(
    collection: string,
    document: string,
): Promise<(T & { _id: string }) | undefined>;
