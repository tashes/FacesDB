import { v4 } from "uuid";
import {
    checkBucketId,
    checkCollection,
    checkObject,
} from "../utils/checks.js";
import { Wrap } from "../utils/errors.js";
import { exists, readfile, writefile } from "../utils/fs.js";

export async function viewInBucket(collection, id) {
    let collectionError = checkCollection(collection);
    if (collectionError instanceof Error)
        throw Wrap("Cannot start viewInBucket", collectionError);
    let idError = checkBucketId(id);
    if (idError instanceof Error)
        throw Wrap("Cannot start viewInBucket", idError);

    try {
        if (exists(collection, "bucket", id) === true) {
            return readfile(collection, "bucket", id);
        }
    } catch (e) {
        throw Wrap("Cannot run viewInBucket", e);
    }
}
