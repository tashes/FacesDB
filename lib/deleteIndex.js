import { checkCollection, checkIndex } from "../utils/checks";

export async function deleteIndex(index, collection) {
    let indexError = checkIndex(index);
    if (indexError instanceof Error)
        throw Wrap("Cannot start deleteIndex", indexError);
    let collectionError = checkCollection(collection);
    if (collectionError instanceof Error)
        throw Wrap("Cannot start deleteIndex", collection);

    try {
        if (exists(collection, `${index}.json`) === true) {
            rm(collection, `${index}.json`);
        }
    } catch (e) {
        throw Wrap("Cannot run deleteIndex", e);
    }
}
