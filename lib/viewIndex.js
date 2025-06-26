import { checkCollection, checkIndex } from "../utils/checks";
import { env } from "../utils/env";
import { pulljsonl } from "../utils/fs";

export async function viewIndex(index, collection, pageNumber = 0) {
    let indexError = checkIndex(index);
    if (indexError instanceof Error)
        throw Wrap("Cannot start viewIndex", indexError);
    let collectionError = checkCollection(collection);
    if (collectionError instanceof Error)
        throw Wrap("Cannot start viewIndex", collection);
    let pageNumberError = checkPageNumber(pageNumber);
    if (pageNumberError instanceof Error)
        throw Wrap("Cannot start viewIndex", pageNumber);

    try {
        let from = pageNumber * env("PAGESIZE");
        let to = (pageNumber + 1) * env("PAGESIZE");
        let objs = pulljsonl(from, to);
        return objs;
    } catch (e) {
        throw Wrap("Cannot run viewIndex", e);
    }
}
