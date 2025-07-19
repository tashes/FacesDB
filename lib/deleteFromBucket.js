import { checkBucketId, checkCollection } from "../utils/checks.js";
import { Wrap } from "../utils/errors.js";
import { exists, rm } from "../utils/fs.js";

export async function deleteFromBucket(collection, id) {
    let collectionError = checkCollection(collection);
    if (collectionError instanceof Error)
        throw Wrap("Cannot start deleteFromBucket", collectionError);
    let idError = checkBucketId(id);
    if (idError instanceof Error)
        throw Wrap("Cannot start deleteFromBucket", idError);

    try {
        if (exists(collection, "bucket", id) === true) {
            return rm(collection, "bucket", id);
        }
    } catch (e) {
        throw Wrap("Cannot run deleteFromBucket", e);
    }
}
