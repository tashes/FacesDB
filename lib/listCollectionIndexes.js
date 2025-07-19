import { checkCollection } from "../utils/checks.js";
import { INDEXNAME } from "../utils/constants.js";
import { Wrap } from "../utils/errors.js";
import { isFile, readdir } from "../utils/fs.js";

export async function listCollectionIndexes(collection) {
    let collectionError = checkCollection(collection);
    if (collectionError instanceof Error)
        throw Wrap("Cannot start viewCollectionDocuments", collectionError);

    try {
        let documents = readdir(collection);
        return Array.from(
            new Set(
                documents
                    .filter((a) => a.split(".")[0].match(INDEXNAME))
                    .filter((a) => isFile(collection, a))
                    .map((a) => a.split(".")[0]),
            ).values(),
        );
    } catch (e) {
        throw Wrap("Cannot run viewCollectionDocuments", e);
    }
}
