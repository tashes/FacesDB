import { opendirSync, promises as fsPromises } from 'fs'

import {
    checkCollection,
    checkIndex,
    checkIndexConfig,
    isDefined,
} from "../utils/checks.js";
import { DOCUMENTID } from "../utils/constants.js";
import { Wrap } from "../utils/errors.js";
import { refreshIndexSidecars, removeIndexSidecars } from "./indexSidecar.js";
import {
    appendjsonl,
    atomicwritejson,
    deletejsonl,
    editjsonlraw,
    exists,
    jsonlexists,
    openjsonlwriter,
    path,
    readfile,
    rm,
    writefile,
} from "../utils/fs.js";
import {
    collectionResource,
    indexCatalogResource,
    indexResource,
    withResources,
} from "./resourceLocks.js";
import {
    clearIndexBuilding,
    finishIndexBuilding,
    markIndexBuilding,
} from "./listCollectionIndexes.js";

const DOCUMENT_READ_CONCURRENCY = 32

function documentIds(collection) {
    const directory = opendirSync(path(collection));
    return {
        *[Symbol.iterator]() {
            try {
                let entry;
                while ((entry = directory.readSync()) !== null) {
                    if (entry.isFile() === false || entry.name.endsWith(".json") === false) continue;
                    const id = entry.name.slice(0, -5);
                    if (DOCUMENTID.test(id)) yield id;
                }
            } finally {
                directory.closeSync();
            }
        },
    };
}

async function* documentBatches(collection, concurrency = DOCUMENT_READ_CONCURRENCY) {
    let batch = []
    for (const id of documentIds(collection)) {
        batch.push(id)
        if (batch.length < concurrency) continue
        yield await Promise.all(batch.map(async (document) => ({
            id: document,
            contents: await fsPromises.readFile(path(collection, `${document}.json`)),
        })))
        batch = []
    }
    if (batch.length > 0) {
        yield await Promise.all(batch.map(async (document) => ({
            id: document,
            contents: await fsPromises.readFile(path(collection, `${document}.json`)),
        })))
    }
}

function indexEntry(document, config) {
    const keys = Object.keys(config);
    if (keys.every((key) => config[key] !== true || isDefined(document[key])) === false) {
        return undefined;
    }
    return Object.fromEntries([
        ["_id", document._id],
        ...keys.map((key) => [key, document[key]]),
    ]);
}

async function reconcileDeltas(index, config, collection) {
    const deltaName = `.${index}.building.delta.jsonl`;
    if (exists(collection, deltaName) === false) return;
    const ids = new Set(readfile(collection, deltaName).toString()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line)._id));
    for (const id of ids) {
        const documentExists = exists(collection, `${id}.json`);
        const indexed = await jsonlexists(id, collection, `${index}.jsonl`);
        if (documentExists === false) {
            if (indexed) await deletejsonl(id, collection, `${index}.jsonl`);
            continue;
        }
        const document = JSON.parse(readfile(collection, `${id}.json`));
        const entry = indexEntry(document, config);
        if (entry === undefined) {
            if (indexed) await deletejsonl(id, collection, `${index}.jsonl`);
        } else if (indexed) {
            await editjsonlraw(id, entry, collection, `${index}.jsonl`);
        } else {
            appendjsonl(entry, collection, `${index}.jsonl`);
        }
    }
}

export async function createIndex(index, config, collection) {
    const indexError = checkIndex(index);
    if (indexError instanceof Error) throw Wrap("Cannot start createIndex", indexError);
    const configError = checkIndexConfig(config);
    if (configError instanceof Error) throw Wrap("Cannot start createIndex", configError);
    const collectionError = checkCollection(collection);
    if (collectionError instanceof Error) throw Wrap("Cannot start createIndex", collectionError);

    const marker = `.${index}.building.json`;
    const delta = `.${index}.building.delta.jsonl`;
    let writer;
    try {
        await withResources([
            collectionResource(collection),
            indexCatalogResource(collection, "exclusive"),
        ], "createIndexStart", async () => await withResources([
            indexResource(collection, index, "exclusive"),
        ], "createIndexStart", () => {
            if (exists(collection, `${index}.json`)) throw new Error("Index exists");
            if (exists(collection, marker)) throw new Error("Index build already in progress");
            atomicwritejson(config, collection, marker);
            writefile("", collection, delta);
            return markIndexBuilding(collection, index);
        }));

        writer = openjsonlwriter(collection, `${index}.jsonl`);
        let scanned = 0;
        for await (const batch of documentBatches(collection)) {
            for (const { contents } of batch) {
                const document = JSON.parse(contents);
                const entry = indexEntry(document, config);
                if (entry !== undefined) writer.write(entry);
                scanned += 1;
            }
            if (scanned % 1024 === 0) {
                await new Promise((resolve) => setImmediate(resolve));
            }
        }

        await withResources([
            collectionResource(collection),
            indexCatalogResource(collection, "exclusive"),
        ], "createIndexCommit", async () => await withResources([
            indexResource(collection, index, "exclusive"),
        ], "createIndexCommit", async () => {
            writer.commit();
            writer = undefined;
            await reconcileDeltas(index, config, collection);
            atomicwritejson(config, collection, `${index}.json`);
            finishIndexBuilding(collection, index);
            rm(collection, marker);
            rm(collection, delta);
        }));
        await refreshIndexSidecars(index, collection);
    } catch (err) {
        writer?.abort();
        try {
            await withResources([
                collectionResource(collection),
                indexCatalogResource(collection, "exclusive"),
            ], "createIndexCleanup", async () => await withResources([
                indexResource(collection, index, "exclusive"),
            ], "createIndexCleanup", () => {
                if (exists(collection, `${index}.json`) === false) {
                    clearIndexBuilding(collection, index);
                    removeIndexSidecars(index, collection);
                    for (const name of [`${index}.jsonl`, marker, delta]) {
                        try { rm(collection, name); } catch (_) {}
                    }
                }
            }));
        } catch (_) {}
        throw Wrap("Cannot run createIndex", err);
    }
}
