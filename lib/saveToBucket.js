import { v4 } from "uuid";
import { checkCollection, checkObject } from "../utils/checks.js";
import { Wrap } from "../utils/errors.js";
import { exists, writefile } from "../utils/fs.js";

export async function saveToBucket(collection, object) {
    let collectionError = checkCollection(collection);
    if (collectionError instanceof Error)
        throw Wrap("Cannot start saveToBucket", collectionError);
    let objectError = checkObject(object);
    if (objectError instanceof Error)
        throw Wrap("Cannot start saveToBucket", objectError);

    try {
        if (exists(collection) === true) {
            let id = v4();
            if (exists(collection, "bucket", id) === true) {
                throw new Error("Object already exists");
            }
            writefile(object, collection, "bucket", id);
            return id;
        }
    } catch (e) {
        throw Wrap("Cannot run saveToBucket", e);
    }
}
