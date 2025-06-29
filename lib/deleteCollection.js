import { Wrap } from "../utils/errors";
import { checkCollection } from "../utils/checks";
import { exists, isFolder, rm } from "../utils/fs";

export async function deleteCollection(collection) {
    let collectionError = checkCollection(collection);
    if (collectionError instanceof Error)
        throw Wrap("Cannot start deleteCollection", collectionError);

    try {
        if (exists(collection) && isFolder(collection)) {
            rm(collection);
        }
    } catch (e) {
        throw Wrap("Cannot run deleteCollection", e);
    }
}
