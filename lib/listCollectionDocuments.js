import { checkCollection } from "../utils/checks.js";
import { DOCUMENTID } from "../utils/constants.js";
import { Wrap } from "../utils/errors.js";
import { readdir } from "../utils/fs.js";

export async function listCollectionDocuments(collection) {
    let collectionError = checkCollection(collection);
    if (collectionError instanceof Error)
        throw Wrap("Cannot start viewCollectionDocuments", collectionError);

    try {
        let documents = readdir(collection);
        return documents
            .filter((a) => a.split(".")[0].match(DOCUMENTID))
            .map((a) => a.split(".")[0]);
    } catch (e) {
        throw Wrap("Cannot run viewCollectionDocuments", e);
    }
}
