import {
    checkCollection,
    checkDocument,
    checkDocumentobj,
    isDefined,
} from "../utils/checks.js";
import { deepcopy } from "../utils/deepcopy.js";
import { Wrap } from "../utils/errors.js";
import {
    appendjsonl,
    atomicwritejson,
    exists,
    isFile,
    readfile,
} from "../utils/fs.js";
import {
    isIndexBuilding,
    listBuildingIndexes,
    listCollectionIndexes,
} from "./listCollectionIndexes.js";
import { readIndexConfig } from "./viewIndexConfig.js";
import { appendIndexUpdate, deleteIndexUpdate } from "./indexUpdates.js";
import { notifyMaintenance } from "./maintenance.js";
import {
    collectionResource,
    documentResource,
    indexResource,
    indexCatalogResource,
    withResources,
} from "./resourceLocks.js";

async function replaceDocument(collection, document, documentobj, indexes) {
    if (
        exists(collection, `${document}.json`) === false ||
        isFile(collection, `${document}.json`) === false
    ) throw new Error("Document does not exist");

    const copy = deepcopy(documentobj);
    copy._id = document;
    atomicwritejson(copy, collection, `${document}.json`);

    for (const indexName of indexes) {
        if (isIndexBuilding(collection, indexName)) {
            appendjsonl({ _id: document }, collection, `.${indexName}.building.delta.jsonl`);
            continue;
        }
        const indexConfig = readIndexConfig(indexName, collection);
        const keys = Object.keys(indexConfig);
        const included = keys.every((key) => indexConfig[key] !== true || isDefined(copy[key]));
        if (included) {
            const indexObj = Object.fromEntries([
                ["_id", document],
                ...keys.map((key) => [key, copy[key]]),
            ]);
            appendIndexUpdate(indexName, collection, indexObj);
        } else {
            deleteIndexUpdate(indexName, collection, document);
        }
    }
    if (indexes.length > 0) {
        notifyMaintenance();
    }
    return copy;
}

function validateDocumentRequest(operation, collection, document) {
    const collectionError = checkCollection(collection);
    if (collectionError instanceof Error) throw Wrap(`Cannot start ${operation}`, collectionError);
    const documentError = checkDocument(document);
    if (documentError instanceof Error) throw Wrap(`Cannot start ${operation}`, documentError);
}

async function withDocumentMutation(collection, document, operation, task) {
    return await withResources([
        collectionResource(collection),
        indexCatalogResource(collection),
    ], operation, async () => {
        const indexes = Array.from(new Set([
            ...await listCollectionIndexes(collection),
            ...listBuildingIndexes(collection),
        ]));
        return await withResources([
            documentResource(collection, document, "exclusive"),
            ...indexes.map((name) => indexResource(collection, name, "exclusive")),
        ], operation, () => task(indexes));
    });
}

export async function putDocument(collection, document, documentobj) {
    validateDocumentRequest("putDocument", collection, document);
    const documentobjError = checkDocumentobj(documentobj);
    if (documentobjError instanceof Error)
        throw Wrap("Cannot start putDocument", documentobjError);
    try {
        return await withDocumentMutation(
            collection,
            document,
            "putDocument",
            (indexes) => replaceDocument(collection, document, documentobj, indexes),
        );
    } catch (err) {
        throw Wrap("Cannot run putDocument", err);
    }
}

export async function updateDocument(collection, document, updater) {
    validateDocumentRequest("updateDocument", collection, document);
    if (typeof updater !== "function") {
        throw Wrap("Cannot start updateDocument", new Error("updater must be a function"));
    }
    try {
        return await withDocumentMutation(collection, document, "updateDocument", async (indexes) => {
            if (exists(collection, `${document}.json`) === false) {
                throw new Error("Document does not exist");
            }
            const current = JSON.parse(readfile(collection, `${document}.json`));
            const updated = updater(deepcopy(current));
            if (updated?.then instanceof Function) {
                throw new Error("updateDocument callback must be synchronous");
            }
            const documentobjError = checkDocumentobj(updated);
            if (documentobjError instanceof Error) throw documentobjError;
            return await replaceDocument(collection, document, updated, indexes);
        });
    } catch (err) {
        throw Wrap("Cannot run updateDocument", err);
    }
}
