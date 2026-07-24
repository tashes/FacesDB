import { checkCollection, checkDocument } from "../utils/checks.js";
import { Wrap } from "../utils/errors.js";
import { appendjsonl, exists, rm } from "../utils/fs.js";
import {
    isIndexBuilding,
    listBuildingIndexes,
    listCollectionIndexes,
} from "./listCollectionIndexes.js";
import { deleteIndexUpdate } from "./indexUpdates.js";
import { notifyMaintenance } from "./maintenance.js";
import {
    collectionResource,
    documentResource,
    indexResource,
    indexCatalogResource,
    withResources,
} from "./resourceLocks.js";

export async function deleteDocument(collection, document) {
    let collectionError = checkCollection(collection);
    if (collectionError instanceof Error)
        throw Wrap("Cannot start deleteDocument", collectionError);
    let documentError = checkDocument(document);
    if (documentError instanceof Error)
        throw Wrap("Cannot start deleteDocument", documentError);

    try {
        return await withResources([
            collectionResource(collection),
            indexCatalogResource(collection),
        ], "deleteDocument", async () => {
        const lockedIndexes = Array.from(new Set([
            ...await listCollectionIndexes(collection),
            ...listBuildingIndexes(collection),
        ]));
        return await withResources([
            documentResource(collection, document, "exclusive"),
            ...lockedIndexes.map((name) => indexResource(collection, name, "exclusive")),
        ], "deleteDocument", async () => {
        // Check if document exists
        if (exists(collection, `${document}.json`)) {
            // Remove document
            rm(collection, `${document}.json`);

            // Run through indexes and add to the correct ones
            let indexes = lockedIndexes;
            for (let i = 0; i < indexes.length; i++) {
                let indexName = indexes[i];
                if (isIndexBuilding(collection, indexName)) {
                    appendjsonl({ _id: document }, collection, `.${indexName}.building.delta.jsonl`);
                    continue;
                }
                deleteIndexUpdate(indexName, collection, document);
            }
            if (indexes.length > 0) {
                notifyMaintenance();
            }
        } else {
            throw new Error("Document does not exist");
        }
        });
        });
    } catch (e) {
        throw Wrap("Cannot run deleteDocument", e);
    }
}
