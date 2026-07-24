import {
    checkCollection,
    checkDocumentobj,
    isDefined,
} from "../utils/checks.js";
import { appendjsonl, atomicwritejson, exists } from "../utils/fs.js";
import { newid } from "../utils/ids.js";
import {
    isIndexBuilding,
    listBuildingIndexes,
    listCollectionIndexes,
} from "./listCollectionIndexes.js";
import { readIndexConfig } from "./viewIndexConfig.js";
import { appendIndexUpdate } from "./indexUpdates.js";
import { notifyMaintenance } from "./maintenance.js";
import { Wrap } from "../utils/errors.js";
import { deepcopy } from "../utils/deepcopy.js";
import {
    collectionResource,
    documentResource,
    indexResource,
    indexCatalogResource,
    withResources,
} from "./resourceLocks.js";

export async function createDocument(collection, documentobj) {
    let collectionError = checkCollection(collection);
    if (collectionError instanceof Error)
        throw Wrap("Cannot start createDocument", collectionError);
    let documentobjError = checkDocumentobj(documentobj);
    if (documentobjError instanceof Error)
        throw Wrap("Cannot start createDocument", documentobjError);

    try {
        // Create ID
        let id = newid();
        return await withResources([
            collectionResource(collection),
            indexCatalogResource(collection),
        ], "createDocument", async () => {
        const lockedIndexes = Array.from(new Set([
            ...await listCollectionIndexes(collection),
            ...listBuildingIndexes(collection),
        ]));
        return await withResources([
            documentResource(collection, id, "exclusive"),
            ...lockedIndexes.map((name) => indexResource(collection, name, "exclusive")),
        ], "createDocument", async () => {
        if (exists(collection, `${id}.json`) === false) {
            let copy = deepcopy(documentobj);
            copy._id = id;

            // Add to collection
            atomicwritejson(copy, collection, `${id}.json`);

            // Run through indexes and add to the correct ones.
            let indexes = lockedIndexes;
            for (let i = 0; i < indexes.length; i++) {
                let indexName = indexes[i];
                if (isIndexBuilding(collection, indexName)) {
                    appendjsonl({ _id: id }, collection, `.${indexName}.building.delta.jsonl`);
                    continue;
                }
                let indexConfig = readIndexConfig(indexName, collection);
                let indexConfigKeys = Object.keys(indexConfig);
                let shouldGoIntoIndex = indexConfigKeys.every(
                    (indexConfigKey) => {
                        if (indexConfig[indexConfigKey] === true) {
                            return isDefined(copy[indexConfigKey]) === true;
                        } else {
                            return true;
                        }
                    },
                );
                if (shouldGoIntoIndex === true) {
                    let indexObj = Object.fromEntries([
                        ["_id", id],
                        ...indexConfigKeys.map((indexConfigKey) => [
                            indexConfigKey,
                            copy[indexConfigKey],
                        ]),
                    ]);
                    appendIndexUpdate(indexName, collection, indexObj);
                }
            }

            if (indexes.length > 0) {
                notifyMaintenance();
            }

            return copy;
        } else {
            throw Wrap("Document exists");
        }
        });
        });
    } catch (e) {
        throw Wrap("Cannot run createDocument", e);
    }
}
