import { checkCollection, checkIndex } from "../utils/checks.js";
import { Wrap } from "../utils/errors.js";
import { exists, readfile } from "../utils/fs.js";

export async function viewIndexConfig(index, collection) {
    let indexError = checkIndex(index);
    if (indexError instanceof Error)
        throw Wrap("Cannot start viewIndexConfig", indexError);
    let collectionError = checkCollection(collection);
    if (collectionError instanceof Error)
        throw Wrap("Cannot start viewIndexConfig", collectionError);

    try {
        if (exists(collection, `${index}.json`) === true) {
            return JSON.parse(readfile(collection, `${index}.json`));
        }
    } catch (e) {
        throw Wrap("Cannot run viewIndexConfig", e);
    }
}
