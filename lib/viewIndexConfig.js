import { checkCollection, checkIndex } from "../utils/checks.js";
import { Wrap } from "../utils/errors.js";
import { exists, readfile } from "../utils/fs.js";
import { collectionResource, indexResource, withResources } from "./resourceLocks.js";

export function readIndexConfig(index, collection) {
    if (exists(collection, `${index}.json`) === true) {
        return JSON.parse(readfile(collection, `${index}.json`));
    }
}

export async function viewIndexConfig(index, collection) {
    let indexError = checkIndex(index);
    if (indexError instanceof Error)
        throw Wrap("Cannot start viewIndexConfig", indexError);
    let collectionError = checkCollection(collection);
    if (collectionError instanceof Error)
        throw Wrap("Cannot start viewIndexConfig", collectionError);

    try {
        return await withResources([
            collectionResource(collection),
            indexResource(collection, index),
        ], "viewIndexConfig", () => readIndexConfig(index, collection));
    } catch (e) {
        throw Wrap("Cannot run viewIndexConfig", e);
    }
}
