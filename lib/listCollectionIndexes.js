import { checkCollection } from "../utils/checks";
import { INDEXNAME } from "../utils/constants";
import { Wrap } from "../utils/errors";
import { readdir } from "../utils/fs";

export async function listCollectionIndexes(collection) {
    let collectionError = checkCollection(collection);
    if (collectionError instanceof Error)
        throw Wrap("Cannot start viewCollectionDocuments", collectionError);

    try {
        let documents = readdir(collection);
        return documents
            .filter((a) => a.split(".")[0].match(INDEXNAME))
            .map((a) => a.split(".")[0]);
    } catch (e) {
        throw Wrap("Cannot run viewCollectionDocuments", e);
    }
}
