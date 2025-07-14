import { Wrap } from "../utils/errors.js";
import { checkCollection } from "../utils/checks.js";
import { exists, isFolder, rm } from "../utils/fs.js";

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
