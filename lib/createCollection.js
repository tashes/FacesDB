import { checkCollection } from "../utils/checks.js";
import { Wrap } from "../utils/errors.js";
import { createFolder, exists } from "../utils/fs.js";
import { collectionResource, withResources } from "./resourceLocks.js";

export async function createCollection(collection) {
    let collectionError = checkCollection(collection);
    if (collectionError instanceof Error)
        throw Wrap("Cannot start createCollection", collectionError);

    try {
        return await withResources([
            collectionResource(collection, "exclusive"),
        ], "createCollection", () => {
        if (exists(collection) === false) {
            createFolder(collection);
            createFolder(collection, "bucket");
        } else {
            throw new Error("Collection exists");
        }
        });
    } catch (e) {
        throw Wrap("Cannot run createCollection", e);
    }
}
