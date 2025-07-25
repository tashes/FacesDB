import {
    checkCollection,
    checkIndex,
    checkPageNumber,
} from "../utils/checks.js";
import { env } from "../utils/env.js";
import { Wrap } from "../utils/errors.js";
import { pulljsonl } from "../utils/fs.js";

export async function viewIndex(index, collection, pageNumber = 0) {
    let indexError = checkIndex(index);
    if (indexError instanceof Error)
        throw Wrap("Cannot start viewIndex", indexError);
    let collectionError = checkCollection(collection);
    if (collectionError instanceof Error)
        throw Wrap("Cannot start viewIndex", collectionError);
    let pageNumberError = checkPageNumber(pageNumber);
    if (pageNumberError instanceof Error)
        throw Wrap("Cannot start viewIndex", pageNumberError);

    try {
        let from = pageNumber * env("PAGESIZE");
        let to = (pageNumber + 1) * env("PAGESIZE");
        if (pageNumber === Infinity) {
            from = 0;
            to = Infinity;
        }
        let objs = pulljsonl(from, to, collection, `${index}.jsonl`);
        return objs;
    } catch (e) {
        throw Wrap("Cannot run viewIndex", e);
    }
}
