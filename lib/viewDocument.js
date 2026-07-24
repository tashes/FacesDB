import { checkCollection, checkDocument } from "../utils/checks.js";
import { Wrap } from "../utils/errors.js";
import { readfile } from "../utils/fs.js";

export async function viewDocument(collection, document) {
    let collectionError = checkCollection(collection);
    if (collectionError instanceof Error)
        throw Wrap("Cannot start viewDocument", collectionError);
    let documentError = checkDocument(document);
    if (documentError instanceof Error)
        throw Wrap("Cannot start viewDocument", documentError);

    try {
        return JSON.parse(readfile(collection, `${document}.json`));
    } catch (e) {
        throw Wrap("Cannot run viewDocument", e);
    }
}
