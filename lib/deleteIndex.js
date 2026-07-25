import { checkCollection, checkIndex } from "../utils/checks.js";
import { Wrap } from "../utils/errors.js";
import { exists, rm } from "../utils/fs.js";
import { removeIndexSidecars } from "./indexSidecar.js";
import { collectionResource, indexCatalogResource, indexResource, withResources } from "./resourceLocks.js";
import { removeIndexFromCatalog } from "./listCollectionIndexes.js";
import { removeIndexUpdates } from "./indexUpdates.js";

export async function deleteIndex(index, collection) {
    let indexError = checkIndex(index);
    if (indexError instanceof Error)
        throw Wrap("Cannot start deleteIndex", indexError);
    let collectionError = checkCollection(collection);
    if (collectionError instanceof Error)
        throw Wrap("Cannot start deleteIndex", collectionError);

    try {
        return await withResources([
            collectionResource(collection),
            indexCatalogResource(collection, "exclusive"),
        ], "deleteIndex", async () => await withResources([
            indexResource(collection, index, "exclusive"),
        ], "deleteIndex", async () => {
        if (exists(collection, `${index}.json`) === true) {
            rm(collection, `${index}.json`);
            rm(collection, `${index}.jsonl`);
            removeIndexSidecars(index, collection);
            removeIndexUpdates(index, collection);
            removeIndexFromCatalog(collection, index);
        }
        }));
    } catch (e) {
        throw Wrap("Cannot run deleteIndex", e);
    }
}
