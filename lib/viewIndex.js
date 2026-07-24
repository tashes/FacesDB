import {
    checkCollection,
    checkIndex,
    checkPageNumber,
} from "../utils/checks.js";
import { env } from "../utils/env.js";
import { Wrap } from "../utils/errors.js";
import { pulljsonl } from "../utils/fs.js";
import { readIndexRows } from "./indexSidecar.js";
import { collectionResource, indexResource, withResources } from "./resourceLocks.js";

export async function viewIndex(index, collection, pageNumber = 0) {
    const indexError = checkIndex(index);
    if (indexError instanceof Error)
        throw Wrap("Cannot start viewIndex", indexError);
    const collectionError = checkCollection(collection);
    if (collectionError instanceof Error)
        throw Wrap("Cannot start viewIndex", collectionError);
    const pageNumberError = checkPageNumber(pageNumber);
    if (pageNumberError instanceof Error)
        throw Wrap("Cannot start viewIndex", pageNumberError);

    try {
        return await withResources([
            collectionResource(collection),
            indexResource(collection, index),
        ], "viewIndex", async () => {
        if (pageNumber === Infinity) {
            return await pulljsonl(0, Infinity, collection, `${index}.jsonl`);
        }
        const size = env("PAGESIZE");
        return await readIndexRows(index, collection, pageNumber * size, size);
        });
    } catch (err) {
        throw Wrap("Cannot run viewIndex", err);
    }
}
