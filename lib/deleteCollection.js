import { Wrap } from "../utils/errors";
import { checkCollection } from "../utils/checks";
import { rm } from "../utils/fs";

export async function deleteCollection(collection) {
    let collectionError = checkCollection(collection);
    if (collectionError instanceof Error)
        throw Wrap("Cannot start deleteCollection", collectionError);

    try {
        rm(collection);
    } catch (e) {
        throw Wrap("Cannot run deleteCollection", e);
    }
}
