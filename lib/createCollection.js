import { checkCollection } from "../utils/checks.js";
import { Wrap } from "../utils/errors.js";
import { createFolder, exists } from "../utils/fs.js";

export async function createCollection(collection) {
    let collectionError = checkCollection(collection);
    if (collectionError instanceof Error)
        throw Wrap("Cannot start createCollection", collectionError);

    try {
        if (exists(collection) === false) {
            createFolder(collection);
        } else {
            throw new Error("Collection exists");
        }
    } catch (e) {
        throw Wrap("Cannot run createCollection", e);
    }
}
