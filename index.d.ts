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

export function viewIndexConfig(
    index: string,
    collection: string,
): Promise<Record<string, boolean>>;

export function deleteIndex(index: string, collection: string): Promise<void>;

export function setKV<T = unknown>(key: string, value: T): Promise<T>;
export function getKV<T = unknown>(key: string): Promise<T | undefined>;
export function deleteKV(key: string): Promise<boolean>;
export function hasKV(key: string): Promise<boolean>;
