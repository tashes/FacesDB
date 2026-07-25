import { Wrap } from "../utils/errors.js";
import { checkCollection } from "../utils/checks.js";
import { exists, isFolder, rmConcurrent } from "../utils/fs.js";
import { collectionResource, withResources } from "./resourceLocks.js";

export async function deleteCollection(collection) {
    let collectionError = checkCollection(collection);
    if (collectionError instanceof Error)
        throw Wrap("Cannot start deleteCollection", collectionError);

    try {
        return await withResources([
            collectionResource(collection, "exclusive"),
        ], "deleteCollection", () => {
        if (exists(collection) && isFolder(collection)) {
            return rmConcurrent(collection);
        }
        });
    } catch (e) {
        throw Wrap("Cannot run deleteCollection", e);
    }
}
