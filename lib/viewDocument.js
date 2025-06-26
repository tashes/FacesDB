import { checkCollection, checkDocument } from "../utils/checks";
import { readfile } from "../utils/fs";

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
